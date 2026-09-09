import { create } from 'zustand';

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
  isRestoring: boolean;
  setAuth: (token: string, user: User) => void;
  setUser: (user: User) => void;
  setRestoring: (isRestoring: boolean) => void;
  logout: () => void;
}

// Clean up any legacy localStorage tokens if present
try {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
} catch {}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  isRestoring: true, // Page begins in session restoration state until POST /api/auth/refresh completes
  setAuth: (token: string, user: User) => {
    set({ token, user, isAuthenticated: true, isRestoring: false });
  },
  setUser: (user: User) => {
    set({ user });
  },
  setRestoring: (isRestoring: boolean) => {
    set({ isRestoring });
  },
  logout: () => {
    set({ token: null, user: null, isAuthenticated: false, isRestoring: false });
  },
}));

