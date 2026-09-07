import React from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { Bell, UserCheck, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const Topbar: React.FC = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
          System Normal
        </span>
        <span className="text-xs text-slate-500">FastAPI + PostgreSQL Backend</span>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => navigate('/alerts')}
          className="p-1.5 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 relative"
          title="Alerts"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute top-1 right-1 h-2 w-2 bg-rose-500 rounded-full"></span>
        </button>

        <div className="h-6 w-px bg-slate-200" />

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <UserCheck className="h-4 w-4 text-sky-600" />
            <span className="font-medium">{user?.username || 'Dev User'}</span>
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
              {user?.role || 'Admin'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
