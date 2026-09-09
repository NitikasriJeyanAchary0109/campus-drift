import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import {
  LayoutDashboard,
  Server,
  FileCheck2,
  GitCompare,
  Wrench,
  CheckSquare,
  Bell,
  ScrollText,
  Settings,
  ShieldCheck,
} from 'lucide-react';

interface NavItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Array<'Admin' | 'NetworkEngineer' | 'Viewer'>;
}

const navItems: NavItem[] = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard, roles: ['Admin', 'NetworkEngineer', 'Viewer'] },
  { name: 'Devices', path: '/devices', icon: Server, roles: ['Admin', 'NetworkEngineer', 'Viewer'] },
  { name: 'Baselines', path: '/baselines', icon: FileCheck2, roles: ['Admin', 'NetworkEngineer', 'Viewer'] },
  { name: 'Drift Events', path: '/drift', icon: GitCompare, roles: ['Admin', 'NetworkEngineer', 'Viewer'] },
  { name: 'Remediation', path: '/remediation', icon: Wrench, roles: ['Admin', 'NetworkEngineer'] },
  { name: 'Approval Queue', path: '/approvals', icon: CheckSquare, roles: ['Admin', 'NetworkEngineer'] },
  { name: 'Alerts', path: '/alerts', icon: Bell, roles: ['Admin', 'NetworkEngineer', 'Viewer'] },
  { name: 'Audit Logs', path: '/audit', icon: ScrollText, roles: ['Admin'] },
  { name: 'Settings', path: '/settings', icon: Settings, roles: ['Admin'] },
];

export const Sidebar: React.FC = () => {
  const { user } = useAuthStore();
  const userRole = user?.role || 'Viewer';

  const visibleNavItems = navItems.filter((item) => item.roles.includes(userRole));

  return (
    <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col h-screen shrink-0 border-r border-slate-800">
      <div className="h-16 flex items-center gap-3 px-6 border-b border-slate-800">
        <ShieldCheck className="h-7 w-7 text-sky-400" />
        <div>
          <h1 className="font-bold text-sm tracking-wide text-white">Campus Drift</h1>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider">Network Engine</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-600 text-white shadow-sm shadow-sky-950/50'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.name}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800 text-xs text-slate-400">
        <div className="flex items-center justify-between">
          <span className="text-slate-300 font-semibold">Active Session</span>
          <span className="font-mono text-[10px] px-1.5 py-0.5 bg-slate-800 rounded text-slate-300 border border-slate-700">
            {userRole}
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">
          {user?.username ? `Logged in as @${user.username}` : 'Not authenticated'}
        </p>
      </div>
    </aside>
  );
};

