"""
Unit Tests for Audit Log Service & Immutability Enforcement
----------------------------------------------------------
Tests Admin-only access to /api/audit, multi-field query filtering,
RBAC enforcement (NetEng/Viewer blocked), and application-layer immutability
guarantee (denies UPDATE and DELETE on audit_logs) per §9 and §13 of architecture.md.
"""
from datetime import datetime, timezone, timedelta
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.models.users import Role, User
from app.models.audit import AuditLog
from app.main import app


@pytest.fixture
def audit_test_env():
    """In-memory SQLite test environment for Audit API."""
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

    admin = User(username="admin_aud", password_hash="hash", role_id=r_admin.id, is_active=True)
    neteng = User(username="neteng_aud", password_hash="hash", role_id=r_neteng.id, is_active=True)
    viewer = User(username="viewer_aud", password_hash="hash", role_id=r_viewer.id, is_active=True)
    db.add_all([admin, neteng, viewer])
    db.commit()

    # Seed sample audit logs
    now = datetime.now(timezone.utc)
    l1 = AuditLog(
        user_id=admin.id,
        action="DEVICE_CREATED",
        target_type="device",
        target_id=None,
        before_state=None,
        after_state={"hostname": "sw-audit-01"},
        timestamp=now - timedelta(hours=2),
    )
    l2 = AuditLog(
        user_id=neteng.id,
        action="PLAN_APPROVED",
        target_type="approval",
        target_id=None,
        before_state={"status": "PENDING"},
        after_state={"status": "APPROVED"},
        timestamp=now - timedelta(hours=1),
    )
    l3 = AuditLog(
        user_id=None,  # Automated system action
        action="DRIFT_DETECTED",
        target_type="drift_event",
        target_id=None,
        before_state=None,
        after_state={"label": "Non-Compliant (Critical)"},
        timestamp=now,
    )
    db.add_all([l1, l2, l3])
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

    yield db, admin, neteng, viewer, client, tokens, [l1, l2, l3]

    app.dependency_overrides.clear()
    db.close()


def test_list_audit_logs_admin_and_filtering(audit_test_env):
    """Admin can query the audit trail and apply filters."""
    db, admin, neteng, viewer, client, tokens, logs = audit_test_env
    admin_headers = {"Authorization": f"Bearer {tokens['admin']}"}

    # 1. Unfiltered list
    res_all = client.get("/api/audit", headers=admin_headers)
    assert res_all.status_code == 200
    all_logs = res_all.json()
    assert len(all_logs) == 3
    # Check username inclusion
    assert any(log["username"] == "admin_aud" for log in all_logs)
    assert any(log["username"] == "neteng_aud" for log in all_logs)
    assert any(log["username"] is None for log in all_logs)  # system action

    # 2. Filter by action=PLAN_APPROVED
    res_action = client.get("/api/audit?action=PLAN_APPROVED", headers=admin_headers)
    assert res_action.status_code == 200
    action_logs = res_action.json()
    assert len(action_logs) == 1
    assert action_logs[0]["action"] == "PLAN_APPROVED"
    assert action_logs[0]["target_type"] == "approval"

    # 3. Filter by target_type=device
    res_type = client.get("/api/audit?target_type=device", headers=admin_headers)
    assert res_type.status_code == 200
    type_logs = res_type.json()
    assert len(type_logs) == 1
    assert type_logs[0]["action"] == "DEVICE_CREATED"

    # 4. Filter by user_id
    res_user = client.get(f"/api/audit?user_id={neteng.id}", headers=admin_headers)
    assert res_user.status_code == 200
    user_logs = res_user.json()
    assert len(user_logs) == 1
    assert user_logs[0]["username"] == "neteng_aud"


def test_list_audit_logs_rbac_enforcement(audit_test_env):
    """Viewer and NetworkEngineer roles are strictly blocked from /api/audit with 403 Forbidden (§9)."""
    db, admin, neteng, viewer, client, tokens, logs = audit_test_env

    res_viewer = client.get("/api/audit", headers={"Authorization": f"Bearer {tokens['viewer']}"})
    assert res_viewer.status_code == 403

    res_neteng = client.get("/api/audit", headers={"Authorization": f"Bearer {tokens['neteng']}"})
    assert res_neteng.status_code == 403


def test_audit_logs_immutability_denies_update_and_delete(audit_test_env):
    """
    Immutability Enforcement Test (§13):
    Application layer MUST deny UPDATE and DELETE operations on audit_logs records,
    raising an error if modification or deletion is attempted.
    """
    db, admin, neteng, viewer, client, tokens, logs = audit_test_env
    target_log = logs[0]

    # 1. Attempting an UPDATE on an audit record must raise PermissionError
    target_log.action = "TAMPERED_ACTION"
    with pytest.raises(PermissionError) as exc_update:
        db.flush()
    assert "AuditLog records are immutable: UPDATE operations are strictly prohibited" in str(exc_update.value)

    # Roll back the dirty session state
    db.rollback()

    # 2. Attempting a DELETE on an audit record must raise PermissionError
    fresh_log = db.query(AuditLog).first()
    assert fresh_log is not None
    db.delete(fresh_log)
    with pytest.raises(PermissionError) as exc_delete:
        db.flush()
    assert "AuditLog records are immutable: DELETE operations are strictly prohibited" in str(exc_delete.value)

    db.rollback()
