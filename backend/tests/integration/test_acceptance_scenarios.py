"""
The three acceptance scenarios, run end to end against the live simulated switches and PostgreSQL.

A. The rogue troubleshooting event: an engineer logs into the access switch and moves the native VLAN of the trunk to a student VLAN.
B. The maintenance-window bypass: a forged ITSM webhook (wrong HMAC) tries to open a window; a manual sweep follows.
C. The rollback trap: a change that breaks the device's SSH configuration is verified, found fatal, and rolled back with no operator.

Needs the docker services (Postgres, Redis, simulated switches) and the seeded database. Run from the repository root.
"""
import hashlib
import hmac
import json
import re
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from app.core.celery_app import celery_app
from app.core.config import settings
from app.main import app
from app.models.alerts import Alert
from app.models.audit import AuditLog
from app.models.baselines import Baseline
from app.models.devices import Device, DeviceGroup
from app.models.drift import DriftEvent
from app.models.remediation import Backup, RemediationAction, RemediationPlan
from app.models.tickets import ChangeTicket
from app.services import remediation as rem
from app.services.collection import collect_device_configuration
from app.services.remediation import _configs_equivalent, _connect_to_device
from fastapi.testclient import TestClient

NATIVE_KEY = "interface.GigabitEthernet0/1.switchport.trunk_native_vlan"
STUDENT_VLAN = "10"        # Classroom VLAN 10 "Students"
MANAGEMENT_VLAN = "99"


# ---------------------------------------------------------------- helpers

def _device(db, hostname):
    device = db.query(Device).filter(Device.hostname == hostname).first()
    if not device:
        pytest.skip(f"{hostname} is not seeded in the database")
    return device


def _operator(db, device, commands):
    """What an engineer does on the box: log in over SSH and type configuration."""
    conn = _connect_to_device(db, device)
    try:
        conn.send_config_set(commands)
    finally:
        conn.disconnect()


def _running(db, device):
    conn = _connect_to_device(db, device)
    try:
        return conn.send_command("show running-config")
    finally:
        conn.disconnect()


def _latest_event(db, device):
    db.expire_all()
    return db.query(DriftEvent).filter(DriftEvent.device_id == device.id).order_by(DriftEvent.detected_at.desc()).first()


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def _require_native_rule(db, device):
    baseline = db.query(Baseline).filter(Baseline.device_group_id == device.device_group_id, Baseline.is_active.is_(True)).first()
    if not baseline or not any(r.key_path == "interface.*.switchport.trunk_native_vlan" for r in baseline.rules):
        pytest.fail(f"the active baseline of {device.hostname} has no native-VLAN rule: re-seed the database or add `interface.*.switchport.trunk_native_vlan` = 99")


@contextmanager
def _group_weight(db, device, weight):
    group = db.query(DeviceGroup).filter(DeviceGroup.id == device.device_group_id).first()
    original = group.criticality_weight
    group.criticality_weight = weight
    db.commit()
    try:
        yield
    finally:
        group.criticality_weight = original
        db.commit()


# ---------------------------------------------------------------- Scenario A

@pytest.mark.parametrize("zone_weight,label,score", [(1.0, "Drift-Unauthorized-High", 90), (0.8, "Drift-Unauthorized-Medium", 72), (0.5, "Drift-Unauthorized-Low", 45)])
def test_a_native_vlan_moved_to_a_student_vlan_is_caught_and_scored_by_zone(db_session, zone_weight, label, score):
    device = _device(db_session, "sw-classroom-01")
    _require_native_rule(db_session, device)
    assert MANAGEMENT_VLAN in _running(db_session, device) and "native vlan 99" in _running(db_session, device)   # starts compliant

    _operator(db_session, device, ["interface GigabitEthernet0/1", f"switchport trunk native vlan {STUDENT_VLAN}"])
    assert f"switchport trunk native vlan {STUDENT_VLAN}" in _running(db_session, device)                       # the rogue change is real

    with _group_weight(db_session, device, zone_weight):
        snapshot = collect_device_configuration(db=db_session, device_id=device.id)
    event = _latest_event(db_session, device)
    assert event.snapshot_id == snapshot.id
    assert [d.key_path for d in event.details] == [NATIVE_KEY]                                                 # exactly this change, nothing else
    detail = event.details[0]
    assert (detail.expected_value, detail.actual_value, detail.change_type) == (MANAGEMENT_VLAN, STUDENT_VLAN, "MODIFIED")
    assert event.matched_ticket_id is None
    assert (event.label, event.risk_score) == (label, score)                                                    # 90 x zone weight
    assert event.underlying_severity == score


