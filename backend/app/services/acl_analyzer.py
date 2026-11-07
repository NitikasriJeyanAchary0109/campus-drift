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
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

PortRanges = Tuple[Tuple[int, int], ...]

# Service names that appear in real ACLs. A name that is not listed is kept as text and treated as "any port" when
# overlap is judged (the conservative choice: it can raise a false alarm, never hide a real swap).
SERVICE_PORTS = {
    "ftp-data": 20, "ftp": 21, "ssh": 22, "telnet": 23, "smtp": 25, "domain": 53, "tftp": 69, "www": 80, "http": 80,
    "pop3": 110, "ntp": 123, "snmp": 161, "snmptrap": 162, "bgp": 179, "https": 443, "syslog": 514, "ldap": 389,
}
KNOWN_PROTOCOLS = {"ip", "ipv6", "tcp", "udp", "icmp", "icmpv6", "esp", "ahp", "ahp", "gre", "ospf", "igmp", "eigrp", "pim", "sctp"}
PORT_OPERATORS = ("eq", "neq", "lt", "gt", "range")
_V4 = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")


@dataclass(frozen=True)
class Endpoint:
    """
    One side of a rule as an address space: ``addr`` with ``wildcard`` bits that do not matter (Cisco wildcard
    semantics, so discontiguous masks such as 0.0.0.254 are exact). ``group`` marks an object group or any name this
    parser cannot expand: its members are unknown, so it is assumed to overlap everything and compared by name.
    """
    version: int = 0            # 4, 6, or 0 for "any"
    addr: int = 0
    wildcard: int = 0
    group: Optional[str] = None

    @property
    def is_any(self) -> bool:
        return self.version == 0 and self.group is None

    def __str__(self) -> str:
        if self.group is not None:
            return f"group:{self.group}"
        if self.is_any:
            return "any"
        return f"v{self.version}:{self.addr:x}/{self.wildcard:x}"


ANY = Endpoint()


@dataclass
class ACLRule:
    raw: str
    action: str  # 'permit', 'deny' or 'remark'
    sequence: Optional[int] = None
    protocol: str = "ip"
    src: Endpoint = ANY
    dst: Endpoint = ANY
    src_ports: Optional[PortRanges] = None   # None = every port (or unknown)
    dst_ports: Optional[PortRanges] = None
    options: Tuple[str, ...] = field(default_factory=tuple)   # established, log, dscp ..., icmp types: compared, never ignored
    port_text: str = ""                      # the ports exactly as written, part of the identity of a rule


def _wildcard_to_int(wildcard: str) -> int:
    value = int(ipaddress.IPv4Address(wildcard))
    return value


def _endpoint(tokens: List[str], idx: int) -> Tuple[Endpoint, int]:
    """Parse one address spec starting at ``idx``; returns (endpoint, next index)."""
    if idx >= len(tokens):
        return ANY, idx
    tok = tokens[idx].lower()
    if tok == "any":
        return ANY, idx + 1
    if tok in ("object-group", "addrgroup") and idx + 1 < len(tokens):
        return Endpoint(group=tokens[idx + 1]), idx + 2
    if tok == "host" and idx + 1 < len(tokens):
        try:
            ip = ipaddress.ip_address(tokens[idx + 1])
            return Endpoint(ip.version, int(ip), 0), idx + 2
        except ValueError:
            return Endpoint(group=tokens[idx + 1]), idx + 2
    if "/" in tok:
        try:
            net = ipaddress.ip_network(tok, strict=False)
            host_bits = (1 << (net.max_prefixlen - net.prefixlen)) - 1
            return Endpoint(net.version, int(net.network_address), host_bits), idx + 1
        except ValueError:
            return Endpoint(group=tok), idx + 1
    if _V4.match(tok):
        if idx + 1 < len(tokens) and _V4.match(tokens[idx + 1]):
            try:
                return Endpoint(4, int(ipaddress.IPv4Address(tok)), _wildcard_to_int(tokens[idx + 1])), idx + 2
            except ValueError:
                pass
        try:
            return Endpoint(4, int(ipaddress.IPv4Address(tok)), 0), idx + 1
        except ValueError:
            return Endpoint(group=tok), idx + 1
    try:
        ip6 = ipaddress.IPv6Address(tok)
        return Endpoint(6, int(ip6), 0), idx + 1
    except ValueError:
        pass
    return Endpoint(group=tok), idx + 1


def _port_value(tok: str) -> Optional[int]:
    if tok.isdigit():
        return int(tok)
    return SERVICE_PORTS.get(tok.lower())


def _is_port_operand(tok: str) -> bool:
    low = tok.lower()
    return not (low in ("any", "host", "object-group", "addrgroup") or "/" in low or _V4.match(low) or ":" in low or low in PORT_OPERATORS)


def _ports(tokens: List[str], idx: int) -> Tuple[Optional[PortRanges], str, int]:
    """Optional port spec (eq/neq/lt/gt/range). Returns (ranges or None for 'any/unknown', text as written, next index)."""
    if idx >= len(tokens) or tokens[idx].lower() not in PORT_OPERATORS:
        return None, "", idx
    op = tokens[idx].lower()
    idx += 1
    operands: List[str] = []
    limit = 2 if op == "range" else 1
    while idx < len(tokens) and _is_port_operand(tokens[idx]) and (op in ("eq", "neq") or len(operands) < limit):
        operands.append(tokens[idx])
        idx += 1
    text = f"{op} {' '.join(o.lower() for o in operands)}"
    values = [_port_value(o) for o in operands]
    if not operands or any(v is None for v in values):
        return None, text, idx                       # unknown service name: identity keeps the text, overlap assumes any
    nums = sorted(v for v in values if v is not None)
    if op == "eq":
        return tuple((n, n) for n in nums), text, idx
    if op == "range" and len(nums) == 2:
        return ((nums[0], nums[1]),), text, idx
    if op == "lt":
        return ((0, max(nums[0] - 1, 0)),), text, idx
    if op == "gt":
        return ((min(nums[0] + 1, 65535), 65535),), text, idx
    if op == "neq":
        ranges, lo = [], 0
        for n in nums:
            if n > lo:
                ranges.append((lo, n - 1))
            lo = n + 1
        if lo <= 65535:
            ranges.append((lo, 65535))
        return tuple(ranges), text, idx
    return None, text, idx


