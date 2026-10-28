"""
Failure / edge-case suite on real PostgreSQL: per-device locks, concurrent polls, concurrent webhook
deliveries and session time zone (WP6). These cannot be reproduced on SQLite.
"""
import hashlib
import hmac
import json
import threading
import time
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import settings
from app.core.database import SessionLocal, engine
from app.main import app
from app.models.configurations import ConfigurationSnapshot
from app.models.devices import Device
from app.models.tickets import ChangeTicket
from app.services import collection
from app.services.collection import DeviceBusyError, collect_device_configuration
from app.services.locks import device_lock

CLEAN = "hostname sw-classroom-01\nntp server 10.10.0.1\nline vty 0 4\n transport input ssh\nend\n"


@pytest.fixture(scope="module")
def db_session():
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        pytest.skip("PostgreSQL not available")
    yield db
    db.close()


def test_session_timezone_is_utc_whatever_the_server_default_is(db_session):
    assert db_session.execute(text("SHOW timezone")).scalar().upper() == "UTC"
    aware = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)
    assert db_session.execute(text("SELECT CAST(:ts AS timestamp)"), {"ts": aware}).scalar() == datetime(2026, 10, 27, 12, 0)


def test_device_lock_is_exclusive_and_released(db_session):
    dev = uuid.uuid4()
    s1, s2 = SessionLocal(), SessionLocal()
    try:
        with device_lock(s1, dev) as first:
            assert first is True
            with device_lock(s2, dev) as second:
                assert second is False            # held by the first session
            with device_lock(s2, uuid.uuid4()) as other:
                assert other is True              # other devices are independent
        with device_lock(s2, dev) as again:
            assert again is True                  # released after the block
    finally:
        s1.close()
        s2.close()


def test_lock_survives_commits_on_the_callers_session(db_session):
    """The ORM session swaps connections at every commit; the lock must not depend on the session's connection."""
    dev = uuid.uuid4()
    s1, s2 = SessionLocal(), SessionLocal()
    try:
        with device_lock(s1, dev) as first:
            for _ in range(3):
                s1.execute(text("SELECT 1"))
                s1.commit()
            with device_lock(s2, dev) as second:
                assert first is True and second is False
    finally:
        s1.close()
        s2.close()


def test_lock_is_released_when_the_block_raises(db_session):
    dev = uuid.uuid4()
    s1, s2 = SessionLocal(), SessionLocal()
    try:
        with pytest.raises(RuntimeError):
            with device_lock(s1, dev):
                raise RuntimeError("push failed")
        with device_lock(s2, dev) as got:
            assert got is True
    finally:
        s1.close()
        s2.close()


def test_two_simultaneous_polls_of_one_device_create_one_snapshot(db_session, monkeypatch):
    device = db_session.query(Device).filter(Device.hostname == "sw-classroom-01").first()
    if not device:
        pytest.skip("sw-classroom-01 not seeded")

    class SlowConn:
        def send_command(self, cmd, **_):
            time.sleep(1.0)
            return CLEAN

        def disconnect(self):
            pass

    monkeypatch.setattr(collection, "ConnectHandler", lambda **kw: SlowConn())
    before = db_session.query(ConfigurationSnapshot).filter_by(device_id=device.id).count()
    outcomes = []

    def poll():
        s = SessionLocal()
        try:
            collect_device_configuration(s, device.id)
            outcomes.append("ok")
        except DeviceBusyError:
            outcomes.append("busy")
        except Exception as e:  # pragma: no cover
            outcomes.append(f"error:{e}")
        finally:
            s.close()

    threads = [threading.Thread(target=poll) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(outcomes) == ["busy", "ok"], outcomes
    db_session.expire_all()
    assert db_session.query(ConfigurationSnapshot).filter_by(device_id=device.id).count() == before + 1


def test_concurrent_webhook_deliveries_create_exactly_one_ticket(db_session):
    ref = f"RACE-{uuid.uuid4().hex[:8]}"
    payload = json.dumps({"external_ref": ref, "source": "servicenow", "hostname": "sw-classroom-01", "key_path_scope": "ntp.server",
                          "valid_from": "2026-10-27T11:00:00Z", "valid_to": "2026-10-27T13:00:00Z"}).encode()
    sig = hmac.new(settings.ITSM_WEBHOOK_SECRET.encode(), payload, hashlib.sha256).hexdigest()
    statuses = []
    barrier = threading.Barrier(8)

    def deliver():
        client = TestClient(app)
        barrier.wait()
        r = client.post("/api/tickets/webhook", content=payload, headers={"X-ITSM-Signature": f"sha256={sig}", "Content-Type": "application/json"})
        statuses.append(r.status_code)

    threads = [threading.Thread(target=deliver) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    try:
        db_session.expire_all()
        rows = db_session.query(ChangeTicket).filter(ChangeTicket.external_ref == ref).all()
        assert statuses.count(200) == 8, statuses            # no 500 from the unique-constraint race
        assert len(rows) == 1
    finally:
        db_session.query(ChangeTicket).filter(ChangeTicket.external_ref == ref).delete()
        db_session.commit()
