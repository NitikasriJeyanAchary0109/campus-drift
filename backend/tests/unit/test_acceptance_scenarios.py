"""
Regression tests behind the three acceptance scenarios (the live runs are in tests/integration/test_acceptance_scenarios.py):

A. a rogue native-VLAN change on a trunk is parsed, scoped to trunks, scored by zone weight and remediated from a validated template
B. a webhook that fails authentication raises a critical alert (one per source) and never becomes a ticket
C. a change that locks the platform out of the device is a failed change and is rolled back
"""
import hashlib
import hmac
import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from app.main import app
from app.models.alerts import Alert
from app.models.audit import AuditLog
from app.models.tickets import ChangeTicket
from app.services import remediation as rem
from app.services.drift import classify_diff, generate_why_it_matters, score_diff
from app.services.normalization import normalize_config, resolve_wildcard_key_paths
from app.services.parsers.cisco_ios import ParseError
from app.services.remediation_templates import SecurityViolationError, render_remediation_commands
from fastapi.testclient import TestClient

from tests.failure_env import DRIFTED_CFG, build_env, open_event
from tests.fakes import FakeDevice

client = TestClient(app)

TRUNK_CFG = """hostname sw-a
interface FastEthernet0/1
 switchport mode access
 switchport access vlan 10
interface GigabitEthernet0/1
 switchport mode trunk
 switchport trunk allowed vlan 10,20,99
 switchport trunk native vlan 10
interface GigabitEthernet0/2
 switchport mode trunk
 switchport trunk allowed vlan 10,20,99
interface Vlan99
 ip address 10.10.1.10 255.255.255.0
end
"""


# ---------------------------------------------------------------- A. native VLAN drift

def test_native_vlan_is_parsed_and_defaults_to_none():
    tree = normalize_config(TRUNK_CFG, "cisco_ios")
    assert tree["interface"]["GigabitEthernet0/1"]["switchport"]["trunk_native_vlan"] == "10"
    assert tree["interface"]["GigabitEthernet0/2"]["switchport"]["trunk_native_vlan"] is None


def test_removing_the_native_vlan_returns_the_port_to_the_default():
    cfg = TRUNK_CFG.replace(" switchport trunk native vlan 10\n", " switchport trunk native vlan 10\n no switchport trunk native vlan\n")
    assert normalize_config(cfg, "cisco_ios")["interface"]["GigabitEthernet0/1"]["switchport"]["trunk_native_vlan"] is None


def test_a_malformed_native_vlan_line_is_a_parse_error_not_a_silent_skip():
    with pytest.raises(ParseError):
        normalize_config(TRUNK_CFG.replace("native vlan 10", "native vlan ten"), "cisco_ios")


def test_native_vlan_rule_applies_to_trunk_ports_only():
    tree = normalize_config(TRUNK_CFG, "cisco_ios")
    paths = dict(resolve_wildcard_key_paths(tree, "interface.*.switchport.trunk_native_vlan"))
    assert set(paths) == {"interface.GigabitEthernet0/1.switchport.trunk_native_vlan", "interface.GigabitEthernet0/2.switchport.trunk_native_vlan"}
    assert paths["interface.GigabitEthernet0/1.switchport.trunk_native_vlan"] == "10"


@pytest.mark.parametrize("zone_weight,label,score", [(1.0, "Drift-Unauthorized-High", 90), (0.8, "Drift-Unauthorized-Medium", 72), (1.2, "Drift-Unauthorized-High", 94), (0.5, "Drift-Unauthorized-Low", 45)])
def test_native_vlan_score_is_severity_times_zone_weight(zone_weight, label, score):
    raw = score_diff(90, zone_weight)
    assert classify_diff(raw, hard_compliance=False, ticket=None) == (label, score)


def test_native_vlan_rationale_names_the_risk():
    text = generate_why_it_matters("interface.Gi0/1.switchport.trunk_native_vlan", "EXACT", "99", "10")
    assert "Native VLAN" in text and "'10'" in text and "'99'" in text


def test_remediation_script_is_rendered_from_the_template_with_validated_parameters():
    commands = render_remediation_commands("cisco_ios", "EXACT", "interface.GigabitEthernet0/1.switchport.trunk_native_vlan", "99", "10")
    assert commands == ["interface GigabitEthernet0/1", "switchport trunk native vlan 99"]


