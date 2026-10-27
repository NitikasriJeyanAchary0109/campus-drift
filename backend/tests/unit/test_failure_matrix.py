"""The failure matrix script must never report a ROLLED_BACK result for a device that was left changed."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_failure_matrix_has_no_false_rollback_claims(monkeypatch):
    spec = importlib.util.spec_from_file_location("failure_matrix", ROOT / "scripts" / "failure_matrix.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    original = mod.rem._connect_to_device
    try:
        rows = [(name, mod.run(factory, kw)) for name, _, factory, kw, _ in mod.SCENARIOS]
    finally:
        mod.rem._connect_to_device = original
    assert len(rows) >= 10
    for name, r in rows:
        assert not (r["result"] == "ROLLED_BACK" and r["device"] == "LEFT CHANGED"), name
        if r["device"] == "LEFT CHANGED":
            assert r["result"] == "ROLLBACK_FAILED", name   # a changed device is only acceptable if it is reported as such
        if r["result"] == "ABORTED":
            assert r["device"] == "unchanged" and r["backups"] == "0" or r["backups"] == "1", name
