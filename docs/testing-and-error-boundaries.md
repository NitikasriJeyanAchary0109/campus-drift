# Granular Technical Documentation: Unit Testing Architecture & Error Boundaries

This document provides comprehensive technical specifications for the unit testing architecture, test isolation guarantees, and error boundary mechanisms implemented across the **Campus Network Configuration-Drift Detector**.

---

## 1. Unit Testing Architecture & Isolation Guarantee

The test suite contains **297 automated backend tests** (267 unit tests and 30 integration tests) achieving 100% test passing rates across all modules.

```
Total Test Suite: 297 Tests
├── Unit Tests (Offline Pure): 267 Tests (100% Pass Rate in ~25s)
│   ├── Tree-Diff & Semantic Parsing: 56 tests
│   ├── Failure Injection & Rollback Safety: 50 tests
│   ├── RBAC, Four-Eyes & Security: 24 tests
│   ├── ITSM Webhooks & Ticket Matching: 26 tests
│   ├── Legacy Upload & Shadow Mode: 23 tests
│   ├── Device Inventory & Credentials: 16 tests
│   ├── Evaluation Corpus & Validation: 26 tests
│   ├── Startup Configuration Guard (production secrets): 12 tests
│   ├── FRR vtysh Parser: 17 tests
│   └── API Routers & Dashboard: 16 tests
└── Integration Tests (Stateful Stack): 30 Tests
    ├── Celery Worker Async Dispatch: 6 tests
    ├── SSH Simulated Device Interaction: 7 tests
    ├── Concurrent Advisory Locking: 5 tests
    ├── End-to-End Drift Lifecycle: 6 tests
    └── End-to-End Remediation & Rollback: 6 tests
```

### 1.1 In-Memory SQLite Isolation Fixture (`backend/tests/unit/conftest.py`)

To ensure that the 267 unit tests run with complete determinism, zero reliance on external network/PostgreSQL services, and sub-30-second execution, the unit test suite employs a dedicated in-memory SQLite fixture with isolated connection pooling:

```python
# backend/tests/unit/conftest.py
@pytest.fixture(scope="session")
def engine():
    # SQLite in-memory engine with StaticPool to share connection across calls
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    
    # Enforce SQLite foreign key integrity constraints
    @event.listens_for(eng, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=eng)
    return eng
```

#### Key Isolation Mechanisms:
1. **Zero External DB Dependency:** Tests execute without Postgres running on port 5432/5433.
2. **Celery Eager Execution (`CELERY_TASK_ALWAYS_EAGER=True`):** In unit testing mode, Celery tasks execute synchronously within the test process using an in-memory transport (`broker_url="memory://"`, `result_backend="rpc://"`), preventing Redis network timeouts.
3. **Database Transaction Rollback:** Each test function runs within an isolated nested transaction (`db.begin_nested()`) that rolls back upon test completion, preventing state pollution.
4. **Mocked Hardware Transports (`FakeNetmikoSSHClient`):** Network device SSH connections are intercepted with scripted device stubs (`backend/tests/fakes.py`) that simulate Cisco IOS and FRR terminal sessions without physical hardware.

---

### 1.2 Comprehensive Unit Test Inventory (267 Tests across 28 Suites)

