"""
Unit Tests for Remediation Engine, Templates, and Approval Gate
--------------------------------------------------------------
Tests Jinja2 template rendering, multi-vendor support (Cisco IOS & FRR),
per-field input sanitization, command injection prevention, approval gate enforcement,
and audit logging per §6, §8, §9, and §13 of architecture.md.
"""
from datetime import datetime, timezone
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.models.users import Role, User
from app.models.devices import DeviceGroup, Device
from app.models.baselines import Baseline, BaselineRule
from app.models.configurations import ConfigurationSnapshot
from app.models.drift import DriftEvent, DriftDetail
from app.models.remediation import RemediationPlan, Approval, RemediationAction
from app.models.audit import AuditLog
from app.services.remediation_templates import (
    render_remediation_commands,
    validate_ip_address,
    validate_interface_name,
    validate_community_name,
    validate_transport_protocol,
    validate_vlan_id,
    SecurityViolationError,
    TemplateNotFoundError,
)
from app.services.remediation import (
    generate_remediation_plan,
    get_remediation_plan,
    submit_approval,
    list_pending_approvals,
    apply_remediation_plan,
)
from app.main import app


# -----------------------------------------------------------------------------
# 1. Template Rendering & Multi-Vendor Tests
# -----------------------------------------------------------------------------

def test_template_rendering_cisco_ios():
    """Verify clean rendering of all whitelisted Cisco IOS remediation templates."""
    # 1. Transport input
    c1 = render_remediation_commands("cisco_ios", "EXACT", "line.vty.transport_input", "ssh", "telnet ssh")
    assert c1 == ["line vty 0 4", "transport input ssh"]

    # 2. SNMP community removal
    c2 = render_remediation_commands("cisco_ios", "MUST_NOT_EXIST", "snmp.community.public.exists", "false", "true")
    assert c2 == ["no snmp-server community public"]

    # 3. Port security
    c3 = render_remediation_commands("cisco_ios", "EXACT", "interface.FastEthernet0/1.port_security.enabled", "true", "false")
    assert c3 == ["interface FastEthernet0/1", "switchport port-security"]

    # 4. NTP server
    c4 = render_remediation_commands("cisco_ios", "EXACT", "ntp.server", "10.10.0.1", "10.10.0.2")
    assert c4 == ["no ntp server 10.10.0.2", "ntp server 10.10.0.1"]

    # 5. Access VLAN
    c5 = render_remediation_commands("cisco_ios", "EXACT", "interface.FastEthernet0/2.switchport.access_vlan", "10", "20")
    assert c5 == ["interface FastEthernet0/2", "switchport access vlan 10"]


def test_template_rendering_frr():
    """Verify clean rendering of FRR remediation templates."""
    # 1. Transport input
    c1 = render_remediation_commands("frr", "EXACT", "line.vty.transport_input", "ssh", "telnet")
    assert c1 == ["line vty", "transport input ssh"]

    # 2. SNMP community removal
    c2 = render_remediation_commands("frr", "MUST_NOT_EXIST", "snmp.community.public.exists", "false", "true")
    assert c2 == ["no snmp-server community public"]

    # 3. NTP server
    c3 = render_remediation_commands("frr", "EXACT", "ntp.server", "10.10.0.1", "10.10.99.1")
    assert c3 == ["no ntp server 10.10.99.1", "ntp server 10.10.0.1"]


# -----------------------------------------------------------------------------
# 2. Command Injection & Sanitization Tests (§13)
# -----------------------------------------------------------------------------

def test_command_injection_prevention_metacharacters():
    """
    Command injection prevention (§13):
    Confirm that user-supplied metacharacters, shell separators, and non-whitelisted
    tokens are strictly blocked before reaching device execution.
    """
    malicious_inputs = [
        "10.10.0.1; rm -rf /",
        "10.10.0.1 | cat /etc/passwd",
        "10.10.0.1 && touch /tmp/pwn",
        "`whoami`",
        "$(id)",
        "10.10.0.1 > /dev/null",
        "10.10.0.1 < /dev/zero",
    ]

    for bad_ip in malicious_inputs:
        with pytest.raises(SecurityViolationError):
            validate_ip_address(bad_ip)

        with pytest.raises(SecurityViolationError):
            render_remediation_commands("cisco_ios", "EXACT", "ntp.server", bad_ip, None)


