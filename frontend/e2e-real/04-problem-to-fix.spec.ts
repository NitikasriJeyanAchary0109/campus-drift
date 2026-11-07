/** Black-box: the whole journey in the browser, by the two people the process needs.
 *  neteng finds a problem and writes the fix, admin approves it, applies it, and rolls it back. */
import { test, expect } from '@playwright/test';
import { login, go, apiGet, apiToken } from './helpers';

test.describe.serial('From problem to verified fix', () => {
  let eventId = '';
  let planId = '';

  test('the network engineer opens the worst problem and creates a remediation plan', async ({ page, request }) => {
    const open = await apiGet<any[]>(request, 'neteng', '/api/drift?status=OPEN');
    eventId = open.find((e) => e.device_hostname === 'sw-hostel-01').id;
    const before = await apiGet<any[]>(request, 'neteng', '/api/remediation');
    const alreadyWaiting = before.some((p) => p.drift_event_id === eventId && p.status === 'PENDING');
    await login(page, 'neteng');
    await go(page, `/drift/${eventId}`);
    await page.getByRole('button', { name: 'Create Remediation' }).click();
    if (alreadyWaiting) {
      // one live plan per problem: the seeded plan is still waiting, so the page says so and points to Approvals
      await expect(page.getByText(/already has a pending remediation plan/)).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open Approvals' })).toBeVisible();
    } else {
      await expect(page.getByText(/Remediation plan created/)).toBeVisible();
    }
    const plans = await apiGet<any[]>(request, 'neteng', '/api/remediation');
    const mine = plans.filter((p) => p.drift_event_id === eventId && p.status === 'PENDING');
    expect(mine.length).toBe(1);
    planId = mine[0].id;
  });

  test('asking for a second plan for the same problem is refused by the server', async ({ request }) => {
    const token = await apiToken(request, 'neteng');
    const res = await request.post(`/api/remediation/${eventId}/generate-plan`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(409);
  });

  test('the author sees the plan waiting but cannot approve it', async ({ page }) => {
    await login(page, 'neteng');
    await go(page, '/approvals');
    await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' }).first()).toBeDisabled();
  });

  test('the server also refuses the author approving their own plan', async ({ request }) => {
    const token = await apiToken(request, 'neteng');
    const res = await request.post(`/api/approvals/${planId}`, { headers: { Authorization: `Bearer ${token}` }, data: { decision: 'APPROVED', comment: 'self' } });
    expect(res.status()).toBe(403);
  });

  test('a rejection needs a reason', async ({ page }) => {
    await login(page, 'admin');
    await go(page, '/approvals');
    await page.getByRole('button', { name: 'Reject' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Confirm rejection' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('a second person (admin) reads the commands and approves', async ({ page, request }) => {
    await login(page, 'admin');
    await go(page, '/approvals');
    const card = page.getByRole('listitem').filter({ hasText: 'sw-hostel-01' }).first();
    await card.getByText(/Show the \d+ commands?/).click();
    await expect(card.locator('pre')).toContainText(/\S/);
    await card.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog').getByLabel(/Note/).fill('Checked against the ticket');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm approval' }).click();
    await expect(page.getByText(/Approved\. .* can now be applied/)).toBeVisible();
    const plan = (await apiGet<any[]>(request, 'admin', '/api/remediation')).find((p) => p.id === planId);
    expect(plan.status).toBe('APPROVED');
  });

  test('applying pushes the commands, verifies the device and records it', async ({ page, request }) => {
    await login(page, 'admin');
    await go(page, `/remediation?plan_id=${planId}`);
    await expect(page.getByRole('heading', { level: 2, name: 'sw-hostel-01' })).toBeVisible();
    await page.getByRole('button', { name: 'Execute Remediation' }).click();
    await expect(page.getByRole('dialog')).toContainText('sw-hostel-01');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm & push to device' }).click();
    await expect.poll(async () => (await apiGet<any>(request, 'admin', `/api/remediation/${planId}`)).status, { timeout: 45_000 }).toBe('APPLIED');
    await expect(page.getByRole('table', { name: 'Actions on this plan' })).toContainText(/Success/i);
  });

  test('the problem is gone once the device matches its baseline again', async ({ request }) => {
    const event = await apiGet<any>(request, 'admin', `/api/drift/${eventId}`);
    expect(['RESOLVED', 'CLOSED', 'REMEDIATED']).toContain(event.status);
  });

  test('rolling back restores the backup and is checked against it', async ({ page, request }) => {
    await login(page, 'admin');
    await go(page, `/remediation?plan_id=${planId}`);
    await page.getByRole('button', { name: 'Rollback Now' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm rollback' }).click();
    await expect.poll(async () => (await apiGet<any>(request, 'admin', `/api/remediation/${planId}`)).status, { timeout: 45_000 }).toBe('ROLLED_BACK');
  });

  test('every step is in the audit trail, newest first', async ({ page, request }) => {
    const actions = (await apiGet<any[]>(request, 'admin', '/api/audit?limit=500')).map((a) => a.action);
    const at = (name: string) => actions.indexOf(name);          // index 0 is the newest entry
    for (const name of ['PLAN_GENERATED', 'PLAN_APPROVED', 'REMEDIATION_SUCCESS', 'MANUAL_ROLLBACK']) expect(at(name), name).toBeGreaterThanOrEqual(0);
    expect(at('MANUAL_ROLLBACK')).toBeLessThan(at('REMEDIATION_SUCCESS'));
    expect(at('REMEDIATION_SUCCESS')).toBeLessThan(at('PLAN_APPROVED'));
    expect(at('PLAN_APPROVED')).toBeLessThan(at('PLAN_GENERATED'));
    await login(page, 'admin');
    await go(page, '/audit');
    await page.getByLabel('Search the audit trail').fill('rollback');
    await expect(page.locator('tbody tr').first()).toContainText('Manual rollback');
  });
});

test.describe('Closing a problem that is not one', () => {
  test('needs a written reason, then moves the problem out of the open list', async ({ page, request }) => {
    const open = await apiGet<any[]>(request, 'admin', '/api/drift?status=OPEN');
    const target = open.find((e) => e.device_hostname === 'sw-classroom-01') ?? open[open.length - 1];
    await login(page, 'admin');
    await go(page, `/drift/${target.id}`);
    await page.getByRole('button', { name: 'Close Event' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Why is this not a problem/).fill('ok');
    await expect(dialog.getByRole('button', { name: 'Confirm Closure' })).toBeDisabled();
    await dialog.getByLabel(/Why is this not a problem/).fill('Planned maintenance, ticket attached');
    await dialog.getByRole('button', { name: 'Confirm Closure' }).click();
    await expect(page.getByText(/Closed as not a problem/)).toBeVisible();
    const after = await apiGet<any>(request, 'admin', `/api/drift/${target.id}`);
    expect(after.status).toBe('FALSE_POSITIVE');
    await go(page, '/drift');
    const stillOpen = (await apiGet<any[]>(request, 'admin', '/api/drift')).filter((e) => e.status === 'OPEN');
    await expect(page.locator('tbody tr')).toHaveCount(Math.min(stillOpen.length, 10));
    expect(stillOpen.map((e) => e.id)).not.toContain(target.id);
  });
});
