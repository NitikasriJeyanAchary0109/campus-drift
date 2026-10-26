"""
Unit Tests for Legacy Workflow Coexistence (WP2)
------------------------------------------------
Covers manual configuration upload, per-device collection/shadow modes, and the
remediation guard for non-SSH-managed devices. Each test class of failure documents
its error boundary: HTTP status, whether anything was persisted, and which audit entry exists.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.main import app
from app.models.alerts import Alert
from app.models.audit import AuditLog
from app.models.baselines import Baseline, BaselineRule
from app.models.configurations import ConfigurationSnapshot
from app.models.devices import Device, DeviceGroup
from app.models.drift import DriftEvent
from app.models.remediation import Backup
from app.models.tickets import ChangeTicket
from app.models.users import Role, User
from app.services import legacy
from app.services.legacy import assert_remediation_allowed
from app.services.remediation import apply_remediation_plan, generate_remediation_plan, submit_approval

HOSTNAME = "sw-legacy-01"

COMPLIANT_CFG = f"""!
hostname {HOSTNAME}
!
ntp server 10.10.0.1
!
line vty 0 4
 transport input ssh
!
"""

DRIFTED_CFG = f"""!
hostname {HOSTNAME}
!
ntp server 10.10.0.1
snmp-server community public RO
!
line vty 0 4
 transport input telnet ssh
!
"""

NTP_DRIFT_CFG = f"""!
hostname {HOSTNAME}
!
ntp server 8.8.8.8
!
line vty 0 4
 transport input ssh