def parse_acl_rule(rule_str: str) -> ACLRule:
    """Parse one Cisco IOS / FRR ACL rule into a structured ACLRule (addresses, ports, options all kept)."""
    raw = rule_str.strip()
    clean = raw
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
    if action == "remark":
        return ACLRule(raw=raw, action="remark", sequence=seq, port_text=" ".join(tokens[curr:]).lower())

    protocol = "ip"
    if curr < len(tokens):
        low = tokens[curr].lower()
        if low in KNOWN_PROTOCOLS or low.isdigit():
            protocol = "ip" if low == "ipv6" else low
            curr += 1
        elif low == "object-group" and curr + 1 < len(tokens):
            protocol = f"og:{tokens[curr + 1]}"
            curr += 2

    src, curr = _endpoint(tokens, curr)
    src_ports, src_text, curr = _ports(tokens, curr)
    dst, dst_text = ANY, ""
    dst_ports: Optional[PortRanges] = None
    if curr < len(tokens):
        dst, curr = _endpoint(tokens, curr)
        dst_ports, dst_text, curr = _ports(tokens, curr)
    options = tuple(sorted(t.lower() for t in tokens[curr:]))

    return ACLRule(
        raw=raw, action=action, sequence=seq, protocol=protocol, src=src, dst=dst,
        src_ports=src_ports, dst_ports=dst_ports, options=options, port_text=f"{src_text}|{dst_text}",
    )


def _endpoints_overlap(a: Endpoint, b: Endpoint) -> bool:
    if a.is_any or b.is_any or a.group is not None or b.group is not None:
        return True                                   # unknown members: assume they intersect
    if a.version != b.version:
        return False
    care = ~(a.wildcard | b.wildcard)                 # bits both sides pin down must agree
    return ((a.addr ^ b.addr) & care) == 0


def _ports_overlap(a: Optional[PortRanges], b: Optional[PortRanges]) -> bool:
    if a is None or b is None:
        return True
    return any(lo1 <= hi2 and lo2 <= hi1 for lo1, hi1 in a for lo2, hi2 in b)


def rules_overlap(r1: ACLRule, r2: ACLRule) -> bool:
    """True when some packet can match both rules (protocol, source, destination and ports all intersect)."""
    p1, p2 = r1.protocol, r2.protocol
    if not (p1 == p2 or "ip" in (p1, p2) or p1.startswith("og:") or p2.startswith("og:")):
        return False
    return (
        _endpoints_overlap(r1.src, r2.src)
        and _endpoints_overlap(r1.dst, r2.dst)
        and _ports_overlap(r1.src_ports, r2.src_ports)
        and _ports_overlap(r1.dst_ports, r2.dst_ports)
    )


def canonical_rule_key(rule: ACLRule) -> str:
    """Identity of a rule for set comparison: everything except the sequence number."""
    return f"{rule.action}:{rule.protocol}:{rule.src}:{rule.dst}:{rule.port_text}:{' '.join(rule.options)}"


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

    # Remarks never change what a packet does: they are left out of the comparison
    parsed_exp = [r for r in (parse_acl_rule(x) for x in expected_rules if x.strip()) if r.action != "remark"]
    parsed_act = [r for r in (parse_acl_rule(x) for x in actual_rules if x.strip()) if r.action != "remark"]

    keys_exp = [canonical_rule_key(r) for r in parsed_exp]
    keys_act = [canonical_rule_key(r) for r in parsed_act]

    # Added, removed or edited rules (any change to address, port, protocol or option) are drift, whatever the order
    if sorted(keys_exp) != sorted(keys_act):
        return {
            "status": "MODIFIED",
            "is_drift": True,
            "significant": True,
            "message": "ACL rules were added, removed, or structurally modified.",
        }

    # Position in the actual list of each expected rule; the n-th copy of a duplicated rule maps to the n-th copy
    seen: Dict[str, List[int]] = {}
    for idx, k in enumerate(keys_act):
        seen.setdefault(k, []).append(idx)
    used: Dict[str, int] = {}
    pos: List[int] = []
    for k in keys_exp:
        n = used.get(k, 0)
        pos.append(seen[k][n])
        used[k] = n + 1

    if pos == sorted(pos):
        return {
            "status": "COMPLIANT" if expected_rules == actual_rules else "COSMETIC",
            "is_drift": False,
            "significant": False,
            "message": "ACL rules are identical in sequence and syntax." if expected_rules == actual_rules
            else "Only remarks or sequence numbers differ; first-match forwarding behavior is identical.",
        }

    # Only a pair with different actions whose relative order flipped can change forwarding, and only if it overlaps
    n = len(parsed_exp)
    actions = [r.action for r in parsed_exp]
    for i in range(n):
        pi = pos[i]
        ai = actions[i]
        for j in range(i + 1, n):
            if pi > pos[j] and ai != actions[j] and rules_overlap(parsed_exp[i], parsed_exp[j]):
                r_i, r_j = parsed_exp[i], parsed_exp[j]
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
        "message": "Rule reordering involves only disjoint or same-action rules; first-match forwarding behavior is identical.",
    }
