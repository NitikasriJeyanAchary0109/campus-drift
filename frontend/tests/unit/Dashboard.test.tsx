import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Dashboard } from '../../src/pages/Dashboard';
import { renderPage } from '../utils';
import { calls, httpError } from '../apiMock';

const alert = (over: any = {}) => ({ id: 'a1', type: 'CRITICAL_DRIFT', related_id: 'ev-1', message: 'Drift on sw-1', acknowledged: false, created_at: '2026-11-04T10:00:00', ...over });
const api = (over: Record<string, unknown> = {}) => ({
  'GET /api/dashboard/summary': { total_devices: 3, compliance_percentage: 66.7 },
  'GET /api/alerts': [alert(), alert({ id: 'a2', type: 'DEVICE_DOWN', related_id: 'dev-9', message: 'sw-2 is down' }), alert({ id: 'a3', acknowledged: true, message: 'old one' })],
  'GET /api/approvals/pending': [{ id: 'p1' }],
  ...over,
});

describe('Home', () => {
  it('shows the server numbers: devices, compliance to one decimal, unacknowledged alerts and pending approvals', async () => {
    renderPage(<Dashboard />, { api: api() });
    const kpi = (label: string) => screen.getByText(label).nextElementSibling!.textContent;
    await waitFor(() => expect(kpi('Total Devices Managed')).toBe('3'));
    expect(kpi('Campus Compliance')).toBe('66.7%');
    expect(kpi('Active Unacknowledged Alerts')).toBe('2');
    expect(kpi('Pending Approvals')).toBe('1');
  });

  it('never shows an invented number: a dash while loading, and no numbers when the API fails', async () => {
    renderPage(<Dashboard />, { api: { ...api(), 'GET /api/dashboard/summary': () => new Promise(() => {}) } });
    expect(screen.getByText('Total Devices Managed').nextElementSibling!.textContent).toBe('—');
    expect(screen.queryByText('132')).not.toBeInTheDocument();
    expect(screen.queryByText('92.4%')).not.toBeInTheDocument();
  });

  it('a failed request says so and offers a retry, with no sample figures', async () => {
    renderPage(<Dashboard />, { api: api({ 'GET /api/dashboard/summary': () => { throw httpError(500); }, 'GET /api/alerts': () => { throw httpError(500); } }) });
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText('Total Devices Managed').nextElementSibling!.textContent).toBe('—');
  });

  it('zero unacknowledged alerts is 0 and the banner says all clear', async () => {
    renderPage(<Dashboard />, { api: api({ 'GET /api/alerts': [alert({ acknowledged: true })] }) });
    expect(await screen.findByText('All clear')).toBeInTheDocument();
    expect(screen.getByText('Active Unacknowledged Alerts').nextElementSibling!.textContent).toBe('0');
    expect(screen.getByText('Nothing needs your attention')).toBeInTheDocument();
  });

  it('a banner counts the problems and "Needs attention" lists only the unacknowledged alerts, each with a link to where it can be handled', async () => {
    renderPage(<Dashboard />, { api: api() });
    expect(await screen.findByText('2 problems need your attention')).toBeInTheDocument();
    expect(screen.getByText('Drift on sw-1')).toBeInTheDocument();
    expect(screen.queryByText('old one')).not.toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /investigate/i });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/drift/ev-1', '/devices/dev-9']);
    expect(screen.getByRole('link', { name: /review problems/i })).toHaveAttribute('href', '/drift');
  });

  it('a Viewer sees no sweep button and no approvals count', async () => {
    renderPage(<Dashboard />, { api: api(), role: 'Viewer' });
    await screen.findByText('2 problems need your attention');
    expect(screen.queryByRole('button', { name: /trigger campus sweep/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Pending Approvals')).not.toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/approvals/pending')).toBe(false);
  });

  it('"Trigger Campus Sweep" starts a collection on every SSH-managed device and reports the real count', async () => {
    const devices = [{ id: 'd1', collection_mode: 'SSH_POLL' }, { id: 'd2', collection_mode: 'SSH_POLL' }, { id: 'd3', collection_mode: 'MANUAL_UPLOAD' }];
    renderPage(<Dashboard />, { api: api({ 'GET /api/devices': devices, 'POST /api/devices/:id/poll': { status: 'ACCEPTED' } }) });
    await screen.findByText('2 problems need your attention');
    fireEvent.click(screen.getByRole('button', { name: /trigger campus sweep/i }));
    expect(await screen.findByText(/collection started on 2 devices/i)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path).sort()).toEqual(['/api/devices/d1/poll', '/api/devices/d2/poll']);
  });

  it('a sweep that fails for some devices says how many', async () => {
    const devices = [{ id: 'd1', collection_mode: 'SSH_POLL' }, { id: 'd2', collection_mode: 'SSH_POLL' }];
    renderPage(<Dashboard />, { api: api({ 'GET /api/devices': devices, 'POST /api/devices/d1/poll': { status: 'ACCEPTED' }, 'POST /api/devices/d2/poll': () => { throw httpError(409, 'busy'); } }) });
    await screen.findByText('2 problems need your attention');
    fireEvent.click(screen.getByRole('button', { name: /trigger campus sweep/i }));
    expect(await screen.findByText(/started on 1 of 2 devices; 1 could not be started/i)).toBeInTheDocument();
  });
});
