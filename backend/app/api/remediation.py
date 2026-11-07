"""
Remediation API Router
----------------------
Exposes endpoints for generating remediation plans, previewing commands,
applying approved plans with automatic rollback, and triggering manual rollback per §9.
"""
from uuid import UUID
from typing import List, Optional
from typing import Any, Dict, Union
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session, joinedload

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.database import get_db
from app.core.rbac import require_neteng, require_admin
from app.models.drift import DriftEvent
from app.models.remediation import RemediationPlan
from app.models.users import User
from app.schemas.remediation import (
    RemediationPlanOut,
    RemediationActionOut,
    ApplyRemediationResponse,
    RollbackResponse,
    QueuedRemediationResponse,
    JobStatusOut,
)
from app.models.remediation import Approval
from app.services.remediation import (
    generate_remediation_plan,
    get_remediation_plan,
    apply_remediation_plan,
    manual_rollback,
)
from app.tasks.remediation import apply_plan_task, rollback_plan_task

router = APIRouter(prefix="/remediation", tags=["Remediation"])


@router.get("", response_model=List[RemediationPlanOut])
def api_list_plans(
    status: Optional[str] = Query(None, description="Filter by plan status: PENDING, APPROVED, REJECTED, APPLIED"),
    device_id: Optional[UUID] = Query(None, description="Filter by device ID"),
    limit: int = Query(50, ge=1, le=500),
    skip: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_neteng),
):
    """
    List remediation plans with optional status and device filtering.
    Role: NetEng+
    """
    query = db.query(RemediationPlan).options(
        joinedload(RemediationPlan.drift_event).joinedload(DriftEvent.device),
        joinedload(RemediationPlan.approval),
        joinedload(RemediationPlan.actions),
    )
    if status:
        query = query.filter(RemediationPlan.status == status)
    if device_id:
        query = query.join(DriftEvent).filter(DriftEvent.device_id == device_id)
    plans = query.order_by(RemediationPlan.created_at.desc()).offset(skip).limit(limit).all()

    result = []
    for plan in plans:
        device = plan.drift_event.device if plan.drift_event else None
        result.append(
            RemediationPlanOut(
                id=plan.id,
                drift_event_id=plan.drift_event_id,
                device_id=device.id if device else None,
                device_hostname=device.hostname if device else None,
                drift_label=plan.drift_event.label if plan.drift_event else None,
                risk_score=plan.drift_event.risk_score if plan.drift_event else None,
                violated_paths=plan.violated_paths,
                proposed_commands=plan.proposed_commands,
                status=plan.status,
                created_at=plan.created_at,
                created_by=plan.created_by,
                created_by_username=plan.author_username,
                approval=plan.approval,
                actions=plan.actions or [],
            )
        )
    return result


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
    device = plan.drift_event.device if plan.drift_event else None
    return RemediationPlanOut(
        id=plan.id,
        drift_event_id=plan.drift_event_id,
        device_id=device.id if device else None,
        device_hostname=device.hostname if device else None,
        drift_label=plan.drift_event.label if plan.drift_event else None,
        risk_score=plan.drift_event.risk_score if plan.drift_event else None,
        violated_paths=plan.violated_paths,
        proposed_commands=plan.proposed_commands,
        status=plan.status,
        created_at=plan.created_at,
        created_by=plan.created_by,
        created_by_username=plan.author_username,
        approval=None,
        actions=[],
    )


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
    device = plan.drift_event.device if plan.drift_event else None
    return RemediationPlanOut(
        id=plan.id,
        drift_event_id=plan.drift_event_id,
        device_id=device.id if device else None,
        device_hostname=device.hostname if device else None,
        drift_label=plan.drift_event.label if plan.drift_event else None,
        risk_score=plan.drift_event.risk_score if plan.drift_event else None,
        violated_paths=plan.violated_paths,
        proposed_commands=plan.proposed_commands,
        status=plan.status,
        created_at=plan.created_at,
        created_by=plan.created_by,
        created_by_username=plan.author_username,
        approval=plan.approval,
        actions=plan.actions or [],
    )


def _apply_message(result: str) -> str:
    if result == "SUCCESS":
        return "Remediation applied and verified successfully."
    if result == "ROLLBACK_FAILED":
        return "CRITICAL: verification failed and the automated rollback could NOT be verified. Device state is unknown: restore the pre-change backup manually."
    return "Verification failed: automated rollback executed and verified against the pre-change backup."


def _raise_if_refused(outcome: Dict[str, Any]) -> None:
    if not outcome.get("ok"):
        raise HTTPException(status_code=outcome.get("http_status", 500), detail=outcome.get("detail", "Operation failed"))


