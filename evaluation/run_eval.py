#!/usr/bin/env python3
"""
Run the full evaluation: real pipeline vs naive baselines vs ablations, with held-out threshold tuning.

    python evaluation/generate_corpus.py          # (re)create evaluation/corpus
    python evaluation/run_eval.py [--label NAME]  # writes evaluation/results/NAME/{metrics.json,results.md,errors.json}

Everything is in-process (in-memory SQLite); no Docker, network or Postgres required.
"""
import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as h  # noqa: E402
import spec  # noqa: E402

VARIANTS = ["full", "no_normalization", "no_tickets", "no_acl_analysis"]
VARIANT_NAMES = {
    "full": "C. Full pipeline",
    "no_normalization": "C-1. no semantic normalization",
    "no_tickets": "C-2. no ticket matching",
    "no_acl_analysis": "C-3. no ACL order analysis",
}
HP_GRID = [50, 60, 70, 80, 90, 95]
GRACE_GRID = [0, 15, 30, 60]
TARGETS = {"precision": 0.90, "recall": 0.90, "fpr": 0.05, "hp_recall": 0.95, "evidence": 1.0, "p95_ms": 250.0}


# ----------------------------------------------------------------------------- helpers

def _round(x: Any, nd: int = 4) -> Any:
    if isinstance(x, float):
        return round(x, nd)
    if isinstance(x, (list, tuple)):
        return [_round(v, nd) for v in x]
    if isinstance(x, dict):
        return {k: _round(v, nd) for k, v in x.items()}
    return x


def _fmt(x: Optional[float]) -> str:
    return "n/a" if x is None else f"{x:.3f}"


def _ci(ci: Any) -> str:
    return f"[{ci[0]:.2f}, {ci[1]:.2f}]"


def nearest(values: List[Any], best: List[Any], default: Any) -> Any:
    """Among equally good candidates choose the one closest to the shipped default."""
    return min(best, key=lambda v: abs(v - default))


def pipeline_flagged(results: Dict[str, Dict[str, Any]]):
    return lambda d: h.is_alert(results[d["hostname"]])


# ----------------------------------------------------------------------------- experiment

