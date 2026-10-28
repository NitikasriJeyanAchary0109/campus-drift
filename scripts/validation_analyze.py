#!/usr/bin/env python3
"""
Analyse stakeholder-validation data and write docs/validation/results.md.

    python scripts/validation_analyze.py                 # reads docs/validation/data/*.csv
    python scripts/validation_analyze.py --make-templates  # writes blank CSV templates to docs/validation/templates/

Inputs (CSV, one row per record; participants are anonymous ids such as P1):
    sessions.csv   participant_id, role, years_experience, task_id, outcome, time_sec, hints, errors, notes
                   outcome: success | partial | fail
    sus.csv        participant_id, q1 ... q10   (1-5 Likert; odd items positive, even items negative)
    ratings.csv    participant_id, family, zone, tier   (tier: CRITICAL|HIGH|MEDIUM|LOW)
    issues.csv     issue_id, participant_id, task_id, severity, description, status   (severity 0-4, Nielsen scale)

No data is invented: with no files the report says so and shows empty tables.
"""
import argparse
import csv
import math
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "evaluation"))
import spec  # noqa: E402

DATA_DIR = ROOT / "docs" / "validation" / "data"
TEMPLATE_DIR = ROOT / "docs" / "validation" / "templates"
TASKS = {
    "T1": "Find the riskiest open drift",
    "T2": "Identify the offending config line from the evidence",
    "T3": "Record a known exception (mark false positive)",
    "T4": "Review and approve the pending plan, then apply it",
    "T5": "Roll the device back and confirm it is restored",
}
TIERS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
FAMILY_TEXT = {
    "vty_telnet": "Telnet enabled on VTY lines",
    "snmp_community": "Default 'public'/'private' SNMP community present",
    "portsec_off": "Port security off on an edge port",
    "trunk_leak": "Trunk allows an extra VLAN",
    "access_vlan_mgmt": "Edge port moved onto the management VLAN",
    "access_vlan_other": "Edge port moved to another (non-management) VLAN",
    "acl_order": "ACL entry order inverted (overlapping permit/deny)",
    "acl_removed": "ACL entry removed",
    "ntp": "NTP server re-pointed, removed or extra server added",
}


