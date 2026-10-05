import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.database import SessionLocal
from app.models.devices import Device
from app.models.drift import DriftEvent
from app.models.configurations import ConfigurationSnapshot
from app.tasks.collection import poll_device_task, poll_all_devices_task
from app.core.celery_app import celery_app


def test_async_device_poll_and_status_endpoint(db_session, neteng_token, viewer_token):
    """
    Verify:
    1. POST /api/devices/{id}/poll returns 202 Accepted immediately with a task_id.
    2. Celery task executes and creates a configuration snapshot and drift event.
    3. GET /api/devices/{id}/poll-status/{task_id} returns task execution details and SUCCESS status.
    """
    device = db_session.query(Device).filter(Device.hostname == "sw-hostel-01").first()
    if not device:
        pytest.skip("sw-hostel-01 not seeded in database")

    client = TestClient(app)
    headers = {"Authorization": f"Bearer {neteng_token}"}

    # 1. Trigger asynchronous poll
    res = client.post(f"/api/devices/{device.id}/poll", headers=headers)
    if res.status_code == 502:
        pytest.skip(f"Simulated device sw-hostel-01 not reachable: {res.text}")

    assert res.status_code == 202
    data = res.json()
    assert data["device_id"] == str(device.id)
    assert data["hostname"] == "sw-hostel-01"
    assert "task_id" in data
    assert data["task_id"] is not None
    task_id = data["task_id"]

    # 2. Query task status endpoint (polling until background worker finishes)
    viewer_headers = {"Authorization": f"Bearer {viewer_token}"}
    import time
    status_data = None
    for _ in range(20):
        status_res = client.get(f"/api/devices/{device.id}/poll-status/{task_id}", headers=viewer_headers)
        assert status_res.status_code == 200
        status_data = status_res.json()
        assert status_data["task_id"] == task_id
        assert status_data["device_id"] == str(device.id)
        if status_data["status"] == "SUCCESS":
            break
        time.sleep(0.5)

    assert status_data["status"] == "SUCCESS"
    assert status_data["result"] is not None

    # 3. Verify snapshot and drift event persisted in DB
    snapshot = (
        db_session.query(ConfigurationSnapshot)
        .filter(ConfigurationSnapshot.device_id == device.id)
        .order_by(ConfigurationSnapshot.collected_at.desc())
        .first()
    )
    assert snapshot is not None
    assert snapshot.status == "SUCCESS"

    drift_event = (
        db_session.query(DriftEvent)
        .filter(DriftEvent.device_id == device.id)
        .order_by(DriftEvent.detected_at.desc())
        .first()
    )
    assert drift_event is not None


def test_poll_status_nonexistent_device(viewer_token):
    """
    Verify GET /api/devices/{id}/poll-status/{task_id} returns 404 for unknown device.
    """
    client = TestClient(app)
    viewer_headers = {"Authorization": f"Bearer {viewer_token}"}
    fake_id = uuid.uuid4()
    res = client.get(f"/api/devices/{fake_id}/poll-status/fake-task-id", headers=viewer_headers)
    assert res.status_code == 404


def test_periodic_sweep_task_enqueues_all_devices(db_session):
    """
    Verify poll_all_devices_task enqueues tasks for all non-decommissioned devices.
    """
    task_ids = poll_all_devices_task()
    assert isinstance(task_ids, list)
    active_count = db_session.query(Device).filter(Device.status != "DECOMMISSIONED").count()
    assert len(task_ids) == active_count
