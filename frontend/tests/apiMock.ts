/**
 * In-memory stand-in for src/api/client's axios instance, keyed by "METHOD /path" (":param" segments allowed).
 * A handler may be a value, a function of the request, or a thrown error shaped like an AxiosError (see `httpError`).
 */
export type Req = { method: string; url: string; path: string; params?: any; body?: any };
export type Handler = unknown | ((req: Req) => unknown | Promise<unknown>);

let routes: Record<string, Handler> = {};
export const calls: Req[] = [];

export const httpError = (status: number, detail: unknown = 'error') => {
  const e: any = new Error(`Request failed with status code ${status}`);
  e.isAxiosError = true;
  e.response = { status, data: { detail } };
  return e;
};
export const networkError = () => {
  const e: any = new Error('Network Error');
  e.isAxiosError = true;
  return e;
};

export function setApi(next: Record<string, Handler>) {
  routes = next;
  calls.length = 0;
}

const toRegex = (pattern: string) => new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '$');

export async function dispatch(method: string, url: string, a?: any, b?: any) {
  const [path, query] = url.split('?');
  const body = method === 'GET' || method === 'DELETE' ? undefined : a;
  const params = method === 'GET' || method === 'DELETE' ? { ...(a?.params || {}), ...Object.fromEntries(new URLSearchParams(query || '')) } : b?.params;
  const req: Req = { method, url, path, params, body };
  calls.push(req);
  const key = Object.keys(routes).find((k) => {
    const [m, p] = k.split(' ');
    return m === method && (p === path || toRegex(p).test(path));
  });
  if (!key) throw httpError(404, `no mock for ${method} ${path}`);
  const h = routes[key];
  const out = typeof h === 'function' ? await (h as (r: Req) => unknown)(req) : h;
  return { data: out, status: 200, headers: {}, config: {}, statusText: 'OK' };
}
