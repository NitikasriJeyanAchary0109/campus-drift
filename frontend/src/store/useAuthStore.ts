import { create } from 'zustand';
import axios from 'axios';

export interface User {
  id: string;
  username: string;
  role: 'Admin' | 'NetworkEngineer' | 'Viewer';
  is_active?: boolean;
}

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoadingAuth: boolean;
  setAuth: (token: string, user: User) => void;
  setUser: (user: User) => void;
  initAuth: () => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  // Pure in-memory storage (never persisted to localStorage or sessionStorage)
  token: null,
  user: null,
  isAuthenticated: false,
  isLoadingAuth: true,

  setAuth: (token: string, user: User) => {
    set({
      token,
      user,
      isAuthenticated: true,
      isLoadingAuth: false,
    });
  },

  setUser: (user: User) => {
    set({ user });
  },

  initAuth: async () => {
    try {
      // Call refresh endpoint using httpOnly cookie to silently restore session
      const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
      const res = await axios.post(
        `${baseUrl}/api/auth/refresh`,
        {},
        { withCredentials: true }
      );

      const { access_token, user } = res.data;
      set({
        token: access_token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          is_active: user.is_active,
        },
        isAuthenticated: true,
        isLoadingAuth: false,
      });
      return true;
    } catch {
      set({
        token: null,
        user: null,
        isAuthenticated: false,
        isLoadingAuth: false,
      });
      return false;
    }
  },

  logout: async () => {
    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
      await axios.post(`${baseUrl}/api/auth/logout`, {}, { withCredentials: true });
    } catch {
      // Ignore network errors on logout
    } finally {
      set({
        token: null,
        user: null,
        isAuthenticated: false,
        isLoadingAuth: false,
      });
    }
  },
}));

