import pytest
from app.core.celery_app import celery_app
from app.core.database import Base, get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.models.users import Role, User
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture(autouse=True)
def configure_unit_celery_test_mode(monkeypatch):
    """Ensure Celery tasks execute eagerly or do not attempt remote socket connections."""
    celery_app.conf.update(
        broker_url="memory://",
        result_backend="cache+memory://",
        task_always_eager=True,
        task_eager_propagates=True,
    )
    yield


@pytest.fixture(autouse=True)
def isolated_login_throttle(monkeypatch):
    """Unit tests never touch a real Redis: wrong passwords from earlier runs must not lock out this run."""
    from app.api import auth as auth_api
    from app.core.throttle import LoginThrottle
    monkeypatch.setattr(auth_api, "throttle", LoginThrottle(None))
    yield


@pytest.fixture(autouse=True)
def fast_remediation_retries(monkeypatch):
    """The restore and verification-read back-off is real time in production; tests do not wait for it."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "ROLLBACK_RETRY_DELAY_SECONDS", 0.0)
    yield


@pytest.fixture
def db_session():
    """Isolated in-memory SQLite database for unit tests."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()

    # Pre-seed default roles
    roles = {}
    for r_name in ["Admin", "NetworkEngineer", "Viewer"]:
        role = Role(name=r_name)
        session.add(role)
        session.flush()
        roles[r_name] = role

    pwd_hash = get_password_hash("password123")
    for u_name, r_name in [("admin", "Admin"), ("neteng", "NetworkEngineer"), ("viewer", "Viewer")]:
        user = User(
            username=u_name,
            password_hash=pwd_hash,
            role_id=roles[r_name].id,
            is_active=True,
        )
        session.add(user)
    session.commit()

    # Override get_db for FastAPI TestClient in unit tests
    app.dependency_overrides[get_db] = lambda: session

    try:
        yield session
    finally:
        app.dependency_overrides.pop(get_db, None)
        session.close()


@pytest.fixture
def neteng_token(db_session):
    neteng_user = db_session.query(User).filter(User.username == "neteng").first()
    return create_access_token({
        "sub": str(neteng_user.id),
        "username": neteng_user.username,
        "role": "NetworkEngineer",
    })


@pytest.fixture
def viewer_token(db_session):
    viewer_user = db_session.query(User).filter(User.username == "viewer").first()
    return create_access_token({
        "sub": str(viewer_user.id),
        "username": viewer_user.username,
        "role": "Viewer",
    })


@pytest.fixture
def admin_token(db_session):
    admin_user = db_session.query(User).filter(User.username == "admin").first()
    return create_access_token({
        "sub": str(admin_user.id),
        "username": admin_user.username,
        "role": "Admin",
    })