def _queued(response: Response, async_result: Any, plan_id: UUID, what: str) -> QueuedRemediationResponse:
    response.status_code = status.HTTP_202_ACCEPTED
    return QueuedRemediationResponse(message=f"{what} queued. Poll the job for the result.", task_id=str(async_result.id), remediation_plan_id=plan_id)


@router.post("/{plan_id}/apply", response_model=Union[ApplyRemediationResponse, QueuedRemediationResponse])
def api_apply_plan(
    plan_id: UUID,
    response: Response,
    force_fail: bool = Query(False, description="Internal test parameter to simulate verification failure"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_neteng),
):
    """
    Execute Backup -> Apply -> Verify pipeline.
    Requires prior Approval record with decision=APPROVED (enforced at service layer).
    Triggers automatic rollback if verification fails.
    With REMEDIATION_USE_QUEUE (the production default) the work runs on the Celery worker: the call returns 202 and a task id,
    and GET /remediation/jobs/{task_id} reports the result. Without it the call runs inline and returns the result.
    Role: NetEng+
    """
    if settings.REMEDIATION_USE_QUEUE:
        get_remediation_plan(db, plan_id)  # 404 now rather than inside the worker
        approval = db.query(Approval).filter(Approval.remediation_plan_id == plan_id).first()
        if not approval or approval.decision != "APPROVED":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Remediation plan has not been approved. An Approval record with decision=APPROVED is required.")
        plan = get_remediation_plan(db, plan_id)
        if plan.created_by is not None and plan.created_by == current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Four-eyes rule: you drafted this remediation plan, so a different engineer or administrator must apply it.")
        job = apply_plan_task.delay(str(plan_id), str(current_user.id), force_fail)
        if not settings.CELERY_TASK_ALWAYS_EAGER:
            return _queued(response, job, plan_id, "Remediation")
        outcome = job.get()
        _raise_if_refused(outcome)
        passed = outcome["result"] == "SUCCESS"
        return ApplyRemediationResponse(
            message=_apply_message(outcome["result"]),
            action_id=outcome["action_id"],
            remediation_plan_id=plan_id,
            result=outcome["result"],
            executed_commands=outcome["executed_commands"],
            verification_passed=passed,
            details={"result": outcome["result"], "executed_at": outcome["executed_at"]},
        )
    action = apply_remediation_plan(
        db=db,
        plan_id=plan_id,
        user_id=current_user.id,
        force_fail_verification=force_fail,
    )
    passed = action.result == "SUCCESS"
    return ApplyRemediationResponse(
        message=_apply_message(action.result),
        action_id=action.id,
        remediation_plan_id=action.remediation_plan_id,
        result=action.result,
        executed_commands=action.executed_commands,
        verification_passed=passed,
        details={"result": action.result, "executed_at": action.executed_at.isoformat()},
    )


@router.get("/jobs/{task_id}", response_model=JobStatusOut)
def api_job_status(task_id: str, current_user: User = Depends(require_neteng)):
    """State and result of a queued remediation operation. Role: NetEng+."""
    res = celery_app.AsyncResult(task_id)
    finished = res.ready()
    result = res.result if finished and res.successful() and isinstance(res.result, dict) else None
    return JobStatusOut(task_id=task_id, state=res.state, finished=finished, result=result)


@router.post("/{plan_id}/rollback", response_model=Union[RollbackResponse, QueuedRemediationResponse])
def api_manual_rollback(
    plan_id: UUID,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Manually roll back a device to its pre-change backup configuration.
    Queued the same way as apply when REMEDIATION_USE_QUEUE is on.
    Role: Admin only
    """
    if settings.REMEDIATION_USE_QUEUE:
        get_remediation_plan(db, plan_id)
        job = rollback_plan_task.delay(str(plan_id), str(current_user.id))
        if not settings.CELERY_TASK_ALWAYS_EAGER:
            return _queued(response, job, plan_id, "Rollback")
        outcome = job.get()
        _raise_if_refused(outcome)
        return RollbackResponse(
            message=f"Manual rollback executed with result: {outcome['result']}",
            action_id=outcome["action_id"],
            result=outcome["result"],
            details={"plan_id": str(plan_id), "executed_at": outcome["executed_at"]},
        )
    action = manual_rollback(db, plan_id, current_user)
    return RollbackResponse(
        message=f"Manual rollback executed with result: {action.result}",
        action_id=action.id,
        result=action.result,
        details={"plan_id": str(plan_id), "executed_at": action.executed_at.isoformat()},
    )
