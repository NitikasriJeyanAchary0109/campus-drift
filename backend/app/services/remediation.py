"""
Remediation & Rollback Service
------------------------------
Implements the end-to-end Remediation and Rollback workflow per §6, §8, §9, §13, and §14:
1. Template-based remediation plan generation (zero user CLI).
2. Service-layer approval gate enforcement (409 Conflict if not approved).
3. Pre-change configuration backup creation.
4. Netmiko configuration push to network devices.
5. Post-change re-collection, normalization, and targeted key-path verification.
6. Automated rollback on verification failure: restores backup, re-verifies, raises CRITICAL alert, and logs audit.
7. Admin manual rollback trigger.
"""
import hashlib
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple, Any
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from netmiko import ConnectHandler
from app.core.ssh import ssh_security_params
from netmiko.exceptions import NetmikoBaseException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.alerts import Alert
from app.models.audit import AuditLog
from app.models.baselines import Baseline
from app.models.configurations import ConfigurationSnapshot
from app.models.devices import Device
from app.models.drift import DriftEvent, DriftDetail
from app.models.remediation import RemediationPlan, Approval, RemediationAction, Backup
from app.models.users import User
from app.services.collection import resolve_device_endpoint
from app.services.legacy import assert_remediation_allowed
from app.services.locks import device_lock
from app.services.normalization import normalize_config, resolve_key_path, values_equal
from app.services.remediation_templates import (
    render_remediation_commands,
    TemplateNotFoundError,
    SecurityViolationError,
    sanitize_rendered_commands,
)
from app.services.vault import get_device_credential


logger = logging.getLogger(__name__)


def commands_digest(commands: List[str]) -> str:
    """SHA-256 of the exact command list: what the approver saw is what may be sent."""
    return hashlib.sha256("\n".join(commands).encode("utf-8")).hexdigest()


def generate_remediation_plan(db: Session, drift_event_id: UUID, user_id: UUID) -> RemediationPlan:
    """
    Generate a proposed remediation plan from a drift event using ONLY whitelisted Jinja2 templates.
    
    Security Invariants & Error Boundaries (§13):
    1. Zero User-Supplied CLI: Engineers cannot type or modify CLI strings arbitrarily.
    2. Strict Template Isolation: Commands are synthesized solely via predefined templates
       matching the device vendor (e.g. Cisco IOS, FRR) and concrete drift key paths.
    3. Shell Metacharacter Protection: All interpolated parameter variables are strictly validated
       against regex `[;&|$\\`\\"]`. Violations raise SecurityViolationError -> HTTP 422.
    4. Gating State Machine: The generated plan is placed into PENDING state, awaiting dual-control
       review. It can never be applied until explicitly approved by an independent engineer/admin.
    """
    event = db.query(DriftEvent).filter(DriftEvent.id == drift_event_id).first()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Drift event {drift_event_id} not found",
        )

    if event.label in ["Compliant", "NO_BASELINE"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot generate remediation plan for event with label '{event.label}'",
        )

    device = event.device
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device associated with drift event not found",
        )

    live = (
        db.query(RemediationPlan)
        .filter(RemediationPlan.drift_event_id == event.id, RemediationPlan.status.in_(("PENDING", "APPROVED", "APPLYING")))
        .first()
    )
    if live is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This problem already has a {live.status.lower()} remediation plan ({live.id}). Decide on or apply that one first.",
        )

    proposed_commands: List[str] = []
    for detail in event.details:
        rule = detail.rule
        rule_type = rule.rule_type if rule else "EXACT"
        try:
            cmds = render_remediation_commands(
                vendor=device.vendor,
                rule_type=rule_type,
                key_path=detail.key_path,
                expected_value=detail.expected_value,
                actual_value=detail.actual_value,
            )
            for c in cmds:
                if c not in proposed_commands:
                    proposed_commands.append(c)
        except (TemplateNotFoundError, SecurityViolationError) as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Failed to generate template commands for '{detail.key_path}': {e}",
            ) from e

    if not proposed_commands:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No remediation commands could be generated from active baseline rules",
        )

    plan = RemediationPlan(
        drift_event_id=event.id,
        proposed_commands=proposed_commands,
        status="PENDING",
        created_at=datetime.now(timezone.utc),
        created_by=user_id,
    )
    db.add(plan)
    db.flush()

    # Audit log plan creation
    audit = AuditLog(
        user_id=user_id,
        action="PLAN_GENERATED",
        target_type="remediation",
        target_id=plan.id,
        after_state={
            "drift_event_id": str(event.id),
            "device": device.hostname,
            "proposed_commands": proposed_commands,
            "status": "PENDING",
        },
    )
    db.add(audit)
    db.commit()
    db.refresh(plan)
    return plan