!
"""

MALFORMED_CFG = open(
    os.path.join(os.path.dirname(__file__), "..", "fixtures", "cisco_ios_malformed.cfg"), encoding="utf-8"
).read().replace("sw-corrupt-01", HOSTNAME)


@pytest.fixture
def env():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine, autoflush=False)
    Base.metadata.create_all(bind=engine)
    db = Session()

    roles = {n: Role(name=n) for n in ("Admin", "NetworkEngineer", "Viewer")}
    db.add_all(roles.values())
    db.commit()
    users = {}
    for username, role in (("admin_t", "Admin"), ("neteng_t", "NetworkEngineer"), ("viewer_t", "Viewer")):
        u = User(username=username, password_hash="x", role_id=roles[role].id, is_active=True)
        db.add(u)
        users[role] = u
    db.commit()

    group = DeviceGroup(name="Hostel", criticality_weight=1.0)
    db.add(group)
    db.commit()
    device = Device(
        hostname=HOSTNAME,
        ip_address="10.10.9.10",
        vendor="cisco_ios",
        model="Catalyst 2960-X",
        device_group_id=group.id,
        status="ONLINE",
        collection_mode="MANUAL_UPLOAD",
    )
    db.add(device)
    db.commit()

    baseline = Baseline(
        name="Legacy-Baseline", device_group_id=group.id, vendor="cisco_ios",
        version=1, is_active=True, created_by=users["Admin"].id,
    )
    db.add(baseline)
    db.commit()
    db.add_all([
        BaselineRule(baseline_id=baseline.id, key_path="line.vty.transport_input", expected_value="ssh",
                     rule_type="EXACT", severity_weight=95, hard_compliance=True),
        BaselineRule(baseline_id=baseline.id, key_path="snmp.community.public.exists", expected_value="false",
                     rule_type="MUST_NOT_EXIST", severity_weight=95, hard_compliance=True),
        BaselineRule(baseline_id=baseline.id, key_path="ntp.server", expected_value="10.10.0.1",
                     rule_type="EXACT", severity_weight=35, hard_compliance=False),
    ])
    db.commit()

    def override_get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    tokens = {
        role: create_access_token({"sub": str(u.id), "username": u.username, "role": role})
        for role, u in users.items()
    }
    headers = {r: {"Authorization": f"Bearer {t}"} for r, t in tokens.items()}

    yield {
        "client": client, "db": db, "Session": Session, "device_id": device.id,
        "group_id": group.id, "users": users, "h": headers,
    }
    app.dependency_overrides.pop(get_db, None)
    db.close()


def _upload(env, cfg, role="NetworkEngineer", device_id=None, **extra):
    body = {"config_text": cfg, **extra}
    return env["client"].post(
        f"/api/devices/{device_id or env['device_id']}/config-upload", json=body, headers=env["h"][role]
    )


# ---------------------------------------------------------------- happy paths

def test_upload_drifted_config_is_scored_like_an_ssh_snapshot(env):
    res = _upload(env, DRIFTED_CFG, source_filename="sw-legacy-01.cfg", note="console capture")
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["collection_method"] == "MANUAL_UPLOAD"
    assert data["snapshot_status"] == "SUCCESS"
    assert data["drift_label"] == "Non-Compliant (Critical)"
    assert data["risk_score"] >= 95
    assert len(data["sha256"]) == 64

    db = env["Session"]()
    snap = db.query(ConfigurationSnapshot).one()
    assert snap.collection_method == "MANUAL_UPLOAD"
    audit = db.query(AuditLog).filter(AuditLog.action == "CONFIG_UPLOADED").one()
    assert audit.after_state["source_filename"] == "sw-legacy-01.cfg"
    assert audit.after_state["sha256"] == data["sha256"]
    assert audit.user_id == env["users"]["NetworkEngineer"].id
    # critical drift raises an alert exactly like the SSH path
    assert db.query(Alert).filter(Alert.type == "CRITICAL_DRIFT").count() >= 1
    db.close()


def test_upload_compliant_config_reports_compliant(env):
    res = _upload(env, COMPLIANT_CFG)
    assert res.status_code == 201, res.text
    assert res.json()["drift_label"] == "Compliant"
    assert res.json()["risk_score"] == 0


def test_windows_line_endings_are_normalized(env):
    res = _upload(env, DRIFTED_CFG.replace("\n", "\r\n"))
    assert res.status_code == 201
    assert res.json()["drift_label"] == "Non-Compliant (Critical)"


def test_upload_does_not_touch_last_polled_or_mark_device_online(env):
    db = env["Session"]()
    dev = db.query(Device).one()
    dev.status = "UNREACHABLE"
    db.commit()
    db.close()
    assert _upload(env, COMPLIANT_CFG).status_code == 201
    db = env["Session"]()
    dev = db.query(Device).one()
    assert dev.last_polled_at is None
    assert dev.status == "UNREACHABLE"
    db.close()


def test_captured_at_drives_change_ticket_matching(env):
    """A legacy dump captured inside an approved maintenance window is authorized, even if uploaded later."""
    window_start = datetime.now(timezone.utc) - timedelta(days=3)
    db = env["Session"]()
    db.add(ChangeTicket(
        ticket_ref="CHG-LEGACY-1", source="internal", device_id=env["device_id"],
        key_path_scope="ntp.server", valid_from=window_start, valid_to=window_start + timedelta(hours=4),
        status="OPEN",
    ))
    db.commit()
    db.close()

    outside = _upload(env, NTP_DRIFT_CFG)  # captured "now": outside the window
    assert outside.status_code == 201
    assert outside.json()["drift_label"].startswith("Drift-Unauthorized")

    captured = (window_start + timedelta(hours=1)).isoformat()
    inside = _upload(env, NTP_DRIFT_CFG, captured_at=captured)
    assert inside.status_code == 201
    assert inside.json()["drift_label"] == "Drift-Authorized"


def test_unparseable_config_is_recorded_not_silently_skipped(env):
    res = _upload(env, MALFORMED_CFG)
    assert res.status_code == 201
    data = res.json()
    assert data["snapshot_status"] == "PARSE_ERROR"
    assert data["drift_label"] is None
    db = env["Session"]()
    assert db.query(ConfigurationSnapshot).filter_by(status="PARSE_ERROR").count() == 1
    assert db.query(Alert).filter(Alert.type == "CRITICAL_DRIFT").count() == 1
    assert db.query(DriftEvent).count() == 0
    db.close()


# ---------------------------------------------------------------- error boundaries

@pytest.mark.parametrize("payload", ["   \n\t \n", ])
def test_whitespace_only_upload_rejected(env, payload):
    res = _upload(env, payload)
    assert res.status_code == 422
    assert "empty" in res.json()["detail"].lower()


def test_empty_string_rejected_by_schema(env):
    assert _upload(env, "").status_code == 422


def test_binary_payload_rejected(env):
    res = _upload(env, "hostname x\x00\x01\x02binary")
    assert res.status_code == 422
    assert "binary" in res.json()["detail"].lower()


def test_oversized_payload_rejected_with_413(env, monkeypatch):
    monkeypatch.setattr(legacy, "MAX_UPLOAD_BYTES", 64)
    res = _upload(env, COMPLIANT_CFG)
    assert res.status_code == 413


def test_future_captured_at_rejected(env):
    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    res = _upload(env, COMPLIANT_CFG, captured_at=future)
    assert res.status_code == 422
    assert "future" in res.json()["detail"]


def test_hostname_mismatch_rejected_unless_overridden(env):
    other = COMPLIANT_CFG.replace(HOSTNAME, "sw-someone-else")
    res = _upload(env, other)
    assert res.status_code == 422
    assert "sw-someone-else" in res.json()["detail"]
    db = env["Session"]()
    assert db.query(ConfigurationSnapshot).count() == 0  # nothing persisted on rejection
    db.close()

    ok = _upload(env, other, allow_hostname_mismatch=True)
    assert ok.status_code == 201
    db = env["Session"]()
    audit = db.query(AuditLog).filter(AuditLog.action == "CONFIG_UPLOADED").one()
    assert audit.after_state["hostname_mismatch_overridden"] is True
    db.close()


def test_rejections_persist_nothing(env):
    for payload in ("   ", "a\x00b"):
        _upload(env, payload)
    db = env["Session"]()
    assert db.query(ConfigurationSnapshot).count() == 0
    assert db.query(AuditLog).filter(AuditLog.action == "CONFIG_UPLOADED").count() == 0
    db.close()


def test_unknown_device_404(env):
    res = _upload(env, COMPLIANT_CFG, device_id="00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404


def test_paused_device_rejects_upload_409(env):
    r = env["client"].put(
        f"/api/devices/{env['device_id']}/collection-mode",
        json={"collection_mode": "PAUSED"}, headers=env["h"]["Admin"],
    )
    assert r.status_code == 200
    assert _upload(env, COMPLIANT_CFG).status_code == 409


def test_decommissioned_device_rejects_upload_400(env):
    db = env["Session"]()
    db.query(Device).one().status = "DECOMMISSIONED"
    db.commit()
    db.close()
    assert _upload(env, COMPLIANT_CFG).status_code == 400


def test_viewer_cannot_upload_and_unauthenticated_rejected(env):
    assert _upload(env, COMPLIANT_CFG, role="Viewer").status_code == 403
    res = env["client"].post(f"/api/devices/{env['device_id']}/config-upload", json={"config_text": "x"})
    assert res.status_code == 401


# ---------------------------------------------------------------- modes

def test_mode_change_is_admin_only_audited_and_validated(env):
    url = f"/api/devices/{env['device_id']}/collection-mode"
    assert env["client"].put(url, json={"shadow_mode": True}, headers=env["h"]["NetworkEngineer"]).status_code == 403
    assert env["client"].put(url, json={"collection_mode": "BOGUS"}, headers=env["h"]["Admin"]).status_code == 422
    assert env["client"].put(url, json={}, headers=env["h"]["Admin"]).status_code == 422

    res = env["client"].put(url, json={"collection_mode": "SSH_POLL", "shadow_mode": True}, headers=env["h"]["Admin"])
    assert res.status_code == 200
    assert res.json() == {
        "device_id": str(env["device_id"]), "hostname": HOSTNAME,
        "collection_mode": "SSH_POLL", "shadow_mode": True,
    }
    db = env["Session"]()
    audit = db.query(AuditLog).filter(AuditLog.action == "COLLECTION_MODE_CHANGED").one()
    assert audit.before_state == {"collection_mode": "MANUAL_UPLOAD", "shadow_mode": False}
    assert audit.after_state == {"collection_mode": "SSH_POLL", "shadow_mode": True}
    db.close()


def test_device_endpoints_expose_modes(env):
    res = env["client"].get(f"/api/devices/{env['device_id']}", headers=env["h"]["Viewer"])
    assert res.status_code == 200
    assert res.json()["collection_mode"] == "MANUAL_UPLOAD"
    assert res.json()["shadow_mode"] is False
    listing = env["client"].get("/api/devices", headers=env["h"]["Viewer"]).json()
    assert listing[0]["collection_mode"] == "MANUAL_UPLOAD"


def test_ssh_poll_endpoint_refuses_non_ssh_devices(env):
    res = env["client"].post(f"/api/devices/{env['device_id']}/poll", headers=env["h"]["NetworkEngineer"])
    assert res.status_code == 409
    assert "MANUAL_UPLOAD" in res.json()["detail"]


def test_periodic_sweep_only_enqueues_ssh_managed_devices(env, monkeypatch):
    from app.tasks import collection as tasks

    db = env["Session"]()
    group_id = env["group_id"]
    db.add_all([
        Device(hostname="ssh-ok", ip_address="10.10.9.11", vendor="cisco_ios", model="m",
               device_group_id=group_id, collection_mode="SSH_POLL"),
        Device(hostname="paused", ip_address="10.10.9.12", vendor="cisco_ios", model="m",
               device_group_id=group_id, collection_mode="PAUSED"),
    ])
    db.commit()
    ssh_id = str(db.query(Device).filter_by(hostname="ssh-ok").one().id)
    db.close()

    enqueued = []

    class _Task:
        id = "t"

    monkeypatch.setattr(tasks, "SessionLocal", env["Session"])
    monkeypatch.setattr(tasks.poll_device_task, "delay", lambda dev_id, *a: enqueued.append(dev_id) or _Task())
    tasks.poll_all_devices_task()
    assert enqueued == [ssh_id]  # MANUAL_UPLOAD and PAUSED devices are skipped


# ---------------------------------------------------------------- remediation guard

def test_assert_remediation_allowed_matrix():
    ok = Device(hostname="a", collection_mode="SSH_POLL", shadow_mode=False)
    assert_remediation_allowed(ok)  # no exception
    for dev in (
        Device(hostname="b", collection_mode="SSH_POLL", shadow_mode=True),
        Device(hostname="c", collection_mode="MANUAL_UPLOAD", shadow_mode=False),
        Device(hostname="d", collection_mode="PAUSED", shadow_mode=False),
    ):
        with pytest.raises(HTTPException) as exc:
            assert_remediation_allowed(dev)
        assert exc.value.status_code == 409


def test_approved_plan_is_not_pushed_to_shadow_device(env, monkeypatch):
    """Report-only coexistence: plan can be generated and approved, but apply never opens an SSH session."""
    assert _upload(env, DRIFTED_CFG).status_code == 201
    db = env["Session"]()
    event = db.query(DriftEvent).filter(DriftEvent.status == "OPEN").first()
    neteng = env["users"]["NetworkEngineer"]
    admin = env["users"]["Admin"]
    plan = generate_remediation_plan(db, event.id, neteng.id)
    assert plan.proposed_commands  # commands remain visible for manual console application
    submit_approval(db, plan.id, "APPROVED", "ok", admin)

    def _boom(*a, **k):
        raise AssertionError("SSH session must not be opened for a non-SSH-managed device")

    monkeypatch.setattr("app.services.remediation._connect_to_device", _boom)

    # MANUAL_UPLOAD device
    with pytest.raises(HTTPException) as exc:
        apply_remediation_plan(db, plan.id, neteng.id)
    assert exc.value.status_code == 409

    # SSH_POLL + shadow_mode device
    dev = db.query(Device).one()
    dev.collection_mode = "SSH_POLL"
    dev.shadow_mode = True
    db.commit()
    with pytest.raises(HTTPException) as exc:
        apply_remediation_plan(db, plan.id, neteng.id)
    assert exc.value.status_code == 409
    assert "shadow" in exc.value.detail
    assert db.query(Backup).count() == 0
    db.close()
