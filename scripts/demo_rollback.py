#!/usr/bin/env python3
"""
Scripted rollback demonstration against the live simulated switch (sw-hostel-01).

Runs the real pipeline end to end and records three provably distinct device states:

    1. PRE-CHANGE     running-config before remediation (drifted: telnet + public SNMP)
    2. POST-APPLY     running-config after the approved commands were pushed (captured by the pipeline's
                      verification snapshot); verification is then forced to fail
    3. POST-ROLLBACK  running-config after the automatic rollback, re-read over SSH

and proves state 3 equals state 1. Evidence is written to evaluation/results/rollback_demo/.

Prerequisites: Postgres + the sw-hostel-01 simulator running and the database seeded
(scripts/demo_rollback.sh does all of that). Usage:  python scripts/demo_rollback.py [--out DIR]
"""
import argparse
import difflib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from netmiko import ConnectHandler  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models.alerts import Alert  # noqa: E402
from app.models.audit import AuditLog  # noqa: E402
from app.models.configurations import ConfigurationSnapshot  # noqa: E402
from app.models.devices import Device  # noqa: E402
from app.models.drift import DriftEvent  # noqa: E402
from app.models.remediation import Backup, RemediationAction  # noqa: E402
from app.models.users import User  # noqa: E402
from app.services.collection import collect_device_configuration  # noqa: E402
from app.services.normalization import normalize_config  # noqa: E402
from app.services.remediation import apply_remediation_plan, generate_remediation_plan, submit_approval  # noqa: E402

HOSTNAME = "sw-hostel-01"
SIM = {"device_type": "cisco_ios", "host": "localhost", "port": 2223, "username": "cisco", "password": "cisco123", "fast_cli": False, "timeout": 15}


def ssh(cmd: str) -> str:
    conn = ConnectHandler(**SIM)
    try:
        return conn.send_command(cmd)
    finally:
        conn.disconnect()


def diff(a: str, b: str, from_name: str, to_name: str) -> str:
    return "\n".join(difflib.unified_diff(a.splitlines(), b.splitlines(), from_name, to_name, lineterm="", n=1)) + "\n"


