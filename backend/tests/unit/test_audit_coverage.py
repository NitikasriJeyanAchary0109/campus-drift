"""
Every state change, authentication event, webhook delivery and baseline change leaves an audit entry.
The entry is written in the same transaction as the change, so there is no change without a record.
"""
import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from app.core.config import settings
from app.main import app
from app.models.audit import AuditLog
from app.models.devices import Device, DeviceGroup
from fastapi.testclient import TestClient

client = TestClient(app)


def _actions(db, action):
    db.expire_all()
    return db.query(AuditLog).filter(AuditLog.action == action).order_by(AuditLog.timestamp).all()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def group(db_session):
    g = DeviceGroup(name=f"G-{uuid.uuid4().hex[:6]}", criticality_weight=1.0)
    db_session.add(g)
    db_session.commit()
    return g


def test_sign_in_sign_out_and_refresh_are_recorded(db_session):
    bad = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert bad.status_code == 401
    good = client.post("/api/auth/login", json={"username": "admin", "password": "password123"})
    assert good.status_code == 200
    assert len(_actions(db_session, "LOGIN_FAILED")) == 1
    ok = _actions(db_session, "LOGIN_SUCCEEDED")
    assert len(ok) == 1 and ok[0].after_state["username"] == "admin" and ok[0].user_id is not None
    assert "password" not in json.dumps(ok[0].after_state)

    refreshed = client.post("/api/auth/refresh")  # the cookie from the sign-in is kept by the client
    assert refreshed.status_code == 200
    assert len(_actions(db_session, "TOKEN_REFRESHED")) == 1

    client.post("/api/auth/logout")
    out = _actions(db_session, "LOGOUT")
    assert len(out) == 1 and out[0].user_id == ok[0].user_id
    client.cookies.clear()


def test_refused_refresh_is_recorded(db_session):
    res = client.post("/api/auth/refresh", json={"refresh_token": "not-a-token"})
    assert res.status_code == 401
    refused = _actions(db_session, "TOKEN_REFRESH_REFUSED")
    assert len(refused) == 1
    client.cookies.clear()


def test_device_create_update_and_decommission_are_recorded_with_what_changed(db_session, admin_token, group):
    body = {"hostname": "sw-audit-1", "ip_address": "10.77.0.1", "vendor": "cisco_ios", "model": "x",
            "device_group_id": str(group.id), "status": "ONLINE"}
    created = client.post("/api/devices", json=body, headers=_auth(admin_token))
    assert created.status_code == 201
    dev_id = created.json()["id"]
    entry = _actions(db_session, "DEVICE_CREATED")[0]
    assert str(entry.target_id) == dev_id and entry.after_state["hostname"] == "sw-audit-1" and entry.user_id

    upd = client.put(f"/api/devices/{dev_id}", json={"model": "y"}, headers=_auth(admin_token))
    assert upd.status_code == 200
    changed = _actions(db_session, "DEVICE_UPDATED")[0]
    assert changed.before_state == {"model": "x"} and changed.after_state == {"model": "y"}

    assert client.delete(f"/api/devices/{dev_id}", headers=_auth(admin_token)).status_code == 200
    gone = _actions(db_session, "DEVICE_DECOMMISSIONED")[0]
    assert gone.before_state == {"status": "ONLINE"} and gone.after_state == {"status": "DECOMMISSIONED"}


def test_baseline_create_and_activate_are_recorded(db_session, admin_token, neteng_token, group):
    res = client.post("/api/baselines", headers=_auth(neteng_token),
                      json={"name": "B1", "device_group_id": str(group.id), "vendor": "cisco_ios", "rules": []})
    assert res.status_code == 201
    bid = res.json()["id"]
    made = _actions(db_session, "BASELINE_CREATED")[0]
    assert str(made.target_id) == bid and made.after_state["version"] == 1 and made.user_id

    act = client.put(f"/api/baselines/{bid}/activate", headers=_auth(admin_token))
    assert act.status_code == 200
    activated = _actions(db_session, "BASELINE_ACTIVATED")[0]
    assert str(activated.target_id) == bid and activated.user_id and activated.before_state["previous_active_baseline_id"] is None


