import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeviceDetails } from '../../src/pages/DeviceDetails';
import { renderPage } from '../utils';
import { calls, httpError } from '../apiMock';

const DEV = (over: any = {}) => ({ id: 'd1', hostname: 'sw-real-01', ip_address: '10.1.1.1', vendor: 'cisco_ios', model: 'C2960X', status: 'ONLINE', last_polled_at: '2026-11-04T09:00:00', device_group: { name: 'Hostels' }, has_credentials: true, collection_mode: 'SSH_POLL', shadow_mode: false, latest_snapshot: { id: 's1', collected_at: '2026-11-04T09:00:00', collection_method: 'SSH' }, ...over });
const api = (d: any = DEV(), extra: Record<string, unknown> = {}) => ({ 'GET /api/devices/:id': d, 'GET /api/drift': [{ id: 'e1', label: 'Drift-Unauthorized-High', risk_score: 85, detected_at: '2026-11-04T09:00:00', status: 'OPEN' }], 'POST /api/devices/:id/poll': { message: 'Collection queued' }, 'POST /api/devices/:id/credentials': { ok: true }, ...extra });
const mount = (a = api(), role: any = 'Admin', id = 'd1') => renderPage(<DeviceDetails />, { api: a, role, route: `/devices/${id}`, path: '/devices/:id' });

describe('Device details', () => {
  it('shows the real device, its latest snapshot and its open problems', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'sw-real-01' })).toBeInTheDocument();
    expect(screen.getByText('10.1.1.1')).toBeInTheDocument();
    expect(screen.getByText('Stored (encrypted)')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Review' })).toHaveAttribute('href', '/drift/e1');
    expect(document.body.textContent).not.toContain('sw-lab-03');
  });

  it('an unknown device is reported as not found', async () => {
    mount(api(DEV(), { 'GET /api/devices/:id': () => { throw httpError(404, 'Device not found'); } }), 'Admin', 'nope');
    expect(await screen.findByText('Device not found')).toBeInTheDocument();
  });

  it('shows whether credentials are stored, and the last collection as Never when there was none', async () => {
    mount(api(DEV({ has_credentials: false, last_polled_at: null, latest_snapshot: null })));
    expect(await screen.findByText('Not stored')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.getByText('None yet')).toBeInTheDocument();
  });

  it('a device with no open problems says it matches its baseline', async () => {
    mount(api(DEV(), { 'GET /api/drift': [] }));
    expect(await screen.findByText(/no open problems/i)).toBeInTheDocument();
  });

  it('Collect now posts and shows the server message; a failure is shown as a failure', async () => {
    const u = userEvent.setup();
    mount();
    await u.click(await screen.findByRole('button', { name: /collect now/i }));
    expect(await screen.findByText('Collection queued')).toBeInTheDocument();
  });

  it('a refused collection is not drawn as a success', async () => {
    const u = userEvent.setup();
    mount(api(DEV(), { 'POST /api/devices/:id/poll': () => { throw httpError(409, 'Device is busy'); } }));
    await u.click(await screen.findByRole('button', { name: /collect now/i }));
    expect(await screen.findByText(/device is busy/i)).toBeInTheDocument();
    expect(screen.queryByText('Collection queued')).not.toBeInTheDocument();
  });

  it('a Viewer cannot collect and cannot set credentials; a NetworkEngineer can collect but not set credentials', async () => {
    const { unmount } = mount(api(), 'Viewer');
    await screen.findByRole('heading', { name: 'sw-real-01' });
    expect(screen.queryByRole('button', { name: /collect now/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ssh credentials/i })).not.toBeInTheDocument();
    unmount();
    mount(api(), 'NetworkEngineer');
    expect(await screen.findByRole('button', { name: /collect now/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ssh credentials/i })).not.toBeInTheDocument();
  });

  it('the secret is sent exactly as typed, spaces included', async () => {
    const u = userEvent.setup();
    mount();
    await u.click(await screen.findByRole('button', { name: /ssh credentials/i }));
    await u.type(screen.getByLabelText('Username'), 'netops');
    await u.type(screen.getByLabelText('Password'), ' pa ss ');
    await u.click(screen.getByRole('button', { name: /save credentials/i }));
    expect(await screen.findByText(/credentials saved/i)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/devices/d1/credentials')?.body).toEqual({ username: 'netops', secret: ' pa ss ', auth_type: 'password' });
  });

  it('choosing an SSH key offers a multi-line field', async () => {
    const u = userEvent.setup();
    mount();
    await u.click(await screen.findByRole('button', { name: /ssh credentials/i }));
    await u.selectOptions(screen.getByLabelText('Sign in with'), 'ssh_key');
    expect(screen.getByLabelText('Private key').tagName).toBe('TEXTAREA');
  });

  it('a failed credential save shows the reason and keeps the dialog open', async () => {
    const u = userEvent.setup();
    mount(api(DEV(), { 'POST /api/devices/:id/credentials': () => { throw httpError(422, 'Secret is too short'); } }));
    await u.click(await screen.findByRole('button', { name: /ssh credentials/i }));
    await u.type(screen.getByLabelText('Username'), 'u');
    await u.type(screen.getByLabelText('Password'), 'x');
    await u.click(screen.getByRole('button', { name: /save credentials/i }));
    expect(await screen.findByText('Secret is too short')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
