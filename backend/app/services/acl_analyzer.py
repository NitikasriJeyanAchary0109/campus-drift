"""
ACL Sequence Ordering & Overlap Analyzer
----------------------------------------
Implements semantic first-match evaluation, overlap detection, and sequence
order classification for Cisco IOS and FRR access-lists per Project Review #2.

Distinguishes between:
- Cosmetic reordering: Disjoint (non-overlapping) IP subnets/hosts where rule order
  does not alter traffic evaluation.
- Semantically significant reordering (ACL_ORDER_SIGNIFICANT): Overlapping rules
  with conflicting actions (e.g. permit vs deny) where order inversion changes
  first-match packet filtering behavior.
"""
import ipaddress
import json
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class ACLRule:
    raw: str
    action: str  # 'permit' or 'deny'
    sequence: Optional[int] = None
    protocol: str = "ip"  # 'ip', 'tcp', 'udp', 'icmp', etc.
    src_network: ipaddress.IPv4Network = ipaddress.IPv4Network("0.0.0.0/0")
    dst_network: ipaddress.IPv4Network = ipaddress.IPv4Network("0.0.0.0/0")
    src_ports: Optional[Tuple[int, int]] = None
    dst_ports: Optional[Tuple[int, int]] = None


def wildcard_to_netmask(wildcard_str: str) -> str:
    """Convert Cisco wildcard mask (e.g. 0.0.0.255) to subnet mask (255.255.255.0)."""
    octets = [255 - int(o) for o in wildcard_str.split(".")]
    return ".".join(str(o) for o in octets)


def parse_ip_or_wildcard(tokens: List[str], idx: int) -> Tuple[ipaddress.IPv4Network, int]:
    """Parse IP/wildcard tokens starting at idx; returns (IPv4Network, next_idx)."""
    if idx >= len(tokens):
        return ipaddress.IPv4Network("0.0.0.0/0"), idx

    tok = tokens[idx].lower()
    if tok == "any":
        return ipaddress.IPv4Network("0.0.0.0/0"), idx + 1

    if tok == "host":
        if idx + 1 < len(tokens):
            ip_str = tokens[idx + 1]
            return ipaddress.IPv4Network(f"{ip_str}/32"), idx + 2
        return ipaddress.IPv4Network("0.0.0.0/0"), idx + 1

    if "/" in tok:
        try:
            return ipaddress.IPv4Network(tok, strict=False), idx + 1
        except Exception:
            return ipaddress.IPv4Network("0.0.0.0/0"), idx + 1

    # Check if followed by wildcard mask (e.g. 10.10.1.0 0.0.0.255)
    if idx + 1 < len(tokens) and re.match(r"^\d+\.\d+\.\d+\.\d+$", tokens[idx + 1]):
        ip_str = tokens[idx]
        wildcard_str = tokens[idx + 1]
        try:
            netmask = wildcard_to_netmask(wildcard_str)
            return ipaddress.IPv4Network(f"{ip_str}/{netmask}", strict=False), idx + 2
        except Exception:
            pass

    # Standalone IP without mask (host IP)
    if re.match(r"^\d+\.\d+\.\d+\.\d+$", tok):
        try:
            return ipaddress.IPv4Network(f"{tok}/32"), idx + 1
        except Exception:
            pass

    return ipaddress.IPv4Network("0.0.0.0/0"), idx + 1


def parse_acl_rule(rule_str: str) -> ACLRule:
    """Parse an individual Cisco IOS / FRR ACL rule string into a structured ACLRule."""
    raw = rule_str.strip()
    clean = raw

    # Strip 'access-list <id>' prefix if present
    if clean.lower().startswith("access-list "):
        parts = clean.split(maxsplit=2)
        clean = parts[2].strip() if len(parts) >= 3 else clean

    tokens = clean.split()
    if not tokens:
        return ACLRule(raw=raw, action="permit")

    curr = 0
    seq: Optional[int] = None
    if tokens[curr].isdigit():
        seq = int(tokens[curr])
        curr += 1

    if curr >= len(tokens):
        return ACLRule(raw=raw, action="permit", sequence=seq)

    action = tokens[curr].lower()
    curr += 1

    protocol = "ip"
    known_protocols = {"ip", "tcp", "udp", "icmp", "esp", "ahp", "gre", "ospf", "igmp"}
    if curr < len(tokens) and tokens[curr].lower() in known_protocols:
        protocol = tokens[curr].lower()
        curr += 1

    # Source
    src_net, curr = parse_ip_or_wildcard(tokens, curr)

    # Optional source port (e.g. eq 22)
    if curr < len(tokens) and tokens[curr].lower() in ("eq", "lt", "gt", "range", "neq"):
        curr += 2  # skip operator and port

    # Destination (if tokens remain)
    dst_net = ipaddress.IPv4Network("0.0.0.0/0")
    if curr < len(tokens):
        dst_net, curr = parse_ip_or_wildcard(tokens, curr)

    # Optional destination port (e.g. eq 80)
    if curr < len(tokens) and tokens[curr].lower() in ("eq", "lt", "gt", "range", "neq"):
        curr += 2

    return ACLRule(
        raw=raw,
        action=action,
        sequence=seq,
        protocol=protocol,
        src_network=src_net,
        dst_network=dst_net,
    )