def get_remediation_plan(db: Session, plan_id: UUID) -> RemediationPlan:
    """Retrieve remediation plan details."""
    plan = db.query(RemediationPlan).filter(RemediationPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Remediation plan {plan_id} not found",
        )
    return plan


def submit_approval(
    db: Session,
    plan_id: UUID,
    decision: str,
    comment: Optional[str],
    user: User,
) -> Approval:
    """
    Approve or reject a remediation plan. Role must be Admin or NetworkEngineer.
    """
    plan = get_remediation_plan(db, plan_id)

    if plan.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot submit approval for plan in status '{plan.status}' (must be PENDING)",
        )

    # Four-eyes rule: the author of a plan may reject (withdraw) it but never approve it
    if decision.upper() == "APPROVED" and plan.created_by is not None and plan.created_by == user.id:
        db.add(AuditLog(user_id=user.id, action="PLAN_SELF_APPROVAL_BLOCKED", target_type="remediation", target_id=plan.id,
                        after_state={"plan_id": str(plan.id), "user": user.username}))
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Four-eyes rule: you drafted this remediation plan, so a different engineer or administrator must approve it.",
        )

    # A plan with no recorded author (legacy rows) cannot prove who else is "a second person": only an Admin may approve it
    if decision.upper() == "APPROVED" and plan.created_by is None and not (user.role and user.role.name == "Admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This plan has no recorded author, so the four-eyes rule cannot be checked; an administrator must approve it.",
        )

    # Check for existing approval
    existing = db.query(Approval).filter(Approval.remediation_plan_id == plan.id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Approval decision already recorded for this plan",
        )

    now = datetime.now(timezone.utc)
    approval = Approval(
        id=uuid4(),
        remediation_plan_id=plan.id,
        approved_by=user.id,
        decision=decision.upper(),
        comment=comment,
        decided_at=now,
        commands_sha256=commands_digest(list(plan.proposed_commands or [])),
    )
    db.add(approval)

    plan.status = decision.upper()

    audit = AuditLog(
        user_id=user.id,
        action=f"PLAN_{decision.upper()}",
        target_type="approval",
        target_id=approval.id,
        after_state={
            "plan_id": str(plan.id),
            "decision": decision.upper(),
            "comment": comment,
            "approved_by": user.username,
        },
    )
    db.add(audit)
    db.commit()
    db.refresh(approval)
    return approval


def list_pending_approvals(db: Session) -> List[RemediationPlan]:
    """List all remediation plans awaiting engineering approval."""
    return (
        db.query(RemediationPlan)
        .filter(RemediationPlan.status == "PENDING")
        .order_by(RemediationPlan.created_at.desc())
        .all()
    )


def _connect_to_device(db: Session, device: Device):
    """Helper to establish Netmiko connection to a device using Vault credentials."""
    cred_tuple = get_device_credential(db, device.id)
    if not cred_tuple:
        raise ConnectionError(f"No credentials found for device {device.hostname}")
    username, secret, _ = cred_tuple
    host, port = resolve_device_endpoint(device)

    device_params = {
        "device_type": "cisco_ios",
        "host": host,
        "port": port,
        "username": username,
        "password": secret,
        "fast_cli": False,
        "timeout": 10,
        **ssh_security_params(),
    }
    return ConnectHandler(**device_params)


APPLY_STALE_AFTER = timedelta(minutes=15)   # an APPLYING claim older than this is considered abandoned (crashed worker)
ROLLBACK_RECONNECT_ATTEMPTS = 2             # fresh sessions tried if the original one is dead during a rollback
_PRE_CHANGE_ERRORS = (ConnectionError, TimeoutError, OSError, EOFError, NetmikoBaseException)


def _naive_utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


