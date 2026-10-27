# Labels, Thresholds and Ground Truth

This document fixes the definitions the evaluation harness (`evaluation/`) scores against. It is written
*before* the results are inspected, so thresholds and the expert judgement table are not fitted to outputs.

## 1. Output labels (the system's taxonomy)

| Label | Meaning | Score band | Trigger |
|---|---|---|---|
| `Compliant` | No baseline rule violated | 0 | no diffs |
| `Drift-Authorized` | Violation covered by an OPEN change ticket | 1–30 | ticket match, rule not hard |
| `Drift-Unauthorized-Low` | Unapproved soft-rule violation | 31–50 | raw score ≤ 50 |
| `Drift-Unauthorized-Medium` | Unapproved soft-rule violation | 51–79 | raw score 51–79 |
| `Drift-Unauthorized-High` | Unapproved soft-rule violation | 80–94 | raw score ≥ 80 |
| `Non-Compliant (Critical)` | Hard-compliance rule violated (not waivable by ticket) | 95–100 | `hard_compliance = true` |
| `NO_BASELINE` | Group has no active baseline | 0 | excluded from metrics |
| `PARSE_ERROR` (snapshot status) | Configuration could not be parsed | n/a | raises a `CRITICAL_DRIFT` alert |

`raw score = round(rule.severity_weight × group.criticality_weight)`, clamped to 1–100.
An event's label and score come from its dominant (highest-priority) diff.

Zone weights: Lab 1.2, Classroom 1.0, Office 1.0, Hostel 0.8, PublicEvent 0.5.

**High-priority threshold:** an event is *high priority* when `risk_score ≥ 80`. Every high-priority event must carry an evidence bundle (§5).

**Ticket grace window:** ±30 minutes around the snapshot time (`find_matching_ticket`).

## 2. Ground-truth tiers

Each injected change has a **ground-truth tier**, assigned by the corpus author from security judgement *independently of rule weights*:

`CRITICAL > HIGH > MEDIUM > LOW > AUTHORIZED > COMPLIANT`

The tier maps one-to-one onto the labels above (`CRITICAL` = `Non-Compliant (Critical)`, `HIGH` = `Drift-Unauthorized-High`, and so on).
The judgement table (`evaluation/spec.py: TIER_JUDGEMENT`) is:

| Change | Classroom | Hostel | Office | Lab | PublicEvent | Rationale |
|---|---|---|---|---|---|---|
| Telnet enabled on VTY (any form) | CRITICAL | CRITICAL | CRITICAL | CRITICAL | CRITICAL | cleartext admin credentials; not waivable |
| `public` / `private` SNMP community present | CRITICAL | CRITICAL | CRITICAL | CRITICAL | CRITICAL | unauthenticated device enumeration / write access |
| Port-security off on an edge port | MEDIUM | MEDIUM | MEDIUM | HIGH | LOW | rogue-device risk; research labs hold sensitive data, pop-up event ports are short-lived |
| Trunk allows an extra VLAN | HIGH | HIGH | HIGH | HIGH | MEDIUM | VLAN-hopping / segmentation breach |
| Edge port moved onto management VLAN | HIGH | HIGH | HIGH | HIGH | MEDIUM | user device on the management plane |
| ACL entry order inverted (overlapping permit/deny) | HIGH | HIGH | HIGH | HIGH | HIGH | changes first-match filtering verdicts |
| ACL entry removed | HIGH | HIGH | HIGH | HIGH | HIGH | silently weakens filtering |
| NTP re-pointed / removed / extra server | LOW | LOW | LOW | LOW | LOW | forensic-clock risk, not directly exploitable |

This is a **single-annotator judgement**. WP7 stakeholder sessions are used to validate it (see `docs/validation/`).
Where the pipeline's label disagrees with the table, the disagreement is reported as a *calibration error*, not hidden by editing the table.

## 3. Ground truth for detection and authorization