def run(corpus_dir: Path) -> Dict[str, Any]:
    corpus = h.load_corpus(corpus_dir)
    devices: List[Dict[str, Any]] = corpus["manifest"]["devices"]
    det = h.detection_devices(devices)

    runs = {v: h.run_pipeline(corpus, v) for v in VARIANTS}
    full = runs["full"]
    grace_runs = {g: (full if g == h.DEFAULT_GRACE_MIN else h.run_pipeline(corpus, "full", grace_min=g)) for g in GRACE_GRID}

    naive_a = {d["hostname"]: h.baseline_a_naive_diff(d) for d in devices}
    naive_b = {d["hostname"]: h.baseline_b_tree_diff(d) for d in devices}

    systems: Dict[str, Any] = {
        "A. Naive text diff (diff -u vs last-known-good)": h.device_confusion(det, lambda d: naive_a[d["hostname"]]["flagged"]),
        "B. Normalized full-tree diff (no rules/tickets)": h.device_confusion(det, lambda d: naive_b[d["hostname"]]["flagged"]),
    }
    for v in VARIANTS:
        systems[VARIANT_NAMES[v]] = h.device_confusion(det, pipeline_flagged(runs[v]))

    findings = {v: h.finding_metrics(det, runs[v]) for v in VARIANTS}

    breakdown: Dict[str, Any] = {"by_group": {}, "by_stratum": {}}
    for g in spec.GROUPS:
        sub = h.subset(det, group=g)
        breakdown["by_group"][g] = {"device": h.device_confusion(sub, pipeline_flagged(full)), "finding": h.finding_metrics(sub, full)}
    for s in sorted({d["stratum"] for d in det}):
        sub = h.subset(det, stratum=s)
        breakdown["by_stratum"][s] = {"device": h.device_confusion(sub, pipeline_flagged(full)), "finding": h.finding_metrics(sub, full)}

    # --- held-out threshold tuning (two folds: tune on one half, report on the other, then swap) --------
    halves = {"tune": [d for d in det if d["split"] == "tune"], "test": [d for d in det if d["split"] == "test"]}
    tuning: Dict[str, Any] = {"folds": []}
    for fit_name, eval_name in (("tune", "test"), ("test", "tune")):
        fit, held = halves[fit_name], halves[eval_name]
        hp_scores = {t: h.high_priority_metrics(fit, full, t)["f1"] or 0.0 for t in HP_GRID}
        best_hp = max(hp_scores.values())
        chosen_hp = nearest(HP_GRID, [t for t, sc in hp_scores.items() if abs(sc - best_hp) < 1e-9], h.DEFAULT_HP_THRESHOLD)
        grace_scores = {g: (h.finding_metrics(fit, grace_runs[g])["authorization"]["accuracy"] or 0.0) for g in GRACE_GRID}
        best_gr = max(grace_scores.values())
        chosen_grace = nearest(GRACE_GRID, [g for g, sc in grace_scores.items() if abs(sc - best_gr) < 1e-9], h.DEFAULT_GRACE_MIN)
        tuning["folds"].append({
            "fit_on": fit_name, "reported_on": eval_name, "n_fit": len(fit), "n_held": len(held),
            "hp_threshold": {"fit_f1_by_value": hp_scores, "chosen": chosen_hp, "default": h.DEFAULT_HP_THRESHOLD},
            "grace_minutes": {"fit_authorization_accuracy_by_value": grace_scores, "chosen": chosen_grace, "default": h.DEFAULT_GRACE_MIN},
            "held_out": {
                "hp_default": h.high_priority_metrics(held, full, h.DEFAULT_HP_THRESHOLD),
                "hp_tuned": h.high_priority_metrics(held, full, chosen_hp),
                "authorization_default": h.finding_metrics(held, full)["authorization"],
                "authorization_tuned": h.finding_metrics(held, grace_runs[chosen_grace])["authorization"],
            },
        })
    tuning["hp_f1_by_threshold_all_devices"] = {t: h.high_priority_metrics(det, full, t)["f1"] for t in HP_GRID}

    # --- headline metrics for the full pipeline --------------------------------------------------
    hp_all = h.high_priority_metrics(det, full, h.DEFAULT_HP_THRESHOLD)
    evidence = h.evidence_metrics(devices, full)
    latency = {"total_ms": h.latency_metrics(full, "latency_ms"), "normalize_ms": h.latency_metrics(full, "normalize_ms")}
    device_full = systems[VARIANT_NAMES["full"]]
    targets = {
        "device_precision": (device_full["precision"], TARGETS["precision"], (device_full["precision"] or 0) >= TARGETS["precision"]),
        "device_recall": (device_full["recall"], TARGETS["recall"], (device_full["recall"] or 0) >= TARGETS["recall"]),
        "device_fpr": (device_full["fpr"], TARGETS["fpr"], (device_full["fpr"] if device_full["fpr"] is not None else 1) <= TARGETS["fpr"]),
        "hp_recall": (hp_all["recall"], TARGETS["hp_recall"], (hp_all["recall"] or 0) >= TARGETS["hp_recall"]),
        "evidence_completeness": (evidence["completeness"], TARGETS["evidence"], (evidence["completeness"] or 0) >= TARGETS["evidence"]),
        "latency_p95_ms": (latency["total_ms"]["p95"], TARGETS["p95_ms"], latency["total_ms"]["p95"] <= TARGETS["p95_ms"]),
    }

    metrics = {
        "corpus": {"devices": len(devices), "detection_devices": len(det), "seed": corpus["manifest"]["seed"],
                   "scenarios": len({d["scenario"] for d in devices}),
                   "strata": {s: len(h.subset(devices, stratum=s)) for s in sorted({d["stratum"] for d in devices})},
                   "truth_positive_devices": sum(1 for d in det if h.device_truth_positive(d)),
                   "tickets": len(corpus["tickets"])},
        "systems_device_level": systems,
        "findings": {VARIANT_NAMES[v]: findings[v] for v in VARIANTS},
        "tier": h.tier_metrics(devices, full),
        "high_priority": hp_all,
        "evidence": evidence,
        "parse_errors": h.parse_error_metrics(devices, full),
        "latency": latency,
        "breakdown": breakdown,
        "tuning": tuning,
        "targets": {k: {"measured": v[0], "target": v[1], "met": v[2]} for k, v in targets.items()},
    }
    errors = collect_errors(devices, full)
    return {"metrics": _round(metrics), "errors": errors, "devices": devices, "full": full}