_VOLATILE_PREFIXES = (
    "building configuration", "current configuration", "version ", "end", "ntp clock-period", "boot-start-marker", "boot-end-marker",
    "using ", "! last configuration change", "! nvram config last updated", "! no configuration change since last restart",
)


def _config_pairs(config: str) -> List[Tuple[Optional[str], str]]:
    """
    The configuration as (parent, line) pairs: a top-level line has parent None, an indented line belongs to the last
    top-level line above it. Comments, blanks and volatile header lines are dropped. Order is kept.
    """
    pairs: List[Tuple[Optional[str], str]] = []
    parent: Optional[str] = None
    for raw in config.splitlines():
        text = raw.strip()
        if not text or text.startswith("!") or text.lower().startswith(_VOLATILE_PREFIXES):
            continue
        if raw[:1] in (" ", "\t"):
            pairs.append((parent, text))
        else:
            parent = text
            pairs.append((None, text))
    return pairs


def _significant_lines(config: str) -> List[str]:
    return [text for _, text in _config_pairs(config)]


def _configs_equivalent(current: str, backup: str, vendor: str) -> bool:
    """
    True when two running-configs mean the same thing: the normalized trees are equal AND every line, in its place in the
    hierarchy, is the same. The tree alone is not enough: it models only the settings the parser knows, so a rogue local
    user or an extra line outside the model would pass as "restored".
    """
    if set(_config_pairs(current)) != set(_config_pairs(backup)):
        return False
    try:
        return normalize_config(current, vendor) == normalize_config(backup, vendor)
    except Exception:
        return True   # unparsable text: the line-by-line comparison above already decided


def _negate(line: str) -> str:
    return line[3:] if line.lower().startswith("no ") else f"no {line}"


def _restore_commands(current: str, backup: str) -> List[str]:
    """
    The configuration commands that turn ``current`` back into ``backup``: negate what the change added (a plain replay of the
    backup cannot delete anything), then re-add what it removed. Child lines are sent inside their parent.
    """
    cur, bak = _config_pairs(current), _config_pairs(backup)
    cur_set, bak_set = set(cur), set(bak)
    removed_parents = {text for parent, text in cur if parent is None and (None, text) not in bak_set}
    commands: List[str] = []

    def emit(pairs: List[Tuple[Optional[str], str]], wanted: set, as_negation: bool) -> None:
        last_parent: Optional[str] = None
        for parent, text in pairs:
            if (parent, text) in wanted:
                continue
            if as_negation and parent is not None and parent in removed_parents:
                continue                                   # the whole block goes away with its parent
            line = _negate(text) if as_negation else text
            if parent is None:
                if last_parent is not None:
                    commands.append("exit")
                    last_parent = None
                commands.append(line)
            else:
                if parent != last_parent:
                    if last_parent is not None:
                        commands.append("exit")
                    commands.append(parent)
                    last_parent = parent
                commands.append(line)
        if last_parent is not None:
            commands.append("exit")

    emit(cur, bak_set, as_negation=True)
    emit(bak, cur_set, as_negation=False)
    return commands


def _execute_rollback(conn: Any, backup_config: str, vendor: str = "cisco_ios") -> None:
    """
    Push the stored pre-change configuration back to the device. Transport failures propagate:
    a rollback that did not run must never be reported as one that did.
    Lab simulators restore exactly through their reset command, which is only sent when ALLOW_TEST_HOOKS is on (never in
    production). Everywhere else the difference between the running configuration and the backup is computed and applied
    (negations for what the change added, re-adding what it removed). The caller verifies the result either way.
    """
    if settings.ALLOW_TEST_HOOKS:
        conn.send_command("simulator-reset-pristine")
        if _configs_equivalent(conn.send_command("show running-config"), backup_config, vendor):
            return  # already restored; replaying would only reorder lines
    current = conn.send_command("show running-config")
    if _configs_equivalent(current, backup_config, vendor):
        return
    commands = _restore_commands(current, backup_config)
    if commands:
        conn.send_config_set(commands)


