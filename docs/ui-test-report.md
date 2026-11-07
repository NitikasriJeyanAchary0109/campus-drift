# DriftWatch UI: test report

Scope: the 14 pages (Login, Home, Problems, Problem details, Devices, Device details, Approvals, Alerts, Baselines,
Baseline details, Tickets, Remediation, Audit trail, System status) and the shell (sidebar, top bar, route guards, 404).

The interface was rebuilt as plain one-column pages that show only what the API returns. The earlier version mixed example
rows into real data and carried about 120 documented defects as expected-failure tests; those pages and tests were replaced,
not patched. There are no expected-failure markers left in either suite.

## 1. How to run

```bash
cd frontend
npm run lint && npm run build  # eslint (max-warnings 0), tsc, vite
npm run test:unit              # white-box: Vitest + React Testing Library, mocked API
npm run test:e2e               # mocked-API Playwright: 6 workflows
npm run test:blackbox          # Playwright against the real API, PostgreSQL and the simulated switches
```

`test:blackbox` starts its own backend (`e2e-real/start-backend.sh`: fresh database `campus_drift_e2e`, migrations, seed,
uvicorn on :8030, remediation run inline) and Vite on :5179. Docker (Postgres and the three simulators) must be running.

## 2. Results (run on 2026-11-07)

| Suite | Result |
|---|---|
| `npm run lint`, `tsc`, `npm run build` | clean |
| White-box (Vitest), 20 files | 251 passed |
| Mocked Playwright (`e2e/`) | 6 passed |
| Black-box Playwright (`e2e-real/`), fresh database | 97 passed, 0 failed |
| Same lint, build and Vitest run in a clean copy (files not ignored by git, no `.env`, fresh Python 3.11 venv and `npm ci`) | pass |

## 3. What the black-box suite proves (`frontend/e2e-real`)

| File | Checks |
|---|---|
| `01-auth` | sign-in for each role, wrong or unknown user gives the same message, hostile input, network failure, anonymous redirect, sign-out, reload keeps the session, silent token refresh, failed refresh returns to sign-in |
| `02-navigation-rbac` | sidebar per role (four main places, the rest under More), links a role cannot use are absent, every link loads, route guards ("no access", "Page not found", "Problem not found"), and the server returns 403 or 401 for what the screen hides |
| `03-pages-match-api` | Home numbers equal the dashboard summary, Problems, Devices, Alerts, Baselines, Tickets, Audit and System status list exactly what the API returns, Home and Devices agree on how many devices are compliant, a problem page shows the recorded expected and actual values |
| `04-problem-to-fix` | the full journey with two people: neteng creates a plan, cannot approve it (screen and server), admin reads the commands and approves, applies it to a simulated switch, the audit trail shows each step in order, rollback restores the backup; closing a problem needs a written reason |
| `05-actions` | add device (Admin only), duplicate refused, credentials sent exactly as typed and never returned, Collect now records a real collection, acknowledge alert, ticket validation and creation, baseline activation by role, System status refresh |
| `06-quality` | no console error and no failed request on any allowed page for each role, no sideways scroll at 375 px, readable error with Retry when the server returns 500 (no invented rows), expired session returns to sign-in, keyboard focus ring, one main landmark and one h1 per page, no emoji or sample-data words |

## 4. Defects the rewrite surfaced

- The credentials form sent `PASSWORD` and `SSH_KEY`; the API accepts `password` and `ssh_key`, so saving always failed with a
  422. Found by `05-actions`, fixed in `DeviceDetails.tsx`.
- The Devices page counted a device with an authorized change as compliant while the server counts it as drifted, so Home
  showed 0.0 % next to a Devices page reporting a compliant device. Found by comparing the two pages with the API, fixed in
  `Devices.tsx`; `03-pages-match-api` now guards it.

## 5. Not covered

- Only Chromium was run. Safari and Firefox were not tried.
- The two Playwright suites were not run against a production build behind a reverse proxy.
- Screen-reader behaviour was not tested by hand; the checks are structural (landmarks, labels, focus rings, contrast ratios in `pixelTokens.test.ts`).
- The legacy-coexistence card on Device details (config upload) has no browser test of its own.
