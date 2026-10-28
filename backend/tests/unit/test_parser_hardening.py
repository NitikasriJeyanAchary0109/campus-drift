"""
Regression tests for parser / normalizer / evidence fixes found by the evaluation harness (WP1).

Each test documents the construct that previously produced a false PARSE_ERROR or a silent false negative.
See evaluation/results/before-fixes vs after-fixes and docs/evaluation-error-analysis.md.
"""
import pytest

from app.services.evidence import locate_source_line
from app.services.normalization import normalize_config, resolve_wildcard_key_paths
from app.services.parsers.cisco_ios import ParseError, merge_transport_input

BASE = "hostname sw-1\n!\n"


def parse(text: str):
    return normalize_config(BASE + text, "cisco_ios")


# ------------------------------------------------------------------ NTP options

@pytest.mark.parametrize("line,expected", [
    ("ntp server 10.10.0.1 prefer", ["10.10.0.1"]),
    ("ntp server 10.10.0.1 key 5 prefer", ["10.10.0.1"]),
    ("ntp server vrf MGMT 10.10.0.1", ["10.10.0.1"]),
    ("ntp server ntp1.Campus.Internal", ["ntp1.campus.internal"]),
])
def test_ntp_server_options_and_dns_names_parse(line, expected):
    assert parse(line + "\n")["ntp"]["server"] == expected


def test_ntp_ip_shaped_garbage_is_still_rejected():
    with pytest.raises(ParseError):
        parse("ntp server 999.1.1.1\n")


# ------------------------------------------------------------------ banners

def test_multiline_banner_body_is_skipped():
    tree = parse("banner motd ^C\nAuthorized access only! Violators: prosecuted.\n^C\nntp server 10.10.0.1\n")
    assert tree["ntp"]["server"] == ["10.10.0.1"]  # parsing resumes after the banner


def test_single_line_and_hash_delimited_banners():
    tree = parse("banner login ^CAuthorized users only^C\nbanner motd #\nWelcome, staff & students.\n#\nntp server 10.10.0.1\n")
    assert tree["ntp"]["server"] == ["10.10.0.1"]


def test_unterminated_banner_is_a_parse_error_not_a_silent_skip():
    with pytest.raises(ParseError, match="Unterminated banner"):
        parse("banner motd ^C\nno closing delimiter\nntp server 8.8.8.8\n")


def test_nul_byte_inside_banner_is_corruption():
    with pytest.raises(ParseError):
        parse("banner motd ^C\nbad\x00bytes\n^C\n")


# ------------------------------------------------------------------ unmonitored global lines

def test_punctuation_and_non_ascii_in_unmonitored_lines_are_accepted():
    tree = parse("snmp-server location Block B, Floor 2\nsnmp-server contact it@campus.edu (24/7)\nsnmp-server location Café Block-B\n")
    assert tree["snmp"]["community"] == {}


def test_control_characters_still_flag_corruption():
    with pytest.raises(ParseError):
        parse("snmp-server location bad\x07line\n")


# ------------------------------------------------------------------ VTY ranges

VTY_CASES = [
    ("line vty 0 4\n transport input ssh\nline vty 5 15\n transport input ssh\n", "ssh"),
    ("line vty 0 4\n transport input telnet ssh\nline vty 5 15\n transport input ssh\n", "ssh telnet"),  # was a silent FN
    ("line vty 0 4\n transport input ssh\nline vty 5 15\n transport input telnet\n", "ssh telnet"),
    ("line vty 0 4\n transport input ssh\nline vty 5 15\n transport input none\n", "ssh"),
    ("line vty 0 4\n transport input none\nline vty 5 15\n transport input none\n", "none"),
]


@pytest.mark.parametrize("text,expected", VTY_CASES)
def test_vty_ranges_are_merged_so_any_telnet_range_is_visible(text, expected):
    assert parse(text)["line"]["vty"]["transport_input"] == expected


def test_merge_transport_input_unit():
    assert merge_transport_input(None, "ssh") == "ssh"
    assert merge_transport_input("ssh", "ssh telnet") == "ssh telnet"
    assert merge_transport_input("none", "ssh") == "ssh"


