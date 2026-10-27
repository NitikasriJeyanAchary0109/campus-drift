"""
Evaluation harness: runs the *real* drift pipeline (parser -> normalization -> rule engine -> ticket
matching -> scoring -> evidence) over the corpus, plus the naive baselines and ablations, and computes metrics.

No network, Docker or Postgres is needed: an in-memory SQLite database is built per run.
Instrumentation is done by wrapping functions of ``app.services.drift`` for the duration of a run
(it never changes product behaviour).
"""
import contextlib
import difflib
import math
import statistics
import sys
import time
from datetime import datetime, timezone
from functools import partial
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple
from unittest import mock

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import spec  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.core.database import Base  # noqa: E402
import app.models  # noqa: E402,F401  (register all tables)
from app.models.baselines import Baseline, BaselineRule  # noqa: E402
from app.models.devices import Device, DeviceGroup  # noqa: E402
from app.models.tickets import ChangeTicket  # noqa: E402
from app.models.users import Role, User  # noqa: E402
from app.models.drift import DriftEvent  # noqa: E402
from app.services import drift as drift_mod  # noqa: E402
from app.services import normalization as norm_mod  # noqa: E402
from app.services.parsers import cisco_ios as parser_mod  # noqa: E402
from app.services.collection import ingest_raw_configuration  # noqa: E402
from app.services.drift import build_evidence_bundle  # noqa: E402
from app.services.normalization import normalize_config  # noqa: E402
from app.services.parsers.cisco_ios import ParseError  # noqa: E402
from app.services.acl_analyzer import to_acl_rule_list  # noqa: E402

DEFAULT_HP_THRESHOLD = 80
DEFAULT_GRACE_MIN = 30
ALERT_LABELS_EXCLUDED = ("Compliant", "Drift-Authorized")


# ----------------------------------------------------------------------------- corpus loading

def load_corpus(corpus_dir: Path) -> Dict[str, Any]:
    corpus_dir = Path(corpus_dir)
    manifest = yaml.safe_load((corpus_dir / "manifest.yaml").read_text())
    for d in manifest["devices"]:
        with open(corpus_dir / d["config"], newline="") as fh:
            d["raw"] = fh.read()
        d["golden_text"] = (corpus_dir / d["golden"]).read_text()
    return {
        "manifest": manifest,
        "baselines": yaml.safe_load((corpus_dir / "baselines.yaml").read_text()),
        "tickets": yaml.safe_load((corpus_dir / "tickets.yaml").read_text()),
    }


# ----------------------------------------------------------------------------- pipeline variants

def _strict_equal(a: Any, b: Any) -> bool:
    def unwrap(x: Any) -> Any:
        if isinstance(x, list) and len(x) == 1:
            x = x[0]
        return x if isinstance(x, list) else str(x).strip()
    return unwrap(a) == unwrap(b)


@contextlib.contextmanager
def patched_pipeline(variant: str, grace_min: int, trace: List[Dict[str, Any]]) -> Iterator[None]:
    """Apply a pipeline variant and tracing wrappers for the duration of the context."""
    real_find = drift_mod.find_matching_ticket
    real_classify = drift_mod.classify_diff
    pending: List[str] = []

    if variant == "no_tickets":
        inner_find = lambda db, device, key_path, timestamp, **kw: None  # noqa: E731
    else:
        inner_find = partial(real_find, grace_period_minutes=grace_min)

    def traced_find(db, device, key_path, timestamp, **kw):
        pending.append(key_path)
        return inner_find(db, device, key_path, timestamp)

    def traced_classify(raw_score, hard_compliance, ticket):
        label, score = real_classify(raw_score, hard_compliance, ticket)
        trace.append({"key_path": pending.pop(0) if pending else None, "label": label, "score": score,
                      "ticket": ticket is not None})
        return label, score

    with contextlib.ExitStack() as stack:
        stack.enter_context(mock.patch.object(drift_mod, "find_matching_ticket", traced_find))
        stack.enter_context(mock.patch.object(drift_mod, "classify_diff", traced_classify))
        if variant == "no_normalization":
            stack.enter_context(mock.patch.object(drift_mod, "values_equal", _strict_equal))
            stack.enter_context(mock.patch.object(parser_mod, "canonicalize_vlan_list", lambda s: s.strip()))
            stack.enter_context(mock.patch.object(parser_mod, "canonicalize_tokens", lambda s: s.strip()))
        if variant == "no_acl_analysis":
            # Phase 1 behaviour: ACLs are compared as unordered sets of entries (no overlap/first-match analysis)
            real_equal = drift_mod.values_equal

            def set_equal(a, b):
                ra, rb = to_acl_rule_list(a), to_acl_rule_list(b)
                if ra and rb and all(x.split()[0] in ("permit", "deny", "remark") for x in ra + rb):
                    return sorted(ra) == sorted(rb)
                return real_equal(a, b)

            stack.enter_context(mock.patch.object(drift_mod, "is_acl_rule_list", lambda v: False))
            stack.enter_context(mock.patch.object(drift_mod, "values_equal", set_equal))
        yield


