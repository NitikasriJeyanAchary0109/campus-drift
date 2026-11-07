# Architecture review: findings and fixes

An external-style review of the platform (templates, ACL analysis, normalization, ITSM window, execution loop, four-eyes, audit trail)
found the defects below. Findings marked **[run]** were reproduced by executing the code before any change. Each fix has a regression test.

| # | Finding | Fix | Test |
|---|---|---|---|
| 1 | The metacharacter blacklist did not match its documentation and ignored control characters, quotes, backslash and `?` | `FORBIDDEN_CHARS` extended; every control character (CR, LF, Ctrl-C, Ctrl-Z, ESC, NUL, DEL) is refused; the sanitiser runs again at apply time | `test_template_sandbox.py` |
| 2 | **[run]** A sub-interface (`GigabitEthernet0/0.100`) was cut at the dot: the parent interface was changed | the wildcard segment is cut out by the fixed text around it | `test_template_sandbox.py`, `test_hardening_acl_normalization.py` |
| 3 | **[run]** `ntp server <hostname>` was refused; a rogue second NTP server could not be removed | hostnames accepted (RFC 1123); every server other than the expected one is removed | `test_template_sandbox.py` |
| 4 | Apply sent whatever `proposed_commands` held; approval was not tied to the commands | `approvals.commands_sha256`; apply refuses a changed plan (409, audit entry, alert); a database trigger forbids changing a plan's commands | `test_hardening_execution.py`, `test_audit_hardening.py` |
| 5 | **[run]** ACL analysis ignored ports, `established`, `log`, other options, object groups, IPv6, discontiguous wildcards; a moved `remark` was "significant" | parser rewritten: ports, options and groups are part of a rule's identity; wildcard overlap is exact bit arithmetic; groups are assumed to overlap everything; remarks ignored; duplicates matched by occurrence | `test_hardening_acl_normalization.py` |
| 6 | **[run]** Verification used a different lookup than drift detection and `values_equal(list, scalar)` accepted any matching member: a remediation passed with a rogue NTP server still configured | one lookup (`resolve_key_path`); a list with extra members is not equal to a single value | `test_hardening_acl_normalization.py` |
| 7 | **[run]** Anything outside the parsed model (a rogue local user) was invisible to the "verified rollback" | equivalence now also compares every line in its place in the hierarchy | `test_hardening_execution.py` |
| 8 | **[run]** Dotted interface names could not be resolved from a key path | longest-match resolution through nested keys | `test_hardening_acl_normalization.py` |
| 9 | Order-insensitive token sorting applied to any text | only for keyword sets such as `transport input` | `test_hardening_acl_normalization.py` |
| 10 | The ITSM HMAC covered the body only: a captured delivery could be replayed to re-open a closed ticket | optional `X-ITSM-Timestamp` signed with the body, tolerance window, mandatory in production | `test_itsm_webhook.py` |
| 11 | A webhook ticket whose hostname did not resolve became a ticket for every device | refused with 422; a ticket must resolve to a device or group; cross-source ticket reference overwrite refused | `test_itsm_webhook.py` |
| 12 | A change was dated by the poll that noticed it | the ticket window is matched against the interval since the previous poll, bounded by `ITSM_MAX_DETECTION_LAG_MINUTES` | `test_ticket_matching.py` |
| 13 | A failed rollback could be followed by a new apply that backed up the broken state | apply refused (409) while a plan is `ROLLBACK_FAILED` | `test_hardening_execution.py` |
| 14 | Rollback retried immediately, twice, then gave up for good; a verification read timeout caused a rollback | back-off between attempts, delayed Celery retries (`retry_rollback_task`), the verification read is retried | `test_hardening_execution.py` |
| 15 | A verified fix was lost on reload | `write memory` after verification (a failed save raises `CONFIG_NOT_SAVED`, the change stays) | `test_hardening_execution.py` |
| 16 | The rollback "replay" could not remove lines the change had added | a computed difference: negate what was added, re-add what was removed | `test_hardening_execution.py` |
| 17 | `?force_fail=` and the simulator reset command were live in production code | gated by `ALLOW_TEST_HOOKS` (off in production, startup refuses it on) | `test_hardening_execution.py`, `test_config_security.py` |
| 18 | An authorless (legacy) plan could be approved by any engineer; a problem could have many pending plans | authorless plans need an Admin; one live plan per problem (409) | `test_four_eyes.py` |
| 19 | The `PLAN_APPROVED` audit entry had a NULL `target_id` | the approval id is assigned before the entry is written | `test_four_eyes.py` |
| 20 | Row-level trigger did not stop `TRUNCATE`; no tamper evidence | `BEFORE TRUNCATE` trigger, hash chain (`audit_verify_chain()`, `GET /api/audit/verify`), approvals and backups write-once, JSON line per entry on the `campus_drift.audit` logger, `scripts/db_harden_roles.sql` | `test_audit_hardening.py` (PostgreSQL) |
| 21 | No SSH host-key verification | `SSH_STRICT_HOST_KEYS` + `SSH_KNOWN_HOSTS_FILE`; production refuses to start without them | `test_ssh_security.py` |

