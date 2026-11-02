# Project Testing Skills & Standards

## Overview
This document outlines the testing standards, commands, and workflows for this project. Always run relevant tests before and after making code changes.

---

## 1. Test Categories & Tools

* **Unit Tests**
  * *Purpose:* Test individual functions, classes, or modules in isolation.
  * *Framework:* Pytest (`pytest`, `pytest-asyncio`)
  * *Command:*
    * Campus Drift Backend: `PYTHONPATH=backend ./.venv/bin/pytest backend/tests/unit`

* **Integration Tests**
  * *Purpose:* Test interactions between multiple modules, databases, Celery/Redis queues, or API endpoints.
  * *Framework:* Pytest (`pytest`, `TestClient`)
  * *Command:*
    * Campus Drift Backend: `PYTHONPATH=backend ./.venv/bin/pytest backend/tests/integration`

* **End-to-End (E2E) Tests**
  * *Purpose:* Test complete user journeys across frontend and backend in a real browser or simulated environment.
  * *Framework:* Playwright / Cypress
  * *Command:* `npm run test:e2e` or `npx playwright test`

* **Linting & Type Checking**
  * *Purpose:* Catch syntax errors, formatting issues, and type mismatches.
  * *Command:*
    * Frontend: `cd frontend && npm run lint && npm run build`
    * Backend: `flake8 backend` / `ruff check backend`

---

## 2. Standard Workflow

1. **Run existing tests** to establish a baseline:
   ```bash
   PYTHONPATH=backend ./.venv/bin/pytest backend/tests
   ```
2. **Write or update unit tests** for any new or modified logic.
3. **Run targeted tests** while developing:
   ```bash
   PYTHONPATH=backend ./.venv/bin/pytest backend/tests/path/to/test_file.py::test_name
   ```
4. **Run the full test suite and linter** before submitting code or creating a pull request:
   ```bash
   PYTHONPATH=backend ./.venv/bin/pytest backend/tests && (cd frontend && npm run build)
   ```

---

## 3. Writing New Tests

* **Naming Convention:** Place test files in `tests/unit/` or `tests/integration/` prefixed with `test_` (e.g., `test_celery_polling.py`).
* **Coverage Requirements:** Aim for a minimum of 80% code coverage on business logic.
* **Mocking:** Mock external network requests (Netmiko SSH, gNMI, third-party ITSM webhooks), file system calls, and external database connections to keep unit tests fast and deterministic.

---

## 4. Troubleshooting Common Failures

* **Flaky Tests:** Check for hardcoded timeouts, shared mutable state between tests, or unmocked time functions.
* **Environment Issues:** Ensure `.env` is set up and required local services (PostgreSQL, Redis, simulated devices) are running before executing integration suites:
   ```bash
   docker compose up -d
   ```
