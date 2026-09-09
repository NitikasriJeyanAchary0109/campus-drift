"""
Integration RBAC & Approval Gate Spot-Checks
--------------------------------------------
Exercises and proves the 5 core security and approval boundaries across all 3 seeded roles:
1. Viewer attempting POST /api/devices/{id}/poll -> HTTP 403 Forbidden
2. Viewer attempting POST /api/alerts/{id}/ack -> HTTP 403 Forbidden
3. NetEng attempting GET /api/audit -> HTTP 403 Forbidden
4. NetEng attempting POST /api/remediation/{plan_id}/rollback -> HTTP 403 Forbidden
5. Applying an unapproved plan via POST /api/remediation/{plan_id}/apply -> HTTP 409 Conflict
"""
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.rbac import ROLE_ADMIN, ROLE_NETWORK_ENGINEER, ROLE_VIEWER
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.models.alerts import Alert
from app.models.baselines import Baseline
from app.models.devices import Device, DeviceGroup
from app.models.drift import DriftEvent, DriftDetail
from app.models.remediation import RemediationPlan, Approval
from app.models.users import Role, User


@pytest.fixture(scope="module")
def spotcheck_env():
    from app.core.database import SessionLocal

    db: Session = SessionLocal()

    # Ensure roles exist
    admin_role = db.query(Role).filter(Role.name == ROLE_ADMIN).first()
    if not admin_role:
        admin_role = Role(name=ROLE_ADMIN)
        db.add(admin_role)

    neteng_role = db.query(Role).filter(Role.name == ROLE_NETWORK_ENGINEER).first()
    if not neteng_role:
        neteng_role = Role(name=ROLE_NETWORK_ENGINEER)
        db.add(neteng_role)

    viewer_role = db.query(Role).filter(Role.name == ROLE_VIEWER).first()
    if not viewer_role:
        viewer_role = Role(name=ROLE_VIEWER)
        db.add(viewer_role)
    db.commit()

    # Seed users
    suffix = uuid.uuid4().hex[:6]
    admin_user = User(
        username=f"admin_sc_{suffix}",
        password_hash=get_password_hash("testpass"),
        role_id=admin_role.id,
        is_active=True,
    )
    neteng_user = User(
        username=f"neteng_sc_{suffix}",
        password_hash=get_password_hash("testpass"),
        role_id=neteng_role.id,
        is_active=True,
    )
    viewer_user = User(
        username=f"viewer_sc_{suffix}",
        password_hash=get_password_hash("testpass"),
        role_id=viewer_role.id,
        is_active=True,
    )
    db.add_all([admin_user, neteng_user, viewer_user])
    db.commit()

    # Seed DeviceGroup, Device, Alert, and RemediationPlan
    group = DeviceGroup(name=f"SpotCheck_Group_{suffix}", criticality_weight=1.0)
    db.add(group)
    db.commit()

    device = Device(
        hostname=f"sw-spotcheck-{suffix}",
        ip_address="10.99.1.1",
        vendor="cisco_ios",
        model="Catalyst 2960",
        status="ONLINE",
        device_group_id=group.id,
    )
    db.add(device)
    db.commit()

    alert = Alert(
        type="CRITICAL_DRIFT",
        related_id=device.id,
        message="Critical drift detected on spotcheck switch",
        acknowledged=False,
    )
    db.add(alert)
    db.commit()

    from app.models.configurations import ConfigurationSnapshot
    snap = ConfigurationSnapshot(
        device_id=device.id,
        raw_config="hostname test",
        normalized_json={"hostname": "test"},
    )
    db.add(snap)
    db.commit()

    event = DriftEvent(
        device_id=device.id,
        snapshot_id=snap.id,
        label="Drift-Unauthorized-High",
        risk_score=85,
        status="OPEN",
    )
    db.add(event)
    db.commit()

    # Unapproved remediation plan (status=PENDING, no Approval record)
    unapproved_plan = RemediationPlan(
        drift_event_id=event.id,
        proposed_commands=["configure terminal", "line vty 0 4", "transport input ssh", "end"],
        status="PENDING",
    )
    db.add(unapproved_plan)
    db.commit()

    tokens = {
        "admin": create_access_token({"sub": str(admin_user.id), "username": admin_user.username, "role": ROLE_ADMIN}),
        "neteng": create_access_token({"sub": str(neteng_user.id), "username": neteng_user.username, "role": ROLE_NETWORK_ENGINEER}),
        "viewer": create_access_token({"sub": str(viewer_user.id), "username": viewer_user.username, "role": ROLE_VIEWER}),
    }

    client = TestClient(app)

    yield {
        "db": db,
        "client": client,
        "tokens": tokens,
        "device": device,
        "alert": alert,
        "unapproved_plan": unapproved_plan,
        "admin_user": admin_user,
        "neteng_user": neteng_user,
        "viewer_user": viewer_user,
    }

    # Cleanup
    db.delete(unapproved_plan)
    db.delete(event)
    db.delete(alert)
    db.delete(device)
    db.delete(group)
    db.delete(viewer_user)
    db.delete(neteng_user)
    db.delete(admin_user)
    db.commit()
    db.close()


