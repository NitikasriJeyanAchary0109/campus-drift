# Interview guide: what the project claims, where it is, how to prove it

Resume bullets, one by one. Every row names the code and the test that proves it, and every command below was run on the final code.

## 1. "Monitors campus network switches against approved baselines over SSH (Netmiko) to catch unrecorded configuration changes"

| Part | Where | Proof |
|---|---|---|
| SSH collection with Netmiko | `backend/app/services/collection.py` (`ConnectHandler`, 10 s timeout, typed errors for timeout, authentication and parse failures) | `tests/integration/test_simulated_devices_ssh.py`, `test_collection_service.py` (real SSH to three simulated switches in Docker) |
| Credentials are never stored in clear | `services/vault.py` (Fernet encryption, separate `VAULT_KEY`; the app refuses to start in production without one) | `test_config_security.py`, `test_security.py` |
| Scheduled polling | `tasks/collection.py` (`poll_all_devices_task` on Celery beat, one task per SSH-managed device, a per-device lock so two polls never overlap) | `tests/integration/test_celery_polling.py` |
| Compared with the approved baseline | `services/baseline.py`, `services/drift.py::detect_drift` (rules per device group: `EXACT`, `MUST_NOT_EXIST`, ACL rules and others) | `test_drift_engine.py`, `test_acl_sequence_ordering.py` |
| "Unrecorded" = no matching approved change ticket | `services/tickets.py::find_matching_ticket` (maintenance window plus a 30-minute grace period); a hard-compliance violation is never excused by a ticket | `test_ticket_matching.py`, `test_itsm_webhook.py` |

Measured on a generated, labelled corpus (100 devices, 40 scenarios, seeded, reproducible):
`python evaluation/generate_corpus.py && python evaluation/run_eval.py --label check`
gives device-level precision 1.000, recall 1.000, false-positive rate 0.000 for the full pipeline, against 0.605 precision for a plain `diff -u`.
Say plainly that this is agreement with generated ground truth, not a claim about unseen real networks; `docs/evaluation-error-analysis.md` keeps the cases the system got wrong before the fixes.

## 2. "Parser that turns flat CLI configs into hierarchical trees, plus a tree-diff engine with weighted risk scoring"

| Part | Where | Proof |
|---|---|---|
| Flat CLI to a tree (Cisco IOS) | `services/parsers/cisco_ios.py` (indentation-aware parser: `interface -> <name> -> switchport -> mode`, `line -> vty -> transport_input`, `snmp -> community -> <name>`), `services/normalization.py` (canonical, comparable form) | `test_normalizer.py`, `test_parser_hardening.py` |
| Second real syntax (FRRouting `vtysh`) | `services/parsers/frr_vtysh.py` | `test_frr_parser.py` (17 tests) |
| Tree diff | `services/drift.py` (key-path walk with wildcard rules, `ADDED` / `REMOVED` / `MODIFIED`, ACL rule order analysed separately in `services/acl_analyzer.py`) | `test_drift_engine.py` |
| Weighted risk scoring | `score_diff`: `rule severity (1-100) x zone criticality` (research labs 1.2, classrooms 1.0, hostels 0.8, event Wi-Fi 0.5), clamped to 1-100; `classify_diff` maps it to seven labels (Compliant, Authorized, Low, Medium, High, Critical, No baseline); hard-compliance rules always score 95 or more | `test_drift_engine.py`, `docs/labels-and-thresholds.md` |

Example of the tree the parser builds for `line vty 0 4 / transport input telnet ssh`: `{"line": {"vty": {"transport_input": "ssh telnet"}}}`.

## 3. "Reversible remediation (Jinja2 templates, RBAC, pre-change snapshots, post-change checks) and a React dashboard with Redis queues"