def restore_and_verify(db: Session, device: Device, backup_config: str, conn: Any = None) -> Tuple[bool, str]:
    """
    Restore ``device`` to ``backup_config`` and prove it: re-read the running-config and compare it with the backup.
    The original session is tried first; if it is dead, fresh sessions are opened (a dropped SSH session is the
    most likely reason a remediation failed in the first place). Returns (verified, detail).
    """
    detail = "no rollback attempt was made"
    opened: List[Any] = []
    try:
        for attempt in range(1 + ROLLBACK_RECONNECT_ATTEMPTS):
            if attempt:
                time.sleep(settings.ROLLBACK_RETRY_DELAY_SECONDS * attempt)   # a device that just dropped needs a moment
            try:
                c = conn if (attempt == 0 and conn is not None) else None
                if c is None:
                    c = _connect_to_device(db, device)
                    opened.append(c)
                _execute_rollback(c, backup_config, device.vendor)
                current = c.send_command("show running-config")
                if _configs_equivalent(current, backup_config, device.vendor):
                    return True, f"restored and verified against the pre-change backup (attempt {attempt + 1})"
                detail = "device configuration still differs from the pre-change backup after the restore"
            except Exception as e:  # transport failure, dead session, refused connection ...
                detail = f"{type(e).__name__}: {e}"
        return False, detail
    finally:
        for c in opened:
            try:
                c.disconnect()
            except Exception:
                pass


def _read_running_config(conn: Any, attempts: int = 3) -> str:
    """Read the running config, retrying a timeout or dropped read a couple of times before giving up."""
    last: Optional[Exception] = None
    for attempt in range(attempts):
        if attempt:
            time.sleep(settings.ROLLBACK_RETRY_DELAY_SECONDS)
        try:
            text = conn.send_command("show running-config")
            if text and text.strip():
                return text
            last = RuntimeError("device returned an empty running-config")
        except Exception as e:  # a read timeout on a busy device
            last = e
    raise last if last else RuntimeError("could not read the running-config")


def _save_to_startup(conn: Any) -> bool:
    """Persist a verified change (write memory) so a reload does not undo it. Never fails the change itself."""
    if not settings.REMEDIATION_SAVE_CONFIG:
        return False
    try:
        out = conn.send_command("write memory") or ""
        return any(token in out.lower() for token in ("[ok]", "copy complete", "bytes copied"))
    except Exception as e:
        logger.warning("write memory failed: %s", e)
        return False


def _schedule_rollback_retry(plan_id: UUID) -> None:
    """Ask the worker to try the restore again later (a device that dropped off often comes back within minutes)."""
    from app.core.celery_app import celery_app
    if settings.ROLLBACK_AUTO_RETRIES <= 0 or celery_app.conf.task_always_eager:
        return
    try:
        from app.tasks.remediation import retry_rollback_task
        retry_rollback_task.apply_async(args=[str(plan_id), 1], countdown=settings.ROLLBACK_AUTO_RETRY_DELAY_SECONDS)
    except Exception as e:  # a missing broker must not turn an already-failed rollback into a crash
        logger.warning("could not schedule the rollback retry for plan %s: %s", plan_id, e)


def retry_failed_rollback(db: Session, plan_id: UUID, attempt: int) -> Tuple[str, str]:
    """One delayed retry of a restore that could not be verified. Returns (outcome, detail): restored, still_failed, skipped."""
    plan = db.query(RemediationPlan).filter(RemediationPlan.id == plan_id).first()
    if plan is None or plan.status != "ROLLBACK_FAILED":
        return "skipped", "the plan is no longer waiting for a rollback"
    device = plan.drift_event.device
    backup = (
        db.query(Backup).join(RemediationAction, Backup.taken_before_action_id == RemediationAction.id)
        .filter(RemediationAction.remediation_plan_id == plan.id).order_by(Backup.taken_at.desc()).first()
    )
    if backup is None:
        return "skipped", "no backup found"
    with device_lock(db, device.id) as acquired:
        if not acquired:
            return "still_failed", "device busy"
        verified, detail = restore_and_verify(db, device, backup.config_blob)
        if verified:
            plan.status = "ROLLED_BACK"
            plan.drift_event.status = "OPEN"
            db.add(AuditLog(user_id=None, action="AUTO_ROLLBACK_RETRY_SUCCEEDED", target_type="remediation", target_id=plan.id,
                            after_state={"plan_id": str(plan.id), "device": device.hostname, "backup_id": str(backup.id),
                                         "attempt": attempt, "rollback_detail": detail}))
            db.add(Alert(type="ROLLBACK_RECOVERED", related_id=plan.id,
                         message=f"{device.hostname} was restored from backup {backup.id} by an automatic retry (attempt {attempt})."))
            db.commit()
            return "restored", detail
        db.add(AuditLog(user_id=None, action="AUTO_ROLLBACK_RETRY_FAILED", target_type="remediation", target_id=plan.id,
                        after_state={"plan_id": str(plan.id), "device": device.hostname, "attempt": attempt, "rollback_detail": detail}))
        db.commit()
        return "still_failed", detail


