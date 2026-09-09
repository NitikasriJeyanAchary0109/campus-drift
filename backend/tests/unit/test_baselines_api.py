"""
Unit Tests for Baseline Management API & Service
------------------------------------------------
Tests Baseline CRUD, auto-incrementing versioning per (group, vendor),
activation exclusivity, hybrid YAML ingestion, and RBAC enforcement per §8, §9, §12.
"""
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import get_password_hash, create_access_token
from app.models.users import Role, User
from app.models.devices import DeviceGroup
from app.models.baselines import Baseline, BaselineRule
from app.main import app


@pytest.fixture(scope="module")
def baseline_test_env():
    test_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    Base.metadata.create_all(bind=test_engine)

    session = TestingSessionLocal()
    role_admin = Role(name="Admin")
    role_neteng = Role(name="NetworkEngineer")
    role_viewer = Role(name="Viewer")
    session.add_all([role_admin, role_neteng, role_viewer])
    session.commit()

    admin = User(
        username="admin_baseline_test",
        password_hash=get_password_hash("pass"),
        role_id=role_admin.id,
        is_active=True,
    )
    neteng = User(
        username="neteng_baseline_test",
        password_hash=get_password_hash("pass"),
        role_id=role_neteng.id,
        is_active=True,
    )
    viewer = User(
        username="viewer_baseline_test",
        password_hash=get_password_hash("pass"),
        role_id=role_viewer.id,
        is_active=True,
    )
    session.add_all([admin, neteng, viewer])
    session.commit()

    group = DeviceGroup(name="Lab", criticality_weight=1.2)
    session.add(group)
    session.commit()
    session.refresh(group)
    group_id = group.id

    admin_id = admin.id
    neteng_id = neteng.id
    viewer_id = viewer.id

    session.close()

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    tokens = {
        "admin": create_access_token({"sub": str(admin_id), "username": "admin_baseline_test", "role": "Admin"}),
        "neteng": create_access_token({"sub": str(neteng_id), "username": "neteng_baseline_test", "role": "NetworkEngineer"}),
        "viewer": create_access_token({"sub": str(viewer_id), "username": "viewer_baseline_test", "role": "Viewer"}),
    }

    yield client, tokens, group_id, TestingSessionLocal

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=test_engine)


def test_list_baselines_viewer(baseline_test_env):
    """Viewer can list baselines."""
    client, tokens, group_id, _ = baseline_test_env
    headers = {"Authorization": f"Bearer {tokens['viewer']}"}
    res = client.get("/api/baselines", headers=headers)
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_create_baseline_viewer_forbidden(baseline_test_env):
    """Viewer is forbidden from creating baselines."""
    client, tokens, group_id, _ = baseline_test_env
    headers = {"Authorization": f"Bearer {tokens['viewer']}"}
    payload = {
        "name": "Forbidden-Baseline",
        "device_group_id": str(group_id),
        "vendor": "cisco_ios",
        "rules": [],
    }
    res = client.post("/api/baselines", json=payload, headers=headers)
    assert res.status_code == 403


def test_create_baseline_neteng_and_versioning(baseline_test_env):
    """
    NetEng creates Baseline v1; verify it is created with is_active=False by default (no activation bypass).
    NetEng cannot activate it (403). Admin activates it (200).
    NetEng creates Baseline v2 (version increments to 2, is_active=False).
    Admin activates v2; v2 becomes active and v1 is deactivated.
    """
    client, tokens, group_id, _ = baseline_test_env
    neteng_headers = {"Authorization": f"Bearer {tokens['neteng']}"}
    admin_headers = {"Authorization": f"Bearer {tokens['admin']}"}
    viewer_headers = {"Authorization": f"Bearer {tokens['viewer']}"}

    # 1. Create Baseline v1
    payload_v1 = {
        "name": "Lab-Baseline-v1",
        "device_group_id": str(group_id),
        "vendor": "cisco_ios",
        "rules": [
            {
                "key_path": "line.vty.transport_input",
                "expected_value": "ssh",
                "rule_type": "EXACT",
                "severity_weight": 90,
                "hard_compliance": True,
            },
            {
                "key_path": "ntp.server",
                "expected_value": "10.10.0.1",
                "rule_type": "EXACT",
                "severity_weight": 20,
                "hard_compliance": False,
            },
        ],
    }
    res1 = client.post("/api/baselines", json=payload_v1, headers=neteng_headers)
    assert res1.status_code == 201
    data1 = res1.json()
    assert data1["name"] == "Lab-Baseline-v1"
    assert data1["version"] == 1
    # Control gap fix: must NOT be active on creation!
    assert data1["is_active"] is False
    assert len(data1["rules"]) == 2
    b1_id = data1["id"]

    # 2. NetEng attempts to activate v1 -> 403 Forbidden
    res_neteng_act = client.put(f"/api/baselines/{b1_id}/activate", headers=neteng_headers)
    assert res_neteng_act.status_code == 403

    # 3. Admin explicitly activates v1 -> 200 OK
    res_admin_act = client.put(f"/api/baselines/{b1_id}/activate", headers=admin_headers)
    assert res_admin_act.status_code == 200
    assert res_admin_act.json()["activated"] is True

    # Confirm v1 is now active
    res_b1 = client.get(f"/api/baselines/{b1_id}", headers=viewer_headers)
    assert res_b1.json()["is_active"] is True

    # 4. NetEng creates Baseline v2 for same group + vendor
    payload_v2 = {
        "name": "Lab-Baseline-v2",
        "device_group_id": str(group_id),
        "vendor": "cisco_ios",
        "rules": [
            {
                "key_path": "line.vty.transport_input",
                "expected_value": "ssh",
                "rule_type": "EXACT",
                "severity_weight": 90,
                "hard_compliance": True,
            },
        ],
    }
    res2 = client.post("/api/baselines", json=payload_v2, headers=neteng_headers)
    assert res2.status_code == 201
    data2 = res2.json()
    assert data2["name"] == "Lab-Baseline-v2"
    assert data2["version"] == 2
    # v2 is also inactive upon creation
    assert data2["is_active"] is False
    b2_id = data2["id"]

    # Prior baseline v1 remains active while v2 is unapproved/inactive
    res_b1_check = client.get(f"/api/baselines/{b1_id}", headers=viewer_headers)
    assert res_b1_check.json()["is_active"] is True

    # 5. Admin activates v2 -> v2 becomes active, v1 becomes inactive
    res_act2 = client.put(f"/api/baselines/{b2_id}/activate", headers=admin_headers)
    assert res_act2.status_code == 200
    assert res_act2.json()["previous_active_baseline_id"] == b1_id

    res_b1_after = client.get(f"/api/baselines/{b1_id}", headers=viewer_headers)
    res_b2_after = client.get(f"/api/baselines/{b2_id}", headers=viewer_headers)
    assert res_b1_after.json()["is_active"] is False
    assert res_b2_after.json()["is_active"] is True


