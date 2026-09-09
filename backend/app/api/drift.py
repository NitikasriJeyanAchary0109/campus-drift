"""
Drift API Router
----------------
Exposes endpoints for listing drift events, retrieving evidence bundles,
and marking false positives with mandatory comments per §9 and §12 of architecture.md:
- GET /api/drift (Viewer+)
- GET /api/drift/{id} (Viewer+)
- POST /api/drift/{id}/mark-false-positive (NetEng+)
"""
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.rbac import require_neteng, require_viewer
from app.models.drift import DriftEvent, DriftDetail
from app.models.audit import AuditLog
from app.models.users import User
from app.schemas.drift import (
    DriftEventOut,
    DriftEventDetailOut,
    DriftDetailOut,
    MarkFalsePositiveRequest,
    MarkFalsePositiveResponse,
)
from app.services.drift import build_evidence_bundle

router = APIRouter(prefix="/drift", tags=["Drift"])


@router.get("", response_model=List[DriftEventOut])
def list_drift_events(
    label: Optional[str] = Query(None, description="Filter by drift label"),
    min_score: Optional[int] = Query(None, description="Filter by minimum risk score"),
    device_id: Optional[UUID] = Query(None, description="Filter by device UUID"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status (OPEN/ACK/RESOLVED/FALSE_POSITIVE)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer),
):
    """
    List drift events with filtering by label, risk score, device, or status.
    Role: Viewer+
    """
    query = db.query(DriftEvent)
    if label:
        query = query.filter(DriftEvent.label.ilike(f"%{label}%"))
    if min_score is not None:
        query = query.filter(DriftEvent.risk_score >= min_score)
    if device_id:
        query = query.filter(DriftEvent.device_id == device_id)
    if status_filter:
        query = query.filter(DriftEvent.status == status_filter.upper())

    events = query.order_by(DriftEvent.detected_at.desc()).all()

    result = []
    for ev in events:
        out = DriftEventOut(
            id=ev.id,
            device_id=ev.device_id,
            device_hostname=ev.device.hostname if ev.device else None,
            snapshot_id=ev.snapshot_id,
            baseline_id=ev.baseline_id,
            label=ev.label,
            risk_score=ev.risk_score,
            underlying_severity=ev.underlying_severity,
            matched_ticket_id=ev.matched_ticket_id,
            matched_ticket_ref=ev.matched_ticket.ticket_ref if ev.matched_ticket else None,
            status=ev.status,
            detected_at=ev.detected_at,
            details_count=len(ev.details),
        )
        result.append(out)

    return result


@router.get("/{drift_id}", response_model=DriftEventDetailOut)
def get_drift_event(
    drift_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer),
):
    """
    Retrieve full drift event details along with complete evidence bundle.
    Role: Viewer+
    """
    event = db.query(DriftEvent).filter(DriftEvent.id == drift_id).first()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Drift event with ID {drift_id} not found",
        )

    evidence_bundle = build_evidence_bundle(db, event)

    return DriftEventDetailOut(
        id=event.id,
        device_id=event.device_id,
        device_hostname=event.device.hostname if event.device else None,
        snapshot_id=event.snapshot_id,
        baseline_id=event.baseline_id,
        label=event.label,
        risk_score=event.risk_score,
        underlying_severity=event.underlying_severity,
        matched_ticket_id=event.matched_ticket_id,
        matched_ticket_ref=event.matched_ticket.ticket_ref if event.matched_ticket else None,
        status=event.status,
        detected_at=event.detected_at,
        details_count=len(event.details),
        details=evidence_bundle.details,
        evidence_bundle=evidence_bundle,
    )


@router.post("/{drift_id}/mark-false-positive", response_model=MarkFalsePositiveResponse)
def mark_false_positive(
    drift_id: UUID,
    body: MarkFalsePositiveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_neteng),
):
    """
    Mark a drift event as FALSE_POSITIVE with a mandatory explanation comment.
    Role: NetEng+
    """
    event = db.query(DriftEvent).filter(DriftEvent.id == drift_id).first()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Drift event with ID {drift_id} not found",
        )

    comment = body.comment.strip()
    if not comment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mandatory comment explaining why this drift event is a false positive is required",
        )

    previous_status = event.status
    event.status = "FALSE_POSITIVE"

    # Audit log the decision
    audit = AuditLog(
        user_id=current_user.id,
        action="MARK_FALSE_POSITIVE",
        target_type="drift_event",
        target_id=event.id,
        before_state={"status": previous_status},
        after_state={"status": "FALSE_POSITIVE", "comment": comment},
    )
    db.add(audit)
    db.commit()

    return MarkFalsePositiveResponse(
        message=f"Drift event {drift_id} marked as FALSE_POSITIVE",
        event_id=event.id,
        status="FALSE_POSITIVE",
        comment=comment,
    )
