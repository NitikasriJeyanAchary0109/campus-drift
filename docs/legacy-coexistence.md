# Legacy Workflow Coexistence & Migration Runbook

The drift detector is designed to run **alongside** an existing manual process (console captures,
TFTP/Oxidized/RANCID backups, air-gapped switches, maintenance moratoriums) and take over gradually.
This document covers the mechanisms, the staged migration plan with exit criteria, the API, and the
error boundaries of each mechanism.

## 1. Mechanisms

| Mechanism | What it does | Where |
|---|---|---|
| **Manual config upload** | Ingests an offline `show running-config` through the *same* normalize → diff → score → ticket pipeline as SSH polling | `POST /api/devices/{id}/config-upload`, Device Details → "Legacy Workflow Coexistence" card |
| **Collection mode** (per device) | `SSH_POLL` (default), `MANUAL_UPLOAD` (no SSH, sweeps skip it), `PAUSED` (no ingestion at all) | `PUT /api/devices/{id}/collection-mode` (Admin) |
| **Shadow mode** (per device) | Report-only: drift is scored and plans can be drafted/approved, but **nothing is ever pushed** (apply and manual rollback are refused with 409) | same endpoint |
| **Bulk import** | Loads a folder of legacy backups (one file per device) through the audited upload endpoint, using each file's mtime as `captured_at` | `scripts/import_legacy.py` |
| **Baseline proposal** | Mines a *proposed, inactive* baseline from the imported fleet (consensus rules + outlier devices) | `scripts/import_legacy.py --propose-baseline`, `app/services/baseline_mining.py` |

Design points:

* **One pipeline, two sources.** Uploads call `ingest_raw_configuration`, the same function SSH collection uses, so legacy and automated devices are scored identically. Snapshots are tagged `collection_method = MANUAL_UPLOAD`.
* **`captured_at` drives ticket matching.** A dump captured inside an approved maintenance window is `Drift-Authorized` even if uploaded days later (the ±30 min grace window applies to the capture time).
* **Remediation on non-SSH devices is a human step.** For `MANUAL_UPLOAD`, `PAUSED` and shadow devices the plan's template-rendered commands are shown for an engineer to apply on the console; uploading the resulting config verifies the fix (drift event resolves when the device is compliant).
* **Everything is audited:** `CONFIG_UPLOADED` (sha256, bytes, filename, note, captured_at, mismatch override) and `COLLECTION_MODE_CHANGED` (before/after).

## 2. API

### `POST /api/devices/{device_id}/config-upload`  (NetworkEngineer+)

```json
{
  "config_text": "<raw show running-config>",
  "captured_at": "2026-10-20T19:05:00Z",
  "source_filename": "sw-hostel-01.cfg",
  "note": "console capture after lab maintenance",
  "allow_hostname_mismatch": false
}
```

`201` response: `snapshot_id`, `snapshot_status` (`SUCCESS` | `PARSE_ERROR`), `collection_method`, `captured_at`, `sha256`, and the resulting `drift_event_id`, `drift_label`, `risk_score`.

### `PUT /api/devices/{device_id}/collection-mode`  (Admin)

```json
{ "collection_mode": "MANUAL_UPLOAD", "shadow_mode": true }
```

Either field may be omitted; at least one is required.

## 3. Error boundaries

| Condition | HTTP | Persisted? | Notes |
|---|---|---|---|
| Unknown device | 404 | nothing | |
| Device `DECOMMISSIONED` | 400 | nothing | |
| Device `PAUSED` | 409 | nothing | resume first |
| Payload > 1 MiB | 413 | nothing | real configs are < 200 KiB |
| Empty / whitespace-only | 422 | nothing | an empty upload must never read as "compliant" |
| Binary (NUL bytes) | 422 | nothing | |
| `captured_at` in the future (> 5 min skew) | 422 | nothing | |
| Config's `hostname` ≠ device hostname | 422 | nothing | override with `allow_hostname_mismatch` (recorded in audit) |
| Viewer role / no token | 403 / 401 | nothing | |
| Text accepted but unparseable | 201 | `PARSE_ERROR` snapshot + `CRITICAL_DRIFT` alert + audit | never a silent skip |
| `POST /devices/{id}/poll` on non-`SSH_POLL` device | 409 | nothing | |
| Apply / manual rollback on shadow or non-SSH device | 409 | nothing (no backup, no SSH session) | |

Periodic Celery sweeps enqueue only `SSH_POLL` devices.

## 4. Staged migration plan

| Stage | Setup | What the legacy process still does | Exit criteria to advance |
|---|---|---|---|
| **0. Shadow import** | `import_legacy.py` over existing backups; all devices `MANUAL_UPLOAD` + shadow | Everything (changes, backups) | Every device matched to an inventory entry; parse errors = 0 or explained; first baseline proposal reviewed and activated by an Admin |
| **1. Report-only** | Devices with credentials move to `SSH_POLL` + shadow | Applies all fixes | Two weeks of polling with ≤ 2% disputed findings (use *Mark false positive* + reason); engineers agree with the top-priority list |
| **2. Gated remediation, pilot group** | Shadow off for one low-criticality group (e.g. PublicEvent) | Handles other groups; console fallback | Approved plan applied + verified; rollback rehearsed successfully on the group |
| **3. Gated remediation, all SSH-managed groups** | Shadow off group by group | Air-gapped devices only (`MANUAL_UPLOAD`) | No unexplained rollbacks over an agreed period |
| **Fallback at any stage** | Set device `PAUSED` or shadow ON (Admin) | Resumes full manual control | Immediate, audited, reversible |

## 5. Bulk import usage

```bash
python scripts/import_legacy.py ./backups --api http://localhost:8000 \
    --username neteng --password '<password>' --dry-run        # match files to devices only
python scripts/import_legacy.py ./backups --password '<password>'   # upload
python scripts/import_legacy.py ./backups --password '<password>' \
    --propose-baseline proposed-hostel.yaml --group Hostel      # also mine a baseline proposal
```

Files are matched by file stem, falling back to the `hostname` line inside the file. Exit status is non-zero if any file is unmatched or fails.

The proposal YAML is **not active**. Each rule's description records its support and the *outlier* devices, which are candidate pre-existing drift. If most of a fleet already drifted, the consensus value *is* the drift, so a human must review before an Admin activates it (`PUT /api/baselines/{id}/activate`).

## 6. Tests

* `backend/tests/unit/test_legacy_upload.py` (23): upload happy paths, ticket matching on `captured_at`, PARSE_ERROR handling, every error boundary above, mode endpoints, sweep filtering, remediation guard (no SSH session opened for shadow / non-SSH devices).
* `backend/tests/unit/test_baseline_mining.py` (6): consensus, outliers, one-off lines, thresholds, YAML round-trip through the baseline schema.
