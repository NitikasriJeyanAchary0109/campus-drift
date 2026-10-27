# Failure and Edge-Case Catalogue, and the Rollback Demonstration

What the system does when things go wrong, where that behaviour is pinned by a test, and the defects this work found.
Reproduce the evidence with:

```bash
./scripts/demo_rollback.sh            # live simulator: 3 device states + proof  -> evaluation/results/rollback_demo/
python scripts/failure_matrix.py      # 11 injected faults vs what was recorded   -> evaluation/results/failure_matrix.md
cd backend && pytest tests            # 247 tests (the failure suites are tests/*/test_failure_*.py)
```

## 1. Rollback demonstration (live simulator)

`scripts/demo_rollback.sh` brings up Postgres and the `sw-hostel-01` simulator, seeds, then runs the real pipeline: poll → drift (Non-Compliant, 95) → plan (engineer) → approve (admin) → **apply with verification forced to fail** → automatic rollback. It captures three states and proves the third equals the first:

| State | Telnet on VTY | Public SNMP | NTP server | Source |
|---|---|---|---|---|
| 1. Pre-change | present | present | `10.10.0.2` | SSH `show running-config` |
| 2. Post-apply (broken) | **removed** | **removed** | `10.10.0.1` | pipeline's verification snapshot |
| 3. Post-rollback | present | present | `10.10.0.2` | SSH `show running-config` after rollback |

All 12 checks pass on the committed run (`evaluation/results/rollback_demo/report.md`, `summary.json`, the three `.cfg` states and the `.diff` files): state 3 is **byte-identical** to state 1, the stored backup equals state 1, the action is `ROLLED_BACK`, a `CRITICAL_DRIFT` alert exists and the audit entry records `rollback_verified: true`.

## 2. Outcome model

| Action result | Plan status | Meaning | HTTP | Alert |
|---|---|---|---|---|
| `SUCCESS` | `APPLIED` | change applied and verified | 200 | none |
| `ROLLED_BACK` | `FAILED` | change failed; the restore was **re-read and matched the pre-change backup** (retry possible) | 200 (verification failed) / 500 (error mid-change) | `CRITICAL_DRIFT` |
| `ROLLBACK_FAILED` | `ROLLBACK_FAILED` | change failed and the restore could **not** be proven; device state unknown | 200 / 500 | `CRITICAL_DRIFT` naming the backup to restore by hand |
| `ABORTED` | `FAILED` | failed before any change (no session, empty backup); nothing was sent | 502 (device/session) / 500 | `REMEDIATION_FAILED` |

Invariant: **`ROLLED_BACK` is only ever recorded when the device was verified to match its backup.**

## 3. Catalogue

| # | Failure | Behaviour | Pinned by |
|---|---|---|---|
| R1 | Verification fails, rollback works | `ROLLED_BACK`, alert, audit `rollback_verified: true`, device equal to original | `test_verification_failure_rolls_back_and_proves_it` |
| R2 | Verification fails **and** rollback fails | `ROLLBACK_FAILED`, loud alert ("state UNKNOWN", backup id), drift event stays OPEN | `test_rollback_that_fails_is_never_reported_as_rolled_back` |
| R3 | SSH connection refused / unreachable | `ABORTED`, no backup, nothing pushed, 502, plan retryable | `test_connection_refused_is_an_abort_not_a_rollback`, `test_aborted_plan_can_be_retried…` |
| R4 | Device returns an empty running-config | `ABORTED` (refuses to change a device without a usable backup) | `test_empty_running_config_is_refused_as_a_backup` |
| R5 | SSH session drops mid-push (partial change) | rollback over a **fresh** connection, verified, `ROLLED_BACK`, 500 | `test_session_drop_mid_push_is_restored_over_a_fresh_connection` |
| R6 | Session drops right after the push | same | `test_session_drop_right_after_push…` |
| R7 | Device dies mid-push and stays down | `ROLLBACK_FAILED`, "MANUAL INTERVENTION REQUIRED", backup retained | `test_device_that_dies_mid_push_yields_rollback_failed…` |
| R8 | Corrupt `show running-config` after the push | rolled back and verified | `test_corrupt_post_change_output_is_rolled_back` |
| R9 | Device ignores the change | verification fails, `ROLLED_BACK`, device unchanged | `test_device_that_ignores_changes…` |
| R10 | Real IOS (no simulator reset command) | backup commands replayed, then verified | `test_real_ios_without_reset_command…`, `…rollback_not_provable…` |
| R11 | Manual rollback fails | `ROLLBACK_FAILED`, alert, audit `MANUAL_ROLLBACK_FAILED`, 500 | `test_manual_rollback_failure_is_loud` |
| R12 | Manual rollback without a backup | 404 | `test_manual_rollback_without_backup_is_404` |
| C1 | Two applies of one plan at once | second gets 409 (atomic `APPLYING` claim) | `test_plan_being_applied_cannot_be_applied_again` |
| C2 | Worker crashes mid-apply | claim older than 15 min is released (`ABORTED`), audited | `test_stale_apply_claim…` |
| C3 | Unexpected exception | plan never left in `APPLYING` | `test_unexpected_exception_never_leaves_the_plan_claimed` |
| C4 | Poll or second operation during an apply (and the reverse) | per-device lock; apply gets 409, poll task returns `SKIPPED` | `test_busy_device_returns_409…`, `test_busy_device_raises_and_the_task_skips…` |
| C5 | Two workers poll one device at once (real Postgres) | exactly one snapshot, the other is `busy` | `test_two_simultaneous_polls_of_one_device_create_one_snapshot` |
| C6 | Lock correctness (real Postgres) | exclusive, per device, survives commits, released on error | `test_device_lock_*` |
| C7 | Approval gate | never approved / rejected → 409, no SSH session opened; already applied → 400 | `test_approval_gate_cannot_be_bypassed`, `…already_applied…` |
| P1 | Wrong password / credential rotation | `UNREACHABLE`, `DEVICE_DOWN` alert, audit `AUTH_FAILURE`; **no snapshot, existing drift untouched** | `test_wrong_password_marks_device_unreachable…` |
| P2 | Device down for many polls | one open `DEVICE_DOWN` alert (every failure still audited) | `test_repeated_failures_raise_one_alert…` |
| P3 | Device comes back | `ONLINE`, alert acknowledged, `DEVICE_RECOVERED` audited; a new outage alerts again | `test_recovery_acknowledges…` |
| P4 | Device returns nothing / only comments | `PARSE_ERROR` or drift, **never** "Compliant" | `test_empty_device_output…`, `test_comment_only_config…` |
| B1 | Baseline activated between polls | exactly one active baseline at all times; next event judged by the new baseline | `test_baseline_activation_between_polls…` |
| T1 | Ticket expired before the poll ran | capture time is what counts → still `Drift-Authorized` | `test_ticket_that_expired_before_the_poll…` |
| T2 | CLOSED ticket / re-opened by webhook | no authorization / authorization | `test_closed_ticket_does_not_authorize…` |
| T3 | Offsets (`+05:30`), naive, DST-ambiguous local hour | normalized to UTC; two UK `01:30` instants stay 1 h apart | `test_offset_timestamps…`, `test_dst_ambiguous…` |
| T4 | Inverted window, malformed / unsigned webhook | 400 / 422 / 401, nothing stored | `test_inverted_window…`, `test_malformed_and_unsigned…` |
| T5 | Duplicate / simultaneous webhook deliveries | idempotent; 8 concurrent deliveries → one ticket, no 500 | `test_duplicate_webhook…`, `test_concurrent_webhook_deliveries…` |
| T6 | Overlapping tickets | device > group > global, then scope specificity | `test_overlapping_tickets…` |
| U1 | Lone UTF-16 surrogate in an upload | 422 (was a 500) | `test_unpaired_surrogate…` |
| U2 | Clock skew on `captured_at` | ≤ 5 min tolerated, more rejected | `test_clock_skew_tolerance…` |
| U3 | 900 KB single line | handled | `test_very_long_single_line…` |
| A1 | Task queue (Redis) down on poll | 503 "Task queue unavailable" (was 500) | `test_task_queue_down_is_a_503…` |
| A2 | Validation errors | 422 without echoing submitted values (no secret reflection) | `test_validation_errors_do_not_echo_secrets` |
| A3 | Upload size / binary / empty / hostname mismatch / role | see `docs/legacy-coexistence.md` §3 | `test_legacy_upload.py` |