def test_command_injection_prevention_field_sanitizers():
    """Test individual field-level sanitizers reject malformed / malicious tokens."""
    # Interface name
    assert validate_interface_name("FastEthernet0/1") == "FastEthernet0/1"
    assert validate_interface_name("GigabitEthernet0/0.100") == "GigabitEthernet0/0.100"
    with pytest.raises(SecurityViolationError):
        validate_interface_name("Fa0/1; reboot")
    with pytest.raises(SecurityViolationError):
        validate_interface_name("Fa0/1|sh")

    # Community name
    assert validate_community_name("public") == "public"
    assert validate_community_name("campus-read_only") == "campus-read_only"
    with pytest.raises(SecurityViolationError):
        validate_community_name("public; write erase")

    # Transport protocol
    assert validate_transport_protocol("ssh") == "ssh"
    assert validate_transport_protocol("ssh telnet") == "ssh telnet"
    with pytest.raises(SecurityViolationError):
        validate_transport_protocol("ssh; rm")
    with pytest.raises(SecurityViolationError):
        validate_transport_protocol("bash")

    # VLAN ID
    assert validate_vlan_id("10") == "10"
    assert validate_vlan_id("4094") == "4094"
    with pytest.raises(SecurityViolationError):
        validate_vlan_id("0")
    with pytest.raises(SecurityViolationError):
        validate_vlan_id("4095")
    with pytest.raises(SecurityViolationError):
        validate_vlan_id("10; reboot")


def test_unsupported_vendor_or_rule_raises_template_not_found():
    """Confirm unknown vendor or non-whitelisted key_path raises TemplateNotFoundError."""
    with pytest.raises(TemplateNotFoundError):
        render_remediation_commands("juniper_junos", "EXACT", "line.vty.transport_input", "ssh", "telnet")

    with pytest.raises(TemplateNotFoundError):
        render_remediation_commands("cisco_ios", "EXACT", "arbitrary.unapproved.path", "val", "old")


# -----------------------------------------------------------------------------
# 3. In-Memory Service & Approval Gate Tests
# -----------------------------------------------------------------------------

