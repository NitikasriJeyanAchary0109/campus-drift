# Evaluation & Testing Report
## Network Configuration-Drift Detector with Approved-Baseline Remediation

### 1. Overview & Milestone Scope
This report documents the architectural improvements, algorithmic enhancements, and empirical verification results following Project Review #2. The platform continuously monitors campus network infrastructure across academic departments, student hostels, administrative offices, and laboratory networks, detecting configuration drift and executing verified remediations under a strict four-eyes gate.

---

### 2. Phase 9 Review #2 Enhancements

#### 2.1 Asynchronous Worker Queue Migration (ADR-003: APScheduler to Celery + Redis)
- **Problem Statement:** In previous milestones, Netmiko SSH socket I/O executed in-process. Under multi-device polling sweeps across campus subnets, blocking SSH operations risked starving FastAPI's ASGI event loop and delaying HTTP request handling.
- **Solution:** Replaced in-process scheduler with Celery and Redis. The `POST /api/devices/{id}/poll` endpoint performs RBAC authorization and immediately dispatches `poll_device_task.delay(device_id)`, returning `202 Accepted` with a tracking `task_id`.
- **Periodic Sweeps:** Offloaded to Celery Beat schedule configured via `CELERY_BEAT_SCHEDULE` (15-minute polling interval).
- **Verification:** Verified via `test_celery_polling.py` (3 tests) and preserved existing inline `test_poll_device_endpoint` asserting RBAC gate prior to dispatch.

#### 2.2 Semantic ACL Sequence Ordering & Overlap Analysis
- **Problem Statement:** Naive set comparison flags harmless rule reorderings as drift, while naive index diffing fails to recognize that swapping disjoint rules does not alter packet filtering semantics.
- **Solution:** Implemented `ACLRule` and `analyze_acl_permutation` using Python's `ipaddress` module:
  - Parses standard and extended Cisco ACL rules into action, protocol, source network, and destination network.
  - Computes pairwise IP subnet overlap (`rules_overlap`).
  - Swapping mutually disjoint rules (e.g., `10.10.1.0/24` and `10.10.2.0/24`) is classified as benign cosmetic reordering (`is_drift=False`, status `COMPLIANT`).
  - Swapping overlapping rules with conflicting actions (e.g., swapping specific `permit 10.10.1.0/24` with broader `deny 10.10.0.0/16`) is classified as `ACL_ORDER_SIGNIFICANT`.
  - Enforced a minimum severity floor of 80 in the Risk Engine so `ACL_ORDER_SIGNIFICANT` is never masked as compliant or low risk.
- **Verification:** Verified with an adversarial 3+ entry fixture (`test_acl_adversarial_fixture_middle_entry_swap`), cosmetic disjoint reordering tests, and end-to-end database pipeline assertions (`test_acl_sequence_ordering.py`, 5 tests).

#### 2.3 External ITSM Webhook Receiver (`POST /api/tickets/webhook`)
- **Problem Statement:** Campus network operators manage changes through ServiceNow or Jira. Ingesting tickets manually delays drift reconciliation.
- **Solution:** Implemented inbound webhook endpoint with production-grade security:
  - **HMAC-SHA256 Authentication:** Verified via `X-ITSM-Signature` or `X-Hub-Signature-256` using constant-time comparison (`hmac.compare_digest`).
  - **Payload Normalization:** Accepts `external_ref`, `source`, `hostname`/`ip_address`, `key_path_scope`, `valid_from`, and `valid_to`.
  - **Automatic Device Resolution:** Resolves target device and group directly from hostname or IP.
  - **Idempotent Delivery:** Lookups by `(external_ref, source)` guarantee that webhook re-deliveries update existing ticket windows rather than creating duplicate records.
  - **Automated Authorization:** Webhook-created tickets actively reconcile matching diffs during `detect_drift`, properly classifying deviations as `Drift-Authorized` (score band 1–30).
- **Database Schema:** Added `source` (VARCHAR 32) and `external_ref` (VARCHAR 64) columns to `change_tickets` via Alembic migration `a12b34c56d78`.
- **Verification:** Verified via `test_itsm_webhook.py` (5 tests).

#### 2.4 OpenConfig / gNMI Streaming Telemetry Roadmap & Stub Vendor
- **Problem Statement:** Reviewer recommendation to evaluate vendor-agnostic streaming telemetry without destabilizing the current functional delivery.
- **Solution:** Documented an architectural roadmap in §21 of `docs/architecture.md` and `architecture.md` comparing periodic SSH scraping against push-based gNMI `ON_CHANGE` subscriptions using OpenConfig YANG models (`openconfig-interfaces.yang`, `openconfig-acl.yang`).
- **Stub Vendor Implementation:** Added `"openconfig_stub"` vendor identifier in normalization and collection services. Polling requests trigger `501 Not Implemented` with actionable links to the roadmap.
- **Verification:** Verified via `test_openconfig_stub.py` (3 tests).

---

### 3. Empirical Test Suite Summary

The entire automated test suite was executed against PostgreSQL and Redis backing services:
- **Baseline Test Suite (Phase 8):** 102 passing tests
- **Phase 9 New Tests Added:** 16 tests
  - Celery Polling Task Integration: 3 tests
  - ACL Sequence Ordering & Overlap Analysis: 5 tests
  - ITSM Webhook Receiver & Idempotency: 5 tests
  - OpenConfig / gNMI Roadmap Stub: 3 tests
- **Total Tests:** **118 / 118 PASSING (100% pass rate, 0 regressions)**
- **Total Execution Time:** 73.67 seconds

```
================== 118 passed, 3 warnings in 73.67s (0:01:13) ==================
```

---

### 4. Edge Cases & Failure Scenarios Tested
1. **Unsigned or Tampered Webhooks:** Rejection with HTTP 401 Unauthorized (`Missing HMAC signature` / `Invalid HMAC signature`).
2. **Adversarial ACL Permutations:** Middle-entry swap in 4-line ACL accurately detected through subnet intersection without false negatives or naive string position errors.
3. **Task RBAC Gate:** Unauthorized users rejected with HTTP 403 Forbidden before Celery task dispatch occurs.
4. **Device Unreachable / Flaky Session:** Clean `UNREACHABLE` marking, exponential backoff, and audit log generation without worker thread death.
5. **Rollback on Verification Failure:** Three-state rollback pipeline successfully reverts devices to pre-change snapshot state if post-remediation verification diff is non-empty.

---

### 5. Ethics & Security Controls
- **HMAC Signatures:** Cryptographic integrity for external change approvals.
- **RBAC Server-Side Enforcement:** Admin / NetworkEngineer / Viewer roles enforced via FastAPI dependencies.
- **Command Injection Prevention:** Strict Jinja2 template parameterization; shell metacharacters strictly rejected with HTTP 422.
- **Credential Protection:** AES-256 Fernet encryption at rest for all device credentials stored in the Vault.
