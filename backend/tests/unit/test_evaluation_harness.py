"""
Tests for the evaluation corpus generator, metric helpers and pipeline regression gates (WP1).

The gate tests run the *real* drift pipeline over the committed corpora (in-memory SQLite, ~1 s each) and
fail if detection quality, evidence completeness or latency regress below the targets in
docs/labels-and-thresholds.md.
"""
import filecmp
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "evaluation"))

import generate_corpus as gen  # noqa: E402
import harness as h  # noqa: E402
import spec  # noqa: E402


@pytest.fixture(scope="module")
def standard(tmp_path_factory):
    out = tmp_path_factory.mktemp("corpus")
    gen.generate(out)
    return out


@pytest.fixture(scope="module")
def standard_corpus(standard):
    return h.load_corpus(standard)


# ---------------------------------------------------------------- generator

def test_generation_is_deterministic_and_matches_committed_corpus(standard, tmp_path):
    gen.generate(tmp_path / "again")
    cmp = filecmp.dircmp(standard, tmp_path / "again")
    assert not cmp.diff_files and not cmp.left_only and not cmp.right_only
    assert not filecmp.dircmp(standard / "configs", tmp_path / "again" / "configs").diff_files
    # the committed corpus must be what the generator produces (guards against hand edits / stale files)
    committed = ROOT / "evaluation" / "corpus"
    assert (committed / "manifest.yaml").read_text() == (standard / "manifest.yaml").read_text()
    assert not filecmp.dircmp(committed / "configs", standard / "configs").diff_files


def test_different_seed_changes_the_corpus(standard, tmp_path):
    gen.generate(tmp_path / "other", seed=1)
    assert (tmp_path / "other" / "manifest.yaml").read_text() != (standard / "manifest.yaml").read_text()


def test_corpus_shape_and_ground_truth_invariants(standard_corpus):
    devs = standard_corpus["manifest"]["devices"]
    assert len(devs) == 100 >= 60
    assert {d["group"] for d in devs} == set(spec.GROUPS)
    assert all(sum(1 for d in devs if d["group"] == g) == spec.DEVICES_PER_GROUP for g in spec.GROUPS)
    assert len({d["scenario"] for d in devs}) >= 35
    assert {d["stratum"] for d in devs} == {"core", "realism", "adversarial"}
    tune, test = (sum(d["split"] == s for d in devs) for s in ("tune", "test"))
    assert tune + test == 100 and abs(tune - test) <= 4  # stratified by scenario, so only approximately 50/50
    assert len(standard_corpus["tickets"]) >= 20
    for d in devs:
        if d["expect_parse_error"]:
            assert d["event_tier"] == "PARSE_ERROR" and not d["findings"]
        else:
            assert d["event_tier"] == gen.event_tier(d["findings"])
        for f in d["findings"]:
            if f["family"] in gen.HARD_FAMILIES:
                assert not f["authorized"], "hard-compliance rules are never waivable by a ticket"
            assert f["tier"] == ("AUTHORIZED" if f["authorized"] else spec.TIER_JUDGEMENT[f["family"]][d["group"]])


def test_every_rule_set_is_loadable_and_group_weights_match_seed():
    for group, g in spec.GROUPS.items():
        rules = spec.build_rules(group)
        assert any(r["hard_compliance"] for r in rules)
        assert all(1 <= r["severity_weight"] <= 100 for r in rules)
    assert spec.GROUPS["Lab"]["weight"] == 1.2 and spec.GROUPS["PublicEvent"]["weight"] == 0.5


def test_group_ticket_authorizes_other_devices_in_group_in_ground_truth(standard_corpus):
    group_tickets = [t for t in standard_corpus["tickets"] if t["device"] is None]
    assert group_tickets
    notes = [d["notes"] for d in standard_corpus["manifest"]["devices"] if "also covered by group ticket" in d["notes"]]
    assert notes


# ---------------------------------------------------------------- metric helpers

def test_prf_and_wilson():
    m = h.prf(8, 2, 2)
    assert m["precision"] == pytest.approx(0.8) and m["recall"] == pytest.approx(0.8) and m["f1"] == pytest.approx(0.8)
    lo, hi = h.wilson(8, 10)
    assert 0.4 < lo < 0.8 < hi < 0.97
    assert h.wilson(0, 0) == (0.0, 0.0)
    assert h.prf(0, 0, 0)["precision"] is None