# ------------------------------------------------------------------ ACL remarks

def test_acl_remarks_are_ignored():
    text = "ip access-list extended A\n remark documentation\n permit ip any any\naccess-list 10 remark old note\naccess-list 10 permit 10.0.0.0 0.0.0.255\n"
    tree = parse(text)
    assert tree["access_list_ordered"]["A"] == ["permit ip any any"]
    assert tree["access_list_ordered"]["10"] == ["permit 10.0.0.0 0.0.0.255"]


# ------------------------------------------------------------------ wildcard scoping

SWITCH = (
    "interface FastEthernet0/1\n switchport mode access\n switchport port-security\n"
    "interface FastEthernet0/2\n switchport mode access\n"
    "interface GigabitEthernet0/1\n switchport mode trunk\n"
    "interface Vlan99\n ip address 10.0.0.1 255.255.255.0\n"
    "interface GigabitEthernet0/2\n no switchport\n ip address 10.9.9.1 255.255.255.252\n"
)


def test_port_security_wildcard_only_expands_over_access_ports():
    tree = parse(SWITCH)
    paths = dict(resolve_wildcard_key_paths(tree, "interface.*.port_security.enabled"))
    assert paths == {
        "interface.FastEthernet0/1.port_security.enabled": "true",
        "interface.FastEthernet0/2.port_security.enabled": "false",  # access port without port-security: a real violation
    }


def test_other_wildcards_are_unchanged():
    tree = parse(SWITCH)
    shutdown = dict(resolve_wildcard_key_paths(tree, "interface.*.shutdown"))
    assert len(shutdown) == 5  # not scoped


# ------------------------------------------------------------------ evidence citation

CFG = """hostname sw-1
!
interface FastEthernet0/1
 switchport mode access
 switchport access vlan 30
 no switchport port-security
!
interface FastEthernet0/2
 switchport mode access
 switchport access vlan 30
!
interface GigabitEthernet0/1
 switchport mode trunk
 switchport trunk allowed vlan 30,31,99,50
!
ntp server 10.10.0.1
ntp server 8.8.8.8
snmp-server community public RO
ip access-list extended STUDENT-IN
 permit ip any any
line vty 0 4
 transport input ssh
line vty 5 15
 transport input telnet ssh
"""


@pytest.mark.parametrize("key,expected_text,expected_no", [
    ("interface.FastEthernet0/1.port_security.enabled", "no switchport port-security", 6),
    ("interface.FastEthernet0/1.switchport.access_vlan", "switchport access vlan 30", 5),
    ("interface.GigabitEthernet0/1.switchport.trunk_allowed_vlans", "switchport trunk allowed vlan 30,31,99,50", 14),
    ("snmp.community.public.exists", "snmp-server community public RO", 18),
    ("line.vty.transport_input", "transport input telnet ssh", 24),  # cites the offending range, not the SSH-only one
    ("access_list_ordered.STUDENT-IN", "ip access-list extended STUDENT-IN", 19),
])
def test_locate_source_line_cites_the_offending_line(key, expected_text, expected_no):
    assert locate_source_line(CFG, key) == (expected_text, expected_no)


def test_ntp_cites_the_unapproved_server():
    assert locate_source_line(CFG, "ntp.server", "10.10.0.1") == ("ntp server 8.8.8.8", 17)


def test_absent_items_cite_the_container_or_state_absence():
    text, no = locate_source_line(CFG, "interface.FastEthernet0/2.port_security.enabled")
    assert text.startswith("interface FastEthernet0/2 (absent):") and no == 8
    text, no = locate_source_line(CFG, "snmp.community.private.exists")
    assert text.startswith("(absent)") and no is None
    text, no = locate_source_line("hostname x\n", "ntp.server", "10.10.0.1")
    assert text.startswith("(absent)") and no is None


def test_unmappable_paths_and_empty_config_return_none():
    assert locate_source_line(CFG, "something.else") is None
    assert locate_source_line(None, "ntp.server") is None
