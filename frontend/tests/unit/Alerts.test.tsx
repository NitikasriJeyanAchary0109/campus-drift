import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Alerts } from '../../src/pages/Alerts';
import { renderPage } from '../utils';
import { calls, httpError } from '../apiMock';

const al = (over: any = {}) => ({ id: 'a1', type: 'CRITICAL_DRIFT', related_id: 'ev-1', message: 'Drift on sw-1', acknowledged: false, created_at: '2026-11-04T10:00:00', ...over });
const mount = (list: any, role: any = 'Admin', extra: Record<string, unknown> = {}) => renderPage(<Alerts />, { role, api: { 'GET /api/alerts': list, 'POST /api/alerts/:id/ack': { ok: true }, ...extra } });
const rows = () => screen.getAllByRole('row').slice(1);

describe('Alerts', () => {
  it('lists exactly the alerts the server returned, still-open ones first, and counts them', async () => {
    mount([al({ id: 'old', acknowledged: true, message: 'done one' }), al({ id: 'new', message: 'open one' })]);
    await screen.findByText('open one');
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('open one'), expect.stringContaining('done one')]);
    expect(screen.getByText('1 of 2 alerts still need attention.')).toBeInTheDocument();
  });

  it('by default nothing is hidden: acknowledged and lower-severity alerts are listed too', async () => {
    mount([al(), al({ id: 'b', type: 'POLICY_NOTE', message: 'medium one', acknowledged: true })]);
    await screen.findByText('Drift on sw-1');
    expect(screen.getByText('medium one')).toBeInTheDocument();
  });

  it('empty and failed states are explicit', async () => {
    const { unmount } = mount([]);
    expect(await screen.findByText('No alerts')).toBeInTheDocument();
    unmount();
    mount(() => { throw httpError(500, 'boom'); });
    expect(await screen.findByText('Could not load alerts')).toBeInTheDocument();
  });

  it('severity follows the alert type: a failed remediation is critical, a device down is high, the rest medium', async () => {
    mount([al({ id: '1', type: 'REMEDIATION_FAILED', message: 'rem failed' }), al({ id: '2', type: 'DEVICE_DOWN', message: 'down' }), al({ id: '3', type: 'OTHER_THING', message: 'misc' })]);
    await screen.findByText('rem failed');
    const sev = (msg: string) => within(rows().find((r) => r.textContent!.includes(msg))!).getAllByRole('cell')[1].textContent;
    expect(sev('rem failed')).toBe('Critical');
    expect(sev('down')).toBe('High');
    expect(sev('misc')).toBe('Medium');
  });

  it('the filter shows only alerts that need attention, or only acknowledged ones', async () => {
    const u = userEvent.setup();
    mount([al({ message: 'open one' }), al({ id: 'b', acknowledged: true, message: 'done one' })]);
    await screen.findByText('open one');
    await u.selectOptions(screen.getByLabelText('Show'), 'open');
    expect(rows()).toHaveLength(1);
    await u.selectOptions(screen.getByLabelText('Show'), 'done');
    expect(screen.getByText('done one')).toBeInTheDocument();
    expect(screen.queryByText('open one')).not.toBeInTheDocument();
  });

  it('Investigate goes to the right place for each kind of alert', async () => {
    mount([al({ id: '1', related_id: 'ev-1' }), al({ id: '2', type: 'DEVICE_DOWN', related_id: 'dev-5', message: 'down' }), al({ id: '3', type: 'REMEDIATION_FAILED', related_id: 'plan-3', message: 'rem' })]);
    await screen.findByText('down');
    expect(screen.getAllByRole('link', { name: 'Investigate' }).map((l) => l.getAttribute('href')).sort()).toEqual(['/devices/dev-5', '/drift/ev-1', '/remediation?plan_id=plan-3']);
  });

  it('Acknowledge posts for that alert; a failure is reported, not swallowed', async () => {
    const u = userEvent.setup();
    mount([al()]);
    await u.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/alerts/a1/ack')).toBe(true);
  });

  it('a refused acknowledgement shows the reason', async () => {
    const u = userEvent.setup();
    mount([al()], 'Admin', { 'POST /api/alerts/:id/ack': () => { throw httpError(500, 'Could not save'); } });
    await u.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    expect(await screen.findByText('Could not save')).toBeInTheDocument();
  });

  it('a Viewer can read alerts but not acknowledge them', async () => {
    mount([al()], 'Viewer');
    await screen.findByText('Drift on sw-1');
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
  });
});