@pytest.mark.parametrize("expected", ["99; reload", "99\nreload", "99 && reload", "0", "4095", "ninety", "99$(id)", "{{7*7}}"])
def test_native_vlan_value_that_is_not_a_vlan_id_is_refused(expected):
    with pytest.raises(SecurityViolationError):
        render_remediation_commands("cisco_ios", "EXACT", "interface.GigabitEthernet0/1.switchport.trunk_native_vlan", expected, "10")


def test_interface_name_cannot_carry_a_second_command():
    with pytest.raises(SecurityViolationError):
        render_remediation_commands("cisco_ios", "EXACT", "interface.Gi0/1; reload.switchport.trunk_native_vlan", "99", "10")


# ---------------------------------------------------------------- simulator: the lab device behaves like the thing it stands in for

def _simulator(tmp_path, monkeypatch):
    cfg = tmp_path / "switch.cfg"
    cfg.write_text(Path(__file__).resolve().parents[3].joinpath("network/simulated_devices/configs/classroom_switch.cfg").read_text())
    monkeypatch.setenv("CONFIG_FILE", str(cfg))
    spec = importlib.util.spec_from_file_location("cli_simulator_under_test", Path(__file__).resolve().parents[3] / "network/simulated_devices/cli_simulator.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, cfg


def test_simulator_applies_and_removes_a_native_vlan(tmp_path, monkeypatch):
    sim, cfg = _simulator(tmp_path, monkeypatch)
    ctx = {"submode": None}
    sim.mutate_config("interface GigabitEthernet0/1", ctx)
    sim.mutate_config("switchport trunk native vlan 10", ctx)
    tree = normalize_config(cfg.read_text(), "cisco_ios")
    assert tree["interface"]["GigabitEthernet0/1"]["switchport"]["trunk_native_vlan"] == "10"
    assert cfg.read_text().count("native vlan") == 1
    sim.mutate_config("no switchport trunk native vlan", ctx)
    assert "native vlan" not in cfg.read_text()


def test_simulator_refuses_new_ssh_sessions_when_the_vty_lines_no_longer_allow_ssh(tmp_path, monkeypatch):
    sim, cfg = _simulator(tmp_path, monkeypatch)
    assert sim.vty_allows_ssh()
    ctx = {"submode": None}
    sim.mutate_config("line vty 0 4", ctx)
    sim.mutate_config("transport input none", ctx)
    assert not sim.vty_allows_ssh()
    sim.mutate_config("transport input telnet ssh", ctx)
    assert sim.vty_allows_ssh()


# ---------------------------------------------------------------- B. forged webhook

def _delivery(signature: str, external_ref: str = "CHG-FORGED"):
    now = datetime.now(timezone.utc)
    body = json.dumps({"external_ref": external_ref, "hostname": "sw-h1", "key_path_scope": "ntp.server", "status": "OPEN",
                       "valid_from": (now - timedelta(hours=1)).isoformat(), "valid_to": (now + timedelta(hours=1)).isoformat()}).encode()
    return body, {"X-ITSM-Signature": signature, "Content-Type": "application/json"}


def test_forged_webhook_is_refused_stores_nothing_and_raises_a_critical_alert(db_session):
    body, headers = _delivery("sha256=" + "0" * 64)
    res = client.post("/api/tickets/webhook", content=body, headers=headers)
    assert res.status_code == 401
    assert db_session.query(ChangeTicket).count() == 0
    alerts = db_session.query(Alert).filter(Alert.type == "SECURITY_CHANGE").all()
    assert len(alerts) == 1
    assert "Rejected ITSM webhook" in alerts[0].message and "no drift was suppressed" in alerts[0].message and "Invalid HMAC signature" in alerts[0].message
    assert alerts[0].acknowledged is False


def test_repeated_forgeries_update_one_alert_instead_of_flooding(db_session):
    for _ in range(4):
        assert client.post("/api/tickets/webhook", content=_delivery("00" * 32)[0], headers=_delivery("00" * 32)[1]).status_code == 401
    alerts = db_session.query(Alert).filter(Alert.type == "SECURITY_CHANGE").all()
    assert len(alerts) == 1 and alerts[0].message.endswith("Attempts: 4")
    alerts[0].acknowledged = True
    db_session.commit()
    client.post("/api/tickets/webhook", content=_delivery("00" * 32)[0], headers=_delivery("00" * 32)[1])
    assert db_session.query(Alert).filter(Alert.type == "SECURITY_CHANGE").count() == 2   # an acknowledged alert is not reopened


def test_missing_signature_also_raises_the_alert(db_session):
    body, headers = _delivery("")
    headers.pop("X-ITSM-Signature")
    assert client.post("/api/tickets/webhook", content=body, headers=headers).status_code == 401
    assert "Missing HMAC signature" in db_session.query(Alert).filter(Alert.type == "SECURITY_CHANGE").one().message


def test_a_correctly_signed_delivery_that_is_merely_invalid_raises_no_security_alert(db_session):
    from app.core.config import settings
    body, headers = _delivery("")
    headers["X-ITSM-Signature"] = hmac.new(settings.ITSM_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    res = client.post("/api/tickets/webhook", content=body, headers=headers)
    assert res.status_code == 422                                           # unknown device: refused, but the sender is authentic
    assert db_session.query(Alert).filter(Alert.type == "SECURITY_CHANGE").count() == 0
    assert db_session.query(AuditLog).filter(AuditLog.action == "ITSM_WEBHOOK_REJECTED").count() == 1


# ---------------------------------------------------------------- C. a change that locks the platform out

@pytest.fixture
def env():
    e = build_env()
    yield e
    e["db"].close()


def _approved_plan(env):
    plan = rem.generate_remediation_plan(env["db"], open_event(env).id, env["users"]["NetworkEngineer"].id)
    rem.submit_approval(env["db"], plan.id, "APPROVED", "ok", env["users"]["Admin"])
    return plan


def _apply(env, plan, fake, monkeypatch):
    monkeypatch.setattr(rem, "_connect_to_device", lambda db, dev: fake.connect())
    return rem.apply_remediation_plan(env["db"], plan.id, env["users"]["Admin"].id)


def test_a_change_that_is_correct_on_paper_but_locks_the_platform_out_is_rolled_back(env, monkeypatch):
    plan = _approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG, dead_forever_after_push=True)             # the open session keeps working, new sessions are refused
    action = _apply(env, plan, fake, monkeypatch)
    assert action.result == "ROLLED_BACK" and plan.status == "FAILED"
    assert normalize_config(fake.running, "cisco_ios") == normalize_config(DRIFTED_CFG, "cisco_ios")      # back to the pre-change state
    alert = env["db"].query(Alert).filter(Alert.type == "CRITICAL_DRIFT", Alert.related_id == action.id).one()
    assert "management access" in alert.message and "verified against the pre-change backup" in alert.message
    audit = env["db"].query(AuditLog).filter(AuditLog.action == "REMEDIATION_ROLLED_BACK").one()
    assert audit.after_state["rollback_verified"] is True and "management access" in audit.after_state["failed_paths"]


def test_a_reachable_device_is_not_rolled_back_by_the_guard(env, monkeypatch):
    plan = _approved_plan(env)
    action = _apply(env, plan, FakeDevice(DRIFTED_CFG), monkeypatch)
    assert action.result == "SUCCESS" and plan.status == "APPLIED"


def test_the_guard_uses_a_new_session_not_the_one_that_pushed_the_change(env, monkeypatch):
    plan = _approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG)
    _apply(env, plan, fake, monkeypatch)
    assert fake.connections >= 2                                             # pushing session + at least one fresh session for the check


def test_a_device_that_connects_but_returns_nothing_fails_the_guard(env, monkeypatch):
    plan = _approved_plan(env)
    fake = FakeDevice(DRIFTED_CFG)
    real_connect = fake.connect
    state = {"calls": 0}

    class Silent:
        def send_command(self, *_a, **_k):
            return "   "

        def disconnect(self):
            pass

    def connect():
        state["calls"] += 1
        return real_connect() if state["calls"] == 1 or state["calls"] > 3 else Silent()
    monkeypatch.setattr(rem, "_connect_to_device", lambda db, dev: connect())
    action = rem.apply_remediation_plan(env["db"], plan.id, env["users"]["Admin"].id)
    assert action.result == "ROLLED_BACK"