* **Semantic drift** exists when the device's effective configuration differs from the approved baseline *on a monitored rule*.
  Cosmetic changes (whitespace, comments, stanza order, VLAN-list notation, disjoint ACL reordering) and changes outside the baseline's scope (descriptions, VLAN names, logging hosts, timeouts) are **not** drift.
* **Authorized** is stated explicitly per scenario from policy intent: an OPEN ticket whose device/group and key-path scope cover the finding, whose window ± 30 min contains the capture time, and where the rule is not `hard_compliance`. Hard rules are never waivable.
* **Expected parse error** devices carry deliberately corrupted text; the correct behaviour is a `PARSE_ERROR` snapshot plus alert, never a silent skip.

## 4. Metric definitions

A **finding** is a `(device, concrete key path)` pair evaluated against a baseline rule.

| Metric | Definition |
|---|---|
| Finding TP | system reports a diff on a path with semantic drift |
| Finding FP | system reports a diff on a path with no semantic drift |
| Finding FN | semantic drift on a path with no reported diff (includes drift on devices whose config failed to parse) |
| Precision / Recall / F1 | standard, over findings |
| **Alert** (device level) | system raises an alert-worthy output: label not in {`Compliant`, `Drift-Authorized`}, **or** a `PARSE_ERROR` |
| Device truth-positive | device has ≥ 1 *unauthorized* semantic drift |
| Device FP / FN / FPR | alert on a device with no unauthorized drift / no alert on a device with one / FP ÷ (FP + TN) |
| Authorization accuracy | among true-drift findings the system detected, share whose authorized/unauthorized status is right |
| Tier accuracy | share of devices whose event label equals the ground-truth event tier (max tier over findings) |
| High-priority precision / recall | system `risk_score ≥ T` vs ground-truth tier ∈ {CRITICAL, HIGH} (event level) |
| Evidence completeness | share of high-priority events whose evidence bundle has every required field (§5) |
| Latency | wall time per snapshot: normalize + persist + drift + score (in-memory SQLite), p50/p95/p99 |

Parse-error test devices are excluded from detection metrics and reported separately (parse-error detection rate).
*Realism* devices that are semantically compliant but fail to parse count as false alarms: the system raised an alert on a good device.

## 5. Evidence requirements for a high-priority output

An event with `risk_score ≥ 80` must provide, for **every** detail: key path, expected value, actual value, rule id, a why-it-matters rationale, **and a citation of the running-config line** (or, for absent items, the stanza that should contain it) with its line number. Event-level: device hostname, score, label, ticket-match status.

## 6. Experiment design

* **Corpus:** 100 devices (20 per site type: Classroom, Hostel, Office, Lab, PublicEvent) from a seeded generator, ~45 scenarios in three strata:
  * `core`: configuration shapes the product advertises (the five drift types, ticket windows, cosmetic noise),
  * `realism`: constructs common on real switches (banners, `ntp server … prefer`, split VTY ranges, extra rogue NTP server, `snmp-server location` with punctuation),
  * `adversarial`: constructs designed to stress a known limitation (corrupted streams).
* **Systems compared** (same corpus, same truth):
  1. **A. Naive text diff** (`diff -u` against the device's own last-known-good config),
  2. **B. Normalized full-tree diff** (parse both, compare every leaf; no rules, no tickets, no scoring),
  3. **C. Full pipeline** (rules + normalization + ACL analysis + ticket matching + scoring),
  4. **Ablations of C:** no semantic normalization; no ticket matching; no ACL order analysis.
* **Held-out split:** devices are split 50/50 (stratified by scenario). Tunable parameters (high-priority threshold ∈ {50…95}, ticket grace ∈ {0,15,30,60} min) are selected on the **tune** split and reported on the **test** split alongside the shipped defaults (80, 30).
* **Targets (declared before measuring):** device-level precision ≥ 0.90, recall ≥ 0.90, FPR ≤ 0.05; high-priority recall ≥ 0.95; evidence completeness 100 %; p95 latency ≤ 250 ms per snapshot.
* **Reproducibility:** `python evaluation/generate_corpus.py && python evaluation/run_eval.py`; fixed seed; no network or Docker needed.
