"""
Live proof of the queue path: a real Celery worker consumes the "remediation" queue from Redis, pushes the approved commands to the
simulated switch over SSH, verifies, and the API reports the result through the job endpoint.
Needs the docker services (Postgres, Redis, simulated switches); starts and stops its own worker process.
"""
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest
from app.core.celery_app import celery_app
from app.core.config import settings
from app.main import app
from app.models.devices import Device
from app.models.drift import DriftEvent
from app.services.collection import collect_device_configuration
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def worker():
    # the worker must use the same database and Redis as this test process
    env = dict(os.environ, PYTHONPATH=str(BACKEND), DATABASE_URL=settings.DATABASE_URL, CELERY_BROKER_URL="redis://localhost:6379/0", CELERY_RESULT_BACKEND="redis://localhost:6379/0")
    proc = subprocess.Popen(
        [sys.executable, "-m", "celery", "-A", "app.core.celery_app.celery_app", "worker", "-Q", "remediation", "--pool=solo", "--loglevel=warning", "-n", "queue-test@%h"],
        cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.time() + 40
        while time.time() < deadline:
            try:
                pong = celery_app.control.inspect(timeout=1.0, destination=[f"queue-test@{os.uname().nodename}"]).ping()
            except Exception:
                pong = None
            if pong:
                break
            time.sleep(0.5)
        else:
            pytest.skip("the test worker did not start (is Redis running?)")
        yield proc
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_worker_applies_an_approved_plan_and_the_job_endpoint_reports_it(db_session, neteng_token, admin_token, worker, monkeypatch):
    device = db_session.query(Device).filter(Device.hostname == "sw-hostel-01").first()
    if not device:
        pytest.skip("sw-hostel-01 not seeded in database")
    monkeypatch.setattr(settings, "REMEDIATION_USE_QUEUE", True)
    monkeypatch.setattr(settings, "CELERY_TASK_ALWAYS_EAGER", False)

    client = TestClient(app)
    neteng = {"Authorization": f"Bearer {neteng_token}"}
    snapshot = collect_device_configuration(db=db_session, device_id=device.id)
    event = db_session.query(DriftEvent).filter(DriftEvent.device_id == device.id, DriftEvent.snapshot_id == snapshot.id).order_by(DriftEvent.detected_at.desc()).first()
    plan_id = client.post(f"/api/remediation/{event.id}/generate-plan", headers=neteng).json()["id"]
    assert client.post(f"/api/approvals/{plan_id}", json={"decision": "APPROVED", "comment": "queue test"}, headers={"Authorization": f"Bearer {admin_token}"}).status_code == 201

    res = client.post(f"/api/remediation/{plan_id}/apply", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 202, res.text            # handed to the queue, the request did not wait for the SSH push
    task_id = res.json()["task_id"]

    job = {}
    for _ in range(60):
        job = client.get(f"/api/remediation/jobs/{task_id}", headers=neteng).json()
        if job["finished"]:
            break
        time.sleep(1)
    assert job["finished"], "the worker did not finish in 60 s"
    assert job["result"]["ok"] is True, job["result"]
    assert job["result"]["result"] == "SUCCESS"

    plan = client.get(f"/api/remediation/{plan_id}", headers=neteng).json()
    assert plan["status"] == "APPLIED"
    assert any(a["result"] == "SUCCESS" for a in plan["actions"])
