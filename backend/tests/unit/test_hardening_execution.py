"""Regression tests for the execution-loop defects found in the architecture review."""
import pytest
from app.core.config import settings
from app.models.alerts import Alert
from app.models.audit import AuditLog
from app.models.remediation import Approval, Backup, RemediationAction
from app.services import remediation as rem
from fastapi import HTTPException

from tests.failure_env import CLEAN_CFG, DRIFTED_CFG, build_env, open_event
from tests.fakes import FakeDevice


@pytest.fixture
def env():
    e = build_env()
    yield e
    e["db"].close()


def approved_plan(env):
    event = open_event(env)
    plan = rem.generate_remediation_plan(env["db"], event.id, env["users"]["NetworkEngineer"].id)
    rem.submit_approval(env["db"], plan.id, "APPROVED", "ok", env["users"]["Admin"])
    return plan


def apply(env, plan, fake, monkeypatch, **kw):
    monkeypatch.setattr(rem, "_connect_to_device", lambda db, dev: fake.connect())
    return rem.apply_remediation_plan(env["db"], plan.id, env["users"]["Admin"].id, **kw)


# --- restoring and comparing configurations -----------------------------------------------------------------------------
BACKUP = "hostname r1\nntp server 10.10.0.1\nline vty 0 4\n transport input ssh\n login local\nend\n"
CHANGED = ("hostname r1\nntp server 10.10.0.1\nntp server 66.6.6.6\nusername evil privilege 15 secret 0 x\n"
           "line vty 0 4\n transport input telnet ssh\n login local\n no exec-timeout\nend\n")


def test_restore_commands_negate_what_the_change_added_and_restore_what_it_altered():
    cmds = rem._restore_commands(CHANGED, BACKUP)
    assert "no ntp server 66.6.6.6" in cmds
    assert "no username evil privilege 15 secret 0 x" in cmds
    assert cmds.index("line vty 0 4") < cmds.index("no transport input telnet ssh")
    assert "exec-timeout" in " ".join(cmds)                 # 'no exec-timeout' is negated back to 'exec-timeout'
    assert "transport input ssh" in cmds


def test_restore_commands_are_empty_for_identical_configs_ignoring_volatile_lines():
    assert rem._restore_commands(BACKUP, "Building configuration...\n\nCurrent configuration : 99 bytes\n" + BACKUP) == []


def test_a_rogue_line_outside_the_parsed_model_is_not_restored_by_the_tree_alone():
    with_user = BACKUP.replace("end\n", "username evil privilege 15 secret 0 x\nend\n")
    assert rem._configs_equivalent(with_user, BACKUP, "cisco_ios") is False
    assert rem._configs_equivalent(BACKUP, BACKUP, "cisco_ios") is True


def test_indentation_context_matters():
    a = "hostname r\ninterface Gi0/1\n shutdown\ninterface Gi0/2\n"
    b = "hostname r\ninterface Gi0/1\ninterface Gi0/2\n shutdown\n"
    assert rem._configs_equivalent(a, b, "cisco_ios") is False


# --- persistence, retries ----------------------------------------------------------------------------------------------
def test_a_verified_change_is_saved_to_the_startup_configuration(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG)
    assert apply(env, plan, fake, monkeypatch).result == "SUCCESS"
    assert fake.saved_config == fake.running
    audit = env["db"].query(AuditLog).filter_by(action="REMEDIATION_SUCCESS").one()
    assert audit.after_state["saved_to_startup"] is True


def test_a_failed_save_is_reported_but_does_not_undo_the_verified_change(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG, write_memory_ok=False)
    assert apply(env, plan, fake, monkeypatch).result == "SUCCESS"
    assert plan.status == "APPLIED"
    assert env["db"].query(Alert).filter_by(type="CONFIG_NOT_SAVED").count() == 1


def test_saving_can_be_switched_off(env, monkeypatch):
    monkeypatch.setattr(settings, "REMEDIATION_SAVE_CONFIG", False)
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG)
    apply(env, plan, fake, monkeypatch)
    assert fake.saved_config is None


def test_a_read_timeout_during_verification_is_retried_not_rolled_back(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG, transient_read_errors=2)
    action = apply(env, plan, fake, monkeypatch)
    assert action.result == "SUCCESS" and plan.status == "APPLIED"
    assert env["db"].query(RemediationAction).filter_by(result="ROLLED_BACK").count() == 0


def test_a_read_that_never_recovers_rolls_back(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG, transient_read_errors=50)
    with pytest.raises(HTTPException):
        apply(env, plan, fake, monkeypatch)
    assert plan.status in ("FAILED", "ROLLBACK_FAILED")


# --- the approved commands are the commands that are sent -------------------------------------------------------------------
def test_commands_changed_after_approval_are_refused_and_the_device_is_untouched(env, monkeypatch):
    plan = approved_plan(env)
    plan.proposed_commands = list(plan.proposed_commands) + ["username backdoor privilege 15 secret x"]
    env["db"].commit()
    fake = FakeDevice(DRIFTED_CFG)
    with pytest.raises(HTTPException) as exc:
        apply(env, plan, fake, monkeypatch)
    assert exc.value.status_code == 409
    assert fake.pushes == [] and fake.connections == 0
    assert env["db"].query(AuditLog).filter_by(action="PLAN_COMMANDS_CHANGED_AFTER_APPROVAL").count() == 1
    assert env["db"].query(Alert).filter_by(type="SECURITY_CHANGE").count() == 1


def test_the_approval_records_the_digest_of_the_commands(env):
    plan = approved_plan(env)
    approval = env["db"].query(Approval).filter_by(remediation_plan_id=plan.id).one()
    assert approval.commands_sha256 == rem.commands_digest(list(plan.proposed_commands))


