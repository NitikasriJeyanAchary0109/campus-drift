import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import get_password_hash, create_access_token
from app.models.users import Role, User
from app.models.devices import DeviceGroup, Device, DeviceCredential
from app.services.vault import store_device_credential, get_device_credential, decrypt_bytes
from app.main import app


@pytest.fixture(scope="module")
def device_test_env():
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
        username="admin_device_test",
        password_hash=get_password_hash("pass"),
        role_id=role_admin.id,
        is_active=True,
    )
    neteng = User(
        username="neteng_device_test",
        password_hash=get_password_hash("pass"),
        role_id=role_neteng.id,
        is_active=True,
    )
    viewer = User(
        username="viewer_device_test",
        password_hash=get_password_hash("pass"),
        role_id=role_viewer.id,
        is_active=True,
    )
    session.add_all([admin, neteng, viewer])
    session.commit()

    # Seed a device group
    group = DeviceGroup(name="Classroom", criticality_weight=1.0)
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
        "admin": create_access_token({"sub": str(admin_id), "username": "admin_device_test", "role": "Admin"}),
        "neteng": create_access_token({"sub": str(neteng_id), "username": "neteng_device_test", "role": "NetworkEngineer"}),
        "viewer": create_access_token({"sub": str(viewer_id), "username": "viewer_device_test", "role": "Viewer"}),
    }

    yield client, tokens, group_id, TestingSessionLocal

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=test_engine)


def test_create_device_admin_success(device_test_env):
    """Admin can create a device."""
    client, tokens, group_id, _ = device_test_env
    headers = {"Authorization": f"Bearer {tokens['admin']}"}

    payload = {
        "hostname": "sw-classroom-99",
        "ip_address": "10.10.99.1",
        "vendor": "cisco_ios",
        "model": "Catalyst 2960-X",
        "device_group_id": str(group_id),
        "status": "ONLINE",
    }
    res = client.post("/api/devices", json=payload, headers=headers)
    assert res.status_code == 201
    data = res.json()
    assert data["hostname"] == "sw-classroom-99"
    assert data["ip_address"] == "10.10.99.1"
    assert data["has_credentials"] is False


def test_create_device_viewer_blocked(device_test_env):
    """Viewer is blocked (403) from creating a device."""
    client, tokens, group_id, _ = device_test_env
    headers = {"Authorization": f"Bearer {tokens['viewer']}"}

    payload = {
        "hostname": "sw-classroom-100",
        "ip_address": "10.10.100.1",
        "vendor": "cisco_ios",
        "model": "Catalyst 2960-X",
        "device_group_id": str(group_id),
        "status": "ONLINE",
    }
    res = client.post("/api/devices", json=payload, headers=headers)
    assert res.status_code == 403


