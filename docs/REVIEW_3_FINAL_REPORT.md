# Review 3 Report: 30% Milestone (cumulative about 65%)

Project: Campus Network Configuration-Drift Detector with Approved-Baseline Remediation
Repository: https://github.com/NitikasriJeyanAchary0109/campus-drift (branch `main`)

Every number below was regenerated on the current code; the command that reproduces it is given next to it.
Work that is not finished is listed in section 6 instead of being described as done.

## 1. Status summary

| Area | State |
|---|---|
| Labelled evaluation corpus + harness (WP1) | Done: 100-device standard corpus and a 70-device challenge corpus, one command each |
| Legacy coexistence and migration (WP2) | Done: upload API and UI card, collection modes, shadow mode, bulk import with baseline mining |
| Second real parser (WP3) | Done for FRRouting `vtysh` syntax (new this milestone); OpenConfig/gNMI ingest is still a roadmap stub |
| ITSM depth (WP4) | Partly done: signed webhook receiver for ServiceNow and Jira payloads, Tickets page; no write-back to the ITSM |
| Scale and modest hardware (WP5) | Partly done: memory measured; 100/500/1000-snapshot scaling and a free-tier cloud run not done |
| Failure cases and rollback demo (WP6) | Done: 11-scenario failure matrix, 22 remediation failure tests, scripted 3-state rollback demo |
| Stakeholder validation (WP7) | Kit done, **sessions not run** (no participant data exists) |
| Docs, CI, deployment, ethics (WP8) | Done except the items in section 6 |

Review 1 and Review 2 asks (celery queue, ACL ordering, ITSM webhooks, test and error-boundary documentation, README API and schema
reference) are covered in section 2.

## 2. Earlier review feedback

| Ask | Where it is delivered |
|---|---|
| Review 1: replace in-process APScheduler with a worker queue | Celery + Redis (`celery_worker`, `celery_beat` in `docker-compose.yml`, `backend/app/core/celery_app.py`); ADR-003 in `docs/architecture.md`; `apscheduler` removed from requirements |
| Review 1: hierarchical ACL sequence ordering | `backend/app/services/acl_analyzer.py` (pairwise subnet overlap; significant reorders get a severity floor); ablation C-3 below shows 3 missed devices without it |
| Review 1: vendor-agnostic OpenConfig/gNMI | **Not delivered**: `docs/architecture.md` roadmap, API returns HTTP 501 for gNMI collection |
| Review 1: external ITSM webhooks | `POST /api/tickets/webhook` with constant-time HMAC-SHA256 verification (ServiceNow / Jira payloads), `docs/itsm-integration.md` |
| Review 2: unit-test and error-boundary documentation | `docs/testing-and-error-boundaries.md` (per-module inventory, five error boundaries) |
| Review 2: comments, API endpoints and database schema in README | `README.md` sections "Database Schema Reference" and "API Endpoint Reference"; docstrings in `services/drift.py`, `remediation.py`, `api/tickets.py` |

## 3. Evaluation (WP1)

Reproduce (no Docker needed):

```bash
python evaluation/generate_corpus.py && python evaluation/run_eval.py --label after-fixes
python evaluation/generate_corpus.py --profile challenge && python evaluation/run_eval.py --corpus evaluation/corpus_challenge --label challenge-after-fixes
```

Definitions and targets (declared before measuring): `docs/labels-and-thresholds.md`. Full tables and per-error analysis:
`docs/evaluation-error-analysis.md`, `evaluation/results/`.

Standard corpus: 100 devices (96 scored, 4 deliberately corrupted), 40 scenarios, 25 change tickets, seed 20261027.
Device-level detection of devices needing action:

| System | Precision | Recall | FPR |
|---|---:|---:|---:|
| A. naive `diff -u` | 0.605 | 1.000 | 0.681 |
| B. normalised full-tree diff | 0.742 | 1.000 | 0.362 |
| **C. full pipeline** | **1.000** | **1.000** | **0.000** |
| C-1 without semantic normalisation | 0.980 | 1.000 | 0.021 |
| C-2 without ticket matching | 0.790 | 1.000 | 0.277 |
| C-3 without ACL order analysis | 1.000 | 0.939 | 0.000 |

Targets met: precision, recall, false-positive rate, evidence completeness, p95 latency 8.4 ms (target 250 ms).
**Target missed:** recall of high-priority outputs (score 80 and above) is 0.906 against a 0.95 target (29 of 32 found, 3 tier
misjudgements listed in the error analysis). Tier accuracy is 0.950 over 100 devices (MEDIUM and HIGH are the confusable pair).