def test_a_control_character_in_stored_commands_is_refused_before_anything_is_sent(env, monkeypatch):
    event = open_event(env)
    plan = rem.generate_remediation_plan(env["db"], event.id, env["users"]["NetworkEngineer"].id)
    plan.proposed_commands = ["line vty 0 4", " transport input ssh\x1a"]      # digest taken after the edit: only the resanitise can catch it
    env["db"].commit()
    rem.submit_approval(env["db"], plan.id, "APPROVED", "ok", env["users"]["Admin"])
    fake = FakeDevice(DRIFTED_CFG)
    with pytest.raises(HTTPException):
        apply(env, plan, fake, monkeypatch)
    assert fake.pushes == []
    assert env["db"].query(RemediationAction).one().result == "ABORTED"


# --- states that must not be re-entered ------------------------------------------------------------------------------------
def test_a_plan_whose_rollback_failed_cannot_be_applied_again(env, monkeypatch):
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG, rollback_error=True)
    assert apply(env, plan, fake, monkeypatch, force_fail_verification=True).result == "ROLLBACK_FAILED"
    backups_before = env["db"].query(Backup).count()
    again = FakeDevice(DRIFTED_CFG)
    with pytest.raises(HTTPException) as exc:
        apply(env, plan, again, monkeypatch)
    assert exc.value.status_code == 409 and again.connections == 0
    assert env["db"].query(Backup).count() == backups_before          # no new backup of a broken device


def test_a_delayed_retry_restores_the_device_and_closes_the_failed_rollback(env, monkeypatch):
    plan = approved_plan(env)
    broken = FakeDevice(DRIFTED_CFG, rollback_error=True)
    apply(env, plan, broken, monkeypatch, force_fail_verification=True)
    assert plan.status == "ROLLBACK_FAILED"
    recovered = FakeDevice(DRIFTED_CFG)                                  # the device is back and answers normally
    monkeypatch.setattr(rem, "_connect_to_device", lambda db, dev: recovered.connect())
    outcome, _ = rem.retry_failed_rollback(env["db"], plan.id, 1)
    assert outcome == "restored" and plan.status == "ROLLED_BACK"
    assert env["db"].query(AuditLog).filter_by(action="AUTO_ROLLBACK_RETRY_SUCCEEDED").count() == 1
    assert rem.retry_failed_rollback(env["db"], plan.id, 2)[0] == "skipped"     # nothing left to retry


def test_a_delayed_retry_that_still_fails_says_so(env, monkeypatch):
    plan = approved_plan(env)
    broken = FakeDevice(DRIFTED_CFG, rollback_error=True)
    apply(env, plan, broken, monkeypatch, force_fail_verification=True)
    outcome, _ = rem.retry_failed_rollback(env["db"], plan.id, 1)
    assert outcome == "still_failed" and plan.status == "ROLLBACK_FAILED"
    assert env["db"].query(AuditLog).filter_by(action="AUTO_ROLLBACK_RETRY_FAILED").count() == 1


# --- lab hooks stay in the lab -------------------------------------------------------------------------------------------------
def test_force_fail_is_refused_when_test_hooks_are_off(env, monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_TEST_HOOKS", False)
    plan = approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG)
    with pytest.raises(HTTPException) as exc:
        apply(env, plan, fake, monkeypatch, force_fail_verification=True)
    assert exc.value.status_code == 403 and fake.pushes == []


@pytest.mark.parametrize("hooks,expect_reset", [(True, True), (False, False)])
def test_the_simulator_reset_command_is_only_sent_when_hooks_are_on(monkeypatch, hooks, expect_reset):
    monkeypatch.setattr(settings, "ALLOW_TEST_HOOKS", hooks)
    e = build_env()
    try:
        plan = approved_plan(e)
        # a verification failure that needs the restore; with hooks off the restore is computed from the backup instead
        fake = FakeDevice(DRIFTED_CFG, reset_supported=hooks)
        monkeypatch.setattr(rem, "_connect_to_device", lambda db, dev: fake.connect())
        if hooks:
            action = rem.apply_remediation_plan(e["db"], plan.id, e["users"]["Admin"].id, force_fail_verification=True)
        else:
            # the real failure path (not the lab hook): the device ignores the pushed change at verification time
            fake.ignore_push = True
            action = rem.apply_remediation_plan(e["db"], plan.id, e["users"]["Admin"].id)
        assert (fake.reset_commands_received > 0) is expect_reset
        assert action.result in ("ROLLED_BACK", "ROLLBACK_FAILED")
    finally:
        e["db"].close()


@pytest.mark.parametrize("target,within", [(60, True), (-1, False)])
def test_the_restore_time_is_recorded_against_the_target(env, monkeypatch, target, within):
    """A verified rollback reports how long the restore took; one slower than the target says so in the audit entry and alert."""
    monkeypatch.setattr(settings, "ROLLBACK_TARGET_SECONDS", target)
    plan = approved_plan(env)
    action = apply(env, plan, FakeDevice(CLEAN_CFG), monkeypatch, force_fail_verification=True)
    assert action.result == "ROLLED_BACK"
    entry = env["db"].query(AuditLog).filter_by(action="REMEDIATION_ROLLED_BACK").one()
    assert entry.after_state["restore_seconds"] >= 0
    assert entry.after_state["restore_target_seconds"] == target
    assert entry.after_state["restore_within_target"] is within
    alert = env["db"].query(Alert).filter_by(related_id=action.id).one()
    assert ("over the" in alert.message) is (not within)
