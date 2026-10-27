"""
Failure / edge-case suite: change tickets, time zones, DST, clock skew, malformed input (WP6).
"""
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token
from app.main import app
from app.models.tickets import ChangeTicket
from app.services.tickets import find_matching_ticket
from tests.failure_env import CLEAN_CFG, DRIFTED_CFG, build_env, open_event

NTP_DRIFT = DRIFTED_CFG.replace("snmp-server community public RO\n", "").replace("transport input telnet ssh", "transport input ssh").replace("ntp server 10.10.0.1", "ntp server 8.8.8.8")
CAPTURE = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def env():
    e = build_env()

    def override():
        s = e["Session"]()
        try:
            yield s
        finally:
            s.close()
    app.dependency_overrides[get_db] = override
    e["client"] = TestClient(app)
    e["h"] = {r: {"Authorization": "Bearer " + create_access_token({"sub": str(u.id), "username": u.username, "role": r})}
              for r, u in e["users"].items()}
    yield e
    app.dependency_overrides.pop(get_db, None)
    e["db"].close()


def label_for(env, captured_at, config=NTP_DRIFT):
    from app.services.collection import ingest_raw_configuration
    from app.models.drift import DriftEvent
    ingest_raw_configuration(env["db"], env["device"], config, "CORPUS", collected_at=captured_at)
    return env["db"].query(DriftEvent).order_by(DriftEvent.detected_at.desc()).first().label


def post_ticket(env, **over):
    body = {"ticket_ref": "CHG-1", "key_path_scope": "ntp.server", "device_id": str(env["device"].id),
            "valid_from": "2026-10-27T11:00:00Z", "valid_to": "2026-10-27T13:00:00Z", **over}
    return env["client"].post("/api/tickets", json=body, headers=env["h"]["NetworkEngineer"])


