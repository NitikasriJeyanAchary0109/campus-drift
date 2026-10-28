"""
Tests for the validation analysis script. All data here is SYNTHETIC test input that exercises the formulas;
it is never written to docs/validation/ and says nothing about real participants.
"""
import csv
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
spec_ = importlib.util.spec_from_file_location("validation_analyze", ROOT / "scripts" / "validation_analyze.py")
va = importlib.util.module_from_spec(spec_)
spec_.loader.exec_module(va)


def test_sus_known_values():
    assert va.sus_score([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]) == 100.0
    assert va.sus_score([3] * 10) == 50.0
    assert va.sus_score([1, 5, 1, 5, 1, 5, 1, 5, 1, 5]) == 0.0
    assert va.sus_score([4, 2, 4, 2, 4, 2, 4, 2, 4, 2]) == 75.0


@pytest.mark.parametrize("bad", [[3] * 9, [3] * 11, [0] + [3] * 9, [6] + [3] * 9])
def test_sus_rejects_malformed_answers(bad):
    with pytest.raises(ValueError):
        va.sus_score(bad)


def test_sus_adjectives():
    assert va.sus_adjective(90) == "excellent" and va.sus_adjective(75) == "good" and va.sus_adjective(60) == "OK" and va.sus_adjective(40) == "poor"


def test_fleiss_kappa_extremes():
    cats = va.TIERS
    assert va.fleiss_kappa([["HIGH", "HIGH", "HIGH"], ["LOW", "LOW", "LOW"], ["CRITICAL"] * 3], cats) == pytest.approx(1.0)
    assert va.fleiss_kappa([["HIGH", "LOW", "CRITICAL"]] * 4, cats) < 0.1
    assert va.fleiss_kappa([["HIGH"]], cats) is None                     # one rater: undefined
    assert va.fleiss_kappa([["HIGH", "HIGH"], ["LOW"]], cats) is None    # unequal rater counts


def test_wilson_bounds():
    lo, hi = va.wilson(3, 5)
    assert 0.2 < lo < 0.6 < hi < 0.95
    assert va.wilson(0, 0) == (0.0, 0.0)


def rows_for(rater, fn):
    return [{"participant_id": rater, "family": f, "zone": z, "tier": fn(f, z)} for f in va.spec.TIER_JUDGEMENT for z in va.spec.GROUPS]


def test_ratings_agreement_with_the_table():
    table = lambda f, z: va.spec.TIER_JUDGEMENT[f][z]
    rows = rows_for("P1", table) + rows_for("P2", table) + rows_for("P3", table)
    a = va.analyse_ratings(rows)
    assert a["table_matches"] == a["items"] == 45 and a["disagreements"] == [] and a["fleiss_kappa"] == pytest.approx(1.0)


def test_ratings_surface_disagreements():
    table = lambda f, z: va.spec.TIER_JUDGEMENT[f][z]
    flip = lambda f, z: "LOW" if f == "trunk_leak" else table(f, z)    # two of three raters downgrade trunk leaks
    rows = rows_for("P1", table) + rows_for("P2", flip) + rows_for("P3", flip)
    a = va.analyse_ratings(rows)
    assert {d["family"] for d in a["disagreements"]} == {"trunk_leak"} and len(a["disagreements"]) == 5
    assert a["per_rater"]["P1"] == (45, 45) and a["per_rater"]["P2"][0] == 40


def test_task_analysis_and_report_without_data_invents_nothing():
    text = va.render([], [], [], [])
    assert "No validation sessions have been run yet" in text and "No SUS responses yet" in text and "No ratings yet" in text
    sessions = [
        {"participant_id": "P1", "role": "lab admin", "task_id": "T1", "outcome": "success", "time_sec": "40", "hints": "0"},
        {"participant_id": "P2", "role": "student", "task_id": "T1", "outcome": "partial", "time_sec": "90", "hints": "2"},
        {"participant_id": "P3", "role": "lab admin", "task_id": "T1", "outcome": "fail", "time_sec": "120", "hints": "3"},
    ]
    t1 = va.analyse_tasks(sessions)[0]
    assert (t1["n"], t1["success"], t1["partial"]) == (3, 1, 1) and t1["median_s"] == 90 and t1["mean_hints"] == pytest.approx(5 / 3)
    assert "No validation sessions" not in va.render(sessions, [], [], [])


def test_templates_are_generated_and_match_the_judgement_table(tmp_path, monkeypatch):
    monkeypatch.setattr(va, "TEMPLATE_DIR", tmp_path)
    va.make_templates()
    with open(tmp_path / "ratings.csv", newline="") as fh:
        rows = list(csv.DictReader(fh))
    assert len(rows) == len(va.spec.TIER_JUDGEMENT) * len(va.spec.GROUPS)
    assert set(va.FAMILY_TEXT) == set(va.spec.TIER_JUDGEMENT)             # every judged family has a plain-language description
    assert (tmp_path / "sessions.csv").exists() and (tmp_path / "sus.csv").exists()
