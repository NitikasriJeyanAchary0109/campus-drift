"""
Failure / edge-case suite: device collection, credentials, alerts, locks, baseline switches (WP6).
"""
import contextlib
from datetime import datetime, timedelta, timezone

import pytest
from netmiko.exceptions import NetmikoAuthenticationException, NetmikoTimeoutException

from app.models.alerts import Alert
from app.models.audit import AuditLog
from app.models.baselines import Baseline, BaselineRule
from app.models.configurations import ConfigurationSnapshot
from app.models.drift import DriftEvent
from app.services import collection
from app.services.baseline import activate_baseline
from app.services.collection import DeviceBusyError, collect_device_configuration
from app.services.vault import store_device_credential
from app.tasks import collection as tasks
from tests.failure_env import CLEAN_CFG, DRIFTED_CFG, build_env, open_event


@pytest.fixture
def env():
    e = build_env()
    store_device_credential(e["db"], e["device"].id, "cisco", "pw")
    yield e
    e["db"].close()


class Conn:
    def __init__(self, text):
        self.text = text

    def send_command(self, cmd, **_):
        return self.text

    def disconnect(self):
        pass


def connect_returns(monkeypatch, text):
    monkeypatch.setattr(collection, "ConnectHandler", lambda **kw: Conn(text))


def connect_raises(monkeypatch, exc):
    def boom(**kw):
        raise exc
    monkeypatch.setattr(collection, "ConnectHandler", boom)


def down_alerts(env):
    return env["db"].query(Alert).filter_by(type="DEVICE_DOWN").all()


# ---------------------------------------------------------------- unreachable / credentials

def test_wrong_password_marks_device_unreachable_and_is_not_drift(env, monkeypatch):
    open_event(env)  # an OPEN drift event exists from an earlier poll
    snapshots_before = env["db"].query(ConfigurationSnapshot).count()
    connect_raises(monkeypatch, NetmikoAuthenticationException("bad credentials after rotation"))
    with pytest.raises(PermissionError):
        collect_device_configuration(env["db"], env["device"].id)
    db = env["db"]
    db.refresh(env["device"])
    assert env["device"].status == "UNREACHABLE"
    assert db.query(ConfigurationSnapshot).count() == snapshots_before          # no snapshot, so no fake "compliant"
    assert db.query(DriftEvent).filter_by(status="OPEN").count() == 1           # existing drift is untouched
    assert db.query(AuditLog).filter_by(action="AUTH_FAILURE").count() == 1
    assert len(down_alerts(env)) == 1 and "authentication failed" in down_alerts(env)[0].message


def test_timeout_marks_device_unreachable(env, monkeypatch):
    connect_raises(monkeypatch, NetmikoTimeoutException("timed out"))
    with pytest.raises(ConnectionError):
        collect_device_configuration(env["db"], env["device"].id)
    env["db"].refresh(env["device"])
    assert env["device"].status == "UNREACHABLE"
    assert env["db"].query(AuditLog).filter_by(action="COLLECT_TIMEOUT").count() == 1


def test_missing_credentials_marks_device_unreachable(env, monkeypatch):
    from app.models.devices import DeviceCredential
    env["db"].query(DeviceCredential).delete()
    env["db"].commit()
    with pytest.raises(ConnectionError, match="No credentials"):
        collect_device_configuration(env["db"], env["device"].id)
    env["db"].refresh(env["device"])
    assert env["device"].status == "UNREACHABLE"


def test_repeated_failures_raise_one_alert_not_one_per_poll(env, monkeypatch):
    connect_raises(monkeypatch, NetmikoTimeoutException("down"))
    for _ in range(4):
        with pytest.raises(ConnectionError):
            collect_device_configuration(env["db"], env["device"].id)
    assert len(down_alerts(env)) == 1                                           # alert fatigue guard
    assert env["db"].query(AuditLog).filter_by(action="COLLECT_TIMEOUT").count() == 4   # but every failure is audited