def collect_errors(devices: List[Dict[str, Any]], full: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for d in devices:
        res = full[d["hostname"]]
        base = {"device": d["hostname"], "group": d["group"], "scenario": d["scenario"], "stratum": d["stratum"], "notes": d["notes"]}
        if d["expect_parse_error"]:
            if res["snapshot_status"] != "PARSE_ERROR":
                out.append({**base, "kind": "MISSED_PARSE_ERROR", "detail": "corrupted config was parsed without error"})
            continue
        if res["snapshot_status"] == "PARSE_ERROR":
            out.append({**base, "kind": "FALSE_PARSE_ERROR", "detail": "valid config rejected by the parser (alert raised)",
                        "truth_tier": d["event_tier"]})
            for f in d["findings"]:
                out.append({**base, "kind": "FN", "key_path": f["key_path"], "detail": f"drift not evaluated: {f['mutation']} (config unparsed)"})
            continue
        truth = {f["key_path"]: f for f in d["findings"]}
        predicted = {x["key_path"]: x for x in res["details"]}
        for path, x in predicted.items():
            if path not in truth:
                out.append({**base, "kind": "FP", "key_path": path, "detail": f"expected={x['expected']} actual={x['actual']} ({x['change_type']})"})
        by_path = {t["key_path"]: t for t in res["trace"]}
        for path, f in truth.items():
            if path not in predicted:
                out.append({**base, "kind": "FN", "key_path": path, "detail": f"missed {f['mutation']}"})
            else:
                pred_auth = by_path.get(path, {}).get("label") == "Drift-Authorized"
                if pred_auth != f["authorized"]:
                    out.append({**base, "kind": "AUTHORIZATION_ERROR", "key_path": path,
                                "detail": f"truth authorized={f['authorized']}, system label={by_path.get(path, {}).get('label')}"})
        pred_tier = h.predicted_tier(res)
        if pred_tier != d["event_tier"]:
            out.append({**base, "kind": "TIER_MISMATCH", "detail": f"truth={d['event_tier']} system={pred_tier} (score {res['risk_score']})"})
    return out


# ----------------------------------------------------------------------------- report

def render_markdown(m: Dict[str, Any], errors: List[Dict[str, Any]], label: str) -> str:
    c = m["corpus"]
    L: List[str] = []
    L.append(f"# Evaluation results: `{label}`\n")
    L.append(f"Corpus: **{c['devices']} devices** ({c['detection_devices']} counted for detection; "
             f"{c['truth_positive_devices']} need action), {c['scenarios']} scenarios, strata {c['strata']}, "
             f"{c['tickets']} change tickets, seed {c['seed']}. Definitions: `docs/labels-and-thresholds.md`.\n")

    L.append("## 1. Systems compared (device level)\n")
    L.append("Alert on a device that needs action (≥ 1 unauthorized semantic drift). 95 % Wilson intervals in brackets.\n")
    L.append("| System | TP | FP | FN | TN | Precision | Recall | F1 | FPR |")
    L.append("|---|---:|---:|---:|---:|---|---|---|---|")
    for name, s in m["systems_device_level"].items():
        L.append(f"| {name} | {s['tp']} | {s['fp']} | {s['fn']} | {s['tn']} | {_fmt(s['precision'])} {_ci(s['precision_ci'])} | "
                 f"{_fmt(s['recall'])} {_ci(s['recall_ci'])} | {_fmt(s['f1'])} | {_fmt(s['fpr'])} {_ci(s['fpr_ci'])} |")

    L.append("\n## 2. Finding level (device × rule path)\n")
    L.append("| System | TP | FP | FN | Precision | Recall | F1 | Authorization accuracy |")
    L.append("|---|---:|---:|---:|---|---|---|---|")
    for name, s in m["findings"].items():
        a = s["authorization"]
        L.append(f"| {name} | {s['tp']} | {s['fp']} | {s['fn']} | {_fmt(s['precision'])} | {_fmt(s['recall'])} | {_fmt(s['f1'])} | "
                 f"{_fmt(a['accuracy'])} ({a['correct']}/{a['n']}) |")

    L.append("\n## 3. Targets (declared before measuring)\n")
    L.append("| Metric | Measured | Target | Met |")
    L.append("|---|---|---|---|")
    for k, v in m["targets"].items():
        L.append(f"| {k} | {_fmt(v['measured']) if isinstance(v['measured'], float) else v['measured']} | {v['target']} | {'yes' if v['met'] else '**NO**'} |")

    t = m["tier"]
    L.append(f"\n## 4. Label (tier) accuracy: {_fmt(t['accuracy'])} {_ci(t['ci'])} over {t['n']} devices\n")
    cols = ["COMPLIANT", "AUTHORIZED", "LOW", "MEDIUM", "HIGH", "CRITICAL", "PARSE_ERROR"]
    L.append("Rows = ground truth, columns = system.\n")
    L.append("| truth \\ system | " + " | ".join(cols) + " |")
    L.append("|---|" + "---:|" * len(cols))
    for truth in cols:
        row = t["matrix"].get(truth, {})
        if row:
            L.append(f"| {truth} | " + " | ".join(str(row.get(c, 0)) for c in cols) + " |")

    hp = m["high_priority"]
    ev = m["evidence"]
    L.append(f"\n## 5. High-priority outputs (score ≥ {h.DEFAULT_HP_THRESHOLD})\n")
    L.append(f"* Precision {_fmt(hp['precision'])}, recall {_fmt(hp['recall'])}, F1 {_fmt(hp['f1'])} (TP {hp['tp']}, FP {hp['fp']}, FN {hp['fn']})")
    L.append(f"* Evidence completeness: {ev['complete']}/{ev['high_priority_events']} = {_fmt(ev['completeness'])}; missing fields: {ev['missing_field_counts'] or 'none'}")

    pe = m["parse_errors"]
    L.append(f"\n## 6. Parse errors\n")
    L.append(f"* Corrupted configs caught as PARSE_ERROR: {pe['caught']}/{pe['expected']}")
    L.append(f"* **Valid** configs wrongly rejected (false alarms): {pe['false_parse_errors']}")

    lat = m["latency"]
    L.append("\n## 7. Latency per snapshot (ms, in-memory SQLite)\n")
    L.append("| Stage | mean | p50 | p95 | p99 | max |")
    L.append("|---|---:|---:|---:|---:|---:|")
    for k, name in (("normalize_ms", "normalize only"), ("total_ms", "normalize + persist + drift + score")):
        v = lat[k]
        L.append(f"| {name} | {v['mean']:.2f} | {v['p50']:.2f} | {v['p95']:.2f} | {v['p99']:.2f} | {v['max']:.2f} |")

    L.append("\n## 8. Breakdown of the full pipeline\n")
    L.append("| Slice | devices | device P | device R | FPR | finding P | finding R |")
    L.append("|---|---:|---|---|---|---|---|")
    for kind in ("by_group", "by_stratum"):
        for name, s in m["breakdown"][kind].items():
            d, f = s["device"], s["finding"]
            L.append(f"| {name} | {d['n']} | {_fmt(d['precision'])} | {_fmt(d['recall'])} | {_fmt(d['fpr'])} | {_fmt(f['precision'])} | {_fmt(f['recall'])} |")

    tu = m["tuning"]
    L.append("\n## 9. Held-out threshold tuning (2-fold)\n")
    L.append("Each fold fits the high-priority threshold and ticket grace on one half and reports on the other half "
             "(then the halves swap). Ties are resolved toward the shipped default.\n")
    L.append("| Fit on → report on | HP threshold (shipped 80) | Grace min (shipped 30) | held-out HP F1: shipped / tuned | held-out HP recall: shipped / tuned | held-out authorization: shipped / tuned |")
    L.append("|---|---|---|---|---|---|")
    for fold in tu["folds"]:
        ho = fold["held_out"]
        L.append(f"| {fold['fit_on']} → {fold['reported_on']} | **{fold['hp_threshold']['chosen']}** | **{fold['grace_minutes']['chosen']}** | "
                 f"{_fmt(ho['hp_default']['f1'])} / {_fmt(ho['hp_tuned']['f1'])} | {_fmt(ho['hp_default']['recall'])} / {_fmt(ho['hp_tuned']['recall'])} | "
                 f"{_fmt(ho['authorization_default']['accuracy'])} / {_fmt(ho['authorization_tuned']['accuracy'])} |")
    L.append(f"\nHigh-priority F1 by threshold over *all* devices: {tu['hp_f1_by_threshold_all_devices']}")

    L.append("\n## 10. Errors by kind and scenario (full pipeline)\n")
    agg: Dict[str, Dict[str, int]] = {}
    for e in errors:
        agg.setdefault(e["kind"], {}).setdefault(e["scenario"], 0)
        agg[e["kind"]][e["scenario"]] += 1
    L.append("| Kind | Total | By scenario |")
    L.append("|---|---:|---|")
    for kind, by in sorted(agg.items()):
        L.append(f"| {kind} | {sum(by.values())} | " + ", ".join(f"{s}×{n}" for s, n in sorted(by.items(), key=lambda x: -x[1])) + " |")
    L.append("\nFull list with details: `errors.json`.\n")
    return "\n".join(L)


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--corpus", type=Path, default=Path(__file__).resolve().parent / "corpus")
    ap.add_argument("--label", default="latest")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "results")
    args = ap.parse_args(argv)

    out = run(args.corpus)
    dest = args.out / args.label
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "metrics.json").write_text(json.dumps(out["metrics"], indent=2, sort_keys=False, default=str))
    (dest / "errors.json").write_text(json.dumps(out["errors"], indent=2))
    (dest / "results.md").write_text(render_markdown(out["metrics"], out["errors"], args.label))
    m = out["metrics"]
    d = m["systems_device_level"][VARIANT_NAMES["full"]]
    print(f"[{args.label}] full pipeline device-level: P={_fmt(d['precision'])} R={_fmt(d['recall'])} FPR={_fmt(d['fpr'])}; "
          f"errors={len(out['errors'])}; wrote {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
