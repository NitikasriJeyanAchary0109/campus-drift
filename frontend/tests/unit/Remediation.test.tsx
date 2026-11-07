import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Remediation } from '../../src/pages/Remediation';
import { renderPage } from '../utils';
import { calls, httpError } from '../apiMock';

const PLAN = (over: any = {}) => ({ id: 'plan-1', drift_event_id: 'ev-1', device_hostname: 'sw-real-01', drift_label: 'Non-Compliant (Critical)', risk_score: 95, proposed_commands: ['line vty 0 4', 'transport input ssh'], status: 'APPROVED', created_at: '2026-11-04T09:00:00', created_by_username: 'neteng', approval: { decision: 'APPROVED', approver_username: 'admin', comment: 'ok', decided_at: '2026-11-04T09:30:00' }, actions: [], ...over });
const api = (p: any = PLAN(), extra: Record<string, unknown> = {}) => ({ 'GET /api/remediation': [p], 'GET /api/remediation/:id': p, 'POST /api/remediation/:id/apply': { result: 'SUCCESS' }, 'POST /api/remediation/:id/rollback': { result: 'ROLLED_BACK' }, ...extra });
const mount = (a = api(), role: any = 'Admin', route = '/remediation') => renderPage(<Remediation />, { api: a, role, route, path: '/remediation' });
const run = async (u: ReturnType<typeof userEvent.setup>) => {
  await u.click(await screen.findByRole('button', { name: /execute remediation/i }));
  await u.click(screen.getByRole('button', { name: /confirm & push to device/i }));
};

describe('Remediation', () => {
  it('shows the newest plan with its real commands, approval and progress', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'sw-real-01' })).toBeInTheDocument();
    expect(screen.getByLabelText('Commands').textContent).toBe('line vty 0 4\ntransport input ssh');
    expect(screen.getAllByText(/by admin/).length).toBeGreaterThan(0);
    expect(screen.getByRole('list', { name: 'Progress of this plan' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/RM-1045|cfg_2026/);
  });

  it('with no plans it says so and offers no action', async () => {
    mount(api(PLAN(), { 'GET /api/remediation': [] }));
    expect(await screen.findByText('No remediation plans yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /execute remediation/i })).not.toBeInTheDocument();
  });

  it('opens the plan named in the address', async () => {
    mount(api(PLAN({ id: 'plan-7', device_hostname: 'sw-seven' })), 'Admin', '/remediation?plan_id=plan-7');
    await screen.findByRole('heading', { name: 'sw-seven' });
    expect(calls.some((c) => c.path === '/api/remediation/plan-7')).toBe(true);
  });

  it('only an approved plan can be executed, and only by an Admin or NetworkEngineer', async () => {
    const { unmount } = mount(api(PLAN({ status: 'PENDING', approval: null })));
    expect(await screen.findByRole('button', { name: /execute remediation/i })).toBeDisabled();
    unmount();
    mount(api(PLAN({ created_by_username: 'someone-else' })), 'NetworkEngineer');
    expect(await screen.findByRole('button', { name: /execute remediation/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /rollback now/i })).not.toBeInTheDocument();
  });

  it('the person who wrote the plan cannot execute it and is told why', async () => {
    mount(api(PLAN({ created_by_username: 'neteng' })), 'NetworkEngineer');
    expect(await screen.findByRole('button', { name: /execute remediation/i })).toBeDisabled();
    expect(screen.getByText(/you wrote this plan, so a different person has to run it/i)).toBeInTheDocument();
  });

  it('Execute asks for confirmation, posts apply for this plan and reports the verified result', async () => {
    const u = userEvent.setup();
    mount();
    await run(u);
    expect(await screen.findByText(/applied and verified/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/remediation/plan-1/apply')).toBe(true);
  });

  it('a verification failure that was rolled back is shown as a warning, never as success', async () => {
    const u = userEvent.setup();
    mount(api(PLAN(), { 'POST /api/remediation/:id/apply': { result: 'ROLLED_BACK' } }));
    await run(u);
    expect(await screen.findByText(/verification failed: rolled back/i)).toBeInTheDocument();
    expect(screen.queryByText(/applied and verified/i)).not.toBeInTheDocument();
  });

  it('a rollback that could not be proven is critical', async () => {
    const u = userEvent.setup();
    mount(api(PLAN(), { 'POST /api/remediation/:id/apply': { result: 'ROLLBACK_FAILED' } }));
    await run(u);
    expect(await screen.findByText(/could not be verified/i)).toBeInTheDocument();
  });

  it('a refused apply shows the server reason and is not reported as applied', async () => {
    const u = userEvent.setup();
    mount(api(PLAN(), { 'POST /api/remediation/:id/apply': () => { throw httpError(409, 'Device is in shadow mode (report-only)'); } }));
    await run(u);
    expect(await screen.findByText(/shadow mode/i)).toBeInTheDocument();
    expect(screen.queryByText(/applied and verified/i)).not.toBeInTheDocument();
  });

  describe('when the push is handed to the worker queue', () => {
    const queued = (job: any) => api(PLAN(), { 'POST /api/remediation/:id/apply': { task_id: 'job-1', state: 'QUEUED' }, 'GET /api/remediation/jobs/:id': job });
    it('says it is queued, then reports the result when the job finishes', async () => {
      const u = userEvent.setup();
      mount(queued({ finished: true, result: { ok: true, result: 'SUCCESS' } }));
      await run(u);
      expect(await screen.findByText(/applied and verified/i)).toBeInTheDocument();
      expect(calls.some((c) => c.path === '/api/remediation/jobs/job-1')).toBe(true);
    });
    it('while the job runs it claims nothing', async () => {
      const u = userEvent.setup();
      mount(queued({ finished: false, result: null }));
      await run(u);
      expect(await screen.findByText(/queued/i)).toBeInTheDocument();
      expect(screen.queryByText(/applied and verified/i)).not.toBeInTheDocument();
    });
    it('a refusal reported by the worker is shown', async () => {
      const u = userEvent.setup();
      mount(queued({ finished: true, result: { ok: false, http_status: 409, detail: 'Another operation is running on this device' } }));
      await run(u);
      expect(await screen.findByText(/another operation is running/i)).toBeInTheDocument();
    });
  });

  it('only an Admin can roll back, and only after a push', async () => {
    const u = userEvent.setup();
    mount(api(PLAN({ status: 'APPLIED' })));
    await u.click(await screen.findByRole('button', { name: /rollback now/i }));
    await u.click(screen.getByRole('button', { name: /confirm rollback/i }));
    expect(await screen.findByText(/rolled back/i)).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/remediation/plan-1/rollback')).toBe(true);
  });

  it('a plan that was never pushed cannot be rolled back', async () => {
    mount();
    expect(await screen.findByRole('button', { name: /rollback now/i })).toBeDisabled();
  });

  it('the history of actions on a plan is listed', async () => {
    mount(api(PLAN({ status: 'APPLIED', actions: [{ id: 'a1', result: 'SUCCESS', executed_at: '2026-11-04T10:00:00', executed_commands: ['x', 'y'] }] })));
    const panel = (await screen.findByText('What happened')).closest('div')!.parentElement!;
    expect(within(panel).getByText('Success')).toBeInTheDocument();
  });
});
