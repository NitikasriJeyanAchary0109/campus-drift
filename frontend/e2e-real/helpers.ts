import { APIRequestContext, expect, Page } from '@playwright/test';

export type Role = 'admin' | 'neteng' | 'viewer';
export const PASSWORDS: Record<Role, string> = { admin: 'admin123', neteng: 'neteng123', viewer: 'viewer123' };

/** Sign in through the real login form and wait for the shell to appear. */
export async function login(page: Page, role: Role = 'admin') {
  await page.goto('/login');
  await page.getByPlaceholder('Enter your username').fill(role);
  await page.locator('input[type="password"]').fill(PASSWORDS[role]);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  try {
    await expect(page).not.toHaveURL(/login/, { timeout: 8000 });
  } catch {                                    // one retry: the dev server occasionally drops the first login after a restart
    await page.getByRole('button', { name: /sign in to workspace/i }).click();
    await expect(page).not.toHaveURL(/login/);
  }
}

/** In-app navigation (the session lives in memory, a full page load would sign the user out). */
export async function go(page: Page, path: string) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForLoadState('networkidle');
}

export const PAGES: { name: string; path: string; label?: string; roles: Role[] }[] = [
  { name: 'Dashboard', path: '/', label: 'Home', roles: ['admin', 'neteng', 'viewer'] },
  { name: 'Alerts', path: '/alerts', roles: ['admin', 'neteng', 'viewer'] },
  { name: 'Devices', path: '/devices', roles: ['admin', 'neteng', 'viewer'] },
  { name: 'Baselines', path: '/baselines', roles: ['admin', 'neteng', 'viewer'] },
  { name: 'Tickets', path: '/tickets', roles: ['admin', 'neteng', 'viewer'] },
  { name: 'Drift', path: '/drift', label: 'Problems', roles: ['admin', 'neteng', 'viewer'] },
  { name: 'Remediation', path: '/remediation', roles: ['admin', 'neteng'] },
  { name: 'Approvals', path: '/approvals', roles: ['admin', 'neteng'] },
  { name: 'Audit', path: '/audit', roles: ['admin'] },
  { name: 'Settings', path: '/settings', roles: ['admin'] },
];

/** Authenticated read-only access to the real API: the oracle the UI is compared against. */
export async function apiGet<T = any>(request: APIRequestContext, role: Role, path: string): Promise<T> {
  const login = await request.post('/api/auth/login', { data: { username: role, password: PASSWORDS[role] } });
  const { access_token } = await login.json();
  const res = await request.get(path, { headers: { Authorization: `Bearer ${access_token}` } });
  expect(res.ok(), `${path} -> ${res.status()}`).toBeTruthy();
  return res.json();
}

export async function apiToken(request: APIRequestContext, role: Role): Promise<string> {
  const login = await request.post('/api/auth/login', { data: { username: role, password: PASSWORDS[role] } });
  return (await login.json()).access_token;
}

/** Collect console errors, page errors and failing HTTP calls while a test runs. */
export function watch(page: Page) {
  const issues: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') issues.push(`console: ${m.text().slice(0, 160)}`); });
  page.on('pageerror', (e) => issues.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('response', (r) => { if (r.status() >= 400) issues.push(`http ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  return issues;
}

/** Read a KPI tile by its label: the number is the nearest purely numeric line before or after the label. */
export async function kpiValue(page: Page, label: string | RegExp): Promise<string> {
  const text = await page.locator('main').innerText();
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const idx = lines.findIndex((l) => (typeof label === 'string' ? l.toLowerCase() === label.toLowerCase() : label.test(l)));
  if (idx < 0) throw new Error(`KPI label not found: ${label}`);
  const numeric = /^[0-9][0-9,.]*%?$/;
  const pick = [lines[idx + 1], lines[idx - 1]].find((l) => l && numeric.test(l));
  if (!pick) throw new Error(`No numeric value next to KPI ${label}: ${lines.slice(idx - 1, idx + 2)}`);
  return pick;
}

/** Text of `main` between two headings (case-insensitive), to scope an assertion to one section. */
export async function section(page: Page, from: RegExp, to?: RegExp): Promise<string> {
  const text = await page.locator('main').innerText();
  const start = text.search(from);
  if (start < 0) return '';
  const rest = text.slice(start + 1);
  const end = to ? rest.search(to) : -1;
  return end > 0 ? rest.slice(0, end) : rest;
}

/** The sidebar shows four main places; everything else sits under "More". Opens "More" when it is closed. */
export const MAIN_NAV = ['Home', 'Problems', 'Devices', 'Approvals'];
export async function openMore(page: Page) {
  const more = page.locator('aside').getByRole('button', { name: 'More', exact: true });
  if (await more.count() && (await more.getAttribute('aria-expanded')) === 'false') await more.click();
}
