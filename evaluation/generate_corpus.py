#!/usr/bin/env python3
"""
Deterministic generator for the evaluation corpus.

Produces, under ``evaluation/corpus/``:
    configs/<host>.cfg      the device's running-config as captured (with its scenario applied)
    golden/<host>.cfg       the device's clean last-known-good config (used by the naive baselines)
    baselines.yaml          the compliance rules (approved baseline) for each site type
    tickets.yaml            change tickets used by the ticket scenarios
    manifest.yaml           ground truth: per device, scenario, stratum, split, findings, expected tier

Run:  python evaluation/generate_corpus.py [--out evaluation/corpus] [--seed N]
The same seed always yields byte-identical output.
"""
import argparse
import random
import shutil
import sys
from datetime import timedelta
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spec  # noqa: E402


# ----------------------------------------------------------------------------- config model

class Block:
    """One top-level stanza: a header line and its indented children (or raw unindented lines)."""

    def __init__(self, header: str, children: Optional[List[str]] = None, raw: bool = False):
        self.header = header
        self.children = list(children or [])
        self.raw = raw


class Cfg:
    def __init__(self, blocks: List[Block]):
        self.blocks = blocks

    def find(self, header: str) -> Block:
        for b in self.blocks:
            if b.header == header:
                return b
        raise KeyError(header)

    def index(self, header: str) -> int:
        return self.blocks.index(self.find(header))

    def remove(self, header: str) -> None:
        self.blocks.remove(self.find(header))

    def insert_after(self, header: str, block: Block) -> None:
        self.blocks.insert(self.index(header) + 1, block)


def build_base(group: str, idx: int) -> Cfg:
    g = spec.GROUPS[group]
    host = f"sw-{g['slug']}-{idx:02d}"
    access = g["access_vlan"]
    blocks = [
        Block("version 15.2"),
        Block("service timestamps debug datetime msec"),
        Block("service timestamps log datetime msec"),
        Block("no service password-encryption"),
        Block(f"hostname {host}"),
        Block("boot-start-marker"),
        Block("boot-end-marker"),
        Block("ip domain-name campus.internal"),
        Block(f"vlan {access}", [f"name {group}-Access"]),
        Block("vlan 99", ["name Management"]),
    ]
    for port in range(1, 9):
        blocks.append(Block(f"interface FastEthernet0/{port}", [
            "switchport mode access",
            f"switchport access vlan {access}",
            "switchport port-security",
            "switchport port-security maximum 2",
            "switchport port-security violation restrict",
        ]))
    blocks += [
        Block("interface GigabitEthernet0/1", ["switchport mode trunk", f"switchport trunk allowed vlan {spec.trunk_string(group)}"]),
        Block("interface Vlan99", [f"ip address 10.{g['octet']}.{idx}.10 255.255.255.0", "no shutdown"]),
        Block(f"ip default-gateway 10.{g['octet']}.{idx}.1"),
        Block(f"ntp server {spec.NTP_SERVER}"),
        Block("snmp-server community campus-ro RO"),
    ]
    if g["acl"]:
        blocks.append(Block(f"ip access-list extended {spec.ACL_NAME}", spec.acl_entries(group)))
    blocks += [
        Block("line con 0", ["exec-timeout 5 0"]),
        Block("line vty 0 4", ["transport input ssh", "exec-timeout 15 0", "login local"]),
    ]
    return Cfg(blocks)


def render(cfg: Cfg, noise: Optional[random.Random] = None, crlf: bool = False, preamble: Optional[List[str]] = None) -> str:
    lines: List[str] = list(preamble or []) + ["!"]
    for i, b in enumerate(cfg.blocks):
        lines.append(b.header)
        for c in b.children:
            if b.raw:
                lines.append(c)
            else:
                indent = "\t" if (noise and noise.random() < 0.15) else " "
                lines.append(indent + c)
        nxt = cfg.blocks[i + 1] if i + 1 < len(cfg.blocks) else None
        # IOS prints '!' after stanzas with children, and before the next stanza that has children
        if b.children or (nxt is not None and nxt.children):
            if noise and noise.random() < 0.25:
                lines.append("! last change by console")
            lines.append("!")
            if noise and noise.random() < 0.2:
                lines.append("")
    lines.append("end")
    if noise:
        lines = [ln + ("  " * noise.randint(0, 1) if ln and noise.random() < 0.2 else "") for ln in lines]
    text = ("\r\n" if crlf else "\n").join(lines) + ("\r\n" if crlf else "\n")
    return text


