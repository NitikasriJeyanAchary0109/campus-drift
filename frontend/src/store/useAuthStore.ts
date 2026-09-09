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
  setAuth: (token: string, user: User) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => {
  const initialToken = localStorage.getItem('token');
  let initialUser: User | null = null;
  try {
    const raw = localStorage.getItem('user');
    if (raw) initialUser = JSON.parse(raw);
  } catch {
    initialUser = null;
  }

  return {
    token: initialToken,
    user: initialUser,
    isAuthenticated: !!initialToken,
    setAuth: (token: string, user: User) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      set({ token, user, isAuthenticated: true });
    },
    setUser: (user: User) => {
      localStorage.setItem('user', JSON.stringify(user));
      set({ user });
    },
    logout: () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      set({ token: null, user: null, isAuthenticated: false });
    },
  };
});
