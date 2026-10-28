#!/usr/bin/env python3
"""
Prepare the lab for one stakeholder-validation session: a known, repeatable scenario.

    DATABASE_URL=... python scripts/validation_setup.py [--key evaluation/validation/session_key.json]

What it does (idempotent; run it before every participant):
  1. resets the three simulated devices to their pristine state;
  2. adds an NTP drift on sw-classroom-01 plus an OPEN change ticket that covers it (an *authorized* drift), and an unticketed NTP
     drift on rtr-lab-01 (the participant is told it is a known exception and must record that as a false positive);
  3. polls all three devices over SSH (real pipeline) so drift events exist;
  4. drafts a remediation plan for sw-hostel-01 as the network engineer ``neteng`` (the participant, signed in as ``admin``,
     approves it: the four-eyes rule makes this the natural role split);
  5. writes the facilitator's answer key (never shown to participants).
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from netmiko import ConnectHandler  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models.devices import Device  # noqa: E402
from app.models.drift import DriftEvent  # noqa: E402
from app.models.remediation import RemediationPlan  # noqa: E402
from app.models.tickets import ChangeTicket  # noqa: E402
from app.models.users import User  # noqa: E402
from app.services.collection import collect_device_configuration  # noqa: E402
from app.services.evidence import locate_source_line  # noqa: E402
from app.services.remediation import generate_remediation_plan  # noqa: E402

SIMS = {
    "sw-classroom-01": {"port": 2222, "user": "cisco", "pw": "cisco123"},
    "sw-hostel-01": {"port": 2223, "user": "cisco", "pw": "cisco123"},
    "rtr-lab-01": {"port": 2224, "user": "admin", "pw": "admin123"},
}
TICKET_REF = "CHG-VAL-001"


def sim(host: str):
    s = SIMS[host]
    return ConnectHandler(device_type="cisco_ios", host="localhost", port=s["port"], username=s["user"], password=s["pw"], fast_cli=False, timeout=15)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--key", type=Path, default=ROOT / "evaluation" / "validation" / "session_key.json")
    args = ap.parse_args()

    print("1. resetting simulators")
    for host in SIMS:
        c = sim(host)
        c.send_command("simulator-reset-pristine")
        if host == "sw-classroom-01":
            c.send_config_set(["ntp server 10.10.0.9"])   # the 'maintenance' change that the ticket authorizes
        if host == "rtr-lab-01":
            c.send_config_set(["ntp server 10.10.0.7"])   # an unticketed change the participant is told is a known exception (task 3)
        c.disconnect()

    db = SessionLocal()
    neteng = db.query(User).filter_by(username="neteng").one()
    classroom = db.query(Device).filter_by(hostname="sw-classroom-01").one()

    print("2. creating the change ticket for the classroom NTP change")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    t = db.query(ChangeTicket).filter_by(ticket_ref=TICKET_REF).first() or ChangeTicket(ticket_ref=TICKET_REF)
    t.source, t.device_id, t.key_path_scope, t.status = "servicenow", classroom.id, "ntp.server", "OPEN"
    t.external_ref = TICKET_REF
    t.valid_from, t.valid_to = now - timedelta(hours=1), now + timedelta(hours=6)
    db.add(t)
    db.commit()

    print("3. polling devices")
    results = {}
    for host in SIMS:
        dev = db.query(Device).filter_by(hostname=host).one()
        snap = collect_device_configuration(db, dev.id, neteng.id)
        ev = db.query(DriftEvent).filter(DriftEvent.device_id == dev.id, DriftEvent.snapshot_id == snap.id).order_by(DriftEvent.detected_at.desc()).first()
        results[host] = {"event_id": str(ev.id) if ev else None, "label": ev.label if ev else None, "score": ev.risk_score if ev else None,
                         "paths": [d.key_path for d in ev.details] if ev else [], "raw": snap.raw_config}
        print(f"   {host:16} {results[host]['label']} (score {results[host]['score']})")

    print("4. drafting the remediation plan for sw-hostel-01 as 'neteng'")
    hostel_ev = db.query(DriftEvent).filter_by(id=results["sw-hostel-01"]["event_id"]).one()
    existing = db.query(RemediationPlan).filter_by(drift_event_id=hostel_ev.id, status="PENDING").first()
    plan = existing or generate_remediation_plan(db, hostel_ev.id, neteng.id)

    telnet = locate_source_line(results["sw-hostel-01"]["raw"], "line.vty.transport_input")
    key = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "task1_riskiest_device": max((h for h in results if results[h]["score"] is not None), key=lambda h: results[h]["score"]),
        "task1_riskiest_score": max(r["score"] for r in results.values() if r["score"] is not None),
        "task1_authorized_decoy": {"device": "sw-classroom-01", "label": results["sw-classroom-01"]["label"], "ticket": TICKET_REF},
        "task2_telnet_line_text": telnet[0] if telnet else None,
        "task2_telnet_line_number": telnet[1] if telnet else None,
        "task3_false_positive_candidate": {"device": "rtr-lab-01", "event_id": results["rtr-lab-01"]["event_id"], "label": results["rtr-lab-01"]["label"], "paths": results["rtr-lab-01"]["paths"]},
        "task4_plan_id": str(plan.id), "task4_plan_commands": plan.proposed_commands, "task4_drafted_by": "neteng",
        "task5_expected_after_rollback": "transport input telnet ssh present again; public SNMP community present again",
    }
    args.key.parent.mkdir(parents=True, exist_ok=True)
    args.key.write_text(json.dumps(key, indent=2))
    print(f"5. facilitator key written to {args.key}")
    for k, v in key.items():
        print(f"   {k}: {v}")
    db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