def _claim_plan(db: Session, plan: RemediationPlan, user_id: UUID) -> str:
    """
    Atomically move the plan to APPLYING so two concurrent requests cannot push the same plan twice.
    Returns the previous status. An APPLYING claim older than APPLY_STALE_AFTER is treated as abandoned.
    """
    if plan.status == "APPLYING":
        stale = (
            db.query(RemediationAction)
            .filter(RemediationAction.remediation_plan_id == plan.id, RemediationAction.result == "IN_PROGRESS")
            .order_by(RemediationAction.executed_at.desc())
            .first()
        )
        age_ok = stale is not None and _naive_utc(datetime.now(timezone.utc)) - _naive_utc(stale.executed_at) > APPLY_STALE_AFTER
        if age_ok:
            stale.result = "ABORTED"
            plan.status = "FAILED"
            db.add(AuditLog(user_id=user_id, action="REMEDIATION_STALE_CLAIM_RELEASED", target_type="remediation",
                            target_id=stale.id, after_state={"plan_id": str(plan.id), "abandoned_action": str(stale.id)}))
            db.commit()
    previous = plan.status
    claimed = (
        db.query(RemediationPlan)
        .filter(RemediationPlan.id == plan.id, RemediationPlan.status.notin_(("APPLIED", "APPLYING")))
        .update({"status": "APPLYING"}, synchronize_session=False)
    )
    db.commit()
    if not claimed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Remediation plan is already being applied by another request.",
        )
    db.refresh(plan)
    return previous


def _finish_rollback(
    db: Session, plan: RemediationPlan, action: RemediationAction, device: Device, user_id: UUID,
    backup: Optional[Backup], verified: bool, detail: str, reason: str, extra: Optional[dict] = None,
    restore_seconds: Optional[float] = None,
) -> None:
    """Record the outcome of an automatic rollback: verified restore -> ROLLED_BACK, otherwise ROLLBACK_FAILED."""
    backup_id = str(backup.id) if backup else None
    is_verification = reason.startswith("verification")
    headline = (
        f"CRITICAL: Remediation verification failed on {device.hostname}"
        if is_verification else f"Remediation error on {device.hostname}: {reason.removeprefix('error during remediation: ')}"
    )
    paths = f" Failed paths: {extra['failed_paths']}" if extra and "failed_paths" in extra else ""
    within_target = restore_seconds is not None and restore_seconds <= settings.ROLLBACK_TARGET_SECONDS
    if restore_seconds is not None and not within_target:
        paths += f" The restore took {restore_seconds}s, over the {settings.ROLLBACK_TARGET_SECONDS}s target."
    if verified:
        action.result = "ROLLED_BACK"
        plan.status = "FAILED"
        message = f"{headline}. Automated rollback ran and was verified against the pre-change backup.{paths}"
        audit_action, outcome = "REMEDIATION_ROLLED_BACK", "SUCCESSFULLY_RESTORED_TO_BACKUP"
    else:
        action.result = "ROLLBACK_FAILED"
        plan.status = "ROLLBACK_FAILED"
        message = (f"CRITICAL: {headline}. The automated rollback could NOT be verified ({detail}). "
                   f"The device configuration state is UNKNOWN: restore it manually from backup {backup_id} on the console.{paths}")
        audit_action, outcome = "REMEDIATION_ROLLBACK_FAILED", "NOT_VERIFIED"
        _schedule_rollback_retry(plan.id)
    db.add(Alert(type="CRITICAL_DRIFT", related_id=action.id, message=message))
    db.add(AuditLog(
        user_id=user_id, action=audit_action, target_type="remediation", target_id=action.id,
        after_state={"plan_id": str(plan.id), "device": device.hostname,
                     "failure_reason": "Verification failed post-change" if is_verification else reason,
                     "rollback_result": outcome, "rollback_verified": verified, "rollback_detail": detail,
                     "backup_id": backup_id, "restore_seconds": restore_seconds,
                     "restore_target_seconds": settings.ROLLBACK_TARGET_SECONDS, "restore_within_target": within_target,
                     **(extra or {})},
    ))
    db.commit()