def test_recovery_acknowledges_the_alert_and_brings_the_device_online(env, monkeypatch):
    connect_raises(monkeypatch, NetmikoTimeoutException("down"))
    with pytest.raises(ConnectionError):
        collect_device_configuration(env["db"], env["device"].id)
    connect_returns(monkeypatch, CLEAN_CFG)
    collect_device_configuration(env["db"], env["device"].id)
    env["db"].refresh(env["device"])
    assert env["device"].status == "ONLINE"
    assert all(a.acknowledged for a in down_alerts(env))
    assert env["db"].query(AuditLog).filter_by(action="DEVICE_RECOVERED").count() == 1
    # a *new* outage raises a *new* alert
    connect_raises(monkeypatch, NetmikoTimeoutException("down again"))
    with pytest.raises(ConnectionError):
        collect_device_configuration(env["db"], env["device"].id)
    assert len(down_alerts(env)) == 2


def test_empty_device_output_is_a_parse_error_never_compliant(env, monkeypatch):
    connect_returns(monkeypatch, "")
    snap = collect_device_configuration(env["db"], env["device"].id)
    assert snap.status == "PARSE_ERROR"
    assert env["db"].query(DriftEvent).count() == 0
    assert any("parse error" in a.message.lower() for a in env["db"].query(Alert).filter_by(type="CRITICAL_DRIFT"))


def test_comment_only_config_is_not_reported_compliant(env, monkeypatch):
    connect_returns(monkeypatch, "! nothing here\n!\nend\n")
    collect_device_configuration(env["db"], env["device"].id)
    event = env["db"].query(DriftEvent).one()
    assert event.label != "Compliant"                                            # missing NTP etc. must show as drift


def test_decommissioned_device_is_not_polled(env):
    env["device"].status = "DECOMMISSIONED"
    env["db"].commit()
    with pytest.raises(ValueError, match="decommissioned"):
        collect_device_configuration(env["db"], env["device"].id)


# ---------------------------------------------------------------- locks

def test_busy_device_raises_and_the_task_skips_instead_of_failing(env, monkeypatch):
    @contextlib.contextmanager
    def busy(db, device_id):
        yield False
    monkeypatch.setattr(collection, "device_lock", busy)
    with pytest.raises(DeviceBusyError):
        collect_device_configuration(env["db"], env["device"].id)
    monkeypatch.setattr(tasks, "SessionLocal", env["Session"])
    result = tasks.poll_device_task.run(str(env["device"].id))
    assert result["status"] == "SKIPPED" and "busy" in result["message"]
    assert env["db"].query(ConfigurationSnapshot).count() == 0


# ---------------------------------------------------------------- baseline activated mid-flight

def test_baseline_activation_between_polls_reevaluates_with_the_new_baseline(env, monkeypatch):
    first = open_event(env)
    assert first.baseline_id == env["baseline"].id
    strict = Baseline(name="b2", device_group_id=env["group"].id, vendor="cisco_ios", version=2, is_active=False,
                      created_by=env["users"]["Admin"].id)
    env["db"].add(strict)
    env["db"].commit()
    env["db"].add(BaselineRule(baseline_id=strict.id, key_path="ntp.server", expected_value="10.99.0.1", rule_type="EXACT",
                               severity_weight=30, hard_compliance=False))
    env["db"].commit()
    activated, previous = activate_baseline(env["db"], strict.id)
    active = env["db"].query(Baseline).filter_by(is_active=True).all()
    assert [b.id for b in active] == [strict.id] and previous == env["baseline"].id   # exactly one active, never zero

    connect_returns(monkeypatch, DRIFTED_CFG)
    collect_device_configuration(env["db"], env["device"].id)
    event = env["db"].query(DriftEvent).filter_by(status="OPEN").one()
    assert event.baseline_id == strict.id
    assert {d.key_path for d in event.details} == {"ntp.server"}                 # judged only by the new baseline's rules


def test_activating_one_vendor_does_not_deactivate_another(env):
    other = Baseline(name="frr-b", device_group_id=env["group"].id, vendor="frr", version=1, is_active=True,
                     created_by=env["users"]["Admin"].id)
    cand = Baseline(name="b3", device_group_id=env["group"].id, vendor="cisco_ios", version=3, is_active=False,
                    created_by=env["users"]["Admin"].id)
    env["db"].add_all([other, cand])
    env["db"].commit()
    activate_baseline(env["db"], cand.id)
    env["db"].refresh(other)
    assert other.is_active is True