def _build_database(corpus: Dict[str, Any]):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Session = sessionmaker(bind=engine, autoflush=False)
    Base.metadata.create_all(bind=engine)
    db = Session()

    role = Role(name="Admin")
    db.add(role)
    db.commit()
    admin = User(username="eval", password_hash="x", role_id=role.id, is_active=True)
    db.add(admin)
    db.commit()

    groups: Dict[str, DeviceGroup] = {}
    for b in corpus["baselines"]:
        g = DeviceGroup(name=b["device_group"], criticality_weight=b["criticality_weight"])
        db.add(g)
        db.commit()
        groups[g.name] = g
        base = Baseline(name=b["name"], device_group_id=g.id, vendor=b["vendor"], version=1, is_active=True, created_by=admin.id)
        db.add(base)
        db.commit()
        for r in b["rules"]:
            db.add(BaselineRule(baseline_id=base.id, **r))
        db.commit()

    devices: Dict[str, Device] = {}
    for i, d in enumerate(corpus["manifest"]["devices"]):
        dev = Device(hostname=d["hostname"], ip_address=f"10.99.{i // 250}.{i % 250 + 1}", vendor="cisco_ios",
                     model="Catalyst 2960-X", device_group_id=groups[d["group"]].id, status="ONLINE")
        db.add(dev)
        db.commit()
        devices[d["hostname"]] = dev

    for t in corpus["tickets"]:
        db.add(ChangeTicket(
            ticket_ref=t["ticket_ref"], source="internal",
            device_id=devices[t["device"]].id if t["device"] else None,
            device_group_id=groups[t["group"]].id if t.get("group") else None,
            key_path_scope=t["key_path_scope"],
            valid_from=_parse_ts(t["valid_from"]), valid_to=_parse_ts(t["valid_to"]), status=t["status"],
        ))
    db.commit()
    return db, devices


