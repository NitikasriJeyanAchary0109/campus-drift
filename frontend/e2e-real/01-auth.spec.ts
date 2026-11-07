/**
 * Black-box: Login page and session handling. Written from the user's point of view only:
 * what is visible, what happens after typing and clicking, never how it is implemented.
 */
import { test, expect } from '@playwright/test';
import { login, go, watch } from './helpers';

test.describe('Login page', () => {
  test('renders the sign-in form with demo role presets', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByPlaceholder('Enter your username')).toBeVisible();
    await expect(page.getByPlaceholder('Enter your password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in to workspace/i })).toBeEnabled();
    for (const r of ['Admin', 'Network Engineer', 'Viewer']) await expect(page.getByRole('button', { name: new RegExp(`${r} demo account`, 'i') })).toBeVisible();
  });

  for (const role of ['admin', 'neteng', 'viewer'] as const) {
    test(`valid ${role} credentials sign in and show the role`, async ({ page }) => {
      await login(page, role);
      await expect(page.getByText(role, { exact: true }).first()).toBeVisible();
      await expect(page).toHaveURL(/127\.0\.0\.1:5179\/$/);
    });
  }

  test('a demo preset fills the credentials and signs in', async ({ page }) => {
    await page.goto('/login');
    await page.getByText('(viewer / viewer123)').click();
    await expect(page.getByPlaceholder('Enter your username')).toHaveValue('viewer');
    await page.getByRole('button', { name: /sign in to workspace/i }).click();
    await expect(page).not.toHaveURL(/login/);
  });

  test('wrong password shows a readable error and stays on the login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Enter your username').fill('admin');
    await page.locator('input[type="password"]').fill('definitely-wrong');
    await page.getByRole('button', { name: /sign in to workspace/i }).click();
    await expect(page.getByText(/incorrect username or password/i)).toBeVisible();
    await expect(page).toHaveURL(/login/);
  });

  test('unknown user gets the same error as a wrong password (no user enumeration)', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Enter your username').fill('nobody-here');
    await page.locator('input[type="password"]').fill('whatever1');
    await page.getByRole('button', { name: /sign in to workspace/i }).click();
    await expect(page.getByText(/incorrect username or password/i)).toBeVisible();
  });

  test('empty username is blocked by the form', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Enter your username').fill('');
    await page.getByRole('button', { name: /sign in to workspace/i }).click();
    await expect(page).toHaveURL(/login/);
    expect(await page.getByPlaceholder('Enter your username').evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  });

  test('password can be revealed and hidden', async ({ page }) => {
    await page.goto('/login');
    const pw = page.getByPlaceholder('Enter your password');
    await expect(pw).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: /show password/i }).click();
    await expect(pw).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: /hide password/i }).click();
    await expect(pw).toHaveAttribute('type', 'password');
  });

  test('hostile input is rejected safely (SQL injection, script tags, very long strings)', async ({ page }) => {
    const issues = watch(page);
    for (const payload of ["' OR '1'='1' --", '<script>alert(1)</script>', 'a'.repeat(5000), '\u0000\u0007']) {
      await page.goto('/login');
      await page.getByPlaceholder('Enter your username').fill(payload);
      await page.locator('input[type="password"]').fill(payload);
      await page.getByRole('button', { name: /sign in to workspace/i }).click();
      await page.waitForTimeout(400);
      await expect(page).toHaveURL(/login/);
      await expect(page.locator('body')).not.toContainText('Something went wrong');
    }
    expect(issues.filter((i) => i.startsWith('pageerror'))).toEqual([]);
  });

  test('a validation (422) response is shown as text, not as a crash', async ({ page }) => {
    // The API answers 422 with a list of errors; the page must render it, not die on "Objects are not valid as a React child".
    await page.route('**/api/auth/login', (r) => r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: [{ loc: ['body', 'username'], msg: 'Field required', type: 'missing' }] }) }));
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/login');
    await page.getByRole('button', { name: /sign in to workspace/i }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText('WELCOME BACK!')).toBeVisible();   // page still alive
    expect(errors).toEqual([]);
  });

  test('network failure during sign-in shows an error, not a blank page', async ({ page }) => {
    await page.route('**/api/auth/login', (r) => r.abort('connectionrefused'));
    await page.goto('/login');
    await page.getByPlaceholder('Enter your username').fill('admin');
    await page.getByPlaceholder('Enter your password').fill('admin123');
    await page.getByRole('button', { name: /sign in to workspace/i }).click();
    await expect(page.getByRole('alert')).toContainText('Network Error');
  });

  test('credentials are not pre-filled for a stranger', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder('Enter your username')).toHaveValue('');
    await expect(page.getByPlaceholder('Enter your password')).toHaveValue('');
  });
});

test.describe('Session', () => {
  test('protected pages redirect an anonymous visitor to login', async ({ page }) => {
    for (const path of ['/', '/devices', '/drift', '/remediation', '/audit', '/settings']) {
      await page.goto(path);
      await expect(page).toHaveURL(/login/);
    }
  });

  test('sign out returns to login and the session is gone', async ({ page }) => {
    await login(page, 'admin');
    await page.getByRole('button', { name: /sign out/i }).click();   // the pixel topbar shows the sign-out button directly (no user menu)
    await expect(page).toHaveURL(/login/);
    await page.goto('/devices');
    await expect(page).toHaveURL(/login/);
  });

  test('a page reload keeps the user signed in (refresh cookie)', async ({ page }) => {
    await login(page, 'neteng');
    await page.reload();
    await expect(page).not.toHaveURL(/login/);
    await expect(page.getByText('neteng', { exact: true }).first()).toBeVisible();
  });

  test('an expired access token is refreshed silently on the next call', async ({ page }) => {
    await login(page, 'admin');
    let first = true;
    await page.route('**/api/alerts?*', async (route) => {
      if (first) { first = false; return route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"expired"}' }); }
      return route.continue();
    });
    await go(page, '/alerts');
    await expect(page.getByRole('heading', { name: 'Alerts', exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/login/);
  });

  test('when the refresh also fails the user is sent to login', async ({ page }) => {
    await login(page, 'admin');
    await page.route('**/api/dashboard/summary', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"expired"}' }));
    await page.route('**/api/auth/refresh', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"bad refresh"}' }));
    await page.reload();
    await expect(page).toHaveURL(/login/);
  });
});
