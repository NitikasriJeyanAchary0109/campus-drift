"""
Unit Tests for Alerts API
-------------------------
Tests alert querying, multi-field filtering, acknowledgement by NetEng+,
RBAC enforcement (Viewer blocked from ack), and audit trail creation per §9 and §14.
"""
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.models.users import Role, User
from app.models.alerts import Alert
from app.models.audit import AuditLog
from app.main import app


@pytest.fixture
def alerts_test_env():
    """In-memory SQLite test environment for Alerts API."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = Session()

    # Roles & Users
    r_admin = Role(name="Admin")
    r_neteng = Role(name="NetworkEngineer")
    r_viewer = Role(name="Viewer")
    db.add_all([r_admin, r_neteng, r_viewer])
    db.commit()

    admin = User(username="admin_al", password_hash="hash", role_id=r_admin.id, is_active=True)
    neteng = User(username="neteng_al", password_hash="hash", role_id=r_neteng.id, is_active=True)
    viewer = User(username="viewer_al", password_hash="hash", role_id=r_viewer.id, is_active=True)
    db.add_all([admin, neteng, viewer])
    db.commit()

    # Seed diverse alerts
    now = datetime.now(timezone.utc)
    a1 = Alert(
        type="CRITICAL_DRIFT",
        message="Critical drift detected on sw-hostel-01",
        acknowledged=False,
        created_at=now,
    )
    a2 = Alert(
        type="DEVICE_DOWN",
        message="Device sw-lab-01 unreachable over SSH",
        acknowledged=False,
        created_at=now,
    )
    a3 = Alert(
        type="CRITICAL_DRIFT",
        message="Baseline missing for group Lab and vendor frr",
        acknowledged=True,
        created_at=now,
    )
    db.add_all([a1, a2, a3])
    db.commit()

    # Client & Tokens
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    tokens = {
        "admin": create_access_token({"sub": str(admin.id), "username": admin.username, "role": "Admin"}),
        "neteng": create_access_token({"sub": str(neteng.id), "username": neteng.username, "role": "NetworkEngineer"}),
        "viewer": create_access_token({"sub": str(viewer.id), "username": viewer.username, "role": "Viewer"}),
    }

    yield db, admin, neteng, viewer, client, tokens, [a1, a2, a3]

    app.dependency_overrides.clear()
    db.close()


def test_list_alerts_and_filtering(alerts_test_env):
    """Viewer+ can list alerts and filter by type and acknowledged state."""
    db, admin, neteng, viewer, client, tokens, alerts = alerts_test_env
    viewer_headers = {"Authorization": f"Bearer {tokens['viewer']}"}

    # 1. Unfiltered list
    res_all = client.get("/api/alerts", headers=viewer_headers)
    assert res_all.status_code == 200
    assert len(res_all.json()) == 3

    # 2. Filter by type=CRITICAL_DRIFT
    res_crit = client.get("/api/alerts?type=CRITICAL_DRIFT", headers=viewer_headers)
    assert res_crit.status_code == 200
    crit_list = res_crit.json()
    assert len(crit_list) == 2
    assert all(a["type"] == "CRITICAL_DRIFT" for a in crit_list)

    # 3. Filter by acknowledged=false
    res_unack = client.get("/api/alerts?acknowledged=false", headers=viewer_headers)
    assert res_unack.status_code == 200
    unack_list = res_unack.json()
    assert len(unack_list) == 2
    assert all(a["acknowledged"] is False for a in unack_list)

    # 4. Combined filter: type=CRITICAL_DRIFT & acknowledged=true
    res_ack_crit = client.get("/api/alerts?type=CRITICAL_DRIFT&acknowledged=true", headers=viewer_headers)
    assert res_ack_crit.status_code == 200
    ack_crit_list = res_ack_crit.json()
    assert len(ack_crit_list) == 1
    assert ack_crit_list[0]["message"] == "Baseline missing for group Lab and vendor frr"


def test_acknowledge_alert_neteng_and_audit(alerts_test_env):
    """NetEng+ can acknowledge alerts, updating state and creating an AuditLog entry."""
    db, admin, neteng, viewer, client, tokens, alerts = alerts_test_env
    neteng_headers = {"Authorization": f"Bearer {tokens['neteng']}"}
    target_alert = alerts[0]
    assert target_alert.acknowledged is False

    res_ack = client.post(f"/api/alerts/{target_alert.id}/ack", headers=neteng_headers)
    assert res_ack.status_code == 200
    data = res_ack.json()
    assert data["message"] == "Alert acknowledged successfully"
    assert data["alert"]["acknowledged"] is True

    # Confirm in database
    db.refresh(target_alert)
    assert target_alert.acknowledged is True

    # Confirm AuditLog created
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.target_id == target_alert.id, AuditLog.action == "ALERT_ACKNOWLEDGED")
        .first()
    )
    assert audit is not None
    assert audit.user_id == neteng.id
    assert audit.target_type == "alert"
    assert audit.after_state["acknowledged"] is True


def test_acknowledge_alert_rbac_viewer_blocked(alerts_test_env):
    """Viewer role is forbidden from acknowledging alerts (§9)."""
    db, admin, neteng, viewer, client, tokens, alerts = alerts_test_env
    viewer_headers = {"Authorization": f"Bearer {tokens['viewer']}"}
    target_alert = alerts[1]

    res_ack = client.post(f"/api/alerts/{target_alert.id}/ack", headers=viewer_headers)
    assert res_ack.status_code == 403


def test_acknowledge_nonexistent_alert_returns_404(alerts_test_env):
    """Acknowledging non-existent alert returns 404 Not Found."""
    db, admin, neteng, viewer, client, tokens, alerts = alerts_test_env
    neteng_headers = {"Authorization": f"Bearer {tokens['neteng']}"}
    fake_uuid = "00000000-0000-0000-0000-000000000000"

    res_ack = client.post(f"/api/alerts/{fake_uuid}/ack", headers=neteng_headers)
    assert res_ack.status_code == 404
