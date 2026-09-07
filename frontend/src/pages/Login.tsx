import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { ShieldCheck, Lock, User } from 'lucide-react';

export const Login: React.FC = () => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Stub auth for Phase 1; full JWT auth in Phase 2
    setAuth('mock-jwt-token', {
      id: 'usr-1',
      username,
      role: 'Admin',
    });
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-800 rounded-xl shadow-2xl p-8 border border-slate-700">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-sky-500/10 rounded-xl mb-3">
            <ShieldCheck className="h-10 w-10 text-sky-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Campus Drift Detector</h1>
          <p className="text-sm text-slate-400 mt-1">Network Configuration-Drift & Remediation</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Username</label>
            <div className="relative">
              <User className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
                placeholder="Enter username"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
            <div className="relative">
              <Lock className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
                placeholder="Enter password"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-medium rounded-lg text-sm transition-colors mt-2"
          >
            Sign In
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-slate-500">
          Roles: Admin / NetworkEngineer / Viewer (Enforced in Phase 2)
        </div>
      </div>
    </div>
  );
};