| Test Module | Test Count | Scope & Invariants Pinned |
| :--- | :---: | :--- |
| `test_acl_sequence_ordering.py` | 5 | Subnet overlap calculation, permutation severity floor, shadowing vs disjoint reordering. |
| `test_alerts_api.py` | 4 | Alert querying, severity filtering, atomic acknowledgment endpoints. |
| `test_audit_api.py` | 3 | Immutable audit log querying, filtering by action/target, JSON diff capture. |
| `test_auth_api.py` | 5 | Bcrypt hashing, JWT issuance, refresh token rotation, httpOnly cookie verification. |
| `test_baseline_mining.py` | 6 | Automatic golden baseline rule induction from legacy switch configurations. |
| `test_baselines_api.py` | 6 | Declarative YAML/JSON baseline upload, rule validation, atomic activation. |
| `test_config_security.py` | 12 | Production startup guard: rejects default or short `SECRET_KEY`, missing or equal `VAULT_KEY`, default webhook secret and `DEBUG`; vault key separation. |
| `test_dashboard_api.py` | 5 | Compliance gauge computation, 14-day trendline aggregation, device counts. |
| `test_devices_api.py` | 9 | Device registration, Fernet (AES-128-CBC + HMAC-SHA256) credential encryption, RBAC authorization boundaries. |
| `test_drift_engine.py` | 14 | Tree-diff evaluation, CIDR canonicalization, whitespace invariance, zone weights. |
| `test_evaluation_harness.py` | 14 | Precision/Recall/F1 metrics on the 100-device corpus, ablation studies, baseline comparisons. |
| `test_failure_collection.py` | 11 | Netmiko timeout handling, auth failure marking device `UNREACHABLE`, socket drops. |
| `test_failure_matrix.py` | 1 | Parametrized runner validating all 11 injected fault classes against recorded telemetry. |
| `test_failure_remediation.py` | 22 | 12 automated rollback edge cases, empty config rejection, corrupted post-apply states. |
| `test_failure_tickets_and_time.py` | 17 | Webhook HMAC rejection, timestamp skew, midnight boundary and timezone transitions. |
| `test_four_eyes.py` | 8 | Dual-control gate: author cannot approve plan (`HTTP 403`), admin peer sign-off. |
| `test_frr_parser.py` | 17 | FRRouting `vtysh` syntax (CIDR addresses, `exit` blocks, prefix-list `seq` order, BGP address-families), vendor dispatch, malformed input rejected. |
| `test_health.py` | 3 | Database and cache readiness/liveness probe endpoints. |
| `test_itsm_webhook.py` | 5 | HMAC-SHA256 signature verification, ServiceNow/Jira payload parsing, replay tolerance. |
| `test_legacy_upload.py` | 23 | Manual config upload, shadow mode enforcement, bulk import CLI utilities. |
| `test_normalizer.py` | 8 | Grammar tokenization for Cisco IOS and FRR, interface name standardization. |
| `test_openconfig_stub.py` | 3 | OpenConfig/gNMI schema parser validation and vendor-agnostic data models. |
| `test_parser_hardening.py` | 29 | Syntax fuzzing, truncated configuration handling, unknown vendor error handling. |
| `test_rbac.py` | 6 | Full RBAC permissions matrix (Admin vs Network Engineer vs Viewer). |
| `test_remediation_engine.py` | 10 | Jinja2 template rendering, shell metacharacter rejection regex, pre-change backups. |
| `test_security.py` | 5 | Constant-time HMAC comparison, credential masking in logs, SQL injection immunity. |
| `test_ticket_matching.py` | 4 | Temporal window matching ($\pm30$ min grace period), scope and hostname matching. |
| `test_validation_analysis.py` | 12 | System Usability Scale (SUS) calculations, user task completion metrics. |

---

## 2. Granular Technical Error Boundaries

The application enforces **five distinct architectural error boundaries** that isolate system components, prevent cascade failures, and guarantee data consistency:

```mermaid
flowchart TD
    subgraph Boundary1["1. Network & Protocol Boundary (Netmiko/SSH)"]
        N1["Connection Timeout (10s)"] --> N_ERR["Catch NetmikoBaseException"]
        N2["Auth Failure (Bad Credentials)"] --> N_ERR
        N3["Socket Drop Mid-Session"] --> N_ERR
        N_ERR --> N_ACT["Mark Device UNREACHABLE<br>Raise DEVICE_DOWN Alert<br>Preserve Last Known Drift"]
    end

    subgraph Boundary2["2. Concurrency & Locking Boundary (Postgres Advisory Locks)"]
        C1["Worker A Polling Device X"] --> C_LOCK{"Try Advisory Lock<br>pg_try_advisory_xact_lock"}
        C2["Worker B Polling Device X"] --> C_LOCK
        C_LOCK -->|Acquired| C_EXEC["Execute Poll"]
        C_LOCK -->|Busy| C_SKIP["Return SKIPPED Status (HTTP 409)"]
    end

    subgraph Boundary3["3. Input Validation & Security Boundary"]
        S1["Remediation Plan Input"] --> S_CHK{"Regex Check Metacharacters<br>[;&|$\`\\\"]"}
        S_CHK -->|Violation| S_REJ["Raise SecurityViolationException<br>HTTP 422 Unprocessable"]
        S_CHK -->|Clean| S_JINJA["Render Whitelisted Jinja2 Template"]
        S2["ITSM Webhook Request"] --> S_HMAC{"HMAC-SHA256<br>hmac.compare_digest"}
        S_HMAC -->|Mismatch| S_UNAUTH["HTTP 401 Unauthorized"]
        S_HMAC -->|Valid| S_INGEST["Ingest Change Ticket"]
    end

    subgraph Boundary4["4. Dual-Control Authorization Boundary"]
        A1["Admin / NetEng Approves Plan"] --> A_GATE{"plan.created_by == user.id?"}
        A_GATE -->|Yes (Self-Approval)| A_DENY["HTTP 403 Forbidden<br>Audit FOUR_EYES_VIOLATION"]
        A_GATE -->|No (Peer Approval)| A_ALLOW["Transition to APPROVED<br>Audit PLAN_APPROVED"]
    end

    subgraph Boundary5["5. Remediation & Rollback Safety Boundary"]
        R1["Execute Approved Plan"] --> R_SNAP["Capture Pre-Change Snapshot"]
        R_SNAP --> R_PUSH["Push CLI via Netmiko"]
        R_PUSH --> R_VER["Post-Change Verification Poll"]
        R_VER -->|Pass| R_SUCC["Result: SUCCESS<br>Plan: APPLIED"]
        R_VER -->|Fail / Exception| R_ROLL["Rollback over Fresh Connection<br>Re-apply Pre-Change Snapshot"]
        R_ROLL --> R_REVER{"Re-verify Device State"}
        R_REVER -->|Matches Backup| R_ROLLED["Result: ROLLED_BACK<br>Plan: FAILED<br>Alert: CRITICAL_DRIFT"]
        R_REVER -->|Mismatch| R_FAIL["Result: ROLLBACK_FAILED<br>Alert: CRITICAL_DRIFT (Manual Intervention)"]
    end
```

