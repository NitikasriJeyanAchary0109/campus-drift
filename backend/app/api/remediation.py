"""
Remediation API Router
----------------------
Exposes endpoints for generating remediation plans, previewing commands,
applying approved plans with automatic rollback, and triggering manual rollback per §9.
"""
from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.rbac import require_neteng, require_admin
from app.models.remediation import RemediationPlan
from app.models.users import User
from app.schemas.remediation import (
    RemediationPlanOut,
    RemediationActionOut,
    ApprovalOut,
    ApplyRemediationResponse,
    RollbackResponse,
)
from app.services.remediation import (
    generate_remediation_plan,
    get_remediation_plan,
    apply_remediation_plan,
    manual_rollback,
)

router = APIRouter(prefix="/remediation", tags=["Remediation"])


def _format_plan_out(plan: RemediationPlan) -> RemediationPlanOut:
    device = plan.drift_event.device if plan.drift_event else None
    approval_out = None
    if plan.approval:
        approval_out = ApprovalOut(
            id=plan.approval.id,
            remediation_plan_id=plan.approval.remediation_plan_id,
            approved_by=plan.approval.approved_by,
            approver_username=plan.approval.approver.username if plan.approval.approver else None,
            decision=plan.approval.decision,
            comment=plan.approval.comment,
            decided_at=plan.approval.decided_at,
        )
    actions_out = [
        RemediationActionOut(
            id=a.id,
            remediation_plan_id=a.remediation_plan_id,
            executed_commands=a.executed_commands,
            result=a.result,
            verification_snapshot_id=a.verification_snapshot_id,
            executed_at=a.executed_at,
        )
        for a in plan.actions
    ] if plan.actions else []

    return RemediationPlanOut(
        id=plan.id,
        drift_event_id=plan.drift_event_id,
        device_id=device.id if device else None,
        device_hostname=device.hostname if device else None,
        proposed_commands=plan.proposed_commands,
        status=plan.status,
        created_at=plan.created_at,
        approval=approval_out,
        actions=actions_out,
    )


@router.post("/{drift_id}/generate-plan", response_model=RemediationPlanOut, status_code=status.HTTP_201_CREATED)
def api_generate_plan(
    drift_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_neteng),
):
    """
    Generate a proposed remediation plan for a drift event using whitelisted Jinja2 templates.
    Never accepts free-text CLI. Role: NetEng+
    """
    plan = generate_remediation_plan(db, drift_id, current_user.id)
    return _format_plan_out(plan)


@router.get("/plans", response_model=List[RemediationPlanOut])
def api_list_plans(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_neteng),
):
    """
    List all remediation plans.
    Role: NetEng+
    """
    plans = db.query(RemediationPlan).order_by(RemediationPlan.created_at.desc()).all()
    return [_format_plan_out(p) for p in plans]


@router.get("/{plan_id}", response_model=RemediationPlanOut)
def api_get_plan(
    plan_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_neteng),
):
    """
    Preview proposed remediation commands and approval status.
    Role: NetEng+
    """
    plan = get_remediation_plan(db, plan_id)
    return _format_plan_out(plan)


@router.post("/{plan_id}/apply", response_model=ApplyRemediationResponse)
def api_apply_plan(
    plan_id: UUID,
    force_fail: bool = Query(False, description="Internal test parameter to simulate verification failure"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_neteng),
):
    """
    Execute Backup -> Apply -> Verify pipeline.
    Requires prior Approval record with decision=APPROVED (enforced at service layer).
    Triggers automatic rollback if verification fails.
    Role: NetEng+
    """
    action = apply_remediation_plan(
        db=db,
        plan_id=plan_id,
        user_id=current_user.id,
        force_fail_verification=force_fail,
    )
    passed = action.result == "SUCCESS"
    msg = "Remediation applied and verified successfully." if passed else "Verification failed: automated rollback executed."
    return ApplyRemediationResponse(
        message=msg,
        action_id=action.id,
        remediation_plan_id=action.remediation_plan_id,
        result=action.result,
        executed_commands=action.executed_commands,
        verification_passed=passed,
        details={"result": action.result, "executed_at": action.executed_at.isoformat()},
    )


@router.post("/{plan_id}/rollback", response_model=RollbackResponse)
def api_manual_rollback(
    plan_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Manually roll back a device to its pre-change backup configuration.
    Role: Admin only
    """
    action = manual_rollback(db, plan_id, current_user)
    return RollbackResponse(
        message=f"Manual rollback executed with result: {action.result}",
        action_id=action.id,
        result=action.result,
        details={"plan_id": str(plan_id), "executed_at": action.executed_at.isoformat()},
    )
