/* eslint-disable react-refresh/only-export-components -- test helpers, not part of the app bundle */
import React from 'react';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../src/store/useAuthStore';
import { setApi, Handler } from './apiMock';

export type Role = 'Admin' | 'NetworkEngineer' | 'Viewer';

export const USERS: Record<Role, { id: string; username: string; role: Role; is_active: boolean }> = {
  Admin: { id: 'u-admin', username: 'admin', role: 'Admin', is_active: true },
  NetworkEngineer: { id: 'u-neteng', username: 'neteng', role: 'NetworkEngineer', is_active: true },
  Viewer: { id: 'u-viewer', username: 'viewer', role: 'Viewer', is_active: true },
};

export const signInAs = (role: Role | null) =>
  useAuthStore.setState(role ? { token: 't', user: USERS[role], isAuthenticated: true, isLoadingAuth: false } : { token: null, user: null, isAuthenticated: false, isLoadingAuth: false });

/** Shows the current route so tests can assert navigation. */
const Where = () => <span data-testid="where">{useLocation().pathname + useLocation().search}</span>;

/** Catches render-time exceptions the way an app-level error boundary would (the real app has none). */
export class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch() { /* swallow: asserted by tests */ }
  render() { return this.state.error ? <div data-testid="crashed">{this.state.error.message}</div> : this.props.children; }
}

export function renderPage(
  element: React.ReactElement,
  opts: { role?: Role | null; api?: Record<string, Handler>; route?: string; path?: string } = {},
) {
  signInAs(opts.role === undefined ? 'Admin' : opts.role);
  setApi(opts.api || {});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const route = opts.route || '/';
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={opts.path || '*'} element={<Boundary>{element}</Boundary>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The value printed next to a KPI label (labels and values are sibling elements in the cards). */
export const valueNextTo = (screen: { getByText: (t: any) => HTMLElement }, label: string | RegExp): string => {
  const el = screen.getByText(label);
  const sib = el.nextElementSibling || el.parentElement?.nextElementSibling || el.parentElement?.querySelector('div:last-child, p:last-child');
  return (sib?.textContent || '').trim();
};

/** Silence React's error logging for tests that deliberately trigger a render crash. */
export const quiet = () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  return () => spy.mockRestore();
};
