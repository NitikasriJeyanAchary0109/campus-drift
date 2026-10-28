"""
Evidence Citation Service
-------------------------
Maps a drift detail's key path back to the line of the captured running-config that caused it, so every
high-priority output can be audited against the device's own text (PS requirement: evidence for every
high-priority output).

For items that are *absent* (a missing NTP server, a removed port-security statement) there is no offending
line; the citation then names the stanza that should have contained it, or states the absence explicitly with
the ``(absent)`` prefix and no line number.
"""
import re
from typing import Dict, List, Optional, Tuple

ABSENT = "(absent)"

Citation = Tuple[str, Optional[int]]  # (line text, 1-based line number or None)


def _stanzas(lines: List[str]) -> List[Tuple[int, str, List[Tuple[int, str]]]]:
    """Group lines into (header_line_no, header_text, [(child_line_no, child_text), ...])."""
    out: List[Tuple[int, str, List[Tuple[int, str]]]] = []
    for no, raw in enumerate(lines, start=1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("!"):
            continue
        if raw[:1] in (" ", "\t"):
            if out:
                out[-1][2].append((no, stripped))
        else:
            out.append((no, stripped, []))
    return out


def _find_block(stanzas, header_re: str):
    return [s for s in stanzas if re.match(header_re, s[1], re.IGNORECASE)]


def _first_child(block, prefixes: Tuple[str, ...]) -> Optional[Tuple[int, str]]:
    for no, text in block[2]:
        if text.lower().startswith(prefixes):
            return no, text
    return None


def locate_source_line(raw_config: Optional[str], key_path: str, expected_value: Optional[str] = None) -> Optional[Citation]:
    """Return the config line (text, line number) that evidences ``key_path``; ``None`` if it cannot be mapped."""
    if not raw_config:
        return None
    lines = raw_config.splitlines()
    stanzas = _stanzas(lines)

    # --- management transport on VTY lines (any range may be the offender)
    if key_path == "line.vty.transport_input":
        vty = _find_block(stanzas, r"^line vty\b")
        found = [(b, _first_child(b, ("transport input",))) for b in vty]
        found = [(b, c) for b, c in found if c]
        if not found:
            return (f"{vty[0][1]} {ABSENT}: no 'transport input' statement", vty[0][0]) if vty else (f"{ABSENT} line vty", None)
        for _, (no, text) in found:  # prefer the line that is not SSH-only
            if set(text.lower().split()[2:]) != {"ssh"}:
                return text, no
        return found[0][1][1], found[0][1][0]

    # --- SNMP community
    m = re.match(r"^snmp\.community\.([^.]+)\.exists$", key_path)
    if m:
        name = m.group(1)
        for no, raw in enumerate(lines, start=1):
            if re.match(rf"^snmp-server community {re.escape(name)}(\s|$)", raw.strip()):
                return raw.strip(), no
        return f"{ABSENT} snmp-server community {name}", None

    # --- interface properties
    m = re.match(r"^interface\.(.+?)\.(port_security|switchport)\.(\w+)$", key_path)
    if m:
        iface, section, prop = m.groups()
        blocks = _find_block(stanzas, rf"^interface {re.escape(iface)}$")
        if not blocks:
            return f"{ABSENT} interface {iface}", None
        block = blocks[0]
        prefixes = {
            ("port_security", "enabled"): ("switchport port-security", "no switchport port-security"),
            ("switchport", "trunk_allowed_vlans"): ("switchport trunk allowed vlan",),
            ("switchport", "access_vlan"): ("switchport access vlan",),
            ("switchport", "mode"): ("switchport mode",),
        }.get((section, prop))
        if prefixes:
            # a port that has port-security configured (plain) but evaluated false cites the explicit 'no ...' line
            if (section, prop) == ("port_security", "enabled"):
                explicit_no = _first_child(block, ("no switchport port-security",))
                if explicit_no:
                    return explicit_no[1], explicit_no[0]
            child = _first_child(block, prefixes)
            if child:
                return child[1], child[0]
        return f"{block[1]} {ABSENT}: no {section.replace('_', '-')} {prop} statement", block[0]

    # --- NTP
    if key_path == "ntp.server":
        ntp = [(no, raw.strip()) for no, raw in enumerate(lines, start=1) if raw.strip().lower().startswith("ntp server ")]
        if not ntp:
            return f"{ABSENT} ntp server", None
        for no, text in ntp:  # cite the server that is not the approved one
            if expected_value and expected_value not in text.split():
                return text, no
        return ntp[0][1], ntp[0][0]

    # --- ACLs
    m = re.match(r"^access_list(?:_ordered)?\.(.+)$", key_path)
    if m:
        name = m.group(1)
        for no, raw in enumerate(lines, start=1):
            s = raw.strip()
            if re.match(rf"^ip access-list \w+ {re.escape(name)}$", s, re.IGNORECASE) or s.startswith(f"access-list {name} "):
                return s, no
        return f"{ABSENT} access-list {name}", None

    # --- generic line.<type>.<attr>
    m = re.match(r"^line\.(\w+)\.", key_path)
    if m:
        blocks = _find_block(stanzas, rf"^line {m.group(1)}\b")
        if blocks:
            return blocks[0][1], blocks[0][0]
    return None