## 4. Defects found and fixed

| # | Defect (before) | Evidence | Fix |
|---|---|---|---|
| F1 | **A failed rollback was reported as `ROLLED_BACK`** with `SUCCESSFULLY_RESTORED_TO_BACKUP`; the rollback's errors were swallowed and the restored state was never compared with the backup | probed on the previous code: 4 of 11 scenarios claimed a rollback while the device was left changed (see the "Before WP6" column of `failure_matrix.md`) | `restore_and_verify`: re-read and compare with the backup; `ROLLBACK_FAILED` otherwise |
| F2 | A dead SSH session was reused for the rollback | scenarios R5, R6, R7 | fresh connections (2 attempts) |
| F3 | A failure **before** any change was reported as "rollback triggered" | connection refused | new `ABORTED` result and `REMEDIATION_FAILED` alert |
| F4 | Rollback replayed only the first 30 backup lines (misses everything after line 30 on a real device) | code reading | full replay, only when the device is still different after the reset, then verified |
| F5 | No guard against double apply, or a poll racing a push | code reading | atomic plan claim + per-device Postgres advisory lock |
| F6 | `DEVICE_DOWN` alert on **every** failed poll | 4 failures → 4 alerts | one open alert per device, auto-acknowledged on recovery |
| F7 | Concurrent duplicate webhook delivery → 500 (unique `ticket_ref`) | code reading (check-then-insert with a unique key); not reproduced on the old code | idempotent upsert |
| F8 | Ticket timestamps with offsets were never explicitly converted: SQLite drops the offset and Postgres converts using the server's time zone | reasoned from the drivers; not reproduced on the old code | normalize to naive UTC in the schema; Postgres session pinned to UTC; snapshot time stored as naive UTC |
| F9 | A lone surrogate in a request made the validation-error response itself crash (500); validation errors also echoed secrets | `test_unpaired_surrogate…` | custom `RequestValidationError` handler without input values |
| F10 | Task-queue outage surfaced as a generic 500 | code reading | 503 |

## 5. Limits that remain

* Real-device rollback is replay-based: a configuration that cannot be restored by re-entering commands (removed lines that the replay cannot undo) is detected by verification as `ROLLBACK_FAILED` but not repaired. A production deployment should add `configure replace` from a flash copy taken before the change.
* The simulator restores exactly via `simulator-reset-pristine`; real IOS behaviour is modelled by the fake device only, not tested on hardware.
* The advisory lock needs PostgreSQL; on SQLite it is a no-op (unit tests, single process).
* A worker killed mid-push leaves the device possibly half-changed with the plan `APPLYING` until the 15-minute stale-claim release; the stored backup identifies the restore point but nothing auto-recovers.
* No UI screen recording was made; the demo evidence is the script output and the saved states.