def read_csv(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as fh:
        return [r for r in csv.DictReader(fh) if any((v or "").strip() for v in r.values())]


def wilson(k: int, n: int, z: float = 1.96) -> Tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def sus_score(answers: List[int]) -> float:
    """Brooke's System Usability Scale: odd items (score-1), even items (5-score), sum x 2.5 -> 0..100."""
    if len(answers) != 10 or any(a < 1 or a > 5 for a in answers):
        raise ValueError("SUS needs ten answers between 1 and 5")
    total = sum((a - 1) if i % 2 == 0 else (5 - a) for i, a in enumerate(answers))
    return total * 2.5


def sus_adjective(score: float) -> str:
    """Bangor, Kortum & Miller (2009) adjective scale, coarse bands."""
    if score >= 85.5: return "excellent"
    if score >= 72.75: return "good"
    if score >= 52.0: return "OK"
    return "poor"


def fleiss_kappa(items: List[List[str]], categories: List[str]) -> Optional[float]:
    """Fleiss' kappa; every item must have the same number (>= 2) of ratings. None if undefined."""
    if not items:
        return None
    n = len(items[0])
    if n < 2 or any(len(i) != n for i in items):
        return None
    N = len(items)
    counts = [[Counter(i)[c] for c in categories] for i in items]
    p_j = [sum(row[j] for row in counts) / (N * n) for j in range(len(categories))]
    P_i = [(sum(c * c for c in row) - n) / (n * (n - 1)) for row in counts]
    P_bar, P_e = sum(P_i) / N, sum(p * p for p in p_j)
    if P_e == 1:
        return 1.0
    return (P_bar - P_e) / (1 - P_e)


def analyse_tasks(rows: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    out = []
    for tid in TASKS:
        rs = [r for r in rows if r["task_id"] == tid]
        n = len(rs)
        ok = sum(1 for r in rs if r["outcome"].strip().lower() == "success")
        partial = sum(1 for r in rs if r["outcome"].strip().lower() == "partial")
        times = [float(r["time_sec"]) for r in rs if (r.get("time_sec") or "").strip()]
        hints = [int(r["hints"]) for r in rs if (r.get("hints") or "").strip()]
        q = statistics.quantiles(times, n=4) if len(times) >= 2 else None
        out.append({"task": tid, "n": n, "success": ok, "partial": partial, "rate": ok / n if n else None, "ci": wilson(ok, n),
                    "median_s": statistics.median(times) if times else None, "q1_q3": (q[0], q[2]) if q else None,
                    "mean_hints": statistics.mean(hints) if hints else None})
    return out


def analyse_ratings(rows: List[Dict[str, str]]) -> Dict[str, Any]:
    by_item: Dict[Tuple[str, str], List[str]] = defaultdict(list)
    raters = sorted({r["participant_id"] for r in rows})
    for r in rows:
        by_item[(r["family"], r["zone"])].append(r["tier"].strip().upper())
    items, table_matches, disagreements = [], 0, []
    complete = {k: v for k, v in by_item.items() if len(v) == len(raters)}
    for (family, zone), ratings in sorted(by_item.items()):
        majority, votes = Counter(ratings).most_common(1)[0]
        truth = spec.TIER_JUDGEMENT[family][zone]
        match = majority == truth and votes > len(ratings) / 2
        table_matches += int(match)
        if not match:
            disagreements.append({"family": family, "zone": zone, "table": truth, "ratings": dict(Counter(ratings))})
    per_rater = {}
    for p in raters:
        mine = [r for r in rows if r["participant_id"] == p]
        agree = sum(1 for r in mine if r["tier"].strip().upper() == spec.TIER_JUDGEMENT[r["family"]][r["zone"]])
        per_rater[p] = (agree, len(mine))
    kappa = fleiss_kappa([v for v in complete.values()], TIERS) if len(raters) >= 2 else None
    return {"raters": len(raters), "items": len(by_item), "table_matches": table_matches, "disagreements": disagreements,
            "per_rater": per_rater, "fleiss_kappa": kappa}


def render(sessions, sus, ratings, issues) -> str:
    L = ["# Stakeholder validation results\n"]
    participants = sorted({r["participant_id"] for r in sessions} | {r["participant_id"] for r in sus} | {r["participant_id"] for r in ratings})
    if not participants:
        L += ["**No validation sessions have been run yet.** This file is generated by `scripts/validation_analyze.py` from the CSV files in "
              "`docs/validation/data/` and contains no invented data. Run the sessions in `docs/validation/protocol.md`, enter the results in the "
              "templates, and re-run the script.\n"]
    else:
        roles = Counter(r["role"] for r in sessions if r.get("role"))
        L += [f"Participants: **{len(participants)}** ({', '.join(f'{k}: {v}' for k, v in sorted(roles.items())) or 'roles not recorded'}). "
              "Small-sample results: intervals are wide; read them as formative evidence, not statistics.\n"]

    L += ["## 1. Task performance\n", "| Task | n | Success | Partial | Success rate (95% CI) | Median time (s) | IQR (s) | Mean hints |", "|---|---:|---:|---:|---|---:|---|---:|"]
    for t in analyse_tasks(sessions):
        rate = "n/a" if t["rate"] is None else f"{t['rate']:.0%} [{t['ci'][0]:.0%}, {t['ci'][1]:.0%}]"
        med = "n/a" if t["median_s"] is None else f"{t['median_s']:.0f}"
        iqr = "n/a" if not t["q1_q3"] else f"{t['q1_q3'][0]:.0f}-{t['q1_q3'][1]:.0f}"
        hints = "n/a" if t["mean_hints"] is None else f"{t['mean_hints']:.1f}"
        L.append(f"| {t['task']} {TASKS[t['task']]} | {t['n']} | {t['success']} | {t['partial']} | {rate} | {med} | {iqr} | {hints} |")

    L += ["\n## 2. System Usability Scale\n"]
    scores = {}
    for r in sus:
        try:
            scores[r["participant_id"]] = sus_score([int(r[f"q{i}"]) for i in range(1, 11)])
        except (ValueError, KeyError) as e:
            L.append(f"* skipped {r.get('participant_id')}: {e}")
    if scores:
        mean = statistics.mean(scores.values())
        L += ["| Participant | SUS |", "|---|---:|", *[f"| {p} | {s:.1f} |" for p, s in sorted(scores.items())],
              f"\nMean **{mean:.1f}** ({sus_adjective(mean)}; the commonly cited industry average is 68). n = {len(scores)}.\n"]
    else:
        L += ["No SUS responses yet.\n"]

    L += ["## 3. Validation of the expert tier-judgement table\n"]
    if ratings:
        a = analyse_ratings(ratings)
        kappa_txt = "n/a (needs at least 2 raters with complete ratings)" if a["fleiss_kappa"] is None else f"{a['fleiss_kappa']:.2f}"
        L += [f"{a['raters']} rater(s) rated {a['items']} (change, zone) items. The corpus author's table (`evaluation/spec.py`) matches the raters' "
              f"majority on **{a['table_matches']}/{a['items']}** items.",
              f"Fleiss' kappa among raters: **{kappa_txt}**.\n",
              "| Rater | Agrees with table |", "|---|---|", *[f"| {p} | {k}/{n} ({k / n:.0%}) |" for p, (k, n) in a["per_rater"].items()]]
        if a["disagreements"]:
            L += ["\nItems where the raters' majority differs from the table (candidates for changing the table or the rule weights):\n",
                  "| Change | Zone | Table | Raters |", "|---|---|---|---|",
                  *[f"| {FAMILY_TEXT[d['family']]} | {d['zone']} | {d['table']} | {d['ratings']} |" for d in a["disagreements"]]]
    else:
        L += ["No ratings yet.\n"]

    L += ["\n## 4. Usability issues\n"]
    if issues:
        L += ["| ID | Participant | Task | Severity (0-4) | Issue | Status |", "|---|---|---|---:|---|---|",
              *[f"| {i['issue_id']} | {i['participant_id']} | {i['task_id']} | {i['severity']} | {i['description']} | {i['status']} |"
                for i in sorted(issues, key=lambda x: -int(x.get('severity') or 0))]]
        sev = Counter(int(i.get("severity") or 0) for i in issues)
        L.append(f"\nBy severity: {dict(sorted(sev.items(), reverse=True))}")
    else:
        L += ["No issues logged yet.\n"]
    return "\n".join(L) + "\n"


def make_templates() -> None:
    TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
    def w(name: str, header: List[str], rows: List[List[str]] = ()):
        with open(TEMPLATE_DIR / name, "w", newline="", encoding="utf-8") as fh:
            cw = csv.writer(fh)
            cw.writerow(header)
            cw.writerows(rows)
    w("sessions.csv", ["participant_id", "role", "years_experience", "task_id", "outcome", "time_sec", "hints", "errors", "notes"],
      [["P1", "", "", t, "", "", "", "", ""] for t in TASKS])
    w("sus.csv", ["participant_id"] + [f"q{i}" for i in range(1, 11)], [["P1"] + [""] * 10])
    w("issues.csv", ["issue_id", "participant_id", "task_id", "severity", "description", "status"], [["I1", "P1", "T1", "", "", "open"]])
    w("ratings.csv", ["participant_id", "family", "zone", "tier"],
      [["P1", fam, zone, ""] for fam in spec.TIER_JUDGEMENT for zone in spec.GROUPS])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=DATA_DIR)
    ap.add_argument("--out", type=Path, default=ROOT / "docs" / "validation" / "results.md")
    ap.add_argument("--make-templates", action="store_true")
    args = ap.parse_args()
    if args.make_templates:
        make_templates()
        print(f"templates written to {TEMPLATE_DIR}")
        return 0
    text = render(read_csv(args.data / "sessions.csv"), read_csv(args.data / "sus.csv"), read_csv(args.data / "ratings.csv"), read_csv(args.data / "issues.csv"))
    args.out.write_text(text)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