---

### 2.1 Boundary 1: Network & Protocol Boundary (Netmiko/SSH)

* **Location:** `backend/app/services/collection.py`, `backend/app/services/remediation.py`
* **Threat Model:** Network partition, SSH daemon crash, dropped TCP connection mid-command, or invalid switch credentials during bulk polling sweeps.
* **Guarantees:**
  - Network timeouts are capped at 10 seconds (`conn_timeout=10, auth_timeout=10`).
  - All exceptions inheriting from `NetmikoBaseException` or `socket.error` are caught cleanly at the collection boundary.
  - Device status is transitioned to `UNREACHABLE`, an audit log `POLL_FAILED` is recorded, and a `DEVICE_DOWN` alert is generated.
  - **Critical Invariant:** Existing configuration snapshots and drift events are **never deleted or overwritten** on a collection failure. The system retains the last verified configuration state.

---

### 2.2 Boundary 2: Concurrency & Advisory Lock Boundary

* **Location:** `backend/app/services/locks.py`
* **Threat Model:** Celery worker race conditions where two background workers poll the same switch simultaneously, or where a background poll runs concurrently with an active remediation change.
* **Guarantees:**
  - Employs PostgreSQL transactional advisory locks: `pg_try_advisory_xact_lock(hashtext(device_id))`.
  - If a worker or API thread fails to acquire the device lock immediately:
    - In polling sweeps: the task immediately skips the device and records status `SKIPPED (device busy)`.
    - In remediation application: the API immediately returns `HTTP 409 Conflict` with detail `"Device is currently undergoing a concurrent operation"`.
  - Stale apply claims older than 15 minutes are automatically reclaimed and transitioned to `ABORTED` by a watchdog query.

---

### 2.3 Boundary 3: Input Validation & Security Boundary

* **Location:** `backend/app/services/remediation_templates.py`, `backend/app/api/tickets.py`
* **Threat Model:** Malicious or malformed inputs attempting command injection on network switches, or unauthenticated webhooks spoofing change tickets to silence alarms.
* **Guarantees:**
  1. **Zero User-Supplied CLI Commands:** Network engineers can never supply raw CLI strings. Remediations are synthesized strictly through pre-approved, parameterized Jinja2 templates.
  2. **Strict Metacharacter Rejection:** All parameter values undergo regex validation:
     ```python
     if re.search(r'[;&|$\`\\"]', param_value):
         raise SecurityViolationError(f"Shell metacharacters forbidden in parameter: {param_value}")
     ```
     Violations trigger `HTTP 422 Unprocessable Content` and generate a `SECURITY_VIOLATION` audit log.
  3. **Timing-Safe HMAC Webhook Authentication:** Inbound Jira/ServiceNow webhooks must include an `X-ITSM-Signature` header matching HMAC-SHA256(`raw_body`, `ITSM_WEBHOOK_SECRET`). Comparison uses `hmac.compare_digest` to prevent timing attacks. Missing or invalid signatures yield `HTTP 401 Unauthorized` without reading the payload.

---

### 2.4 Boundary 4: Dual-Control (Four-Eyes) Authorization Boundary

* **Location:** `backend/app/api/approvals.py`, `backend/app/services/four_eyes.py`
* **Threat Model:** Insider threat where a single engineer creates a risky remediation plan and immediately applies it to production infrastructure without oversight.
* **Guarantees:**
  - A remediation plan requires explicit approval (`decision="APPROVED"`) from an authenticated user with `admin` role.
  - **Self-Approval Prohibition:** Even if an Admin authored the remediation plan, they cannot approve their own plan (`plan.created_by == current_user.id`).
  - Attempting self-approval returns `HTTP 403 Forbidden` with detail `"Dual-control violation: plan creator cannot approve their own remediation plan"`.
  - Both approval and rejection events are written to the immutable `audit_logs` table.