def test_baseline_activation_exclusivity(baseline_test_env):
    """
    Admin reactivates baseline v1; v1 becomes active and v2 becomes inactive.
    Viewer is forbidden from activating.
    """
    client, tokens, group_id, SessionLocal = baseline_test_env
    db = SessionLocal()
    b1 = db.query(Baseline).filter(Baseline.name == "Lab-Baseline-v1").first()
    b2 = db.query(Baseline).filter(Baseline.name == "Lab-Baseline-v2").first()
    b1_id = str(b1.id)
    b2_id = str(b2.id)
    db.close()

    # Viewer cannot activate
    viewer_res = client.put(f"/api/baselines/{b1_id}/activate", headers={"Authorization": f"Bearer {tokens['viewer']}"})
    assert viewer_res.status_code == 403

    # Admin reactivates v1
    admin_res = client.put(f"/api/baselines/{b1_id}/activate", headers={"Authorization": f"Bearer {tokens['admin']}"})
    assert admin_res.status_code == 200
    act_data = admin_res.json()
    assert act_data["activated"] is True
    assert act_data["previous_active_baseline_id"] == b2_id

    # Verify state
    res_b1 = client.get(f"/api/baselines/{b1_id}", headers={"Authorization": f"Bearer {tokens['viewer']}"})
    res_b2 = client.get(f"/api/baselines/{b2_id}", headers={"Authorization": f"Bearer {tokens['viewer']}"})
    assert res_b1.json()["is_active"] is True
    assert res_b2.json()["is_active"] is False


def test_get_baseline_rules(baseline_test_env):
    """Viewer can retrieve rules of a baseline."""
    client, tokens, _, SessionLocal = baseline_test_env
    db = SessionLocal()
    b1 = db.query(Baseline).filter(Baseline.name == "Lab-Baseline-v1").first()
    b1_id = str(b1.id)
    db.close()

    res = client.get(f"/api/baselines/{b1_id}/rules", headers={"Authorization": f"Bearer {tokens['viewer']}"})
    assert res.status_code == 200
    rules = res.json()
    assert len(rules) == 2
    key_paths = [r["key_path"] for r in rules]
    assert "line.vty.transport_input" in key_paths
    assert "ntp.server" in key_paths


def test_create_baseline_hybrid_yaml(baseline_test_env):
    """NetEng creates baseline via hybrid YAML string per §12."""
    client, tokens, group_id, _ = baseline_test_env
    headers = {"Authorization": f"Bearer {tokens['neteng']}"}

    yaml_text = """
name: "Lab-Baseline-v3-YAML"
device_group: "Lab"
vendor: "frr"
rules:
  - key_path: "line.vty.transport_input"
    expected_value: "ssh"
    rule_type: "EXACT"
    severity_weight: 90
    hard_compliance: true
  - key_path: "snmp.community.public.exists"
    expected_value: "false"
    rule_type: "MUST_NOT_EXIST"
    severity_weight: 95
    hard_compliance: true
  - key_path: "interface.*.port_security.enabled"
    expected_value: "true"
    rule_type: "MUST_EXIST"
    severity_weight: 60
    hard_compliance: false
  - key_path: "ntp.server"
    expected_value: "10.10.0.1"
    rule_type: "EXACT"
    severity_weight: 20
    hard_compliance: false
"""
    payload = {"yaml_content": yaml_text}
    res = client.post("/api/baselines", json=payload, headers=headers)
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "Lab-Baseline-v3-YAML"
    assert data["vendor"] == "frr"
    assert data["version"] == 1
    # Verify created inactive by default
    assert data["is_active"] is False
    assert len(data["rules"]) == 4

    rule_keys = [r["key_path"] for r in data["rules"]]
    assert "snmp.community.public.exists" in rule_keys
    assert "interface.*.port_security.enabled" in rule_keys

    # Admin activation works for YAML-created baseline
    admin_headers = {"Authorization": f"Bearer {tokens['admin']}"}
    res_act = client.put(f"/api/baselines/{data['id']}/activate", headers=admin_headers)
    assert res_act.status_code == 200
    assert res_act.json()["activated"] is True
