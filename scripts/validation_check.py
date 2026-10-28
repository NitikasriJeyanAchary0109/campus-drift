#!/usr/bin/env python3
"""
Objective outcome check for a validation session (facilitator tool; run after the participant finishes tasks 3-5).

    DATABASE_URL=... python scripts/validation_check.py

Reads the validation database and the live simulator, so the facilitator records what actually happened rather than
what they remember: T3 (false positive recorded with a comment), T4 (plan approved by someone other than its author and
applied; telnet gone from the device), T5 (rollback executed and verified; telnet back).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from netmiko import ConnectHandler  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models.audit import AuditLog  # noqa: E402
from app.models.devices import Device  # noqa: E402
from app.models.drift import DriftEvent  # noqa: E402
from app.models.remediation import Approval, RemediationAction, RemediationPlan  # noqa: E402


def hostel_config() -> str:
    c = ConnectHandler(device_type="cisco_ios", host="localhost", port=2223, username="cisco", password="cisco123", fast_cli=False, timeout=15)
    try:
        return c.send_command("show running-config")
    finally:
        c.disconnect()


def main() -> int:
    db = SessionLocal()
    cfg = hostel_config()
    lab = db.query(Device).filter_by(hostname="rtr-lab-01").one()
    fp = db.query(DriftEvent).filter_by(device_id=lab.id, status="FALSE_POSITIVE").order_by(DriftEvent.detected_at.desc()).first()
    fp_audit = db.query(AuditLog).filter(AuditLog.target_id == fp.id, AuditLog.action.like("%FALSE_POSITIVE%")).first() if fp else None

    hostel = db.query(Device).filter_by(hostname="sw-hostel-01").one()
    plan = (db.query(RemediationPlan).join(DriftEvent, RemediationPlan.drift_event_id == DriftEvent.id)
            .filter(DriftEvent.device_id == hostel.id).order_by(RemediationPlan.created_at.desc()).first())
    approval = db.query(Approval).filter_by(remediation_plan_id=plan.id).first() if plan else None
    actions = db.query(RemediationAction).filter_by(remediation_plan_id=plan.id).order_by(RemediationAction.executed_at).all() if plan else []
    results = [a.result for a in actions]
    telnet_now = "transport input telnet" in cfg

    out = {
        "T3_false_positive_recorded": bool(fp), "T3_comment_audited": bool(fp_audit),
        "T4_plan_status": plan.status if plan else None,
        "T4_approved_by_different_person": bool(approval and plan.created_by and approval.approved_by != plan.created_by),
        "T4_applied": "SUCCESS" in results,
        "T5_rolled_back": bool(results) and results[-1] == "ROLLED_BACK",
        "T5_device_restored_telnet_back": telnet_now,
        "action_results_in_order": results,
        "device_state_now": "telnet present (pre-change state)" if telnet_now else "telnet absent (remediated state)",
    }
    out["T3_pass"] = out["T3_false_positive_recorded"]
    out["T4_pass"] = out["T4_approved_by_different_person"] and out["T4_applied"]
    out["T5_pass"] = out["T5_rolled_back"] and telnet_now
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
