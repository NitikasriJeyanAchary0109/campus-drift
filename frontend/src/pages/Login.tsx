import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { apiClient } from '../api/client';
import { ShieldCheck, Lock, User, AlertCircle, Loader2, KeyRound } from 'lucide-react';

export const Login: React.FC = () => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await apiClient.post('/api/auth/login', {
        username,
        password,
      });

      const { access_token, user } = response.data;
      setAuth(access_token, {
        id: user.id,
        username: user.username,
        role: user.role,
        is_active: user.is_active,
      });

      navigate('/');
    } catch (err: any) {
      const message =
        err.response?.data?.detail ||
        err.message ||
        'Authentication failed. Please check your credentials.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const setPreset = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-900 rounded-2xl shadow-2xl p-8 border border-slate-800 text-slate-100">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-sky-500/10 border border-sky-500/20 rounded-2xl mb-3 shadow-inner">
            <ShieldCheck className="h-10 w-10 text-sky-400" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Campus Drift Detector</h1>
          <p className="text-sm text-slate-400 mt-1">Network Configuration-Drift & Remediation</p>
        </div>

        {error && (
          <div className="mb-5 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center gap-2.5 text-rose-400 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Username</label>
            <div className="relative">
              <User className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-sky-500 transition-colors"
                placeholder="Enter username"
                required
                disabled={isLoading}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Password</label>
            <div className="relative">
              <Lock className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-sky-500 transition-colors"
                placeholder="Enter password"
                required
                disabled={isLoading}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-sky-900/30 mt-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Signing In...</span>
              </>
            ) : (
              <span>Sign In</span>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-800">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mb-3">
            <KeyRound className="h-3.5 w-3.5 text-sky-400" />
            <span>Demo Role Presets (Click to autofill):</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setPreset('admin', 'admin123')}
              className="px-2 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-indigo-500/50 text-indigo-300 transition-colors text-center"
            >
              Admin
            </button>
            <button
              type="button"
              onClick={() => setPreset('neteng', 'neteng123')}
              className="px-2 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-sky-500/50 text-sky-300 transition-colors text-center"
            >
              NetEng
            </button>
            <button
              type="button"
              onClick={() => setPreset('viewer', 'viewer123')}
              className="px-2 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-emerald-500/50 text-emerald-300 transition-colors text-center"
            >
              Viewer
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 text-center">
            Role-Based Access Control enforced on every backend route
          </p>
        </div>
      </div>
    </div>
  );
};

