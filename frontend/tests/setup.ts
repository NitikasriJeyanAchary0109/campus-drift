import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import * as React from 'react';

// Every page talks to the API through this module; tests replace it with the in-memory router in tests/apiMock.ts.
vi.mock('../src/api/client', async () => {
  const m = await import('./apiMock');
  return {
    apiClient: {
      get: (u: string, c?: any) => m.dispatch('GET', u, c),
      post: (u: string, b?: any, c?: any) => m.dispatch('POST', u, b, c),
      put: (u: string, b?: any, c?: any) => m.dispatch('PUT', u, b, c),
      delete: (u: string, c?: any) => m.dispatch('DELETE', u, c),
    },
    queryClient: new QueryClient(),
  };
});

// Recharts measures its container; jsdom has no layout, so give it a size.
vi.mock('recharts', async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.createElement('div', { style: { width: 800, height: 300 } }, React.cloneElement(children, { width: 800, height: 300 })),
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
if (!('createObjectURL' in URL)) (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
if (!('revokeObjectURL' in URL)) (URL as any).revokeObjectURL = vi.fn();
window.scrollTo = vi.fn() as any;
(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

