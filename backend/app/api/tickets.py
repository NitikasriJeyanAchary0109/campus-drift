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
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.rbac import require_neteng, require_viewer
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
    db.commit()
    db.refresh(ticket)
    return ticket


@router.post("/webhook", response_model=ChangeTicketOut)
async def itsm_webhook(
    request: Request,
    db: Session = Depends(get_db),
    x_itsm_signature: Optional[str] = Header(None, alias="X-ITSM-Signature"),
    x_hub_signature_256: Optional[str] = Header(None, alias="X-Hub-Signature-256"),
):
    """
    Inbound webhook receiver for external ITSM platforms (ServiceNow, Jira Service Management).
    Authenticates requests using HMAC-SHA256 signature verification over raw request body.
    Supports idempotent creation and update of change tickets.
    """
    raw_body = await request.body()

    # 1. HMAC signature verification
    sig_header = x_itsm_signature or x_hub_signature_256
    if not sig_header:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing HMAC signature header (X-ITSM-Signature or X-Hub-Signature-256)",
        )

    expected_sig = hmac.new(
        settings.ITSM_WEBHOOK_SECRET.encode("utf-8"),
        raw_body,
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

    if ticket:
        # Update existing ticket (idempotent update)
        ticket.external_ref = payload.external_ref
        ticket.source = effective_source
        ticket.key_path_scope = payload.key_path_scope
        ticket.valid_from = payload.valid_from
        ticket.valid_to = payload.valid_to
        ticket.status = payload.status.upper()
        if device_id:
            ticket.device_id = device_id
        if device_group_id:
            ticket.device_group_id = device_group_id
        db.commit()
        db.refresh(ticket)
        return ticket

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
    db.commit()
    db.refresh(ticket)
    return ticket