@pytest.fixture
def remediation_test_env():
    """In-memory SQLite test environment for plan generation and approvals."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = Session()

    # Roles & Users
    r_admin = Role(name="Admin")
    r_neteng = Role(name="NetworkEngineer")
    r_viewer = Role(name="Viewer")
    db.add_all([r_admin, r_neteng, r_viewer])
    db.commit()

    admin = User(username="admin_rem", password_hash="hash", role_id=r_admin.id, is_active=True)
    neteng = User(username="neteng_rem", password_hash="hash", role_id=r_neteng.id, is_active=True)
    viewer = User(username="viewer_rem", password_hash="hash", role_id=r_viewer.id, is_active=True)
    db.add_all([admin, neteng, viewer])
    db.commit()

    # Device & Group
    group = DeviceGroup(name="Classroom", criticality_weight=1.0)
    db.add(group)
    db.commit()

    device = Device(
        hostname="sw-rem-01",
        ip_address="10.10.1.50",
        vendor="cisco_ios",
        model="Catalyst 2960-X",
        device_group_id=group.id,
        status="ONLINE",
    )
    db.add(device)
    db.commit()

    baseline = Baseline(
        name="Rem-Baseline",
        device_group_id=group.id,
        vendor="cisco_ios",
        version=1,
        is_active=True,
        created_by=admin.id,
    )
    db.add(baseline)
    db.commit()

    rule_ssh = BaselineRule(
        baseline_id=baseline.id,
        key_path="line.vty.transport_input",
        expected_value="ssh",
        rule_type="EXACT",
        severity_weight=90,
        hard_compliance=True,
    )
    rule_snmp = BaselineRule(
        baseline_id=baseline.id,
        key_path="snmp.community.public.exists",
        expected_value="false",
        rule_type="MUST_NOT_EXIST",
        severity_weight=95,
        hard_compliance=True,
    )
    db.add_all([rule_ssh, rule_snmp])
    db.commit()

    snap = ConfigurationSnapshot(
        device_id=device.id,
        raw_config="raw",
        normalized_json={},
        status="SUCCESS",
    )
    db.add(snap)
    db.commit()

    # Drift Event with 2 details
    event = DriftEvent(
        device_id=device.id,
        snapshot_id=snap.id,
        baseline_id=baseline.id,
        label="Non-Compliant (Critical)",
        risk_score=95,
        underlying_severity=95,
        status="OPEN",
        detected_at=datetime.now(timezone.utc),
    )
    db.add(event)
    db.flush()

    d1 = DriftDetail(
        drift_event_id=event.id,
        key_path="line.vty.transport_input",
        expected_value="ssh",
        actual_value="telnet ssh",
        change_type="MODIFIED",
        rule_id=rule_ssh.id,
    )
    d2 = DriftDetail(
        drift_event_id=event.id,
        key_path="snmp.community.public.exists",
        expected_value="false",
        actual_value="true",
        change_type="ADDED",
        rule_id=rule_snmp.id,
    )
    db.add_all([d1, d2])
    db.commit()
    db.refresh(event)

    # API Client & Tokens
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    tokens = {
        "admin": create_access_token({"sub": str(admin.id), "username": admin.username, "role": "Admin"}),
        "neteng": create_access_token({"sub": str(neteng.id), "username": neteng.username, "role": "NetworkEngineer"}),
        "viewer": create_access_token({"sub": str(viewer.id), "username": viewer.username, "role": "Viewer"}),
    }

    yield db, device, event, admin, neteng, viewer, client, tokens

    app.dependency_overrides.clear()
    db.close()


def test_generate_remediation_plan_service_and_audit(remediation_test_env):
    """Test generating a remediation plan builds proposed commands and logs audit."""
    db, device, event, admin, neteng, _, _, _ = remediation_test_env

    plan = generate_remediation_plan(db, event.id, neteng.id)
    assert plan is not None
    assert plan.drift_event_id == event.id
    assert plan.status == "PENDING"
    assert "line vty 0 4" in plan.proposed_commands
    assert "transport input ssh" in plan.proposed_commands
    assert "no snmp-server community public" in plan.proposed_commands

    # Verify audit record
    audit = db.query(AuditLog).filter(AuditLog.target_id == plan.id, AuditLog.action == "PLAN_GENERATED").first()
    assert audit is not None
    assert audit.user_id == neteng.id


def test_approval_service_gate_enforcement_rejects_unapproved(remediation_test_env):
    """
    Approval Gate Enforcement (§6 & §13):
    Applying a plan with no APPROVED approval record MUST be rejected with HTTP 409 Conflict.
    """
    db, device, event, admin, neteng, _, _, _ = remediation_test_env

    # 1. Create a plan in PENDING status
    plan = generate_remediation_plan(db, event.id, neteng.id)

    # 2. Directly call apply_remediation_plan without approval -> must throw 409 Conflict
    with pytest.raises(HTTPException) as exc_info:
        apply_remediation_plan(db, plan.id, neteng.id)
    assert exc_info.value.status_code == 409
    assert "Approval record with decision=APPROVED is required" in exc_info.value.detail


def test_approval_submission_and_pending_listing(remediation_test_env):
    """Test submitting an approval transitions plan status and removes it from pending list."""
    db, device, event, admin, neteng, _, client, tokens = remediation_test_env

    # 1. Generate plan via API
    neteng_headers = {"Authorization": f"Bearer {tokens['neteng']}"}
    res_gen = client.post(f"/api/remediation/{event.id}/generate-plan", headers=neteng_headers)
    assert res_gen.status_code == 201
    plan_id = res_gen.json()["id"]

    # 2. Check pending approvals list
    res_pend = client.get("/api/approvals/pending", headers=neteng_headers)
    assert res_pend.status_code == 200
    pending_ids = [p["id"] for p in res_pend.json()]
    assert plan_id in pending_ids

    # 3. Submit approval decision APPROVED
    res_appr = client.post(
        f"/api/approvals/{plan_id}",
        json={"decision": "APPROVED", "comment": "Verified compliant with ISO-27001 campus policy"},
        headers=neteng_headers,
    )
    assert res_appr.status_code == 201
    data = res_appr.json()
    assert data["decision"] == "APPROVED"
    assert "ISO-27001" in data["comment"]

    # 4. Confirm no longer in pending list
    res_pend2 = client.get("/api/approvals/pending", headers=neteng_headers)
    assert res_pend2.status_code == 200
    pending_ids2 = [p["id"] for p in res_pend2.json()]
    assert plan_id not in pending_ids2

    # 5. Preview plan shows approval
    res_prev = client.get(f"/api/remediation/{plan_id}", headers=neteng_headers)
    assert res_prev.status_code == 200
    assert res_prev.json()["status"] == "APPROVED"
    assert res_prev.json()["approval"]["decision"] == "APPROVED"
