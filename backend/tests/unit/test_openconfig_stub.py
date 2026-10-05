"""
Unit & Integration Tests for OpenConfig / gNMI Roadmap Stub Vendor
-------------------------------------------------------------------
Verifies that devices registered with vendor='openconfig_stub' cleanly surface
the documented 501 Not Implemented and NotImplementedError behaviors per Section 4
and docs/architecture.md §21.
"""
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.models.devices import Device, DeviceGroup
from app.models.users import Role, User
from app.services.normalization import normalize_config
from app.services.collection import collect_device_configuration
from app.core.security import create_access_token


def test_openconfig_normalization_raises_not_implemented():
    """normalize_config with vendor='openconfig_stub' raises NotImplementedError referencing roadmap."""
    with pytest.raises(NotImplementedError) as exc_info:
        normalize_config("raw config", vendor="openconfig_stub")
    err_msg = str(exc_info.value)
    assert "openconfig_stub" in err_msg
    assert "gNMI streaming telemetry" in err_msg
    assert "docs/architecture.md §21" in err_msg


def test_openconfig_collection_raises_not_implemented(db_session: Session):
    """collect_device_configuration on an openconfig_stub device raises NotImplementedError."""
    uid = uuid.uuid4().hex[:8]
    group = DeviceGroup(name=f"OpenConfig-Group-{uid}", criticality_weight=1.0)
    db_session.add(group)
    db_session.flush()

    device = Device(
        hostname=f"sw-openconfig-{uid}",
        ip_address=f"10.200.1.{int(uid[:2], 16) % 250 + 1}",
        vendor="openconfig_stub",
        model="Arista EOS gNMI Stub",
        device_group_id=group.id,
        status="ONLINE",
    )
    db_session.add(device)
    db_session.commit()

    with pytest.raises(NotImplementedError) as exc_info:
        collect_device_configuration(db_session, device.id)
    err_msg = str(exc_info.value)
    assert "openconfig_stub" in err_msg
    assert "docs/architecture.md §21" in err_msg


def test_openconfig_poll_api_returns_501(db_session: Session):
    """POST /api/devices/{id}/poll returns HTTP 501 Not Implemented for openconfig_stub devices."""
    client = TestClient(app)

    # Create NetEng user and token
    role_neteng = db_session.query(Role).filter(Role.name == "NetworkEngineer").first()
    if not role_neteng:
        role_neteng = Role(name="NetworkEngineer")
        db_session.add(role_neteng)
        db_session.flush()

    uid = uuid.uuid4().hex[:8]
    neteng = User(
        username=f"neteng_{uid}",
        password_hash="hash",
        role_id=role_neteng.id,
        is_active=True,
    )
    db_session.add(neteng)
    db_session.flush()

    token = create_access_token({"sub": str(neteng.id), "role": "NetworkEngineer"})

    group = DeviceGroup(name=f"OpenConfig-Group-{uid}", criticality_weight=1.0)
    db_session.add(group)
    db_session.flush()

    device = Device(
        hostname=f"sw-openconfig-api-{uid}",
        ip_address=f"10.200.2.{int(uid[:2], 16) % 250 + 1}",
        vendor="openconfig_stub",
        model="Arista EOS gNMI Stub",
        device_group_id=group.id,
        status="ONLINE",
    )
    db_session.add(device)
    db_session.commit()

    headers = {"Authorization": f"Bearer {token}"}
    res = client.post(f"/api/devices/{device.id}/poll", headers=headers)
    assert res.status_code == 501
    detail = res.json()["detail"]
    assert "openconfig_stub" in detail
    assert "docs/architecture.md §21" in detail
