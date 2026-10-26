"""
Baseline Proposal (Rule Mining) Service
---------------------------------------
Bootstraps a first approved baseline from an existing fleet of legacy configurations: for every
configuration key that most devices in a group agree on, propose an EXACT rule. Devices that
disagree are reported as ``outliers`` - they are candidate pre-existing drift.

The result is only a *proposal*. It is emitted as inactive YAML compatible with ``POST /api/baselines``
and must be reviewed and activated by an Admin; the miner never activates anything. Review matters
because if the majority of a fleet already drifted, the consensus value is the drift.
"""
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

import yaml

from app.services.normalization import normalize_config

# Top-level sections that identify a device or are not meaningful as consensus policy.
_SKIP_TOP_LEVEL = {"hostname", "version", "ip", "vlan", "access_list", "access_list_ordered", "router"}
# Leaf names that are expected to differ per device or per port.
_SKIP_LEAVES = {"ip_address", "access_vlan", "trunk_allowed_vlans", "description", "name"}

# (path predicate, severity_weight, hard_compliance, rationale) - first match wins.
_SECURITY_HINTS: List[Tuple[str, int, bool, str]] = [
    ("line.vty.transport_input", 90, True, "Management transport must be consistent across the group"),
    ("snmp.", 85, True, "SNMP configuration is consistent across the group"),
    (".port_security.", 70, False, "Edge port-security setting is consistent across the group"),
    ("ntp.", 30, False, "Time source is consistent across the group"),
]
_DEFAULT_WEIGHT = 40


def flatten_tree(tree: Dict[str, Any]) -> Dict[str, str]:
    """Flatten a normalized config tree to ``{dotted.key.path: string value}`` for scalar leaves."""
    flat: Dict[str, str] = {}

    def walk(node: Any, path: List[str]) -> None:
        if isinstance(node, dict):
            for key, child in node.items():
                if not path and key in _SKIP_TOP_LEVEL:
                    continue
                walk(child, path + [str(key)])
            return
        if node is None or not path or path[-1] in _SKIP_LEAVES:
            return
        if isinstance(node, bool):
            value = "true" if node else "false"
        elif isinstance(node, list):
            value = ", ".join(sorted(str(x) for x in node))
        else:
            value = str(node)
        if value != "":
            flat[".".join(path)] = value

    walk(tree, [])
    return flat


def _severity_for(key_path: str) -> Tuple[int, bool, str]:
    for needle, weight, hard, why in _SECURITY_HINTS:
        if needle in key_path:
            return weight, hard, why
    return _DEFAULT_WEIGHT, False, "Consistent across the group in the legacy fleet"


def propose_baseline(
    trees_by_hostname: Dict[str, Dict[str, Any]],
    min_support: float = 0.8,
    min_devices: int = 2,
) -> Dict[str, Any]:
    """
    Mine consensus rules from ``{hostname: normalized_tree}``.

    A rule is proposed for a key path when at least ``min_support`` of *all* devices carry the
    same value for it. Requiring presence on all devices (not only those that have the key)
    prevents one-off lines on a single device from becoming policy.
    """
    if not 0.5 < min_support <= 1.0:
        raise ValueError("min_support must be in (0.5, 1.0]")
    total = len(trees_by_hostname)
    if total < min_devices:
        raise ValueError(f"Need at least {min_devices} devices to mine a baseline, got {total}")

    flat = {host: flatten_tree(tree) for host, tree in trees_by_hostname.items()}
    all_paths = sorted({p for f in flat.values() for p in f})

    rules: List[Dict[str, Any]] = []
    for path in all_paths:
        values = {host: f[path] for host, f in flat.items() if path in f}
        value, count = Counter(values.values()).most_common(1)[0]
        support = count / total
        if support < min_support:
            continue
        weight, hard, why = _severity_for(path)
        outliers = sorted(h for h in flat if flat[h].get(path) != value)
        rules.append(
            {
                "key_path": path,
                "expected_value": value,
                "rule_type": "EXACT",
                "severity_weight": weight,
                "hard_compliance": hard,
                "description": why,
                "support": round(support, 3),
                "outliers": outliers,
            }
        )
    return {"device_count": total, "min_support": min_support, "rules": rules}


def propose_baseline_from_configs(
    configs_by_hostname: Dict[str, str],
    vendor: str = "cisco_ios",
    min_support: float = 0.8,
) -> Dict[str, Any]:
    """Convenience wrapper that normalizes raw configs first."""
    trees = {host: normalize_config(raw, vendor) for host, raw in configs_by_hostname.items()}
    return propose_baseline(trees, min_support=min_support)


def proposal_to_yaml(proposal: Dict[str, Any], group_name: str, vendor: str, name: Optional[str] = None) -> str:
    """Render a proposal as baseline YAML. Review comments carry support and outliers."""
    header = [
        "# PROPOSED baseline mined from legacy configurations - REVIEW BEFORE ACTIVATING.",
        f"# Devices analysed: {proposal['device_count']}; min support: {proposal['min_support']}",
        "# Each rule lists the devices that DISAGREE with the consensus (candidate existing drift).",
    ]
    doc = {
        "name": name or f"{group_name}-Mined-Baseline",
        "device_group": group_name,
        "vendor": vendor,
        "rules": [
            {
                "key_path": r["key_path"],
                "expected_value": r["expected_value"],
                "rule_type": r["rule_type"],
                "severity_weight": r["severity_weight"],
                "hard_compliance": r["hard_compliance"],
                "description": f"{r['description']} (support {r['support']:.0%}"
                + (f"; outliers: {', '.join(r['outliers'])}" if r["outliers"] else "")
                + ")",
            }
            for r in proposal["rules"]
        ],
    }
    return "\n".join(header) + "\n" + yaml.safe_dump(doc, sort_keys=False)
