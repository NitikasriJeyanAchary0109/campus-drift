import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DriftEvents } from '../../src/pages/DriftEvents';
import { renderPage } from '../utils';
import { calls, httpError } from '../apiMock';

const ev = (over: any = {}) => ({ id: 'e1', device_id: 'd1', device_hostname: 'sw-real-01', label: 'Drift-Unauthorized-Medium', risk_score: 60, status: 'OPEN', detected_at: '2026-11-04T09:00:00', matched_ticket_ref: null, details_count: 1, ...over });
const mount = (list: any, role: any = 'Admin') => renderPage(<DriftEvents />, { role, api: { 'GET /api/drift': list } });
const rows = () => screen.getAllByRole('row').slice(1);

describe('Problems', () => {
  it('lists only what the server returned, most serious first, then newest', async () => {
    mount([ev({ id: 'a', device_hostname: 'low', risk_score: 40 }), ev({ id: 'b', device_hostname: 'high', risk_score: 95, label: 'Non-Compliant (Critical)' }), ev({ id: 'c', device_hostname: 'mid-new', risk_score: 60, detected_at: '2026-11-05T09:00:00' }), ev({ id: 'd', device_hostname: 'mid-old', risk_score: 60 })]);
    await screen.findByText('high');
    expect(rows().map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(['high', 'mid-new', 'mid-old', 'low']);
    expect(screen.getByText(/of 4 problems/)).toBeInTheDocument();
  });

  it('with no events it is empty: no sample rows', async () => {
    mount([]);
    expect(await screen.findByText('No problems found')).toBeInTheDocument();
    expect(screen.queryAllByRole('row')).toHaveLength(0);
  });

  it('a failed request is reported with a retry instead of an empty table', async () => {
    mount(() => { throw httpError(500, 'database is down'); });
    expect(await screen.findByText('Could not load problems')).toBeInTheDocument();
    expect(screen.getByText(/database is down/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows the server label and the real device name; a missing name is not replaced by another device', async () => {
    mount([ev({ label: 'Non-Compliant (Critical)', risk_score: 20 }), ev({ id: 'x', device_hostname: null, risk_score: 10 })]);
    await screen.findByText('sw-real-01');
    expect(within(rows()[0]).getByText('Critical')).toBeInTheDocument();         // follows the label, not the score
    expect(screen.getByText('Unknown device')).toBeInTheDocument();
  });

  it('open problems are shown by default; "Open and closed" adds the rest', async () => {
    const u = userEvent.setup();
    mount([ev(), ev({ id: 'z', device_hostname: 'closed-one', status: 'FALSE_POSITIVE' })]);
    await screen.findByText('sw-real-01');
    expect(screen.queryByText('closed-one')).not.toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /filters/i }));
    await u.selectOptions(screen.getByLabelText('Show'), 'all');
    expect(screen.getByText('closed-one')).toBeInTheDocument();
  });

  it('search and the problem-type filter narrow the list', async () => {
    const u = userEvent.setup();
    mount([ev(), ev({ id: 'h', device_hostname: 'sw-hostel', label: 'Drift-Unauthorized-High', risk_score: 85 })]);
    await screen.findByText('sw-hostel');
    await u.type(screen.getByLabelText('Search problems'), 'hostel');
    expect(rows()).toHaveLength(1);
    await u.clear(screen.getByLabelText('Search problems'));
    await u.click(screen.getByRole('button', { name: /filters/i }));
    await u.selectOptions(screen.getByLabelText('Problem type'), 'Drift-Unauthorized-Medium');
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]).getByText('sw-real-01')).toBeInTheDocument();
  });

  it('shows 10 per page with working page buttons', async () => {
    const u = userEvent.setup();
    mount(Array.from({ length: 12 }, (_, i) => ev({ id: `p${i}`, device_hostname: `sw-${String(i).padStart(2, '0')}`, risk_score: 90 - i })));
    await screen.findByText('sw-00');
    expect(rows()).toHaveLength(10);
    await u.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(rows()).toHaveLength(2);
  });

  it('every row opens that problem', async () => {
    const u = userEvent.setup();
    renderPage(<DriftEvents />, { api: { 'GET /api/drift': [ev({ id: 'abc' })] } });
    await u.click(await screen.findByRole('link', { name: /review/i }));
    expect(screen.getByTestId('where').textContent).toBe('/drift/abc');
    expect(calls[0].path).toBe('/api/drift');
  });

  it('the ticket that covers a problem is shown', async () => {
    mount([ev({ matched_ticket_ref: 'CHG-77', label: 'Drift-Authorized' })]);
    expect(await screen.findByText('CHG-77')).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(1));
  });
});
