import React from 'react';
import { NavLink } from 'react-router-dom';
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
  ShieldCheck
} from 'lucide-react';

const navItems = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Devices', path: '/devices', icon: Server },
  { name: 'Baselines', path: '/baselines', icon: FileCheck2 },
  { name: 'Drift Events', path: '/drift', icon: GitCompare },
  { name: 'Remediation', path: '/remediation', icon: Wrench },
  { name: 'Approval Queue', path: '/approvals', icon: CheckSquare },
  { name: 'Alerts', path: '/alerts', icon: Bell },
  { name: 'Audit Logs', path: '/audit', icon: ScrollText },
  { name: 'Settings', path: '/settings', icon: Settings },
];

export const Sidebar: React.FC = () => {
  return (
    <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col h-screen shrink-0 border-r border-slate-800">
      <div className="h-16 flex items-center gap-3 px-6 border-b border-slate-800">
        <ShieldCheck className="h-7 w-7 text-sky-400" />
        <div>
          <h1 className="font-bold text-sm tracking-wide text-white">Campus Drift</h1>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider">Network Detector</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-600 text-white shadow-sm'
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
        <p className="font-semibold text-slate-300">Phase 1: Scaffolding</p>
        <p>Monolith-first Architecture</p>
      </div>
    </aside>
  );
};
