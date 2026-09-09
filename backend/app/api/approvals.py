"""
Approvals API Router
--------------------
Exposes endpoints for listing pending remediation approvals and submitting
review decisions (APPROVED / REJECTED) per §9 and §13.
"""
from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.rbac import require_neteng
from app.models.users import User
from app.schemas.remediation import ApprovalCreate, ApprovalOut, RemediationPlanOut
from app.services.remediation import submit_approval, list_pending_approvals

router = APIRouter(prefix="/approvals", tags=["Approvals"])


@router.get("/pending", response_model=List[RemediationPlanOut])
def api_list_pending_approvals(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_neteng),
):
    """
    List all remediation plans awaiting review (status=PENDING).
    Role: Admin / NetworkEngineer
    """
    plans = list_pending_approvals(db)
    result = []
    for plan in plans:
        device = plan.drift_event.device if plan.drift_event else None
        result.append(
            RemediationPlanOut(
                id=plan.id,
                drift_event_id=plan.drift_event_id,
                device_id=device.id if device else None,
                device_hostname=device.hostname if device else None,
                proposed_commands=plan.proposed_commands,
                status=plan.status,
                created_at=plan.created_at,
                approval=plan.approval,
            )
        )
    return result


@router.post("/{plan_id}", response_model=ApprovalOut, status_code=status.HTTP_201_CREATED)
def api_submit_approval(
    plan_id: UUID,
    body: ApprovalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_neteng),
):
    """
    Submit an engineering review decision (APPROVED or REJECTED) for a plan.
    Role: Admin / NetworkEngineer
    """
    approval = submit_approval(
        db=db,
        plan_id=plan_id,
        decision=body.decision,
        comment=body.comment,
        user=current_user,
    )
    return ApprovalOut(
        id=approval.id,
        remediation_plan_id=approval.remediation_plan_id,
        approved_by=approval.approved_by,
        approver_username=current_user.username,
        decision=approval.decision,
        comment=approval.comment,
        decided_at=approval.decided_at,
    )