def apply_remediation_plan(
    db: Session,
    plan_id: UUID,
    user_id: UUID,
    force_fail_verification: bool = False,
) -> RemediationAction:
    """
    Execute the Backup, Apply, Verify, and Auto-Rollback pipeline per §6.

    Outcomes (RemediationAction.result / RemediationPlan.status):
      SUCCESS          change applied and verified                       / APPLIED
      ROLLED_BACK      change failed; restore verified against backup    / FAILED  (retry possible)
      ROLLBACK_FAILED  change failed and the restore could NOT be proven / ROLLBACK_FAILED (critical alert, manual fix)
      ABORTED          failed before any change was made (no session, empty backup) / FAILED (HTTP 502)
    Guards: approval gate (409), shadow/non-SSH devices (409), one apply per plan at a time (409),
    one operation per device at a time (409), empty running-config refused as a backup.
    """
    plan = get_remediation_plan(db, plan_id)

    # 1. Enforce Approval Gate at Service Layer (§6 & §13)
    approval = db.query(Approval).filter(Approval.remediation_plan_id == plan.id).first()
    if not approval or approval.decision != "APPROVED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Remediation plan has not been approved. An Approval record with decision=APPROVED is required.",
        )

    # Four-eyes covers execution as well as approval: the person who wrote the plan never applies it
    if plan.created_by is not None and plan.created_by == user_id:
        db.add(AuditLog(user_id=user_id, action="PLAN_SELF_APPLY_BLOCKED", target_type="remediation", target_id=plan.id,
                        after_state={"plan_id": str(plan.id)}))
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Four-eyes rule: you drafted this remediation plan, so a different engineer or administrator must apply it.",
        )

    # What was approved is what is sent: a plan whose commands changed after the decision is refused
    if approval.commands_sha256 and approval.commands_sha256 != commands_digest(list(plan.proposed_commands or [])):
        db.add(AuditLog(user_id=user_id, action="PLAN_COMMANDS_CHANGED_AFTER_APPROVAL", target_type="remediation", target_id=plan.id,
                        after_state={"plan_id": str(plan.id), "approved_sha256": approval.commands_sha256,
                                     "current_sha256": commands_digest(list(plan.proposed_commands or []))}))
        db.add(Alert(type="SECURITY_CHANGE", related_id=plan.id, message=f"Remediation plan {plan.id} was modified after it was approved; apply refused."))
        db.commit()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The commands of this plan changed after it was approved. It will not be applied; write and approve a new plan.")

    if force_fail_verification and not settings.ALLOW_TEST_HOOKS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="force_fail is a lab-only test hook and is disabled here.")

    if plan.status == "ROLLBACK_FAILED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The last rollback of this plan could not be verified, so the device state is unknown. "
                   "Restore it (manual rollback or the console) before applying again; a new backup now would capture the broken state.",
        )

    if plan.status == "APPLIED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Remediation plan has already been applied.",
        )

    event = plan.drift_event
    device = event.device

    # Legacy coexistence: never open a config session to shadow / non-SSH-managed devices
    assert_remediation_allowed(device)

    previous_status = _claim_plan(db, plan, user_id)
    try:
        with device_lock(db, device.id) as acquired:
            if not acquired:
                plan.status = previous_status
                db.commit()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Device {device.hostname} is busy (a poll or another remediation is running); retry shortly.",
                )
            return _apply_locked(db, plan, event, device, user_id, force_fail_verification)
    finally:
        db.rollback()  # never leave a failed transaction behind
        db.refresh(plan)
        if plan.status == "APPLYING":  # unexpected escape: do not leave the plan claimed forever
            plan.status = "FAILED"
            db.commit()


