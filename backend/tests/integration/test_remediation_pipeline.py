"""
Integration Tests for Remediation & Rollback Pipeline
-----------------------------------------------------
Demonstrates real end-to-end remediation and automated rollback against the
running simulated switch sw-hostel-01 container.
Includes:
1. Setup/Teardown fixture resetting simulator to pristine drifted state for repeatable runs.
2. Full Happy Path:
   Drift detected -> Plan generated -> Approved -> Applied via Netmiko -> Verified -> RESOLVED.
3. Approval Gate Enforcement:
   Applying an unapproved plan is rejected with HTTP 409 Conflict.
4. Genuine Rollback Demonstration:
   Verification failure triggers automated rollback, reverts device running-config
   to pre-change backup, confirms rollback verification, raises CRITICAL alert, and logs audit.
"""
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient
from netmiko import ConnectHandler

from app.core.database import SessionLocal
from app.core.security import create_access_token
from app.models.users import User
from app.models.devices import Device
from app.models.baselines import Baseline
from app.models.drift import DriftEvent, DriftDetail
from app.models.configurations import ConfigurationSnapshot
from app.models.remediation import RemediationPlan, Approval, RemediationAction, Backup
from app.models.alerts import Alert
from app.models.audit import AuditLog
from app.services.collection import collect_device_configuration
from app.services.remediation import (
    generate_remediation_plan,
    submit_approval,
    apply_remediation_plan,
    _connect_to_device,
)
from app.main import app


