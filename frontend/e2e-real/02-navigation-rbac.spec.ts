/** Black-box: what each role sees in the sidebar, which pages it may open, and that the server refuses what the UI hides. */
import { test, expect } from '@playwright/test';
import { login, go, openMore, apiToken, Role } from './helpers';

const MAIN: Record<Role, string[]> = {
  admin: ['Home', 'Problems', 'Devices', 'Approvals'],
  neteng: ['Home', 'Problems', 'Devices', 'Approvals'],
  viewer: ['Home', 'Problems', 'Devices'],
};
const MORE: Record<Role, string[]> = {
  admin: ['Alerts', 'Baselines', 'Tickets', 'Remediation', 'Audit', 'Settings'],
  neteng: ['Alerts', 'Baselines', 'Tickets', 'Remediation'],
  viewer: ['Alerts', 'Baselines', 'Tickets'],
};
const ALL_LINKS = ['Approvals', 'Alerts', 'Baselines', 'Tickets', 'Remediation', 'Audit', 'Settings'];

for (const role of ['admin', 'neteng', 'viewer'] as Role[]) {
  test.describe(`Sidebar as ${role}`, () => {
    test.beforeEach(async ({ page }) => { await login(page, role); });

    test('shows the main places, and the rest only under More', async ({ page }) => {
      const nav = page.locator('aside');
      for (const name of MAIN[role]) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
      await openMore(page);
      for (const name of MORE[role]) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    });

    test('never lists a page the role cannot open', async ({ page }) => {
      await openMore(page);
      const allowed = new Set([...MAIN[role], ...MORE[role]]);
      for (const name of ALL_LINKS.filter((n) => !allowed.has(n))) {
        await expect(page.locator('aside').getByRole('link', { name, exact: true })).toHaveCount(0);
      }
    });

    test('every listed link opens a page that loads without an error', async ({ page }) => {
      await openMore(page);
      for (const name of [...MAIN[role], ...MORE[role]].filter((n) => n !== 'Home')) {
        await page.locator('aside').getByRole('link', { name, exact: true }).click();
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await expect(page.getByText(/could not be loaded|something went wrong/i)).toHaveCount(0);
      }
    });
  });
}

test.describe('Route guards', () => {
  const blocked: [Role, string][] = [
    ['viewer', '/approvals'], ['viewer', '/remediation'], ['viewer', '/audit'], ['viewer', '/settings'],
    ['neteng', '/audit'], ['neteng', '/settings'],
  ];
  for (const [role, path] of blocked) {
    test(`${role} opening ${path} is told they have no access`, async ({ page }) => {
      await login(page, role);
      await go(page, path);
      await expect(page.getByText('You do not have access to this page')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Go to Home' })).toBeVisible();
    });
  }

  test('an unknown address shows "Page not found" and a way home', async ({ page }) => {
    await login(page, 'admin');
    await go(page, '/no-such-page');
    await expect(page.getByText('Page not found')).toBeVisible();
    await page.getByRole('link', { name: 'Go to Home' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('an unknown problem id says so instead of showing an empty page', async ({ page }) => {
    await login(page, 'admin');
    await go(page, '/drift/00000000-0000-0000-0000-000000000000');
    await expect(page.getByRole('heading', { name: 'Problem not found' })).toBeVisible();
  });
});

test.describe('The server enforces the same rules as the screen', () => {
  test('a viewer cannot create a plan, approve, acknowledge or poll', async ({ request }) => {
    const token = await apiToken(request, 'viewer');
    const headers = { Authorization: `Bearer ${token}` };
    const id = '00000000-0000-0000-0000-000000000000';
    for (const path of [`/api/remediation/${id}/generate-plan`, `/api/alerts/${id}/ack`, `/api/devices/${id}/poll`]) {
      expect((await request.post(path, { headers })).status(), path).toBe(403);
    }
    expect((await request.post(`/api/approvals/${id}`, { headers, data: { decision: 'APPROVED' } })).status()).toBe(403);
  });

  test('a network engineer cannot read the audit trail or add devices', async ({ request }) => {
    const token = await apiToken(request, 'neteng');
    const headers = { Authorization: `Bearer ${token}` };
    expect((await request.get('/api/audit', { headers })).status()).toBe(403);
    expect((await request.post('/api/devices', { headers, data: {} })).status()).toBe(403);
  });

  test('requests without a token are refused', async ({ request }) => {
    for (const path of ['/api/devices', '/api/drift', '/api/audit', '/api/dashboard/summary']) {
      expect((await request.get(path)).status(), path).toBe(401);
    }
  });
});
