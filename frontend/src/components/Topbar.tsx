import React from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { Bell, Shield, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const Topbar: React.FC = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getRoleBadge = (role?: string) => {
    switch (role) {
      case 'Admin':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'NetworkEngineer':
        return 'bg-sky-100 text-sky-800 border-sky-200';
      case 'Viewer':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>
          System Online
        </span>
        <span className="text-xs text-slate-500 font-medium">
          Campus Network Engine • Automated Drift & Remediation
        </span>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => navigate('/alerts')}
          className="p-2 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors relative"
          title="System Alerts"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-rose-500 rounded-full"></span>
        </button>

        <div className="h-5 w-px bg-slate-200" />

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <div className="p-1 rounded-md bg-slate-100 text-slate-600">
              <Shield className="h-3.5 w-3.5" />
            </div>
            <span className="font-semibold text-slate-900">{user?.username || 'Guest'}</span>
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded border font-mono ${getRoleBadge(
                user?.role
              )}`}
            >
              {user?.role || 'Unknown'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 transition-colors"
            title="Sign Out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

