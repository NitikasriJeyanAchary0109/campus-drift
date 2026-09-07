import uuid
import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import get_password_hash, create_access_token
from app.core.rbac import (
    require_admin,
    require_neteng,
    require_viewer,
    ROLE_ADMIN,
    ROLE_NETWORK_ENGINEER,
    ROLE_VIEWER,
)
from app.models.users import Role, User


# Setup in-memory SQLite for testing RBAC dependency isolation
@pytest.fixture(scope="module")
def rbac_test_env():
    test_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    Base.metadata.create_all(bind=test_engine)

    # Seed roles and test users
    session = TestingSessionLocal()
    role_admin = Role(name=ROLE_ADMIN)
    role_neteng = Role(name=ROLE_NETWORK_ENGINEER)
    role_viewer = Role(name=ROLE_VIEWER)
    session.add_all([role_admin, role_neteng, role_viewer])
    session.commit()

    user_admin = User(
        username="admin_test",
        password_hash=get_password_hash("pass"),
        role_id=role_admin.id,
        is_active=True,
    )
    user_neteng = User(
        username="neteng_test",
        password_hash=get_password_hash("pass"),
        role_id=role_neteng.id,
        is_active=True,
    )
    user_viewer = User(
        username="viewer_test",
        password_hash=get_password_hash("pass"),
        role_id=role_viewer.id,
        is_active=True,
    )
    user_inactive = User(
        username="inactive_test",
        password_hash=get_password_hash("pass"),
        role_id=role_admin.id,
        is_active=False,
    )
    session.add_all([user_admin, user_neteng, user_viewer, user_inactive])
    session.commit()

    # Create dummy FastAPI test app
    test_app = FastAPI()

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    test_app.dependency_overrides[get_db] = override_get_db

    @test_app.get("/admin-only", dependencies=[Depends(require_admin)])
    def admin_endpoint():
        return {"status": "admin_granted"}

    @test_app.get("/neteng-route", dependencies=[Depends(require_neteng)])
    def neteng_endpoint():
        return {"status": "neteng_granted"}

    @test_app.get("/viewer-route", dependencies=[Depends(require_viewer)])
    def viewer_endpoint():
        return {"status": "viewer_granted"}

    client = TestClient(test_app)

    tokens = {
        "admin": create_access_token({"sub": str(user_admin.id), "username": "admin_test", "role": ROLE_ADMIN}),
        "neteng": create_access_token({"sub": str(user_neteng.id), "username": "neteng_test", "role": ROLE_NETWORK_ENGINEER}),
        "viewer": create_access_token({"sub": str(user_viewer.id), "username": "viewer_test", "role": ROLE_VIEWER}),
        "inactive": create_access_token({"sub": str(user_inactive.id), "username": "inactive_test", "role": ROLE_ADMIN}),
    }

    yield client, tokens

    Base.metadata.drop_all(bind=test_engine)


def test_admin_can_access_all_routes(rbac_test_env):
    client, tokens = rbac_test_env
    headers = {"Authorization": f"Bearer {tokens['admin']}"}

    res = client.get("/admin-only", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"status": "admin_granted"}

    res = client.get("/neteng-route", headers=headers)
    assert res.status_code == 200

    res = client.get("/viewer-route", headers=headers)
    assert res.status_code == 200


def test_neteng_allowed_on_neteng_and_viewer(rbac_test_env):
    client, tokens = rbac_test_env
    headers = {"Authorization": f"Bearer {tokens['neteng']}"}

    res = client.get("/neteng-route", headers=headers)
    assert res.status_code == 200

    res = client.get("/viewer-route", headers=headers)
    assert res.status_code == 200


def test_neteng_blocked_from_admin_route(rbac_test_env):
    """NetworkEngineer MUST be blocked from Admin-only routes."""
    client, tokens = rbac_test_env
    headers = {"Authorization": f"Bearer {tokens['neteng']}"}

    res = client.get("/admin-only", headers=headers)
    assert res.status_code == 403
    assert "Insufficient permissions" in res.json()["detail"]


def test_viewer_blocked_from_admin_and_neteng_routes(rbac_test_env):
    """Viewer MUST be blocked from both Admin-only and NetEng-only routes."""
    client, tokens = rbac_test_env
    headers = {"Authorization": f"Bearer {tokens['viewer']}"}

    # Blocked from admin
    res_admin = client.get("/admin-only", headers=headers)
    assert res_admin.status_code == 403
    assert "Insufficient permissions" in res_admin.json()["detail"]

    # Blocked from neteng
    res_neteng = client.get("/neteng-route", headers=headers)
    assert res_neteng.status_code == 403
    assert "Insufficient permissions" in res_neteng.json()["detail"]

    # Allowed on viewer
    res_viewer = client.get("/viewer-route", headers=headers)
    assert res_viewer.status_code == 200
    assert res_viewer.json() == {"status": "viewer_granted"}


def test_unauthenticated_request_blocked(rbac_test_env):
    """Request without token must return 401."""
    client, _ = rbac_test_env
    res = client.get("/viewer-route")
    assert res.status_code == 401
    assert "Authentication credentials required" in res.json()["detail"]


def test_inactive_user_blocked(rbac_test_env):
    """Inactive user must return 403."""
    client, tokens = rbac_test_env
    headers = {"Authorization": f"Bearer {tokens['inactive']}"}
    res = client.get("/admin-only", headers=headers)
    assert res.status_code == 403
    assert "Inactive user account" in res.json()["detail"]
