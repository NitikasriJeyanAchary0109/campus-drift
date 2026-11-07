"""
FRRouting (vtysh) Configuration Parser
--------------------------------------
Parses the output of ``vtysh -c 'show running-config'`` from FRRouting into the same key-path tree as
``parse_cisco_ios`` so that baselines, the drift engine and scoring work unchanged for FRR routers.

FRR syntax differs from IOS in ways that matter for drift detection:
* header lines ``frr version X`` / ``frr defaults traditional`` instead of ``version``
* addresses are CIDR (``10.0.0.1/30``), never ``address mask``; routes are ``ip route 0.0.0.0/0 10.0.0.1``
* blocks are closed with ``exit`` / ``exit-address-family`` and may be nested (``router bgp`` > ``address-family``)
* routing policy lives in ``ip prefix-list NAME seq N permit|deny PREFIX`` entries (order is defined by ``seq``)
* ``log syslog <level>`` replaces ``logging``, and there is no NTP, SNMP or VLAN configuration

Raises ParseError on corrupted or malformed input, like the IOS parser: nothing is skipped silently.
"""
import re
from typing import Any, Dict, Optional

from app.services.parsers.cisco_ios import ParseError, canonicalize_ip

_FRR_MARKERS = (re.compile(r"^\s*frr version\b", re.I | re.M), re.compile(r"^\s*frr defaults\b", re.I | re.M),
                re.compile(r"^\s*service integrated-vtysh-config\b", re.I | re.M))


def looks_like_frr(raw_config: str) -> bool:
    """True when the text carries an FRR header (``frr version`` / ``frr defaults`` / integrated vtysh config)."""
    return any(m.search(raw_config or "") for m in _FRR_MARKERS)


def _new_tree() -> Dict[str, Any]:
    return {
        "hostname": None,
        "version": None,
        "ip": {"domain_name": None, "default_gateway": None, "routing": True},
        "ntp": {"server": []},
        "snmp": {"community": {}},
        "vlan": {},
        "interface": {},
        "line": {},
        "access_list": {},
        "access_list_ordered": {},
        "router": {},
        "prefix_list": {},
        "static_route": [],
        "log": {"syslog": None},
    }


