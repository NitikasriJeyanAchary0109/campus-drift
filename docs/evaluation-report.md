# Evaluation & Testing Report
## Network Configuration-Drift Detector

### 1. Overview
This report evaluates the accuracy, performance, and failure handling of the Network Configuration-Drift Detector for the campus network environment.

### 2. Baseline Benchmark (Naive Comparator)
- **Comparator:** Naive text-diff (`difflib`) of raw configuration files.
- **Normalized Tree-Diff:** Key-path tree comparison canonicalizing IP notation, order-independent lists (ACLs, VLANs), and whitespace.
- **Evaluation Metric:** False positive reduction rate and false negative prevention.

### 3. Edge Cases & Failure Scenarios
1. **Device unreachable mid-poll:** Exponential backoff retry and `DEVICE_UNREACHABLE` alert.
2. **Malformed / truncated config:** `PARSE_ERROR` generation to prevent silent skips.
3. **Overlapping change tickets:** Ticket-matching window resolution.

### 4. Rollback & Verification Results
- Automatic rollback triggered on post-remediation verification failure.
- Pre-change snapshot fidelity test.

### 5. Ethics & Security Considerations
- Credential protection: AES/Fernet encryption for stored credentials.
- RBAC enforcement: Admin / NetworkEngineer / Viewer roles.
- Remediation constraints: Jinja2 whitelist templates preventing command injection.