def test_a_remediation_script_is_parameterised_approved_and_puts_the_trunk_back(db_session, neteng_token, admin_token):
    device = _device(db_session, "sw-classroom-01")
    _require_native_rule(db_session, device)
    client = TestClient(app)
    _operator(db_session, device, ["interface GigabitEthernet0/1", f"switchport trunk native vlan {STUDENT_VLAN}"])
    collect_device_configuration(db=db_session, device_id=device.id)
    event = _latest_event(db_session, device)

    # evidence an auditor can read: why it matters and the exact running-config line
    detail = client.get(f"/api/drift/{event.id}", headers=_headers(neteng_token)).json()["details"][0]
    assert "native vlan" in detail["why_it_matters"].lower() and detail["source_line"] == f"switchport trunk native vlan {STUDENT_VLAN}"

    plan = client.post(f"/api/remediation/{event.id}/generate-plan", headers=_headers(neteng_token))
    assert plan.status_code == 201, plan.text
    assert plan.json()["proposed_commands"] == ["interface GigabitEthernet0/1", f"switchport trunk native vlan {MANAGEMENT_VLAN}"]
    plan_id = plan.json()["id"]

    assert client.post(f"/api/remediation/{plan_id}/apply", headers=_headers(admin_token)).status_code == 409           # not approved yet
    assert client.post(f"/api/approvals/{plan_id}", json={"decision": "APPROVED", "comment": "scenario A"}, headers=_headers(admin_token)).status_code == 201
    applied = client.post(f"/api/remediation/{plan_id}/apply", headers=_headers(admin_token))
    assert applied.status_code == 200 and applied.json()["result"] == "SUCCESS"

    after = _running(db_session, device)
    assert f"switchport trunk native vlan {MANAGEMENT_VLAN}" in after and f"native vlan {STUDENT_VLAN}" not in after
    db_session.expire_all()
    assert db_session.query(DriftEvent).filter(DriftEvent.id == event.id).one().status == "RESOLVED"


# ---------------------------------------------------------------- Scenario B

def _delivery(external_ref, secret, *, hostname="sw-classroom-01"):
    now = datetime.now(timezone.utc)
    body = json.dumps({"external_ref": external_ref, "ticket_ref": external_ref, "source": "servicenow", "hostname": hostname,
                       "key_path_scope": "ntp.server", "status": "OPEN",
                       "valid_from": (now - timedelta(hours=1)).isoformat(), "valid_to": (now + timedelta(hours=1)).isoformat()}).encode()
    sent_at = int(time.time())
    signature = hmac.new(secret.encode(), f"{sent_at}.".encode() + body, hashlib.sha256).hexdigest()
    return body, {"X-ITSM-Signature": f"sha256={signature}", "X-ITSM-Timestamp": str(sent_at), "Content-Type": "application/json"}


def _open_forgery_attempts(db):
    db.expire_all()
    alert = (db.query(Alert).filter(Alert.type == "SECURITY_CHANGE", Alert.acknowledged.is_(False), Alert.message.like("Rejected ITSM webhook from testclient:%"))
             .order_by(Alert.created_at.desc()).first())
    return int(re.search(r"Attempts: (\d+)$", alert.message).group(1)) if alert else 0


@pytest.fixture
def eager_sweep(monkeypatch):
    """Run the manual-sweep task in the request instead of waiting for a worker."""
    monkeypatch.setattr(celery_app.conf, "task_always_eager", True)
    monkeypatch.setattr(celery_app.conf, "task_eager_propagates", True)


def _sweep(client, token, device):
    res = client.post(f"/api/devices/{device.id}/poll", headers=_headers(token))
    assert res.status_code == 202, res.text
    assert res.json()["status"] in ("SUCCESS", "ACCEPTED"), res.json()


