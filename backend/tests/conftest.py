import pytest
from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.core.security import create_access_token
from app.models.users import User


@pytest.fixture(autouse=True)
def configure_celery_test_mode():
    """
    Ensure Celery connects to localhost Redis for broker and results.
    """
    celery_app.conf.update(
        broker_url="redis://localhost:6379/0",
        result_backend="redis://localhost:6379/0",
        task_always_eager=False,
    )
    yield


@pytest.fixture(scope="module")
def db_session():
    """Yields a database session connected to PostgreSQL."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module")
def neteng_token(db_session):
    neteng_user = db_session.query(User).filter(User.username == "neteng").first()
    if not neteng_user:
        pytest.skip("neteng user not seeded in database")
    return create_access_token({
        "sub": str(neteng_user.id),
        "username": neteng_user.username,
        "role": "NetworkEngineer",
    })


@pytest.fixture(scope="module")
def viewer_token(db_session):
    viewer_user = db_session.query(User).filter(User.username == "viewer").first()
    if not viewer_user:
        pytest.skip("viewer user not seeded in database")
    return create_access_token({
        "sub": str(viewer_user.id),
        "username": viewer_user.username,
        "role": "Viewer",
    })


@pytest.fixture(scope="module")
def admin_token(db_session):
    admin_user = db_session.query(User).filter(User.username == "admin").first()
    if not admin_user:
        pytest.skip("admin user not seeded in database")
    return create_access_token({
        "sub": str(admin_user.id),
        "username": admin_user.username,
        "role": "Admin",
    })
