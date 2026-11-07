"""
Change Tickets API Router
-------------------------
Exposes endpoints for listing and creating change tickets per §9 of architecture.md:
- GET /api/tickets (Viewer+)
- POST /api/tickets (NetEng+)
"""
import hashlib
import hmac
import json
import re
import time
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.audit import body_evidence, record_audit
from app.core.database import get_db
from app.core.rbac import require_neteng, require_viewer
from app.models.alerts import Alert
from app.models.tickets import ChangeTicket
from app.models.devices import Device, DeviceGroup
from app.models.users import User
from app.schemas.tickets import ChangeTicketCreate, ChangeTicketOut, ITSMWebhookPayload

router = APIRouter(prefix="/tickets", tags=["Tickets"])


@router.get("", response_model=List[ChangeTicketOut])
def list_tickets(
    device_id: Optional[UUID] = Query(None, description="Filter by device UUID"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status (OPEN/CLOSED)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer),
):
    """
    List all change tickets.
    Role: Viewer+
    """
    query = db.query(ChangeTicket)
    if device_id:
        query = query.filter(ChangeTicket.device_id == device_id)
    if status_filter:
        query = query.filter(ChangeTicket.status == status_filter.upper())

    return query.order_by(ChangeTicket.valid_from.desc()).all()


@router.post("", response_model=ChangeTicketOut, status_code=status.HTTP_201_CREATED)
def create_ticket(
    ticket_in: ChangeTicketCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_neteng),
):
    """
    Create a new change ticket to authorize configuration drift.
    Role: NetEng+
    """
    # Check for duplicate ticket_ref
    existing = db.query(ChangeTicket).filter(ChangeTicket.ticket_ref == ticket_in.ticket_ref).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Change ticket with ref '{ticket_in.ticket_ref}' already exists",
        )

    # Validate device or group if provided
    if ticket_in.device_id:
        dev = db.query(Device).filter(Device.id == ticket_in.device_id).first()
        if not dev:
            raise HTTPException(status_code=404, detail=f"Device {ticket_in.device_id} not found")
    if ticket_in.device_group_id:
        grp = db.query(DeviceGroup).filter(DeviceGroup.id == ticket_in.device_group_id).first()
        if not grp:
            raise HTTPException(status_code=404, detail=f"DeviceGroup {ticket_in.device_group_id} not found")

    if ticket_in.valid_from > ticket_in.valid_to:
        raise HTTPException(status_code=400, detail="valid_from must be before valid_to")

    ticket = ChangeTicket(
        ticket_ref=ticket_in.ticket_ref,
        source=ticket_in.source or "internal",
        external_ref=ticket_in.external_ref,
        device_id=ticket_in.device_id,
        device_group_id=ticket_in.device_group_id,
        key_path_scope=ticket_in.key_path_scope,
        valid_from=ticket_in.valid_from,
        valid_to=ticket_in.valid_to,
        status=ticket_in.status.upper(),
    )
    db.add(ticket)
    db.flush()
    record_audit(db, "TICKET_CREATED", "ticket", ticket.id, current_user.id,
                 after={"ticket_ref": ticket.ticket_ref, "source": ticket.source, "device_id": str(ticket.device_id) if ticket.device_id else None,
                        "device_group_id": str(ticket.device_group_id) if ticket.device_group_id else None,
                        "valid_from": ticket.valid_from.isoformat(), "valid_to": ticket.valid_to.isoformat(), "status": ticket.status})
    db.commit()
    db.refresh(ticket)
    return ticket


def _raise_forged_webhook_alert(db: Session, reason: str, source_ip: Optional[str]) -> None:
    """
    A delivery that fails authentication is an attempt to open a maintenance window (and so suppress drift) without the ITSM's
    secret. It raises a SECURITY_CHANGE alert (shown as Critical). One open alert per source address: repeats update its attempt
    count, so an unauthenticated sender cannot flood the alerts page.
    """
    prefix = f"Rejected ITSM webhook from {source_ip or 'unknown source'}"
    open_alert = (
        db.query(Alert)
        .filter(Alert.type == "SECURITY_CHANGE", Alert.acknowledged.is_(False), Alert.message.startswith(prefix + ":"))
        .order_by(Alert.created_at.desc())
        .first()
    )
    if open_alert:
        found = re.search(r"Attempts: (\d+)$", open_alert.message)
        attempts = int(found.group(1)) + 1 if found else 2
        open_alert.message = f"{prefix}: {reason}. No ticket was created and no drift was suppressed. Attempts: {attempts}"
        return
    db.add(Alert(
        type="SECURITY_CHANGE",
        message=f"{prefix}: {reason}. No ticket was created and no drift was suppressed. Attempts: 1",
    ))


