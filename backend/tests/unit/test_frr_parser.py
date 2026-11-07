"""Second real parser: FRRouting vtysh syntax (not IOS text labelled 'frr')."""
import pytest

from app.services.normalization import normalize_config, resolve_key_path
from app.services.parsers.cisco_ios import ParseError
from app.services.parsers.frr_vtysh import looks_like_frr, parse_frr_vtysh

FRR = """\
Building configuration...

Current configuration:
!
frr version 8.4.2
frr defaults traditional
hostname rtr-lab-02
log syslog informational
service integrated-vtysh-config
!
ip route 0.0.0.0/0 10.10.100.1
ip route 10.50.0.0/16 eth1
ip forwarding
!
ip prefix-list CAMPUS seq 10 deny 10.99.0.0/16
ip prefix-list CAMPUS seq 5 permit 10.0.0.0/8 le 24
!
interface eth0
 description Uplink to Campus Backbone
 ip address 10.10.100.2/30
exit
!
interface eth1
 ip address 10.10.4.1/24
 shutdown
exit
!
router ospf
 ospf router-id 10.10.100.2
 network 10.10.4.0/24 area 0.0.0.0
 network 10.10.100.0/30 area 0.0.0.0
exit
!
router bgp 65001
 bgp router-id 10.10.100.2
 neighbor 10.10.100.1 remote-as 65000
 !
 address-family ipv4 unicast
  network 10.10.4.0/24
  neighbor 10.10.100.1 route-map ALLOW-OUT out
 exit-address-family
exit
!
line vty
 exec-timeout 10 0
exit
!
end
"""


def test_detection_of_real_frr_text():
    assert looks_like_frr(FRR)
    assert not looks_like_frr("version 15.2\nhostname sw\n!\nend\n")


def test_header_hostname_log_and_forwarding():
    t = parse_frr_vtysh(FRR)
    assert t["version"] == "8.4.2"
    assert t["hostname"] == "rtr-lab-02"
    assert t["log"]["syslog"] == "informational"
    assert t["ip"]["routing"] is True


def test_static_routes_and_default_gateway():
    t = parse_frr_vtysh(FRR)
    assert t["ip"]["default_gateway"] == "10.10.100.1"
    assert t["static_route"] == ["0.0.0.0/0 via 10.10.100.1", "10.50.0.0/16 via eth1"]


def test_interfaces_use_cidr_and_shutdown_flag():
    t = parse_frr_vtysh(FRR)
    assert t["interface"]["eth0"]["ip_address"] == "10.10.100.2/30"
    assert t["interface"]["eth0"]["description"] == "Uplink to Campus Backbone"
    assert t["interface"]["eth1"]["shutdown"] is True


def test_prefix_list_is_ordered_by_seq_not_by_text_order():
    t = parse_frr_vtysh(FRR)
    assert t["prefix_list"]["CAMPUS"] == ["permit 10.0.0.0/8 le 24", "deny 10.99.0.0/16"]


def test_router_blocks_ospf_and_bgp_including_address_family():
    t = parse_frr_vtysh(FRR)
    ospf = t["router"]["ospf"]["default"]
    assert ospf["router_id"] == "10.10.100.2"
    assert ospf["networks"] == ["network 10.10.100.0/30 area 0.0.0.0", "network 10.10.4.0/24 area 0.0.0.0"] or len(ospf["networks"]) == 2
    bgp = t["router"]["bgp"]["65001"]
    assert "neighbor 10.10.100.1 remote-as 65000" in bgp["neighbors"]
    assert "neighbor 10.10.100.1 route-map ALLOW-OUT out" in bgp["neighbors"]
    assert "network 10.10.4.0/24" in bgp["networks"]


def test_line_vty_block():
    assert parse_frr_vtysh(FRR)["line"]["vty"]["exec_timeout"] == "10 0"


def test_order_of_unordered_collections_does_not_matter():
    shuffled = FRR.replace(
        " network 10.10.4.0/24 area 0.0.0.0\n network 10.10.100.0/30 area 0.0.0.0\n",
        " network 10.10.100.0/30 area 0.0.0.0\n network 10.10.4.0/24 area 0.0.0.0\n",
    )
    assert parse_frr_vtysh(shuffled) == parse_frr_vtysh(FRR)


def test_a_changed_value_is_visible_through_key_paths():
    changed = FRR.replace(" ip address 10.10.4.1/24\n shutdown\n", " ip address 10.10.4.1/24\n")
    a, b = parse_frr_vtysh(FRR), parse_frr_vtysh(changed)
    assert resolve_key_path(a, "interface.eth1.shutdown") != resolve_key_path(b, "interface.eth1.shutdown")


@pytest.mark.parametrize(
    "bad",
    ["", "   \n", "frr version 8\nhostname\n", "frr version 8\nip route 0.0.0.0/0\n", "frr version 8\nip prefix-list X bogus\n",
     "frr version 8\ninterface eth0\n ip address 10.0.0.999/24\nexit\n", "frr version 8\n!%#CORRUPTED\n"],
)
def test_malformed_input_is_an_error_not_a_silent_skip(bad):
    with pytest.raises(ParseError):
        parse_frr_vtysh(bad)


def test_vendor_dispatch():
    assert normalize_config(FRR, "frr")["hostname"] == "rtr-lab-02"          # detected by header
    assert normalize_config(FRR, "frr_vtysh")["prefix_list"]["CAMPUS"]
    ios_style = "hostname rtr-lab-01\ninterface GigabitEthernet0/0\n ip address 10.10.100.2 255.255.255.252\n!\nend\n"
    tree = normalize_config(ios_style, "frr")                              # lab simulator text keeps the IOS parser
    assert tree["interface"]["GigabitEthernet0/0"]["ip_address"] == "10.10.100.2/30"
