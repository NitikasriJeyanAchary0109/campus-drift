#!/usr/bin/env python3
"""
Failure matrix: inject each failure into a fake device, run the REAL apply/rollback code, and tabulate what the system
recorded versus what really happened to the device. Needs no Docker. Writes evaluation/results/failure_matrix.md.

    python scripts/failure_matrix.py
"""
import sys
from pathlib import Path
from typing import Callable, Dict, List, Tuple

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from fastapi import HTTPException  # noqa: E402

from app.models.alerts import Alert  # noqa: E402
from app.models.remediation import Backup, RemediationAction  # noqa: E402
from app.services import remediation as rem  # noqa: E402
from app.services.normalization import normalize_config  # noqa: E402
from tests.failure_env import DRIFTED_CFG, build_env, open_event  # noqa: E402
from tests.fakes import DeviceFault, FakeDevice  # noqa: E402

# (name, fault description, fake factory, apply kwargs, behaviour BEFORE WP6 as probed on the previous code)
SCENARIOS: List[Tuple[str, str, Callable[[], FakeDevice], Dict, str]] = [
    ("Happy path", "none", lambda: FakeDevice(DRIFTED_CFG), {}, "SUCCESS"),
    ("Verification fails, rollback works", "post-change check forced to fail", lambda: FakeDevice(DRIFTED_CFG), {"force_fail_verification": True},
     "ROLLED_BACK (claimed, never verified)"),
    ("Verification fails, rollback fails", "post-change check fails and the restore command errors",
     lambda: FakeDevice(DRIFTED_CFG, rollback_error=True), {"force_fail_verification": True},
     "ROLLED_BACK + 'SUCCESSFULLY_RESTORED' (FALSE: device left changed)"),
    ("Connection refused", "SSH connect fails before anything is sent", lambda: FakeDevice(DRIFTED_CFG, connect_error=ConnectionError("no route")), {},
     "ROLLED_BACK + 'rollback triggered' (FALSE: nothing had changed)"),
    ("Empty running-config", "device returns an empty backup", lambda: FakeDevice(""), {}, "accepted an empty backup (by code reading, not probed)"),
    ("SSH drop mid-push, reconnect works", "2 of the commands applied, then the session died", lambda: FakeDevice(DRIFTED_CFG, push_error_after=2), {},
     "ROLLED_BACK (FALSE: dead session, device left half-changed)"),
    ("SSH drop right after push", "change fully applied, then the session died", lambda: FakeDevice(DRIFTED_CFG, drop_after_push=True), {},
     "ROLLED_BACK (FALSE: device left changed)"),
    ("Device dies mid-push", "partial change and the device stays unreachable", lambda: FakeDevice(DRIFTED_CFG, push_error_after=2, dead_forever_after_push=True), {},
     "ROLLED_BACK (FALSE: device left half-changed)"),
    ("Corrupt output after push", "one corrupted 'show running-config' read", lambda: FakeDevice(DRIFTED_CFG, garbage_reads=1), {}, "ROLLED_BACK"),
    ("Device ignores the change", "pushes accepted but not applied", lambda: FakeDevice(DRIFTED_CFG, ignore_push=True), {}, "ROLLED_BACK"),
    ("Real IOS (no reset command)", "'simulator-reset-pristine' is an invalid command", lambda: FakeDevice(DRIFTED_CFG, reset_supported=False), {"force_fail_verification": True},
     "ROLLED_BACK (only the first 30 backup lines replayed, unverified)"),
]


def run(factory: Callable[[], FakeDevice], kwargs: Dict) -> Dict[str, str]:
    env = build_env()
    db, users = env["db"], env["users"]
    event = open_event(env)
    plan = rem.generate_remediation_plan(db, event.id, users["NetworkEngineer"].id)
    rem.submit_approval(db, plan.id, "APPROVED", "ok", users["Admin"])
    fake = factory()
    original = fake.pristine
    rem._connect_to_device = lambda db_, dev: fake.connect()
    http = "200"
    try:
        rem.apply_remediation_plan(db, plan.id, users["NetworkEngineer"].id, **kwargs)
    except HTTPException as e:
        http = str(e.status_code)
    db.refresh(plan)
    actions = [a.result for a in db.query(RemediationAction).all()]
    try:
        restored = normalize_config(fake.running, "cisco_ios") == normalize_config(original, "cisco_ios") if original.strip() else True
    except Exception:
        restored = False
    changed = fake.pushed_once
    critical = [a for a in db.query(Alert).all() if a.type in ("CRITICAL_DRIFT", "REMEDIATION_FAILED") and a.related_id == (db.query(RemediationAction).first().id if actions else None)]
    state = ("unchanged" if not changed else ("original config" if restored else "LEFT CHANGED"))
    if plan.status == "APPLIED":
        state = "remediated"
    return {"result": actions[-1] if actions else "-", "plan": plan.status, "http": http, "device": state, "alert": (critical[0].type if critical else "-"), "backups": str(db.query(Backup).count())}


def main() -> int:
    rows = []
    for name, fault, factory, kw, before in SCENARIOS:
        r = run(factory, kw)
        honest = (r["result"] == "ROLLED_BACK" and r["device"] in ("original config", "unchanged")) or r["result"] in ("SUCCESS", "ABORTED") \
            or (r["result"] == "ROLLBACK_FAILED" and r["device"] == "LEFT CHANGED") or r["result"] == "ROLLBACK_FAILED"
        rows.append((name, fault, r, before, honest))
    lines = ["# Failure matrix (generated by scripts/failure_matrix.py)\n",
             "Each row injects one fault into a fake device and runs the real `apply_remediation_plan`. "
             "'Device' is what actually happened to the device; 'Result' is what the system recorded. "
             "The two must agree: ROLLED_BACK only when the device is back to its original configuration. "
             "The 'Before WP6' column records what the previous code did for the same fault (probed once on the pre-fix code; not regenerated).\n",
             "| Scenario | Injected fault | Result | Plan status | HTTP | Device after | Alert | Before WP6 |",
             "|---|---|---|---|---|---|---|---|"]
    for name, fault, r, before, honest in rows:
        lines.append(f"| {name} | {fault} | **{r['result']}** | {r['plan']} | {r['http']} | {r['device']} | {r['alert']} | {before} |")
    mismatch = [n for n, _, r, _, _ in rows if r["result"] == "ROLLED_BACK" and r["device"] == "LEFT CHANGED"]
    lines.append(f"\nFalse 'ROLLED_BACK' claims after WP6: **{len(mismatch)}**.")
    out = ROOT / "evaluation" / "results" / "failure_matrix.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 1 if mismatch else 0


if __name__ == "__main__":
    sys.exit(main())
