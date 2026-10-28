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
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple, Any
from uuid import UUID

from fastapi import HTTPException, status
from netmiko import ConnectHandler
from netmiko.exceptions import NetmikoBaseException
from sqlalchemy.orm import Session

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
from app.services.normalization import normalize_config, values_equal
from app.services.remediation_templates import (
    render_remediation_commands,
    TemplateNotFoundError,
    SecurityViolationError,
)
from app.services.vault import get_device_credential


def generate_remediation_plan(db: Session, drift_event_id: UUID, user_id: UUID) -> RemediationPlan:
    """
    Generate a proposed remediation plan from a drift event using ONLY whitelisted Jinja2 templates.
    Never accepts or executes free-text user CLI (§13).
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
            detail=f"Device associated with drift event not found",
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

    # Check for existing approval
    existing = db.query(Approval).filter(Approval.remediation_plan_id == plan.id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Approval decision already recorded for this plan",
        )

    now = datetime.now(timezone.utc)
    approval = Approval(
        remediation_plan_id=plan.id,
        approved_by=user.id,
        decision=decision.upper(),
        comment=comment,
        decided_at=now,
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
    }
    return ConnectHandler(**device_params)


APPLY_STALE_AFTER = timedelta(minutes=15)   # an APPLYING claim older than this is considered abandoned (crashed worker)
ROLLBACK_RECONNECT_ATTEMPTS = 2             # fresh sessions tried if the original one is dead during a rollback
_PRE_CHANGE_ERRORS = (ConnectionError, TimeoutError, OSError, EOFError, NetmikoBaseException)


def _naive_utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def _significant_lines(config: str) -> List[str]:
    skip = ("building configuration", "current configuration", "version ", "end")
    out = []
    for raw in config.splitlines():
        line = raw.strip()
        if line and not line.startswith("!") and not line.lower().startswith(skip):
            out.append(line)
    return out


def _configs_equivalent(current: str, backup: str, vendor: str) -> bool:
    """True when two running-configs mean the same thing (normalized trees equal; line sets if unparsable)."""
    try:
        return normalize_config(current, vendor) == normalize_config(backup, vendor)
    except Exception:
        return sorted(set(_significant_lines(current))) == sorted(set(_significant_lines(backup)))


def _execute_rollback(conn: Any, backup_config: str, vendor: str = "cisco_ios") -> None:
    """
    Push the stored pre-change configuration back to the device. Transport failures propagate:
    a rollback that did not run must never be reported as one that did.
    Lab simulators restore exactly via 'simulator-reset-pristine'; real IOS answers '% Invalid input'
    (no exception), so when the device is still different afterwards the backup's commands are replayed in order.
    The caller verifies the result either way.
    """
    conn.send_command("simulator-reset-pristine")
    if _configs_equivalent(conn.send_command("show running-config"), backup_config, vendor):
        return  # already restored; replaying would only reorder lines
    lines = _significant_lines(backup_config)
    if lines:
        conn.send_config_set(lines)


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
) -> None:
    """Record the outcome of an automatic rollback: verified restore -> ROLLED_BACK, otherwise ROLLBACK_FAILED."""
    backup_id = str(backup.id) if backup else None
    is_verification = reason.startswith("verification")
    headline = (
        f"CRITICAL: Remediation verification failed on {device.hostname}"
        if is_verification else f"Remediation error on {device.hostname}: {reason.removeprefix('error during remediation: ')}"
    )
    paths = f" Failed paths: {extra['failed_paths']}" if extra and "failed_paths" in extra else ""
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
    db.add(Alert(type="CRITICAL_DRIFT", related_id=action.id, message=message))
    db.add(AuditLog(
        user_id=user_id, action=audit_action, target_type="remediation", target_id=action.id,
        after_state={"plan_id": str(plan.id), "device": device.hostname,
                     "failure_reason": "Verification failed post-change" if is_verification else reason,
                     "rollback_result": outcome, "rollback_verified": verified, "rollback_detail": detail,
                     "backup_id": backup_id, **(extra or {})},
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
        change_started = True  # from here on the device may be partially changed
        conn.send_config_set(plan.proposed_commands)

        # 4. Step (c) Re-pull Running Config for Verification
        post_change_config = conn.send_command("show running-config")
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
            action.result = "SUCCESS"
            plan.status = "APPLIED"
            event.status = "RESOLVED"
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
                    "result": "SUCCESS",
                },
            ))
            db.commit()
            return action

        # Verification FAIL -> Automatic Rollback, then PROVE the restore (§6)
        verified, detail_msg = restore_and_verify(db, device, pre_change_config, conn)
        _finish_rollback(
            db, plan, action, device, user_id, backup, verified, detail_msg,
            reason="verification failed post-change",
            extra={"failed_paths": str(failed_paths or "forced verification failure")},
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
        verified, detail_msg = restore_and_verify(db, device, pre_change_config, conn)
        _finish_rollback(db, plan, action, device, user_id, backup, verified, detail_msg, reason=f"error during remediation: {e}",
                         extra={"error": str(e)})
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
    """Traverse a normalized dict by dot-delimited key path."""
    curr = tree
    for part in key_path.split("."):
        if not isinstance(curr, dict):
            return None
        curr = curr.get(part)
        if curr is None:
            return None
    return curr