@pytest.fixture(scope="module")
def db_session():
    """Yields database session connected to PostgreSQL container."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module")
def tokens(db_session):
    """Provides JWT tokens for Viewer, NetworkEngineer, and Admin."""
    cache = {}
    for username, role_name in [("viewer", "Viewer"), ("neteng", "NetworkEngineer"), ("admin", "Admin")]:
        user = db_session.query(User).filter(User.username == username).first()
        if not user:
            pytest.skip(f"User {username} not seeded in database")
        token = create_access_token({
            "sub": str(user.id),
            "username": user.username,
            "role": role_name,
        })
        cache[username] = token
    return cache


@pytest.fixture(autouse=True)
def reset_hostel_switch_fixture(db_session):
    """
    Setup & Teardown fixture for simulator state isolation (User item #4):
    Resets sw-hostel-01 to its pristine drifted configuration before and after every test,
    guaranteeing that mutations do not leak between test runs.
    """
    device = db_session.query(Device).filter(Device.hostname == "sw-hostel-01").first()
    if not device:
        yield
        return

    def _reset():
        try:
            conn = _connect_to_device(db_session, device)
            conn.send_command("simulator-reset-pristine")
            conn.disconnect()
        except Exception:
            pass

    # Pre-test reset
    _reset()
    yield
    # Post-test reset
    _reset()


def test_approval_gate_prevents_unapproved_remediation(db_session, tokens):
    """
    Approval Gate Enforcement (§6 & §13):
    An unapproved remediation plan MUST be rejected with 409 Conflict
    when sent to /api/remediation/{id}/apply, even when called directly.
    """
    device = db_session.query(Device).filter(Device.hostname == "sw-hostel-01").first()
    if not device:
        pytest.skip("sw-hostel-01 not seeded in database")

    client = TestClient(app)
    neteng_headers = {"Authorization": f"Bearer {tokens['neteng']}"}

    # 1. Collect configuration to establish a drift event
    snapshot = collect_device_configuration(db=db_session, device_id=device.id)
    drift_event = (
        db_session.query(DriftEvent)
        .filter(DriftEvent.device_id == device.id, DriftEvent.snapshot_id == snapshot.id)
        .order_by(DriftEvent.detected_at.desc())
        .first()
    )
    assert drift_event is not None

    # 2. Generate remediation plan
    res_gen = client.post(f"/api/remediation/{drift_event.id}/generate-plan", headers=neteng_headers)
    assert res_gen.status_code == 201
    plan_id = res_gen.json()["id"]

    # 3. Attempt to apply WITHOUT approval -> MUST return 409 Conflict
    res_apply = client.post(f"/api/remediation/{plan_id}/apply", headers=neteng_headers)
    assert res_apply.status_code == 409
    assert "not been approved" in res_apply.json()["detail"]


def test_remediation_happy_path_with_device_verification(db_session, tokens):
    """
    Full Happy Path Demonstration (§6):
    1. Drift detected on sw-hostel-01 (SSH telnet + SNMP public).
    2. Remediation plan generated via whitelisted templates.
    3. Plan approved by NetworkEngineer.
    4. Plan applied via Netmiko.
    5. Pre-change backup verified in DB.
    6. Post-change running configuration re-polled and verified against baseline.
    7. DriftEvent marked RESOLVED and device verified compliant.
    """
    device = db_session.query(Device).filter(Device.hostname == "sw-hostel-01").first()
    if not device:
        pytest.skip("sw-hostel-01 not seeded in database")

    client = TestClient(app)
    neteng_headers = {"Authorization": f"Bearer {tokens['neteng']}"}

    # 1. Collect configuration & detect drift
    snapshot = collect_device_configuration(db=db_session, device_id=device.id)
    drift_event = (
        db_session.query(DriftEvent)
        .filter(DriftEvent.device_id == device.id, DriftEvent.snapshot_id == snapshot.id)
        .order_by(DriftEvent.detected_at.desc())
        .first()
    )
    assert drift_event is not None
    assert drift_event.label == "Non-Compliant (Critical)"
    assert drift_event.status == "OPEN"

    # 2. Generate Remediation Plan
    res_gen = client.post(f"/api/remediation/{drift_event.id}/generate-plan", headers=neteng_headers)
    assert res_gen.status_code == 201
    plan_data = res_gen.json()
    plan_id = plan_data["id"]
    commands = plan_data["proposed_commands"]

    # Assert expected template CLI statements
    assert any("line vty" in c for c in commands)
    assert any("transport input ssh" in c for c in commands)
    assert any("no snmp-server community public" in c for c in commands)

    # 3. Approve Plan
    res_appr = client.post(
        f"/api/approvals/{plan_id}",
        json={"decision": "APPROVED", "comment": "Approved during scheduled maintenance window"},
        headers=neteng_headers,
    )
    assert res_appr.status_code == 201
    assert res_appr.json()["decision"] == "APPROVED"

    # 4. Apply Plan via API
    res_apply = client.post(f"/api/remediation/{plan_id}/apply", headers=neteng_headers)
    assert res_apply.status_code == 200
    apply_data = res_apply.json()
    assert apply_data["result"] == "SUCCESS"
    assert apply_data["verification_passed"] is True

    # 5. Verify pre-change Backup in database
    backup = (
        db_session.query(Backup)
        .filter(Backup.device_id == device.id)
        .order_by(Backup.taken_at.desc())
        .first()
    )
    assert backup is not None
    assert "transport input telnet ssh" in backup.config_blob or "transport input ssh telnet" in backup.config_blob
    assert "snmp-server community public" in backup.config_blob

    # 6. Verify drift event status updated to RESOLVED
    db_session.refresh(drift_event)
    assert drift_event.status == "RESOLVED"

    # 7. Check actual device running configuration over SSH
    conn = _connect_to_device(db_session, device)
    try:
        new_running_cfg = conn.send_command("show running-config")
        # Assert telnet is gone from transport input and only ssh remains
        assert "transport input ssh" in new_running_cfg
        assert "transport input telnet" not in new_running_cfg
        # Assert public community is removed
        assert "snmp-server community public" not in new_running_cfg
    finally:
        conn.disconnect()


def test_remediation_automated_rollback_demonstration(db_session, tokens):
    """
    Genuine Rollback Demonstration (§6 & §14):
    1. Capture pre-change device configuration.
    2. Generate and approve remediation plan.
    3. Execute apply with verification failure simulated.
    4. Assert automated rollback fires immediately.
    5. Assert device's running-config reverts to the pre-change backup state.
    6. Assert remediation action result is ROLLED_BACK.
    7. Assert CRITICAL_DRIFT alert and detailed audit record are created.
    """
    device = db_session.query(Device).filter(Device.hostname == "sw-hostel-01").first()
    if not device:
        pytest.skip("sw-hostel-01 not seeded in database")

    client = TestClient(app)
    neteng_headers = {"Authorization": f"Bearer {tokens['neteng']}"}

    # 1. Read initial device configuration state before any change
    conn_pre = _connect_to_device(db_session, device)
    try:
        initial_cfg = conn_pre.send_command("show running-config")
    finally:
        conn_pre.disconnect()

    assert "snmp-server community public" in initial_cfg

    # 2. Collect & establish drift event
    snapshot = collect_device_configuration(db=db_session, device_id=device.id)
    drift_event = (
        db_session.query(DriftEvent)
        .filter(DriftEvent.device_id == device.id, DriftEvent.snapshot_id == snapshot.id)
        .order_by(DriftEvent.detected_at.desc())
        .first()
    )
    assert drift_event is not None

    # 3. Generate and Approve plan
    res_gen = client.post(f"/api/remediation/{drift_event.id}/generate-plan", headers=neteng_headers)
    assert res_gen.status_code == 201
    plan_id = res_gen.json()["id"]

    res_appr = client.post(
        f"/api/approvals/{plan_id}",
        json={"decision": "APPROVED", "comment": "Approved for rollback verification test"},
        headers=neteng_headers,
    )
    assert res_appr.status_code == 201

    # 4. Apply plan with force_fail=True to trigger verification failure
    res_apply = client.post(f"/api/remediation/{plan_id}/apply?force_fail=true", headers=neteng_headers)
    assert res_apply.status_code == 200
    data = res_apply.json()

    # 5. Assert result is ROLLED_BACK
    assert data["result"] == "ROLLED_BACK"
    assert data["verification_passed"] is False

    # 6. Capture and assert on intermediate device state (User Item #1):
    # Retrieve the verification snapshot taken immediately after commands were pushed
    # but before automated rollback was executed.
    action = db_session.query(RemediationAction).filter(RemediationAction.id == data["action_id"]).first()
    assert action is not None
    assert action.verification_snapshot_id is not None

    intermediate_snapshot = (
        db_session.query(ConfigurationSnapshot)
        .filter(ConfigurationSnapshot.id == action.verification_snapshot_id)
        .first()
    )
    assert intermediate_snapshot is not None
    intermediate_cfg = intermediate_snapshot.raw_config

    # Assert Intermediate State genuinely differs from Pre-Change State:
    # Commands ('no snmp-server community public' and 'transport input ssh') took effect:
    assert "snmp-server community public" not in intermediate_cfg
    assert "transport input ssh" in intermediate_cfg
    assert "transport input telnet" not in intermediate_cfg
    assert intermediate_cfg != initial_cfg

    # 7. Verify device state reverted to pre-change backup after rollback
    conn_post = _connect_to_device(db_session, device)
    try:
        post_rollback_cfg = conn_post.send_command("show running-config")
    finally:
        conn_post.disconnect()

    # Pre-change config state MUST be restored: SNMP public and telnet are present again
    assert "snmp-server community public" in post_rollback_cfg
    assert "transport input telnet" in post_rollback_cfg

    # Assert all 3 states are provably distinct:
    # State 1 (Pre-change) != State 2 (Intermediate)
    # State 2 (Intermediate) != State 3 (Post-rollback)
    assert initial_cfg != intermediate_cfg
    assert intermediate_cfg != post_rollback_cfg

    # 8. Verify CRITICAL alert generated
    alert = (
        db_session.query(Alert)
        .filter(Alert.type == "CRITICAL_DRIFT", Alert.related_id == data["action_id"])
        .order_by(Alert.created_at.desc())
        .first()
    )
    assert alert is not None
    assert "Remediation verification failed" in alert.message
    assert "Automated rollback" in alert.message

    # 9. Verify AuditLog entry
    audit = (
        db_session.query(AuditLog)
        .filter(AuditLog.target_id == data["action_id"], AuditLog.action == "REMEDIATION_ROLLED_BACK")
        .first()
    )
    assert audit is not None
    assert audit.after_state["failure_reason"] == "Verification failed post-change"
    assert audit.after_state["rollback_result"] == "SUCCESSFULLY_RESTORED_TO_BACKUP"


def test_admin_manual_rollback_trigger_restores_backup_and_creates_audit_log(db_session, tokens):
    """
    Explicit Admin Manual Rollback Test per User Request 2(b):
    1. Tests RBAC: Viewer and NetworkEngineer are blocked with 403 Forbidden.
    2. Admin directly triggers POST /api/remediation/{plan_id}/rollback.
    3. Confirms device running configuration is restored to pre-change backup.
    4. Confirms AuditLog record (action=MANUAL_ROLLBACK) is persisted with Admin user_id.
    """
    device = db_session.query(Device).filter(Device.hostname == "sw-hostel-01").first()
    if not device:
        pytest.skip("sw-hostel-01 not seeded in database")

    client = TestClient(app)
    admin_headers = {"Authorization": f"Bearer {tokens['admin']}"}
    neteng_headers = {"Authorization": f"Bearer {tokens['neteng']}"}
    viewer_headers = {"Authorization": f"Bearer {tokens['viewer']}"}

    # 1. Collect configuration & establish drift event
    snapshot = collect_device_configuration(db=db_session, device_id=device.id)
    drift_event = (
        db_session.query(DriftEvent)
        .filter(DriftEvent.device_id == device.id, DriftEvent.snapshot_id == snapshot.id)
        .order_by(DriftEvent.detected_at.desc())
        .first()
    )
    assert drift_event is not None

    # 2. Generate and approve remediation plan
    res_gen = client.post(f"/api/remediation/{drift_event.id}/generate-plan", headers=neteng_headers)
    assert res_gen.status_code == 201
    plan_id = res_gen.json()["id"]

    res_appr = client.post(
        f"/api/approvals/{plan_id}",
        json={"decision": "APPROVED", "comment": "Approved for manual rollback verification"},
        headers=neteng_headers,
    )
    assert res_appr.status_code == 201

    # 3. Apply the plan successfully (creates pre-change backup in DB)
    res_apply = client.post(f"/api/remediation/{plan_id}/apply", headers=neteng_headers)
    assert res_apply.status_code == 200
    assert res_apply.json()["result"] == "SUCCESS"

    # Verify device state changed: SNMP public is now removed
    conn = _connect_to_device(db_session, device)
    try:
        cfg_after_apply = conn.send_command("show running-config")
        assert "snmp-server community public" not in cfg_after_apply
    finally:
        conn.disconnect()

    # 4. RBAC Check: Non-Admin roles MUST be rejected with 403 Forbidden (§9)
    res_viewer = client.post(f"/api/remediation/{plan_id}/rollback", headers=viewer_headers)
    assert res_viewer.status_code == 403

    res_neteng = client.post(f"/api/remediation/{plan_id}/rollback", headers=neteng_headers)
    assert res_neteng.status_code == 403

    # 5. Admin executes manual rollback via POST /api/remediation/{plan_id}/rollback
    res_rollback = client.post(f"/api/remediation/{plan_id}/rollback", headers=admin_headers)
    assert res_rollback.status_code == 200
    rb_data = res_rollback.json()
    assert rb_data["result"] == "ROLLED_BACK"
    assert "Manual rollback executed" in rb_data["message"]

    # 6. Verify device state reverted to pre-change backup (SNMP public is restored)
    conn2 = _connect_to_device(db_session, device)
    try:
        cfg_after_rollback = conn2.send_command("show running-config")
        assert "snmp-server community public" in cfg_after_rollback
    finally:
        conn2.disconnect()

    # 7. Verify AuditLog entry created with Admin user_id
    admin_user = db_session.query(User).filter(User.username == "admin").first()
    audit = (
        db_session.query(AuditLog)
        .filter(AuditLog.target_id == rb_data["action_id"], AuditLog.action == "MANUAL_ROLLBACK")
        .first()
    )
    assert audit is not None
    assert audit.user_id == admin_user.id
    assert audit.target_type == "remediation"
    assert audit.after_state["result"] == "ROLLED_BACK"