def webhook(env, payload):
    raw = json.dumps(payload).encode()
    sig = hmac.new(settings.ITSM_WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return env["client"].post("/api/tickets/webhook", content=raw, headers={"X-ITSM-Signature": f"sha256={sig}", "Content-Type": "application/json"})


# ---------------------------------------------------------------- windows are evaluated at capture time

def test_ticket_that_expired_before_the_poll_still_authorizes_a_capture_inside_its_window(env):
    assert post_ticket(env).status_code == 201                                 # window 11:00-13:00Z
    assert label_for(env, CAPTURE) == "Drift-Authorized"                       # captured 12:00Z, evaluated long after it expired


def test_capture_after_the_window_plus_grace_is_unauthorized(env):
    post_ticket(env)
    assert label_for(env, CAPTURE + timedelta(hours=1, minutes=45)).startswith("Drift-Unauthorized")


def test_closed_ticket_does_not_authorize_and_reopening_by_webhook_does(env):
    post_ticket(env, status="CLOSED")
    assert label_for(env, CAPTURE).startswith("Drift-Unauthorized")
    r = webhook(env, {"external_ref": "CHG-1", "source": "internal", "ticket_ref": "CHG-1", "key_path_scope": "ntp.server",
                      "hostname": "sw-h1", "valid_from": "2026-10-27T11:00:00Z", "valid_to": "2026-10-27T13:00:00Z", "status": "OPEN"})
    assert r.status_code == 200
    assert label_for(env, CAPTURE) == "Drift-Authorized"


# ---------------------------------------------------------------- time zones, DST, naive input

def test_offset_timestamps_are_converted_to_utc(env):
    r = post_ticket(env, valid_from="2026-10-27T16:30:00+05:30", valid_to="2026-10-27T18:30:00+05:30")   # = 11:00-13:00Z
    assert r.status_code == 201
    t = env["db"].query(ChangeTicket).one()
    assert (t.valid_from, t.valid_to) == (datetime(2026, 10, 27, 11, 0), datetime(2026, 10, 27, 13, 0))
    assert label_for(env, CAPTURE) == "Drift-Authorized"


def test_naive_timestamps_are_taken_as_utc(env):
    post_ticket(env, valid_from="2026-10-27T11:00:00", valid_to="2026-10-27T13:00:00")
    assert env["db"].query(ChangeTicket).one().valid_from == datetime(2026, 10, 27, 11, 0)


def test_dst_ambiguous_local_hour_resolves_to_distinct_instants(env):
    """UK clocks go back on 2026-10-25: 01:30 happens twice (BST +01:00, then GMT +00:00)."""
    post_ticket(env, ticket_ref="CHG-A", valid_from="2026-10-25T01:30:00+01:00", valid_to="2026-10-25T01:45:00+01:00")
    post_ticket(env, ticket_ref="CHG-B", valid_from="2026-10-25T01:30:00+00:00", valid_to="2026-10-25T01:45:00+00:00")
    a, b = (env["db"].query(ChangeTicket).filter_by(ticket_ref=r).one() for r in ("CHG-A", "CHG-B"))
    assert b.valid_from - a.valid_from == timedelta(hours=1)


def test_webhook_offsets_are_normalized_too(env):
    r = webhook(env, {"external_ref": "SN1", "source": "servicenow", "hostname": "sw-h1", "key_path_scope": "ntp.server",
                      "valid_from": "2026-10-27T21:00:00+10:00", "valid_to": "2026-10-27T23:00:00+10:00"})   # = 11:00-13:00Z
    assert r.status_code == 200
    assert env["db"].query(ChangeTicket).one().valid_from == datetime(2026, 10, 27, 11, 0)


# ---------------------------------------------------------------- malformed / conflicting input

def test_inverted_window_is_rejected_by_api_and_webhook(env):
    assert post_ticket(env, valid_from="2026-10-27T13:00:00Z", valid_to="2026-10-27T11:00:00Z").status_code == 400
    r = webhook(env, {"external_ref": "X", "hostname": "sw-h1", "key_path_scope": "ntp.server",
                      "valid_from": "2026-10-27T13:00:00Z", "valid_to": "2026-10-27T11:00:00Z"})
    assert r.status_code == 400
    assert env["db"].query(ChangeTicket).count() == 0


def test_malformed_and_unsigned_webhooks_persist_nothing(env):
    assert webhook(env, {"external_ref": "X"}).status_code == 422                            # missing required fields
    raw = json.dumps({"external_ref": "X", "key_path_scope": "a", "valid_from": "2026-10-27T11:00:00Z", "valid_to": "2026-10-27T13:00:00Z"}).encode()
    assert env["client"].post("/api/tickets/webhook", content=raw).status_code == 401       # unsigned
    assert env["client"].post("/api/tickets/webhook", content=raw, headers={"X-ITSM-Signature": "sha256=00"}).status_code == 401
    assert env["db"].query(ChangeTicket).count() == 0


def test_duplicate_webhook_delivery_is_idempotent(env):
    payload = {"external_ref": "SN9", "source": "servicenow", "hostname": "sw-h1", "key_path_scope": "ntp.server",
               "valid_from": "2026-10-27T11:00:00Z", "valid_to": "2026-10-27T13:00:00Z"}
    assert webhook(env, payload).status_code == 200
    assert webhook(env, payload).status_code == 200
    assert env["db"].query(ChangeTicket).count() == 1


def test_race_on_ticket_creation_is_resolved_as_a_redelivery(env, monkeypatch):
    """Simulate losing the insert race: the unique ticket_ref violation must become an update, not a 500."""
    payload = {"external_ref": "SN10", "source": "servicenow", "hostname": "sw-h1", "key_path_scope": "ntp.server",
               "valid_from": "2026-10-27T11:00:00Z", "valid_to": "2026-10-27T13:00:00Z"}
    s = env["Session"]()
    s.add(ChangeTicket(ticket_ref="SN10", source="servicenow", external_ref="SN10", device_id=env["device"].id,
                       key_path_scope="old", valid_from=datetime(2026, 1, 1), valid_to=datetime(2026, 1, 2)))
    s.commit()
    s.close()
    from sqlalchemy.orm import Query
    real_first = Query.first
    calls = {"n": 0}

    def blind_first(self):  # the pre-insert lookups miss (the other worker has not committed yet from our point of view)
        calls["n"] += 1
        return None if calls["n"] <= 3 else real_first(self)
    monkeypatch.setattr(Query, "first", blind_first)
    r = webhook(env, payload)
    monkeypatch.setattr(Query, "first", real_first)
    assert r.status_code == 200, r.text
    rows = env["db"].query(ChangeTicket).all()
    assert len(rows) == 1 and rows[0].key_path_scope == "ntp.server"


# ---------------------------------------------------------------- overlapping tickets

def test_overlapping_tickets_resolve_to_the_most_specific(env):
    db, dev = env["db"], env["device"]
    base = dict(source="internal", valid_from=datetime(2026, 10, 27, 11, 0), valid_to=datetime(2026, 10, 27, 13, 0), status="OPEN")
    db.add_all([
        ChangeTicket(ticket_ref="G", device_group_id=dev.device_group_id, key_path_scope="*", **base),
        ChangeTicket(ticket_ref="D", device_id=dev.id, key_path_scope="ntp.server", **base),
        ChangeTicket(ticket_ref="DW", device_id=dev.id, key_path_scope="ntp.*", **base),
    ])
    db.commit()
    assert find_matching_ticket(db, dev, "ntp.server", CAPTURE.replace(tzinfo=None)).ticket_ref == "D"


# ---------------------------------------------------------------- uploads: hostile input

def upload(env, text, **extra):
    return env["client"].post(f"/api/devices/{env['device'].id}/config-upload", headers=env["h"]["NetworkEngineer"],
                              json={"config_text": text, **extra})


def test_unpaired_surrogate_is_a_422_not_a_500(env):
    body = '{"config_text": "hostname sw-h1\\ud800\\nntp server 10.10.0.1"}'
    r = env["client"].post(f"/api/devices/{env['device'].id}/config-upload", headers={**env["h"]["NetworkEngineer"], "Content-Type": "application/json"}, content=body)
    assert r.status_code == 422
    assert "unicode" in r.text.lower() and "ntp server" not in r.text            # rejected, and the input is not echoed back


def test_validation_errors_do_not_echo_secrets(env):
    r = env["client"].post("/api/auth/login", json={"username": "admin", "password": 12345, "extra": "s3cret-value"})
    assert r.status_code == 422 and "12345" not in r.text and "s3cret" not in r.text


def test_clock_skew_tolerance_on_captured_at(env):
    now = datetime.now(timezone.utc)
    assert upload(env, CLEAN_CFG, captured_at=(now + timedelta(minutes=4)).isoformat()).status_code == 201
    assert upload(env, CLEAN_CFG, captured_at=(now + timedelta(minutes=10)).isoformat()).status_code == 422


def test_very_long_single_line_is_handled_without_error(env):
    r = upload(env, CLEAN_CFG + "x" * 900_000 + "\n")
    assert r.status_code == 201


def test_task_queue_down_is_a_503_not_a_500(env, monkeypatch):
    from kombu.exceptions import OperationalError
    from app.api import devices as devices_api
    env["device"].collection_mode = "SSH_POLL"
    env["db"].commit()
    monkeypatch.setattr(devices_api.poll_device_task, "delay", lambda *a, **k: (_ for _ in ()).throw(OperationalError("redis down")))
    r = env["client"].post(f"/api/devices/{env['device'].id}/poll", headers=env["h"]["NetworkEngineer"])
    assert r.status_code == 503 and "Task queue unavailable" in r.json()["detail"]
