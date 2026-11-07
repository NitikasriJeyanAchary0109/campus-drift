import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Baselines } from '../../src/pages/Baselines';
import { BaselineDetails } from '../../src/pages/BaselineDetails';
import { renderPage } from '../utils';
import { calls, httpError } from '../apiMock';

const bl = (over: any = {}) => ({ id: 'b1', name: 'Campus switch standard', device_group_name: 'Hostels', vendor: 'cisco_ios', version: 2, is_active: true, created_at: '2026-11-01T09:00:00', rules_count: 6, ...over });
const api = (list: any[] = [bl()], extra: Record<string, unknown> = {}) => ({ 'GET /api/baselines': list, 'GET /api/devices/groups': [{ id: 'g1', name: 'Hostels' }], 'PUT /api/baselines/:id/activate': { ok: true }, 'POST /api/baselines': { name: 'New', version: 3 }, ...extra });
const mount = (a = api(), role: any = 'Admin') => renderPage(<Baselines />, { role, api: a });
const rows = () => screen.getAllByRole('row').slice(1);

describe('Baselines', () => {
  it('lists only the baselines on the server, active first', async () => {
    mount(api([bl({ id: 'x', name: 'Draft one', is_active: false }), bl()]));
    await screen.findByText('Campus switch standard');
    expect(rows().map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Campus switch standard', 'Draft one']);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Not active')).toBeInTheDocument();
  });

  it('empty and failed states are explicit, with no reference baselines', async () => {
    const { unmount } = mount(api([]));
    expect(await screen.findByText('No baselines yet')).toBeInTheDocument();
    unmount();
    mount(api([], { 'GET /api/baselines': () => { throw httpError(500, 'boom'); } }));
    expect(await screen.findByText('Could not load baselines')).toBeInTheDocument();
  });

  it('a baseline links to its rules', async () => {
    mount();
    expect(await screen.findByRole('link', { name: 'Campus switch standard' })).toHaveAttribute('href', '/baselines/b1');
  });

  it('only an Admin sees Activate, and only for a baseline that is not active', async () => {
    const u = userEvent.setup();
    mount(api([bl(), bl({ id: 'x', name: 'Draft one', is_active: false })]));
    await u.click(await screen.findByRole('button', { name: 'Activate' }));
    expect(await screen.findByText(/is now active/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT' && c.path === '/api/baselines/x/activate')).toBe(true);
  });

  it('a NetworkEngineer can create but not activate; a Viewer can do neither', async () => {
    const { unmount } = mount(api([bl({ is_active: false })]), 'NetworkEngineer');
    await screen.findByText('Campus switch standard');
    expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new baseline/i })).toBeInTheDocument();
    unmount();
    mount(api(), 'Viewer');
    await screen.findByText('Campus switch standard');
    expect(screen.queryByRole('button', { name: /new baseline/i })).not.toBeInTheDocument();
  });

  it('a refused activation is shown as an error', async () => {
    const u = userEvent.setup();
    mount(api([bl({ is_active: false })], { 'PUT /api/baselines/:id/activate': () => { throw httpError(409, 'Another version is being used by a plan'); } }));
    await u.click(await screen.findByRole('button', { name: 'Activate' }));
    expect(await screen.findByText(/being used by a plan/i)).toBeInTheDocument();
  });

  it('New baseline posts the YAML, and a server error stays in the dialog', async () => {
    const u = userEvent.setup();
    mount(api([bl()], { 'POST /api/baselines': () => { throw httpError(422, 'Failed to parse YAML baseline'); } }));
    await u.click(await screen.findByRole('button', { name: /new baseline/i }));
    await u.click(screen.getByRole('button', { name: /create baseline/i }));
    expect(await screen.findByText(/failed to parse yaml/i)).toBeInTheDocument();
    const body = calls.find((c) => c.method === 'POST' && c.path === '/api/baselines')!.body;
    expect(body.yaml_content).toContain('rules:');
    expect(body.device_group_id).toBe('g1');
  });

  it('a created baseline is reported and starts not active', async () => {
    const u = userEvent.setup();
    mount();
    await u.click(await screen.findByRole('button', { name: /new baseline/i }));
    await u.click(screen.getByRole('button', { name: /create baseline/i }));
    expect(await screen.findByText(/was created. activate it/i)).toBeInTheDocument();
  });
});

describe('Baseline details', () => {
  const rule = (over: any = {}) => ({ id: 'r1', key_path: 'line.vty.transport_input', expected_value: 'ssh', rule_type: 'EXACT', severity_weight: 90, hard_compliance: true, description: 'No telnet', ...over });
  const mountDetails = (a: Record<string, unknown>, id = 'b1') => renderPage(<BaselineDetails />, { api: a, route: `/baselines/${id}`, path: '/baselines/:id' });

  it('shows this baseline and its own rules from the server', async () => {
    mountDetails({ 'GET /api/baselines/:id': bl(), 'GET /api/baselines/:id/rules': [rule(), rule({ id: 'r2', key_path: 'ntp.server', expected_value: '10.0.0.1', hard_compliance: false })] });
    expect(await screen.findByRole('heading', { name: 'Campus switch standard' })).toBeInTheDocument();
    expect(await screen.findByText('line.vty.transport_input')).toBeInTheDocument();
    expect(screen.getByText('ntp.server')).toBeInTheDocument();
    expect(screen.getAllByText('Hard rule').length).toBeGreaterThan(1);
    expect(document.body.textContent).not.toContain('94.8%');
  });

  it('an unknown baseline is reported as not found', async () => {
    mountDetails({ 'GET /api/baselines/:id': () => { throw httpError(404, 'nope'); }, 'GET /api/baselines/:id/rules': [] }, 'zzz');
    expect(await screen.findByText('Baseline not found')).toBeInTheDocument();
  });

  it('a baseline with no rules says so', async () => {
    mountDetails({ 'GET /api/baselines/:id': bl(), 'GET /api/baselines/:id/rules': [] });
    expect(await screen.findByText('This baseline has no rules')).toBeInTheDocument();
  });
});
