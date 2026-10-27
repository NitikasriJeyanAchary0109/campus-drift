# Evaluation results: `challenge-after-fixes`

Corpus: **70 devices** (66 counted for detection; 21 need action), 17 scenarios, strata {'challenge': 60, 'core': 10}, 12 change tickets, seed 7. Definitions: `docs/labels-and-thresholds.md`.

## 1. Systems compared (device level)

Alert on a device that needs action (≥ 1 unauthorized semantic drift). 95 % Wilson intervals in brackets.

| System | TP | FP | FN | TN | Precision | Recall | F1 | FPR |
|---|---:|---:|---:|---:|---|---|---|---|
| A. Naive text diff (diff -u vs last-known-good) | 21 | 35 | 0 | 10 | 0.375 [0.26, 0.51] | 1.000 [0.85, 1.00] | 0.545 | 0.778 [0.64, 0.87] |
| B. Normalized full-tree diff (no rules/tickets) | 21 | 12 | 0 | 33 | 0.636 [0.47, 0.78] | 1.000 [0.85, 1.00] | 0.778 | 0.267 [0.16, 0.41] |
| C. Full pipeline | 21 | 0 | 0 | 45 | 1.000 [0.85, 1.00] | 1.000 [0.85, 1.00] | 1.000 | 0.000 [0.00, 0.08] |
| C-1. no semantic normalization | 21 | 0 | 0 | 45 | 1.000 [0.85, 1.00] | 1.000 [0.85, 1.00] | 1.000 | 0.000 [0.00, 0.08] |
| C-2. no ticket matching | 21 | 8 | 0 | 37 | 0.724 [0.54, 0.85] | 1.000 [0.85, 1.00] | 0.840 | 0.178 [0.09, 0.31] |
| C-3. no ACL order analysis | 21 | 0 | 0 | 45 | 1.000 [0.85, 1.00] | 1.000 [0.85, 1.00] | 1.000 | 0.000 [0.00, 0.08] |

## 2. Finding level (device × rule path)

| System | TP | FP | FN | Precision | Recall | F1 | Authorization accuracy |
|---|---:|---:|---:|---|---|---|---|
| C. Full pipeline | 37 | 0 | 0 | 1.000 | 1.000 | 1.000 | 1.000 (37/37) |
| C-1. no semantic normalization | 37 | 0 | 0 | 1.000 | 1.000 | 1.000 | 1.000 (37/37) |
| C-2. no ticket matching | 37 | 0 | 0 | 1.000 | 1.000 | 1.000 | 0.784 (29/37) |
| C-3. no ACL order analysis | 37 | 0 | 0 | 1.000 | 1.000 | 1.000 | 1.000 (37/37) |

## 3. Targets (declared before measuring)

| Metric | Measured | Target | Met |
|---|---|---|---|
| device_precision | 1.000 | 0.9 | yes |
| device_recall | 1.000 | 0.9 | yes |
| device_fpr | 0.000 | 0.05 | yes |
| hp_recall | 1.000 | 0.95 | yes |
| evidence_completeness | 1.000 | 1.0 | yes |
| latency_p95_ms | 7.444 | 250.0 | yes |

## 4. Label (tier) accuracy: 0.971 [0.90, 0.99] over 70 devices

Rows = ground truth, columns = system.

| truth \ system | COMPLIANT | AUTHORIZED | LOW | MEDIUM | HIGH | CRITICAL | PARSE_ERROR |
|---|---:|---:|---:|---:|---:|---:|---:|
| COMPLIANT | 37 | 0 | 0 | 0 | 0 | 0 | 0 |
| AUTHORIZED | 0 | 8 | 0 | 0 | 0 | 0 | 0 |
| LOW | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| MEDIUM | 0 | 0 | 0 | 1 | 2 | 0 | 0 |
| HIGH | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| CRITICAL | 0 | 0 | 0 | 0 | 0 | 16 | 0 |
| PARSE_ERROR | 0 | 0 | 0 | 0 | 0 | 0 | 4 |

## 5. High-priority outputs (score ≥ 80)

* Precision 0.895, recall 1.000, F1 0.944 (TP 17, FP 2, FN 0)
* Evidence completeness: 19/19 = 1.000; missing fields: none

## 6. Parse errors

* Corrupted configs caught as PARSE_ERROR: 4/4
* **Valid** configs wrongly rejected (false alarms): 0

## 7. Latency per snapshot (ms, in-memory SQLite)

| Stage | mean | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|
| normalize only | 0.26 | 0.27 | 0.29 | 0.30 | 0.31 |
| normalize + persist + drift + score | 5.50 | 5.02 | 7.44 | 10.51 | 15.71 |

## 8. Breakdown of the full pipeline

| Slice | devices | device P | device R | FPR | finding P | finding R |
|---|---:|---|---|---|---|---|
| Classroom | 13 | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |
| Hostel | 13 | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |
| Office | 13 | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |
| Lab | 14 | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |
| PublicEvent | 13 | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |
| challenge | 56 | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |
| core | 10 | n/a | n/a | 0.000 | n/a | n/a |

## 9. Held-out threshold tuning (2-fold)

Each fold fits the high-priority threshold and ticket grace on one half and reports on the other half (then the halves swap). Ties are resolved toward the shipped default.

| Fit on → report on | HP threshold (shipped 80) | Grace min (shipped 30) | held-out HP F1: shipped / tuned | held-out HP recall: shipped / tuned | held-out authorization: shipped / tuned |
|---|---|---|---|---|---|
| tune → test | **80** | **30** | 0.941 / 0.941 | 1.000 / 1.000 | 1.000 / 1.000 |
| test → tune | **90** | **30** | 0.947 / 0.941 | 1.000 / 0.889 | 1.000 / 1.000 |

High-priority F1 by threshold over *all* devices: {50: 0.9189, 60: 0.9189, 70: 0.9444, 80: 0.9444, 90: 0.9697, 95: 0.9697}

## 10. Errors by kind and scenario (full pipeline)

| Kind | Total | By scenario |
|---|---:|---|
| TIER_MISMATCH | 2 | c_access_vlan_other×2 |

Full list with details: `errors.json`.
