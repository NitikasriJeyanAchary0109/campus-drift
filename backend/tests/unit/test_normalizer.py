"""
Unit Tests for Configuration Normalization & Cisco IOS Parser
-------------------------------------------------------------
Verifies canonicalization rules, order-independence, syntax variants,
and strict ParseError generation on malformed configs per §11 of architecture.md.
"""
import os
import pytest
from app.services.normalization import (
    normalize_config,
    values_equal,
    resolve_key_path,
    resolve_wildcard_key_paths,
    ParseError,
)
from app.services.parsers.cisco_ios import (
    canonicalize_ip,
    canonicalize_vlan_list,
    canonicalize_tokens,
)

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def _read_fixture(filename: str) -> str:
    path = os.path.join(FIXTURES_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def test_ip_canonicalization_equivalence():
    """Test that 10.0.0.1 255.255.255.0 and 10.0.0.1/24 produce identical normalized representation."""
    ip_mask = canonicalize_ip("10.0.0.1 255.255.255.0")
    ip_cidr = canonicalize_ip("10.0.0.1/24")

    assert ip_mask == "10.0.0.1/24"
    assert ip_cidr == "10.0.0.1/24"
    assert ip_mask == ip_cidr
    assert values_equal("10.0.0.1 255.255.255.0", "10.0.0.1/24")
    assert values_equal("192.168.10.5 255.255.255.240", "192.168.10.5/28")


def test_vlan_order_independence():
    """Test that permuted VLAN lists (e.g. 10,20,30 vs 30,10,20) normalize identically."""
    vlan_a = canonicalize_vlan_list("10,20,30")
    vlan_b = canonicalize_vlan_list("30,10,20")
    vlan_c = canonicalize_vlan_list("20,30,10")

    assert vlan_a == "10,20,30"
    assert vlan_b == "10,20,30"
    assert vlan_c == "10,20,30"
    assert values_equal("10,20,30", "30,10,20")


def test_token_order_independence():
    """Test that space-separated tokens normalize identically regardless of order."""
    token_a = canonicalize_tokens("telnet ssh")
    token_b = canonicalize_tokens("ssh telnet")

    assert token_a == "ssh telnet"
    assert token_b == "ssh telnet"
    assert values_equal("telnet ssh", "ssh telnet")


def test_acl_order_independence():
    """Test that permuted ACL rule order normalizes identically."""
    cfg_a = """
hostname test-switch
!
access-list 10 permit 10.10.1.0 0.0.0.255
access-list 10 permit 10.10.2.0 0.0.0.255
access-list 10 deny any
end
"""
    cfg_b = """
hostname test-switch
!
access-list 10 permit 10.10.2.0 0.0.0.255
access-list 10 permit 10.10.1.0 0.0.0.255
access-list 10 deny any
end
"""
    tree_a = normalize_config(cfg_a, "cisco_ios")
    tree_b = normalize_config(cfg_b, "cisco_ios")

    assert tree_a["access_list"]["10"] == tree_b["access_list"]["10"]
    assert tree_a["access_list"]["10"] == [
        "deny any",
        "permit 10.10.1.0 0.0.0.255",
        "permit 10.10.2.0 0.0.0.255",
    ]


def test_clean_vs_messy_fixture_equivalence():
    """
    Stress-test normalization on hand-written messy fixture:
    Inconsistent whitespace, tabs, mixed casing, and reordered blocks/lists
    must produce identical normalized key-path trees.
    """
    clean_raw = _read_fixture("cisco_ios_clean.cfg")
    messy_raw = _read_fixture("cisco_ios_messy.cfg")

    clean_tree = normalize_config(clean_raw, "cisco_ios")
    messy_tree = normalize_config(messy_raw, "cisco_ios")

    # Verify structural equality across canonical fields
    assert clean_tree["hostname"] == messy_tree["hostname"] == "sw-classroom-01"
    assert clean_tree["vlan"] == messy_tree["vlan"]
    assert clean_tree["interface"]["GigabitEthernet0/1"]["switchport"]["trunk_allowed_vlans"] == "10,20,99"
    assert messy_tree["interface"]["GigabitEthernet0/1"]["switchport"]["trunk_allowed_vlans"] == "10,20,99"
    assert clean_tree["access_list"] == messy_tree["access_list"]
    assert clean_tree["line"]["vty"]["transport_input"] == messy_tree["line"]["vty"]["transport_input"] == "ssh"
    assert clean_tree["interface"]["Vlan99"]["ip_address"] == messy_tree["interface"]["Vlan99"]["ip_address"] == "10.10.1.10/24"
    assert clean_tree["snmp"]["community"] == messy_tree["snmp"]["community"]


def test_syntax_variant_fixture():
    """Test syntax variant fixture with CIDR interface notation, no switchport, and multiple NTP servers."""
    variant_raw = _read_fixture("cisco_ios_syntax_variant.cfg")
    tree = normalize_config(variant_raw, "cisco_ios")

    assert tree["hostname"] == "sw-variant-01"
    assert tree["interface"]["GigabitEthernet0/0"]["ip_address"] == "10.10.100.1/24"
    assert tree["interface"]["GigabitEthernet0/0"]["switchport"]["enabled"] is False
    assert tree["interface"]["GigabitEthernet0/1"]["switchport"]["trunk_allowed_vlans"] == "10,20,30,40"
    assert tree["line"]["vty"]["transport_input"] == "ssh telnet"
    assert tree["ntp"]["server"] == ["10.10.0.1", "10.10.0.2"]
    assert "public" in tree["snmp"]["community"]
    assert "monitoring" in tree["snmp"]["community"]


def test_malformed_config_raises_parse_error():
    """
    Test that a corrupted / malformed configuration raises ParseError
    rather than silently dropping unparseable sections (§11 False Negatives).
    """
    malformed_raw = _read_fixture("cisco_ios_malformed.cfg")

    with pytest.raises(ParseError) as excinfo:
        normalize_config(malformed_raw, "cisco_ios")

    assert "switchport mode" in str(excinfo.value) or "Corrupted" in str(excinfo.value) or "Invalid" in str(excinfo.value)


def test_key_path_resolution():
    """Test resolve_key_path and resolve_wildcard_key_paths for baseline rule matching."""
    clean_raw = _read_fixture("cisco_ios_clean.cfg")
    tree = normalize_config(clean_raw, "cisco_ios")

    # Exact paths
    assert resolve_key_path(tree, "hostname") == "sw-classroom-01"
    assert resolve_key_path(tree, "line.vty.transport_input") == "ssh"
    assert resolve_key_path(tree, "ntp.server") == "10.10.0.1"
    assert resolve_key_path(tree, "snmp.community.internal-read.exists") == "true"
    assert resolve_key_path(tree, "snmp.community.public.exists") is None

    # Wildcard paths
    wildcards = resolve_wildcard_key_paths(tree, "interface.*.port_security.enabled")
    wildcard_dict = dict(wildcards)

    assert "interface.FastEthernet0/1.port_security.enabled" in wildcard_dict
    assert wildcard_dict["interface.FastEthernet0/1.port_security.enabled"] == "true"
    assert "interface.FastEthernet0/2.port_security.enabled" in wildcard_dict
    assert wildcard_dict["interface.FastEthernet0/2.port_security.enabled"] == "true"