@router.post("/webhook", response_model=ChangeTicketOut)
async def itsm_webhook(
    request: Request,
    db: Session = Depends(get_db),
    x_itsm_signature: Optional[str] = Header(None, alias="X-ITSM-Signature"),
    x_hub_signature_256: Optional[str] = Header(None, alias="X-Hub-Signature-256"),
    x_itsm_timestamp: Optional[str] = Header(None, alias="X-ITSM-Timestamp"),
):
    """
    Every delivery leaves one audit entry, accepted or refused. An authenticated delivery is recorded with its body (capped);
    one that failed authentication is recorded with only a digest, source address and reason, so an unauthenticated caller
    cannot fill the trail with its own text.
    """
    raw_body = await request.body()
    source_ip = request.client.host if request.client else None
    try:
        ticket = await _receive_itsm_webhook(request, db, raw_body, x_itsm_signature, x_hub_signature_256, x_itsm_timestamp)
    except HTTPException as exc:
        db.rollback()
        authenticated = bool(getattr(request.state, "itsm_authenticated", False))
        record_audit(db, "ITSM_WEBHOOK_REJECTED", "ticket", after={
            "http_status": exc.status_code, "reason": str(exc.detail)[:300], "source_ip": source_ip,
            "authenticated": authenticated, **body_evidence(raw_body, record_body=authenticated)})
        if not authenticated and exc.status_code == status.HTTP_401_UNAUTHORIZED:
            _raise_forged_webhook_alert(db, str(exc.detail)[:120], source_ip)
        db.commit()
        raise
    record_audit(db, "ITSM_WEBHOOK_ACCEPTED", "ticket", ticket.id, after={
        "ticket_ref": ticket.ticket_ref, "source_ip": source_ip, "status": ticket.status,
        **body_evidence(raw_body, record_body=True)})
    db.commit()
    db.refresh(ticket)
    return ticket


