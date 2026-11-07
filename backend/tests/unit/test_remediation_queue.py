"""
Remediation on the Redis/Celery queue: the API hands apply and rollback to a worker, the worker returns a plain result, and every guard
of the service layer still holds. Runs on SQLite with a fault-injectable fake device; no Redis or worker process is needed
(the queue call is replaced, or Celery runs eagerly).
"""
import pytest
from app.core.config import settings
from app.core.database import get_db
from app.core.rbac import require_admin, require_neteng
from app.main import app
from app.models.remediation import RemediationAction
from app.services import remediation as rem
from app.tasks import remediation as tasks
from fastapi.testclient import TestClient

from tests.failure_env import DRIFTED_CFG, build_env, open_event
from tests.fakes import FakeDevice


@pytest.fixture
def env():
    e = build_env()
    yield e
    e["db"].close()


@pytest.fixture
def client(env, monkeypatch):
    app.dependency_overrides[get_db] = lambda: env["db"]
    app.dependency_overrides[require_neteng] = lambda: env["users"]["Admin"]
    app.dependency_overrides[require_admin] = lambda: env["users"]["Admin"]
    monkeypatch.setattr(settings, "REMEDIATION_USE_QUEUE", True)
    monkeypatch.setattr(tasks, "SessionLocal", env["Session"])
    yield TestClient(app)
    app.dependency_overrides.clear()


def plan_for(env, approve=True):
    event = open_event(env)
    plan = rem.generate_remediation_plan(env["db"], event.id, env["users"]["NetworkEngineer"].id)
    if approve:
        rem.submit_approval(env["db"], plan.id, "APPROVED", "ok", env["users"]["Admin"])
    return plan


class FakeJob:
    id = "11111111-2222-3333-4444-555555555555"


def test_queue_is_on_by_default_in_production_only():
    from app.core.config import Settings
    assert Settings(ENVIRONMENT="development").REMEDIATION_USE_QUEUE is False
    prod = Settings(ENVIRONMENT="production", DEBUG=False, SECRET_KEY="x" * 40, VAULT_KEY="y" * 40, ITSM_WEBHOOK_SECRET="z" * 40,
                    SSH_STRICT_HOST_KEYS=True, SSH_KNOWN_HOSTS_FILE="/etc/campus_drift/known_hosts")
    assert prod.REMEDIATION_USE_QUEUE is True
    assert Settings(ENVIRONMENT="development", REMEDIATION_USE_QUEUE=True).REMEDIATION_USE_QUEUE is True


def test_apply_is_queued_with_202_and_nothing_touches_the_device(env, client, monkeypatch):
    plan = plan_for(env)
    sent = {}
    monkeypatch.setattr(tasks.apply_plan_task, "delay", lambda *a: sent.setdefault("args", a) and FakeJob())
    monkeypatch.setattr(settings, "CELERY_TASK_ALWAYS_EAGER", False)
    monkeypatch.setattr(rem, "_connect_to_device", lambda *a: pytest.fail("the API must not open an SSH session when queueing"))
    res = client.post(f"/api/remediation/{plan.id}/apply")
    assert res.status_code == 202
    body = res.json()
    assert body["state"] == "QUEUED" and body["task_id"] == FakeJob.id and body["remediation_plan_id"] == str(plan.id)
    assert sent["args"][0] == str(plan.id)


def test_an_unapproved_plan_is_refused_before_anything_is_queued(env, client, monkeypatch):
    plan = plan_for(env, approve=False)
    monkeypatch.setattr(tasks.apply_plan_task, "delay", lambda *a: pytest.fail("must not queue an unapproved plan"))
    res = client.post(f"/api/remediation/{plan.id}/apply")
    assert res.status_code == 409 and "approved" in res.json()["detail"].lower()


def test_an_unknown_plan_is_a_404_not_a_queued_job(env, client, monkeypatch):
    monkeypatch.setattr(tasks.apply_plan_task, "delay", lambda *a: pytest.fail("must not queue an unknown plan"))
    res = client.post("/api/remediation/00000000-0000-0000-0000-000000000000/apply")
    assert res.status_code == 404


def test_eager_mode_returns_the_same_result_shape_as_inline(env, client, monkeypatch):
    plan = plan_for(env)
    fake = FakeDevice(DRIFTED_CFG)
    monkeypatch.setattr(settings, "CELERY_TASK_ALWAYS_EAGER", True)
    monkeypatch.setattr(rem, "_connect_to_device", lambda db, dev: fake.connect())
    res = client.post(f"/api/remediation/{plan.id}/apply")
    assert res.status_code == 200
    body = res.json()
    assert body["verification_passed"] is True and body["result"] == "SUCCESS" and body["executed_commands"]
    env["db"].refresh(plan)
    assert plan.status == "APPLIED"


def test_the_worker_reports_a_refusal_as_data_not_as_a_crash(env):
    plan = plan_for(env, approve=False)
    out = tasks.run_operation("apply", str(plan.id), str(env["users"]["Admin"].id), session_factory=env["Session"])
    assert out["ok"] is False and out["http_status"] == 409


def test_the_worker_survives_an_unexpected_error(env, monkeypatch):
    plan = plan_for(env)
    monkeypatch.setattr(tasks, "apply_remediation_plan", lambda **kw: (_ for _ in ()).throw(RuntimeError("boom")))
    out = tasks.run_operation("apply", str(plan.id), str(env["users"]["Admin"].id), session_factory=env["Session"])
    assert out["ok"] is False and out["http_status"] == 500 and "boom" in out["detail"]


def test_worker_rejects_unknown_operations_and_unknown_users(env):
    assert tasks.run_operation("explode", "x", "y")["http_status"] == 400
    plan = plan_for(env)
    out = tasks.run_operation("rollback", str(plan.id), "00000000-0000-0000-0000-000000000000", session_factory=env["Session"])
    assert out["ok"] is False and out["http_status"] == 403


def test_a_failed_verification_is_rolled_back_by_the_worker_and_recorded(env, monkeypatch):
    plan = plan_for(env)
    fake = FakeDevice(DRIFTED_CFG)
    monkeypatch.setattr(rem, "_connect_to_device", lambda db, dev: fake.connect())
    out = tasks.run_operation("apply", str(plan.id), str(env["users"]["Admin"].id), force_fail=True, session_factory=env["Session"])
    assert out["ok"] is True and out["result"] == "ROLLED_BACK"
    assert env["db"].query(RemediationAction).filter_by(remediation_plan_id=plan.id, result="ROLLED_BACK").count() == 1


def test_job_status_endpoint_reports_pending_and_finished(env, client, monkeypatch):
    class Res:
        def __init__(self, state, result=None): self.state, self.result = state, result
        def ready(self): return self.state in ("SUCCESS", "FAILURE")
        def successful(self): return self.state == "SUCCESS"
    from app.api import remediation as api
    monkeypatch.setattr(api.celery_app, "AsyncResult", lambda tid: Res("PENDING"))
    pending = client.get("/api/remediation/jobs/abc").json()
    assert pending == {"task_id": "abc", "state": "PENDING", "finished": False, "result": None}
    monkeypatch.setattr(api.celery_app, "AsyncResult", lambda tid: Res("SUCCESS", {"ok": True, "result": "SUCCESS"}))
    done = client.get("/api/remediation/jobs/abc").json()
    assert done["finished"] is True and done["result"]["result"] == "SUCCESS"