def _apply_locked(
    db: Session, plan: RemediationPlan, event: DriftEvent, device: Device, user_id: UUID, force_fail_verification: bool,
) -> RemediationAction:
    now = datetime.now(timezone.utc)
    action = RemediationAction(
        remediation_plan_id=plan.id,
        executed_commands=plan.proposed_commands,
        result="IN_PROGRESS",
        executed_at=now,
    )
    db.add(action)
    db.commit()  # visible to other sessions; also lets a crashed claim be detected as stale

    conn = None
    backup = None
    pre_change_config = ""
    change_started = False

    try:
        conn = _connect_to_device(db, device)

        # 2. Step (a) Pre-Change Backup (§6): refuse to touch a device without a usable backup
        pre_change_config = conn.send_command("show running-config")
        if not pre_change_config or not pre_change_config.strip():
            raise RuntimeError("device returned an empty running-config; refusing to change it without a usable backup")
        backup = Backup(
            device_id=device.id,
            config_blob=pre_change_config,
            taken_at=now,
            taken_before_action_id=action.id,
        )
        db.add(backup)
        db.commit()

        # 3. Step (b) Apply Approved Commands via Netmiko
        # The commands are checked once more here: nothing but whitelisted-template output, free of control characters
        commands = sanitize_rendered_commands(list(plan.proposed_commands or []))
        if not commands:
            raise RuntimeError("the plan holds no commands")

        change_started = True  # from here on the device may be partially changed
        conn.send_config_set(commands)

        # 4. Step (c) Re-pull Running Config for Verification (a passing SSH timeout is retried, not treated as a failed change)
        post_change_config = _read_running_config(conn)
        norm_post = normalize_config(post_change_config, device.vendor)

        # Save verification snapshot
        verification_snapshot = ConfigurationSnapshot(
            device_id=device.id,
            raw_config=post_change_config,
            normalized_json=norm_post,
            collected_at=_naive_utc(datetime.now(timezone.utc)),
            collection_method="SSH",
            status="SUCCESS",
        )
        db.add(verification_snapshot)
        db.flush()
        action.verification_snapshot_id = verification_snapshot.id

        # 5. Targeted Key-Path Verification
        verification_passed = not force_fail_verification
        failed_paths = []

        if verification_passed:
            for detail in event.details:
                rule = detail.rule
                if not rule:
                    continue
                actual_val = _lookup_json_path(norm_post, detail.key_path)
                if rule.rule_type == "EXACT":
                    if not values_equal(actual_val, rule.expected_value):
                        verification_passed = False
                        failed_paths.append((detail.key_path, rule.expected_value, actual_val))
                elif rule.rule_type == "MUST_NOT_EXIST":
                    if actual_val is not None and str(actual_val).lower() != "false":
                        verification_passed = False
                        failed_paths.append((detail.key_path, "MUST_NOT_EXIST", actual_val))
                elif rule.rule_type == "MUST_EXIST":
                    if actual_val is None or str(actual_val).lower() == "false":
                        verification_passed = False
                        failed_paths.append((detail.key_path, "MUST_EXIST", actual_val))

        # 6. Branch on Verification Result
        if verification_passed:
            saved = _save_to_startup(conn)
            action.result = "SUCCESS"
            plan.status = "APPLIED"
            event.status = "RESOLVED"
            if not saved:
                db.add(Alert(type="CONFIG_NOT_SAVED", related_id=action.id,
                             message=f"{device.hostname}: the fix was applied and verified but could not be saved to the startup configuration; a reload would undo it."))
            db.add(AuditLog(
                user_id=user_id,
                action="REMEDIATION_SUCCESS",
                target_type="remediation",
                target_id=action.id,
                after_state={
                    "plan_id": str(plan.id),
                    "device": device.hostname,
                    "executed_commands": plan.proposed_commands,
                    "verification_snapshot_id": str(verification_snapshot.id),
                    "saved_to_startup": saved,
                    "result": "SUCCESS",
                },
            ))
            db.commit()
            return action

        # Verification FAIL -> Automatic Rollback, then PROVE the restore (§6)
        restore_started = time.monotonic()
        verified, detail_msg = restore_and_verify(db, device, pre_change_config, conn)
        restore_seconds = round(time.monotonic() - restore_started, 2)
        _finish_rollback(
            db, plan, action, device, user_id, backup, verified, detail_msg,
            reason="verification failed post-change",
            extra={"failed_paths": str(failed_paths or "forced verification failure")},
            restore_seconds=restore_seconds,
        )
        return action

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        if not change_started:
            # Nothing was changed on the device: this is an abort, not a rollback
            action.result = "ABORTED"
            plan.status = "FAILED"
            db.add(Alert(type="REMEDIATION_FAILED", related_id=action.id,
                         message=f"Remediation of {device.hostname} aborted before any change was made: {e}"))
            db.add(AuditLog(user_id=user_id, action="REMEDIATION_ABORTED", target_type="remediation", target_id=action.id,
                            after_state={"error": str(e), "result": "ABORTED", "changes_made": False}))
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY if isinstance(e, _PRE_CHANGE_ERRORS) else status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Remediation aborted before any change was made: {e}",
            ) from e

        # The device may be partially changed: restore from the backup (reconnecting if needed) and verify
        restore_started = time.monotonic()
        verified, detail_msg = restore_and_verify(db, device, pre_change_config, conn)
        restore_seconds = round(time.monotonic() - restore_started, 2)
        _finish_rollback(db, plan, action, device, user_id, backup, verified, detail_msg, reason=f"error during remediation: {e}",
                         extra={"error": str(e)}, restore_seconds=restore_seconds)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(f"Remediation execution failed: {e}. Rollback verified." if verified
                    else f"Remediation execution failed: {e}. ROLLBACK COULD NOT BE VERIFIED: manual intervention required."),
        ) from e

    finally:
        if conn:
            try:
                conn.disconnect()
            except Exception:
                pass