def step(n: int, text: str) -> None:
    print(f"\n[{n}] {text}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=ROOT / "evaluation" / "results" / "rollback_demo")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    started = datetime.now(timezone.utc)

    step(0, f"Reset {HOSTNAME} to its known drifted baseline state")
    try:
        ssh("simulator-reset-pristine")
    except Exception as e:
        print(f"    Cannot reach the simulator on localhost:2223 ({e}). Start it with: docker compose up -d sim_switch_hostel")
        return 2

    db = SessionLocal()
    device = db.query(Device).filter(Device.hostname == HOSTNAME).first()
    neteng = db.query(User).filter(User.username == "neteng").first()
    admin = db.query(User).filter(User.username == "admin").first()
    if not (device and neteng and admin):
        print("    Database is not seeded: run  python database/seed/seed_data.py")
        return 2

    step(1, "Poll the device over SSH and detect drift")
    snapshot = collect_device_configuration(db, device.id, neteng.id)
    event = db.query(DriftEvent).filter(DriftEvent.device_id == device.id, DriftEvent.snapshot_id == snapshot.id).order_by(DriftEvent.detected_at.desc()).first()
    print(f"    drift event {event.id}: {event.label}, risk score {event.risk_score}, {len(event.details)} violated rules")
    for d in event.details:
        print(f"      - {d.key_path}: expected {d.expected_value!r}, actual {d.actual_value!r}")

    step(2, "Generate a remediation plan (network engineer) and approve it (admin, four-eyes)")
    plan = generate_remediation_plan(db, event.id, neteng.id)
    submit_approval(db, plan.id, "APPROVED", "rollback demonstration", admin)
    print("    approved commands:")
    for c in plan.proposed_commands:
        print(f"      {c}")

    step(3, "STATE 1: capture the pre-change running-config over SSH")
    state1 = ssh("show running-config")

    step(4, "Apply with verification forced to FAIL: backup, push, verify (fails), automatic rollback")
    action = apply_remediation_plan(db, plan.id, neteng.id, force_fail_verification=True)
    print(f"    action result: {action.result}; plan status: {plan.status}")

    step(5, "STATE 2: the pipeline's post-push verification snapshot (what the device looked like before rollback)")
    snap2 = db.query(ConfigurationSnapshot).filter(ConfigurationSnapshot.id == action.verification_snapshot_id).first()
    state2 = snap2.raw_config

    step(6, "STATE 3: re-read the running-config over SSH after the rollback")
    state3 = ssh("show running-config")

    backup = db.query(Backup).filter(Backup.taken_before_action_id == action.id).first()
    alert = db.query(Alert).filter(Alert.related_id == action.id).order_by(Alert.created_at.desc()).first()
    audit = db.query(AuditLog).filter(AuditLog.target_id == action.id, AuditLog.action == "REMEDIATION_ROLLED_BACK").first()

    n = lambda t: normalize_config(t, "cisco_ios")  # noqa: E731
    checks = {
        "state1 != state2 (remediation really changed the device)": state1 != state2,
        "state2 != state3 (rollback really changed it back)": state2 != state3,
        "state3 == state1 byte for byte": state3 == state1,
        "state3 == state1 semantically (normalized trees)": n(state3) == n(state1),
        "telnet present in state 1": "transport input telnet" in state1,
        "telnet absent in state 2": "transport input telnet" not in state2,
        "telnet present again in state 3": "transport input telnet" in state3,
        "public SNMP present, absent, present again": ("snmp-server community public" in state1, "snmp-server community public" not in state2, "snmp-server community public" in state3) == (True, True, True),
        "action result is ROLLED_BACK": action.result == "ROLLED_BACK",
        "backup stored and equals state 1": bool(backup) and backup.config_blob == state1,
        "CRITICAL alert raised": alert is not None and alert.type == "CRITICAL_DRIFT",
        "audit entry records a verified restore": bool(audit) and audit.after_state.get("rollback_verified") is True,
    }

    out = args.out
    (out / "state1_pre_change.cfg").write_text(state1 + "\n")
    (out / "state2_post_apply.cfg").write_text(state2 + "\n")
    (out / "state3_post_rollback.cfg").write_text(state3 + "\n")
    (out / "diff_1_to_2.diff").write_text(diff(state1, state2, "state1 pre-change", "state2 post-apply"))
    (out / "diff_2_to_3.diff").write_text(diff(state2, state3, "state2 post-apply", "state3 post-rollback"))
    (out / "diff_1_to_3.diff").write_text(diff(state1, state3, "state1 pre-change", "state3 post-rollback") if state1 != state3 else "(no differences: state 3 is identical to state 1)\n")

    summary = {
        "started_at": started.isoformat(), "device": HOSTNAME, "drift_event_id": str(event.id), "plan_id": str(plan.id),
        "action_id": str(action.id), "backup_id": str(backup.id) if backup else None, "action_result": action.result,
        "plan_status": plan.status, "proposed_commands": plan.proposed_commands,
        "alert": alert.message if alert else None, "audit_after_state": audit.after_state if audit else None,
        "checks": {k: bool(v) for k, v in checks.items()}, "all_passed": all(bool(v) for v in checks.values()),
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2, default=str))
    report = [f"# Rollback demonstration: {HOSTNAME}\n", f"Run at {started.strftime('%Y-%m-%d %H:%M:%S UTC')} against the live simulator. Drift event `{event.id}`, plan `{plan.id}`, action `{action.id}`.\n",
              "## Approved commands\n", "```", *plan.proposed_commands, "```\n",
              "## What changed on the device\n", "**State 1 → State 2** (remediation pushed):\n", "```diff", diff(state1, state2, "state1", "state2").rstrip(), "```\n",
              "**State 2 → State 3** (automatic rollback):\n", "```diff", diff(state2, state3, "state2", "state3").rstrip(), "```\n",
              "## Proof\n", "| Check | Result |", "|---|---|", *[f"| {k} | {'PASS' if v else '**FAIL**'} |" for k, v in checks.items()],
              f"\nBackup `{summary['backup_id']}` was stored before the change; the rollback was verified by re-reading the running-config and comparing it with that backup.\n",
              f"Alert: {alert.message if alert else 'none'}\n"]
    (out / "report.md").write_text("\n".join(report))

    print("\n=== STATE 1 -> STATE 2 (what remediation changed) ===")
    print(diff(state1, state2, "state1", "state2").rstrip() or "(none)")
    print("\n=== STATE 2 -> STATE 3 (what the rollback changed back) ===")
    print(diff(state2, state3, "state2", "state3").rstrip() or "(none)")
    print("\n=== CHECKS ===")
    for k, v in checks.items():
        print(f"  [{'PASS' if v else 'FAIL'}] {k}")
    print(f"\nEvidence written to {out}")
    db.close()
    return 0 if summary["all_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
