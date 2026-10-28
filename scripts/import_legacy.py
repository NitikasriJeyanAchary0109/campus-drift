#!/usr/bin/env python3
"""
Bulk-import legacy configuration backups (TFTP / Oxidized / RANCID style: one file per device).

Each file is matched to an inventory device (by the file stem, falling back to the
``hostname`` line inside the file) and uploaded through the audited
``POST /api/devices/{id}/config-upload`` endpoint, so legacy history is scored exactly like
SSH-collected snapshots. The file's modification time is used as ``captured_at`` so change
ticket windows are evaluated against when the config was really captured.

Optionally mines a *proposed* baseline from the imported fleet (never activated automatically).

Usage:
    python scripts/import_legacy.py ./backups --api http://localhost:8000 \
        --username neteng --password neteng123 [--dry-run] [--now] \
        [--propose-baseline proposed.yaml --group Hostel]
"""
import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import httpx

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

EXTENSIONS = {".cfg", ".conf", ".txt", ".config"}
HOSTNAME_RE = re.compile(r"^\s*hostname\s+(\S+)\s*$", re.MULTILINE | re.IGNORECASE)


def find_device(devices: Dict[str, dict], stem: str, text: str) -> Optional[dict]:
    if stem.lower() in devices:
        return devices[stem.lower()]
    match = HOSTNAME_RE.search(text)
    if match and match.group(1).lower() in devices:
        return devices[match.group(1).lower()]
    return None


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("directory", type=Path)
    ap.add_argument("--api", default=os.environ.get("DRIFT_API", "http://localhost:8000"))
    ap.add_argument("--username", default=os.environ.get("DRIFT_USER", "neteng"))
    ap.add_argument("--password", default=os.environ.get("DRIFT_PASSWORD"))
    ap.add_argument("--dry-run", action="store_true", help="match files to devices but upload nothing")
    ap.add_argument("--now", action="store_true", help="use the current time instead of file mtime as captured_at")
    ap.add_argument("--propose-baseline", type=Path, metavar="OUT.yaml", help="write a mined baseline proposal")
    ap.add_argument("--group", help="device group to mine the baseline for (required with --propose-baseline)")
    ap.add_argument("--min-support", type=float, default=0.8)
    args = ap.parse_args(argv)

    if not args.password:
        ap.error("--password (or DRIFT_PASSWORD) is required")
    if args.propose_baseline and not args.group:
        ap.error("--propose-baseline requires --group")
    if not args.directory.is_dir():
        ap.error(f"{args.directory} is not a directory")

    files = sorted(p for p in args.directory.iterdir() if p.is_file() and p.suffix.lower() in EXTENSIONS)
    if not files:
        print(f"No configuration files ({', '.join(sorted(EXTENSIONS))}) found in {args.directory}")
        return 1

    client = httpx.Client(base_url=args.api, timeout=30.0)
    login = client.post("/api/auth/login", json={"username": args.username, "password": args.password})
    if login.status_code != 200:
        print(f"Login failed ({login.status_code}): {login.text}")
        return 2
    client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

    listing = client.get("/api/devices")
    listing.raise_for_status()
    devices = {d["hostname"].lower(): d for d in listing.json()}

    counts = {"uploaded": 0, "dry-run": 0, "unmatched": 0, "failed": 0, "parse_error": 0}
    mined: Dict[str, str] = {}
    vendor = "cisco_ios"
    print(f"{'FILE':32} {'DEVICE':20} RESULT")
    for path in files:
        text = path.read_text(encoding="utf-8", errors="replace")
        device = find_device(devices, path.stem, text)
        if not device:
            counts["unmatched"] += 1
            print(f"{path.name:32} {'-':20} UNMATCHED (no inventory device named '{path.stem}')")
            continue

        if args.propose_baseline and (device.get("device_group") or {}).get("name", "").lower() == args.group.lower():
            mined[device["hostname"]] = text
            vendor = device["vendor"]

        if args.dry_run:
            counts["dry-run"] += 1
            print(f"{path.name:32} {device['hostname']:20} would upload (mode={device['collection_mode']})")
            continue

        captured = datetime.now(timezone.utc) if args.now else datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
        res = client.post(
            f"/api/devices/{device['id']}/config-upload",
            json={
                "config_text": text,
                "captured_at": captured.isoformat(),
                "source_filename": path.name,
                "note": "bulk legacy import",
            },
        )
        if res.status_code == 201:
            body = res.json()
            if body["snapshot_status"] == "PARSE_ERROR":
                counts["parse_error"] += 1
            else:
                counts["uploaded"] += 1
            label = body["drift_label"] or body["snapshot_status"]
            print(f"{path.name:32} {device['hostname']:20} {label} (score {body['risk_score']})")
        else:
            counts["failed"] += 1
            print(f"{path.name:32} {device['hostname']:20} FAILED {res.status_code}: {res.json().get('detail', res.text)}")

    print("\nSummary: " + ", ".join(f"{k}={v}" for k, v in counts.items()))

    if args.propose_baseline:
        from app.services.baseline_mining import propose_baseline_from_configs, proposal_to_yaml

        if len(mined) < 2:
            print(f"Cannot propose a baseline: only {len(mined)} matched device(s) in group '{args.group}'")
            return 1
        proposal = propose_baseline_from_configs(mined, vendor=vendor, min_support=args.min_support)
        args.propose_baseline.write_text(proposal_to_yaml(proposal, args.group, vendor), encoding="utf-8")
        flagged = sum(1 for r in proposal["rules"] if r["outliers"])
        print(
            f"Wrote proposed baseline ({len(proposal['rules'])} rules, {flagged} with outliers) to "
            f"{args.propose_baseline}. It is NOT active: review it, POST it to /api/baselines, "
            "then have an Admin activate it."
        )

    return 1 if counts["failed"] or counts["unmatched"] else 0


if __name__ == "__main__":
    sys.exit(main())
