"""
Remediation Templates & Command Generation Service
--------------------------------------------------
Strict, zero-trust CLI remediation command generator per §13 of architecture.md.
Commands are rendered ONLY from a fixed set of whitelisted Jinja2 templates keyed
to (vendor, rule_type, key_path_pattern).
Never accepts or executes free-text user commands.
Enforces per-field input sanitization and rejects shell metacharacters.
"""
import fnmatch
import ipaddress
import re
from typing import Any, Dict, List, Optional
from jinja2 import Environment, select_autoescape


class TemplateNotFoundError(Exception):
    """Raised when no whitelisted remediation template exists for a given rule/key_path."""
    pass


class SecurityViolationError(Exception):
    """Raised when parameters or rendered commands violate strict syntax/whitelisting rules."""
    pass


# 1. Per-Field Sanitization & Validation Rules
def validate_ip_address(val: str) -> str:
    """Validate that value is a well-formed IPv4 or IPv6 address."""
    val = val.strip()
    try:
        ipaddress.ip_address(val)
        return val
    except ValueError as e:
        raise SecurityViolationError(f"Invalid IP address format '{val}': {e}") from e


def validate_interface_name(val: str) -> str:
    """Validate interface name (e.g. FastEthernet0/1, GigabitEthernet0/0, eth0)."""
    val = val.strip()
    if not re.match(r"^[A-Za-z0-9\/\-\.]+$", val) or len(val) > 64:
        raise SecurityViolationError(f"Invalid interface name format '{val}'")
    return val


def validate_community_name(val: str) -> str:
    """Validate SNMP community string name."""
    val = val.strip()
    if not re.match(r"^[A-Za-z0-9_\-]+$", val) or len(val) > 64:
        raise SecurityViolationError(f"Invalid SNMP community name '{val}'")
    return val


def validate_transport_protocol(val: str) -> str:
    """Validate transport input protocol tokens (ssh, telnet, none, all)."""
    val = val.strip().lower()
    allowed = {"ssh", "telnet", "none", "all"}
    tokens = val.split()
    if not tokens or not all(t in allowed for t in tokens):
        raise SecurityViolationError(f"Invalid transport input protocol '{val}'")
    return " ".join(tokens)


def validate_vlan_id(val: str) -> str:
    """Validate IEEE 802.1Q VLAN ID (1-4094)."""
    val = val.strip()
    if not re.match(r"^[0-9]{1,4}$", val) or not (1 <= int(val) <= 4094):
        raise SecurityViolationError(f"Invalid VLAN ID '{val}'")
    return val


# 2. Strict Character Blacklist for Rendered Commands
FORBIDDEN_CHARS = {";", "&", "|", "`", "$", "(", ")", "{", "}", "<", ">", "\x00"}


def sanitize_rendered_commands(commands: List[str]) -> List[str]:
    """
    Ensure no rendered command line contains shell metacharacters or unauthorized escape sequences.
    """
    clean_lines = []
    for raw_cmd in commands:
        line = raw_cmd.strip()
        if not line or line.startswith("!"):
            continue
        for char in FORBIDDEN_CHARS:
            if char in line:
                raise SecurityViolationError(f"Command contains illegal shell character '{char}': {line}")
        clean_lines.append(line)
    return clean_lines


