import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Login } from '../../src/pages/Login';
import { useAuthStore } from '../../src/store/useAuthStore';
import { renderPage } from '../utils';
import { calls, httpError, networkError } from '../apiMock';

const loginOk = { access_token: 'jwt', user: { id: 'u1', username: 'neteng', role: 'NetworkEngineer', is_active: true } };
const click = () => fireEvent.click(screen.getByRole('button', { name: /sign in to workspace/i }));
/** The form requires both fields (and the page opens empty), so type something before submitting. */
const submit = async (u = 'admin', p = 'admin123') => {
  await userEvent.clear(user()); await userEvent.type(user(), u);
  await userEvent.clear(pass()); await userEvent.type(pass(), p);
  click();
};
const user = () => screen.getByPlaceholderText('Enter your username') as HTMLInputElement;
const pass = () => screen.getByPlaceholderText('Enter your password') as HTMLInputElement;

describe('Login page (white-box)', () => {
  it('shows an overview panel with the four workflow stages next to the sign-in card', () => {
    renderPage(<Login />, { role: null });
    const overview = screen.getByRole('region', { name: /driftwatch overview/i });
    expect(overview).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((e) => e.textContent).join(' ')).toMatch(/Detect.*Analyze.*Approve.*Remediate/);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/welcome back/i);
  });

  it('[UI-12] opens with empty credentials', () => {
    renderPage(<Login />, { role: null });
    expect(user().value).toBe('');
    expect(pass().value).toBe('');
  });

  it('role cards pre-fill their account and clear a previous error', async () => {
    renderPage(<Login />, { role: null, api: { 'POST /api/auth/login': () => { throw httpError(401, 'Incorrect username or password'); } } });
    await submit();
    expect(await screen.findByText('Incorrect username or password')).toBeInTheDocument();
    fireEvent.click(screen.getByText('(viewer / viewer123)'));
    expect(user().value).toBe('viewer');
    expect(pass().value).toBe('viewer123');
    expect(screen.queryByText('Incorrect username or password')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('(neteng / neteng123)'));
    expect(user().value).toBe('neteng');
    fireEvent.click(screen.getByText('(admin / admin123)'));
    expect(user().value).toBe('admin');
  });

  it('posts the typed credentials, stores the session and navigates to the dashboard', async () => {
    renderPage(<Login />, { role: null, route: '/login', api: { 'POST /api/auth/login': loginOk } });
    await userEvent.clear(user());
    await userEvent.type(user(), 'neteng');
    await userEvent.clear(pass());
    await userEvent.type(pass(), 'neteng123');
    click();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'));
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/auth/login', body: { username: 'neteng', password: 'neteng123' } });
    expect(useAuthStore.getState()).toMatchObject({ token: 'jwt', isAuthenticated: true });
    expect(useAuthStore.getState().user).toEqual({ id: 'u1', username: 'neteng', role: 'NetworkEngineer', is_active: true });
  });

  it('shows the server message on a 401 and stays on the page', async () => {
    renderPage(<Login />, { role: null, route: '/login', api: { 'POST /api/auth/login': () => { throw httpError(401, 'Incorrect username or password'); } } });
    await submit();
    expect(await screen.findByText('Incorrect username or password')).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe('/login');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('shows the transport error text when there is no response', async () => {
    renderPage(<Login />, { role: null, api: { 'POST /api/auth/login': () => { throw networkError(); } } });
    await submit();
    expect(await screen.findByText('Network Error')).toBeInTheDocument();
  });

  it('falls back to a generic message when the error has no text at all', async () => {
    renderPage(<Login />, { role: null, api: { 'POST /api/auth/login': () => { throw Object.assign(new Error(''), { response: undefined }); } } });
    await submit();
    expect(await screen.findByText(/authentication failed/i)).toBeInTheDocument();
  });

  it('disables the form and shows progress while the request is in flight', async () => {
    let release!: (v: unknown) => void;
    renderPage(<Login />, { role: null, api: { 'POST /api/auth/login': () => new Promise((r) => { release = r; }) } });
    await submit();
    expect(await screen.findByText('Signing in...')).toBeInTheDocument();
    expect(user()).toBeDisabled();
    release(loginOk);
    await waitFor(() => expect(screen.queryByText('Signing in...')).not.toBeInTheDocument());
  });

  it('toggles password visibility', () => {
    renderPage(<Login />, { role: null });
    expect(pass().type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(pass().type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect(pass().type).toBe('password');
  });

  it('[UI-11] a 422 whose detail is a list of validation errors does not crash the page', async () => {
    renderPage(<Login />, { role: null, api: { 'POST /api/auth/login': () => { throw httpError(422, [{ loc: ['body', 'username'], msg: 'Field required', type: 'missing' }]); } } });
    await submit();
    await waitFor(() => expect(calls.length).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('crashed')).not.toBeInTheDocument();
    expect(screen.getByText('Welcome back!')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/username: Field required/);
  });

  it('renders nothing sensitive: the password is never echoed into the DOM text', async () => {
    renderPage(<Login />, { role: null, api: { 'POST /api/auth/login': () => { throw httpError(401, 'nope'); } } });
    await submit('admin', 'S3cret-Value');
    await screen.findByText('nope');
    expect(document.body.textContent).not.toContain('S3cret-Value');
  });

  it('role cards are keyboard operable buttons that expose which one is selected', async () => {
    renderPage(<Login />, { role: null });
    const cards = screen.getAllByRole('button', { name: /demo account/i });
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => c.getAttribute('aria-pressed') === 'false')).toBe(true);
    cards[1].focus();
    await userEvent.keyboard('{Enter}');
    expect(user().value).toBe('neteng');
    expect(cards[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('every field has a real label and the eye toggle has an accessible name', () => {
    renderPage(<Login />, { role: null });
    expect(screen.getByLabelText('Username')).toBe(user());
    expect(screen.getByLabelText('Password')).toBe(pass());
    expect(screen.getByRole('button', { name: /show password/i })).toBeInTheDocument();
  });

  it('a failed sign-in is announced in a red alert above the button', async () => {
    renderPage(<Login />, { role: null, api: { 'POST /api/auth/login': () => { throw httpError(401, 'Incorrect username or password'); } } });
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Incorrect username or password');
    expect(alert.compareDocumentPosition(screen.getByRole('button', { name: /sign in to workspace/i })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('demo role cards and credentials are not rendered when demo mode is off', async () => {
    const { LoginCard } = await import('../../src/components/auth/LoginCard');
    const noop = () => {};
    renderPage(<LoginCard username="" password="" showPassword={false} error={null} isLoading={false} roles={[]} onUsername={noop} onPassword={noop} onToggleShow={noop} onSubmit={noop} onPreset={noop} />, { role: null });
    expect(screen.queryByText(/quick demo access/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/admin123/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /demo account/i })).toHaveLength(0);
  });
});