def manual_rollback(db: Session, plan_id: UUID, admin_user: User) -> RemediationAction:
    """
    Admin-only manual rollback trigger per §9: restore the device to the plan's pre-change backup and verify it.
    ROLLED_BACK is only reported when the restored configuration was re-read and matches the backup.
    """
    plan = get_remediation_plan(db, plan_id)
    event = plan.drift_event
    device = event.device

    assert_remediation_allowed(device)

    # Find pre-change backup
    backup = (
        db.query(Backup)
        .join(RemediationAction, Backup.taken_before_action_id == RemediationAction.id)
        .filter(RemediationAction.remediation_plan_id == plan.id)
        .order_by(Backup.taken_at.desc())
        .first()
    )
    if not backup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No backup configuration found for remediation plan {plan_id}",
        )

    with device_lock(db, device.id) as acquired:
        if not acquired:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Device {device.hostname} is busy (a poll or remediation is running); retry shortly.",
            )
        action = RemediationAction(
            remediation_plan_id=plan.id,
            executed_commands=["MANUAL_ROLLBACK_RESTORE_BACKUP"],
            result="IN_PROGRESS",
            executed_at=datetime.now(timezone.utc),
        )
        db.add(action)
        db.commit()

        verified, detail_msg = restore_and_verify(db, device, backup.config_blob)
        if verified:
            action.result = "ROLLED_BACK"
            plan.status = "ROLLED_BACK"
            event.status = "OPEN"
            db.add(AuditLog(
                user_id=admin_user.id, action="MANUAL_ROLLBACK", target_type="remediation", target_id=action.id,
                after_state={"plan_id": str(plan.id), "device": device.hostname, "backup_id": str(backup.id),
                             "result": "ROLLED_BACK", "rollback_detail": detail_msg},
            ))
            db.commit()
            return action

        action.result = "ROLLBACK_FAILED"
        plan.status = "ROLLBACK_FAILED"
        _schedule_rollback_retry(plan.id)
        db.add(Alert(type="CRITICAL_DRIFT", related_id=action.id,
                     message=(f"CRITICAL: Manual rollback on {device.hostname} could NOT be verified ({detail_msg}). "
                              f"Device configuration state is UNKNOWN; restore backup {backup.id} on the console.")))
        db.add(AuditLog(
            user_id=admin_user.id, action="MANUAL_ROLLBACK_FAILED", target_type="remediation", target_id=action.id,
            after_state={"plan_id": str(plan.id), "device": device.hostname, "backup_id": str(backup.id),
                         "result": "ROLLBACK_FAILED", "rollback_detail": detail_msg},
        ))
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Manual rollback could not be verified: {detail_msg}",
        )


def _lookup_json_path(tree: dict, key_path: str) -> Any:
    """The value at a dotted key path, resolved exactly as drift detection resolves it (one implementation, no drift between them)."""
    return resolve_key_path(tree, key_path)
