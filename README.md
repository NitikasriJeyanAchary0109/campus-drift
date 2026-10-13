# Campus Network Configuration-Drift Detector

[![Python](https://img.shields.io/badge/Python-3.9+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.3-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7.0-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose_v2-2496ED?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com/)
[![Tests](https://img.shields.io/badge/Tests-118%2F118%20Passing-success?style=flat-square&logo=pytest&logoColor=white)](backend/tests/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

An enterprise-grade, automated network configuration-drift detection and remediation platform tailored for decentralized campus environments (academic lecture halls, student hostels, research laboratories, and administrative offices).

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Quickstart with Docker Compose](#quickstart-with-docker-compose)
  - [Default Demo Credentials](#default-demo-credentials)
- [Local Development Setup](#local-development-setup)
  - [Backend Setup](#backend-setup)
  - [Frontend Setup](#frontend-setup)
  - [Running Tests](#running-tests)
- [How It Works](#how-it-works)
  - [1. Configuration Collection](#1-configuration-collection)
  - [2. Normalization & Canonicalization](#2-normalization--canonicalization)
  - [3. Tree-Diff & Scoring Engine](#3-tree-diff--scoring-engine)
  - [4. Change Ticket Temporal Suppression](#4-change-ticket-temporal-suppression)
  - [5. Gated Remediation & Rollback](#5-gated-remediation--rollback)
- [Baseline Definition Example](#baseline-definition-example)
- [Simulated Campus Network](#simulated-campus-network)
- [Documentation & Resources](#documentation--resources)
- [Contributing](#contributing)
- [Maintainer](#maintainer)

---

## Overview

In multi-tenant campus networks, switches and routers steadily deviate from security baselines due to ad-hoc troubleshooting during lectures, temporary lab setups, and unrecorded emergency tweaks. These unmanaged deviations ("configuration drift") introduce critical vulnerabilities:
- Insecure management protocols (e.g., Telnet re-enabled on access lines).
- Unauthorized SNMP community strings (`public`/`private`) exposed to student VLANs.
- Disabled switchport security facilitating rogue access points and MAC-flooding attacks.
- NTP clock desynchronization compromising security incident forensics.
- Unauthorized VLAN assignments causing inter-VLAN leakage between isolated student, faculty, and administrative subnets.

**Campus Drift Detector** continuously audits running configurations against cryptographically verified golden baselines, scores deviations by risk and campus zone criticality, suppresses authorized changes within approved maintenance windows, and generates safe, templated CLI remediation commands with automated pre-change backups and rollback verification.

---

## Key Features

- **Vendor-Aware Indented Tokenization:** Hierarchical parser transforms flat Cisco IOS and FRRouting CLI configuration blocks into structured key-path trees.
- **Semantic Normalization:** Eliminates syntax-level false positives by canonicalizing CIDR subnet masks, whitespace ordering, boolean equivalents, and VLAN lists.
- **Rule-Based Baseline Engine:** Supports `EXACT`, `MUST_NOT_EXIST`, `MUST_EXIST`, and `REGEX` rule types with `hard_compliance` security gating.
- **Zone-Weighted Risk Scoring:** Calibrates severity scores ($1 - 100$) by campus physical zone criticality (Lab $1.2\times$, Classroom $1.0\times$, Hostel $0.8\times$, Public Event $0.5\times$).
- **Change Ticket Matching ($\pm 30\text{ min}$ grace window):** Temporal correlation matches planned maintenance tickets via API or HMAC-signed ITSM webhooks, downgrading planned work from unauthorized alarms to `Drift-Authorized`.
- **Zero Free-Text Remediation:** Prevents CLI injection by generating remediation exclusively through parameterized Jinja2 templates; blacklists shell metacharacters with automatic HTTP 422 rejection.
- **Automated Backup & Rollback Safety Net:** Captures running-config snapshot prior to remediation. Re-polls device immediately post-change and automatically reverts config if verification fails.
- **Immutable Append-Only Audit Trail:** Comprehensive operational audit logging tracks all state-changing activities (logins, baseline modifications, approval decisions, execution results).
- **Built-in Campus Network Emulators:** Includes 3 containerized SSH switches running custom CLI emulators, allowing full end-to-end testing without physical networking hardware.

---

## Architecture

The system follows a modular 3-tier architecture with human-in-the-loop approval workflows:

```mermaid
flowchart TD
    subgraph UI["Frontend (React 18 + TypeScript + Vite)"]
        DASH[Dashboard & Trend Chart]
        DIFF_UI[Side-by-Side Diff Viewer]
        APP_UI[Approval Queue]
        REM_UI[Remediation Terminal]
        AUD_UI[Audit Trail Table]
    end

    subgraph API["FastAPI Application Layer (Port 8000)"]
        AUTH[RBAC & In-Memory JWT]
        COLL_SVC[Collection Service (Netmiko)]
        NORM_SVC[Canonicalization Normalizer]
        DRIFT_ENG[Tree-Diff Engine]
        RISK_ENG[Severity & Taxonomy Classifier]
        REM_ENG[Jinja2 Remediation Engine]
        VER_SVC[Verification & Rollback Service]
    end

    subgraph ASYNC["Background Processing"]
        CELERY[Celery Worker + Beat]
        REDIS[(Redis 7 - Broker & Cache)]
    end

    subgraph STORAGE["Persistence Layer"]
        PG[(PostgreSQL 16 - JSONB & GIN)]
    end

    subgraph NET["Campus Infrastructure (Simulated / Physical)"]
        SIM_C["sw-classroom-01 :2222"]
        SIM_H["sw-hostel-01 :2223"]
        SIM_L["rtr-lab-01 :2224"]
    end

    UI -->|HTTPS + Bearer JWT| AUTH
    AUTH --> COLL_SVC
    COLL_SVC -->|Netmiko SSH| NET
    COLL_SVC --> NORM_SVC
    NORM_SVC --> DRIFT_ENG
    DRIFT_ENG --> RISK_ENG
    RISK_ENG --> PG
    CELERY --> COLL_SVC
    REDIS --> CELERY
    APP_UI -->|Approve/Reject| REM_ENG
    REM_ENG -->|Push CLI| NET
    VER_SVC -->|Re-Verify| NET
    API --> PG
```

---

## Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend** | Python 3.9+, FastAPI, Pydantic v2 | High-throughput asynchronous REST API |
| **Database** | PostgreSQL 16 Alpine, SQLAlchemy 2.0 | Relational state, JSONB snapshot diff storage |
| **Task Queue** | Redis 7, Celery 5.4 | Asynchronous periodic network polling sweeps |
| **Network Engine** | Netmiko 4.4, Paramiko | SSH CLI configuration pull, commit, and verification |
| **Templates** | Jinja2 3.1 | Safe, parameterized CLI remediation generation |
| **Frontend** | React 18, TypeScript 5.5, Vite 5.4 | Interactive Single Page Application (SPA) |
| **Styling** | Tailwind CSS 3.4, Lucide React | Responsive dark-mode operational dashboard |
| **State & Data** | TanStack Query v5, Zustand v4 | Client-side caching and session management |
| **Charts** | Recharts 2.12 | 14-day compliance and drift trendline analytics |
| **Testing** | pytest, pytest-asyncio, httpx | 118 automated unit and integration tests |

---

## Getting Started

### Prerequisites

Ensure you have the following installed on your machine:
- [Docker](https://docs.docker.com/get-docker/) (v24.0+) & [Docker Compose](https://docs.docker.com/compose/) (v2.0+)
- Python 3.9+ (optional, for local non-container development)
- Node.js 18+ & npm (optional, for local frontend development)

### Quickstart with Docker Compose

1. **Clone the repository:**
   ```bash
   git clone https://github.com/NitikasriJeyanAchary0109/campus-drift.git
   cd campus-drift
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

3. **Launch the entire stack:**
   ```bash
   docker compose up -d
   ```

4. **Access the application:**
   - **Web UI:** [http://localhost:5174](http://localhost:5174) (or `http://localhost:5173` depending on `.env`)
   - **Interactive API Documentation (Swagger):** [http://localhost:8000/docs](http://localhost:8000/docs)
   - **Alternative ReDoc Docs:** [http://localhost:8000/redoc](http://localhost:8000/redoc)
   - **Backend Health Check:** [http://localhost:8000/health](http://localhost:8000/health)

### Default Demo Credentials

Pre-seeded role accounts for testing Role-Based Access Control (RBAC):

| Role | Username | Password | Capabilities |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin` | `admin123` | Full access: approve remediation, trigger rollbacks, activate baselines |
| **Network Engineer** | `neteng` | `neteng123` | Draft baselines, generate remediation plans, poll devices |
| **Viewer** | `viewer` | `viewer123` | Read-only access to dashboard, audit logs, and compliance trends |

---

## Local Development Setup

If you prefer to run services natively outside of Docker containers:

### Backend Setup

1. **Create and activate a virtual environment:**
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   ```

2. **Install dependencies:**
   ```bash
   pip install -r backend/requirements.txt
   ```

3. **Run database migrations:**
   ```bash
   cd backend
   alembic upgrade head
   ```

4. **Start the FastAPI development server:**
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

### Frontend Setup

1. **Navigate to the frontend directory:**
   ```bash
   cd frontend
   ```

2. **Install packages:**
   ```bash
   npm install
   ```

3. **Start the Vite development server:**
   ```bash
   npm run dev
   ```

### Running Tests

The test suite covers unit logic (parsers, tokenizers, drift diffing, RBAC) and end-to-end integration flows (Celery polling, SSH execution, remediation rollback):

```bash
# From project root
pytest backend/tests
```

```text
================== 118 passed, 3 warnings in ~70s ==================
```

---

## How It Works

### 1. Configuration Collection
- The Celery scheduler or manual trigger (`POST /api/devices/{id}/poll`) initiates a connection via Netmiko.
- The raw `running-config` is fetched over SSH, timestamped, and persisted in `configuration_snapshots` with JSONB indexing.

### 2. Normalization & Canonicalization
Raw CLI output is sanitized and normalized:
```python
# Values treated as semantically identical (0% false drift):
"10.10.1.10 255.255.255.0" == "10.10.1.10/24"
"transport input telnet ssh" == "transport input ssh telnet"
"switchport trunk allowed vlan 10,20" == "switchport trunk allowed vlan 20,10"
```

### 3. Tree-Diff & Scoring Engine
The running tree is evaluated against the active baseline rules:
$$\text{Raw Score} = \min\Big(100, \; \max\big(1, \; \text{round}(\text{rule.severity\_weight} \times \text{group.criticality\_weight})\big)\Big)$$

- **Hard Compliance Guardrail:** Soft rule deviations are capped at score $94$. Only violations with `hard_compliance=True` reach Critical ($95 - 100$).

### 4. Change Ticket Temporal Suppression
When drift is detected, the engine queries open Change Tickets:
- If a ticket covers the key path and device within the ticket's active window ($\pm 30\text{ min}$ grace period), the incident is classified as **`Drift-Authorized`** (score $1 - 30$), suppressing high-priority pager alerts.

### 5. Gated Remediation & Rollback
1. **Plan Generation:** Network Engineers request a remediation plan. The engine renders parameterized Jinja2 templates (no arbitrary CLI commands allowed).
2. **Approval Gate:** The plan must be explicitly approved by an **Admin** user (`PUT /api/approvals/{id}`).
3. **Execution & Backup:** A pre-change snapshot is saved. Commands are executed sequentially over SSH.
4. **Verification & Auto-Rollback:** The device is re-polled immediately. If baseline compliance is not achieved, the engine triggers an automated rollback to the pre-change backup.

---

## Baseline Definition Example

Baselines are managed declaratively via JSON/YAML definitions (`POST /api/baselines`):

```yaml
name: "Hostel-Edge-Baseline-v1"
device_group: "Hostel"
vendor: "cisco_ios"
rules:
  - key_path: "line.vty.transport_input"
    expected_value: "ssh"
    rule_type: "EXACT"
    severity_weight: 90
    hard_compliance: true

  - key_path: "snmp.community.public.exists"
    expected_value: "false"
    rule_type: "MUST_NOT_EXIST"
    severity_weight: 95
    hard_compliance: true

  - key_path: "interface.FastEthernet0/1.port_security.enabled"
    expected_value: "true"
    rule_type: "EXACT"
    severity_weight: 70
    hard_compliance: false

  - key_path: "ntp.server"
    expected_value: "10.10.0.1"
    rule_type: "EXACT"
    severity_weight: 20
    hard_compliance: false
```

---

## Simulated Campus Network

The platform includes Dockerized Cisco IOS and FRRouting emulators (`network/simulated_devices/`):

| Device Name | Role | Container Port | Host Port | Simulated Quirks |
| :--- | :--- | :--- | :--- | :--- |
| `sw-classroom-01` | Classroom Core | `22` | `2222` | Telnet enabled drift, baseline Cisco 2960-X |
| `sw-hostel-01` | Hostel Access | `22` | `2223` | Public SNMP community string exposed |
| `rtr-lab-01` | Research Router | `22` | `2224` | FRRouting Linux router with NTP deviation |

---

## Documentation & Resources

- [architecture.md](architecture.md): Complete system architecture, component breakdowns, sequence diagrams, and design decisions.
- [PHASE_COMPLETION_REPORT_35.md](PHASE_COMPLETION_REPORT_35.md): Milestone evaluation report, scope boundaries, and verification criteria.
- [docs/itsm-integration.md](docs/itsm-integration.md): Guide for connecting ServiceNow and Jira webhooks with HMAC-SHA256 signature verification.
- [docs/evaluation-report.md](docs/evaluation-report.md): Benchmark results, accuracy metrics, and false-positive evaluation.

---

## Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork the repository** and create your feature branch:
   ```bash
   git checkout -b feature/new-parser
   ```
2. **Ensure all tests pass**:
   ```bash
   pytest backend/tests
   ```
3. **Submit a Pull Request** with a detailed summary of changes, test coverage, and target device models.

---

## Maintainer

- **Nitikasri Jeyan Achary** ([@NitikasriJeyanAchary0109](https://github.com/NitikasriJeyanAchary0109))
- Project Repository: [https://github.com/NitikasriJeyanAchary0109/campus-drift](https://github.com/NitikasriJeyanAchary0109/campus-drift)