def test_list_devices_viewer_allowed(device_test_env):
    """Viewer can list devices and filter by group/status."""
    client, tokens, group_id, _ = device_test_env
    headers = {"Authorization": f"Bearer {tokens['viewer']}"}

    res = client.get("/api/devices", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 1
    assert any(d["hostname"] == "sw-classroom-99" for d in data)

    # Filter by group name
    res_filtered = client.get("/api/devices?group=Classroom", headers=headers)
    assert res_filtered.status_code == 200
    assert len(res_filtered.json()) >= 1


def test_update_device_rbac(device_test_env):
    """Admin can update device; Viewer is blocked."""
    client, tokens, _, db_factory = device_test_env
    db = db_factory()
    device = db.query(Device).filter(Device.hostname == "sw-classroom-99").first()
    device_id = str(device.id)
    db.close()

    # Viewer update attempt -> 403
    viewer_headers = {"Authorization": f"Bearer {tokens['viewer']}"}
    res_viewer = client.put(f"/api/devices/{device_id}", json={"model": "New Model"}, headers=viewer_headers)
    assert res_viewer.status_code == 403

    # Admin update -> 200
    admin_headers = {"Authorization": f"Bearer {tokens['admin']}"}
    res_admin = client.put(f"/api/devices/{device_id}", json={"model": "Updated 2960-XR"}, headers=admin_headers)
    assert res_admin.status_code == 200
    assert res_admin.json()["model"] == "Updated 2960-XR"


def test_decommission_device_rbac(device_test_env):
    """Admin can decommission device; Viewer is blocked."""
    client, tokens, _, db_factory = device_test_env
    db = db_factory()
    device = db.query(Device).filter(Device.hostname == "sw-classroom-99").first()
    device_id = str(device.id)
    db.close()

    # Viewer decommission attempt -> 403
    viewer_headers = {"Authorization": f"Bearer {tokens['viewer']}"}
    res_viewer = client.delete(f"/api/devices/{device_id}", headers=viewer_headers)
    assert res_viewer.status_code == 403

    # Admin decommission -> 200 with status DECOMMISSIONED
    admin_headers = {"Authorization": f"Bearer {tokens['admin']}"}
    res_admin = client.delete(f"/api/devices/{device_id}", headers=admin_headers)
    assert res_admin.status_code == 200
    assert res_admin.json()["status"] == "DECOMMISSIONED"


def test_poll_device_rbac(device_test_env, monkeypatch):
    """NetEng can trigger poll; Viewer is blocked."""
    from datetime import datetime, timezone
    client, tokens, group_id, db_factory = device_test_env
    # Create an active device to poll
    admin_headers = {"Authorization": f"Bearer {tokens['admin']}"}
    create_res = client.post("/api/devices", json={
        "hostname": "sw-poll-test",
        "ip_address": "10.10.200.1",
        "vendor": "cisco_ios",
        "model": "Catalyst 2960-X",
        "device_group_id": str(group_id),
        "status": "ONLINE",
    }, headers=admin_headers)
    device_id = create_res.json()["id"]

    # Viewer poll attempt -> 403
    viewer_headers = {"Authorization": f"Bearer {tokens['viewer']}"}
    res_viewer = client.post(f"/api/devices/{device_id}/poll", headers=viewer_headers)
    assert res_viewer.status_code == 403

    # Mock collection service for isolated unit test
    class MockSnapshot:
        id = uuid.uuid4()
        status = "SUCCESS"
        collected_at = datetime.now(timezone.utc)

    monkeypatch.setattr("app.tasks.collection.collect_device_configuration", lambda **kwargs: MockSnapshot())

    # NetEng poll -> 202 Accepted
    neteng_headers = {"Authorization": f"Bearer {tokens['neteng']}"}
    res_neteng = client.post(f"/api/devices/{device_id}/poll", headers=neteng_headers)
    assert res_neteng.status_code == 202
    assert res_neteng.json()["status"] in ("SUCCESS", "ACCEPTED")
    assert res_neteng.json().get("task_id") is not None


def test_encrypted_credential_storage_and_leak_prevention(device_test_env):
    """
    Verify:
    1. Setting credentials encrypts username and secret at rest.
    2. Raw DB column contains ciphertext, NOT plaintext.
    3. API response never returns the plaintext secret.
    4. Internal vault function can decrypt credentials for SSH operations.
    """
    client, tokens, group_id, db_factory = device_test_env
    admin_headers = {"Authorization": f"Bearer {tokens['admin']}"}

    # Create a fresh device
    create_res = client.post("/api/devices", json={
        "hostname": "sw-vault-test",
        "ip_address": "10.10.210.1",
        "vendor": "cisco_ios",
        "model": "Catalyst 2960-X",
        "device_group_id": str(group_id),
        "status": "ONLINE",
    }, headers=admin_headers)
    device_id = create_res.json()["id"]

    # Set credentials via API
    secret_plaintext = "UltraSecretNetworkPassword99!"
    username_plaintext = "network_admin"

    cred_res = client.post(f"/api/devices/{device_id}/credentials", json={
        "username": username_plaintext,
        "secret": secret_plaintext,
        "auth_type": "password",
    }, headers=admin_headers)

    assert cred_res.status_code == 200
    cred_data = cred_res.json()
    assert cred_data["has_credential"] is True
    # Assert plaintext secret is NOT in API response
    assert secret_plaintext not in str(cred_data)
    assert username_plaintext not in str(cred_data.get("secret_ref", ""))

    # Inspect the raw DB table directly to prove encryption at rest
    db = db_factory()
    raw_cred = db.query(DeviceCredential).filter(DeviceCredential.device_id == uuid.UUID(device_id)).first()
    assert raw_cred is not None

    # Assert raw DB column for username is encrypted bytes (not plaintext)
    assert raw_cred.username_enc != username_plaintext.encode("utf-8")
    assert isinstance(raw_cred.username_enc, bytes)
    assert decrypt_bytes(raw_cred.username_enc) == username_plaintext

    # Assert raw DB column for secret is NOT plaintext
    assert secret_plaintext not in raw_cred.secret_ref
    assert raw_cred.secret_ref.startswith("dev-vault:fernet:")

    # Assert internal helper decrypts both successfully for internal SSH engine
    creds_decrypted = get_device_credential(db, uuid.UUID(device_id))
    assert creds_decrypted is not None
    dec_user, dec_secret, dec_type = creds_decrypted
    assert dec_user == username_plaintext
    assert dec_secret == secret_plaintext
    assert dec_type == "password"
    db.close()

    # Verify GET /api/devices/{id} does not leak credentials
    viewer_headers = {"Authorization": f"Bearer {tokens['viewer']}"}
    detail_res = client.get(f"/api/devices/{device_id}", headers=viewer_headers)
    assert detail_res.status_code == 200
    assert detail_res.json()["has_credentials"] is True
    assert secret_plaintext not in str(detail_res.json())


def test_list_device_groups_endpoint(device_test_env):
    """Verify Viewer+ can list device groups."""
    client, tokens, group_id, _ = device_test_env
    viewer_headers = {"Authorization": f"Bearer {tokens['viewer']}"}
    res = client.get("/api/devices/groups", headers=viewer_headers)
    assert res.status_code == 200
    groups = res.json()
    assert len(groups) >= 1
    assert any(g["id"] == str(group_id) for g in groups)