---

### 2.5 Boundary 5: Remediation & Rollback Safety Boundary

* **Location:** `backend/app/services/remediation.py`
* **Threat Model:** A remediation command causes a syntax error, partial execution, or unexpected service disruption on a campus switch.
* **Guarantees & Rollback State Machine:**

```
                  ┌────────────────────────────────────────┐
                  │ Pre-Change Snapshot (Stored in Backup) │
                  └──────────────────┬─────────────────────┘
                                     │
                                     ▼
                      ┌────────────────────────────┐
                      │ Push Whitelisted Commands  │
                      └──────────────┬─────────────┘
                                     │
                                     ▼
                      ┌────────────────────────────┐
                      │ Immediate Post-Change Poll │
                      └──────────────┬─────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │ Verified Equal to Target State? │
                    └────────────────┬────────────────┘
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
                 [ YES ]                          [ NO ]
         ┌─────────────────────┐       ┌───────────────────────────────┐
         │ Result: SUCCESS     │       │ Open Fresh SSH Connection     │
         │ Plan Status: APPLIED│       │ Restore Pre-Change Backup     │
         │ (No Alert Raised)   │       └──────────────┬────────────────┘
         └─────────────────────┘                      │
                                                      ▼
                                       ┌───────────────────────────────┐
                                       │ Re-Verify Restored Config     │
                                       └──────────────┬────────────────┘
                                                      │
                                      ┌───────────────┴───────────────┐
                                      ▼                               ▼
                                  [ MATCH ]                       [ MISMATCH ]
                          ┌────────────────────────┐      ┌─────────────────────────┐
                          │ Result: ROLLED_BACK    │      │ Result: ROLLBACK_FAILED │
                          │ Plan Status: FAILED    │      │ Plan: ROLLBACK_FAILED   │
                          │ Alert: CRITICAL_DRIFT  │      │ Alert: CRITICAL_DRIFT   │
                          │ Audit: verified=True   │      │ (Manual Dispatch Req.)  │
                          └────────────────────────┘      └─────────────────────────┘
```

* **Invariant Guarantee:** `ROLLED_BACK` is **only** recorded if the device configuration after restoration is re-read and proven byte-for-byte identical to the pre-change backup. If restoration cannot be proven, the status is set to `ROLLBACK_FAILED`, an emergency alert is dispatched, and the pre-change backup ID is surfaced for manual console restoration.

---

## 3. HTTP Error Response & Exception Mapping Matrix

| Exception Class | Trigger Condition | HTTP Status | Response Payload |
| :--- | :--- | :---: | :--- |
| `NotAuthenticatedException` | Missing or expired JWT cookie / Bearer token | `401 Unauthorized` | `{"detail": "Could not validate credentials"}` |
| `HMACSignatureError` | Webhook missing or invalid HMAC-SHA256 signature | `401 Unauthorized` | `{"detail": "Invalid HMAC signature"}` |
| `InsufficientPrivilegesError` | Viewer accessing NetEng/Admin route | `403 Forbidden` | `{"detail": "The user doesn't have enough privileges"}` |
| `FourEyesViolationError` | Plan author attempting to approve own plan | `403 Forbidden` | `{"detail": "Dual-control violation: plan creator cannot approve their own remediation plan"}` |
| `EntityNotFoundError` | Device, Baseline, or Drift ID does not exist | `404 Not Found` | `{"detail": "<Entity> <ID> not found"}` |
| `DeviceBusyException` | Concurrent poll or apply active on target device | `409 Conflict` | `{"detail": "Device is currently undergoing a concurrent operation"}` |
| `UnapprovedPlanException` | Applying a plan that has not been approved | `409 Conflict` | `{"detail": "Plan must be approved before execution"}` |
| `SecurityViolationError` | Shell metacharacter detected in parameters | `422 Unprocessable` | `{"detail": "Shell metacharacters forbidden in parameter"}` |
| `MalformedPayloadError` | Invalid JSON or schema mismatch | `422 Unprocessable` | `{"detail": [{"loc": [...], "msg": "..."}]}` |
| `DeviceUnreachableError` | SSH connection refused or socket timeout | `502 Bad Gateway` | `{"detail": "Device sw-hostel-01 unreachable over SSH"}` |
| `RollbackFailureError` | Automated rollback could not be verified | `500 Internal Error`| `{"detail": "Remediation failed and automated rollback verification failed"}` |
