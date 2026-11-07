"""
Celery tasks that run a remediation operation (Backup -> Apply -> Verify -> auto-rollback, or a manual rollback) on a worker.

The SSH push can take a while and must not hold an API worker. The service layer keeps every guard (approval gate, one apply per plan,
one operation per device), so the task simply calls it and turns the outcome into a plain dict the API can return or a client can poll.
"""
import logging
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import HTTPException

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.models.users import User
from app.core.config import settings
from app.services.remediation import apply_remediation_plan, manual_rollback, retry_failed_rollback

logger = logging.getLogger(__name__)


def _failure(exc: HTTPException) -> Dict[str, Any]:
    return {"ok": False, "http_status": exc.status_code, "detail": exc.detail}


def run_operation(operation: str, plan_id: str, user_id: str, force_fail: bool = False, session_factory=None) -> Dict[str, Any]:
    """Execute one operation and return {"ok": True, ...} or {"ok": False, "http_status", "detail"}. Never raises HTTPException."""
    factory = session_factory or SessionLocal
    db = factory()
    try:
        if operation == "apply":
            action = apply_remediation_plan(db=db, plan_id=UUID(plan_id), user_id=UUID(user_id), force_fail_verification=force_fail)
        elif operation == "rollback":
            user: Optional[User] = db.query(User).filter(User.id == UUID(user_id)).first()
            if user is None:
                return {"ok": False, "http_status": 403, "detail": "User not found"}
            action = manual_rollback(db, UUID(plan_id), user)
        else:
            return {"ok": False, "http_status": 400, "detail": f"Unknown operation '{operation}'"}
        return {
            "ok": True,
            "operation": operation,
            "plan_id": plan_id,
            "action_id": str(action.id),
            "result": action.result,
            "executed_commands": list(action.executed_commands or []),
            "executed_at": action.executed_at.isoformat() if action.executed_at else None,
        }
    except HTTPException as exc:
        logger.info("Remediation %s for plan %s refused: %s", operation, plan_id, exc.detail)
        return _failure(exc)
    except Exception as exc:  # the worker must always leave a result a client can read
        logger.exception("Remediation %s for plan %s crashed", operation, plan_id)
        return {"ok": False, "http_status": 500, "detail": f"Unexpected error: {exc}"}
    finally:
        db.close()


@celery_app.task(name="app.tasks.remediation.apply_plan_task")
def apply_plan_task(plan_id: str, user_id: str, force_fail: bool = False) -> Dict[str, Any]:
    return run_operation("apply", plan_id, user_id, force_fail)


@celery_app.task(name="app.tasks.remediation.rollback_plan_task")
def rollback_plan_task(plan_id: str, user_id: str) -> Dict[str, Any]:
    return run_operation("rollback", plan_id, user_id)


@celery_app.task(name="app.tasks.remediation.retry_rollback_task")
def retry_rollback_task(plan_id: str, attempt: int = 1) -> Dict[str, Any]:
    """Try again, later, to restore a device whose rollback could not be verified; stops after ROLLBACK_AUTO_RETRIES attempts."""
    db = SessionLocal()
    try:
        outcome, detail = retry_failed_rollback(db, UUID(plan_id), attempt)
    except Exception as exc:
        logger.exception("Rollback retry for plan %s crashed", plan_id)
        outcome, detail = "still_failed", f"{type(exc).__name__}: {exc}"
    finally:
        db.close()
    if outcome == "still_failed" and attempt < settings.ROLLBACK_AUTO_RETRIES:
        retry_rollback_task.apply_async(args=[plan_id, attempt + 1], countdown=settings.ROLLBACK_AUTO_RETRY_DELAY_SECONDS * (attempt + 1))
    return {"plan_id": plan_id, "attempt": attempt, "outcome": outcome, "detail": detail}
