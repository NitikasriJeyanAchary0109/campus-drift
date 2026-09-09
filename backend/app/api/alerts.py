"""
Alerts API Router
-----------------
Provides endpoints for querying and acknowledging system alerts per §9 and §14.
"""
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.rbac import require_viewer, require_neteng
from app.models.alerts import Alert
from app.models.audit import AuditLog
from app.models.users import User
from app.schemas.alerts import AlertOut, AlertAckResponse

router = APIRouter(prefix="/alerts", tags=["Alerts"])


@router.get("", response_model=List[AlertOut])
def api_list_alerts(
    type: Optional[str] = Query(None, description="Filter by alert type (e.g. CRITICAL_DRIFT, DEVICE_DOWN)"),
    acknowledged: Optional[bool] = Query(None, description="Filter by acknowledgement state"),
    limit: int = Query(50, ge=1, le=500),
    skip: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer),
):
    """
    List alerts with optional filtering by type and acknowledgement status.
    Role: Viewer+
    """
    query = db.query(Alert)
    if type:
        query = query.filter(Alert.type == type)
    if acknowledged is not None:
        query = query.filter(Alert.acknowledged == acknowledged)

    alerts = query.order_by(Alert.created_at.desc()).offset(skip).limit(limit).all()
    return alerts


@router.post("/{alert_id}/ack", response_model=AlertAckResponse)
def api_acknowledge_alert(
    alert_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_neteng),
):
    """
    Acknowledge an alert.
    Role: NetEng+
    """
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert {alert_id} not found",
        )

    alert.acknowledged = True

    audit = AuditLog(
        user_id=current_user.id,
        action="ALERT_ACKNOWLEDGED",
        target_type="alert",
        target_id=alert.id,
        after_state={
            "alert_id": str(alert.id),
            "type": alert.type,
            "acknowledged": True,
            "acknowledged_by": current_user.username,
        },
    )
    db.add(audit)
    db.commit()
    db.refresh(alert)

    return AlertAckResponse(
        message="Alert acknowledged successfully",
        alert=alert,
    )
