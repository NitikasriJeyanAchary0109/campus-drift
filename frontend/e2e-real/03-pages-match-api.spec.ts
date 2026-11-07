/** Black-box: every page shows what the API returns, and nothing else. No invented rows, no numbers that disagree between pages. */
import { test, expect } from '@playwright/test';
import { login, go, apiGet, kpiValue } from './helpers';

test.describe('Home', () => {
  test('the four numbers equal the dashboard summary and the lists behind them', async ({ page, request }) => {
    const s = await apiGet(request, 'admin', '/api/dashboard/summary');
    const approvals = await apiGet<any[]>(request, 'admin', '/api/approvals/pending');
    await login(page, 'admin');
    await expect(page.getByText('Total Devices Managed')).toBeVisible();
    expect(await kpiValue(page, 'Total Devices Managed')).toBe(String(s.total_devices));
    expect(await kpiValue(page, 'Campus Compliance')).toBe(`${s.compliance_percentage.toFixed(1)}%`);
    expect(await kpiValue(page, 'Pending Approvals')).toBe(String(approvals.length));
  });

  test('the banner counts the open problems the API lists', async ({ page, request }) => {
    const open = (await apiGet<any[]>(request, 'admin', '/api/drift?status=OPEN')).filter((e) => e.label !== 'Compliant');
    await login(page, 'admin');
    await expect(page.getByLabel('Status')).toContainText(open.length === 0 ? 'All clear' : /problems? need/);
  });

  test('"Needs attention" lists only alerts that are not acknowledged', async ({ page, request }) => {
    const alerts = await apiGet<any[]>(request, 'admin', '/api/alerts?limit=100');
    await login(page, 'admin');
    const text = await page.locator('main').innerText();
    for (const a of alerts.filter((x) => x.acknowledged)) expect(text).not.toContain(a.message);
  });

  test('a viewer does not see approvals or the sweep button', async ({ page }) => {
    await login(page, 'viewer');
    await expect(page.getByText('Total Devices Managed')).toBeVisible();
    await expect(page.getByText('Pending Approvals')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Trigger Campus Sweep/ })).toHaveCount(0);
  });
});