async def _receive_itsm_webhook(
    request: Request,
    db: Session,
    raw_body: bytes,
    x_itsm_signature: Optional[str],
    x_hub_signature_256: Optional[str],
    x_itsm_timestamp: Optional[str],
) -> ChangeTicket:
    """
    Inbound webhook receiver for external ITSM platforms (ServiceNow, Jira Service Management).
    
    Security & Reliability Invariants:
    1. Authenticates all requests using HMAC-SHA256 signature verification over the raw body bytes. With a timestamp
       (X-ITSM-Timestamp, epoch seconds) the signed message is "<timestamp>.<body>" and a delivery outside the tolerance
       window is refused, so a captured delivery cannot be replayed later (it would re-open a ticket closed in the ITSM).
       ITSM_REQUIRE_TIMESTAMP makes the timestamp mandatory (default in production).
    2. Uses constant-time comparison (hmac.compare_digest) to eliminate timing side-channel attacks.
    3. Operates before JSON deserialization so malformed payloads cannot trigger side effects.
    4. Supports idempotent ticket ingestion: updating active windows or status for existing external_ref.
    """
    # 1. HMAC signature verification
    sig_header = x_itsm_signature or x_hub_signature_256
    if not sig_header:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing HMAC signature header (X-ITSM-Signature or X-Hub-Signature-256)",
        )

    signed = raw_body
    if x_itsm_timestamp is not None:
        try:
            sent_at = int(x_itsm_timestamp.strip())
        except ValueError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid X-ITSM-Timestamp")
        if abs(time.time() - sent_at) > settings.ITSM_TIMESTAMP_TOLERANCE_SECONDS:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Stale or future X-ITSM-Timestamp: delivery refused")
        signed = f"{sent_at}.".encode("utf-8") + raw_body
    elif settings.ITSM_REQUIRE_TIMESTAMP:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing X-ITSM-Timestamp header")

    expected_sig = hmac.new(
        settings.ITSM_WEBHOOK_SECRET.encode("utf-8"),
        signed,
        hashlib.sha256,
    ).hexdigest()

    provided_sig = sig_header.strip()
    if provided_sig.lower().startswith("sha256="):
        provided_sig = provided_sig[7:].strip()

    if not hmac.compare_digest(expected_sig.lower(), provided_sig.lower()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid HMAC signature",
        )
    request.state.itsm_authenticated = True

    # 2. Parse payload
    try:
        data = json.loads(raw_body.decode("utf-8"))
        payload = ITSMWebhookPayload(**data)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Malformed ITSM webhook payload: {e}",
        )

    if payload.valid_from > payload.valid_to:
        raise HTTPException(status_code=400, detail="valid_from must be before valid_to")

    # 3. Resolve device / device_group
    device_id = payload.device_id
    device_group_id = payload.device_group_id

    if payload.hostname and not device_id:
        dev = db.query(Device).filter(Device.hostname == payload.hostname).first()
        if dev:
            device_id = dev.id
            if not device_group_id:
                device_group_id = dev.device_group_id
    elif payload.ip_address and not device_id:
        dev = db.query(Device).filter(Device.ip_address == payload.ip_address).first()
        if dev:
            device_id = dev.id
            if not device_group_id:
                device_group_id = dev.device_group_id

    if payload.group_name and not device_group_id:
        grp = db.query(DeviceGroup).filter(DeviceGroup.name == payload.group_name).first()
        if grp:
            device_group_id = grp.id

    # A ticket that names a device or group that does not exist, or names none, must never become a ticket for everything
    named = bool(payload.hostname or payload.ip_address or payload.device_id or payload.group_name or payload.device_group_id)
    if not device_id and not device_group_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "The ticket does not resolve to a known device or device group; refusing to store it with campus-wide scope"
                if named else "The ticket must name a device or a device group"
            ),
        )
    if (payload.hostname or payload.ip_address) and not payload.device_id and not device_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown device in ticket")

    effective_ref = payload.ticket_ref or payload.external_ref
    effective_source = payload.source or "external"

    # 4. Idempotency: Check if ticket already exists by (external_ref, source) or ticket_ref
    ticket = (
        db.query(ChangeTicket)
        .filter(
            ChangeTicket.external_ref == payload.external_ref,
            ChangeTicket.source == effective_source,
        )
        .first()
    )
    if not ticket:
        ticket = db.query(ChangeTicket).filter(ChangeTicket.ticket_ref == effective_ref).first()
        if ticket and ticket.source != effective_source and ticket.external_ref != payload.external_ref:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Ticket reference '{effective_ref}' already belongs to another source; refusing to overwrite it",
            )

    def apply_update(existing: ChangeTicket) -> ChangeTicket:
        existing.external_ref = payload.external_ref
        existing.source = effective_source
        existing.key_path_scope = payload.key_path_scope
        existing.valid_from = payload.valid_from
        existing.valid_to = payload.valid_to
        existing.status = payload.status.upper()
        if device_id:
            existing.device_id = device_id
        if device_group_id:
            existing.device_group_id = device_group_id
        db.commit()
        db.refresh(existing)
        return existing

    if ticket:
        # Update existing ticket (idempotent update)
        return apply_update(ticket)

    # Create new ticket
    ticket = ChangeTicket(
        ticket_ref=effective_ref,
        external_ref=payload.external_ref,
        source=effective_source,
        device_id=device_id,
        device_group_id=device_group_id,
        key_path_scope=payload.key_path_scope,
        valid_from=payload.valid_from,
        valid_to=payload.valid_to,
        status=payload.status.upper(),
    )
    db.add(ticket)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent delivery of the same ticket won the race (ticket_ref is unique): treat as a re-delivery
        db.rollback()
        winner = (
            db.query(ChangeTicket)
            .filter(
                (ChangeTicket.external_ref == payload.external_ref) & (ChangeTicket.source == effective_source)
                | (ChangeTicket.ticket_ref == effective_ref)
            )
            .first()
        )
        if not winner:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Conflicting concurrent ticket delivery; retry")
        return apply_update(winner)
    db.refresh(ticket)
    return ticket
