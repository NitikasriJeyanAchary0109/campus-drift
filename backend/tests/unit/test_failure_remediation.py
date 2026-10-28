"""
Failure / edge-case suite: remediation, rollback and their error boundaries (WP6).

A fault-injectable fake device (tests/fakes.py) stands in for the switch. Every test states the boundary it pins:
the result recorded on the action and plan, the HTTP status, whether the device may be left changed, and which
alert / audit entries exist. The invariant behind all of them: a rollback is reported as ROLLED_BACK only when the
restored configuration was re-read and matches the pre-change backup.
"""
from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.models.alerts import Alert
from app.models.audit import AuditLog
from app.models.remediation import Backup, RemediationAction
from app.services import remediation as rem
from app.services.normalization import normalize_config
from tests.failure_env import CLEAN_CFG, DRIFTED_CFG, build_env, open_event
from tests.fakes import DeviceFault, FakeDevice


def norm(text):
    return normalize_config(text, "cisco_ios")


@pytest.fixture
def env():
    e = build_env()
    yield e
    e["db"].close()


def approved_plan(env, event=None):
    event = event or open_event(env)
    db, users = env["db"], env["users"]
    plan = rem.generate_remediation_plan(db, event.id, users["NetworkEngineer"].id)
    rem.submit_approval(db, plan.id, "APPROVED", "ok", users["Admin"])
    return plan


def apply(env, plan, fake, monkeypatch, **kw):
    monkeypatch.setattr(rem, "_connect_to_device", lambda db, dev: fake.connect())
    return rem.apply_remediation_plan(env["db"], plan.id, env["users"]["NetworkEngineer"].id, **kw)


def alerts(env, **filters):
    return env["db"].query(Alert).filter_by(**filters).all()


def audit_actions(env):
    return {a.action for a in env["db"].query(AuditLog).all()}


# ---------------------------------------------------------------- baseline behaviour

def test_happy_path_applies_and_verifies(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG)
    action = apply(env, plan, fake, monkeypatch)
    assert action.result == "SUCCESS" and plan.status == "APPLIED"
    assert norm(fake.running)["line"]["vty"]["transport_input"] == "ssh"
    assert "public" not in norm(fake.running)["snmp"]["community"]
    assert env["db"].query(Backup).count() == 1


# ---------------------------------------------------------------- rollback is proven, not assumed

def test_verification_failure_rolls_back_and_proves_it(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG)
    action = apply(env, plan, fake, monkeypatch, force_fail_verification=True)
    assert action.result == "ROLLED_BACK" and plan.status == "FAILED"
    assert norm(fake.running) == norm(DRIFTED_CFG)                       # device really is back
    assert any("verified against the pre-change backup" in a.message for a in alerts(env, type="CRITICAL_DRIFT"))
    audit = env["db"].query(AuditLog).filter_by(action="REMEDIATION_ROLLED_BACK").one()
    assert audit.after_state["rollback_verified"] is True


def test_rollback_that_fails_is_never_reported_as_rolled_back(env, monkeypatch):
    """The defect behind WP6: a swallowed rollback error used to be recorded as 'SUCCESSFULLY_RESTORED_TO_BACKUP'."""
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG, rollback_error=True)
    action = apply(env, plan, fake, monkeypatch, force_fail_verification=True)
    assert action.result == "ROLLBACK_FAILED" and plan.status == "ROLLBACK_FAILED"
    assert norm(fake.running) != norm(DRIFTED_CFG)                       # the device really was left changed
    msg = [a.message for a in alerts(env, type="CRITICAL_DRIFT") if "UNKNOWN" in a.message]
    assert msg and "restore it manually from backup" in msg[0]
    audit = env["db"].query(AuditLog).filter_by(action="REMEDIATION_ROLLBACK_FAILED").one()
    assert audit.after_state["rollback_verified"] is False
    assert "REMEDIATION_ROLLED_BACK" not in audit_actions(env)
    assert plan.drift_event.status == "OPEN"                             # the drift is still open


def test_real_ios_without_reset_command_is_restored_by_replaying_the_backup(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG, reset_supported=False)                # '% Invalid input' for the simulator command
    action = apply(env, plan, fake, monkeypatch, force_fail_verification=True)
    assert action.result == "ROLLED_BACK"
    assert norm(fake.running) == norm(DRIFTED_CFG)


def test_rollback_not_provable_when_restore_leaves_the_device_different(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG, reset_supported=False, ignore_push=False)
    original_apply = fake.apply
    pushes = []

    def lossy_apply(commands):          # the restore replay is ignored, remediation commands were not
        pushes.append(commands)
        if len(pushes) == 1:
            original_apply(commands)
    fake.apply = lossy_apply
    action = apply(env, plan, fake, monkeypatch, force_fail_verification=True)
    assert action.result == "ROLLBACK_FAILED"
    assert "still differs" in [a.message for a in alerts(env, type="CRITICAL_DRIFT") if "UNKNOWN" in a.message][0]


