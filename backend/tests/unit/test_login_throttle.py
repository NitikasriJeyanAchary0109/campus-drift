"""Failed-login throttle: lockout after repeated failures, per username and address, reset on success, audit trail, Redis-less fallback."""
import time

import pytest
from app.api import auth as auth_api
from app.core.security import get_password_hash
from app.core.throttle import LoginThrottle
from fastapi.testclient import TestClient

from tests.failure_env import build_env


def test_counter_locks_after_the_limit_and_expires():
    t = LoginThrottle(None, max_failures=3, window_seconds=1)
    k = t.key("Admin", "1.2.3.4")
    for _ in range(2):
        t.record_failure(k)
    assert t.retry_after(k) == 0
    t.record_failure(k)
    assert t.retry_after(k) >= 1
    time.sleep(1.1)
    assert t.retry_after(k) == 0


def test_keys_are_per_user_and_per_address_and_case_insensitive():
    t = LoginThrottle(None, max_failures=1, window_seconds=60)
    t.record_failure(t.key("admin", "1.1.1.1"))
    assert t.retry_after(t.key("ADMIN", "1.1.1.1")) > 0
    assert t.retry_after(t.key("admin", "2.2.2.2")) == 0
    assert t.retry_after(t.key("viewer", "1.1.1.1")) == 0


def test_reset_clears_the_counter():
    t = LoginThrottle(None, max_failures=1, window_seconds=60)
    k = t.key("a", "b")
    t.record_failure(k)
    t.reset(k)
    assert t.retry_after(k) == 0


def test_an_unreachable_redis_falls_back_to_the_process_counter():
    t = LoginThrottle("redis://127.0.0.1:1/0", max_failures=1, window_seconds=60)
    k = t.key("a", "b")
    t.record_failure(k)
    assert t.retry_after(k) > 0


@pytest.fixture
def client(monkeypatch):
    env = build_env()
    env["users"]["Admin"].password_hash = get_password_hash("right-password")
    env["db"].commit()
    from app.core.database import get_db
    from app.main import app
    app.dependency_overrides[get_db] = lambda: env["db"]
    monkeypatch.setattr(auth_api, "throttle", LoginThrottle(None, max_failures=3, window_seconds=60))
    yield TestClient(app), env
    app.dependency_overrides.clear()


def login(c, pw, user="admin_f"):
    return c.post("/api/auth/login", json={"username": user, "password": pw})


def test_wrong_passwords_lock_the_account_out_even_for_the_right_password(client):
    c, env = client
    assert [login(c, "bad").status_code for _ in range(3)] == [401, 401, 401]
    locked = login(c, "right-password")
    assert locked.status_code == 429 and int(locked.headers["Retry-After"]) > 0
    assert login(c, "right-password", user="viewer_f").status_code in (401, 200)   # another username is not affected


def test_a_successful_login_resets_the_counter(client):
    c, _ = client
    login(c, "bad")
    login(c, "bad")
    assert login(c, "right-password").status_code == 200
    assert [login(c, "bad").status_code for _ in range(2)] == [401, 401]


def test_failures_are_audited_without_the_password(client):
    from app.models.audit import AuditLog
    c, env = client
    login(c, "super-secret-wrong")
    rows = env["db"].query(AuditLog).filter_by(action="LOGIN_FAILED").all()
    assert len(rows) == 1 and "super-secret-wrong" not in str(rows[0].after_state)
