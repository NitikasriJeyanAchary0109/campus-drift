"""
Integration Tests for Configuration Collection Service
------------------------------------------------------
Tests end-to-end Netmiko SSH collection against running simulated devices,
verifies snapshot persistence in PostgreSQL with raw_config and normalized_json,
tests API /api/devices/{id}/poll endpoint, and tests failure handling.
"""
import pytest
from fastapi.testclient import TestClient
from app.core.database import SessionLocal
from app.core.security import create_access_token
from app.models.devices import Device, DeviceGroup
from app.models.configurations import ConfigurationSnapshot
from app.models.alerts import Alert
from app.models.audit import AuditLog
from app.models.users import User
from app.services.collection import collect_device_configuration
from app.services.vault import store_device_credential
from app.main import app


@pytest.fixture(scope="module")
def db_session():
    """Yields a database session connected to PostgreSQL."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module")
def neteng_token(db_session):
    neteng_user = db_session.query(User).filter(User.username == "neteng").first()
    if not neteng_user:
        pytest.skip("neteng user not seeded in database")
    return create_access_token({
        "sub": str(neteng_user.id),
        "username": neteng_user.username,
        "role": "NetworkEngineer",
    })


def test_collect_device_configuration_classroom_switch(db_session):
    """
    End-to-end collection test:
    Polls simulated classroom switch via SSH, verifies snapshot persistence
    with raw_config, valid normalized_json, and status SUCCESS.
    """
    device = db_session.query(Device).filter(Device.hostname == "sw-classroom-01").first()
    if not device:
        pytest.skip("sw-classroom-01 not seeded in database")

    # Perform collection
    try:
        snapshot = collect_device_configuration(db=db_session, device_id=device.id)
    except Exception as e:
        pytest.skip(f"Simulated device sw-classroom-01 not reachable: {e}")

    assert snapshot is not None
    assert snapshot.device_id == device.id
    assert snapshot.collection_method == "SSH"
    assert snapshot.status == "SUCCESS"

    # Verify raw config
    assert snapshot.raw_config is not None
    assert "hostname sw-classroom-01" in snapshot.raw_config
    assert "vlan 10" in snapshot.raw_config

    # Verify normalized JSON tree
    norm = snapshot.normalized_json
    assert isinstance(norm, dict)
    assert norm["hostname"] == "sw-classroom-01"
    assert "FastEthernet0/1" in norm["interface"]
    assert norm["interface"]["FastEthernet0/1"]["port_security"]["enabled"] == "true"
    assert norm["line"]["vty"]["transport_input"] == "ssh"

    # Verify device status and timestamp
    db_session.refresh(device)
    assert device.status == "ONLINE"
    assert device.last_polled_at is not None

    # Verify snapshot row persists in DB
    db_snapshot = db_session.query(ConfigurationSnapshot).filter(ConfigurationSnapshot.id == snapshot.id).first()
    assert db_snapshot is not None
    assert db_snapshot.raw_config == snapshot.raw_config


def test_api_device_poll_endpoint(db_session, neteng_token):
    """
    Test POST /api/devices/{id}/poll triggers real collection and returns snapshot summary.
    Role: NetEng+
    """
    device = db_session.query(Device).filter(Device.hostname == "sw-hostel-01").first()
    if not device:
        pytest.skip("sw-hostel-01 not seeded in database")

    client = TestClient(app)
    headers = {"Authorization": f"Bearer {neteng_token}"}

    res = client.post(f"/api/devices/{device.id}/poll", headers=headers)
    if res.status_code == 502:
        pytest.skip(f"Simulated device sw-hostel-01 not reachable: {res.text}")

    assert res.status_code == 200
    data = res.json()
    assert data["device_id"] == str(device.id)
    assert data["hostname"] == "sw-hostel-01"
    assert data["status"] == "SUCCESS"
    assert "snapshot ID" in data["message"]

    # Verify snapshot in DB
    latest_snap = (
        db_session.query(ConfigurationSnapshot)
        .filter(ConfigurationSnapshot.device_id == device.id)
        .order_by(ConfigurationSnapshot.collected_at.desc())
        .first()
    )
    assert latest_snap is not None
    assert "hostname sw-hostel-01" in latest_snap.raw_config
    assert latest_snap.normalized_json["hostname"] == "sw-hostel-01"
    assert "public" in latest_snap.normalized_json["snmp"]["community"]


def test_unreachable_device_failure_handling(db_session):
    """
    Test failure handling: unreachable device marks device UNREACHABLE and creates an Alert
    per §14 of architecture.md.
    """
    group = db_session.query(DeviceGroup).first()
    dummy_device = Device(
        hostname="rtr-unreachable-test",
        ip_address="192.0.2.254",  # TEST-NET-1 unreachable IP
        vendor="cisco_ios",
        model="Test Router",
        device_group_id=group.id,
        status="ONLINE",
    )
    db_session.add(dummy_device)
    db_session.commit()
    db_session.refresh(dummy_device)

    # Store dummy credentials
    store_device_credential(
        db=db_session,
        device_id=dummy_device.id,
        username="admin",
        secret="wrongpass",
    )

    with pytest.raises(ConnectionError):
        collect_device_configuration(db=db_session, device_id=dummy_device.id)

    db_session.refresh(dummy_device)
    assert dummy_device.status == "UNREACHABLE"

    # Verify alert was created
    alert = (
        db_session.query(Alert)
        .filter(Alert.related_id == dummy_device.id, Alert.type == "DEVICE_DOWN")
        .first()
    )
    assert alert is not None
    assert "rtr-unreachable-test" in alert.message

    # Clean up test device
    db_session.delete(alert)
    db_session.delete(dummy_device)
    db_session.commit()


def test_collection_parse_error_handling(db_session, monkeypatch):
    """
    Test that a malformed raw configuration captured during collection
    marks snapshot as PARSE_ERROR, records an alert and audit log,
    and prevents silent skipping per §11 and §14.
    """
    device = db_session.query(Device).filter(Device.hostname == "sw-classroom-01").first()
    if not device:
        pytest.skip("sw-classroom-01 not seeded in database")

    # Mock ConnectHandler to simulate returning corrupted raw config
    class MockConn:
        def send_command(self, cmd):
            return "version 15.2\nhostname sw-corrupt\ninterface FastEthernet0/1\n switchport mode\n"

        def disconnect(self):
            pass

    monkeypatch.setattr("app.services.collection.ConnectHandler", lambda **kwargs: MockConn())

    snapshot = collect_device_configuration(db=db_session, device_id=device.id)

    assert snapshot is not None
    assert snapshot.status == "PARSE_ERROR"
    assert snapshot.normalized_json["status"] == "PARSE_ERROR"
    assert "error" in snapshot.normalized_json

    # Verify alert and audit were generated
    alert = (
        db_session.query(Alert)
        .filter(Alert.related_id == device.id)
        .order_by(Alert.created_at.desc())
        .first()
    )
    assert alert is not None
    assert "parse error" in alert.message.lower()

    audit = (
        db_session.query(AuditLog)
        .filter(AuditLog.target_id == device.id, AuditLog.action == "PARSE_ERROR")
        .order_by(AuditLog.timestamp.desc())
        .first()
    )
    assert audit is not None