| Part | Where | Proof |
|---|---|---|
| Jinja2 templates | `services/remediation_templates.py`: a fixed whitelist keyed by vendor, rule type and key path; a sandboxed, strict Jinja2 environment; per-field validators reject shell metacharacters and newlines; free text is never executed | `test_remediation_engine.py`, `test_template_sandbox.py` |
| RBAC | `core/rbac.py` (Admin, NetworkEngineer, Viewer; enforced per endpoint and again in the service layer) | `test_rbac.py`, `test_four_eyes.py` (the plan's author cannot approve it) |
| Pre-change snapshot | `services/remediation.py` stores the running configuration in the `backups` table before any command is sent; an empty configuration is refused as a backup | `test_failure_remediation.py` |
| Post-change check and automatic rollback | the device is re-read and compared with the baseline; on failure the backup is restored and the restore is itself re-read and compared. `ROLLED_BACK` is only reported when the restored configuration matches the backup, otherwise `ROLLBACK_FAILED` and a critical alert | `test_failure_remediation.py`, `tests/integration/test_remediation_pipeline.py` (real SSH), `./scripts/demo_rollback.sh` |
| Audit trail | every action is logged; the audit table rejects UPDATE and DELETE in the ORM and with a database trigger | `test_audit_api.py` |
| Redis queues | Celery with Redis: scheduled polling on the `celery` queue and the remediation push on its own `remediation` queue. In production (`REMEDIATION_USE_QUEUE`) the apply and rollback calls return `202` and a task id and the worker does the SSH work; `GET /api/remediation/jobs/{id}` reports the result | `test_remediation_queue.py` (10 tests), `tests/integration/test_remediation_queue_live.py` (a real worker consumes the Redis queue and applies the plan on a simulated switch) |
| React dashboard | `frontend/`: Home (what needs attention), Problems, Devices, Approvals, plus Alerts, Baselines, Tickets, Remediation, Audit and Settings under "More" | `frontend/tests/unit` (250 tests), mocked and real-backend browser suites |

## Production hardening (what was added and where)
- Startup refuses `ENVIRONMENT=production` with default or weak secrets (`core/config.py`); `docker-compose.prod.yml`, backup and restore scripts, `docs/deployment-checklist.md`; a CI workflow in `.github/workflows/ci.yml`.
- Sign-in throttle (`core/throttle.py`): five wrong passwords for one username and address lock it for 15 minutes (429 with `Retry-After`), counters in Redis with a per-process fallback, failures audited without the password.
- Health (`/api/health`) checks the database and Redis; every response carries `X-Request-ID`, `X-Content-Type-Options`, `X-Frame-Options` and `Cache-Control: no-store`; each request is logged with its id and duration.
- Remediation guards: approval gate, one apply per plan, one operation per device, stale-claim recovery after a crashed worker, queue isolation for device pushes.
- Database migrations with Alembic (ten revisions); integration tests reset the simulated switches around every test.
- Architecture-review round (`docs/security-review.md`, 21 findings, each with a regression test): approval bound to a SHA-256 of the commands and re-checked at apply; ACL analysis that sees ports, options, object groups, IPv6 and discontiguous wildcards; verification that compares every line, not just the parsed model; ITSM webhook with signed timestamp and no campus-wide tickets; no re-apply after a failed rollback and delayed rollback retries; `write memory` after a verified fix; audit trail with a verifiable hash chain, TRUNCATE refusal and an external log copy; SSH host-key pinning; lab-only hooks off in production.

## Honest limits (say these before you are asked)
- A database superuser can still disable triggers. The audit hash chain makes it visible and the external log copy survives it, but the application should run as the restricted role in `scripts/db_harden_roles.sql`.
- The restore-by-difference and `write memory` paths were tested against a fake device and the lab simulator, not real switches.
- Plans are all-or-nothing by design: one change without a whitelisted template means no plan (422) and a console fix.
- Evaluated on generated corpora and three simulated switches, not on a production campus network.
- OpenConfig/gNMI ingest is a stub (HTTP 501); there is no write-back to ServiceNow or Jira (tickets flow in through a signed webhook).
- The stakeholder validation sessions in `docs/validation/` have a kit but no participant data.
- Every page shows only what the API returns; when a call fails the page says so and offers Retry instead of filling in example rows. The browser suite checks this against the real API (`docs/ui-test-report.md`).
- CI has been replayed locally (clean copy, fresh Python 3.11 environment and `npm ci`), but until it is pushed there is no GitHub run to point at.

## Five-minute demo
1. `docker compose up -d` then start the API and worker (`celery -A app.core.celery_app.celery_app worker -Q celery,remediation`).
2. Sign in as `viewer`: Home shows the problems; as `neteng`: open one, create a remediation; as `admin`: approve it (the author cannot).
3. `./scripts/demo_rollback.sh`: applies a change that fails verification and shows the three byte-compared states (original, changed, restored).

## Commands to quote
`PYTHONPATH=backend ./.venv/bin/pytest backend/tests/unit` (396 passed), `... backend/tests/integration` (42 passed, needs Docker), `ruff check backend`, `cd frontend && npm run lint && npm run build && npm run test:unit` (250 passed).
