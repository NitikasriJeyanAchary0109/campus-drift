"""Regression tests for defects found in the architecture review: each case was a silent miss before the fix."""
import time

import pytest
from app.services.acl_analyzer import analyze_acl_permutation as analyze, parse_acl_rule, rules_overlap
from app.services.normalization import normalize_config, resolve_key_path, resolve_wildcard_key_paths, values_equal
from app.services.remediation import _lookup_json_path


def status(expected, actual):
    return analyze(expected, actual)["status"]


# --- ACL: what used to be invisible -----------------------------------------------------------------------------------
@pytest.mark.parametrize("expected,actual", [
    (["permit tcp any any eq 22"], ["permit tcp any any eq 23"]),                                   # port changed (SSH to Telnet)
    (["permit tcp any any eq 80"], ["permit tcp any any eq 80 established"]),                       # option added
    (["permit tcp any any eq 80 log"], ["permit tcp any any eq 80"]),                               # logging removed
    (["permit tcp object-group STAFF object-group SRV eq 443"], ["permit tcp object-group GUESTS object-group SRV eq 443"]),
    (["permit tcp any any range 20 25"], ["permit tcp any any range 20 26"]),
    (["permit ipv6 2001:db8::/32 any"], ["permit ipv6 2001:db9::/32 any"]),
    (["permit ip 10.1.1.0 0.0.0.254 any"], ["permit ip 10.1.1.0 0.0.0.255 any"]),                  # discontiguous vs contiguous wildcard
])
def test_changes_that_were_invisible_are_now_drift(expected, actual):
    result = analyze(expected, actual)
    assert result["is_drift"] is True, result


def test_a_moved_remark_is_not_drift():
    exp = ["remark corp", "deny ip 10.0.0.0 0.255.255.255 any", "permit ip any any"]
    act = ["deny ip 10.0.0.0 0.255.255.255 any", "remark corp", "permit ip any any"]
    assert analyze(exp, act)["is_drift"] is False


def test_an_edited_remark_is_not_drift():
    assert analyze(["remark a", "permit ip any any"], ["remark b", "permit ip any any"])["is_drift"] is False


def test_a_real_precedence_inversion_is_still_significant():
    exp = ["permit ip host 10.1.1.5 any", "deny ip 10.1.1.0 0.0.0.255 any"]
    assert status(exp, list(reversed(exp))) == "ACL_ORDER_SIGNIFICANT"


def test_swapping_disjoint_or_same_action_rules_is_cosmetic():
    disjoint = ["permit ip 10.1.1.0 0.0.0.255 any", "deny ip 10.2.2.0 0.0.0.255 any"]
    assert status(disjoint, list(reversed(disjoint))) == "COSMETIC"
    same = ["permit ip 10.1.1.0 0.0.0.255 any", "permit ip any any"]
    assert status(same, list(reversed(same))) == "COSMETIC"


def test_different_ports_on_overlapping_addresses_do_not_overlap():
    a = parse_acl_rule("permit tcp any any eq 22")
    b = parse_acl_rule("deny tcp any any eq 23")
    assert not rules_overlap(a, b)
    exp = [a.raw, b.raw]
    assert status(exp, list(reversed(exp))) == "COSMETIC"          # swapping them cannot change what any packet does


def test_overlapping_ports_do_overlap():
    assert rules_overlap(parse_acl_rule("permit tcp any any range 20 25"), parse_acl_rule("deny tcp any any eq 22"))
    assert rules_overlap(parse_acl_rule("permit tcp any any gt 1023"), parse_acl_rule("deny tcp any any eq 8080"))
    assert not rules_overlap(parse_acl_rule("permit tcp any any lt 1024"), parse_acl_rule("deny tcp any any eq 8080"))


def test_discontiguous_wildcards_are_exact():
    odd_hosts = parse_acl_rule("permit ip 10.1.1.1 0.0.0.254 any")       # every odd last octet
    assert str(odd_hosts.src) != "any"
    assert rules_overlap(odd_hosts, parse_acl_rule("deny ip host 10.1.1.7 any"))
    assert not rules_overlap(odd_hosts, parse_acl_rule("deny ip host 10.1.1.8 any"))


def test_object_groups_are_assumed_to_overlap_everything():
    exp = ["permit tcp object-group A any eq 443", "deny tcp 10.0.0.0 0.255.255.255 any eq 443"]
    assert status(exp, list(reversed(exp))) == "ACL_ORDER_SIGNIFICANT"


def test_ipv4_and_ipv6_never_overlap():
    assert not rules_overlap(parse_acl_rule("permit ipv6 2001:db8::/32 any"), parse_acl_rule("deny ip 10.0.0.0 0.255.255.255 any"))


def test_duplicate_rules_are_tracked_by_occurrence():
    exp = ["permit ip any any", "deny ip any any", "permit ip any any"]
    assert status(exp, ["deny ip any any", "permit ip any any", "permit ip any any"]) == "ACL_ORDER_SIGNIFICANT"


def test_large_reordered_acl_of_disjoint_same_action_rules_is_fast():
    exp = [f"permit ip 10.{i // 250}.{i % 250}.0 0.0.0.255 any" for i in range(3000)]
    t0 = time.time()
    assert status(exp, list(reversed(exp))) == "COSMETIC"
    assert time.time() - t0 < 2


# --- normalization --------------------------------------------------------------------------------------------------
def test_a_rogue_extra_value_is_not_equal_to_the_single_expected_value():
    assert values_equal(["10.10.0.1", "66.6.6.6"], "10.10.0.1") is False
    assert values_equal("10.10.0.1", ["10.10.0.1", "66.6.6.6"]) is False
    assert values_equal(["10.10.0.1"], "10.10.0.1") is True


def test_order_only_matters_for_text_that_is_not_a_keyword_set():
    assert values_equal("telnet ssh", "ssh telnet") is True
    assert values_equal("deny ip any any", "any ip deny any") is False


def test_verification_and_detection_resolve_a_multi_server_ntp_the_same_way():
    tree = normalize_config("hostname r1\nntp server 10.10.0.1\nntp server 66.6.6.6\n")
    assert _lookup_json_path(tree, "ntp.server") == resolve_key_path(tree, "ntp.server")
    assert values_equal(_lookup_json_path(tree, "ntp.server"), "10.10.0.1") is False


def test_sub_interface_keys_resolve_and_enumerate():
    cfg = "hostname r1\ninterface GigabitEthernet0/0.100\n encapsulation dot1Q 100\n ip address 10.1.100.1 255.255.255.0\n"
    tree = normalize_config(cfg)
    assert resolve_key_path(tree, "interface.GigabitEthernet0/0.100.ip_address") is not None
    concrete = dict(resolve_wildcard_key_paths(tree, "interface.*.ip_address"))
    assert concrete["interface.GigabitEthernet0/0.100.ip_address"] is not None