def test_device_confusion_counts():
    devs = [
        {"findings": [{"authorized": False}]}, {"findings": [{"authorized": False}]},
        {"findings": []}, {"findings": [{"authorized": True}]},
    ]
    flags = [True, False, True, False]
    it = iter(flags)
    out = h.device_confusion(devs, lambda d: next(it))
    assert (out["tp"], out["fn"], out["fp"], out["tn"]) == (1, 1, 1, 1)
    assert out["fpr"] == pytest.approx(0.5)


def test_percentile_interpolates():
    assert h.percentile([1, 2, 3, 4], 0.5) == pytest.approx(2.5)
    assert h.percentile([5], 0.95) == 5


# ---------------------------------------------------------------- pipeline regression gates

@pytest.fixture(scope="module")
def full_results(standard_corpus):
    return h.run_pipeline(standard_corpus, "full")


def test_gate_standard_corpus_device_level(standard_corpus, full_results):
    det = h.detection_devices(standard_corpus["manifest"]["devices"])
    m = h.device_confusion(det, lambda d: h.is_alert(full_results[d["hostname"]]))
    assert m["precision"] >= 0.90 and m["recall"] >= 0.90 and m["fpr"] <= 0.05, m
    assert h.parse_error_metrics(standard_corpus["manifest"]["devices"], full_results)["false_parse_errors"] == 0


def test_gate_authorization_and_evidence(standard_corpus, full_results):
    devs = standard_corpus["manifest"]["devices"]
    det = h.detection_devices(devs)
    assert h.finding_metrics(det, full_results)["authorization"]["accuracy"] == 1.0
    ev = h.evidence_metrics(devs, full_results)
    assert ev["high_priority_events"] > 0 and ev["completeness"] == 1.0, ev["missing_field_counts"]


def test_gate_latency_and_corrupt_configs(standard_corpus, full_results):
    assert h.latency_metrics(full_results, "latency_ms")["p95"] < 250
    pe = h.parse_error_metrics(standard_corpus["manifest"]["devices"], full_results)
    assert pe["detection_rate"] == 1.0


def test_corpus_discriminates_baselines_from_pipeline(standard_corpus, full_results):
    det = h.detection_devices(standard_corpus["manifest"]["devices"])
    naive = h.device_confusion(det, lambda d: h.baseline_a_naive_diff(d)["flagged"])
    tree = h.device_confusion(det, lambda d: h.baseline_b_tree_diff(d)["flagged"])
    full = h.device_confusion(det, lambda d: h.is_alert(full_results[d["hostname"]]))
    assert naive["fpr"] > 0.5 and tree["fpr"] > 0.2 and full["fpr"] <= 0.05


def test_ablations_hurt_where_expected(standard_corpus, full_results):
    det = h.detection_devices(standard_corpus["manifest"]["devices"])
    no_tickets = h.run_pipeline(standard_corpus, "no_tickets")
    assert h.finding_metrics(det, no_tickets)["authorization"]["accuracy"] < h.finding_metrics(det, full_results)["authorization"]["accuracy"]
    no_acl = h.run_pipeline(standard_corpus, "no_acl_analysis")
    assert h.finding_metrics(det, no_acl)["recall"] < h.finding_metrics(det, full_results)["recall"]


def test_gate_challenge_corpus(tmp_path):
    gen.generate(tmp_path, profile="challenge")
    corpus = h.load_corpus(tmp_path)
    res = h.run_pipeline(corpus, "full")
    det = h.detection_devices(corpus["manifest"]["devices"])
    m = h.device_confusion(det, lambda d: h.is_alert(res[d["hostname"]]))
    assert m["precision"] >= 0.90 and m["recall"] >= 0.90, m
    # an unterminated banner must surface as PARSE_ERROR, never be silently skipped
    unterminated = [d for d in corpus["manifest"]["devices"] if d["scenario"] == "c_banner_unterminated"]
    assert unterminated and all(res[d["hostname"]]["snapshot_status"] == "PARSE_ERROR" for d in unterminated)
