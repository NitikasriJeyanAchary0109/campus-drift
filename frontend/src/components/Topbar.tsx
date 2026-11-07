import React from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useNavigate } from 'react-router-dom';
import { Bell, LogOut, ShieldCheck, User } from 'lucide-react';
import './shell.css';
import { PixelButton } from './ui/pixel/PixelButton';
import { useAlerts } from '../lib/useAlerts';

/** Top bar: logo and wordmark, alert bell, role and username, sign-out. */
export const Topbar: React.FC = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const alerts = useAlerts();
  const unread = (alerts.data ?? []).filter((a) => !a.acknowledged).length;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="relative z-20 flex h-16 shrink-0 select-none items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 shadow-sm sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <button type="button" aria-label="DriftWatch home" onClick={() => navigate('/')} className="pxl-focus flex cursor-pointer items-center gap-2.5 rounded-md bg-transparent p-1">
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
            <ShieldCheck size={20} strokeWidth={2.4} />
          </span>
          <span className="text-[18px] font-bold tracking-tight text-slate-900">
            DRIFT<span className="text-blue-600">WATCH</span>
          </span>
        </button>
        <div className="dw-tagline hidden border-l border-slate-200 pl-4 lg:block">
          <p className="m-0 whitespace-nowrap text-[13px] text-slate-600">
            Campus Network Configuration-<span className="font-semibold text-slate-800">Drift Detector</span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/alerts')}
          title="Active Alerts"
          className="pxl-btn pxl-btn-ghost pxl-btn-sm pxl-focus relative !px-2.5"
        >
          <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold leading-none text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 py-1 pl-1.5 pr-3">
          <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-600">
            <User size={16} strokeWidth={2.2} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[13px] font-semibold text-slate-900">{user?.role || 'Admin'}</span>
            <span className="font-mono text-[12px] text-slate-600">{user?.username || 'admin'}</span>
          </span>
        </div>

        <PixelButton variant="ghost" size="sm" onClick={handleLogout} icon={<LogOut size={16} strokeWidth={2.4} />}>
          <span className="max-sm:sr-only">Sign Out</span>
        </PixelButton>
      </div>
    </header>
  );
};
