import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../src/store/useAuthStore';

const reset = () => useAuthStore.setState({ token: null, user: null, isAuthenticated: false, isLoadingAuth: true });

describe('useAuthStore (white-box)', () => {
  beforeEach(() => { reset(); vi.restoreAllMocks(); });

  it('starts unauthenticated and "loading" so the route guard attempts a silent refresh', () => {
    const s = useAuthStore.getState();
    expect(s).toMatchObject({ token: null, user: null, isAuthenticated: false, isLoadingAuth: true });
  });

  it('setAuth stores token and user in memory only (never localStorage)', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    useAuthStore.getState().setAuth('tok', { id: '1', username: 'a', role: 'Admin' });
    expect(useAuthStore.getState()).toMatchObject({ token: 'tok', isAuthenticated: true, isLoadingAuth: false });
    expect(setItem).not.toHaveBeenCalled();
  });

  it('setUser replaces only the user', () => {
    useAuthStore.getState().setAuth('tok', { id: '1', username: 'a', role: 'Admin' });
    useAuthStore.getState().setUser({ id: '2', username: 'b', role: 'Viewer' });
    expect(useAuthStore.getState().user?.username).toBe('b');
    expect(useAuthStore.getState().token).toBe('tok');
  });

  it('initAuth restores the session from the refresh endpoint', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'new', user: { id: '9', username: 'neteng', role: 'NetworkEngineer', is_active: true, extra: 'ignored' } } });
    await expect(useAuthStore.getState().initAuth()).resolves.toBe(true);
    expect(post).toHaveBeenCalledWith('/api/auth/refresh', {}, { withCredentials: true });
    expect(useAuthStore.getState()).toMatchObject({ token: 'new', isAuthenticated: true, isLoadingAuth: false });
    expect(useAuthStore.getState().user).toEqual({ id: '9', username: 'neteng', role: 'NetworkEngineer', is_active: true });
  });

  it('initAuth failure clears everything and returns false', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('401'));
    useAuthStore.getState().setAuth('stale', { id: '1', username: 'a', role: 'Admin' });
    await expect(useAuthStore.getState().initAuth()).resolves.toBe(false);
    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null, isAuthenticated: false, isLoadingAuth: false });
  });

  it('initAuth with a malformed refresh response (no user) fails closed', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'x' } });
    await expect(useAuthStore.getState().initAuth()).resolves.toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('logout clears the session even when the network call fails', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('offline'));
    useAuthStore.getState().setAuth('tok', { id: '1', username: 'a', role: 'Admin' });
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null, isAuthenticated: false });
  });

  it('logout calls the server so the refresh cookie is cleared', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({});
    await useAuthStore.getState().logout();
    expect(post).toHaveBeenCalledWith('/api/auth/logout', {}, { withCredentials: true });
  });
});