def _parse_ts(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")


REQUIRED_DETAIL_FIELDS = ("key_path", "expected_value", "rule_id", "why_it_matters", "change_type")
CITATION_FIELDS = ("source_line", "source_line_number")


def evidence_gaps(bundle) -> List[str]:
    """Return a list of missing evidence fields for a bundle (empty list = complete)."""
    gaps: List[str] = []
    for name in ("device_hostname", "risk_score", "label"):
        if getattr(bundle, name, None) in (None, ""):
            gaps.append(name)
    if not getattr(bundle, "details", None):
        gaps.append("details")
    for d in getattr(bundle, "details", []) or []:
        for f in REQUIRED_DETAIL_FIELDS:
            if getattr(d, f, None) in (None, ""):
                gaps.append(f"{d.key_path}:{f}")
        if d.change_type != "REMOVED" and getattr(d, "actual_value", None) is None:
            gaps.append(f"{d.key_path}:actual_value")
        for f in CITATION_FIELDS:
            if getattr(d, f, None) in (None, ""):
                gaps.append(f"{d.key_path}:{f}")
    return gaps


def run_pipeline(corpus: Dict[str, Any], variant: str = "full", grace_min: int = DEFAULT_GRACE_MIN) -> Dict[str, Dict[str, Any]]:
    """Ingest every corpus device through the real pipeline; return per-device observed results."""
    db, devices = _build_database(corpus)
    capture = datetime.strptime(corpus["manifest"]["capture_time"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    results: Dict[str, Dict[str, Any]] = {}
    for d in corpus["manifest"]["devices"]:
        trace: List[Dict[str, Any]] = []
        norm_ms = _time_normalize(d["raw"], variant)
        with patched_pipeline(variant, grace_min, trace):
            t0 = time.perf_counter()
            snap = ingest_raw_configuration(
                db=db, device=devices[d["hostname"]], raw_config=d["raw"],
                collection_method="CORPUS", collected_at=capture,
            )
            total_ms = (time.perf_counter() - t0) * 1000.0
        event = (
            db.query(DriftEvent).filter(DriftEvent.device_id == devices[d["hostname"]].id)
            .order_by(DriftEvent.detected_at.desc()).first()
        ) if snap.status == "SUCCESS" else None
        res: Dict[str, Any] = {
            "snapshot_status": snap.status, "latency_ms": total_ms, "normalize_ms": norm_ms,
            "label": event.label if event else None, "risk_score": event.risk_score if event else None,
            "details": [{"key_path": x.key_path, "change_type": x.change_type, "expected": x.expected_value,
                         "actual": x.actual_value} for x in (event.details if event else [])],
            "trace": trace, "evidence_gaps": None,
        }
        if event is not None and event.risk_score >= DEFAULT_HP_THRESHOLD:
            res["evidence_gaps"] = evidence_gaps(build_evidence_bundle(db, event))
        results[d["hostname"]] = res
    db.close()
    return results


def _time_normalize(raw: str, variant: str, repeats: int = 3) -> float:
    best = float("inf")
    for _ in range(repeats):
        t0 = time.perf_counter()
        try:
            normalize_config(raw, "cisco_ios")
        except ParseError:
            pass
        best = min(best, (time.perf_counter() - t0) * 1000.0)
    return best


# ----------------------------------------------------------------------------- naive baselines

def baseline_a_naive_diff(d: Dict[str, Any]) -> Dict[str, Any]:
    """System A: `diff -u` of the captured config against the device's last-known-good config."""
    diff = list(difflib.unified_diff(d["golden_text"].splitlines(), d["raw"].splitlines(), lineterm="", n=0))
    changed = [ln for ln in diff if (ln.startswith("+") or ln.startswith("-")) and not ln.startswith(("+++", "---"))]
    return {"flagged": bool(changed), "changed_lines": len(changed)}


def baseline_b_tree_diff(d: Dict[str, Any]) -> Dict[str, Any]:
    """System B: parse both configs and compare the complete normalized trees (no rules, tickets or scoring)."""
    try:
        a = normalize_config(d["golden_text"], "cisco_ios")
        b = normalize_config(d["raw"], "cisco_ios")
    except ParseError:
        return {"flagged": True, "parse_error": True}
    return {"flagged": a != b, "parse_error": False}


# ----------------------------------------------------------------------------- metrics

def wilson(successes: int, n: int, z: float = 1.96) -> Tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = successes / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def prf(tp: int, fp: int, fn: int) -> Dict[str, Any]:
    p = tp / (tp + fp) if tp + fp else None
    r = tp / (tp + fn) if tp + fn else None
    f1 = 2 * p * r / (p + r) if p and r else (0.0 if p is not None and r is not None else None)
    return {"tp": tp, "fp": fp, "fn": fn, "precision": p, "recall": r, "f1": f1,
            "precision_ci": wilson(tp, tp + fp), "recall_ci": wilson(tp, tp + fn)}


def is_alert(res: Dict[str, Any]) -> bool:
    if res["snapshot_status"] == "PARSE_ERROR":
        return True
    return res["label"] not in ALERT_LABELS_EXCLUDED and res["label"] is not None


def device_truth_positive(d: Dict[str, Any]) -> bool:
    return any(not f["authorized"] for f in d["findings"])


def device_confusion(devices: List[Dict[str, Any]], flagged: Callable[[Dict[str, Any]], bool]) -> Dict[str, Any]:
    tp = fp = fn = tn = 0
    for d in devices:
        truth, pred = device_truth_positive(d), flagged(d)
        if truth and pred: tp += 1
        elif truth and not pred: fn += 1
        elif not truth and pred: fp += 1
        else: tn += 1
    out = prf(tp, fp, fn)
    out.update({"tn": tn, "fpr": fp / (fp + tn) if fp + tn else None, "fpr_ci": wilson(fp, fp + tn),
                "accuracy": (tp + tn) / max(1, tp + fp + fn + tn), "n": tp + fp + fn + tn})
    return out


def finding_metrics(devices: List[Dict[str, Any]], results: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    tp = fp = fn = 0
    auth_ok = auth_n = 0
    for d in devices:
        res = results[d["hostname"]]
        truth = {f["key_path"]: f for f in d["findings"]}
        predicted = {x["key_path"] for x in res["details"]}
        t_paths = set(truth)
        tp += len(predicted & t_paths)
        fp += len(predicted - t_paths)
        fn += len(t_paths - predicted)
        by_path = {t["key_path"]: t for t in res["trace"]}
        for path in predicted & t_paths:
            auth_n += 1
            pred_auth = by_path.get(path, {}).get("label") == "Drift-Authorized"
            auth_ok += int(pred_auth == truth[path]["authorized"])
    out = prf(tp, fp, fn)
    out["authorization"] = {"correct": auth_ok, "n": auth_n, "accuracy": auth_ok / auth_n if auth_n else None,
                            "ci": wilson(auth_ok, auth_n)}
    return out


def predicted_tier(res: Dict[str, Any]) -> str:
    if res["snapshot_status"] == "PARSE_ERROR":
        return "PARSE_ERROR"
    return spec.LABEL_TO_TIER.get(res["label"], "COMPLIANT") if res["label"] else "COMPLIANT"


def tier_metrics(devices: List[Dict[str, Any]], results: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    matrix: Dict[str, Dict[str, int]] = {}
    correct = 0
    for d in devices:
        truth, pred = d["event_tier"], predicted_tier(results[d["hostname"]])
        matrix.setdefault(truth, {}).setdefault(pred, 0)
        matrix[truth][pred] += 1
        correct += int(truth == pred)
    return {"accuracy": correct / len(devices) if devices else None, "n": len(devices),
            "ci": wilson(correct, len(devices)), "matrix": matrix}


def high_priority_metrics(devices: List[Dict[str, Any]], results: Dict[str, Dict[str, Any]], threshold: int) -> Dict[str, Any]:
    tp = fp = fn = 0
    for d in devices:
        if d["expect_parse_error"]:
            continue
        res = results[d["hostname"]]
        pred = (res["risk_score"] or 0) >= threshold and res["snapshot_status"] == "SUCCESS"
        truth = d["event_tier"] in ("CRITICAL", "HIGH")
        if pred and truth: tp += 1
        elif pred: fp += 1
        elif truth: fn += 1
    return prf(tp, fp, fn)


def evidence_metrics(devices: List[Dict[str, Any]], results: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    events = [(d["hostname"], results[d["hostname"]]["evidence_gaps"]) for d in devices
              if results[d["hostname"]]["evidence_gaps"] is not None]
    complete = sum(1 for _, g in events if not g)
    missing: Dict[str, int] = {}
    for _, gaps in events:
        for g in gaps:
            field = g.split(":")[-1]
            missing[field] = missing.get(field, 0) + 1
    return {"high_priority_events": len(events), "complete": complete,
            "completeness": complete / len(events) if events else None, "missing_field_counts": missing}


def percentile(values: List[float], q: float) -> float:
    if not values:
        return float("nan")
    s = sorted(values)
    k = (len(s) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def latency_metrics(results: Dict[str, Dict[str, Any]], key: str) -> Dict[str, float]:
    vals = [r[key] for r in results.values()]
    return {"mean": statistics.mean(vals), "p50": percentile(vals, 0.5), "p95": percentile(vals, 0.95),
            "p99": percentile(vals, 0.99), "max": max(vals)}


def subset(devices: List[Dict[str, Any]], **where: Any) -> List[Dict[str, Any]]:
    return [d for d in devices if all(d[k] == v for k, v in where.items())]


def detection_devices(devices: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Devices that count toward detection metrics (expected-parse-error devices are reported separately)."""
    return [d for d in devices if not d["expect_parse_error"]]


def parse_error_metrics(devices: List[Dict[str, Any]], results: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    expected = [d for d in devices if d["expect_parse_error"]]
    caught = sum(1 for d in expected if results[d["hostname"]]["snapshot_status"] == "PARSE_ERROR")
    false_alarms = [d["hostname"] for d in devices
                    if not d["expect_parse_error"] and results[d["hostname"]]["snapshot_status"] == "PARSE_ERROR"]
    return {"expected": len(expected), "caught": caught, "detection_rate": caught / len(expected) if expected else None,
            "false_parse_errors": len(false_alarms), "false_parse_error_devices": false_alarms}