def test_b_forged_webhook_is_refused_and_the_sweep_still_reports_unauthorised_drift(db_session, neteng_token, eager_sweep):
    device = _device(db_session, "sw-classroom-01")
    client = TestClient(app)
    ref = f"CHG-FORGED-{uuid.uuid4().hex[:8]}"
    _operator(db_session, device, ["ntp server 10.99.99.99"])                                                    # change made without a real ticket
    attempts_before = _open_forgery_attempts(db_session)

    body, headers = _delivery(ref, secret="not-the-itsm-secret")                                                 # wrong HMAC-SHA256 key
    res = client.post("/api/tickets/webhook", content=body, headers=headers)
    assert res.status_code == 401 and "HMAC" in res.json()["detail"]
    assert db_session.query(ChangeTicket).filter(ChangeTicket.external_ref == ref).count() == 0                  # nothing suppressing was stored

    _sweep(client, neteng_token, device)                                                                         # the manual sweep
    event = _latest_event(db_session, device)
    assert event.matched_ticket_id is None and event.label.startswith("Drift-Unauthorized")                      # suppression request rejected
    assert any(d.key_path == "ntp.server" and d.actual_value == "10.99.99.99" for d in event.details)

    assert _open_forgery_attempts(db_session) == attempts_before + 1                                             # high-criticality alert fired
    alert = db_session.query(Alert).filter(Alert.type == "SECURITY_CHANGE", Alert.acknowledged.is_(False)).order_by(Alert.created_at.desc()).first()
    assert "no drift was suppressed" in alert.message and "Invalid HMAC signature" in alert.message
    rejected = db_session.query(AuditLog).filter(AuditLog.action == "ITSM_WEBHOOK_REJECTED").order_by(AuditLog.timestamp.desc()).first()
    assert rejected.after_state["authenticated"] is False and rejected.after_state["http_status"] == 401
    assert rejected.after_state["body_sha256"] == hashlib.sha256(body).hexdigest() and "body" not in rejected.after_state    # the forger's text is not stored


def test_b_control_the_same_delivery_with_the_right_secret_does_suppress(db_session, neteng_token, eager_sweep):
    device = _device(db_session, "sw-classroom-01")
    client = TestClient(app)
    ref = f"CHG-REAL-{uuid.uuid4().hex[:8]}"
    collect_device_configuration(db=db_session, device_id=device.id)                                             # a clean poll just before the change
    _operator(db_session, device, ["ntp server 10.99.99.99"])
    body, headers = _delivery(ref, secret=settings.ITSM_WEBHOOK_SECRET)
    try:
        assert client.post("/api/tickets/webhook", content=body, headers=headers).status_code == 200
        _sweep(client, neteng_token, device)
        event = _latest_event(db_session, device)
        assert event.label == "Drift-Authorized" and event.matched_ticket_id is not None
    finally:
        db_session.expire_all()
        for ticket in db_session.query(ChangeTicket).filter(ChangeTicket.external_ref == ref).all():
            ticket.status = "CLOSED"                                                                             # tickets are never deleted; close the test's
        db_session.commit()


# ---------------------------------------------------------------- Scenario C

@contextmanager
def _rule_expects(db, group_id, key_path, expected_value):
    """The active baseline holds a value that is wrong for the device (as a mistaken edit would). The original value is restored afterwards."""
    active = db.query(Baseline).filter(Baseline.device_group_id == group_id, Baseline.vendor == "cisco_ios", Baseline.is_active.is_(True)).first()
    rule = next((r for r in active.rules if r.key_path == key_path), None)
    assert rule is not None, f"the active baseline has no rule for {key_path}"
    original = rule.expected_value
    rule.expected_value = expected_value
    db.commit()
    try:
        yield
    finally:
        db.expire_all()
        rule = next(r for r in db.query(Baseline).filter(Baseline.id == active.id).one().rules if r.key_path == key_path)
        rule.expected_value = original
        db.commit()


class _FaultyPush:
    """The session that pushes the approved commands; right after them a faulty command breaks the vty transport (SSH) on the device."""

    def __init__(self, conn):
        self._conn = conn

    def send_config_set(self, commands, *args, **kwargs):
        out = self._conn.send_config_set(commands, *args, **kwargs)
        self._conn.send_config_set(["line vty 0 4", "transport input none"])
        return out

    def __getattr__(self, name):
        return getattr(self._conn, name)


def _approved_plan(client, db, event, neteng_token, admin_token):
    res = client.post(f"/api/remediation/{event.id}/generate-plan", headers=_headers(neteng_token))
    assert res.status_code == 201, res.text
    plan_id = res.json()["id"]
    assert client.post(f"/api/approvals/{plan_id}", json={"decision": "APPROVED", "comment": "scenario C"}, headers=_headers(admin_token)).status_code == 201
    return plan_id, res.json()["proposed_commands"]