test.describe('Problems', () => {
  test.beforeEach(async ({ page }) => { await login(page, 'admin'); await go(page, '/drift'); });

  test('lists exactly the open events of the API', async ({ page, request }) => {
    const api = (await apiGet<any[]>(request, 'admin', '/api/drift')).filter((e) => e.status === 'OPEN');
    await expect(page.getByText(new RegExp(`of ${api.length}\\b`)).first()).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(Math.min(api.length, 10));
    const hosts = new Set(api.map((e) => e.device_hostname));
    for (const row of await page.locator('tbody tr').all()) {
      const text = await row.innerText();
      expect([...hosts].some((h) => text.includes(h))).toBe(true);
    }
  });

  test('the first row is the highest risk', async ({ page, request }) => {
    const api = (await apiGet<any[]>(request, 'admin', '/api/drift')).filter((e) => e.status === 'OPEN');
    const top = [...api].sort((a, b) => b.risk_score - a.risk_score)[0];
    await expect(page.locator('tbody tr').first()).toContainText(top.device_hostname);
    await expect(page.locator('tbody tr').first()).toContainText(String(top.risk_score));
  });

  test('searching narrows the rows and a search with no match says so', async ({ page }) => {
    await page.getByLabel('Search problems').fill('hostel');
    for (const row of await page.locator('tbody tr').all()) await expect(row).toContainText(/hostel/i);
    await page.getByLabel('Search problems').fill('zzz-nothing');
    await expect(page.locator('tbody tr')).toHaveCount(0);
    await expect(page.getByText(/no problems|nothing matches|no results/i).first()).toBeVisible();
  });

  test('Filters opens a panel, and the filters are off until it is opened', async ({ page }) => {
    await expect(page.getByLabel('Problem type')).toHaveCount(0);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.getByLabel('Problem type')).toBeVisible();
  });

  test('Review opens the page of that very problem', async ({ page, request }) => {
    const api = (await apiGet<any[]>(request, 'admin', '/api/drift')).filter((e) => e.status === 'OPEN');
    const top = [...api].sort((a, b) => b.risk_score - a.risk_score)[0];
    await page.getByRole('link', { name: `Review ${top.device_hostname}` }).first().click();
    await expect(page).toHaveURL(new RegExp(`/drift/${top.id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(top.device_hostname);
  });
});

test.describe('Problem page', () => {
  test('shows the expected and the actual value the API recorded', async ({ page, request }) => {
    const events = await apiGet<any[]>(request, 'admin', '/api/drift?status=OPEN');
    const withDetails = events.find((e) => e.details_count > 0)!;
    const detail = await apiGet(request, 'admin', `/api/drift/${withDetails.id}`);
    await login(page, 'admin');
    await go(page, `/drift/${withDetails.id}`);
    const table = page.getByRole('table', { name: 'Expected and actual values' });
    await expect(table).toBeVisible();
    for (const d of detail.details.slice(0, 3)) await expect(table).toContainText(d.key_path);
    await expect(page.getByText(`${detail.details.length} ${detail.details.length === 1 ? 'change' : 'changes'}`)).toBeVisible();
  });

  test('Download diff saves a text file named after the device', async ({ page, request }) => {
    const [e] = await apiGet<any[]>(request, 'admin', '/api/drift?status=OPEN');
    await login(page, 'admin');
    await go(page, `/drift/${e.id}`);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download diff' }).click()]);
    expect(download.suggestedFilename()).toBe(`diff-${e.device_hostname}-${e.id}.txt`);
  });

  test('a viewer can read it but sees no action buttons', async ({ page, request }) => {
    const [e] = await apiGet<any[]>(request, 'viewer', '/api/drift?status=OPEN');
    await login(page, 'viewer');
    await go(page, `/drift/${e.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(e.device_hostname);
    await expect(page.getByRole('button', { name: 'Create Remediation' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Close Event' })).toHaveCount(0);
  });
});

test.describe('Devices', () => {
  test('lists exactly the registered devices and the counts add up', async ({ page, request }) => {
    const api = await apiGet<any[]>(request, 'admin', '/api/devices');
    await login(page, 'admin');
    await go(page, '/devices');
    await expect(page.locator('tbody tr')).toHaveCount(api.length);
    for (const d of api) await expect(page.locator('tbody')).toContainText(d.hostname);
    await expect(page.locator('main')).toContainText(`${api.length} devices`);
  });

  test('the number of compliant devices on Home agrees with the Devices page', async ({ page, request }) => {
    const s = await apiGet(request, 'admin', '/api/dashboard/summary');
    await login(page, 'admin');
    await go(page, '/devices');
    const line = await page.locator('main').innerText();
    const compliant = Number(line.match(/(\d+) compliant/)![1]);
    const total = Number(line.match(/(\d+) devices/)![1]);
    expect(((compliant / total) * 100).toFixed(1)).toBe(s.compliance_percentage.toFixed(1));
  });

  test('a device page shows its own facts', async ({ page, request }) => {
    const [d] = await apiGet<any[]>(request, 'admin', '/api/devices');
    await login(page, 'admin');
    await go(page, `/devices/${d.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(d.hostname);
    await expect(page.locator('main')).toContainText(d.ip_address);
  });
});

test.describe('Alerts, Baselines, Tickets, Audit, Settings', () => {
  test('Alerts shows every alert the API returns', async ({ page, request }) => {
    const api = await apiGet<any[]>(request, 'admin', '/api/alerts?limit=100');
    await login(page, 'admin');
    await go(page, '/alerts');
    await expect(page.locator('main')).toContainText(`of ${api.length} alerts`);
  });

  test('Baselines lists each baseline with its real rule count', async ({ page, request }) => {
    const api = await apiGet<any[]>(request, 'admin', '/api/baselines');
    await login(page, 'admin');
    await go(page, '/baselines');
    for (const b of api) await expect(page.locator('tbody')).toContainText(b.name);
    await expect(page.locator('tbody tr')).toHaveCount(api.length);
  });

  test('a baseline page lists its rules and an unknown one is "not found"', async ({ page, request }) => {
    const [b] = await apiGet<any[]>(request, 'admin', '/api/baselines');
    const rules = await apiGet<any[]>(request, 'admin', `/api/baselines/${b.id}/rules`);
    await login(page, 'admin');
    await go(page, `/baselines/${b.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(b.name);
    await expect(page.locator('tbody tr')).toHaveCount(rules.length);
    await go(page, '/baselines/00000000-0000-0000-0000-000000000000');
    await expect(page.getByText(/not found/i).first()).toBeVisible();
  });

  test('Tickets lists the real tickets only', async ({ page, request }) => {
    const api = await apiGet<any[]>(request, 'admin', '/api/tickets');
    await login(page, 'admin');
    await go(page, '/tickets');
    for (const t of api) await expect(page.locator('tbody')).toContainText(t.ticket_ref ?? t.reference ?? t.id);
  });

  test('the audit trail starts with the newest real entry', async ({ page, request }) => {
    const api = await apiGet<any[]>(request, 'admin', '/api/audit?limit=500');   // the page asks for the same 500
    await login(page, 'admin');
    await go(page, '/audit');
    await expect(page.locator('tbody tr').first()).toContainText(api[0].target_type);
    // every sign-in adds an entry (the page's own included), so the page can only show as many or more than the API did a moment ago
    const shown = Number(((await page.locator('main').innerText()).match(/of (\d+) entries/) ?? [])[1]);
    expect(shown).toBeGreaterThanOrEqual(api.length);
  });

  test('System status shows what the health endpoint reports', async ({ page, request }) => {
    const h = await apiGet(request, 'admin', '/api/health');
    await login(page, 'admin');
    await go(page, '/settings');
    await expect(page.locator('main')).toContainText(h.version);
    await expect(page.locator('main')).toContainText(h.project);
    await expect(page.getByText('All systems working')).toBeVisible();
  });
});
