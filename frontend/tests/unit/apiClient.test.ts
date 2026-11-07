/** The real axios instance (the global mock is bypassed with importActual); responses come from a fake adapter. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../src/store/useAuthStore';

type Client = typeof import('../../src/api/client');
let mod: Client;

const reply = (status: number, data: any = {}) => ({ data, status, statusText: '', headers: {}, config: {} as any });
const rejectWith = (status: number, config: any) => Promise.reject(Object.assign(new Error(`status ${status}`), { config, response: reply(status) }));

beforeEach(async () => {
  mod = await vi.importActual<Client>('../../src/api/client');
  useAuthStore.setState({ token: null, user: null, isAuthenticated: false, isLoadingAuth: false });
  mod.apiClient.defaults.adapter = undefined as any;
});

describe('apiClient (white-box)', () => {
  it('sends the in-memory token as a Bearer header, and nothing when signed out', async () => {
    const seen: any[] = [];
    mod.apiClient.defaults.adapter = async (config: any) => { seen.push(config.headers.Authorization); return reply(200) as any; };
    await mod.apiClient.get('/x');
    useAuthStore.setState({ token: 'abc' });
    await mod.apiClient.get('/x');
    expect(seen).toEqual([undefined, 'Bearer abc']);
  });

  it('uses cookies and JSON by default', () => {
    expect(mod.apiClient.defaults.withCredentials).toBe(true);
    expect(mod.apiClient.defaults.headers['Content-Type']).toBe('application/json');
  });

  it('on a 401 it refreshes the session once and replays the request with the new token', async () => {
    const attempts: string[] = [];
    mod.apiClient.defaults.adapter = async (config: any) => {
      attempts.push(String(config.headers.Authorization));
      if (attempts.length === 1) return rejectWith(401, config) as any;
      return reply(200, { ok: true }) as any;
    };
    vi.spyOn(useAuthStore.getState(), 'initAuth').mockImplementation(async () => { useAuthStore.setState({ token: 'fresh' }); return true; });
    useAuthStore.setState({ token: 'old', initAuth: useAuthStore.getState().initAuth });
    const res = await mod.apiClient.get('/data');
    expect(res.data).toEqual({ ok: true });
    expect(attempts).toEqual(['Bearer old', 'Bearer fresh']);
  });

  it('does not try to refresh on auth endpoints (loop guard)', async () => {
    const init = vi.fn();
    useAuthStore.setState({ initAuth: init as any });
    mod.apiClient.defaults.adapter = (config: any) => rejectWith(401, config) as any;
    for (const url of ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout']) await expect(mod.apiClient.post(url)).rejects.toBeTruthy();
    expect(init).not.toHaveBeenCalled();
  });

  it('when the refresh fails it signs the user out and redirects to /login', async () => {
    const logout = vi.fn();
    useAuthStore.setState({ token: 'old', initAuth: (async () => false) as any, logout: logout as any });
    Object.defineProperty(window, 'location', { value: { pathname: '/devices', href: '/devices' }, writable: true });
    mod.apiClient.defaults.adapter = (config: any) => rejectWith(401, config) as any;
    await expect(mod.apiClient.get('/data')).rejects.toBeTruthy();
    expect(logout).toHaveBeenCalled();
    expect(window.location.href).toBe('/login');
  });

  it('non-401 errors are passed through untouched', async () => {
    mod.apiClient.defaults.adapter = (config: any) => rejectWith(500, config) as any;
    await expect(mod.apiClient.get('/data')).rejects.toMatchObject({ response: { status: 500 } });
  });

  it('exports a query client that refetches sensibly', () => {
    const d = mod.queryClient.getDefaultOptions().queries!;
    expect(d).toMatchObject({ refetchOnWindowFocus: false, retry: 1, staleTime: 5000 });
  });
});