# ----------------------------------------------------------------------------- scenario plumbing

class Ctx:
    def __init__(self, cfg: Cfg, group: str, host: str, idx: int, rng: random.Random):
        self.cfg, self.group, self.host, self.idx, self.rng = cfg, group, host, idx, rng
        self.findings: List[Dict[str, Any]] = []
        self.tickets: List[Dict[str, Any]] = []
        self.noise = False
        self.crlf = False
        self.expect_parse_error = False
        self.truncate_after: Optional[str] = None
        self.preamble: List[str] = []
        self.per_group = spec.DEVICES_PER_GROUP
        self.notes = ""

    def finding(self, key_path: str, family: str, mutation: str, authorized: bool = False) -> None:
        self.findings.append({"key_path": key_path, "family": family, "mutation": mutation, "drift": True, "authorized": authorized})

    def ticket(self, tag: str, scope: str, start_min: int, end_min: int, device: Optional[str] = "self",
               status: str = "OPEN") -> None:
        t0 = spec.CAPTURE_TIME
        dev = self.host if device == "self" else device
        self.tickets.append({
            "ticket_ref": f"CHG-{self.host}-{tag}",
            "device": dev,
            "group": None if dev else self.group,
            "key_path_scope": scope,
            "valid_from": (t0 + timedelta(minutes=start_min)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "valid_to": (t0 + timedelta(minutes=end_min)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "status": status,
        })


# ---- primitive mutations (each registers its ground-truth finding) -------------------------------

def m_vty(ctx: Ctx, value: str, mutation: str) -> None:
    blk = ctx.cfg.find("line vty 0 4")
    blk.children[0] = f"transport input {value}"
    ctx.finding("line.vty.transport_input", "vty_telnet", mutation)


def m_snmp(ctx: Ctx, name: str, mode: str, mutation: str, suffix: str = "") -> None:
    ctx.cfg.insert_after("snmp-server community campus-ro RO", Block(f"snmp-server community {name} {mode}{suffix}"))
    ctx.finding(f"snmp.community.{name}.exists", "snmp_community", mutation)


def m_portsec(ctx: Ctx, explicit: bool, mutation: str, authorized: bool = False, port: Optional[int] = None) -> int:
    port = port or ctx.rng.randint(1, 4)
    blk = ctx.cfg.find(f"interface FastEthernet0/{port}")
    blk.children = [c for c in blk.children if not c.startswith("switchport port-security")]
    if explicit:
        blk.children.append("no switchport port-security")
    ctx.finding(f"interface.FastEthernet0/{port}.port_security.enabled", "portsec_off", mutation, authorized)
    return port


def m_ntp_repoint(ctx: Ctx, authorized: bool = False) -> None:
    blk = ctx.cfg.find(f"ntp server {spec.NTP_SERVER}")
    blk.header = "ntp server 8.8.8.8"
    ctx.finding("ntp.server", "ntp", "ntp_repoint", authorized)


def m_trunk_leak(ctx: Ctx, authorized: bool = False) -> None:
    vlans = sorted(spec.GROUPS[ctx.group]["trunk"] + [50])
    ctx.cfg.find("interface GigabitEthernet0/1").children[1] = "switchport trunk allowed vlan " + ",".join(map(str, vlans))
    ctx.finding("interface.GigabitEthernet0/1.switchport.trunk_allowed_vlans", "trunk_leak", "trunk_leak", authorized)


# ---- scenarios ------------------------------------------------------------------------------------

def s_clean(c: Ctx): pass


def s_cos_vlan_notation(c: Ctx):
    nums = sorted(v for v in spec.GROUPS[c.group]["trunk"] if v != 99)
    c.cfg.find("interface GigabitEthernet0/1").children[1] = f"switchport trunk allowed vlan 99,{nums[0]}-{nums[-1]}"


def s_cos_whitespace(c: Ctx):
    c.noise = True
    c.crlf = c.rng.random() < 0.5


def s_cos_reorder(c: Ctx):
    fa = [b for b in c.cfg.blocks if b.header.startswith("interface FastEthernet")]
    c.rng.shuffle(fa)
    others = [b for b in c.cfg.blocks if not b.header.startswith("interface FastEthernet")]
    pos = next(i for i, b in enumerate(others) if b.header.startswith("interface GigabitEthernet"))
    c.cfg.blocks = others[:pos] + fa + others[pos:]
    ntp = c.cfg.find(f"ntp server {spec.NTP_SERVER}")
    c.cfg.blocks.remove(ntp)
    c.cfg.blocks.insert(8, ntp)


def s_cos_unmonitored(c: Ctx):
    c.cfg.find("vlan 99").children[0] = "name Mgmt-Plane"
    c.cfg.find("line vty 0 4").children[1] = "exec-timeout 10 0"
    c.cfg.find("line con 0").children[0] = "exec-timeout 0 0"
    c.cfg.insert_after("ip domain-name campus.internal", Block("logging host 10.10.0.5"))
    for p in c.rng.sample(range(1, 9), 3):
        c.cfg.find(f"interface FastEthernet0/{p}").children.insert(0, f"description Room-{100 + p}")


def s_cos_acl_disjoint(c: Ctx):
    blk = c.cfg.find(f"ip access-list extended {spec.ACL_NAME}")
    blk.children[0], blk.children[1] = blk.children[1], blk.children[0]


def s_vty_added(c: Ctx): m_vty(c, "telnet ssh", "vty_telnet_added")
def s_vty_only(c: Ctx): m_vty(c, "telnet", "vty_telnet_only")
def s_vty_all(c: Ctx): m_vty(c, "all", "vty_transport_all")
def s_snmp_public(c: Ctx): m_snmp(c, "public", "RO", "snmp_public")
def s_snmp_private(c: Ctx): m_snmp(c, "private", "RW", "snmp_private_rw")
def s_portsec_implicit(c: Ctx): m_portsec(c, False, "portsec_removed")
def s_portsec_explicit(c: Ctx): m_portsec(c, True, "portsec_explicit_no")
def s_ntp_repoint(c: Ctx): m_ntp_repoint(c)


def s_ntp_missing(c: Ctx):
    c.cfg.remove(f"ntp server {spec.NTP_SERVER}")
    c.finding("ntp.server", "ntp", "ntp_missing")


def s_trunk_leak(c: Ctx): m_trunk_leak(c)


def s_access_mgmt(c: Ctx):
    c.cfg.find("interface FastEthernet0/1").children[1] = "switchport access vlan 99"
    c.finding("interface.FastEthernet0/1.switchport.access_vlan", "access_vlan_mgmt", "access_vlan_to_mgmt")


def s_acl_swap(c: Ctx):
    blk = c.cfg.find(f"ip access-list extended {spec.ACL_NAME}")
    blk.children[1], blk.children[2] = blk.children[2], blk.children[1]  # permit host .54 <-> deny 10.10/16 (overlap)
    c.finding(f"access_list_ordered.{spec.ACL_NAME}", "acl_order", "acl_overlap_swap")


def s_acl_removed(c: Ctx):
    blk = c.cfg.find(f"ip access-list extended {spec.ACL_NAME}")
    del blk.children[2]
    c.finding(f"access_list_ordered.{spec.ACL_NAME}", "acl_removed", "acl_entry_removed")


def s_multi(c: Ctx):
    m_vty(c, "telnet ssh", "vty_telnet_added")
    m_ntp_repoint(c)
    m_trunk_leak(c)


def s_t_ntp_in_window(c: Ctx):
    m_ntp_repoint(c, authorized=True); c.ticket("win", "ntp.server", -120, 120)


def s_t_ntp_grace_after(c: Ctx):
    m_ntp_repoint(c, authorized=True); c.ticket("grace", "ntp.server", -180, -20)
    c.notes = "ticket ended 20 min before capture: inside the 30 min grace window"


def s_t_ntp_expired(c: Ctx):
    m_ntp_repoint(c); c.ticket("expired", "ntp.server", -180, -45)
    c.notes = "ticket ended 45 min before capture: outside the grace window"


def s_t_ntp_starts_soon(c: Ctx):
    m_ntp_repoint(c, authorized=True); c.ticket("soon", "ntp.server", 20, 200)
    c.notes = "ticket starts 20 min after capture: inside the grace window"


def s_t_ntp_starts_late(c: Ctx):
    m_ntp_repoint(c); c.ticket("late", "ntp.server", 45, 200)
    c.notes = "ticket starts 45 min after capture: outside the grace window"


def s_t_trunk_group(c: Ctx):
    m_trunk_leak(c, authorized=True); c.ticket("grp", "interface.GigabitEthernet0/1", -60, 240, device=None)
    c.notes = "group-scoped ticket with prefix key-path scope"


def s_t_portsec_prefix(c: Ctx):
    m_portsec(c, False, "portsec_removed", authorized=True, port=1); c.ticket("prefix", "interface.FastEthernet0/1", -60, 240)


def s_t_hard_telnet(c: Ctx):
    m_vty(c, "telnet ssh", "vty_telnet_added"); c.ticket("hard", "line.vty", -60, 240)
    c.notes = "hard-compliance rule: a valid ticket must NOT authorize it"


def s_t_other_device(c: Ctx):
    m_ntp_repoint(c)
    other = f"sw-{spec.GROUPS[c.group]['slug']}-{(c.idx + 1) % c.per_group:02d}"
    c.ticket("other", "ntp.server", -60, 240, device=other)
    c.notes = f"ticket belongs to {other}"


def s_t_wrong_scope(c: Ctx):
    m_trunk_leak(c); c.ticket("scope", "snmp", -60, 240)
    c.notes = "ticket scope (snmp) does not cover the trunk key path"


def s_t_multi_partial(c: Ctx):
    m_ntp_repoint(c, authorized=True); m_trunk_leak(c); c.ticket("part", "ntp.server", -60, 240)
    c.notes = "ticket authorizes NTP only; the trunk leak is unauthorized"


def s_r_banner(c: Ctx):
    c.cfg.insert_after("ip domain-name campus.internal", Block(
        "banner motd ^C", ["Authorized access only! Violators will be prosecuted.", "^C"], raw=True))
    c.notes = "legitimate login banner (unindented body, ^C delimiter)"


def s_r_ntp_prefer(c: Ctx):
    c.cfg.find(f"ntp server {spec.NTP_SERVER}").header = f"ntp server {spec.NTP_SERVER} prefer"


def s_r_snmp_location(c: Ctx):
    c.cfg.insert_after("snmp-server community campus-ro RO", Block("snmp-server location Block B, Floor 2"))


def s_r_vty_split_clean(c: Ctx):
    c.cfg.insert_after("line vty 0 4", Block("line vty 5 15", ["transport input ssh", "login local"]))


def s_r_vty_split_telnet(c: Ctx):
    m_vty(c, "telnet ssh", "vty_telnet_added_split")
    c.cfg.insert_after("line vty 0 4", Block("line vty 5 15", ["transport input ssh", "login local"]))
    c.notes = "telnet only on 'line vty 0 4'; 'line vty 5 15' is SSH-only"


def s_r_ntp_extra(c: Ctx):
    c.cfg.insert_after(f"ntp server {spec.NTP_SERVER}", Block("ntp server 8.8.8.8"))
    c.finding("ntp.server", "ntp", "ntp_extra_rogue")


def s_r_snmp_public_acl(c: Ctx): m_snmp(c, "public", "RO", "snmp_public_with_acl", suffix=" 10")


def s_p_corrupt(c: Ctx):
    c.cfg.find("vlan 99").children.append("!%#CORRUPTED_STREAM_SEGMENT_OVERRUN_0xDEADBEEF#%!")
    c.expect_parse_error = True


def s_p_truncated(c: Ctx):
    c.truncate_after = "interface FastEthernet0/3\n switchport mode"
    c.expect_parse_error = True


# name -> (function, stratum, requires_acl)
SCENARIOS: Dict[str, Any] = {
    "clean": (s_clean, "core", False),
    "cos_vlan_notation": (s_cos_vlan_notation, "core", False),
    "cos_whitespace": (s_cos_whitespace, "core", False),
    "cos_reorder": (s_cos_reorder, "core", False),
    "cos_unmonitored": (s_cos_unmonitored, "core", False),
    "cos_acl_disjoint": (s_cos_acl_disjoint, "core", True),
    "d_vty_telnet_added": (s_vty_added, "core", False),
    "d_vty_telnet_only": (s_vty_only, "core", False),
    "d_vty_transport_all": (s_vty_all, "core", False),
    "d_snmp_public": (s_snmp_public, "core", False),
    "d_snmp_private_rw": (s_snmp_private, "core", False),
    "d_portsec_removed": (s_portsec_implicit, "core", False),
    "d_portsec_explicit_no": (s_portsec_explicit, "core", False),
    "d_ntp_repoint": (s_ntp_repoint, "core", False),
    "d_ntp_missing": (s_ntp_missing, "core", False),
    "d_trunk_leak": (s_trunk_leak, "core", False),
    "d_access_vlan_mgmt": (s_access_mgmt, "core", False),
    "d_acl_overlap_swap": (s_acl_swap, "core", True),
    "d_acl_entry_removed": (s_acl_removed, "core", True),
    "d_multi": (s_multi, "core", False),
    "t_ntp_in_window": (s_t_ntp_in_window, "core", False),
    "t_ntp_grace_after": (s_t_ntp_grace_after, "core", False),
    "t_ntp_expired": (s_t_ntp_expired, "core", False),
    "t_ntp_starts_soon": (s_t_ntp_starts_soon, "core", False),
    "t_ntp_starts_late": (s_t_ntp_starts_late, "core", False),
    "t_trunk_group_ticket": (s_t_trunk_group, "core", False),
    "t_portsec_prefix_scope": (s_t_portsec_prefix, "core", False),
    "t_hard_telnet": (s_t_hard_telnet, "core", False),
    "t_other_device": (s_t_other_device, "core", False),
    "t_wrong_scope": (s_t_wrong_scope, "core", False),
    "t_multi_partial": (s_t_multi_partial, "core", False),
    "r_banner": (s_r_banner, "realism", False),
    "r_ntp_prefer": (s_r_ntp_prefer, "realism", False),
    "r_snmp_location": (s_r_snmp_location, "realism", False),
    "r_vty_split_clean": (s_r_vty_split_clean, "realism", False),
    "r_vty_split_telnet": (s_r_vty_split_telnet, "realism", False),
    "r_ntp_extra_server": (s_r_ntp_extra, "realism", False),
    "r_snmp_public_acl": (s_r_snmp_public_acl, "realism", False),
    "p_corrupt_stream": (s_p_corrupt, "adversarial", False),
    "p_truncated": (s_p_truncated, "adversarial", False),
}


# ---- challenge scenarios: authored AFTER the standard corpus was analysed and the defects fixed. -----
# They are run once as a held-out check and are not used to tune anything.

def s_c_vty_range_telnet(c: Ctx):
    c.cfg.insert_after("line vty 0 4", Block("line vty 5 15", ["transport input telnet ssh", "login local"]))
    c.finding("line.vty.transport_input", "vty_telnet", "vty_5_15_telnet")
    c.notes = "'line vty 0 4' is SSH-only; 'line vty 5 15' allows telnet"


def s_c_vty_second_range_none(c: Ctx):
    c.cfg.insert_after("line vty 0 4", Block("line vty 5 15", ["transport input none", "login local"]))
    c.notes = "second VTY range disabled with 'transport input none' (compliant)"


def s_c_vty_both_telnet(c: Ctx):
    m_vty(c, "telnet", "vty_both_ranges_telnet")
    c.cfg.insert_after("line vty 0 4", Block("line vty 5 15", ["transport input telnet", "login local"]))


def s_c_banner_single_line(c: Ctx):
    c.cfg.insert_after("ip domain-name campus.internal", Block("banner login ^CAuthorized users only^C", raw=True))


def s_c_banner_hash(c: Ctx):
    c.cfg.insert_after("ip domain-name campus.internal", Block(
        "banner motd #", ["Welcome, authorised staff & students only (see policy 4.2).", "#"], raw=True))


def s_c_banner_unterminated(c: Ctx):
    c.cfg.insert_after("ip domain-name campus.internal", Block(
        "banner motd ^C", ["Authorized access only, no closing delimiter follows"], raw=True))
    c.expect_parse_error = True
    c.notes = "an unterminated banner would swallow the rest of the config: must be a PARSE_ERROR, never a silent skip"


def s_c_snmp_view(c: Ctx): m_snmp(c, "public", "RO", "snmp_public_with_view", suffix="")
def s_c_header_lines(c: Ctx):
    c.preamble = ["Building configuration...", "", "Current configuration : 4096 bytes"]


def s_c_lab_extra_port(c: Ctx):
    blk = Block("interface FastEthernet0/9", ["switchport mode access", f"switchport access vlan {spec.GROUPS[c.group]['access_vlan']}"])
    c.cfg.insert_after("interface FastEthernet0/8", blk)
    c.finding("interface.FastEthernet0/9.port_security.enabled", "portsec_off", "extra_access_port_without_portsec")
    c.notes = "new access port added without port-security (wildcard rule must see it)"


def s_c_routed_port(c: Ctx):
    c.cfg.insert_after("interface GigabitEthernet0/1", Block("interface GigabitEthernet0/2", ["no switchport", "ip address 10.9.9.1 255.255.255.252", "no shutdown"]))


def s_c_acl_remark(c: Ctx):
    blk = c.cfg.find(f"ip access-list extended {spec.ACL_NAME}")
    blk.children.insert(0, "remark student ingress filter")
    c.notes = "a remark is documentation, not filtering behaviour (should be cosmetic)"


def s_c_nonascii_location(c: Ctx):
    c.cfg.insert_after("snmp-server community campus-ro RO", Block("snmp-server location Caf\u00e9 Block-B, Floor 2"))
    c.notes = "legitimate non-ASCII text in an unmonitored line"


def s_c_ticket_glob(c: Ctx):
    m_portsec(c, False, "portsec_removed", authorized=True, port=2)
    c.ticket("glob", "interface.*.port_security.*", -60, 240)


def s_c_two_tickets(c: Ctx):
    m_ntp_repoint(c, authorized=True)
    c.ticket("old", "ntp.server", -300, -120)
    c.ticket("cur", "ntp.server", -60, 120)
    c.notes = "an expired ticket and a valid ticket both cover the change"


def s_c_multi_hard(c: Ctx):
    m_vty(c, "telnet ssh", "vty_telnet_added")
    m_snmp(c, "private", "RW", "snmp_private_rw")
    m_portsec(c, True, "portsec_explicit_no")


def s_c_access_vlan_other(c: Ctx):
    c.cfg.find("interface FastEthernet0/1").children[1] = "switchport access vlan 50"
    c.finding("interface.FastEthernet0/1.switchport.access_vlan", "access_vlan_other", "access_vlan_to_other")


CHALLENGE_SCENARIOS: Dict[str, Any] = {
    "clean": SCENARIOS["clean"],
    "c_vty_range_telnet": (s_c_vty_range_telnet, "challenge", False),
    "c_vty_second_range_none": (s_c_vty_second_range_none, "challenge", False),
    "c_vty_both_telnet": (s_c_vty_both_telnet, "challenge", False),
    "c_banner_single_line": (s_c_banner_single_line, "challenge", False),
    "c_banner_hash_delimiter": (s_c_banner_hash, "challenge", False),
    "c_banner_unterminated": (s_c_banner_unterminated, "challenge", False),
    "c_snmp_public_view": (s_c_snmp_view, "challenge", False),
    "c_show_run_header_lines": (s_c_header_lines, "challenge", False),
    "c_lab_extra_access_port": (s_c_lab_extra_port, "challenge", False),
    "c_routed_port": (s_c_routed_port, "challenge", False),
    "c_acl_remark": (s_c_acl_remark, "challenge", True),
    "c_nonascii_location": (s_c_nonascii_location, "challenge", False),
    "c_ticket_glob_scope": (s_c_ticket_glob, "challenge", False),
    "c_two_tickets_one_expired": (s_c_two_tickets, "challenge", False),
    "c_multi_hard": (s_c_multi_hard, "challenge", False),
    "c_access_vlan_other": (s_c_access_vlan_other, "challenge", False),
}
GROUP_ONLY = {"c_lab_extra_access_port": {"Lab"}}

PROFILES = {
    # name: (scenario set, devices per group, clean devices per group, default seed)
    "standard": (SCENARIOS, spec.DEVICES_PER_GROUP, spec.CLEAN_PER_GROUP, spec.SEED),
    "challenge": (CHALLENGE_SCENARIOS, 14, 2, 7),
}


def assign_scenarios(rng: random.Random, scenarios: Dict[str, Any] = SCENARIOS, per_group: int = spec.DEVICES_PER_GROUP,
                     clean_n: int = spec.CLEAN_PER_GROUP) -> Dict[str, List[str]]:
    """Per group: ``clean_n`` clean devices, then the least-used applicable scenarios (seeded tie-break)."""
    usage = {name: 0 for name in scenarios}
    plan: Dict[str, List[str]] = {}
    for group, g in spec.GROUPS.items():
        names = ["clean"] * clean_n
        pool = [n for n, (_, _, needs_acl) in scenarios.items()
                if n != "clean" and (g["acl"] or not needs_acl) and group in GROUP_ONLY.get(n, {group})]
        while len(names) < per_group:
            rng.shuffle(pool)
            # ACL-only / single-group scenarios have fewer eligible groups, so favour them
            pick = min((n for n in pool if n not in names),
                       key=lambda n: usage[n] - (1 if scenarios[n][2] or n in GROUP_ONLY else 0))
            usage[pick] += 1
            names.append(pick)
        rng.shuffle(names)
        plan[group] = names
    return plan


HARD_FAMILIES = {"vty_telnet", "snmp_community"}  # rules with hard_compliance=True are never waivable


def event_tier(findings: List[Dict[str, Any]]) -> str:
    tier = "COMPLIANT"
    for f in findings:
        if spec.TIER_ORDER.index(f["tier"]) > spec.TIER_ORDER.index(tier):
            tier = f["tier"]
    return tier


def apply_group_tickets(devices: List[Dict[str, Any]], tickets: List[Dict[str, Any]]) -> None:
    """
    A group-scoped ticket legitimately covers *every* device in that group (all captures share one timestamp),
    so ground truth for other devices' findings under the same scope must say authorized (never for hard rules).
    """
    for t in (t for t in tickets if t["device"] is None):
        scope = t["key_path_scope"]
        for d in devices:
            if d["group"] != t["group"]:
                continue
            for f in d["findings"]:
                covered = f["key_path"] == scope or f["key_path"].startswith(scope + ".")
                if covered and not f["authorized"] and f["family"] not in HARD_FAMILIES:
                    f["authorized"], f["tier"] = True, "AUTHORIZED"
                    d["notes"] = (d["notes"] + "; " if d["notes"] else "") + f"also covered by group ticket {t['ticket_ref']}"


def _truncate(text: str, marker: str) -> str:
    cut = text.index(marker) + len(marker)
    return text[:cut]


def generate(out_dir: Path, seed: Optional[int] = None, profile: str = "standard") -> Dict[str, Any]:
    scenarios, per_group, clean_n, default_seed = PROFILES[profile]
    seed = default_seed if seed is None else seed
    rng = random.Random(seed)
    if out_dir.exists():
        shutil.rmtree(out_dir)
    for sub in ("configs", "golden"):
        (out_dir / sub).mkdir(parents=True)

    plan = assign_scenarios(rng, scenarios, per_group, clean_n)
    devices: List[Dict[str, Any]] = []
    tickets: List[Dict[str, Any]] = []

    for group in spec.GROUPS:
        for idx, scen in enumerate(plan[group]):
            fn, stratum, _ = scenarios[scen]
            base = build_base(group, idx)
            host = f"sw-{spec.GROUPS[group]['slug']}-{idx:02d}"
            golden = render(build_base(group, idx))
            ctx = Ctx(base, group, host, idx, random.Random(f"{seed}:{host}"))
            ctx.per_group = per_group
            fn(ctx)
            text = render(ctx.cfg, noise=ctx.rng if ctx.noise else None, crlf=ctx.crlf, preamble=ctx.preamble)
            if ctx.truncate_after:
                text = _truncate(text, ctx.truncate_after)

            for f in ctx.findings:
                f["tier"] = "AUTHORIZED" if f["authorized"] else spec.TIER_JUDGEMENT[f["family"]][group]
            with open(out_dir / "configs" / f"{host}.cfg", "w", newline="") as fh:
                fh.write(text)
            (out_dir / "golden" / f"{host}.cfg").write_text(golden)
            tickets += ctx.tickets
            devices.append({
                "hostname": host, "group": group, "scenario": scen, "stratum": stratum,
                "config": f"configs/{host}.cfg", "golden": f"golden/{host}.cfg",
                "expect_parse_error": ctx.expect_parse_error,
                "findings": ctx.findings, "event_tier": "COMPLIANT", "notes": ctx.notes,
            })

    apply_group_tickets(devices, tickets)
    for d in devices:
        d["event_tier"] = "PARSE_ERROR" if d["expect_parse_error"] else event_tier(d["findings"])

    # stratified 50/50 tune/test split: alternate within each scenario
    by_scen: Dict[str, List[Dict[str, Any]]] = {}
    for d in devices:
        by_scen.setdefault(d["scenario"], []).append(d)
    for scen, ds in sorted(by_scen.items()):
        flip = rng.random() < 0.5
        for i, d in enumerate(sorted(ds, key=lambda x: x["hostname"])):
            d["split"] = "tune" if (i % 2 == 0) != flip else "test"

    baselines = [{
        "name": f"{group}-Eval-Baseline", "device_group": group, "vendor": "cisco_ios",
        "criticality_weight": spec.GROUPS[group]["weight"], "rules": spec.build_rules(group),
    } for group in spec.GROUPS]

    manifest = {
        "profile": profile, "seed": seed, "capture_time": spec.CAPTURE_TIME.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "devices_per_group": per_group, "device_count": len(devices),
        "devices": devices,
    }
    (out_dir / "baselines.yaml").write_text(yaml.safe_dump(baselines, sort_keys=False, width=120))
    (out_dir / "tickets.yaml").write_text(yaml.safe_dump(tickets, sort_keys=False, width=120))
    (out_dir / "manifest.yaml").write_text(yaml.safe_dump(manifest, sort_keys=False, width=120))
    return manifest


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profile", choices=sorted(PROFILES), default="standard")
    ap.add_argument("--out", type=Path, default=None, help="default: evaluation/corpus (standard) or evaluation/corpus_challenge")
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args(argv)
    if args.out is None:
        args.out = Path(__file__).resolve().parent / ("corpus" if args.profile == "standard" else "corpus_challenge")
    manifest = generate(args.out, args.seed, args.profile)
    strata: Dict[str, int] = {}
    for d in manifest["devices"]:
        strata[d["stratum"]] = strata.get(d["stratum"], 0) + 1
    print(f"Wrote {manifest['device_count']} {args.profile} devices to {args.out} (seed {manifest['seed']}); strata: {strata}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
