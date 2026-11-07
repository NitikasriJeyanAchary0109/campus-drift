# External ITSM Webhook Integration Guide

## 1. Overview
The Campus Network Configuration-Drift Detector provides an automated inbound webhook receiver at `POST /api/tickets/webhook` to ingest change tickets directly from enterprise IT Service Management (ITSM) platforms, such as **ServiceNow** and **Jira Service Management**.

When maintenance windows are scheduled in ServiceNow or Jira, an automated webhook call creates or updates a corresponding `ChangeTicket` record in Campus Drift. When the Automated Drift Detection pipeline runs:
- Unplanned configuration modifications are flagged as **Drift-Unauthorized** (Low/Medium/High).
- Configuration deviations matching the `valid_from`–`valid_to` time window and `key_path_scope` of an active ITSM ticket are automatically classified as **Drift-Authorized** (score reduced to 1–30), preventing false alarm escalations.

---

## 2. Webhook Specification

- **Endpoint**: `POST /api/tickets/webhook`
- **Content-Type**: `application/json`
- **Authentication**: HMAC-SHA256 signature header (`X-ITSM-Signature` or `X-Hub-Signature-256`).
- **Shared Secret**: Configured via the `ITSM_WEBHOOK_SECRET` environment variable (default: `itsm_webhook_shared_secret_campus_drift_2026`).

### Security & Signature Verification
Every inbound request must include an HMAC-SHA256 signature computed over the **exact raw request body bytes** using the configured secret key.

Supported header formats:
```http
X-ITSM-Signature: sha256=4f6a98b...
```
or
```http
X-ITSM-Signature: 4f6a98b...
```
or
```http
X-Hub-Signature-256: sha256=4f6a98b...
```

Requests with missing signatures or invalid digests are immediately rejected with **`401 Unauthorized`**.

### Replay protection (timestamp)
A captured, validly signed delivery can be sent again later. For example, replaying an old `OPEN` ticket would re-authorize a change
that the ITSM has since closed. To prevent this, send the delivery time and sign it together with the body:

```http
X-ITSM-Timestamp: 1793123456            # epoch seconds, UTC
X-ITSM-Signature: sha256=<HMAC-SHA256 over  "<timestamp>." + raw body>
```

A delivery whose timestamp is more than `ITSM_TIMESTAMP_TOLERANCE_SECONDS` (default 300) away from the server clock is refused with `401`,
so keep the sender's clock on NTP. With `ITSM_REQUIRE_TIMESTAMP=true` (the default when `ENVIRONMENT=production`) the header is mandatory;
without it a body-only signature is still accepted (development and the older examples below).

### Scope is never implicit
A ticket that names no device or group, or names one that does not exist (a mistyped hostname), is refused with `422`. It is never stored with
campus-wide scope. A ticket reference that already belongs to another source (`servicenow` against `jira`) is refused with `409`.

### Which poll a ticket window is matched against
A change is dated by the poll that noticed it, but it happened at some time after the previous poll. The ticket window (plus the 30 minute
grace) is matched against that whole interval, which is never longer than `ITSM_MAX_DETECTION_LAG_MINUTES` (default 360).

---

## 3. Payload Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `external_ref` | string | **Yes** | Primary identifier in the external system (e.g. `CHG0010042`, `JIRA-4812`). |
| `ticket_ref` | string | No | Internal reference identifier. Defaults to `external_ref` if omitted. |
| `source` | string | No | Originating platform (e.g. `servicenow`, `jira`, `external`). Default: `external`. |
| `hostname` | string | No | Target device hostname (e.g. `sw-classroom-01`). Resolves to `device_id`. |
| `ip_address` | string | No | Target device management IP. Resolves to `device_id`. |
| `group_name` | string | No | Target device group (e.g. `Classroom`, `Hostel`, `Labs`). Resolves to `device_group_id`. |
| `key_path_scope` | string | **Yes** | Configuration path authorized (e.g. `interface.FastEthernet0/1`, `vlan.*`, `access_list.*`). |
| `valid_from` | ISO-8601 | **Yes** | Start of maintenance window (UTC). |
| `valid_to` | ISO-8601 | **Yes** | End of maintenance window (UTC). |
| `status` | string | No | Ticket state: `OPEN` or `CLOSED`. Default: `OPEN`. |
| `description` | string | No | Change rationale or maintenance notes. |

---

## 4. Idempotency & Delivery Guarantees
ITSM platforms frequently retry webhook deliveries upon transient network timeouts. Campus Drift enforces strict idempotency:
1. When a webhook arrives, the system queries for an existing ticket with matching `(external_ref, source)`.
2. If found, the existing record is **updated in-place** (maintenance window boundaries, status, or scope refreshed) and returned with HTTP 200.
3. If no matching record exists, a new ticket is inserted and returned with HTTP 200/201.
4. Duplicate records are never created for the same external ticket.

---

## 5. Signature Computation Examples

### Python (ServiceNow Scripted REST API / Python Automation)
```python
import hmac
import hashlib
import json
import requests

secret = "itsm_webhook_shared_secret_campus_drift_2026"
payload = {
    "external_ref": "CHG0010042",
    "source": "servicenow",
    "hostname": "sw-classroom-01",
    "key_path_scope": "interface.*.port_security.*",
    "valid_from": "2026-10-05T12:00:00Z",
    "valid_to": "2026-10-05T18:00:00Z",
    "status": "OPEN",
    "description": "Annual laboratory switch port security policy upgrade"
}

body_bytes = json.dumps(payload).encode("utf-8")
signature = hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()

headers = {
    "Content-Type": "application/json",
    "X-ITSM-Signature": f"sha256={signature}",
}

response = requests.post("http://localhost:8000/api/tickets/webhook", data=body_bytes, headers=headers)
print(response.status_code, response.json())
```

### Node.js (Jira Automation Webhook)
```javascript
const crypto = require("crypto");
const axios = require("axios");

const secret = "itsm_webhook_shared_secret_campus_drift_2026";
const payload = {
  external_ref: "JIRA-4921",
  source: "jira",
  group_name: "Hostel",
  key_path_scope: "vlan.*",
  valid_from: new Date().toISOString(),
  valid_to: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
  status: "OPEN"
};

const body = JSON.stringify(payload);
const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");

axios.post("http://localhost:8000/api/tickets/webhook", body, {
  headers: {
    "Content-Type": "application/json",
    "X-ITSM-Signature": `sha256=${signature}`
  }
}).then(res => console.log(res.status, res.data));
```

### cURL (Bash)
```bash
SECRET="itsm_webhook_shared_secret_campus_drift_2026"
BODY='{"external_ref":"CHG0099","source":"servicenow","hostname":"sw-classroom-01","key_path_scope":"interface.*","valid_from":"2026-10-05T10:00:00Z","valid_to":"2026-10-05T20:00:00Z"}'

SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

curl -X POST http://localhost:8000/api/tickets/webhook \
  -H "Content-Type: application/json" \
  -H "X-ITSM-Signature: sha256=$SIG" \
  -d "$BODY"
```