def test_manual_ticket_is_recorded(db_session, neteng_token, group):
    now = datetime.now(timezone.utc)
    res = client.post("/api/tickets", headers=_auth(neteng_token), json={
        "ticket_ref": "CHG-AUDIT-1", "key_path_scope": "interface.*", "device_group_id": str(group.id), "status": "APPROVED",
        "valid_from": (now - timedelta(hours=1)).isoformat(), "valid_to": (now + timedelta(hours=1)).isoformat()})
    assert res.status_code == 201
    entry = _actions(db_session, "TICKET_CREATED")[0]
    assert entry.after_state["ticket_ref"] == "CHG-AUDIT-1" and entry.user_id


def _signed_delivery(body: dict):
    raw = json.dumps(body).encode()
    ts = str(int(time.time()))
    sig = hmac.new(settings.ITSM_WEBHOOK_SECRET.encode(), f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    return raw, {"X-ITSM-Signature": sig, "X-ITSM-Timestamp": ts, "Content-Type": "application/json"}


def test_webhook_delivery_is_recorded_with_its_body_and_digest(db_session, group):
    now = datetime.now(timezone.utc)
    body = {"external_ref": "SN-1", "ticket_ref": "CHG-WH-1", "group_name": group.name, "key_path_scope": "interface.*", "status": "APPROVED",
            "valid_from": (now - timedelta(hours=1)).isoformat(), "valid_to": (now + timedelta(hours=1)).isoformat()}
    raw, headers = _signed_delivery(body)
    res = client.post("/api/tickets/webhook", content=raw, headers=headers)
    assert res.status_code == 200, res.text
    entry = _actions(db_session, "ITSM_WEBHOOK_ACCEPTED")[0]
    assert entry.after_state["body_sha256"] == hashlib.sha256(raw).hexdigest()
    assert json.loads(entry.after_state["body"])["external_ref"] == "SN-1"
    assert str(entry.target_id) == res.json()["id"]


def test_unsigned_delivery_is_recorded_without_its_body(db_session):
    raw = json.dumps({"external_ref": "evil", "note": "x" * 5000}).encode()
    res = client.post("/api/tickets/webhook", content=raw, headers={"X-ITSM-Signature": "00" * 32, "Content-Type": "application/json"})
    assert res.status_code == 401
    entry = _actions(db_session, "ITSM_WEBHOOK_REJECTED")[0]
    assert entry.after_state["authenticated"] is False and entry.after_state["http_status"] == 401
    assert entry.after_state["body_sha256"] == hashlib.sha256(raw).hexdigest()
    assert "body" not in entry.after_state, "an unauthenticated sender must not be able to write its own text into the trail"


def test_signed_but_refused_delivery_keeps_the_body_for_investigation(db_session):
    now = datetime.now(timezone.utc)
    raw, headers = _signed_delivery({"external_ref": "SN-9", "hostname": "no-such-switch", "key_path_scope": "interface.*", "status": "APPROVED",
                                     "valid_from": (now - timedelta(hours=1)).isoformat(), "valid_to": (now + timedelta(hours=1)).isoformat()})
    res = client.post("/api/tickets/webhook", content=raw, headers=headers)
    assert res.status_code == 422
    entry = _actions(db_session, "ITSM_WEBHOOK_REJECTED")[0]
    assert entry.after_state["authenticated"] is True and entry.after_state["http_status"] == 422
    assert "no-such-switch" in entry.after_state["body"]
    assert db_session.query(Device).filter(Device.hostname == "no-such-switch").count() == 0


def test_a_username_with_a_nul_character_is_an_ordinary_failed_sign_in(db_session):
    res = client.post("/api/auth/login", json={"username": "ad\u0000min", "password": "x"})
    assert res.status_code == 401
    entry = _actions(db_session, "LOGIN_FAILED")[0]
    assert "\u0000" not in entry.after_state["username"]


def test_a_webhook_body_with_a_nul_byte_is_still_recorded(db_session):
    raw = b'{"external_ref": "a\x00b"}'
    res = client.post("/api/tickets/webhook", content=raw, headers={"X-ITSM-Signature": "00" * 32})
    assert res.status_code == 401
    assert len(_actions(db_session, "ITSM_WEBHOOK_REJECTED")) == 1