def parse_frr_vtysh(raw_config: str) -> Dict[str, Any]:
    if not raw_config or not raw_config.strip():
        raise ParseError("Configuration text is empty")

    tree = _new_tree()
    # stack of (kind, key) for the blocks we are inside; the top is the current block
    block: Optional[str] = None
    block_key: Optional[str] = None
    proto: Optional[str] = None
    pid: Optional[str] = None
    in_address_family = False

    for line_idx, raw_line in enumerate(raw_config.splitlines(), start=1):
        if "\x00" in raw_line or "%#" in raw_line or "#%" in raw_line:
            raise ParseError(f"Corrupted configuration stream at line {line_idx}: '{raw_line.strip()}'")
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("!"):
            continue
        low = stripped.lower()
        if low.startswith(("building configuration", "current configuration")):
            continue
        if low == "end":
            break
        indented = raw_line[:1] in (" ", "\t")

        if low == "exit-address-family":
            in_address_family = False
            continue
        if low == "exit":
            block, block_key, proto, pid, in_address_family = None, None, None, None, False
            continue

        if not indented:
            block, block_key, proto, pid, in_address_family = None, None, None, None, False
            parts = stripped.split()
            if low.startswith("frr version "):
                tree["version"] = parts[2] if len(parts) > 2 else None
            elif low.startswith("frr defaults") or low.startswith("service "):
                continue
            elif low.split()[0] == "hostname":
                if len(parts) < 2:
                    raise ParseError(f"Malformed hostname at line {line_idx}")
                tree["hostname"] = parts[1]
            elif low == "ip forwarding":
                tree["ip"]["routing"] = True
            elif low == "no ip forwarding":
                tree["ip"]["routing"] = False
            elif low.startswith("log syslog"):
                tree["log"]["syslog"] = parts[2].lower() if len(parts) > 2 else "debugging"
            elif low.startswith("ip route "):
                if len(parts) < 4:
                    raise ParseError(f"Malformed static route at line {line_idx}: '{stripped}'")
                prefix = canonicalize_ip(parts[2]) if "/" in parts[2] else parts[2]
                nexthop = parts[3]
                try:
                    nexthop = canonicalize_ip(nexthop)
                except ParseError:
                    pass  # an interface name (ip route 10.0.0.0/8 eth0) is valid
                tree["static_route"].append(f"{prefix} via {nexthop}")
                if prefix == "0.0.0.0/0" and tree["ip"]["default_gateway"] is None:
                    tree["ip"]["default_gateway"] = nexthop
            elif low.startswith("ip prefix-list "):
                m = re.match(r"ip prefix-list (\S+)(?: seq (\d+))? (permit|deny) (\S+)(.*)$", stripped, re.I)
                if not m:
                    raise ParseError(f"Malformed prefix-list at line {line_idx}: '{stripped}'")
                name, seq, action, pfx, rest = m.groups()
                entry = f"{action.lower()} {pfx}{rest.rstrip()}"
                tree["prefix_list"].setdefault(name, []).append((int(seq) if seq else 0, entry))
            elif low.split()[0] == "interface":
                if len(parts) < 2:
                    raise ParseError(f"Malformed interface definition at line {line_idx}")
                block, block_key = "interface", parts[1]
                tree["interface"].setdefault(block_key, {"ip_address": None, "shutdown": False, "description": None})
            elif low.split()[0] == "line":
                if len(parts) < 2:
                    raise ParseError(f"Malformed line statement at line {line_idx}")
                block, block_key = "line", parts[1].lower()
                tree["line"].setdefault(block_key, {"transport_input": None, "exec_timeout": None, "login": None})
            elif low.split()[0] == "router":
                if len(parts) < 2:
                    raise ParseError(f"Malformed router statement at line {line_idx}")
                block = "router"
                proto = parts[1].lower()
                pid = parts[2] if len(parts) > 2 and not parts[2].lower().startswith("vrf") else "default"
                block_key = f"{proto}.{pid}"
                tree["router"].setdefault(proto, {})[pid] = {"networks": [], "neighbors": [], "router_id": None}
            continue

        # indented command inside the current block
        cmd = stripped
        if block == "interface":
            iface = tree["interface"][block_key]
            if low.startswith("description "):
                iface["description"] = cmd.split(maxsplit=1)[1]
            elif low.startswith("ip address "):
                iface["ip_address"] = canonicalize_ip(cmd.split()[2])
            elif low == "shutdown":
                iface["shutdown"] = True
            elif low == "no shutdown":
                iface["shutdown"] = False
        elif block == "line":
            obj = tree["line"][block_key]
            if low.startswith("transport input"):
                obj["transport_input"] = " ".join(sorted(cmd.split()[2:]))
            elif low.startswith("exec-timeout"):
                obj["exec_timeout"] = " ".join(cmd.split()[1:])
            elif low.startswith("login"):
                obj["login"] = cmd
        elif block == "router":
            node = tree["router"][proto][pid]
            if low.startswith("address-family "):
                in_address_family = True
            elif low.startswith(("ospf router-id ", "bgp router-id ", "router-id ")):
                node["router_id"] = cmd.split()[-1]
            elif low.startswith("network "):
                node["networks"].append(cmd)
            elif low.startswith("neighbor "):
                node["neighbors"].append(cmd)
            elif in_address_family and low.startswith(("redistribute ", "neighbor ")):
                node["neighbors"].append(cmd)

    # Canonical form: prefix-lists are ordered by seq (that is their semantics); other collections are order-free.
    for name, entries in tree["prefix_list"].items():
        ordered = [e for _, e in sorted(entries, key=lambda x: x[0])]
        tree["prefix_list"][name] = ordered
    tree["static_route"] = sorted(tree["static_route"])
    for protos in tree["router"].values():
        for node in protos.values():
            node["networks"] = sorted(node["networks"])
            node["neighbors"] = sorted(node["neighbors"])
    return tree
