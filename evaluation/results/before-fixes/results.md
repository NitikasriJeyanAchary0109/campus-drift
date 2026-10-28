# Evaluation results: `before-fixes`

Corpus: **100 devices** (96 counted for detection; 49 need action), 40 scenarios, strata {'core': 80, 'realism': 16, 'adversarial': 4}, 25 change tickets, seed 20261027. Definitions: `docs/labels-and-thresholds.md`.

## 1. Systems compared (device level)

Alert on a device that needs action (≥ 1 unauthorized semantic drift). 95 % Wilson intervals in brackets.

| System | TP | FP | FN | TN | Precision | Recall | F1 | FPR |
|---|---:|---:|---:|---:|---|---|---|---|
| A. Naive text diff (diff -u vs last-known-good) | 49 | 32 | 0 | 15 | 0.605 [0.50, 0.70] | 1.000 [0.93, 1.00] | 0.754 | 0.681 [0.54, 0.80] |
| B. Normalized full-tree diff (no rules/tickets) | 46 | 24 | 3 | 23 | 0.657 [0.54, 0.76] | 0.939 [0.83, 0.98] | 0.773 | 0.511 [0.37, 0.65] |
| C. Full pipeline | 47 | 12 | 2 | 35 | 0.797 [0.68, 0.88] | 0.959 [0.86, 0.99] | 0.870 | 0.255 [0.15, 0.40] |
| C-1. no semantic normalization | 47 | 12 | 2 | 35 | 0.797 [0.68, 0.88] | 0.959 [0.86, 0.99] | 0.870 | 0.255 [0.15, 0.40] |
| C-2. no ticket matching | 47 | 24 | 2 | 23 | 0.662 [0.55, 0.76] | 0.959 [0.86, 0.99] | 0.783 | 0.511 [0.37, 0.65] |
| C-3. no ACL order analysis | 45 | 12 | 4 | 35 | 0.789 [0.67, 0.88] | 0.918 [0.81, 0.97] | 0.849 | 0.255 [0.15, 0.40] |

## 2. Finding level (device × rule path)

| System | TP | FP | FN | Precision | Recall | F1 | Authorization accuracy |
|---|---:|---:|---:|---|---|---|---|
| C. Full pipeline | 65 | 34 | 3 | 0.657 | 0.956 | 0.778 | 1.000 (65/65) |
| C-1. no semantic normalization | 65 | 36 | 3 | 0.644 | 0.956 | 0.769 | 1.000 (65/65) |
| C-2. no ticket matching | 65 | 34 | 3 | 0.657 | 0.956 | 0.778 | 0.739 (48/65) |
| C-3. no ACL order analysis | 62 | 34 | 6 | 0.646 | 0.912 | 0.756 | 1.000 (62/62) |

## 3. Targets (declared before measuring)

| Metric | Measured | Target | Met |
|---|---|---|---|
| device_precision | 0.797 | 0.9 | **NO** |
| device_recall | 0.959 | 0.9 | yes |
| device_fpr | 0.255 | 0.05 | **NO** |
| hp_recall | 0.844 | 0.95 | **NO** |
| evidence_completeness | 0.000 | 1.0 | **NO** |
| latency_p95_ms | 8.361 | 250.0 | yes |

## 4. Label (tier) accuracy: 0.780 [0.69, 0.85] over 100 devices

Rows = ground truth, columns = system.

| truth \ system | COMPLIANT | AUTHORIZED | LOW | MEDIUM | HIGH | CRITICAL | PARSE_ERROR |
|---|---:|---:|---:|---:|---:|---:|---:|
| COMPLIANT | 23 | 0 | 0 | 0 | 4 | 0 | 7 |
| AUTHORIZED | 0 | 12 | 0 | 0 | 1 | 0 | 0 |
| LOW | 0 | 0 | 11 | 0 | 2 | 0 | 0 |
| MEDIUM | 0 | 0 | 2 | 2 | 0 | 0 | 0 |
| HIGH | 0 | 0 | 0 | 3 | 9 | 0 | 0 |
| CRITICAL | 2 | 0 | 0 | 0 | 1 | 17 | 0 |
| PARSE_ERROR | 0 | 0 | 0 | 0 | 0 | 0 | 4 |

## 5. High-priority outputs (score ≥ 80)

* Precision 0.794, recall 0.844, F1 0.818 (TP 27, FP 7, FN 5)
* Evidence completeness: 0/34 = 0.000; missing fields: {'source_line': 68, 'source_line_number': 68}

## 6. Parse errors

* Corrupted configs caught as PARSE_ERROR: 4/4
* **Valid** configs wrongly rejected (false alarms): 7

## 7. Latency per snapshot (ms, in-memory SQLite)

| Stage | mean | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|
| normalize only | 0.24 | 0.26 | 0.27 | 0.28 | 0.29 |
| normalize + persist + drift + score | 5.98 | 6.11 | 8.36 | 9.03 | 13.35 |

## 8. Breakdown of the full pipeline

| Slice | devices | device P | device R | FPR | finding P | finding R |
|---|---:|---|---|---|---|---|
| Classroom | 19 | 0.800 | 0.889 | 0.200 | 1.000 | 0.938 |
| Hostel | 19 | 0.909 | 1.000 | 0.111 | 1.000 | 1.000 |
| Office | 20 | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |
| Lab | 19 | 0.632 | 1.000 | 1.000 | 0.277 | 0.929 |
| PublicEvent | 19 | 0.818 | 0.900 | 0.222 | 1.000 | 0.923 |
| core | 80 | 0.894 | 1.000 | 0.132 | 0.670 | 1.000 |
| realism | 16 | 0.417 | 0.714 | 0.778 | 0.500 | 0.571 |

## 9. Held-out threshold tuning

Tuned on the **tune** half, reported on the **test** half. High-priority threshold: shipped 80, chosen **60** (tune F1 by value {50: 0.8889, 60: 0.8889, 70: 0.7879, 80: 0.7879, 90: 0.7407, 95: 0.6923}). Ticket grace: shipped 30 min, chosen **30** (tune authorization accuracy by value {0: 0.9706, 15: 0.9706, 30: 1.0, 60: 0.9412}).

| Test split | High-priority F1 | HP recall | Authorization accuracy |
|---|---|---|---|
| shipped defaults | 0.849 | 0.933 | 1.000 (31/31) |
| tuned | 0.849 | 0.933 | 1.000 (31/31) |

## 10. Errors by kind and scenario (full pipeline)

| Kind | Total | By scenario |
|---|---:|---|
| FALSE_PARSE_ERROR | 7 | r_ntp_prefer×3, r_snmp_location×2, r_banner×2 |
| FN | 3 | r_vty_split_telnet×3 |
| FP | 34 | clean×6, d_trunk_leak×2, cos_vlan_notation×2, d_vty_telnet_only×2, t_portsec_prefix_scope×2, d_portsec_explicit_no×2, d_portsec_removed×2, t_multi_partial×2, t_other_device×2, d_acl_overlap_swap×2, r_vty_split_telnet×2, d_access_vlan_mgmt×2, r_ntp_extra_server×2, t_hard_telnet×2, d_vty_transport_all×2 |
| TIER_MISMATCH | 15 | r_vty_split_telnet×3, clean×3, d_acl_overlap_swap×1, d_acl_entry_removed×1, d_trunk_leak×1, cos_vlan_notation×1, t_portsec_prefix_scope×1, t_other_device×1, r_ntp_extra_server×1, d_access_vlan_mgmt×1, t_wrong_scope×1 |

Full list with details: `errors.json`.
