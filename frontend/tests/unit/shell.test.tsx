import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axios from 'axios';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes } from '../../src/routes';
import { Sidebar } from '../../src/components/Sidebar';
import { Topbar } from '../../src/components/Topbar';
import { Layout } from '../../src/components/Layout';
import { useAuthStore } from '../../src/store/useAuthStore';
import { renderPage, signInAs } from '../utils';
import { setApi, calls } from '../apiMock';

const names = () => screen.getAllByRole('link').map((a) => a.textContent!.trim());

describe('Sidebar (white-box: role filter)', () => {
  const MORE = (role: any) => { renderPage(<Sidebar />, { role }); fireEvent.click(screen.getByRole('button', { name: 'More' })); return names(); };

  it.each([
    ['Admin', ['Home', 'Problems', 'Devices', 'Approvals']],
    ['NetworkEngineer', ['Home', 'Problems', 'Devices', 'Approvals']],
    ['Viewer', ['Home', 'Problems', 'Devices']],
  ] as const)('%s sees four or fewer main places: %j', (role, expected) => {
    renderPage(<Sidebar />, { role });
    expect(names()).toEqual(expected);
  });

  it.each([
    ['Admin', ['Home', 'Problems', 'Devices', 'Approvals', 'Alerts', 'Baselines', 'Tickets', 'Remediation', 'Audit', 'Settings']],
    ['NetworkEngineer', ['Home', 'Problems', 'Devices', 'Approvals', 'Alerts', 'Baselines', 'Tickets', 'Remediation']],
    ['Viewer', ['Home', 'Problems', 'Devices', 'Alerts', 'Baselines', 'Tickets']],
  ] as const)('%s still reaches every page their role allows under More: %j', (role, expected) => {
    expect(MORE(role)).toEqual(expected);
  });

  it('with no user at all it falls back to the Viewer menu', () => {
    renderPage(<Sidebar />, { role: null });
    expect(names()).toHaveLength(3);
  });

  it('marks the current page active', () => {
    renderPage(<Sidebar />, { role: 'Admin', route: '/devices' });
    expect(screen.getByRole('link', { name: 'Devices' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('More is closed by default, toggles, and opens by itself on one of its pages', () => {
    const { unmount } = renderPage(<Sidebar />, { role: 'Admin' });
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Audit' })).not.toBeInTheDocument();
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Audit' })).toBeInTheDocument();
    fireEvent.click(more);
    expect(screen.queryByRole('link', { name: 'Audit' })).not.toBeInTheDocument();
    unmount();
    renderPage(<Sidebar />, { role: 'Admin', route: '/audit' });
    expect(screen.getByRole('link', { name: 'Audit' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('Topbar (white-box)', () => {
  it('shows the signed-in username and role', () => {
    renderPage(<Topbar />, { role: 'NetworkEngineer' });
    expect(screen.getByText('neteng')).toBeInTheDocument();
    expect(screen.getByText('NetworkEngineer')).toBeInTheDocument();
  });

  it('opens the user menu and signs out then navigates to /login', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({});
    renderPage(<Topbar />, { role: 'Admin', route: '/devices' });
    fireEvent.click(screen.getByText('admin', { selector: 'span.font-mono' }));
    fireEvent.click(await screen.findByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/login'));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('the bell opens /alerts and the logo opens the dashboard', () => {
    renderPage(<Topbar />, { role: 'Admin', route: '/devices' });
    fireEvent.click(screen.getByTitle('Active Alerts'));
    expect(screen.getByTestId('where').textContent).toBe('/alerts');
    fireEvent.click(screen.getByText('WATCH'));
    expect(screen.getByTestId('where').textContent).toBe('/');
  });

  it('[UI-10] the bell badge shows the real number of unacknowledged alerts, and nothing when there are none', async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, type: 'X', message: 'm', acknowledged: i === 0, created_at: '2026-11-04T10:00:00' }));
    const { unmount } = renderPage(<Topbar />, { role: 'Admin', api: { 'GET /api/alerts': mk(4) } });
    await waitFor(() => expect(screen.getByTitle('Active Alerts').textContent).toBe('3'));
    unmount();
    renderPage(<Topbar />, { role: 'Admin', api: { 'GET /api/alerts': [] } });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTitle('Active Alerts').textContent).toBe('');
  });
});

describe('Layout', () => {
  it('renders the shell and its outlet', () => {
    signInAs('Admin');
    setApi({});
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <Routes><Route element={<Layout />}><Route index element={<p>page body</p>} /></Route></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('page body')).toBeInTheDocument();
    expect(screen.getByText('CAMPUS DRIFT DETECTOR')).toBeInTheDocument();
  });
});

describe('AppRoutes / ProtectedRoute (white-box)', () => {
  const boot = (route: string) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[route]}><AppRoutes /></MemoryRouter>
      </QueryClientProvider>,
    );

  it('shows a loading state while it tries to restore the session', () => {
    useAuthStore.setState({ isAuthenticated: false, isLoadingAuth: true, initAuth: vi.fn(() => new Promise(() => {})) as any });
    boot('/devices');
    expect(screen.getByText(/restoring secure session/i)).toBeInTheDocument();
  });

  it('redirects an unauthenticated visitor to the login page', async () => {
    useAuthStore.setState({ isAuthenticated: false, isLoadingAuth: false });
    boot('/devices');
    expect(await screen.findByText('Welcome back!')).toBeInTheDocument();
  });

  it('renders the requested page for a signed-in user', async () => {
    setApi({ 'GET /api/dashboard/summary': { total_devices: 3, compliance_percentage: 50 }, 'GET /api/alerts': [], 'GET /api/approvals/pending': [] });
    signInAs('Admin');
    boot('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' }, { timeout: 10000 })).toBeInTheDocument();
  });

  it('an unknown address shows a "Page not found" page inside the shell, not the dashboard', async () => {
    setApi({ 'GET /api/alerts': [] });
    signInAs('Admin');
    boot('/nowhere');
    expect(await screen.findByText('Page not found', {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it.each([
    ['Viewer', '/settings'], ['Viewer', '/audit'], ['Viewer', '/approvals'], ['Viewer', '/remediation'],
    ['NetworkEngineer', '/settings'], ['NetworkEngineer', '/audit'],
  ] as const)('[UI-02] a %s cannot open %s: the page is replaced by an access message and the API is never asked', async (role, path) => {
    setApi({ 'GET /api/alerts': [] });
    signInAs(role);
    boot(path);
    expect(await screen.findByText('You do not have access to this page', {}, { timeout: 10000 })).toBeInTheDocument();
    expect(calls.filter((c) => /health|audit|approvals|remediation/.test(c.path))).toHaveLength(0);
  });

  it('an Admin can open the admin pages', async () => {
    setApi({ 'GET /api/alerts': [], 'GET /api/health': { status: 'ok', project: 'p', version: '1', timestamp: '2026-11-04T09:00:00', database: 'connected', redis: 'connected', environment: 'development' } });
    signInAs('Admin');
    boot('/settings');
    expect(await screen.findByText('System status', {}, { timeout: 10000 })).toBeInTheDocument();
  });

});
