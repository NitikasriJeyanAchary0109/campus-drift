# Review 3 Execution Plan (30% Milestone, cumulative ~65%)

Date drafted: 2026-10-26. Review date not yet known; the schedule below assumes ~3 weeks and marks what to cut if time is shorter.

## 1. Where the project stands (audited from the repo, not from the reports)

**Solid and verifiable**
- Backend: FastAPI + SQLAlchemy + Alembic (7 migrations), ~40 routes across 11 routers, Celery/Redis polling, HMAC ITSM webhook, ACL overlap analyzer, Jinja2 whitelisted remediation, approval gate, 3-state rollback, append-only audit trigger.
- Frontend: 13 pages (dashboard, devices, drift list/detail, baselines, approvals, remediation, alerts, audit, login, settings).
- ~120 tests (unit + integration against real SSH simulators). Docker Compose with 3 simulated devices.

**Gaps and overclaims found (these are what a Review 3 reviewer can penalise)**

| # | Finding | Evidence | Severity |
|---|---|---|---|
| G1 | **Legacy-workflow coexistence is documented but not implemented.** Report cites `POST /api/configurations/{device_id}/upload` in `api/configurations.py`; no such file or route exists. The PS lists this as mandatory. | `backend/app/api/` has no `configurations.py`; `main.py` mounts 11 routers, none for upload | **Blocker** |
| G2 | **Evaluation dataset is too thin for the PS.** FP/FN claims rest on "14 assertions", 3 devices, 14 rules, 10 tickets. PS asks for device configs + templates + change tickets + compliance rules, labels, measured FP/FN. 0.0% FP on hand-written cases looks tautological. | `docs/PHASE_COMPLETION_REPORT_35.md` §6.1–6.2 | **High** |
| G3 | **"FRR support" is nominal.** `rtr-lab-01` is Cisco-IOS-syntax text parsed by the Cisco parser; there is only one real parser (`parsers/cisco_ios.py`). `network/parsers/cisco_ios.py` is a re-export stub; `network/templates/` is empty. | `lab_router.cfg`, `normalization.py:36` | High |
| G4 | **Sites not covered:** only Classroom, Hostel, Lab. PS names offices and public events. | `seed_data.py` (3 devices) | Medium |
| G5 | **No stakeholder validation** (report §9.3 admits it). PS requires a short user/stakeholder validation. | report §9.3 | **High** |
| G6 | **Stale / contradictory docs:** Settings page still says "APScheduler"; `apscheduler` still in requirements; report says 102 tests, README says 118; root and `docs/` copies of architecture + report are duplicates; ports 5173 vs 5174; "AES-256 Fernet" is wrong (Fernet is AES-128-CBC + HMAC-SHA256); README says "cryptographically verified golden baselines" but baselines are not signed. | grep of README, `Settings.tsx`, `evaluation-report.md` §5 | Medium |
| G7 | **Review 2 feedback unaddressed:** granular unit-test and error-boundary documentation; API endpoint table and DB schema in README; code comments/docstrings. | Review 2 text | **High** (explicit penalty clause) |
| G8 | **UI gaps:** no Change Tickets page (ITSM is API-only), no upload UI, no baseline create/edit UI, no false-positive review queue, no evaluation/metrics view, no frontend tests. | `frontend/src/pages/` | Medium |
| G9 | **Production hardening:** `SECRET_KEY` default is committed and the vault key is derived from it; dev bind-mount compose only; no CI; no DB backup/restore story; no measured RAM figure behind the "<400 MB" claim. | `config.py:23`, `vault.py:24`, `docker-compose.yml` | Medium |
| G10 | **Review 1 follow-ups only partly delivered:** gNMI is a 501 stub; ITSM is inbound webhook only (no Jira/ServiceNow payload adapters, no write-back). | `evaluation-report.md` §2.3–2.4 | Medium |

## 2. Review 3 goal

Turn "working prototype with claims" into "prototype with evidence". Every claim in the Review 3 report should point to a script, a test, or a recorded result. Fix G1, G2, G5, G7 first; they map directly to PS must-haves and to the explicit Review 2 penalty.

## 3. Work packages (30% total)

| WP | Scope | Weight | Priority |
|---|---|---|---|
| **WP1** | Labelled evaluation corpus + experiment harness | 7% | P0 |
| **WP2** | Legacy coexistence + migration (upload API/UI, import of existing configs, dry-run mode) | 4% | P0 |
| **WP3** | Second real parser (FRR/vtysh or Junos `set` format) + OpenConfig JSON ingest | 5% | P1 |
| **WP4** | ITSM depth: ServiceNow/Jira payload adapters, Tickets UI, mock ITSM sender | 3% | P1 |
| **WP5** | Scale and modest-hardware measurements (100/500/1000 snapshots, RAM, free-tier run) | 3% | P1 |
| **WP6** | Failure/edge-case suite + scripted rollback demo | 3% | P0 |
| **WP7** | UI gaps + stakeholder validation | 3% | P0 (validation), P2 (extra UI) |
| **WP8** | Docs, CI, deployment checklist, ethics, Review 3 report | 2% | P0 |

