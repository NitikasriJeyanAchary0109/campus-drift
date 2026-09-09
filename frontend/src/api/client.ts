import axios from 'axios';
import { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/useAuthStore';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach in-memory JWT token from Zustand state (NEVER from localStorage)
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: automatically refresh on 401 using httpOnly cookie
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: any) => void;
  reject: (reason?: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Only attempt refresh if 401, not already retried, and not an auth endpoint
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/api/auth/login') &&
      !originalRequest.url?.includes('/api/auth/refresh')
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return apiClient(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshRes = await axios.post(
          (import.meta.env.VITE_API_BASE_URL || '') + '/api/auth/refresh',
          {},
          { withCredentials: true }
        );

        const { access_token, user } = refreshRes.data;
        // Store access token in-memory ONLY
        useAuthStore.getState().setAuth(access_token, user);

        processQueue(null, access_token);
        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return apiClient(originalRequest);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        useAuthStore.getState().logout();
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

/**
 * Silent session restoration on initial app boot:
 * Calls POST /api/auth/refresh using httpOnly cookie to restore in-memory access token.
 */
export const restoreSession = async (): Promise<boolean> => {
  try {
    const res = await axios.post(
      (import.meta.env.VITE_API_BASE_URL || '') + '/api/auth/refresh',
      {},
      { withCredentials: true }
    );
    const { access_token, user } = res.data;
    useAuthStore.getState().setAuth(access_token, user);
    return true;
  } catch {
    useAuthStore.getState().logout();
    return false;
  }
};

/**
 * Clear server-side refresh cookie and in-memory auth state
 */
export const performLogout = async () => {
  try {
    await apiClient.post('/api/auth/logout');
  } catch {}
  useAuthStore.getState().logout();
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5000,
    },
  },
});