def rules_overlap(r1: ACLRule, r2: ACLRule) -> bool:
    """Determine if two ACL rules intersect on network packet space."""
    # Protocol intersection
    if r1.protocol != "ip" and r2.protocol != "ip" and r1.protocol != r2.protocol:
        return False

    # Source network overlap
    if not r1.src_network.overlaps(r2.src_network):
        return False

    # Destination network overlap
    if not r1.dst_network.overlaps(r2.dst_network):
        return False

    return True


def canonical_rule_key(rule: ACLRule) -> str:
    """Canonical representation of rule for set membership check (ignoring sequence number)."""
    return f"{rule.action}:{rule.protocol}:{rule.src_network}:{rule.dst_network}"


def to_acl_rule_list(val: Any) -> Optional[List[str]]:
    """Convert various input types (list, JSON string, newline/comma separated) into a list of rule strings."""
    if val is None:
        return None
    if isinstance(val, list):
        rules = [str(x).strip() for x in val if str(x).strip()]
        return rules if rules else None
    if isinstance(val, str):
        s = val.strip()
        if not s:
            return None
        if s.startswith("[") and s.endswith("]"):
            try:
                data = json.loads(s)
                if isinstance(data, list):
                    return [str(x).strip() for x in data if str(x).strip()]
            except Exception:
                pass
            try:
                import ast
                data = ast.literal_eval(s)
                if isinstance(data, list):
                    return [str(x).strip() for x in data if str(x).strip()]
            except Exception:
                pass
        if s.startswith("{") and s.endswith("}"):
            inner = s[1:-1]
            return [part.strip().strip("'\"") for part in inner.split(",") if part.strip()]
        if "\n" in s:
            return [line.strip().strip("'\"") for line in s.splitlines() if line.strip()]
        if "," in s:
            return [part.strip().strip("'\"") for part in s.split(",") if part.strip()]
        return [s.strip("'\"")]
    return None


def is_acl_rule_list(val: Any) -> bool:
    """Check if input represents a list of ACL rules."""
    rules = to_acl_rule_list(val)
    if not rules:
        return False
    for r in rules:
        p = r.lower().split()
        if not p:
            return False
        if p[0] in ("permit", "deny", "remark"):
            continue
        if p[0].isdigit() and len(p) > 1 and p[1] in ("permit", "deny", "remark"):
            continue
        if p[0] == "access-list":
            continue
        return False
    return True


def analyze_acl_permutation(expected_rules: List[str], actual_rules: List[str]) -> Dict[str, Any]:
    """
    Analyze relative rule ordering between baseline and actual ACL configurations.
    Returns:
    - status: 'COMPLIANT', 'COSMETIC', 'ACL_ORDER_SIGNIFICANT', or 'MODIFIED'
    - is_drift: bool
    - significant: bool
    - message: str
    """
    if expected_rules == actual_rules:
        return {
            "status": "COMPLIANT",
            "is_drift": False,
            "significant": False,
            "message": "ACL rules are identical in sequence and syntax.",
        }

    parsed_exp = [parse_acl_rule(r) for r in expected_rules if r.strip()]
    parsed_act = [parse_acl_rule(r) for r in actual_rules if r.strip()]

    keys_exp = [canonical_rule_key(r) for r in parsed_exp]
    keys_act = [canonical_rule_key(r) for r in parsed_act]

    # Check if elements are added or removed
    if sorted(keys_exp) != sorted(keys_act):
        return {
            "status": "MODIFIED",
            "is_drift": True,
            "significant": True,
            "message": "ACL rules were added, removed, or structurally modified.",
        }

    # Map actual positions
    act_index_map: Dict[str, List[int]] = {}
    for idx, k in enumerate(keys_act):
        act_index_map.setdefault(k, []).append(idx)

    # Check for inverted pairs
    inverted_pairs = []
    n = len(parsed_exp)
    for i in range(n):
        for j in range(i + 1, n):
            r_i = parsed_exp[i]
            r_j = parsed_exp[j]
            k_i = keys_exp[i]
            k_j = keys_exp[j]

            # In baseline, r_i is before r_j.
            # Did their relative order invert in actual?
            pos_act_i = act_index_map[k_i][0]
            pos_act_j = act_index_map[k_j][0]

            if pos_act_i > pos_act_j:
                inverted_pairs.append((r_i, r_j))

    # Inspect inverted pairs for semantic impact
    for r_i, r_j in inverted_pairs:
        if rules_overlap(r_i, r_j):
            if r_i.action != r_j.action:
                return {
                    "status": "ACL_ORDER_SIGNIFICANT",
                    "is_drift": True,
                    "significant": True,
                    "inverted_pair": (r_i.raw, r_j.raw),
                    "message": (
                        f"Precedence inversion between overlapping rules: '{r_i.raw}' ({r_i.action}) "
                        f"and '{r_j.raw}' ({r_j.action}) alters first-match packet evaluation."
                    ),
                }

    return {
        "status": "COSMETIC",
        "is_drift": False,
        "significant": False,
        "message": "Rule reordering involves only disjoint non-overlapping IP subnets; first-match forwarding behavior is identical.",
    }
