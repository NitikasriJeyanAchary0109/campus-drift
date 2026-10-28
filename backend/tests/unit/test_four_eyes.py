"""
Four-eyes rule (dual control): the author of a remediation plan may not approve it.

Previously any NetworkEngineer could generate *and* approve their own plan; the rule existed only in the README.
"""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.security import create_access_token
from app.main import app
from app.models.audit import AuditLog
from app.models.users import Role, User
from app.services import remediation as rem
from tests.failure_env import build_env, open_event


@pytest.fixture
def env():
    e = build_env()
    role = e["db"].query(Role).filter_by(name="NetworkEngineer").one()
    other = User(username="neteng2_f", password_hash="x", role_id=role.id, is_active=True)
    e["db"].add(other)
    e["db"].commit()
    e["other"] = other

    def override():
        s = e["Session"]()
        try:
            yield s
        finally:
            s.close()
    app.dependency_overrides[get_db] = override
    e["client"] = TestClient(app)
    e["tok"] = lambda u, r: {"Authorization": "Bearer " + create_access_token({"sub": str(u.id), "username": u.username, "role": r})}
    yield e
    app.dependency_overrides.pop(get_db, None)
    e["db"].close()


def new_plan(env, author):
    event = open_event(env)
    return rem.generate_remediation_plan(env["db"], event.id, author.id)


def test_author_cannot_approve_own_plan_and_the_attempt_is_audited(env):
    neteng = env["users"]["NetworkEngineer"]
    plan = new_plan(env, neteng)
    with pytest.raises(HTTPException) as exc:
        rem.submit_approval(env["db"], plan.id, "APPROVED", "self", neteng)
    assert exc.value.status_code == 403 and "Four-eyes" in exc.value.detail
    env["db"].refresh(plan)
    assert plan.status == "PENDING" and plan.approval is None
    assert env["db"].query(AuditLog).filter_by(action="PLAN_SELF_APPROVAL_BLOCKED").count() == 1


def test_admin_cannot_approve_a_plan_they_drafted_either(env):
    admin = env["users"]["Admin"]
    plan = new_plan(env, admin)
    with pytest.raises(HTTPException) as exc:
        rem.submit_approval(env["db"], plan.id, "APPROVED", "self", admin)
    assert exc.value.status_code == 403


def test_author_may_reject_withdraw_their_own_plan(env):
    neteng = env["users"]["NetworkEngineer"]
    plan = new_plan(env, neteng)
    approval = rem.submit_approval(env["db"], plan.id, "REJECTED", "withdrawn", neteng)
    assert approval.decision == "REJECTED"


@pytest.mark.parametrize("approver_key", ["Admin", "other"])
def test_a_different_person_can_approve(env, approver_key):
    plan = new_plan(env, env["users"]["NetworkEngineer"])
    approver = env["users"]["Admin"] if approver_key == "Admin" else env["other"]
    assert rem.submit_approval(env["db"], plan.id, "APPROVED", "ok", approver).decision == "APPROVED"


def test_legacy_plan_without_author_is_not_blocked(env):
    plan = new_plan(env, env["users"]["NetworkEngineer"])
    plan.created_by = None
    env["db"].commit()
    assert rem.submit_approval(env["db"], plan.id, "APPROVED", "ok", env["users"]["NetworkEngineer"]).decision == "APPROVED"


def test_api_returns_403_and_exposes_the_author(env):
    neteng = env["users"]["NetworkEngineer"]
    event = open_event(env)
    gen = env["client"].post(f"/api/remediation/{event.id}/generate-plan", headers=env["tok"](neteng, "NetworkEngineer"))
    assert gen.status_code == 201 and gen.json()["created_by_username"] == "neteng_f"
    plan_id = gen.json()["id"]
    own = env["client"].post(f"/api/approvals/{plan_id}", json={"decision": "APPROVED"}, headers=env["tok"](neteng, "NetworkEngineer"))
    assert own.status_code == 403
    pending = env["client"].get("/api/approvals/pending", headers=env["tok"](neteng, "NetworkEngineer")).json()
    assert pending[0]["created_by_username"] == "neteng_f"
    ok = env["client"].post(f"/api/approvals/{plan_id}", json={"decision": "APPROVED"}, headers=env["tok"](env["users"]["Admin"], "Admin"))
    assert ok.status_code == 201


def test_plan_output_says_what_it_fixes(env):
    """Approvers must see the drift the plan addresses, not only the commands."""
    neteng = env["users"]["NetworkEngineer"]
    event = open_event(env)
    gen = env["client"].post(f"/api/remediation/{event.id}/generate-plan", headers=env["tok"](neteng, "NetworkEngineer"))
    body = gen.json()
    assert body["drift_label"] == "Non-Compliant (Critical)" and body["risk_score"] >= 95
    assert {"line.vty.transport_input", "snmp.community.public.exists"} <= set(body["violated_paths"])
    pending = env["client"].get("/api/approvals/pending", headers=env["tok"](neteng, "NetworkEngineer")).json()
    assert pending[0]["violated_paths"] == body["violated_paths"]
