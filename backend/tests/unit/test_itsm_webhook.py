"""
Unit & Integration Tests for External ITSM Webhook Receiver
------------------------------------------------------------
Verifies HMAC-SHA256 signature authentication, payload parsing, device resolution,
idempotent delivery semantics, and drift authorization per Project Review #2.
"""
import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.devices import Device, DeviceGroup
from app.models.configurations import ConfigurationSnapshot
from app.models.baselines import Baseline, BaselineRule
from app.models.tickets import ChangeTicket
from app.models.users import Role, User
from app.services.drift import detect_drift
from app.main import app


def _compute_hmac(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


@pytest.fixture
def webhook_test_env(db_session: Session):
    uid = uuid.uuid4().hex[:8]
    # Setup group, device, baseline, admin
    role_admin = db_session.query(Role).filter(Role.name == "Admin").first()
    if not role_admin:
        role_admin = Role(name="Admin")
        db_session.add(role_admin)
        db_session.flush()

    admin = db_session.query(User).filter(User.username == "webhook_admin").first()
    if not admin:
        admin = User(username="webhook_admin", password_hash="hash", role_id=role_admin.id, is_active=True)
        db_session.add(admin)
        db_session.flush()

    group = DeviceGroup(name=f"Webhook-Group-{uid}", criticality_weight=1.0)
    db_session.add(group)
    db_session.flush()

    device = Device(
        hostname=f"sw-webhook-{uid}",
        ip_address=f"10.10.{int(uid[:2], 16) % 250}.{int(uid[2:4], 16) % 250 + 1}",
        vendor="cisco_ios",
        model="Catalyst 2960-X",
        device_group_id=group.id,
        status="ONLINE",
    )
    db_session.add(device)
    db_session.flush()

    baseline = Baseline(
        name=f"Webhook Baseline {uid}",
        vendor="cisco_ios",
        version=1,
        created_by=admin.id,
        device_group_id=group.id,
        is_active=True,
    )
    db_session.add(baseline)
    db_session.flush()

    rule = BaselineRule(
        baseline_id=baseline.id,
        key_path="interface.FastEthernet0/1.port_security.enabled",
        rule_type="EXACT",
        expected_value="true",
        severity_weight=80,
        hard_compliance=False,
    )
    db_session.add(rule)
    db_session.commit()

    return db_session, device, group, baseline, rule


def test_webhook_missing_signature_returns_401():
    """Unsigned requests without HMAC headers must be rejected with 401 Unauthorized."""
    client = TestClient(app)
    payload = {"external_ref": "CHG001", "key_path_scope": "interface.*", "valid_from": "2026-10-05T10:00:00Z", "valid_to": "2026-10-05T12:00:00Z"}
    res = client.post("/api/tickets/webhook", json=payload)
    assert res.status_code == 401
    assert "Missing HMAC signature" in res.json()["detail"]


def test_webhook_invalid_signature_returns_401():
    """Tampered or invalid signatures must be rejected with 401 Unauthorized."""
    client = TestClient(app)
    payload = {"external_ref": "CHG001", "key_path_scope": "interface.*", "valid_from": "2026-10-05T10:00:00Z", "valid_to": "2026-10-05T12:00:00Z"}
    body_bytes = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "X-ITSM-Signature": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
    }
    res = client.post("/api/tickets/webhook", content=body_bytes, headers=headers)
    assert res.status_code == 401
    assert "Invalid HMAC signature" in res.json()["detail"]


def test_webhook_valid_signature_creates_ticket(webhook_test_env):
    """Valid HMAC signature creates change ticket with source and external_ref."""
    db, device, group, _, _ = webhook_test_env
    client = TestClient(app)

    uid = uuid.uuid4().hex[:6]
    now = datetime.now(timezone.utc)
    payload = {
        "external_ref": f"CHG-{uid}",
        "ticket_ref": f"CHG-SRVNOW-{uid}",
        "source": "servicenow",
        "hostname": device.hostname,
        "key_path_scope": "interface.FastEthernet0/1.*",
        "valid_from": now.isoformat(),
        "valid_to": (now + timedelta(hours=4)).isoformat(),
        "status": "OPEN",
        "description": "Scheduled port security upgrade",
    }
    body_bytes = json.dumps(payload).encode("utf-8")
    sig = _compute_hmac(settings.ITSM_WEBHOOK_SECRET, body_bytes)

    headers = {
        "Content-Type": "application/json",
        "X-ITSM-Signature": f"sha256={sig}",
    }
    res = client.post("/api/tickets/webhook", content=body_bytes, headers=headers)
    assert res.status_code == 200
    data = res.json()

    assert data["ticket_ref"] == f"CHG-SRVNOW-{uid}"
    assert data["source"] == "servicenow"
    assert data["external_ref"] == f"CHG-{uid}"
    assert data["device_id"] == str(device.id)
    assert data["status"] == "OPEN"

    # Verify record in DB
    db.expire_all()
    ticket_db = db.query(ChangeTicket).filter(ChangeTicket.external_ref == f"CHG-{uid}").first()
    assert ticket_db is not None
    assert ticket_db.source == "servicenow"
    assert ticket_db.device_id == device.id


