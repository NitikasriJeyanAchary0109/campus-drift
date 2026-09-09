"""
Integration Tests for Drift Detection & Evidence Generation Pipeline
---------------------------------------------------------------------
Tests the full end-to-end flow:
1. SSH collection against simulated device sw-hostel-01.
2. Automated drift detection triggered on collection.
3. Accurate classification as Non-Compliant (Critical) with risk score >= 95.
4. Generation of CRITICAL_DRIFT alert for score >= 80.
5. API retrieval of drift event, filtered listing, and full evidence bundle.
6. Authorized drift classification when matched by a ChangeTicket.
7. Marking false positive with mandatory comment and audit logging.
"""
from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import create_access_token
from app.models.users import User, Role
from app.models.devices import Device, DeviceGroup
from app.models.baselines import Baseline, BaselineRule
from app.models.configurations import ConfigurationSnapshot
from app.models.tickets import ChangeTicket
from app.models.drift import DriftEvent, DriftDetail
from app.models.alerts import Alert
from app.models.audit import AuditLog
from app.services.collection import collect_device_configuration
from app.services.drift import detect_drift, build_evidence_bundle
from app.main import app


@pytest.fixture(scope="module")
def db_session():
    """Yields a database session connected to the PostgreSQL container."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module")
def tokens(db_session):
    """Provides JWT tokens for Viewer, NetworkEngineer, and Admin."""
    user_cache = {}
    for username, role_name in [("viewer", "Viewer"), ("neteng", "NetworkEngineer"), ("admin", "Admin")]:
        user = db_session.query(User).filter(User.username == username).first()
        if not user:
            pytest.skip(f"User {username} not seeded in database")
        token = create_access_token({
            "sub": str(user.id),
            "username": user.username,
            "role": role_name,
        })
        user_cache[username] = token
    return user_cache


def test_pipeline_hostel_switch_e2e_drift_and_alert(db_session):
    """
    Poll sw-hostel-01 simulated switch, verify snapshot persistence,
    automatic drift detection, Non-Compliant (Critical) label (score >= 95),
    and CRITICAL_DRIFT alert creation.
    """
    device = db_session.query(Device).filter(Device.hostname == "sw-hostel-01").first()
    if not device:
        pytest.skip("sw-hostel-01 not seeded in database")

    # Ensure active baseline exists for device group
    baseline = (
        db_session.query(Baseline)
        .filter(Baseline.device_group_id == device.device_group_id, Baseline.is_active == True)
        .first()
    )
    if not baseline:
        pytest.skip(f"No active baseline found for device group {device.device_group_id}")

    # Perform collection via SSH (which automatically triggers detect_drift)
    try:
        snapshot = collect_device_configuration(db=db_session, device_id=device.id)
    except Exception as e:
        pytest.skip(f"Simulated device sw-hostel-01 not reachable: {e}")

    assert snapshot.status == "SUCCESS"

    # Query latest drift event for sw-hostel-01
    drift_event = (
        db_session.query(DriftEvent)
        .filter(DriftEvent.device_id == device.id, DriftEvent.snapshot_id == snapshot.id)
        .order_by(DriftEvent.detected_at.desc())
        .first()
    )
    assert drift_event is not None, "DriftEvent was not created by collect_device_configuration"
    assert drift_event.label == "Non-Compliant (Critical)"
    assert drift_event.risk_score >= 95
    assert drift_event.status == "OPEN"

    # Verify drift details: telnet enabled and snmp community public
    rule_paths = {d.key_path for d in drift_event.details}
    assert "line.vty.transport_input" in rule_paths
    assert "snmp.community.public.exists" in rule_paths

    for detail in drift_event.details:
        if detail.key_path == "line.vty.transport_input":
            assert detail.rule.rule_type == "EXACT"
            assert detail.expected_value == "ssh"
            assert "telnet" in detail.actual_value
            assert detail.rule.severity_weight == 90
        elif detail.key_path == "snmp.community.public.exists":
            assert detail.rule.rule_type == "MUST_NOT_EXIST"
            assert detail.actual_value == "true"
            assert detail.rule.severity_weight == 95

    # Verify CRITICAL_DRIFT alert was generated
    alert = (
        db_session.query(Alert)
        .filter(
            Alert.type == "CRITICAL_DRIFT",
            Alert.related_id == drift_event.id,
        )
        .order_by(Alert.created_at.desc())
        .first()
    )
    assert alert is not None
    assert "Non-Compliant (Critical)" in alert.message
    assert "sw-hostel-01" in alert.message


def test_pipeline_drift_api_endpoints(db_session, tokens):
    """
    Test GET /api/drift (filtering) and GET /api/drift/{id} with full evidence bundle.
    """
    device = db_session.query(Device).filter(Device.hostname == "sw-hostel-01").first()
    if not device:
        pytest.skip("sw-hostel-01 not seeded in database")

    drift_event = (
        db_session.query(DriftEvent)
        .filter(DriftEvent.device_id == device.id)
        .order_by(DriftEvent.detected_at.desc())
        .first()
    )
    if not drift_event:
        pytest.skip("No drift event exists for sw-hostel-01")

    client = TestClient(app)
    headers = {"Authorization": f"Bearer {tokens['viewer']}"}

    # 1. Test GET /api/drift list with label filter
    res = client.get("/api/drift?label=Non-Compliant", headers=headers)
    assert res.status_code == 200
    events = res.json()
    assert len(events) >= 1
    found_event = next((e for e in events if e["id"] == str(drift_event.id)), None)
    assert found_event is not None
    assert found_event["label"] == "Non-Compliant (Critical)"
    assert found_event["device_hostname"] == "sw-hostel-01"

    # 2. Test GET /api/drift/{id} detail & evidence bundle
    res = client.get(f"/api/drift/{drift_event.id}", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == str(drift_event.id)
    assert data["label"] == "Non-Compliant (Critical)"
    assert data["risk_score"] >= 95
    assert len(data["details"]) >= 2

    evidence = data["evidence_bundle"]
    assert evidence is not None
    assert evidence["event_id"] == str(drift_event.id)
    assert evidence["device_hostname"] == "sw-hostel-01"
    assert "Insecure management transport" in evidence["why_it_matters_summary"]
    assert "Unauthorized SNMP community" in evidence["why_it_matters_summary"]
    assert len(evidence["details"]) >= 2

    # Verify narrative content
    narratives = [d["why_it_matters"] for d in evidence["details"] if d.get("why_it_matters")]
    assert any("Insecure management transport" in n for n in narratives)
    assert any("Unauthorized SNMP community string" in n for n in narratives)


def test_pipeline_authorized_drift_ticket_classification(db_session):
    """
    Verify that an authorized change covered by an active ChangeTicket
    is classified as Drift-Authorized with risk score <= 30.
    """
    device = db_session.query(Device).filter(Device.hostname == "sw-classroom-01").first()
    if not device:
        pytest.skip("sw-classroom-01 not seeded in database")

    now = datetime.now(timezone.utc)
    # Create an approved change ticket covering ntp config on classroom switch
    ticket = ChangeTicket(
        ticket_ref=f"CHG-2026-NTP-{now.timestamp()}",
        device_id=device.id,
        key_path_scope="ntp.*",
        valid_from=now - timedelta(minutes=15),
        valid_to=now + timedelta(minutes=45),
        status="OPEN",
    )
    db_session.add(ticket)
    db_session.commit()
    db_session.refresh(ticket)

    snapshot = None
    event = None
    try:
        # Create a synthetic snapshot that modifies ntp.server (non-hard compliance diff)
        snapshot = ConfigurationSnapshot(
            device_id=device.id,
            raw_config="ntp server 10.10.99.1\n",
            normalized_json={
                "hostname": "sw-classroom-01",
                "line": {"vty": {"transport_input": "ssh"}},
                "snmp": {"community": {}},
                "interface": {
                    "FastEthernet0/1": {"port_security": {"enabled": "true"}},
                    "FastEthernet0/2": {"port_security": {"enabled": "true"}},
                },
                "ntp": {"server": "10.10.99.1"},  # Changed from 10.10.0.1
            },
            collected_at=now,
            collection_method="SSH",
            status="SUCCESS",
        )
        db_session.add(snapshot)
        db_session.commit()
        db_session.refresh(snapshot)

        # Run drift detection
        event = detect_drift(db=db_session, device=device, snapshot=snapshot)
        assert event is not None
        assert event.label == "Drift-Authorized"
        assert event.risk_score <= 30
        assert event.matched_ticket_id == ticket.id
        assert len(event.details) == 1
        assert event.details[0].key_path == "ntp.server"

    finally:
        # Clean up synthetic test records
        if event:
            db_session.query(DriftDetail).filter(DriftDetail.drift_event_id == event.id).delete()
            db_session.query(DriftEvent).filter(DriftEvent.id == event.id).delete()
        if snapshot:
            db_session.delete(snapshot)
        db_session.delete(ticket)
        db_session.commit()


def test_pipeline_mark_false_positive_with_audit(db_session, tokens):
    """
    Test marking a drift event as FALSE_POSITIVE:
    - Rejects empty or invalid comment (400 or 422)
    - Succeeds with valid explanation comment (200)
    - Updates drift event status in DB
    - Creates MARK_FALSE_POSITIVE AuditLog entry
    """
    device = db_session.query(Device).filter(Device.hostname == "sw-hostel-01").first()
    if not device:
        pytest.skip("sw-hostel-01 not seeded in database")

    drift_event = (
        db_session.query(DriftEvent)
        .filter(DriftEvent.device_id == device.id)
        .order_by(DriftEvent.detected_at.desc())
        .first()
    )
    if not drift_event:
        pytest.skip("No drift event exists for sw-hostel-01")

    client = TestClient(app)
    headers = {"Authorization": f"Bearer {tokens['neteng']}"}

    # 1. Validation error: comment too short / empty
    res_bad = client.post(
        f"/api/drift/{drift_event.id}/mark-false-positive",
        json={"comment": "   "},
        headers=headers,
    )
    assert res_bad.status_code in [400, 422]

    # 2. Success: valid comment
    test_comment = "Hardware maintenance bypass approved during campus festival"
    res_ok = client.post(
        f"/api/drift/{drift_event.id}/mark-false-positive",
        json={"comment": test_comment},
        headers=headers,
    )
    assert res_ok.status_code == 200
    body = res_ok.json()
    assert body["status"] == "FALSE_POSITIVE"
    assert body["comment"] == test_comment

    # Verify status in database
    db_session.refresh(drift_event)
    assert drift_event.status == "FALSE_POSITIVE"

    # Verify audit log
    audit = (
        db_session.query(AuditLog)
        .filter(AuditLog.target_id == drift_event.id, AuditLog.action == "MARK_FALSE_POSITIVE")
        .order_by(AuditLog.timestamp.desc())
        .first()
    )
    assert audit is not None
    assert audit.after_state.get("status") == "FALSE_POSITIVE"
    assert audit.after_state.get("comment") == test_comment
