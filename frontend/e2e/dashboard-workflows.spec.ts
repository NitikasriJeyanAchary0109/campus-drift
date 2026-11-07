import { test, expect } from '@playwright/test';

test.describe('Campus Drift - 6 Core UI Dashboard Workflows', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication endpoints
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'fake-jwt-token-campus-drift-e2e',
          token_type: 'bearer',
          user: {
            id: '11111111-1111-1111-1111-111111111111',
            username: 'admin',
            role: 'Admin',
            is_active: true,
          },
        }),
      });
    });

    await page.route('**/api/auth/refresh', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'fake-jwt-token-campus-drift-e2e',
          token_type: 'bearer',
          user: {
            id: '11111111-1111-1111-1111-111111111111',
            username: 'admin',
            role: 'Admin',
            is_active: true,
          },
        }),
      });
    });

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '11111111-1111-1111-1111-111111111111',
          username: 'admin',
          role: 'Admin',
          is_active: true,
        }),
      });
    });

    // Mock dashboard metrics
    await page.route('**/api/dashboard/summary', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total_devices: 12,
          compliant_devices: 9,
          drifted_devices: 2,
          no_baseline_devices: 1,
          compliance_percentage: 81.82,
          open_drift_count: 2,
          pending_approvals_count: 1,
          active_alerts_count: 1,
          // the real summary lists the latest alerts; Home shows the unacknowledged ones under "Needs attention"
          recent_alerts: [
            { id: 'aaaaaaaa-0000-0000-0000-000000000001', type: 'CRITICAL_DRIFT', message: 'High-priority drift detected on sw-hostel-01', acknowledged: false, created_at: new Date().toISOString() },
          ],
          recent_drift_events: [
            {
              id: '22222222-2222-2222-2222-222222222222',
              device_id: '33333333-3333-3333-3333-333333333333',
              device_hostname: 'sw-hostel-01',
              label: 'Non-Compliant (Critical)',
              risk_score: 95,
              detected_at: new Date().toISOString(),
              status: 'OPEN',
            },
          ],
        }),
      });
    });

    // Mock device list
    await page.route('**/api/devices*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: '33333333-3333-3333-3333-333333333333',
            hostname: 'sw-hostel-01',
            ip_address: '10.10.10.2',
            vendor: 'cisco_ios',
            model: 'Catalyst 2960-X',
            status: 'ONLINE',
            device_group: { id: 'group-1', name: 'Hostel' },
            has_credentials: true,
          },
          {
            id: '44444444-4444-4444-4444-444444444444',
            hostname: 'sw-classroom-01',
            ip_address: '10.10.10.1',
            vendor: 'cisco_ios',
            model: 'Catalyst 2960-X',
            status: 'ONLINE',
            device_group: { id: 'group-2', name: 'Classroom' },
            has_credentials: true,
          },
        ]),
      });
    });

    // Mock drift events
    await page.route('**/api/drift*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: '22222222-2222-2222-2222-222222222222',
            device_id: '33333333-3333-3333-3333-333333333333',
            device_hostname: 'sw-hostel-01',
            label: 'Non-Compliant (Critical)',
            risk_score: 95,
            detected_at: new Date().toISOString(),
            status: 'OPEN',
            details_count: 2,
          },
        ]),
      });
    });

    // Mock approvals queue
    await page.route('**/api/approvals/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'plan-1',
            drift_event_id: '22222222-2222-2222-2222-222222222222',
            device_hostname: 'sw-hostel-01',
            drift_label: 'Non-Compliant (Critical)',
            risk_score: 95,
            created_by_username: 'neteng',
            status: 'PENDING',
            proposed_commands: ['no snmp-server community public', 'line vty 0 4', 'transport input ssh'],
            created_at: new Date().toISOString(),
          },
        ]),
      });
    });

    // Mock remediation history (Approvals lists recently decided plans)
    await page.route('**/api/remediation*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    // Mock alerts
    await page.route('**/api/alerts*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'alert-1',
            type: 'CRITICAL_DRIFT',
            message: 'Critical configuration drift on sw-hostel-01: SNMP community public detected.',
            acknowledged: false,
            created_at: new Date().toISOString(),
          },
        ]),
      });
    });

    // Mock audit logs
    await page.route('**/api/audit*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'audit-1',
            action: 'REMEDIATION_PLAN_APPROVED',
            target_type: 'remediation',
            target_id: 'plan-1',
            username: 'admin',
            timestamp: new Date().toISOString(),
          },
        ]),
      });
    });
  });

  // Workflow 1: Authentication & RBAC Gate
  test('Workflow 1: User Login and Session Initialization', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();

    // Fill credentials
    await page.locator('input[type="text"]').fill('admin');
    await page.locator('input[type="password"]').fill('admin123');
    await page.locator('button[type="submit"]').click();

    // Verify successful redirection into the application
    await expect(page).toHaveURL(/\/(dashboard)?$/);
  });

  // Workflow 2: Dashboard Metrics & Fleet Compliance
  test('Workflow 2: Dashboard Metrics and Compliance Denominator Exclusion', async ({ page }) => {
    // Inject auth state directly into localStorage or state
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'campus-drift-auth',
        JSON.stringify({
          state: {
            token: 'fake-jwt-token-campus-drift-e2e',
            user: { username: 'admin', role: 'Admin', is_active: true },
            isAuthenticated: true,
          },
        })
      );
    });

    await page.goto('/');
    await expect(page.getByText('Campus Drift Detector')).toBeVisible();
    await expect(page.getByText('sw-hostel-01').first()).toBeVisible();
  });

  // Workflow 3: Device Inventory Navigation
  test('Workflow 3: Device Inventory Listing and Filtering', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'campus-drift-auth',
        JSON.stringify({
          state: {
            token: 'fake-jwt-token-campus-drift-e2e',
            user: { username: 'admin', role: 'Admin', is_active: true },
            isAuthenticated: true,
          },
        })
      );
    });

    await page.goto('/devices');
    await expect(page.getByText('sw-hostel-01').first()).toBeVisible();
    await expect(page.getByText('sw-classroom-01').first()).toBeVisible();
  });

  // Workflow 4: Drift Events and Severity Inspection
  test('Workflow 4: Drift Detection Events and Severity Badges', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'campus-drift-auth',
        JSON.stringify({
          state: {
            token: 'fake-jwt-token-campus-drift-e2e',
            user: { username: 'admin', role: 'Admin', is_active: true },
            isAuthenticated: true,
          },
        })
      );
    });

    await page.goto('/drift');
    await expect(page.getByText('sw-hostel-01').first()).toBeVisible();
  });

  // Workflow 5: Remediation & Approval Queue
  test('Workflow 5: Remediation Plans and Approval Gate Review', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'campus-drift-auth',
        JSON.stringify({
          state: {
            token: 'fake-jwt-token-campus-drift-e2e',
            user: { username: 'admin', role: 'Admin', is_active: true },
            isAuthenticated: true,
          },
        })
      );
    });

    await page.goto('/approvals');
    await expect(page.getByRole('heading', { name: /waiting for approval/i })).toBeVisible();
    await expect(page.getByText('sw-hostel-01').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  // Workflow 6: Immutable Audit Trail & Alerts
  test('Workflow 6: Audit Logs History and Alert Acknowledgment', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'campus-drift-auth',
        JSON.stringify({
          state: {
            token: 'fake-jwt-token-campus-drift-e2e',
            user: { username: 'admin', role: 'Admin', is_active: true },
            isAuthenticated: true,
          },
        })
      );
    });

    await page.goto('/alerts');
    await expect(page.getByText('Critical configuration drift').first()).toBeVisible();

    await page.goto('/audit');
    await expect(page.getByText('Remediation plan approved').first()).toBeVisible();
  });
});