### WP1: Labelled evaluation corpus + harness (P0)
- Add `evaluation/` with a generator script (seeded RNG, reproducible) producing **≥60 device configs** across 5 site types (Classroom, Hostel, Office, Lab, PublicEvent), each with a ground-truth manifest (`labels.yaml`): `{device, injected_drift[], cosmetic_changes[], ticket_covered[]}`.
- Mutation catalogue: the 5 drift types from the report + ACL reorder (benign vs significant) + cosmetic noise (whitespace, token order, mask vs CIDR, comment lines, banner variants) + ticket-covered changes inside / just outside the ±30 min window.
- Define labels and thresholds in one doc (`docs/labels-and-thresholds.md`): taxonomy, score bands, hard-compliance rule, what counts as TP/FP/FN at **event level** and **rule level**.
- Harness `evaluation/run_eval.py`: runs the real pipeline (not mocks) and emits `results/metrics.json` + `results.md`: confusion matrix per label, precision/recall/F1, per-site breakdown, FP/FN lists with the evidence bundle for each miss.
- **Baselines to compare** (target vs baseline vs measured, as the PS asks): (a) naive `diff -u` against golden file, (b) normalised line-set diff without tickets, (c) full pipeline. Show the contribution of each stage (ablation: no normaliser, no ticket matching, no ACL analyzer).
- Error analysis: manually inspect every FP/FN, classify root cause, fix or document. Include at least a few cases the system **does** get wrong (don't tune to 100%).
- Held-out split: tune thresholds on 50%, report on the other 50%.

### WP2: Legacy coexistence + migration (P0)
- Implement `POST /api/devices/{id}/config-upload` (text or file; Engineer+Admin), reusing the same normalise → diff → score → ticket path. Mark snapshot `source = MANUAL_UPLOAD`; add migration + audit entry.
- Bulk import: `scripts/import_legacy.py` ingesting a folder of existing `.cfg` backups (the typical TFTP/Oxidized/RANCID dump) to seed history and propose a **first baseline** per group (most-common-value rule mining, human-approved).
- **Coexistence mode:** per-device `collection_mode` = `SSH_POLL | MANUAL_UPLOAD | PAUSED`; read-only "shadow mode" flag so the tool reports alongside the legacy process without ever pushing.
- Migration runbook: shadow → report-only → gated remediation, with exit criteria per stage.
- UI: upload card on Device Details, mode badge in inventory.
- Fix the report so it only describes what exists.

### WP3: Second real parser (P1)
- Pick **FRR (vtysh `show running-config`)**, since `rtr-lab-01` is already labelled FRR and this fixes G3 honestly. Alternative: Junos `set`-style, easier to parse but more new surface.
- Real FRR fixture configs, parser module under `services/parsers/`, vendor dispatch table instead of the `if vendor in (...)` check, FRR remediation templates, tests mirroring the Cisco ones.
- OpenConfig: replace the 501 stub with a **JSON ingest path** (`POST` an OpenConfig-style document, normalise into the same tree). It delivers the "vendor-agnostic" ask without needing a gNMI device; keep gNMI streaming as documented future work.
- Change `rtr-lab-01` simulator config to genuine FRR syntax.

### WP4: ITSM depth (P1)
- Adapters for ServiceNow (`change_request` payload: `number`, `start_date`, `end_date`, `cmdb_ci`) and Jira (issue webhook with custom fields) mapping to the existing ticket schema; keep HMAC.
- `scripts/mock_itsm.py` that fires realistic payloads (including re-delivery, out-of-order, malformed) for the demo and tests.
- Tickets page in the UI (list, source badge, window, matched drift events).
- Optional (P2): outbound comment/write-back on the external ticket after a drift event is matched.

### WP5: Scale and modest hardware (P1)
- Benchmarks: pipeline latency at 100/500/1000 snapshots, p50/p95/p99, DB growth per snapshot, Celery sweep time for N simulated devices.
- Make the SSH simulator able to present many hostnames from one container so 15–30 devices fit on a laptop.
- Measure actual RAM and CPU with `docker stats` and replace the "<400 MB" claim with the measured number; cap container memory in compose.
- Deploy once to a free-tier target (Oracle Always Free VM or a small VPS) and record the checklist run; screenshot as evidence.
- Snapshot retention/pruning job (needed at scale; also good ethics/storage story).

### WP6: Failure cases and rollback demo (P0)
Add tests/scenarios beyond the existing five:
1. Device unreachable mid-apply (SSH drop after N commands) → rollback attempted, alert raised.
2. **Rollback itself fails** → `ROLLBACK_FAILED` state, critical alert, no silent success.
3. Overlapping / conflicting tickets, ticket ending mid-poll, timezone/DST and clock-skew inputs.
4. Concurrent polls of the same device (lock) and duplicate webhook delivery under race.
5. Oversized or binary config upload; malformed Unicode; empty config (must not read as "compliant").
6. Credential rotation / wrong password → `UNREACHABLE`, not drift.
7. Baseline activated mid-sweep.
- `scripts/demo_rollback.sh`: one command that runs seed → poll → drift → plan → approve → apply (forced fail) → rollback → prints the 3 config states as a diff and saves them to `evaluation/results/rollback_demo/`.
- Record the same flow in the UI (short GIF/screenshots) for the report.

### WP7: Stakeholder validation + UI gaps (P0 / P2)
- **Validation (P0):** 3–5 participants (campus IT staff if reachable; otherwise lab-admin peers/faculty). 20-minute scripted session with 5 tasks (find the riskiest drift, read the evidence, mark a false positive, approve a plan, trigger a rollback). Capture task success, time, SUS score, free-text feedback, and what changed because of it. Store in `docs/validation/`.
- Act on at least 2–3 findings and show the before/after.
- **UI (P2):** baseline create/edit form, false-positive review queue with reason capture (feeds back into WP1 labels), evaluation summary page reading `metrics.json`, fix Settings copy (Celery, not APScheduler).

### WP8: Docs, CI, deployment, ethics, report (P0)
- Review 2 fixes: README gets an **API endpoint table** and **DB schema/ER**; `docs/testing.md` covering test layers, how to run each, fixtures, and **error boundaries** (what each failure mode returns: HTTP code, DB state, alert, audit entry); docstrings on every service and API function that lacks one.
- GitHub Actions: backend pytest with Postgres + Redis service containers, frontend `tsc` + build, lint; badge in README.
- Remove duplicate root docs (keep `docs/`), reconcile test counts and ports, remove `apscheduler`, correct "AES-256" and "cryptographically verified" wording.
- Security hardening: require `SECRET_KEY` and a separate `VAULT_KEY` in non-dev, fail startup on default values when `ENVIRONMENT=production`; production compose without bind mounts; DB backup/restore script.
- Ethics note refresh: zone-weight fairness (hostel at 0.8 means student-facing risk is discounted, so justify or make it configurable), alert fatigue, human-in-the-loop, student-data minimisation, dual-use of a tool that holds device credentials.
- Review 3 report (structure below) with a claim-to-evidence table.

## 4. Schedule (3-week assumption)

| Week | Focus | Exit criteria |
|---|---|---|
| **1** | WP2 (upload + legacy), WP1 corpus + harness skeleton, WP8 doc fixes (G6, G7), CI | Upload endpoint live with tests; 60-config corpus generated; CI green; README has API + schema |
| **2** | WP1 runs + error analysis, WP3 FRR parser, WP4 adapters + Tickets UI, WP6 failure cases | First full metrics table; FRR parser passing its tests; failure tests added; rollback demo script runs |
| **3** | WP5 scale + free-tier deploy, WP7 validation sessions, final numbers, report | All numbers regenerated from scripts; validation done; report + demo video |

If time is short: cut WP3 OpenConfig ingest, WP4 write-back, WP7 extra UI, and the free-tier deploy (keep the measured local RAM). Do **not** cut WP1, WP2, WP6, validation, or the Review 2 doc fixes.

## 5. How to execute

- Work on a branch per WP (`wp1-eval-corpus`, `wp2-legacy-upload`, …) with small commits; merge to `main` when its tests pass.
- Order matters: WP2 and the WP1 generator can run in parallel (separate files). WP3 and WP4 touch `services/` and `api/tickets.py`, so they can also run in parallel with each other but should land before WP1's final run, since the harness should be run on the finished pipeline.
- Re-run the full suite after each merge. Every WP adds tests; target ~160 tests with a documented breakdown.
- Freeze code 3 days before the review. Final 3 days: regenerate all metrics, validation write-up, report, demo.

## 6. Review 3 report outline (maps to the PS sections)

1. Scenario definition (unchanged scope + new sites)
2. Baseline method (the three comparison baselines + ablation)
3. Implemented solution (delta since Review 2, with the claim-to-evidence table)
4. Usability walkthrough + **stakeholder validation results**
5. Edge-case and failure tests (≥10, each with file::test, expected, actual)
6. Performance results (target / baseline / measured / error analysis; FP & FN inspection with evidence bundles)
7. Legacy coexistence + migration + rollback demonstration
8. Ethics note
9. Deployment checklist (measured hardware numbers)
10. Limitations and what remains for the final 35%

## 7. Definition of done for the 30%

- [ ] Upload API + UI + bulk import, with tests (G1)
- [ ] ≥60-config labelled corpus; metrics regenerated by one command; FP/FN reviewed individually (G2)
- [ ] Real second parser; "FRR" claim true (G3)
- [ ] Office and PublicEvent devices present (G4)
- [ ] Validation with ≥3 participants documented (G5)
- [ ] Docs consistent, claims corrected (G6)
- [ ] API table, schema, test/error-boundary docs, docstrings (G7)
- [ ] Tickets UI + ServiceNow/Jira adapters (G8, G10)
- [ ] CI green, startup refuses default secrets in production, measured RAM figure (G9)
- [ ] ≥10 documented edge/failure cases, rollback demo script and recording
