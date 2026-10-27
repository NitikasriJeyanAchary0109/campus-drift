# Evaluation results: `after-fixes`

Corpus: **100 devices** (96 counted for detection; 49 need action), 40 scenarios, strata {'adversarial': 4, 'core': 80, 'realism': 16}, 25 change tickets, seed 20261027. Definitions: `docs/labels-and-thresholds.md`.

## 1. Systems compared (device level)

Alert on a device that needs action (≥ 1 unauthorized semantic drift). 95 % Wilson intervals in brackets.

| System | TP | FP | FN | TN | Precision | Recall | F1 | FPR |
|---|---:|---:|---:|---:|---|---|---|---|
| A. Naive text diff (diff -u vs last-known-good) | 49 | 32 | 0 | 15 | 0.605 [0.50, 0.70] | 1.000 [0.93, 1.00] | 0.754 | 0.681 [0.54, 0.80] |
| B. Normalized full-tree diff (no rules/tickets) | 49 | 17 | 0 | 30 | 0.742 [0.63, 0.83] | 1.000 [0.93, 1.00] | 0.852 | 0.362 [0.24, 0.50] |
| C. Full pipeline | 49 | 0 | 0 | 47 | 1.000 [0.93, 1.00] | 1.000 [0.93, 1.00] | 1.000 | 0.000 [0.00, 0.08] |
| C-1. no semantic normalization | 49 | 1 | 0 | 46 | 0.980 [0.90, 1.00] | 1.000 [0.93, 1.00] | 0.990 | 0.021 [0.00, 0.11] |
| C-2. no ticket matching | 49 | 13 | 0 | 34 | 0.790 [0.67, 0.87] | 1.000 [0.93, 1.00] | 0.883 | 0.277 [0.17, 0.42] |
| C-3. no ACL order analysis | 46 | 0 | 3 | 47 | 1.000 [0.92, 1.00] | 0.939 [0.83, 0.98] | 0.968 | 0.000 [0.00, 0.08] |

## 2. Finding level (device × rule path)

| System | TP | FP | FN | Precision | Recall | F1 | Authorization accuracy |
|---|---:|---:|---:|---|---|---|---|
| C. Full pipeline | 68 | 0 | 0 | 1.000 | 1.000 | 1.000 | 1.000 (68/68) |
| C-1. no semantic normalization | 68 | 2 | 0 | 0.971 | 1.000 | 0.986 | 1.000 (68/68) |
| C-2. no ticket matching | 68 | 0 | 0 | 1.000 | 1.000 | 1.000 | 0.750 (51/68) |
| C-3. no ACL order analysis | 65 | 0 | 3 | 1.000 | 0.956 | 0.977 | 1.000 (65/65) |

## 3. Targets (declared before measuring)

| Metric | Measured | Target | Met |
|---|---|---|---|
| device_precision | 1.000 | 0.9 | yes |
| device_recall | 1.000 | 0.9 | yes |
| device_fpr | 0.000 | 0.05 | yes |
| hp_recall | 0.906 | 0.95 | **NO** |
| evidence_completeness | 1.000 | 1.0 | yes |
| latency_p95_ms | 8.416 | 250.0 | yes |

## 4. Label (tier) accuracy: 0.950 [0.89, 0.98] over 100 devices

Rows = ground truth, columns = system.

| truth \ system | COMPLIANT | AUTHORIZED | LOW | MEDIUM | HIGH | CRITICAL | PARSE_ERROR |
|---|---:|---:|---:|---:|---:|---:|---:|
| COMPLIANT | 34 | 0 | 0 | 0 | 0 | 0 | 0 |
| AUTHORIZED | 0 | 13 | 0 | 0 | 0 | 0 | 0 |
| LOW | 0 | 0 | 13 | 0 | 0 | 0 | 0 |
| MEDIUM | 0 | 0 | 2 | 2 | 0 | 0 | 0 |
| HIGH | 0 | 0 | 0 | 3 | 9 | 0 | 0 |
| CRITICAL | 0 | 0 | 0 | 0 | 0 | 20 | 0 |
| PARSE_ERROR | 0 | 0 | 0 | 0 | 0 | 0 | 4 |

## 5. High-priority outputs (score ≥ 80)

* Precision 1.000, recall 0.906, F1 0.951 (TP 29, FP 0, FN 3)
* Evidence completeness: 29/29 = 1.000; missing fields: none

## 6. Parse errors

* Corrupted configs caught as PARSE_ERROR: 4/4
* **Valid** configs wrongly rejected (false alarms): 0

## 7. Latency per snapshot (ms, in-memory SQLite)

| Stage | mean | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|
| normalize only | 0.26 | 0.27 | 0.28 | 0.29 | 0.39 |
| normalize + persist + drift + score | 6.24 | 6.28 | 8.42 | 13.13 | 14.64 |

## 8. Breakdown of the full pipeline

| Slice | devices | device P | device R | FPR | finding P | finding R |
|---|---:|---|---|---|---|---|
| Classroom | 19 | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |
| Hostel | 19 | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |
| Office | 20 | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |
| Lab | 19 | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |
| PublicEvent | 19 | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |
| core | 80 | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |
| realism | 16 | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |

## 9. Held-out threshold tuning (2-fold)

Each fold fits the high-priority threshold and ticket grace on one half and reports on the other half (then the halves swap). Ties are resolved toward the shipped default.

| Fit on → report on | HP threshold (shipped 80) | Grace min (shipped 30) | held-out HP F1: shipped / tuned | held-out HP recall: shipped / tuned | held-out authorization: shipped / tuned |
|---|---|---|---|---|---|
| tune → test | **60** | **30** | 1.000 / 1.000 | 1.000 / 1.000 | 1.000 / 1.000 |
| test → tune | **80** | **30** | 0.903 / 0.903 | 0.824 / 0.824 | 1.000 / 1.000 |

High-priority F1 by threshold over *all* devices: {50: 0.9697, 60: 1.0, 70: 0.9508, 80: 0.9508, 90: 0.8571, 95: 0.7692}

## 10. Errors by kind and scenario (full pipeline)

| Kind | Total | By scenario |
|---|---:|---|
| TIER_MISMATCH | 5 | d_acl_overlap_swap×1, d_acl_entry_removed×1, d_trunk_leak×1, d_access_vlan_mgmt×1, t_wrong_scope×1 |

Full list with details: `errors.json`.
