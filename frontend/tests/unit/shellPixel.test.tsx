import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from '../../src/components/Layout';
import { Topbar } from '../../src/components/Topbar';
import { Sidebar } from '../../src/components/Sidebar';
import { RouteLoading } from '../../src/components/RouteState';
import { renderPage, signInAs } from '../utils';
import { setApi } from '../apiMock';

const shell = (route = '/') => {
  signInAs('Admin'); setApi({});
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[route]}>
        <Routes><Route element={<Layout />}><Route path="*" element={<p>page body</p>} /></Route></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('app shell (pixel theme)', () => {
  it('has one navigation landmark inside the sidebar, a labelled home button and the sign-out button', () => {
    shell();
    const side = screen.getByRole('complementary');
    expect(within(side).getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DriftWatch home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByTitle('Active Alerts')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('page body');
  });

  it('keeps the footer labels', () => {
    shell();
    expect(screen.getByText('CAMPUS DRIFT DETECTOR')).toBeInTheDocument();
    expect(screen.getByText('AUTOMATED REMEDIATION ENGINE')).toBeInTheDocument();
  });

  it('the role pill shows the role and the username (the username keeps its mono class)', () => {
    renderPage(<Topbar />, { role: 'NetworkEngineer' });
    expect(screen.getByText('NetworkEngineer')).toBeInTheDocument();
    expect(screen.getByText('neteng')).toHaveClass('font-mono');
  });

  it('has no menu button: the sidebar is on every page, and the bell shows no counter while there are no alerts', () => {
    shell();
    expect(screen.queryByRole('button', { name: /navigation|menu/i })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary')).toBeVisible();
    expect(screen.getByTitle('Active Alerts').querySelectorAll('span')).toHaveLength(0);
  });

  it('nav items are links named by their label only (icons are hidden from assistive technology)', () => {
    renderPage(<Sidebar />, { role: 'Admin' });
    for (const a of screen.getAllByRole('link')) expect(a.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('RouteLoading', () => {
  it('is a status region with the message and a decorative spinner', () => {
    const { container } = render(<RouteLoading fullScreen message="Restoring secure session..." />);
    expect(screen.getByRole('status')).toHaveTextContent('Restoring secure session...');
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain('min-h-screen');
  });
  it('is not full-screen when shown inside the shell', () => {
    const { container } = render(<RouteLoading message="Loading..." />);
    expect(container.firstElementChild?.className).not.toContain('min-h-screen');
  });
});