def test_webhook_idempotent_redelivery_updates_existing_ticket(webhook_test_env):
    """Re-delivery of the same (external_ref, source) updates existing record without duplicate."""
    db, device, _, _, _ = webhook_test_env
    client = TestClient(app)

    uid = uuid.uuid4().hex[:6]
    now = datetime.now(timezone.utc)
    payload_initial = {
        "external_ref": f"JIRA-{uid}",
        "source": "jira",
        "hostname": device.hostname,
        "key_path_scope": "interface.*",
        "valid_from": now.isoformat(),
        "valid_to": (now + timedelta(hours=2)).isoformat(),
        "status": "OPEN",
    }
    body_initial = json.dumps(payload_initial).encode("utf-8")
    sig_initial = _compute_hmac(settings.ITSM_WEBHOOK_SECRET, body_initial)
    res_1 = client.post("/api/tickets/webhook", content=body_initial, headers={"X-ITSM-Signature": sig_initial})
    assert res_1.status_code == 200

    # Extended window re-delivery
    extended_to = (now + timedelta(hours=6)).isoformat()
    payload_update = {
        "external_ref": f"JIRA-{uid}",
        "source": "jira",
        "hostname": device.hostname,
        "key_path_scope": "interface.FastEthernet0/1.*",
        "valid_from": now.isoformat(),
        "valid_to": extended_to,
        "status": "OPEN",
    }
    body_update = json.dumps(payload_update).encode("utf-8")
    sig_update = _compute_hmac(settings.ITSM_WEBHOOK_SECRET, body_update)
    res_2 = client.post("/api/tickets/webhook", content=body_update, headers={"X-Hub-Signature-256": f"sha256={sig_update}"})
    assert res_2.status_code == 200
    data_2 = res_2.json()
    assert data_2["key_path_scope"] == "interface.FastEthernet0/1.*"

    # Assert only 1 ticket exists with external_ref JIRA-{uid}
    db.expire_all()
    matching_tickets = db.query(ChangeTicket).filter(ChangeTicket.external_ref == f"JIRA-{uid}").all()
    assert len(matching_tickets) == 1
    assert matching_tickets[0].key_path_scope == "interface.FastEthernet0/1.*"


def test_webhook_created_ticket_authorizes_drift(webhook_test_env):
    """Confirm that a change ticket created via ITSM webhook correctly authorizes drift in detect_drift."""
    db, device, _, baseline, _ = webhook_test_env
    client = TestClient(app)

    uid = uuid.uuid4().hex[:6]
    now = datetime.now(timezone.utc)
    payload = {
        "external_ref": f"CHG-AUTH-{uid}",
        "source": "servicenow",
        "hostname": device.hostname,
        "key_path_scope": "interface.FastEthernet0/1.port_security.enabled",
        "valid_from": (now - timedelta(minutes=30)).isoformat(),
        "valid_to": (now + timedelta(minutes=30)).isoformat(),
        "status": "OPEN",
    }
    body_bytes = json.dumps(payload).encode("utf-8")
    sig = _compute_hmac(settings.ITSM_WEBHOOK_SECRET, body_bytes)
    res = client.post("/api/tickets/webhook", content=body_bytes, headers={"X-ITSM-Signature": sig})
    assert res.status_code == 200

    db.expire_all()

    # Snapshot with port_security disabled on FastEthernet0/1 (differs from baseline 'true')
    snap_tree = {
        "interface": {
            "FastEthernet0/1": {
                "port_security": {"enabled": "false"}
            }
        }
    }
    snap = ConfigurationSnapshot(
        device_id=device.id,
        raw_config="raw",
        normalized_json=snap_tree,
        status="SUCCESS",
        collected_at=now,
    )
    db.add(snap)
    db.commit()

    event = detect_drift(db, device, snap, baseline)
    assert event is not None
    assert event.label == "Drift-Authorized"
    assert 1 <= event.risk_score <= 30
    assert event.matched_ticket_id is not None
    assert event.matched_ticket.external_ref == f"CHG-AUTH-{uid}"
    assert event.matched_ticket.source == "servicenow"
