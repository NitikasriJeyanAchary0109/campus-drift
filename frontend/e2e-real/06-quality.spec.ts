/** Black-box: no console errors, no failed calls, no sideways scrolling on a phone, and a clear way back when the server fails. */
import { test, expect } from '@playwright/test';
import { login, go, openMore, watch, PAGES, Role } from './helpers';

const PHONE = { width: 375, height: 812 };

for (const role of ['admin', 'neteng', 'viewer'] as Role[]) {
  test(`${role}: every allowed page opens with no console error and no failed request`, async ({ page }) => {
    const issues = watch(page);
    await login(page, role);
    for (const p of PAGES.filter((x) => x.roles.includes(role))) {
      await go(page, p.path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    }
    expect(issues).toEqual([]);
  });
}

test.describe('Phone width', () => {
  test.use({ viewport: PHONE });

  test('no page scrolls sideways', async ({ page }) => {
    await login(page, 'admin');
    for (const p of PAGES) {
      await go(page, p.path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over, `${p.path} overflows by ${over}px`).toBeLessThanOrEqual(0);
    }
  });

  test('the menu can be opened and a page chosen', async ({ page }) => {
    await login(page, 'admin');
    const menu = page.getByRole('button', { name: /menu/i }).first();
    if (await menu.count()) await menu.click();
    await openMore(page);
    await page.locator('aside').getByRole('link', { name: 'Problems', exact: true }).click();
    await expect(page).toHaveURL(/\/drift$/);
  });
});

test.describe('When the server fails', () => {
  for (const [path, what] of [['/drift', /problems/i], ['/devices', /devices/i], ['/alerts', /alerts/i]] as const) {
    test(`${path} says what failed and recovers on Retry`, async ({ page }) => {
      let broken = true;
      await page.route(`**/api/${path.slice(1)}*`, (route) => (broken ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' }) : route.continue()));
      await login(page, 'admin');                                   // routes first: the top bar already caches alerts once signed in
      await go(page, path);
      await expect(page.getByText(new RegExp(`could not (be )?load.*${what.source}|${what.source}.*could not`, 'i')).first()).toBeVisible();
      await expect(page.locator('tbody tr')).toHaveCount(0);       // no invented rows
      broken = false;
      await page.getByRole('button', { name: 'Retry' }).click();
      await expect(page.locator('tbody tr').first()).toBeVisible();
    });
  }

  test('an expired session sends the user to sign in', async ({ page }) => {
    await login(page, 'admin');
    await page.route('**/api/auth/refresh', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"expired"}' }));
    await page.route('**/api/devices*', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"expired"}' }));
    await go(page, '/devices');
    await expect(page).toHaveURL(/login/);
  });
});

test.describe('Keyboard and structure', () => {
  test('Tab reaches the sidebar and the page content, and focus is always visible', async ({ page }) => {
    await login(page, 'admin');
    await page.keyboard.press('Tab');
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        return { name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30), outline: s.outlineStyle !== 'none' || s.boxShadow !== 'none' };
      });
      if (info) { seen.add(info.name); expect(info.outline, `no focus ring on ${info.name}`).toBe(true); }
      await page.keyboard.press('Tab');
    }
    expect(seen.size).toBeGreaterThan(4);
  });

  test('each page has one main landmark and one top-level heading, and no image is missing alt text', async ({ page }) => {
    await login(page, 'admin');
    for (const p of PAGES) {
      await go(page, p.path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      expect(await page.locator('main').count(), p.path).toBe(1);
      expect(await page.getByRole('heading', { level: 1 }).count(), p.path).toBe(1);
      expect(await page.locator('img:not([alt])').count(), p.path).toBe(0);
    }
  });

  test('no emoji or sample-data markers appear anywhere', async ({ page }) => {
    await login(page, 'admin');
    for (const p of PAGES) {
      await go(page, p.path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      const text = await page.locator('body').innerText();
      expect(text, p.path).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(text, p.path).not.toMatch(/\b(sample|demo|lorem|RM-10\d\d|mock)\b/i);
    }
  });
});