def _assert_fully_rolled_back(db, device, plan_id, client, admin_token, pre_change_text, restore_target):
    db.expire_all()
    plan = db.query(RemediationPlan).filter(RemediationPlan.id == plan_id).one()
    action = db.query(RemediationAction).filter(RemediationAction.remediation_plan_id == plan_id).one()
    backup = db.query(Backup).filter(Backup.taken_before_action_id == action.id).one()
    assert (action.result, plan.status) == ("ROLLED_BACK", "FAILED")
    assert backup.config_blob == pre_change_text                                                                  # the backup is the true pre-change state

    after = _running(db, device)                                                                                 # a NEW ssh session works again
    assert _configs_equivalent(after, backup.config_blob, "cisco_ios") and "transport input none" not in after
    alert = db.query(Alert).filter(Alert.type == "CRITICAL_DRIFT", Alert.related_id == action.id).one()
    assert "verified against the pre-change backup" in alert.message
    audit = db.query(AuditLog).filter(AuditLog.action == "REMEDIATION_ROLLED_BACK", AuditLog.target_id == action.id).one()
    assert audit.after_state["rollback_verified"] is True and audit.after_state["backup_id"] == str(backup.id)
    assert audit.after_state["restore_seconds"] <= restore_target and audit.after_state["restore_within_target"] is True
    assert db.query(AuditLog).filter(AuditLog.action.like("%MANUAL_ROLLBACK%"), AuditLog.target_id == action.id).count() == 0     # nobody stepped in
    return action, audit


@pytest.mark.parametrize("test_hooks", [True, False], ids=["lab-reset-command", "diff-based-restore-as-on-real-ios"])
def test_c_a_change_that_cuts_off_ssh_is_detected_and_rolled_back_automatically(db_session, neteng_token, admin_token, monkeypatch, test_hooks):
    """The baseline (mistakenly) wants 'transport input none'. The rule itself verifies, but a new SSH session no longer opens."""
    monkeypatch.setattr(settings, "ALLOW_TEST_HOOKS", test_hooks)
    device = _device(db_session, "sw-hostel-01")
    client = TestClient(app)
    pre_change = _running(db_session, device)
    assert "transport input telnet ssh" in pre_change

    with _rule_expects(db_session, device.device_group_id, "line.vty.transport_input", "none"):
        collect_device_configuration(db=db_session, device_id=device.id)
        event = _latest_event(db_session, device)
        plan_id, commands = _approved_plan(client, db_session, event, neteng_token, admin_token)
        assert "transport input none" in commands                                                                # the faulty command is in the plan

        started = time.monotonic()
        applied = client.post(f"/api/remediation/{plan_id}/apply", headers=_headers(admin_token))               # the only operator action
        elapsed = time.monotonic() - started
    assert applied.status_code == 200, applied.text
    assert applied.json()["result"] == "ROLLED_BACK" and applied.json()["verification_passed"] is False
    action, audit = _assert_fully_rolled_back(db_session, device, plan_id, client, admin_token, pre_change, settings.ROLLBACK_TARGET_SECONDS)
    assert "management access" in audit.after_state["failed_paths"] and "could not be opened" in audit.after_state["failed_paths"]
    print(f"\n  apply + detect + rollback took {elapsed:.1f}s, restore itself {audit.after_state['restore_seconds']}s (target {settings.ROLLBACK_TARGET_SECONDS}s)")


def test_c_a_faulty_command_pushed_with_the_plan_fails_verification_and_is_rolled_back(db_session, neteng_token, admin_token, monkeypatch):
    """The baseline is right ('ssh'); the device ends up with 'transport input none' anyway, so the key-path verification itself fails."""
    device = _device(db_session, "sw-hostel-01")
    client = TestClient(app)
    pre_change = _running(db_session, device)
    collect_device_configuration(db=db_session, device_id=device.id)
    event = _latest_event(db_session, device)
    plan_id, commands = _approved_plan(client, db_session, event, neteng_token, admin_token)
    assert "transport input ssh" in commands and "transport input none" not in commands

    real_connect = rem._connect_to_device
    calls = {"n": 0}

    def connect(db, dev):
        calls["n"] += 1
        conn = real_connect(db, dev)
        return _FaultyPush(conn) if calls["n"] == 1 else conn                                                    # only the pushing session is faulty

    monkeypatch.setattr(rem, "_connect_to_device", connect)
    applied = client.post(f"/api/remediation/{plan_id}/apply", headers=_headers(admin_token))
    monkeypatch.setattr(rem, "_connect_to_device", real_connect)

    assert applied.status_code == 200 and applied.json()["result"] == "ROLLED_BACK" and applied.json()["verification_passed"] is False
    _, audit = _assert_fully_rolled_back(db_session, device, plan_id, client, admin_token, pre_change, settings.ROLLBACK_TARGET_SECONDS)
    assert "line.vty.transport_input" in audit.after_state["failed_paths"]
