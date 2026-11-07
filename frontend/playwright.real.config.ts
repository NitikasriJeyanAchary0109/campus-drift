import { defineConfig, devices } from '@playwright/test';

/**
 * Black-box suite: drives the real UI against the real API, a real PostgreSQL database
 * (campus_drift_e2e, rebuilt on every run) and the simulated switches. Nothing is mocked unless a test says so.
 * Requires: docker compose up -d postgres sim_switch_classroom sim_switch_hostel sim_router_lab
 */
export default defineConfig({
  testDir: './e2e-real',
  fullyParallel: false,
  workers: 1,                       // tests share one database; order matters
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/blackbox.json' }]],
  use: { baseURL: 'http://127.0.0.1:5179', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    { command: './e2e-real/start-backend.sh', url: 'http://127.0.0.1:8030/api/health', timeout: 240_000, reuseExistingServer: !!process.env.PW_REUSE },
    { command: 'BACKEND_URL=http://127.0.0.1:8030 npm run dev -- --port 5179 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:5179', timeout: 60_000, reuseExistingServer: !!process.env.PW_REUSE },
  ],
});