Challenge corpus (70 devices, 60 of them adversarial): the full pipeline scores 1.000 / 1.000 with 0 false positives, and the
naive diff scores precision 0.375. The 1.000 values on generated corpora describe agreement with generated ground truth; they are
not a claim about unseen real campus configurations, which is why the error analysis keeps the cases the system got wrong
before the fixes (before-fixes table: full pipeline precision 0.797, FPR 0.255).

## 4. Implementation delta since Review 2

- **Legacy coexistence (WP2):** `POST /api/devices/{id}/config-upload` runs uploads through the same normalise, diff, score and
  ticket path; per-device `collection_mode` (`SSH_POLL`, `MANUAL_UPLOAD`, `PAUSED`) and `shadow_mode` (report only, remediation is
  refused); `scripts/import_legacy.py` bulk import with baseline mining; Device Details page shows the mode and the upload card
  (restored this milestone after the UI redesign removed it). Runbook: `docs/legacy-coexistence.md`.
- **Second parser:** `backend/app/services/parsers/frr_vtysh.py` parses real FRR syntax (CIDR addresses, `exit` blocks, prefix lists
  ordered by `seq`, OSPF/BGP including address families). A device registered as `frr` is parsed with it when its text carries an
  FRR header; the lab router simulator emits IOS-style text and keeps the IOS parser. 17 unit tests.
- **Failure handling (WP6):** a failed rollback used to be reported as `ROLLED_BACK`; it is now re-read and compared with the
  backup, otherwise `ROLLBACK_FAILED`. Catalogue and the before/after matrix: `docs/failure-cases.md`, `python scripts/failure_matrix.py`.
  Rollback demonstration: `./scripts/demo_rollback.sh` (three byte-compared states).
- **Production hardening:** the application refuses to start with `ENVIRONMENT=production` and default or weak secrets; a separate
  `VAULT_KEY` for credential encryption; `docker-compose.prod.yml`; `scripts/db_backup.sh` and `db_restore.sh`; CI workflow
  `.github/workflows/ci.yml`. Details: `docs/deployment-checklist.md`.
- **User interface:** rebuilt as plain one-column pages (search, a table, filters behind a button, details on their own page)
  that show only what the API returns; a failed call shows the error and Retry, never example rows. Four main places in the
  sidebar, the rest under "More", role guards with a "no access" page. Tested at three levels (`docs/ui-test-report.md`);
  the black-box run found and fixed a credentials-form bug (wrong `auth_type` casing) and a compliance mismatch between Home and Devices.

## 5. Verification (reproducible)

| Check | Command | Result on 2026-11-07 |
|---|---|---|
| Backend unit tests (offline) | `PYTHONPATH=backend pytest backend/tests/unit` | 396 passed |
| Backend integration tests | `PYTHONPATH=backend pytest backend/tests/integration` (needs `docker compose up -d`) | 42 passed |
| Backend lint | `ruff check backend` | clean |
| Frontend lint and build | `cd frontend && npm run lint && npm run build` | clean |
| Frontend component tests | `cd frontend && npm run test:unit` | 251 passed |
| Mocked browser tests | `cd frontend && npm run test:e2e` | 6 passed |
| Browser tests against the real API | `cd frontend && npm run test:blackbox` | 97 passed on a freshly built database |
| Rollback demonstration | `./scripts/demo_rollback.sh` | see `evaluation/results/rollback_demo` |

## 6. Not done

- **Stakeholder validation:** the protocol, task cards, SUS form and analysis script exist (`docs/validation/`); no session has been run,
  so `docs/validation/results.md` is empty. At least three participants are needed.
- **gNMI / OpenConfig ingest and ITSM write-back:** not implemented.
- **Scale curve and free-tier cloud run:** only the memory footprint was measured (about 365 MB without Celery Beat).
- **CI:** the workflow has been replayed locally (backend and frontend jobs in a clean copy, integration job against the Docker stack) but has not yet run on GitHub, because that needs a push.

## 7. Ethics note

See `docs/PHASE_COMPLETION_REPORT_35.md` section 7 and `docs/labels-and-thresholds.md`. Points that apply to this milestone:
the hostel zone weight (0.8) discounts student-facing risk and is a per-device-group value in the database; every remediation needs a second person
(four-eyes) and a pre-change backup; uploads, mode changes and credential changes are audited (the secret is never written to the log); the vault holds device credentials, so it has its own key
and the key must be handled like the credentials themselves.
