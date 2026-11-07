/** Black-box: the buttons and forms outside the main journey, each checked against what the server stored. */
import { test, expect } from '@playwright/test';
import { login, go, apiGet, apiToken } from './helpers';

const unique = () => Date.now().toString(36).slice(-6);

test.describe.serial('Devices', () => {
  const hostname = `e2e-sw-${unique()}`;
  const octet = () => 1 + Math.floor(Math.random() * 250);
  const ip = `10.99.${octet()}.${octet()}`;
  let deviceId = '';

  test('only an administrator is offered "Add device"', async ({ page }) => {
    await login(page, 'neteng');
    await go(page, '/devices');
    await expect(page.getByRole('button', { name: 'Add device' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start Campus Sweep' })).toBeVisible();
    await login(page, 'viewer');
    await go(page, '/devices');
    await expect(page.getByRole('button', { name: 'Start Campus Sweep' })).toHaveCount(0);
  });

  test('an administrator adds a device and it appears in the list and in the API', async ({ page, request }) => {
    await login(page, 'admin');
    await go(page, '/devices');
    await page.getByRole('button', { name: 'Add device' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Hostname').fill(hostname);
    await dialog.getByLabel('IP address').fill(ip);
    await dialog.getByLabel('Model').fill('Catalyst 2960X');
    await dialog.getByLabel('Zone').selectOption({ index: 1 });
    await dialog.getByRole('button', { name: 'Add device' }).click();
    await expect(page.locator('tbody')).toContainText(hostname);
    const mine = (await apiGet<any[]>(request, 'admin', '/api/devices')).find((d) => d.hostname === hostname);
    expect(mine).toBeTruthy();
    deviceId = mine.id;
  });

  test('a duplicate hostname is refused with a readable message', async ({ page }) => {
    await login(page, 'admin');
    await go(page, '/devices');
    await page.getByRole('button', { name: 'Add device' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Hostname').fill(hostname);
    await dialog.getByLabel('IP address').fill('10.98.1.1');
    await dialog.getByLabel('Model').fill('Catalyst 2960X');
    await dialog.getByLabel('Zone').selectOption({ index: 1 });
    await dialog.getByRole('button', { name: 'Add device' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(page.getByText('[object Object]')).toHaveCount(0);
  });

  test('credentials are saved exactly as typed and never shown again', async ({ page, request }) => {
    const secret = 'S3cret pass word!';             // spaces and punctuation must survive untouched
    await login(page, 'admin');
    await go(page, `/devices/${deviceId}`);
    await page.getByRole('button', { name: 'SSH credentials' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Username').fill('netops');
    await dialog.getByLabel('Password').fill(secret);
    const sent = page.waitForRequest((r) => r.url().includes(`/devices/${deviceId}/credentials`) && r.method() === 'POST');
    await dialog.getByRole('button', { name: 'Save credentials' }).click();
    expect((await sent).postDataJSON()).toMatchObject({ username: 'netops', secret });
    await expect.poll(async () => (await apiGet<any>(request, 'admin', `/api/devices/${deviceId}`)).has_credentials).toBe(true);
    const body = JSON.stringify(await apiGet(request, 'admin', `/api/devices/${deviceId}`));
    expect(body).not.toContain(secret);
    await expect(page.locator('main')).not.toContainText(secret);
  });

  test('a neteng cannot open the credentials form', async ({ page }) => {
    await login(page, 'neteng');
    await go(page, `/devices/${deviceId}`);
    await expect(page.getByRole('button', { name: 'SSH credentials' })).toHaveCount(0);
  });

  test('Collect now on a real simulated switch records a new collection', async ({ page, request }) => {
    const sw = (await apiGet<any[]>(request, 'neteng', '/api/devices')).find((d) => d.hostname === 'sw-classroom-01');
    const before = (await apiGet<any>(request, 'neteng', `/api/devices/${sw.id}`)).latest_snapshot?.collected_at;
    await login(page, 'neteng');
    await go(page, '/devices');
    await page.getByRole('button', { name: 'Collect sw-classroom-01 now' }).click();
    await expect.poll(async () => (await apiGet<any>(request, 'neteng', `/api/devices/${sw.id}`)).latest_snapshot?.collected_at, { timeout: 30_000 }).not.toBe(before);
  });
});

test.describe('Alerts', () => {
  test('acknowledging moves the alert out of "Needs attention" and the server records it', async ({ page, request }) => {
    const alerts = await apiGet<any[]>(request, 'neteng', '/api/alerts?limit=100');
    const target = alerts.find((a) => !a.acknowledged);
    test.skip(!target, 'no unacknowledged alert left in this database');
    await login(page, 'neteng');
    await go(page, '/alerts');
    const row = page.locator('tbody tr').filter({ hasText: target!.message.slice(0, 40) }).first();
    await row.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(row.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0);
    const after = (await apiGet<any[]>(request, 'neteng', '/api/alerts?limit=100')).find((a) => a.id === target!.id);
    expect(after.acknowledged).toBe(true);
  });

  test('a viewer can read alerts but has no Acknowledge button', async ({ page }) => {
    await login(page, 'viewer');
    await go(page, '/alerts');
    await expect(page.getByRole('heading', { name: 'Alerts', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0);
  });

  test('the bell in the top bar shows the real unacknowledged count', async ({ page, request }) => {
    const open = (await apiGet<any[]>(request, 'admin', '/api/alerts?limit=100')).filter((a) => !a.acknowledged).length;
    await login(page, 'admin');
    const bell = page.getByRole('button', { name: /notification|alert/i }).first();
    await expect(bell).toBeVisible();
    if (open > 0) await expect(bell).toContainText(String(open));
    else await expect(bell).not.toContainText(/\d/);
  });
});

test.describe('Tickets', () => {
  test('a window that ends before it starts is refused before anything is sent', async ({ page }) => {
    await login(page, 'neteng');
    await go(page, '/tickets');
    await page.getByRole('button', { name: 'New Ticket' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Ticket reference').fill(`CHG-${unique()}`);
    await dialog.getByLabel('Window starts').fill('2030-01-02T10:00');
    await dialog.getByLabel('Window ends').fill('2030-01-02T09:00');
    await dialog.getByRole('button', { name: 'Create ticket' }).click();
    await expect(dialog.getByRole('alert')).toContainText(/after|before|end/i);
  });

  test('a valid ticket is stored and shown', async ({ page, request }) => {
    const ref = `CHG-E2E-${unique()}`;
    await login(page, 'neteng');
    await go(page, '/tickets');
    await page.getByRole('button', { name: 'New Ticket' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Ticket reference').fill(ref);
    await dialog.getByLabel('Device').selectOption({ index: 1 });
    await dialog.getByLabel('Settings covered').fill('ntp.server');
    await dialog.getByLabel('Window starts').fill('2030-01-02T09:00');
    await dialog.getByLabel('Window ends').fill('2030-01-02T10:00');
    await dialog.getByRole('button', { name: 'Create ticket' }).click();
    await expect(page.locator('tbody')).toContainText(ref);
    const stored = (await apiGet<any[]>(request, 'neteng', '/api/tickets')).find((t) => t.ticket_ref === ref);
    expect(stored?.device_id).toBeTruthy();
  });

  test('a viewer has no New Ticket button', async ({ page }) => {
    await login(page, 'viewer');
    await go(page, '/tickets');
    await expect(page.getByRole('button', { name: 'New Ticket' })).toHaveCount(0);
  });
});

test.describe('Baselines and settings', () => {
  test('only an administrator can activate a baseline; the active ones have no button', async ({ page, request }) => {
    const baselines = await apiGet<any[]>(request, 'admin', '/api/baselines');
    await login(page, 'neteng');
    await go(page, '/baselines');
    await expect(page.getByRole('button', { name: 'Activate' })).toHaveCount(0);
    await login(page, 'admin');
    await go(page, '/baselines');
    await expect(page.getByRole('button', { name: 'Activate' })).toHaveCount(baselines.filter((b) => !b.is_active).length);
  });

  test('the server refuses a viewer activating a baseline', async ({ request }) => {
    const [b] = await apiGet<any[]>(request, 'admin', '/api/baselines');
    const token = await apiToken(request, 'viewer');
    expect((await request.put(`/api/baselines/${b.id}/activate`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(403);
  });

  test('"Check again" on System status asks the server again', async ({ page }) => {
    await login(page, 'admin');
    await go(page, '/settings');
    const again = page.waitForRequest((r) => r.url().endsWith('/api/health'));
    await page.getByRole('button', { name: 'Check again' }).click();
    await again;
    await expect(page.getByText('All systems working')).toBeVisible();
  });
});
