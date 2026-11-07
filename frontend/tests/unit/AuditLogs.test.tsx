import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuditLogs } from '../../src/pages/AuditLogs';
import { renderPage } from '../utils';
import { httpError } from '../apiMock';

const au = (over: any = {}) => ({ id: 'u1', username: 'admin', action: 'DEVICE_CREATED', target_type: 'device', target_id: 'd1', before_state: null, after_state: { hostname: 'sw-1' }, timestamp: '2026-11-04T09:00:00', ...over });
const mount = (list: any) => renderPage(<AuditLogs />, { role: 'Admin', api: { 'GET /api/audit': list } });
const rows = () => screen.getAllByRole('row').slice(1);

describe('Audit trail', () => {
  it('lists the entries the server returned with the real user names', async () => {
    mount([au(), au({ id: 'u2', username: null, action: 'LOGIN_FAILED', target_type: 'user' })]);
    await screen.findByText('Device created');
    expect(rows()).toHaveLength(2);
    expect(screen.getByText('system')).toBeInTheDocument();
    expect(screen.getByText('Login failed')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/neeraj\.n|amisha\.k/);
  });

  it('a failed load is reported, not shown as an empty log', async () => {
    mount(() => { throw httpError(500, 'database is down'); });
    expect(await screen.findByText('Could not load the audit trail')).toBeInTheDocument();
    expect(screen.getByText(/database is down/)).toBeInTheDocument();
  });

  it('an empty trail says so', async () => {
    mount([]);
    expect(await screen.findByText('The audit trail is empty')).toBeInTheDocument();
  });

  it('the action and user filters really filter the list', async () => {
    const u = userEvent.setup();
    mount([au(), au({ id: 'u2', username: 'neteng', action: 'REMEDIATION_APPLIED', target_type: 'remediation' })]);
    await screen.findByText('Device created');
    await u.click(screen.getByRole('button', { name: /filters/i }));
    await u.selectOptions(screen.getByLabelText('Action'), 'REMEDIATION_APPLIED');
    expect(rows()).toHaveLength(1);
    await u.selectOptions(screen.getByLabelText('Action'), '');
    await u.selectOptions(screen.getByLabelText('User'), 'admin');
    expect(within(rows()[0]).getByText('Device created')).toBeInTheDocument();
  });

  it('the user filter offers the users who appear in the log', async () => {
    const u = userEvent.setup();
    mount([au(), au({ id: 'u2', username: 'neteng' })]);
    await screen.findAllByText('Device created');
    await u.click(screen.getByRole('button', { name: /filters/i }));
    const options = within(screen.getByLabelText('User')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Everyone', 'admin', 'neteng']);
  });

  it('Details shows the before and after state of one entry', async () => {
    const u = userEvent.setup();
    mount([au()]);
    await u.click(await screen.findByRole('button', { name: 'Details' }));
    expect(screen.getByText(/"hostname": "sw-1"/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText(/"hostname": "sw-1"/)).not.toBeInTheDocument();
  });

  it('Export CSV downloads the filtered rows', async () => {
    const u = userEvent.setup();
    mount([au()]);
    let name = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { name = this.download; });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    await u.click(await screen.findByRole('button', { name: /export csv/i }));
    click.mockRestore();
    expect(name).toBe('audit-trail.csv');
  });

  it('pages through long trails', async () => {
    const u = userEvent.setup();
    mount(Array.from({ length: 20 }, (_, i) => au({ id: `x${i}` })));
    await screen.findAllByText('Device created');
    expect(rows()).toHaveLength(15);
    await u.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(rows()).toHaveLength(5);
  });
});
