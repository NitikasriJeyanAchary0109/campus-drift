"""
Audit Log API Router
--------------------
Provides Admin-only endpoint for querying the immutable audit trail per §9 and §13.
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.rbac import require_admin
from app.models.audit import AuditLog
from app.models.users import User
from app.schemas.audit import AuditLogOut

router = APIRouter(prefix="/audit", tags=["Audit"])


@router.get("", response_model=List[AuditLogOut])
def api_list_audit_logs(
    user_id: Optional[UUID] = Query(None, description="Filter by user ID"),
    action: Optional[str] = Query(None, description="Filter by action name"),
    target_type: Optional[str] = Query(None, description="Filter by target type (e.g. device, baseline, remediation)"),
    target_id: Optional[UUID] = Query(None, description="Filter by target resource UUID"),
    from_date: Optional[datetime] = Query(None, description="Filter by start timestamp (inclusive)"),
    to_date: Optional[datetime] = Query(None, description="Filter by end timestamp (inclusive)"),
    limit: int = Query(50, ge=1, le=500),
    skip: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Query the immutable system audit trail with multi-field filtering.
    Role: Admin only (§9)
    """
    query = db.query(AuditLog).options(joinedload(AuditLog.user))

    if user_id:
        query = query.filter(AuditLog.user_id == user_id)
    if action:
        query = query.filter(AuditLog.action == action)
    if target_type:
        query = query.filter(AuditLog.target_type == target_type)
    if target_id:
        query = query.filter(AuditLog.target_id == target_id)
    if from_date:
        query = query.filter(AuditLog.timestamp >= from_date)
    if to_date:
        query = query.filter(AuditLog.timestamp <= to_date)

    logs = query.order_by(AuditLog.timestamp.desc()).offset(skip).limit(limit).all()

    result: List[AuditLogOut] = []
    for log in logs:
        result.append(
            AuditLogOut(
                id=log.id,
                user_id=log.user_id,
                username=log.user.username if log.user else None,
                action=log.action,
                target_type=log.target_type,
                target_id=log.target_id,
                before_state=log.before_state,
                after_state=log.after_state,
                timestamp=log.timestamp,
            )
        )
    return result
