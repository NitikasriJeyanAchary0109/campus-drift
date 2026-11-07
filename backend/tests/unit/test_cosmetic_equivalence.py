"""Different spellings of the same configuration must parse to the same thing, so they never raise a drift alert."""
import pytest
from app.services.parsers.cisco_ios import canonical_interface_name, parse_cisco_ios

HEAD = "hostname SW1\n"
REFERENCE = "interface GigabitEthernet0/1\n description Link to Lab\n switchport mode access\n switchport access vlan 10\n"


def _interfaces(text):
    return parse_cisco_ios(HEAD + text)["interface"]


@pytest.mark.parametrize("variant", [
    "interface GigabitEthernet0/1\n desc Link to Lab\n switchport mode access\n switchport access vlan 10\n",
    "interface GigabitEthernet0/1\n description    Link   to Lab   \n switchport  mode  access\n switchport access   vlan 10\n",
    "interface Gi0/1\n description Link to Lab\n switchport mode access\n switchport access vlan 10\n",
    "interface gig 0/1\n switchport mode access\n switchport access vlan 10\n",
    "INTERFACE GigabitEthernet0/1\n DESCRIPTION Link to Lab\n SWITCHPORT MODE ACCESS\n SWITCHPORT ACCESS VLAN 10\n",
    "interface GigabitEthernet0/1\r\n\tswitchport\tmode access\r\n\tswitchport access vlan 10\r\n",
    "!\ninterface GigabitEthernet0/1\n! a comment\n switchport mode access\n\n switchport access vlan 10\n!\n",
])
def test_equivalent_spellings_parse_identically(variant):
    assert _interfaces(variant) == _interfaces(REFERENCE)


def test_real_changes_are_still_different():
    assert _interfaces(REFERENCE) != _interfaces(REFERENCE.replace("vlan 10", "vlan 20"))
    assert _interfaces(REFERENCE) != _interfaces(REFERENCE.replace("access\n", "trunk\n", 1))
    assert _interfaces(REFERENCE) != _interfaces(REFERENCE.replace("GigabitEthernet0/1", "GigabitEthernet0/2"))


@pytest.mark.parametrize("short,full", [
    ("Gi0/1", "GigabitEthernet0/1"), ("Fa0/24", "FastEthernet0/24"), ("Te1/0/1", "TenGigabitEthernet1/0/1"),
    ("Po1", "Port-channel1"), ("Lo0", "Loopback0"), ("Vl10", "Vlan10"), ("Gi0/0.100", "GigabitEthernet0/0.100"),
    ("GigabitEthernet0/1", "GigabitEthernet0/1"), ("mgmt0", "mgmt0"),
])
def test_interface_names_expand(short, full):
    assert canonical_interface_name(short) == full
