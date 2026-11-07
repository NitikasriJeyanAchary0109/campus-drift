import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Devices } from '../../src/pages/Devices';
import { renderPage } from '../utils';
import { calls, httpError } from '../apiMock';

const dev = (over: any = {}) => ({ id: 'd1', hostname: 'sw-real-01', ip_address: '10.1.1.1', vendor: 'cisco_ios', model: 'C2960X', status: 'ONLINE', last_polled_at: '2026-11-04T09:00:00', device_group: { id: 'g1', name: 'Hostels' }, collection_mode: 'SSH_POLL', ...over });
const api = (list: any[] = [dev()], extra: Record<string, unknown> = {}) => ({
  'GET /api/devices': list, 'GET /api/drift': [], 'GET /api/devices/groups': [{ id: 'g1', name: 'Hostels' }, { id: 'g2', name: 'Labs' }], 'POST /api/devices/:id/poll': { message: 'Collection queued' }, ...extra,
});
const mount = (a = api(), role: any = 'Admin') => renderPage(<Devices />, { role, api: a });
const rows = () => screen.getAllByRole('row').slice(1);

describe('Devices', () => {
  it('lists the devices the server returned and counts them from the data', async () => {
    mount(api([dev(), dev({ id: 'd2', hostname: 'sw-two' }), dev({ id: 'd3', hostname: 'sw-three', status: 'UNREACHABLE' })], { 'GET /api/drift': [{ id: 'e1', device_id: 'd2', label: 'Non-Compliant (Critical)' }] }));
    await screen.findByText('sw-two');
    expect(rows()).toHaveLength(3);
    expect(screen.getByText('3 devices: 1 compliant, 1 drifted, 1 unreachable.')).toBeInTheDocument();
  });

  it('an empty inventory is empty, with no sample devices', async () => {
    mount(api([]));
    expect(await screen.findByText('No devices yet')).toBeInTheDocument();
    expect(screen.queryAllByRole('row')).toHaveLength(0);
  });

  it('a failed request is reported with a retry', async () => {
    mount(api([], { 'GET /api/devices': () => { throw httpError(500, 'boom'); } }));
    expect(await screen.findByText('Could not load devices')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('compliance comes from the open problems of that device, never from its hostname', async () => {
    mount(api([dev({ id: 'x', hostname: 'sw-hostel-01' }), dev({ id: 'y', hostname: 'sw-lab-03' })]));
    await screen.findByText('sw-lab-03');
    expect(screen.getAllByText('Compliant')).toHaveLength(2);
    expect(screen.queryByText(/Drifted \(/)).not.toBeInTheDocument();
  });

  it('a device that was never collected says so and a missing zone is a dash', async () => {
    mount(api([dev({ last_polled_at: null, device_group: null })]));
    await screen.findByText('sw-real-01');
    expect(within(rows()[0]).getByText('Never')).toBeInTheDocument();
    expect(within(rows()[0]).getByText('Not checked yet')).toBeInTheDocument();
    expect(within(rows()[0]).getByText('—')).toBeInTheDocument();
  });

  it('search and the zone filter narrow the list, and the page footer counts the filtered list', async () => {
    const u = userEvent.setup();
    mount(api([dev(), dev({ id: 'd2', hostname: 'lab-1', device_group: { id: 'g2', name: 'Labs' } })]));
    await screen.findByText('lab-1');
    await u.type(screen.getByLabelText('Search devices'), 'lab');
    expect(rows()).toHaveLength(1);
    expect(screen.getByText(/of 1 devices/)).toBeInTheDocument();
    await u.clear(screen.getByLabelText('Search devices'));
    await u.click(screen.getByRole('button', { name: /filters/i }));
    await u.selectOptions(screen.getByLabelText('Zone'), 'Hostels');
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('sw-real-01')).toBeInTheDocument();
  });

  it('filtering goes back to page 1 so results are never hidden on an out-of-range page', async () => {
    const u = userEvent.setup();
    mount(api(Array.from({ length: 12 }, (_, i) => dev({ id: `d${i}`, hostname: i === 11 ? 'zz-target' : `sw-${String(i).padStart(2, '0')}` }))));
    await screen.findByText('sw-00');
    await u.click(screen.getByRole('button', { name: 'Page 2' }));
    await u.type(screen.getByLabelText('Search devices'), 'zz-target');
    expect(await screen.findByText('zz-target')).toBeInTheDocument();
  });

  it('"Collect now" posts to that device and reports the server message; a failure is reported too', async () => {
    const u = userEvent.setup();
    mount();
    await u.click(await screen.findByRole('button', { name: 'Collect sw-real-01 now' }));
    expect(await screen.findByText('Collection queued')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/devices/d1/poll')).toBe(true);
  });

  it('a failed collection is not drawn as a success', async () => {
    const u = userEvent.setup();
    mount(api([dev()], { 'POST /api/devices/:id/poll': () => { throw httpError(502, 'SSH timeout'); } }));
    await u.click(await screen.findByRole('button', { name: 'Collect sw-real-01 now' }));
    expect(await screen.findByText(/SSH timeout/)).toBeInTheDocument();
    expect(screen.queryByText('Collection queued')).not.toBeInTheDocument();
  });

  it('"Start Campus Sweep" starts one collection per SSH-managed device and says how many', async () => {
    const u = userEvent.setup();
    mount(api([dev(), dev({ id: 'd2', hostname: 'b' }), dev({ id: 'd3', hostname: 'c', collection_mode: 'MANUAL_UPLOAD' })]));
    await u.click(await screen.findByRole('button', { name: /start campus sweep/i }));
    expect(await screen.findByText(/collection started on 2 devices/i)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path).sort()).toEqual(['/api/devices/d1/poll', '/api/devices/d2/poll']);
  });

  it('a sweep when the device list cannot be read is not reported as a success', async () => {
    const u = userEvent.setup();
    let n = 0;
    mount(api([dev()], { 'GET /api/devices': () => { n += 1; if (n > 1) throw httpError(500, 'down'); return [dev()]; } }));
    await u.click(await screen.findByRole('button', { name: /start campus sweep/i }));
    expect(await screen.findByText(/sweep did not start/i)).toBeInTheDocument();
  });

  it('only an Admin can add a device; a NetworkEngineer and a Viewer cannot', async () => {
    mount(api(), 'NetworkEngineer');
    await screen.findByText('sw-real-01');
    expect(screen.queryByRole('button', { name: /add device/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start campus sweep/i })).toBeInTheDocument();
  });

  it('a Viewer cannot collect or sweep', async () => {
    mount(api(), 'Viewer');
    await screen.findByText('sw-real-01');
    expect(screen.queryByRole('button', { name: /collect/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sweep/i })).not.toBeInTheDocument();
  });

  it('Add device posts the form, shows a server error in the dialog, and a reopened dialog starts clean', async () => {
    const u = userEvent.setup();
    mount(api([dev()], { 'POST /api/devices': () => { throw httpError(409, 'Hostname already exists'); } }));
    await screen.findByText('sw-real-01');
    await u.click(screen.getByRole('button', { name: /add device/i }));
    await u.type(screen.getByLabelText('Hostname'), 'sw-new');
    await u.type(screen.getByLabelText('IP address'), '10.9.9.9');
    await u.type(screen.getByLabelText('Model'), 'C9300');
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^add device$/i }));
    expect(await screen.findByText('Hostname already exists')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/devices')?.body).toMatchObject({ hostname: 'sw-new', ip_address: '10.9.9.9', model: 'C9300', device_group_id: 'g1' });
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: /cancel/i }));
    await u.click(screen.getByRole('button', { name: /add device/i }));
    await waitFor(() => expect(screen.queryByText('Hostname already exists')).not.toBeInTheDocument());
    expect((screen.getByLabelText('Hostname') as HTMLInputElement).value).toBe('');
  });
});