## Acceptance criteria and where each is met

| Criterion | What the code does | Evidence | Limit |
|---|---|---|---|
| Zero arbitrary string injection | Commands come only from Jinja2 templates (sandboxed, strict undefined); each field has an allow-list validator; the sanitiser runs again at apply. A value with shell metacharacters raises `SecurityViolationError`, returned as HTTP 422 | `test_template_sandbox.py`, `test_remediation_engine.py` (HTTP 422 case) | The check covers plan generation and apply; text typed into a ticket or description field is stored, not sent to a device |
| Zero cosmetic false alarms | Case, tabs, CRLF, runs of spaces, comments, `Gi0/1` against `GigabitEthernet0/1`, ordering of `transport input` keywords, and IP mask against prefix all parse to the same tree | `test_cosmetic_equivalence.py`, `test_normalizer.py` | Interface `description` is not part of the model, so `desc` and `description` are equal because both are ignored, and a changed description is not drift. The `int` shorthand for `interface` is not accepted. A device never prints it |
| ACL order risk | A reorder is drift only when a permit and a deny that overlap (exact wildcard-bit test, ports, protocol) swap places. Disjoint or same-action reorders and moved remarks are suppressed. Added, removed or edited rules are always drift | `test_acl_sequence_ordering.py`, `test_hardening_acl_normalization.py` | It compares the actual ACL with the baseline. It does not lint a rule that is already shadowed inside an ACL that matches its baseline |
| Automated rollback | Backup before the change, verified restore by line comparison after a failed check, `ROLLBACK_FAILED` and a critical alert when the restore cannot be proven, delayed retries. The restore time is measured and written to the audit entry with `ROLLBACK_TARGET_SECONDS` (default 60); a slower restore adds a line to the alert | `test_failure_remediation.py`, `test_hardening_execution.py`, `integration/test_remediation_pipeline.py` (real SSH to the simulators) | The target is reported, not enforced: a slow restore is not cut short. Real switches were not tested |
| Four-eyes | The author of a plan cannot approve it (403, `PLAN_SELF_APPROVAL_BLOCKED`) and cannot apply it (403, `PLAN_SELF_APPLY_BLOCKED`, checked before any backup or connection). A plan with no recorded author needs an Admin. The Execute button is disabled for the author | `test_four_eyes.py`, `Remediation.test.tsx`, `e2e-real/04` | Roles are not separate people: one person with two accounts passes. Rollback by an Admin is allowed for the author, because it is the safety action |
| Complete audit trail | Written in the same transaction as the change: sign-in (success, failure, inactive), token refresh and refusal, sign-out, device create, update and decommission, credentials, collection mode, baseline create and activate, ticket create, every ITSM delivery (accepted or refused, with the body and its SHA-256), alert acknowledgement, drift closure, plan, approval, apply, rollback. PostgreSQL triggers refuse update, delete and truncate, and chain each row to the previous one | `test_audit_coverage.py`, `integration/test_audit_hardening.py` | Reads are not audited. A refused webhook that failed its signature stores only a digest and the source address, so an unauthenticated sender cannot write text into the trail; a flood of bad deliveries still adds rows, so rate-limit the endpoint at the proxy |

## Decisions, not defects
- **Plans stay all-or-nothing.** If one change in a problem has no whitelisted template, or its value fails validation (a community name
  such as `pub;lic`), no plan is created and the operator gets a 422 naming the setting. The alternative, a partial plan, would leave the
  device half-fixed and make post-change verification meaningless. The setting is fixed on the console.
- **Zone weights can lower a score.** A severity-90 rule in a 0.5x zone scores 45 and raises no high-priority alert. Hard-compliance rules
  are never discounted. This is a policy choice for each campus, not a bug, but it should be reviewed per rule.

## What the fixes do not do
- A database superuser can still disable triggers. The hash chain makes that visible (`GET /api/audit/verify` names the first bad row) and the
  external log copy survives it, but nothing prevents a superuser from truncating the table and the log together. Run the application as
  `campus_app` and keep the log on a host the database administrators do not control.
- Real switches were not available. The restore-by-difference and `write memory` paths are tested against a fake device and the lab simulator.
- Not reviewed: refresh-token revocation, the FRR parser internals.
