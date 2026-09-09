"""
Unit Tests for Drift Detection & Risk Scoring Engine
----------------------------------------------------
Tests all label classification paths (§12 taxonomy), hard-compliance enforcement,
false-positive elimination on dirty fixtures, false-negative prevention, evidence generation,
and false-positive marking per §11 and §12 of architecture.md.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import get_password_hash, create_access_token
from app.models.users import Role, User
from app.models.devices import DeviceGroup, Device
from app.models.baselines import Baseline, BaselineRule
from app.models.configurations import ConfigurationSnapshot
from app.models.tickets import ChangeTicket
from app.models.drift import DriftEvent, DriftDetail
from app.models.alerts import Alert
from app.models.audit import AuditLog
from app.services.normalization import normalize_config
from app.services.drift import detect_drift, build_evidence_bundle
from app.main import app

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def _read_fixture(filename: str) -> str:
    path = os.path.join(FIXTURES_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


@pytest.fixture
def drift_test_env():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = Session()

    # Roles and Users
    role_admin = Role(name="Admin")
    role_neteng = Role(name="NetworkEngineer")
    role_viewer = Role(name="Viewer")
    db.add_all([role_admin, role_neteng, role_viewer])
    db.commit()

    admin = User(username="admin_test", password_hash="hash", role_id=role_admin.id, is_active=True)
    neteng = User(username="neteng_test", password_hash="hash", role_id=role_neteng.id, is_active=True)
    viewer = User(username="viewer_test", password_hash="hash", role_id=role_viewer.id, is_active=True)
    db.add_all([admin, neteng, viewer])
    db.commit()

    # Device Group
    group = DeviceGroup(name="Classroom", criticality_weight=1.0)
    db.add(group)
    db.commit()

    # Device
    device = Device(
        hostname="sw-test-01",
        ip_address="10.10.1.10",
        vendor="cisco_ios",
        model="Catalyst 2960-X",
        device_group_id=group.id,
        status="ONLINE",
    )
    db.add(device)
    db.commit()

    # Baseline with multiple rule severity levels
    baseline = Baseline(
        name="Test-Baseline",
        device_group_id=group.id,
        vendor="cisco_ios",
        version=1,
        is_active=True,
        created_by=admin.id,
    )
    db.add(baseline)
    db.commit()

    # Rules:
    # 1. Hard Compliance: Telnet banned (weight=95, hard=True)
    r1 = BaselineRule(
        baseline_id=baseline.id,
        key_path="line.vty.transport_input",
        expected_value="ssh",
        rule_type="EXACT",
        severity_weight=95,
        hard_compliance=True,
        description="SSH must be the sole transport protocol on vty lines.",
    )
    # 2. Hard Compliance: SNMP public banned (weight=95, hard=True)
    r2 = BaselineRule(
        baseline_id=baseline.id,
        key_path="snmp.community.public.exists",
        expected_value="false",
        rule_type="MUST_NOT_EXIST",
        severity_weight=95,
        hard_compliance=True,
        description="Public SNMP community must not exist.",
    )
    # 3. High severity non-hard rule (weight=85)
    r3 = BaselineRule(
        baseline_id=baseline.id,
        key_path="interface.FastEthernet0/1.port_security.enabled",
        expected_value="true",
        rule_type="EXACT",
        severity_weight=85,
        hard_compliance=False,
        description="Port security must be enabled on FastEthernet0/1.",
    )
    # 4. Medium severity non-hard rule (weight=60)
    r4 = BaselineRule(
        baseline_id=baseline.id,
        key_path="interface.FastEthernet0/2.port_security.enabled",
        expected_value="true",
        rule_type="EXACT",
        severity_weight=60,
        hard_compliance=False,
        description="Port security must be enabled on FastEthernet0/2.",
    )
    # 5. Low severity non-hard rule (weight=35)
    r5 = BaselineRule(
        baseline_id=baseline.id,
        key_path="ntp.server",
        expected_value="10.10.0.1",
        rule_type="EXACT",
        severity_weight=35,
        hard_compliance=False,
        description="Primary NTP server must be 10.10.0.1.",
    )
    db.add_all([r1, r2, r3, r4, r5])
    db.commit()

    def override_get_db():
        session = Session()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    tokens = {
        "admin": create_access_token({"sub": str(admin.id), "username": "admin_test", "role": "Admin"}),
        "neteng": create_access_token({"sub": str(neteng.id), "username": "neteng_test", "role": "NetworkEngineer"}),
        "viewer": create_access_token({"sub": str(viewer.id), "username": "viewer_test", "role": "Viewer"}),
    }

    yield db, device, baseline, client, tokens

    app.dependency_overrides.clear()
    db.close()
    Base.metadata.drop_all(bind=engine)


def test_label_compliant(drift_test_env):
    """Path 1: Compliant — all rules match baseline, risk_score == 0."""
    db, device, baseline, _, _ = drift_test_env

    # Fully compliant normalized config
    compliant_json = {
        "hostname": "sw-test-01",
        "line": {"vty": {"transport_input": "ssh"}},
        "snmp": {"community": {"internal-read": {"mode": "RO", "exists": "true"}}},
        "interface": {
            "FastEthernet0/1": {"port_security": {"enabled": "true"}},
            "FastEthernet0/2": {"port_security": {"enabled": "true"}},
        },
        "ntp": {"server": ["10.10.0.1"]},
    }
    snap = ConfigurationSnapshot(
        device_id=device.id,
        raw_config="hostname sw-test-01",
        normalized_json=compliant_json,
        collection_method="SSH",
        status="SUCCESS",
    )
    db.add(snap)
    db.commit()

    event = detect_drift(db=db, device=device, snapshot=snap, baseline=baseline)
    assert event is not None
    assert event.label == "Compliant"
    assert event.risk_score == 0
    assert event.status == "RESOLVED"
    assert len(event.details) == 0


def test_label_drift_authorized(drift_test_env):
    """Path 2: Drift-Authorized — diff exists but is authorized by valid change ticket (score 1-30)."""
    db, device, baseline, _, _ = drift_test_env
    now = datetime.now(timezone.utc)

    # Change ticket authorizing work on FastEthernet0/2
    ticket = ChangeTicket(
        ticket_ref="CHG-MAINT-02",
        device_id=device.id,
        key_path_scope="interface.FastEthernet0/2",
        valid_from=now - timedelta(hours=1),
        valid_to=now + timedelta(hours=1),
        status="OPEN",
    )
    db.add(ticket)
    db.commit()

    # FastEthernet0/2 port security disabled under authorized ticket
    json_data = {
        "line": {"vty": {"transport_input": "ssh"}},
        "snmp": {"community": {}},
        "interface": {
            "FastEthernet0/1": {"port_security": {"enabled": "true"}},
            "FastEthernet0/2": {"port_security": {"enabled": "false"}},  # Authorized diff
        },
        "ntp": {"server": ["10.10.0.1"]},
    }
    snap = ConfigurationSnapshot(
        device_id=device.id,
        raw_config="raw",
        normalized_json=json_data,
        collected_at=now,
        status="SUCCESS",
    )
    db.add(snap)
    db.commit()

    event = detect_drift(db=db, device=device, snapshot=snap, baseline=baseline)
    assert event is not None
    assert event.label == "Drift-Authorized"
    assert 1 <= event.risk_score <= 30
    assert event.matched_ticket_id == ticket.id
    assert len(event.details) == 1
    assert event.details[0].key_path == "interface.FastEthernet0/2.port_security.enabled"


def test_label_drift_unauthorized_low(drift_test_env):
    """Path 3: Drift-Unauthorized-Low — low severity deviation (weight 35), no ticket, score 31-50."""
    db, device, baseline, _, _ = drift_test_env
    now = datetime.now(timezone.utc)

    # Only NTP server differs (weight=35)
    json_data = {
        "line": {"vty": {"transport_input": "ssh"}},
        "snmp": {"community": {}},
        "interface": {
            "FastEthernet0/1": {"port_security": {"enabled": "true"}},
            "FastEthernet0/2": {"port_security": {"enabled": "true"}},
        },
        "ntp": {"server": ["10.10.99.99"]},  # Diff!
    }
    snap = ConfigurationSnapshot(device_id=device.id, raw_config="raw", normalized_json=json_data, collected_at=now, status="SUCCESS")
    db.add(snap)
    db.commit()

    event = detect_drift(db=db, device=device, snapshot=snap, baseline=baseline)
    assert event is not None
    assert event.label == "Drift-Unauthorized-Low"
    assert 31 <= event.risk_score <= 50


def test_label_drift_unauthorized_medium(drift_test_env):
    """Path 4: Drift-Unauthorized-Medium — medium severity deviation (weight 60), no ticket, score 51-79."""
    db, device, baseline, _, _ = drift_test_env
    now = datetime.now(timezone.utc)

    # FastEthernet0/2 port security disabled without ticket (weight=60)
    json_data = {
        "line": {"vty": {"transport_input": "ssh"}},
        "snmp": {"community": {}},
        "interface": {
            "FastEthernet0/1": {"port_security": {"enabled": "true"}},
            "FastEthernet0/2": {"port_security": {"enabled": "false"}},  # Diff!
        },
        "ntp": {"server": ["10.10.0.1"]},
    }
    snap = ConfigurationSnapshot(device_id=device.id, raw_config="raw", normalized_json=json_data, collected_at=now, status="SUCCESS")
    db.add(snap)
    db.commit()

    event = detect_drift(db=db, device=device, snapshot=snap, baseline=baseline)
    assert event is not None
    assert event.label == "Drift-Unauthorized-Medium"
    assert 51 <= event.risk_score <= 79


def test_label_drift_unauthorized_high(drift_test_env):
    """Path 5: Drift-Unauthorized-High — high severity deviation (weight 85), no ticket, score 80-94."""
    db, device, baseline, _, _ = drift_test_env
    now = datetime.now(timezone.utc)

    # FastEthernet0/1 port security disabled without ticket (weight=85)
    json_data = {
        "line": {"vty": {"transport_input": "ssh"}},
        "snmp": {"community": {}},
        "interface": {
            "FastEthernet0/1": {"port_security": {"enabled": "false"}},  # Diff!
            "FastEthernet0/2": {"port_security": {"enabled": "true"}},
        },
        "ntp": {"server": ["10.10.0.1"]},
    }
    snap = ConfigurationSnapshot(device_id=device.id, raw_config="raw", normalized_json=json_data, collected_at=now, status="SUCCESS")
    db.add(snap)
    db.commit()

    event = detect_drift(db=db, device=device, snapshot=snap, baseline=baseline)
    assert event is not None
    assert event.label == "Drift-Unauthorized-High"
    assert 80 <= event.risk_score <= 94


def test_label_non_compliant_hard_rule_ignores_ticket(drift_test_env):
    """
    Path 6: Non-Compliant (Critical) — violates hard_compliance rule.
    PROVES that a valid open change ticket does NOT suppress a hard compliance violation!
    Score band: 95-100.
    """
    db, device, baseline, _, _ = drift_test_env
    now = datetime.now(timezone.utc)

    # Create a change ticket explicitly trying to authorize public SNMP
    ticket = ChangeTicket(
        ticket_ref="CHG-ILLEGAL-SNMP",
        device_id=device.id,
        key_path_scope="snmp.community.*",
        valid_from=now - timedelta(hours=1),
        valid_to=now + timedelta(hours=1),
        status="OPEN",
    )
    db.add(ticket)
    db.commit()

    # Config contains public community string
    json_data = {
        "line": {"vty": {"transport_input": "ssh"}},
        "snmp": {"community": {"public": {"mode": "RO", "exists": "true"}}},  # Hard violation!
        "interface": {
            "FastEthernet0/1": {"port_security": {"enabled": "true"}},
            "FastEthernet0/2": {"port_security": {"enabled": "true"}},
        },
        "ntp": {"server": ["10.10.0.1"]},
    }
    snap = ConfigurationSnapshot(device_id=device.id, raw_config="raw", normalized_json=json_data, collected_at=now, status="SUCCESS")
    db.add(snap)
    db.commit()

    event = detect_drift(db=db, device=device, snapshot=snap, baseline=baseline)
    assert event is not None
    # Must be Non-Compliant (Critical) regardless of change ticket
    assert event.label == "Non-Compliant (Critical)"
    assert 95 <= event.risk_score <= 100


def test_false_positive_clean_vs_messy_fixture(drift_test_env):
    """
    False-Positive Regression Test (§11):
    Runs drift detection on cisco_ios_clean.cfg vs cisco_ios_messy.cfg against the same baseline.
    Asserts zero unauthorized drift events are produced (both are Compliant).
    """
    db, device, baseline, _, _ = drift_test_env

    clean_raw = _read_fixture("cisco_ios_clean.cfg")
    messy_raw = _read_fixture("cisco_ios_messy.cfg")

    clean_tree = normalize_config(clean_raw, "cisco_ios")
    messy_tree = normalize_config(messy_raw, "cisco_ios")

    now = datetime.now(timezone.utc)
    snap_clean = ConfigurationSnapshot(device_id=device.id, raw_config=clean_raw, normalized_json=clean_tree, collected_at=now, status="SUCCESS")
    snap_messy = ConfigurationSnapshot(device_id=device.id, raw_config=messy_raw, normalized_json=messy_tree, collected_at=now, status="SUCCESS")
    db.add_all([snap_clean, snap_messy])
    db.commit()

    ev_clean = detect_drift(db=db, device=device, snapshot=snap_clean, baseline=baseline)
    ev_messy = detect_drift(db=db, device=device, snapshot=snap_messy, baseline=baseline)

    assert ev_clean.label == "Compliant"
    assert ev_clean.risk_score == 0
    assert ev_messy.label == "Compliant"
    assert ev_messy.risk_score == 0
    assert len(ev_clean.details) == 0
    assert len(ev_messy.details) == 0


def test_false_negative_hostel_switch_intentional_drift(drift_test_env):
    """
    False-Negative Prevention Test (§11):
    Confirms genuinely differing config (hostel_switch.cfg with telnet & public SNMP)
    is detected as Non-Compliant (Critical) with score >= 95.
    """
    db, device, baseline, _, _ = drift_test_env

    hostel_cfg_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "network", "simulated_devices", "configs", "hostel_switch.cfg")
    )
    with open(hostel_cfg_path, "r", encoding="utf-8") as f:
        hostel_raw = f.read()
    hostel_tree = normalize_config(hostel_raw, "cisco_ios")

    snap = ConfigurationSnapshot(
        device_id=device.id,
        raw_config=hostel_raw,
        normalized_json=hostel_tree,
        collected_at=datetime.now(timezone.utc),
        status="SUCCESS",
    )
    db.add(snap)
    db.commit()

    event = detect_drift(db=db, device=device, snapshot=snap, baseline=baseline)
    assert event is not None
    assert event.label == "Non-Compliant (Critical)"
    assert event.risk_score >= 95

    # Check that both telnet and public SNMP were flagged
    drift_paths = [d.key_path for d in event.details]
    assert "line.vty.transport_input" in drift_paths
    assert "snmp.community.public.exists" in drift_paths


def test_evidence_bundle_generation(drift_test_env):
    """Verify complete evidence bundle generation for high-priority drift event."""
    db, device, baseline, _, _ = drift_test_env

    # High severity diff
    json_data = {
        "line": {"vty": {"transport_input": "telnet ssh"}},
        "snmp": {"community": {"public": {"mode": "RO", "exists": "true"}}},
        "interface": {},
        "ntp": {"server": []},
    }
    snap = ConfigurationSnapshot(
        device_id=device.id,
        raw_config="raw",
        normalized_json=json_data,
        collected_at=datetime.now(timezone.utc),
        status="SUCCESS",
    )
    db.add(snap)
    db.commit()

    event = detect_drift(db=db, device=device, snapshot=snap, baseline=baseline)
    bundle = build_evidence_bundle(db, event)

    assert bundle.event_id == event.id
    assert bundle.device_hostname == device.hostname
    assert bundle.is_high_priority is True
    assert bundle.risk_score >= 80
    assert len(bundle.details) >= 2
    assert (
        "transport protocol" in bundle.why_it_matters_summary.lower()
        or "public snmp" in bundle.why_it_matters_summary.lower()
        or "cleartext" in bundle.why_it_matters_summary.lower()
    )


def test_drift_api_and_mark_false_positive(drift_test_env):
    """Test GET /api/drift, GET /api/drift/{id}, and POST /api/drift/{id}/mark-false-positive."""
    db, device, baseline, client, tokens = drift_test_env

    # Trigger drift event
    json_data = {"line": {"vty": {"transport_input": "telnet ssh"}}, "snmp": {}, "interface": {}, "ntp": {}}
    snap = ConfigurationSnapshot(device_id=device.id, raw_config="raw", normalized_json=json_data, status="SUCCESS")
    db.add(snap)
    db.commit()
    event = detect_drift(db=db, device=device, snapshot=snap, baseline=baseline)

    viewer_headers = {"Authorization": f"Bearer {tokens['viewer']}"}
    neteng_headers = {"Authorization": f"Bearer {tokens['neteng']}"}

    # 1. List drift events
    res_list = client.get("/api/drift", headers=viewer_headers)
    assert res_list.status_code == 200
    assert len(res_list.json()) >= 1

    # 2. Get drift event with full evidence bundle
    res_detail = client.get(f"/api/drift/{event.id}", headers=viewer_headers)
    assert res_detail.status_code == 200
    detail_data = res_detail.json()
    assert detail_data["id"] == str(event.id)
    assert detail_data["evidence_bundle"] is not None
    assert detail_data["evidence_bundle"]["is_high_priority"] is True

    # 3. Mark false positive requires comment
    res_empty_comment = client.post(f"/api/drift/{event.id}/mark-false-positive", json={"comment": ""}, headers=neteng_headers)
    assert res_empty_comment.status_code in (400, 422)

    # 4. Mark false positive success
    res_fp = client.post(
        f"/api/drift/{event.id}/mark-false-positive",
        json={"comment": "Temporary vendor maintenance window allowed telnet fallback during cutover"},
        headers=neteng_headers,
    )
    assert res_fp.status_code == 200
    assert res_fp.json()["status"] == "FALSE_POSITIVE"

    # Verify status in DB
    db.refresh(event)
    assert event.status == "FALSE_POSITIVE"

    # Verify audit log was recorded
    audit = db.query(AuditLog).filter(AuditLog.target_id == event.id, AuditLog.action == "MARK_FALSE_POSITIVE").first()
    assert audit is not None
    assert "cutover" in audit.after_state["comment"]


def test_score_band_boundary_non_hard_severity_100_caps_at_94(drift_test_env):
    """
    Score-band boundary test per user fix #1:
    Non-hard-compliance rule with severity_weight=100 on a device_group with
    criticality_weight >= 1.0 (e.g. Lab at 1.2).
    Confirm:
    - raw score calculation is 100 (100 * 1.2 = 120 -> clamped to 100)
    - classified strictly as Drift-Unauthorized-High (80-94)
    - risk_score is capped at 94
    - NEVER classified as Non-Compliant (Critical) — Non-Compliant is only reachable via hard_compliance=True.
    """
    db, _, _, _, _ = drift_test_env
    lab_group = DeviceGroup(name="Lab-Boundary-Test", criticality_weight=1.2)
    db.add(lab_group)
    db.commit()

    lab_device = Device(
        hostname="rtr-boundary-01",
        ip_address="10.10.4.99",
        vendor="cisco_ios",
        model="Boundary Router",
        device_group_id=lab_group.id,
        status="ONLINE",
    )
    db.add(lab_device)
    db.commit()

    admin_user = db.query(User).filter(User.username == "admin_test").first()
    baseline = Baseline(
        name="Boundary-Baseline",
        device_group_id=lab_group.id,
        vendor="cisco_ios",
        version=1,
        is_active=True,
        created_by=admin_user.id,
    )
    db.add(baseline)
    db.commit()

    # Rule with severity 100, but hard_compliance=False
    rule_non_hard = BaselineRule(
        baseline_id=baseline.id,
        key_path="ntp.server",
        expected_value="10.10.0.1",
        rule_type="EXACT",
        severity_weight=100,
        hard_compliance=False,
    )
    db.add(rule_non_hard)
    db.commit()

    # Snapshot violating the rule
    snap = ConfigurationSnapshot(
        device_id=lab_device.id,
        raw_config="ntp server 192.168.1.1\n",
        normalized_json={"ntp": {"server": "192.168.1.1"}},
        status="SUCCESS",
    )
    db.add(snap)
    db.commit()

    event = detect_drift(db=db, device=lab_device, snapshot=snap, baseline=baseline)
    assert event is not None
    # Must land in Drift-Unauthorized-High, capped at 94
    assert event.label == "Drift-Unauthorized-High"
    assert event.risk_score == 94
    assert event.label != "Non-Compliant (Critical)"
    assert event.underlying_severity == 100


def test_no_baseline_handling_per_section_14(drift_test_env):
    """
    NO_BASELINE handling per user fix #2 & §14:
    When a device belongs to a group with zero active baselines,
    detect_drift must set a distinct NO_BASELINE state on the resulting DriftEvent,
    not silently report Compliant or return None, and generate an alert.
    """
    db, _, _, _, _ = drift_test_env
    orphan_group = DeviceGroup(name="EmptyGroupWithoutBaseline", criticality_weight=1.0)
    db.add(orphan_group)
    db.commit()

    orphan_device = Device(
        hostname="sw-nobaseline-01",
        ip_address="10.10.99.10",
        vendor="cisco_ios",
        model="Catalyst 2960-X",
        device_group_id=orphan_group.id,
        status="ONLINE",
    )
    db.add(orphan_device)
    db.commit()

    snap = ConfigurationSnapshot(
        device_id=orphan_device.id,
        raw_config="hostname sw-nobaseline-01\n",
        normalized_json={"hostname": "sw-nobaseline-01"},
        status="SUCCESS",
    )
    db.add(snap)
    db.commit()

    event = detect_drift(db=db, device=orphan_device, snapshot=snap)
    assert event is not None
    assert event.label == "NO_BASELINE"
    assert event.baseline_id is None
    assert event.risk_score == 0
    assert event.underlying_severity is None
    assert event.status == "OPEN"
    assert event.label != "Compliant"

    # Verify alert was generated
    alert = db.query(Alert).filter(Alert.related_id == event.id, Alert.type == "CRITICAL_DRIFT").first()
    assert alert is not None
    assert "No active baseline" in alert.message


def test_underlying_severity_preserves_pre_ticket_cap_score(drift_test_env):
    """
    Underlying severity test per user fix #3:
    Prove that a ticket-matched high-severity diff has risk_score <= 30,
    but underlying_severity accurately reflects the pre-cap raw score.
    """
    db, device, baseline, _, _ = drift_test_env
    now = datetime.now(timezone.utc)

    ticket = ChangeTicket(
        ticket_ref="CHG-TEST-UNDERLYING-SEV",
        device_id=device.id,
        key_path_scope="interface.*",
        valid_from=now - timedelta(minutes=10),
        valid_to=now + timedelta(minutes=30),
        status="OPEN",
    )
    db.add(ticket)
    db.commit()

    # Rule r2 in drift_test_env is interface.FastEthernet0/1.port_security.enabled
    # with severity_weight=70, hard_compliance=False, group criticality=1.0 -> raw_score = 70.
    snap = ConfigurationSnapshot(
        device_id=device.id,
        raw_config="raw",
        normalized_json={
            "line": {"vty": {"transport_input": "ssh"}},
            "snmp": {},
            "interface": {"FastEthernet0/1": {"port_security": {"enabled": "false"}}},
            "ntp": {"server": "10.10.0.1"},
        },
        status="SUCCESS",
    )
    db.add(snap)
    db.commit()

    event = detect_drift(db=db, device=device, snapshot=snap, baseline=baseline)
    assert event is not None
    assert event.label == "Drift-Authorized"
    assert event.risk_score <= 30
    # Underlying severity must preserve the pre-cap raw score (85)
    assert event.underlying_severity == 85
    assert event.matched_ticket_id == ticket.id
