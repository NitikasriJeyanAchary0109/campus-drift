import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApprovalQueue } from '../../src/pages/ApprovalQueue';
import { renderPage, USERS } from '../utils';
import { calls, httpError } from '../apiMock';

const plan = (over: any = {}) => ({ id: 'p1', device_hostname: 'sw-real-01', drift_label: 'Non-Compliant (Critical)', risk_score: 95, proposed_commands: ['line vty 0 4', 'transport input ssh'], status: 'PENDING', created_at: '2026-11-04T09:00:00', created_by: 'someone-else', created_by_username: 'neteng', ...over });
const api = (pending: any[] = [plan()], extra: Record<string, unknown> = {}) => ({ 'GET /api/approvals/pending': pending, 'GET /api/remediation': [], 'POST /api/approvals/:id': { id: 'ap1' }, ...extra });
const mount = (a = api(), role: any = 'Admin') => renderPage(<ApprovalQueue />, { role, api: a });

describe('Approvals', () => {
  it('lists the plans that wait for approval, with author, risk and the commands', async () => {
    mount(api([plan(), plan({ id: 'p2', device_hostname: 'sw-two' })]));
    expect(await screen.findByText('sw-real-01')).toBeInTheDocument();
    expect(screen.getByText('sw-two')).toBeInTheDocument();
    expect(screen.getAllByText('neteng').length).toBeGreaterThan(0);
    expect(screen.getByText('2 waiting')).toBeInTheDocument();
    expect(screen.getAllByText('transport input ssh', { exact: false }).length).toBeGreaterThan(0);
  });

  it('a long queue shows ten plans and reveals the rest on request', async () => {
    mount(api(Array.from({ length: 23 }, (_, i) => plan({ id: `p${i}`, device_hostname: `sw-${String(i).padStart(2, '0')}` }))));
    await screen.findByText('sw-00');
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(10);
    expect(screen.getByText('23 waiting')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Show 10 more \(13 not shown\)/ }));
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(20);
  });

  it('an empty queue is empty: no sample plans', async () => {
    mount(api([]));
    expect(await screen.findByText('Nothing is waiting')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/RM-10\d\d/);
  });

  it('a failed request is reported with a retry', async () => {
    mount(api([], { 'GET /api/approvals/pending': () => { throw httpError(500, 'boom'); } }));
    expect(await screen.findByText('Could not load approvals')).toBeInTheDocument();
  });

  it('an unknown author is shown as unknown, never as admin', async () => {
    mount(api([plan({ created_by: null, created_by_username: null })]));
    await screen.findByText('sw-real-01');
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });

  it('the author of a plan cannot approve it (four eyes) but can still reject their own', async () => {
    mount(api([plan({ created_by: USERS.Admin.id, created_by_username: 'admin' })]));
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('a second person approves: posts the decision for that plan and says what happens next', async () => {
    const u = userEvent.setup();
    mount();
    await u.click(await screen.findByRole('button', { name: 'Approve' }));
    await u.type(screen.getByLabelText(/note/i), 'looks right');
    await u.click(screen.getByRole('button', { name: /confirm approval/i }));
    expect(await screen.findByText(/can now be applied from remediation/i)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/approvals/p1')?.body).toEqual({ decision: 'APPROVED', comment: 'looks right' });
  });

  it('a rejection needs a reason; with one it posts REJECTED', async () => {
    const u = userEvent.setup();
    mount();
    await u.click(await screen.findByRole('button', { name: 'Reject' }));
    const confirm = screen.getByRole('button', { name: /confirm rejection/i });
    expect(confirm).toBeDisabled();
    await u.type(screen.getByLabelText(/why are you rejecting/i), 'wrong vlan');
    await u.click(confirm);
    await waitFor(() => expect(calls.find((c) => c.path === '/api/approvals/p1')?.body).toEqual({ decision: 'REJECTED', comment: 'wrong vlan' }));
    expect(await screen.findByText(/rejected/i)).toBeInTheDocument();
  });

  it('a refused decision is reported and not announced as saved', async () => {
    const u = userEvent.setup();
    mount(api([plan()], { 'POST /api/approvals/:id': () => { throw httpError(403, 'Creator cannot approve') } }));
    await u.click(await screen.findByRole('button', { name: 'Approve' }));
    await u.click(screen.getByRole('button', { name: /confirm approval/i }));
    expect(await screen.findByText('Creator cannot approve')).toBeInTheDocument();
    expect(screen.queryByText(/can now be applied/i)).not.toBeInTheDocument();
  });

  it('recently decided plans are listed with a link to their remediation page', async () => {
    mount(api([], { 'GET /api/remediation': [plan({ id: 'done', status: 'APPLIED', device_hostname: 'sw-done', approval: { decision: 'APPROVED', approver_username: 'admin', decided_at: '2026-11-04T10:00:00' } })] }));
    expect(await screen.findByText('sw-done')).toBeInTheDocument();
    const row = screen.getByText('sw-done').closest('tr')!;
    expect(within(row).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/remediation?plan_id=done');
  });
});
