import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Settings } from '../../src/pages/Settings';
import { renderPage } from '../utils';
import { httpError } from '../apiMock';

const H = (over: any = {}) => ({ status: 'ok', project: 'Campus Network Configuration-Drift Detector', version: '0.1.0', timestamp: '2026-11-04T09:00:00', database: 'connected', redis: 'connected', environment: 'production', ...over });
const mount = (h: any) => renderPage(<Settings />, { role: 'Admin', api: { 'GET /api/health': h } });

describe('System status', () => {
  it('reports each service from what the server says', async () => {
    mount(H());
    expect(await screen.findByText('All systems working')).toBeInTheDocument();
    for (const name of ['API', 'Database', 'Redis (job queue)']) {
      const row = screen.getByText(name).closest('tr')!;
      expect(within(row).getByText('Working')).toBeInTheDocument();
    }
    expect(screen.getByText('production')).toBeInTheDocument();
  });

  it('a service that is down is reported as not working, and the overall state is degraded', async () => {
    mount(H({ status: 'degraded', redis: 'unavailable: ConnectionError' }));
    expect(await screen.findByText('Degraded')).toBeInTheDocument();
    const row = screen.getByText('Redis (job queue)').closest('tr')!;
    expect(within(row).getByText('Not working')).toBeInTheDocument();
  });

  it('when the API does not answer it does not claim that everything is working', async () => {
    mount(() => { throw httpError(503, 'down'); });
    expect(await screen.findByText(/api did not answer/i)).toBeInTheDocument();
    expect(screen.queryByText(/all systems working/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Working')).not.toBeInTheDocument();
  });

  it('offers no controls that pretend to change a setting', async () => {
    mount(H());
    await screen.findByText('All systems working');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });
});