# ---------------------------------------------------------------- transport failures

def test_connection_refused_is_an_abort_not_a_rollback(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG, connect_error=ConnectionError("no route to host"))
    with pytest.raises(HTTPException) as exc:
        apply(env, plan, fake, monkeypatch)
    assert exc.value.status_code == 502
    assert "before any change was made" in exc.value.detail
    action = env["db"].query(RemediationAction).one()
    assert action.result == "ABORTED" and plan.status == "FAILED"
    assert env["db"].query(Backup).count() == 0 and fake.pushes == []
    assert alerts(env, type="REMEDIATION_FAILED") and not any("rollback" in a.message.lower() for a in alerts(env, type="REMEDIATION_FAILED"))


def test_aborted_plan_can_be_retried_once_the_device_is_back(env, monkeypatch):
    plan = approved_plan(env)
    with pytest.raises(HTTPException):
        apply(env, plan, FakeDevice(DRIFTED_CFG, connect_error=ConnectionError("down")), monkeypatch)
    action = apply(env, plan, FakeDevice(DRIFTED_CFG), monkeypatch)
    assert action.result == "SUCCESS" and plan.status == "APPLIED"


def test_empty_running_config_is_refused_as_a_backup(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice("")
    with pytest.raises(HTTPException) as exc:
        apply(env, plan, fake, monkeypatch)
    assert "empty running-config" in exc.value.detail
    assert fake.pushes == [] and env["db"].query(RemediationAction).one().result == "ABORTED"


def test_session_drop_mid_push_is_restored_over_a_fresh_connection(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG, push_error_after=2)                   # 2 of the commands landed, then the SSH session died
    with pytest.raises(HTTPException) as exc:
        apply(env, plan, fake, monkeypatch)
    assert exc.value.status_code == 500 and "Rollback verified" in exc.value.detail
    assert env["db"].query(RemediationAction).one().result == "ROLLED_BACK"
    assert norm(fake.running) == norm(DRIFTED_CFG) and fake.connections >= 2


def test_session_drop_right_after_push_is_restored_over_a_fresh_connection(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG, drop_after_push=True)                 # change fully applied, then the session died
    with pytest.raises(HTTPException):
        apply(env, plan, fake, monkeypatch)
    assert norm(fake.running) == norm(DRIFTED_CFG)
    assert env["db"].query(RemediationAction).one().result == "ROLLED_BACK"


def test_device_that_dies_mid_push_yields_rollback_failed_and_a_loud_alert(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG, push_error_after=2, dead_forever_after_push=True)
    with pytest.raises(HTTPException) as exc:
        apply(env, plan, fake, monkeypatch)
    assert "MANUAL INTERVENTION REQUIRED" in exc.value.detail.upper()
    assert env["db"].query(RemediationAction).one().result == "ROLLBACK_FAILED" and plan.status == "ROLLBACK_FAILED"
    assert any("UNKNOWN" in a.message for a in alerts(env, type="CRITICAL_DRIFT"))
    assert env["db"].query(Backup).count() == 1                          # the backup needed for the manual restore exists


def test_corrupt_post_change_output_is_rolled_back(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG, garbage_reads=1)                      # one corrupted 'show running-config' after the push
    with pytest.raises(HTTPException):
        apply(env, plan, fake, monkeypatch)
    assert env["db"].query(RemediationAction).one().result == "ROLLED_BACK"
    assert norm(fake.running) == norm(DRIFTED_CFG)


def test_device_that_ignores_changes_fails_verification_and_stays_unchanged(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG, ignore_push=True)
    action = apply(env, plan, fake, monkeypatch)
    assert action.result == "ROLLED_BACK" and plan.status == "FAILED"
    assert any("Failed paths" in a.message for a in alerts(env, type="CRITICAL_DRIFT"))


# ---------------------------------------------------------------- concurrency and state machine

def test_plan_being_applied_cannot_be_applied_again(env, monkeypatch):
    plan = approved_plan(env)
    plan.status = "APPLYING"
    env["db"].add(RemediationAction(remediation_plan_id=plan.id, executed_commands=["x"], result="IN_PROGRESS",
                                    executed_at=rem._naive_utc(rem.datetime.now(rem.timezone.utc))))
    env["db"].commit()
    fake = FakeDevice(DRIFTED_CFG)
    with pytest.raises(HTTPException) as exc:
        apply(env, plan, fake, monkeypatch)
    assert exc.value.status_code == 409 and fake.connections == 0


def test_stale_apply_claim_from_a_crashed_worker_is_released(env, monkeypatch):
    plan = approved_plan(env)
    plan.status = "APPLYING"
    old = rem._naive_utc(rem.datetime.now(rem.timezone.utc)) - rem.APPLY_STALE_AFTER - timedelta(minutes=1)
    env["db"].add(RemediationAction(remediation_plan_id=plan.id, executed_commands=["x"], result="IN_PROGRESS", executed_at=old))
    env["db"].commit()
    action = apply(env, plan, FakeDevice(DRIFTED_CFG), monkeypatch)
    assert action.result == "SUCCESS"
    assert "REMEDIATION_STALE_CLAIM_RELEASED" in audit_actions(env)
    assert sorted(a.result for a in env["db"].query(RemediationAction).all()) == ["ABORTED", "SUCCESS"]


def test_unexpected_exception_never_leaves_the_plan_claimed(env, monkeypatch):
    plan = approved_plan(env)
    monkeypatch.setattr(rem, "_apply_locked", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    with pytest.raises(RuntimeError):
        apply(env, plan, FakeDevice(DRIFTED_CFG), monkeypatch)
    env["db"].refresh(plan)
    assert plan.status == "FAILED"                                       # not stuck in APPLYING


def test_busy_device_returns_409_and_restores_plan_status(env, monkeypatch):
    plan = approved_plan(env)
    import contextlib

    @contextlib.contextmanager
    def busy(db, device_id):
        yield False
    monkeypatch.setattr(rem, "device_lock", busy)
    fake = FakeDevice(DRIFTED_CFG)
    with pytest.raises(HTTPException) as exc:
        apply(env, plan, fake, monkeypatch)
    assert exc.value.status_code == 409 and "busy" in exc.value.detail
    env["db"].refresh(plan)
    assert plan.status == "APPROVED" and fake.connections == 0


def test_approval_gate_cannot_be_bypassed(env, monkeypatch):
    event = open_event(env)
    db, users = env["db"], env["users"]
    plan = rem.generate_remediation_plan(db, event.id, users["NetworkEngineer"].id)
    fake = FakeDevice(DRIFTED_CFG)
    with pytest.raises(HTTPException) as exc:                            # never approved
        apply(env, plan, fake, monkeypatch)
    assert exc.value.status_code == 409
    rem.submit_approval(db, plan.id, "REJECTED", "no", users["Admin"])
    with pytest.raises(HTTPException) as exc:                            # rejected
        apply(env, plan, fake, monkeypatch)
    assert exc.value.status_code == 409 and fake.connections == 0


def test_already_applied_plan_is_rejected(env, monkeypatch):
    plan = approved_plan(env)
    apply(env, plan, FakeDevice(DRIFTED_CFG), monkeypatch)
    with pytest.raises(HTTPException) as exc:
        apply(env, plan, FakeDevice(DRIFTED_CFG), monkeypatch)
    assert exc.value.status_code == 400


# ---------------------------------------------------------------- manual rollback

def _applied_then_failed(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG)
    apply(env, plan, fake, monkeypatch)                                  # applied OK: backup exists, device changed
    return plan, fake


def test_manual_rollback_restores_and_verifies(env, monkeypatch):
    plan, fake = _applied_then_failed(env, monkeypatch)
    fake.pushed_once = True
    action = rem.manual_rollback(env["db"], plan.id, env["users"]["Admin"])
    assert action.result == "ROLLED_BACK" and plan.status == "ROLLED_BACK"
    assert norm(fake.running) == norm(DRIFTED_CFG)
    assert "MANUAL_ROLLBACK" in audit_actions(env)


def test_manual_rollback_failure_is_loud(env, monkeypatch):
    plan, fake = _applied_then_failed(env, monkeypatch)
    fake.rollback_error = True
    with pytest.raises(HTTPException) as exc:
        rem.manual_rollback(env["db"], plan.id, env["users"]["Admin"])
    assert exc.value.status_code == 500
    env["db"].refresh(plan)
    assert plan.status == "ROLLBACK_FAILED"
    assert "MANUAL_ROLLBACK_FAILED" in audit_actions(env)
    assert any("Manual rollback" in a.message and "UNKNOWN" in a.message for a in alerts(env, type="CRITICAL_DRIFT"))
    assert [a.result for a in env["db"].query(RemediationAction).order_by(RemediationAction.executed_at).all()][-1] == "ROLLBACK_FAILED"


def test_manual_rollback_without_backup_is_404(env):
    plan = approved_plan(env)
    with pytest.raises(HTTPException) as exc:
        rem.manual_rollback(env["db"], plan.id, env["users"]["Admin"])
    assert exc.value.status_code == 404
