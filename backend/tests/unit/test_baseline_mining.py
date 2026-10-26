"""
Unit tests for baseline proposal mining (WP2: bootstrap a first baseline from a legacy fleet).
"""
import pytest
import yaml

from app.schemas.baselines import BaselineCreate
from app.services.baseline import parse_yaml_baseline
from app.services.baseline_mining import (
    flatten_tree,
    propose_baseline,
    propose_baseline_from_configs,
    proposal_to_yaml,
)


def _cfg(host, transport="ssh", ntp="10.10.0.1", snmp_public=False, port_sec=True):
    lines = [f"hostname {host}", "!", f"ntp server {ntp}", "!"]
    if snmp_public:
        lines.append("snmp-server community public RO")
    lines += ["interface FastEthernet0/1", " switchport mode access", " switchport access vlan 10"]
    if port_sec:
        lines.append(" switchport port-security")
    lines += ["!", "line vty 0 4", f" transport input {transport}", "!"]
    return "\n".join(lines) + "\n"


FLEET = {
    "sw-1": _cfg("sw-1"),
    "sw-2": _cfg("sw-2"),
    "sw-3": _cfg("sw-3"),
    "sw-4": _cfg("sw-4"),
    "sw-5": _cfg("sw-5", transport="telnet ssh", snmp_public=True),
}


def _by_path(proposal):
    return {r["key_path"]: r for r in proposal["rules"]}


def test_flatten_skips_identity_and_per_port_values():
    from app.services.normalization import normalize_config

    flat = flatten_tree(normalize_config(_cfg("sw-1"), "cisco_ios"))
    assert "hostname" not in flat
    assert not any(k.endswith("access_vlan") for k in flat)
    assert flat["line.vty.transport_input"] == "ssh"
    assert flat["ntp.server"] == "10.10.0.1"


def test_consensus_rules_and_outliers():
    proposal = propose_baseline_from_configs(FLEET)
    rules = _by_path(proposal)
    vty = rules["line.vty.transport_input"]
    assert vty["expected_value"] == "ssh"
    assert vty["support"] == 0.8
    assert vty["outliers"] == ["sw-5"]  # the drifted device is surfaced, not hidden
    assert vty["hard_compliance"] is True and vty["severity_weight"] == 90
    assert rules["ntp.server"]["hard_compliance"] is False
    assert rules["ntp.server"]["outliers"] == []


def test_one_off_line_on_single_device_does_not_become_policy():
    proposal = propose_baseline_from_configs(FLEET)
    # snmp public exists only on sw-5 (20% of the fleet) -> must not be proposed as a rule
    assert not any("snmp.community.public" in p for p in _by_path(proposal))


def test_threshold_excludes_split_fleets():
    split = {
        "a": _cfg("a", ntp="10.10.0.1"), "b": _cfg("b", ntp="10.10.0.1"),
        "c": _cfg("c", ntp="10.10.0.2"), "d": _cfg("d", ntp="10.10.0.2"),
    }
    assert "ntp.server" not in _by_path(propose_baseline_from_configs(split, min_support=0.8))
    # a 50/50 split never reaches a majority threshold, however low it is set
    assert "ntp.server" not in _by_path(propose_baseline_from_configs(split, min_support=0.51))


def test_input_validation():
    with pytest.raises(ValueError):
        propose_baseline({"only-one": {}})
    with pytest.raises(ValueError):
        propose_baseline({"a": {}, "b": {}}, min_support=0.4)


def test_yaml_roundtrips_into_baseline_schema_and_is_inactive_proposal():
    proposal = propose_baseline_from_configs(FLEET)
    text = proposal_to_yaml(proposal, "Hostel", "cisco_ios")
    assert text.startswith("# PROPOSED baseline")
    parsed = parse_yaml_baseline(text)
    assert parsed["device_group"] == "Hostel"
    assert "is_active" not in parsed  # activation is a separate Admin action
    BaselineCreate(yaml_content=text)  # accepted by the existing ingestion schema
    assert any("outliers: sw-5" in r["description"] for r in yaml.safe_load(text)["rules"])
