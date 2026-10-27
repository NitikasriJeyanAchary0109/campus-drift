# Evaluation results: `challenge-first-run`

Corpus: **70 devices** (66 counted for detection; 21 need action), 17 scenarios, strata {'core': 10, 'realism': 0, 'adversarial': 0}, 12 change tickets, seed 7. Definitions: `docs/labels-and-thresholds.md`.

## 1. Systems compared (device level)

Alert on a device that needs action (≥ 1 unauthorized semantic drift). 95 % Wilson intervals in brackets.

| System | TP | FP | FN | TN | Precision | Recall | F1 | FPR |
|---|---:|---:|---:|---:|---|---|---|---|
| A. Naive text diff (diff -u vs last-known-good) | 21 | 35 | 0 | 10 | 0.375 [0.26, 0.51] | 1.000 [0.85, 1.00] | 0.545 | 0.778 [0.64, 0.87] |
| B. Normalized full-tree diff (no rules/tickets) | 21 | 19 | 0 | 26 | 0.525 [0.38, 0.67] | 1.000 [0.85, 1.00] | 0.689 | 0.422 [0.29, 0.57] |
| C. Full pipeline | 21 | 7 | 0 | 38 | 0.750 [0.57, 0.87] | 1.000 [0.85, 1.00] | 0.857 | 0.156 [0.08, 0.29] |
| C-1. no semantic normalization | 21 | 7 | 0 | 38 | 0.750 [0.57, 0.87] | 1.000 [0.85, 1.00] | 0.857 | 0.156 [0.08, 0.29] |
| C-2. no ticket matching | 21 | 15 | 0 | 30 | 0.583 [0.42, 0.73] | 1.000 [0.85, 1.00] | 0.737 | 0.333 [0.21, 0.48] |
| C-3. no ACL order analysis | 21 | 7 | 0 | 38 | 0.750 [0.57, 0.87] | 1.000 [0.85, 1.00] | 0.857 | 0.156 [0.08, 0.29] |

## 2. Finding level (device × rule path)

| System | TP | FP | FN | Precision | Recall | F1 | Authorization accuracy |
|---|---:|---:|---:|---|---|---|---|
| C. Full pipeline | 37 | 3 | 0 | 0.925 | 1.000 | 0.961 | 1.000 (37/37) |
| C-1. no semantic normalization | 37 | 3 | 0 | 0.925 | 1.000 | 0.961 | 1.000 (37/37) |
| C-2. no ticket matching | 37 | 3 | 0 | 0.925 | 1.000 | 0.961 | 0.784 (29/37) |
| C-3. no ACL order analysis | 37 | 3 | 0 | 0.925 | 1.000 | 0.961 | 1.000 (37/37) |

## 3. Targets (declared before measuring)

| Metric | Measured | Target | Met |
|---|---|---|---|
| device_precision | 0.750 | 0.9 | **NO** |
| device_recall | 1.000 | 0.9 | yes |
| device_fpr | 0.156 | 0.05 | **NO** |
| hp_recall | 1.000 | 0.95 | yes |
| evidence_completeness | 1.000 | 1.0 | yes |
| latency_p95_ms | 7.743 | 250.0 | yes |

## 4. Label (tier) accuracy: 0.871 [0.77, 0.93] over 70 devices

Rows = ground truth, columns = system.

| truth \ system | COMPLIANT | AUTHORIZED | LOW | MEDIUM | HIGH | CRITICAL | PARSE_ERROR |
|---|---:|---:|---:|---:|---:|---:|---:|
| COMPLIANT | 30 | 0 | 0 | 1 | 2 | 0 | 4 |
| AUTHORIZED | 0 | 8 | 0 | 0 | 0 | 0 | 0 |
| LOW | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| MEDIUM | 0 | 0 | 0 | 1 | 2 | 0 | 0 |
| HIGH | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| CRITICAL | 0 | 0 | 0 | 0 | 0 | 16 | 0 |
| PARSE_ERROR | 0 | 0 | 0 | 0 | 0 | 0 | 4 |

## 5. High-priority outputs (score ≥ 80)

* Precision 0.809, recall 1.000, F1 0.895 (TP 17, FP 4, FN 0)
* Evidence completeness: 21/21 = 1.000; missing fields: none

## 6. Parse errors

* Corrupted configs caught as PARSE_ERROR: 4/4
* **Valid** configs wrongly rejected (false alarms): 4

## 7. Latency per snapshot (ms, in-memory SQLite)

| Stage | mean | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|
| normalize only | 0.25 | 0.26 | 0.29 | 0.30 | 0.31 |
| normalize + persist + drift + score | 5.36 | 4.93 | 7.74 | 10.40 | 15.49 |

## 8. Breakdown of the full pipeline

| Slice | devices | device P | device R | FPR | finding P | finding R |
|---|---:|---|---|---|---|---|
| Classroom | 13 | 0.833 | 1.000 | 0.125 | 1.000 | 1.000 |
| Hostel | 13 | 0.600 | 1.000 | 0.200 | 0.875 | 1.000 |
| Office | 13 | 0.833 | 1.000 | 0.125 | 0.889 | 1.000 |
| Lab | 14 | 0.600 | 1.000 | 0.182 | 0.833 | 1.000 |
| PublicEvent | 13 | 0.833 | 1.000 | 0.125 | 1.000 | 1.000 |
| core | 10 | n/a | n/a | 0.000 | n/a | n/a |
| realism | 0 | n/a | n/a | n/a | n/a | n/a |

## 9. Held-out threshold tuning

Tuned on the **tune** half, reported on the **test** half. High-priority threshold: shipped 80, chosen **95** (tune F1 by value {50: 0.9, 60: 0.9, 70: 0.9, 80: 0.9, 90: 0.8889, 95: 0.9412}). Ticket grace: shipped 30 min, chosen **30** (tune authorization accuracy by value {0: 1.0, 15: 1.0, 30: 1.0, 60: 1.0}).

| Test split | High-priority F1 | HP recall | Authorization accuracy |
|---|---|---|---|
| shipped defaults | 0.889 | 1.000 | 1.000 (18/18) |
| tuned | 1.000 | 1.000 | 1.000 (18/18) |

## 10. Errors by kind and scenario (full pipeline)

| Kind | Total | By scenario |
|---|---:|---|
| FALSE_PARSE_ERROR | 4 | c_nonascii_location×4 |
| FP | 3 | c_acl_remark×3 |
| TIER_MISMATCH | 5 | c_acl_remark×3, c_access_vlan_other×2 |

Full list with details: `errors.json`.
