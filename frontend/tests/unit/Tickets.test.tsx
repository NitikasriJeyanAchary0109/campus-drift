import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tickets } from '../../src/pages/Tickets';
import { renderPage } from '../utils';
import { calls, httpError } from '../apiMock';

const tk = (over: any = {}) => ({ id: 't1', ticket_ref: 'CHG-1', source: 'SERVICENOW', device_id: 'd1', key_path_scope: 'ntp.*', valid_from: '2026-11-04T09:00:00', valid_to: '2026-11-04T11:00:00', status: 'OPEN', ...over });
const api = (list: any[] = [tk()], extra: Record<string, unknown> = {}) => ({ 'GET /api/tickets': list, 'GET /api/devices': [{ id: 'd1', hostname: 'sw-real-01' }, { id: 'd2', hostname: 'sw-two' }], 'POST /api/tickets': { id: 'new' }, ...extra });
const mount = (a = api(), role: any = 'Admin') => renderPage(<Tickets />, { role, api: a });
const rows = () => screen.getAllByRole('row').slice(1);

describe('Change tickets', () => {
  it('lists only server tickets, attributed to the real device', async () => {
    mount(api([tk(), tk({ id: 't2', ticket_ref: 'CHG-2', device_id: null, source: 'JIRA' })]));
    await screen.findByText('CHG-1');
    expect(rows()).toHaveLength(2);
    expect(screen.getByText('sw-real-01')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/CHG-10584|sw-lab-03/);
  });

  it('a ticket without a device is not attributed to an invented one', async () => {
    mount(api([tk({ device_id: null })]));
    await screen.findByText('CHG-1');
    expect(screen.getByText('All devices in scope')).toBeInTheDocument();
  });

  it('empty and failed states are explicit', async () => {
    const { unmount } = mount(api([]));
    expect(await screen.findByText('No tickets yet')).toBeInTheDocument();
    unmount();
    mount(api([], { 'GET /api/tickets': () => { throw httpError(500, 'boom'); } }));
    expect(await screen.findByText('Could not load tickets')).toBeInTheDocument();
  });

  it('by default nothing is hidden: a Jira ticket and a closed ticket are listed', async () => {
    mount(api([tk(), tk({ id: 't2', ticket_ref: 'JIRA-9', source: 'JIRA', status: 'EXPIRED' })]));
    await screen.findByText('JIRA-9');
    expect(rows()).toHaveLength(2);
    expect(screen.getByText('Expired')).toBeInTheDocument();         // the real status, not "Completed"
  });

  it('search and filters narrow the list', async () => {
    const u = userEvent.setup();
    mount(api([tk(), tk({ id: 't2', ticket_ref: 'JIRA-9', source: 'JIRA', device_id: 'd2' })]));
    await screen.findByText('JIRA-9');
    await u.type(screen.getByLabelText('Search tickets'), 'sw-two');
    expect(rows()).toHaveLength(1);
    await u.clear(screen.getByLabelText('Search tickets'));
    await u.click(screen.getByRole('button', { name: /filters/i }));
    await u.selectOptions(screen.getByLabelText('Source'), 'SERVICENOW');
    expect(within(rows()[0]).getByText('CHG-1')).toBeInTheDocument();
  });

  it('a Viewer cannot create tickets', async () => {
    mount(api(), 'Viewer');
    await screen.findByText('CHG-1');
    expect(screen.queryByRole('button', { name: /new ticket/i })).not.toBeInTheDocument();
  });

  it('rejects a window that ends before it starts, on the client', async () => {
    const u = userEvent.setup();
    mount();
    await u.click(await screen.findByRole('button', { name: /new ticket/i }));
    await u.type(screen.getByLabelText('Ticket reference'), 'CHG-9');
    await u.type(screen.getByLabelText('Window starts'), '2026-11-05T12:00');
    await u.type(screen.getByLabelText('Window ends'), '2026-11-05T10:00');
    await u.click(screen.getByRole('button', { name: /create ticket/i }));
    expect(await screen.findByText(/end of the window must be after its start/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('creating a ticket sends the chosen device and the window', async () => {
    const u = userEvent.setup();
    mount();
    await u.click(await screen.findByRole('button', { name: /new ticket/i }));
    await u.type(screen.getByLabelText('Ticket reference'), ' CHG-9 ');
    await u.selectOptions(screen.getByLabelText('Device'), 'd2');
    await u.type(screen.getByLabelText('Window starts'), '2026-11-05T10:00');
    await u.type(screen.getByLabelText('Window ends'), '2026-11-05T12:00');
    await u.click(screen.getByRole('button', { name: /create ticket/i }));
    expect(await screen.findByText(/ticket CHG-9 was created/i)).toBeInTheDocument();
    const body = calls.find((c) => c.method === 'POST' && c.path === '/api/tickets')!.body;
    expect(body).toMatchObject({ ticket_ref: 'CHG-9', device_id: 'd2', key_path_scope: '*' });
    expect(new Date(body.valid_to) > new Date(body.valid_from)).toBe(true);
  });

  it('a refused ticket shows the server reason in the dialog', async () => {
    const u = userEvent.setup();
    mount(api([tk()], { 'POST /api/tickets': () => { throw httpError(409, 'Ticket reference already exists'); } }));
    await u.click(await screen.findByRole('button', { name: /new ticket/i }));
    await u.type(screen.getByLabelText('Ticket reference'), 'CHG-1');
    await u.type(screen.getByLabelText('Window starts'), '2026-11-05T10:00');
    await u.type(screen.getByLabelText('Window ends'), '2026-11-05T12:00');
    await u.click(screen.getByRole('button', { name: /create ticket/i }));
    expect(await screen.findByText('Ticket reference already exists')).toBeInTheDocument();
  });
});
