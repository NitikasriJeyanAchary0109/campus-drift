"""
Shared definitions for the evaluation corpus and harness: site types, ground-truth judgement table,
and the compliance rules (baselines) authored for each site type.

The judgement table is intentionally independent of rule weights - see docs/labels-and-thresholds.md.
"""
import json
from datetime import datetime, timezone
from typing import Any, Dict, List

SEED = 20261027
CAPTURE_TIME = datetime(2026, 10, 27, 12, 0, 0, tzinfo=timezone.utc)
DEVICES_PER_GROUP = 20
CLEAN_PER_GROUP = 3
NTP_SERVER = "10.10.0.1"
ACL_NAME = "STUDENT-IN"

TIER_ORDER = ["COMPLIANT", "AUTHORIZED", "LOW", "MEDIUM", "HIGH", "CRITICAL"]
TIER_TO_LABEL = {
    "COMPLIANT": "Compliant",
    "AUTHORIZED": "Drift-Authorized",
    "LOW": "Drift-Unauthorized-Low",
    "MEDIUM": "Drift-Unauthorized-Medium",
    "HIGH": "Drift-Unauthorized-High",
    "CRITICAL": "Non-Compliant (Critical)",
}
LABEL_TO_TIER = {v: k for k, v in TIER_TO_LABEL.items()}

# name -> properties of the site type (criticality weight mirrors database/seed/seed_data.py)
GROUPS: Dict[str, Dict[str, Any]] = {
    "Classroom": {"slug": "cls", "weight": 1.0, "access_vlan": 10, "trunk": [10, 11, 12, 99], "acl": False, "octet": 21, "wildcard_portsec": False},
    "Hostel": {"slug": "hst", "weight": 0.8, "access_vlan": 30, "trunk": [30, 31, 99], "acl": True, "octet": 22, "wildcard_portsec": False},
    "Office": {"slug": "off", "weight": 1.0, "access_vlan": 20, "trunk": [20, 21, 22, 99], "acl": True, "octet": 23, "wildcard_portsec": False},
    "Lab": {"slug": "lab", "weight": 1.2, "access_vlan": 60, "trunk": [60, 61, 99], "acl": True, "octet": 24, "wildcard_portsec": True},
    "PublicEvent": {"slug": "evt", "weight": 0.5, "access_vlan": 80, "trunk": [80, 81, 99], "acl": False, "octet": 25, "wildcard_portsec": False},
}

_ALL = ["Classroom", "Hostel", "Office", "Lab", "PublicEvent"]


def _same(tier: str) -> Dict[str, str]:
    return {g: tier for g in _ALL}


# Ground-truth tier for an unauthorized change, by change family and site type.
TIER_JUDGEMENT: Dict[str, Dict[str, str]] = {
    "vty_telnet": _same("CRITICAL"),
    "snmp_community": _same("CRITICAL"),
    "portsec_off": {"Classroom": "MEDIUM", "Hostel": "MEDIUM", "Office": "MEDIUM", "Lab": "HIGH", "PublicEvent": "LOW"},
    "trunk_leak": {"Classroom": "HIGH", "Hostel": "HIGH", "Office": "HIGH", "Lab": "HIGH", "PublicEvent": "MEDIUM"},
    "access_vlan_mgmt": {"Classroom": "HIGH", "Hostel": "HIGH", "Office": "HIGH", "Lab": "HIGH", "PublicEvent": "MEDIUM"},
    "acl_order": _same("HIGH"),
    "acl_removed": _same("HIGH"),
    "ntp": _same("LOW"),
}


def acl_entries(group: str) -> List[str]:
    net = f"10.10.{GROUPS[group]['access_vlan']}.0 0.0.0.255"
    return [
        f"permit ip {net} host 10.10.0.53",
        f"permit ip {net} host 10.10.0.54",
        f"deny ip {net} 10.10.0.0 0.0.255.255",
        f"permit ip {net} any",
        "deny ip any any",
    ]


def trunk_string(group: str) -> str:
    return ",".join(str(v) for v in sorted(GROUPS[group]["trunk"]))


def build_rules(group: str) -> List[Dict[str, Any]]:
    """Compliance rules (the approved baseline) for one site type."""
    g = GROUPS[group]
    rules: List[Dict[str, Any]] = [
        {"key_path": "line.vty.transport_input", "expected_value": "ssh", "rule_type": "EXACT",
         "severity_weight": 90, "hard_compliance": True,
         "description": "Cleartext Telnet must not be enabled on VTY lines; SSH is the only approved management transport."},
        {"key_path": "snmp.community.public.exists", "expected_value": "false", "rule_type": "MUST_NOT_EXIST",
         "severity_weight": 95, "hard_compliance": True,
         "description": "The default 'public' SNMP community must not exist; it exposes device state to any host."},
        {"key_path": "snmp.community.private.exists", "expected_value": "false", "rule_type": "MUST_NOT_EXIST",
         "severity_weight": 95, "hard_compliance": True,
         "description": "The default 'private' SNMP community must not exist; it commonly grants read-write access."},
    ]
    if g["wildcard_portsec"]:
        # Seed-style wildcard rule (see database/seed/seed_data.py, Lab-Baseline-v3)
        rules.append({"key_path": "interface.*.port_security.enabled", "expected_value": "true", "rule_type": "MUST_EXIST",
                      "severity_weight": 70, "hard_compliance": False,
                      "description": "Port security must be enabled on edge ports to stop rogue switches and MAC flooding."})
    else:
        for port in range(1, 5):
            rules.append({"key_path": f"interface.FastEthernet0/{port}.port_security.enabled", "expected_value": "true",
                          "rule_type": "EXACT", "severity_weight": 70, "hard_compliance": False,
                          "description": "Port security must be enabled on edge ports to stop rogue switches and MAC flooding."})
    rules += [
        {"key_path": "ntp.server", "expected_value": NTP_SERVER, "rule_type": "EXACT",
         "severity_weight": 30, "hard_compliance": False,
         "description": "Devices must sync time only from the institutional NTP server so logs can be correlated."},
        {"key_path": "interface.GigabitEthernet0/1.switchport.trunk_allowed_vlans", "expected_value": trunk_string(group),
         "rule_type": "EXACT", "severity_weight": 85, "hard_compliance": False,
         "description": "The uplink trunk may carry only the approved VLANs; extra VLANs leak traffic across segments."},
        {"key_path": "interface.FastEthernet0/1.switchport.access_vlan", "expected_value": str(g["access_vlan"]),
         "rule_type": "EXACT", "severity_weight": 85, "hard_compliance": False,
         "description": "Edge ports must stay in their approved access VLAN and never join the management VLAN."},
    ]
    if g["acl"]:
        rules.append({"key_path": f"access_list_ordered.{ACL_NAME}", "expected_value": json.dumps(acl_entries(group)),
                      "rule_type": "EXACT", "severity_weight": 85, "hard_compliance": False,
                      "description": "The student ingress ACL must keep its approved entries in a verdict-preserving order."})
    return rules
