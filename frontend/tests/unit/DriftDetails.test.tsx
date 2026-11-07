import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DriftDetails } from '../../src/pages/DriftDetails';
import { renderPage } from '../utils';
import { calls, httpError } from '../apiMock';

const EV = (over: any = {}) => ({
  id: 'ev-9', device_id: 'dev-9', device_hostname: 'sw-real-09', label: 'Non-Compliant (Critical)', risk_score: 88, status: 'OPEN', detected_at: '2026-11-04T09:00:00',
  details: [{ id: 'd1', key_path: 'line.vty.transport_input', expected_value: 'ssh', actual_value: 'ssh telnet', change_type: 'MODIFIED', why_it_matters: 'Telnet is unencrypted', source_line: ' transport input ssh telnet', source_line_number: 7 }],
  evidence_bundle: { why_it_matters_summary: 'Telnet allows plaintext management.' }, ...over,
});
const api = (ev: any = EV(), extra: Record<string, unknown> = {}) => ({
  'GET /api/drift/:id': ev, 'POST /api/remediation/:id/generate-plan': { id: 'plan-real-1' }, 'POST /api/drift/:id/mark-false-positive': { ok: true }, ...extra,
});
const mount = (a = api(), role: any = 'Admin', id = 'ev-9') => renderPage(<DriftDetails />, { api: a, role, route: `/drift/${id}`, path: '/drift/:id' });

describe('Problem details', () => {
  it('shows this event: device, server label, risk, and each change as expected against actual', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'sw-real-09' })).toBeInTheDocument();
    expect(calls[0].path).toBe('/api/drift/ev-9');
    expect(screen.getByText('Non-Compliant (Critical)')).toBeInTheDocument();
    expect(screen.getByText(/Risk 88 of 100/)).toBeInTheDocument();
    expect(screen.getByText('line.vty.transport_input')).toBeInTheDocument();
    expect(screen.getByText('ssh telnet')).toBeInTheDocument();
    expect(screen.getByText('Telnet allows plaintext management.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('sw-lab-03');
  });

  it('an unknown id is reported as not found, not as another device', async () => {
    mount(api(EV(), { 'GET /api/drift/:id': () => { throw httpError(404, 'Drift event not found'); } }), 'Admin', 'nope');
    expect(await screen.findByText('Problem not found')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('sw-lab-03');
  });

  it('when a plan already exists the error links to Approvals', async () => {
    const u = userEvent.setup();
    mount(api(EV(), { 'POST /api/remediation/:id/generate-plan': () => { throw httpError(409, 'This problem already has a pending remediation plan (p1). Decide on or apply that one first.') } }));
    await u.click(await screen.findByRole('button', { name: /create remediation/i }));
    expect(await screen.findByText(/already has a pending remediation plan/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Approvals' })).toHaveAttribute('href', '/approvals');
  });

  it('Create Remediation posts for this event and reports the real plan id', async () => {
    mount();
    await userEvent.setup().click(await screen.findByRole('button', { name: /create remediation/i }));
    expect(await screen.findByText(/plan-real-1/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/remediation/ev-9/generate-plan')).toBe(true);
    expect(screen.getByRole('link', { name: /open approvals/i })).toHaveAttribute('href', '/approvals');
  });

  it('when the server refuses, the reason is shown and no plan is claimed', async () => {
    mount(api(EV(), { 'POST /api/remediation/:id/generate-plan': () => { throw httpError(409, 'Device is in shadow mode') } }));
    await userEvent.setup().click(await screen.findByRole('button', { name: /create remediation/i }));
    expect(await screen.findByText(/shadow mode/i)).toBeInTheDocument();
    expect(screen.queryByText(/plan created/i)).not.toBeInTheDocument();
  });

  it('Close Event needs a reason of 5+ characters and posts the trimmed text', async () => {
    const u = userEvent.setup();
    mount();
    await u.click(await screen.findByRole('button', { name: /close event/i }));
    const confirm = screen.getByRole('button', { name: /confirm closure/i });
    expect(confirm).toBeDisabled();
    await u.type(screen.getByLabelText(/why is this not a problem/i), '  expected change  ');
    expect(confirm).toBeEnabled();
    await u.click(confirm);
    await waitFor(() => expect(calls.find((c) => c.path === '/api/drift/ev-9/mark-false-positive')?.body).toEqual({ comment: 'expected change' }));
    expect(await screen.findByText(/closed as not a problem/i)).toBeInTheDocument();
  });

  it('a refused closure is not announced as done', async () => {
    const u = userEvent.setup();
    mount(api(EV(), { 'POST /api/drift/:id/mark-false-positive': () => { throw httpError(403, 'Insufficient role') } }));
    await u.click(await screen.findByRole('button', { name: /close event/i }));
    await u.type(screen.getByLabelText(/why is this not a problem/i), 'not a real change');
    await u.click(screen.getByRole('button', { name: /confirm closure/i }));
    expect(await screen.findByText(/insufficient role/i)).toBeInTheDocument();
    expect(screen.queryByText(/closed as not a problem/i)).not.toBeInTheDocument();
  });

  it('a Viewer can read but is offered no action', async () => {
    mount(api(), 'Viewer');
    await screen.findByRole('heading', { name: 'sw-real-09' });
    expect(screen.queryByRole('button', { name: /create remediation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /close event/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download diff/i })).toBeInTheDocument();
  });

  it('a closed problem cannot get a second plan or be closed again', async () => {
    mount(api(EV({ status: 'FALSE_POSITIVE' })));
    expect(await screen.findByRole('button', { name: /create remediation/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /close event/i })).toBeDisabled();
  });

  it('Download diff exports this event under its own device name', async () => {
    mount();
    await screen.findByRole('heading', { name: 'sw-real-09' });
    let name = '';
    let blobText = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { name = this.download; });
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((b: any) => { const r = new FileReader(); r.onload = () => { blobText = String(r.result); }; r.readAsText(b); return 'blob:x'; });
    await userEvent.setup().click(screen.getByRole('button', { name: /download diff/i }));
    click.mockRestore(); create.mockRestore();
    expect(name).toBe('diff-sw-real-09-ev-9.txt');
    await waitFor(() => expect(blobText).toContain('+ ssh telnet'));
    expect(blobText).toContain('- ssh');
  });
});