def test_spotcheck_1_viewer_cannot_poll_device(spotcheck_env):
    """
    Check 1: Viewer attempting POST /api/devices/{id}/poll -> assert HTTP 403 Forbidden.
    Device polling requires NetEng or Admin privilege.
    """
    client = spotcheck_env["client"]
    viewer_headers = {"Authorization": f"Bearer {spotcheck_env['tokens']['viewer']}"}
    device_id = spotcheck_env["device"].id

    res = client.post(f"/api/devices/{device_id}/poll", headers=viewer_headers)
    assert res.status_code == 403, f"Expected 403 Forbidden for Viewer on poll, got {res.status_code}"
    assert "Insufficient permissions" in res.json().get("detail", "")


def test_spotcheck_2_viewer_cannot_ack_alert(spotcheck_env):
    """
    Check 2: Viewer attempting POST /api/alerts/{id}/ack -> assert HTTP 403 Forbidden.
    Alert acknowledgement requires NetEng or Admin privilege.
    """
    client = spotcheck_env["client"]
    viewer_headers = {"Authorization": f"Bearer {spotcheck_env['tokens']['viewer']}"}
    alert_id = spotcheck_env["alert"].id

    res = client.post(f"/api/alerts/{alert_id}/ack", headers=viewer_headers)
    assert res.status_code == 403, f"Expected 403 Forbidden for Viewer on alert ack, got {res.status_code}"
    assert "Insufficient permissions" in res.json().get("detail", "")


def test_spotcheck_3_neteng_cannot_read_audit_logs(spotcheck_env):
    """
    Check 3: NetEng attempting GET /api/audit -> assert HTTP 403 Forbidden.
    Audit log access is strictly restricted to Admin role only.
    """
    client = spotcheck_env["client"]
    neteng_headers = {"Authorization": f"Bearer {spotcheck_env['tokens']['neteng']}"}

    res = client.get("/api/audit", headers=neteng_headers)
    assert res.status_code == 403, f"Expected 403 Forbidden for NetEng on audit trail, got {res.status_code}"
    assert "Insufficient permissions" in res.json().get("detail", "")


def test_spotcheck_4_neteng_cannot_trigger_manual_rollback(spotcheck_env):
    """
    Check 4: NetEng attempting POST /api/remediation/{plan_id}/rollback -> assert HTTP 403 Forbidden.
    Manual rollback is strictly an Admin-only privileged action.
    """
    client = spotcheck_env["client"]
    neteng_headers = {"Authorization": f"Bearer {spotcheck_env['tokens']['neteng']}"}
    plan_id = spotcheck_env["unapproved_plan"].id

    res = client.post(f"/api/remediation/{plan_id}/rollback", headers=neteng_headers)
    assert res.status_code == 403, f"Expected 403 Forbidden for NetEng on manual rollback, got {res.status_code}"
    assert "Insufficient permissions" in res.json().get("detail", "")


def test_spotcheck_5_applying_unapproved_plan_returns_409_conflict(spotcheck_env):
    """
    Check 5: Applying an unapproved plan (status=PENDING, no Approval) -> assert HTTP 409 Conflict.
    Service layer enforces hard approval gate before any configuration push.
    """
    client = spotcheck_env["client"]
    neteng_headers = {"Authorization": f"Bearer {spotcheck_env['tokens']['neteng']}"}
    plan_id = spotcheck_env["unapproved_plan"].id

    res = client.post(f"/api/remediation/{plan_id}/apply", headers=neteng_headers)
    assert res.status_code == 409, f"Expected 409 Conflict for unapproved plan apply, got {res.status_code}"
    assert "has not been approved" in res.json().get("detail", "").lower()
