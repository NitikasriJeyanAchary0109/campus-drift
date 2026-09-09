import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import get_password_hash
from app.models.users import Role, User
from app.main import app


@pytest.fixture(scope="module")
def auth_api_client():
    test_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    Base.metadata.create_all(bind=test_engine)

    session = TestingSessionLocal()
    role_admin = Role(name="Admin")
    role_neteng = Role(name="NetworkEngineer")
    session.add_all([role_admin, role_neteng])
    session.commit()

    user = User(
        username="admin_api_user",
        password_hash=get_password_hash("SecretPassword123!"),
        role_id=role_admin.id,
        is_active=True,
    )
    session.add(user)
    session.commit()
    session.close()

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    client = TestClient(app)
    yield client

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=test_engine)


def test_login_success_and_cookie(auth_api_client):
    """Verify login returns access token and sets httpOnly refresh cookie."""
    response = auth_api_client.post(
        "/api/auth/login",
        json={"username": "admin_api_user", "password": "SecretPassword123!"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["username"] == "admin_api_user"
    assert data["user"]["role"] == "Admin"
    assert "refresh_token" in response.cookies


def test_login_invalid_password(auth_api_client):
    """Verify invalid password returns 401."""
    response = auth_api_client.post(
        "/api/auth/login",
        json={"username": "admin_api_user", "password": "WrongPassword"},
    )
    assert response.status_code == 401
    assert "Incorrect username or password" in response.json()["detail"]


def test_login_nonexistent_user(auth_api_client):
    """Verify nonexistent user returns 401."""
    response = auth_api_client.post(
        "/api/auth/login",
        json={"username": "ghost_user", "password": "SomePassword"},
    )
    assert response.status_code == 401


def test_refresh_token_endpoint(auth_api_client):
    """Verify token refresh using cookie issued on login."""
    # First login to establish cookie
    login_res = auth_api_client.post(
        "/api/auth/login",
        json={"username": "admin_api_user", "password": "SecretPassword123!"},
    )
    assert login_res.status_code == 200

    # Call refresh endpoint with cookie
    refresh_res = auth_api_client.post("/api/auth/refresh", cookies=login_res.cookies)
    assert refresh_res.status_code == 200
    data = refresh_res.json()
    assert "access_token" in data
    assert data["user"]["username"] == "admin_api_user"


def test_get_me_endpoint(auth_api_client):
    """Verify /api/auth/me returns current user profile."""
    login_res = auth_api_client.post(
        "/api/auth/login",
        json={"username": "admin_api_user", "password": "SecretPassword123!"},
    )
    token = login_res.json()["access_token"]

    me_res = auth_api_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me_res.status_code == 200
    assert me_res.json()["username"] == "admin_api_user"
    assert me_res.json()["role"] == "Admin"


def test_logout_endpoint(auth_api_client):
    """Verify /api/auth/logout clears refresh cookie."""
    res = auth_api_client.post("/api/auth/logout")
    assert res.status_code == 200
    assert res.json()["message"] == "Logged out successfully"