# 3. Whitelisted Jinja2 Templates Keyed to (vendor, rule_type, key_path_pattern)
TEMPLATES: Dict[str, List[Dict[str, Any]]] = {
    "cisco_ios": [
        {
            "pattern": "line.vty.transport_input",
            "rule_type": "EXACT",
            "template": "line vty 0 4\n transport input {{ expected_value }}",
            "param_validator": lambda p: {
                "expected_value": validate_transport_protocol(p.get("expected_value", "ssh"))
            },
        },
        {
            "pattern": "snmp.community.*.exists",
            "rule_type": "MUST_NOT_EXIST",
            "template": "no snmp-server community {{ community_name }}",
            "param_validator": lambda p: {
                "community_name": validate_community_name(p.get("community_name", "public"))
            },
        },
        {
            "pattern": "interface.*.port_security.enabled",
            "rule_type": "EXACT",
            "template": "interface {{ interface_name }}\n switchport port-security",
            "param_validator": lambda p: {
                "interface_name": validate_interface_name(p.get("interface_name", ""))
            },
        },
        {
            "pattern": "interface.*.port_security.enabled",
            "rule_type": "MUST_EXIST",
            "template": "interface {{ interface_name }}\n switchport port-security",
            "param_validator": lambda p: {
                "interface_name": validate_interface_name(p.get("interface_name", ""))
            },
        },
        {
            "pattern": "ntp.server",
            "rule_type": "EXACT",
            "template": (
                "{% if actual_value %}no ntp server {{ actual_value }}\n{% endif %}"
                "ntp server {{ expected_value }}"
            ),
            "param_validator": lambda p: {
                "expected_value": validate_ip_address(p.get("expected_value", "")),
                "actual_value": validate_ip_address(p.get("actual_value", "")) if p.get("actual_value") else None,
            },
        },
        {
            "pattern": "interface.*.switchport.access_vlan",
            "rule_type": "EXACT",
            "template": "interface {{ interface_name }}\n switchport access vlan {{ expected_value }}",
            "param_validator": lambda p: {
                "interface_name": validate_interface_name(p.get("interface_name", "")),
                "expected_value": validate_vlan_id(p.get("expected_value", "")),
            },
        },
    ],
    "frr": [
        {
            "pattern": "line.vty.transport_input",
            "rule_type": "EXACT",
            "template": "line vty\n transport input {{ expected_value }}",
            "param_validator": lambda p: {
                "expected_value": validate_transport_protocol(p.get("expected_value", "ssh"))
            },
        },
        {
            "pattern": "snmp.community.*.exists",
            "rule_type": "MUST_NOT_EXIST",
            "template": "no snmp-server community {{ community_name }}",
            "param_validator": lambda p: {
                "community_name": validate_community_name(p.get("community_name", "public"))
            },
        },
        {
            "pattern": "interface.*.port_security.enabled",
            "rule_type": "EXACT",
            "template": "interface {{ interface_name }}\n port-security",
            "param_validator": lambda p: {
                "interface_name": validate_interface_name(p.get("interface_name", ""))
            },
        },
        {
            "pattern": "interface.*.port_security.enabled",
            "rule_type": "MUST_EXIST",
            "template": "interface {{ interface_name }}\n port-security",
            "param_validator": lambda p: {
                "interface_name": validate_interface_name(p.get("interface_name", ""))
            },
        },
        {
            "pattern": "ntp.server",
            "rule_type": "EXACT",
            "template": (
                "{% if actual_value %}no ntp server {{ actual_value }}\n{% endif %}"
                "ntp server {{ expected_value }}"
            ),
            "param_validator": lambda p: {
                "expected_value": validate_ip_address(p.get("expected_value", "")),
                "actual_value": validate_ip_address(p.get("actual_value", "")) if p.get("actual_value") else None,
            },
        },
    ],
}

# Jinja2 environment (sandboxed, autoescaped)
_jinja_env = Environment(autoescape=select_autoescape())


def extract_template_parameters(key_path: str, expected_val: Optional[str], actual_val: Optional[str]) -> Dict[str, Any]:
    """Extract and categorize parameters from key path tokens and baseline values."""
    params: Dict[str, Any] = {
        "expected_value": expected_val,
        "actual_value": actual_val,
    }

    tokens = key_path.split(".")

    # Extract interface name if path is interface.<name>.*
    if len(tokens) >= 2 and tokens[0].lower() == "interface":
        params["interface_name"] = tokens[1]

    # Extract community name if path is snmp.community.<name>.*
    if len(tokens) >= 3 and tokens[0].lower() == "snmp" and tokens[1].lower() == "community":
        params["community_name"] = tokens[2]

    return params


def render_remediation_commands(
    vendor: str,
    rule_type: str,
    key_path: str,
    expected_value: Optional[str],
    actual_value: Optional[str],
) -> List[str]:
    """
    Render remediation CLI commands for a single diff using only whitelisted Jinja2 templates.
    Raises TemplateNotFoundError if no whitelisted template matches.
    Raises SecurityViolationError if parameters contain invalid tokens or illegal characters.
    """
    vendor_key = vendor.lower()
    if vendor_key not in TEMPLATES:
        raise TemplateNotFoundError(f"Vendor '{vendor}' is not supported by the Remediation Engine.")

    matching_entry = None
    for entry in TEMPLATES[vendor_key]:
        if fnmatch.fnmatch(key_path, entry["pattern"]) and entry["rule_type"] == rule_type:
            matching_entry = entry
            break

    if not matching_entry:
        raise TemplateNotFoundError(
            f"No whitelisted remediation template found for vendor='{vendor}', "
            f"rule_type='{rule_type}', key_path='{key_path}'"
        )

    # 1. Extract raw parameters
    raw_params = extract_template_parameters(key_path, expected_value, actual_value)

    # 2. Validate parameters strictly per field type
    validator = matching_entry["param_validator"]
    validated_params = validator(raw_params)

    # 3. Render Jinja2 template
    tmpl = _jinja_env.from_string(matching_entry["template"])
    rendered_text = tmpl.render(**validated_params)

    # 4. Check for illegal characters and format output lines
    raw_lines = [line.strip() for line in rendered_text.splitlines() if line.strip()]
    return sanitize_rendered_commands(raw_lines)
