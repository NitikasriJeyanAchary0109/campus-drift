import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import sidebarFox from '../assets/sidebar-fox.png';
import {
  LayoutDashboard,
  AlertTriangle,
  Server,
  Layers,
  Ticket,
  TrendingUp,
  Wrench,
  ShieldCheck,
  ScrollText,
  Settings,
} from 'lucide-react';

interface NavItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Array<'Admin' | 'NetworkEngineer' | 'Viewer'>;
}

const navItems: NavItem[] = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard, roles: ['Admin', 'NetworkEngineer', 'Viewer'] },
  { name: 'Alerts', path: '/alerts', icon: AlertTriangle, roles: ['Admin', 'NetworkEngineer', 'Viewer'] },
  { name: 'Devices', path: '/devices', icon: Server, roles: ['Admin', 'NetworkEngineer', 'Viewer'] },
  { name: 'Baselines', path: '/baselines', icon: Layers, roles: ['Admin', 'NetworkEngineer', 'Viewer'] },
  { name: 'Tickets', path: '/tickets', icon: Ticket, roles: ['Admin', 'NetworkEngineer', 'Viewer'] },
  { name: 'Drift', path: '/drift', icon: TrendingUp, roles: ['Admin', 'NetworkEngineer', 'Viewer'] },
  { name: 'Remediation', path: '/remediation', icon: Wrench, roles: ['Admin', 'NetworkEngineer'] },
  { name: 'Approvals', path: '/approvals', icon: ShieldCheck, roles: ['Admin', 'NetworkEngineer'] },
  { name: 'Audit', path: '/audit', icon: ScrollText, roles: ['Admin'] },
  { name: 'Settings', path: '/settings', icon: Settings, roles: ['Admin'] },
];

export const Sidebar: React.FC = () => {
  const { user } = useAuthStore();
  const userRole = user?.role || 'Viewer';
  const visibleNavItems = navItems.filter((item) => item.roles.includes(userRole));

  return (
    <aside className="w-32 sm:w-36 md:w-40 shrink-0 flex flex-col items-center py-1 select-none z-10">
      {/* Sidebar Mascot Fox sitting with laptop */}
      <div className="w-full flex justify-center mb-1">
        <img
          src={sidebarFox}
          alt="Mascot Fox"
          className="h-14 sm:h-16 w-auto object-contain drop-shadow-[2px_2px_0_#000]"
        />
      </div>

      {/* Chunky Navigation Buttons */}
      <nav className="w-full space-y-1.5 flex-1">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-black tracking-wider transition-all border-2 border-black font-display uppercase ${
                  isActive
                    ? 'bg-[#ec1b16] text-white shadow-[0_3px_0_#991b1b]'
                    : 'bg-[#f6f4ee] hover:bg-[#fefce8] text-[#1f2937] shadow-[2px_2px_0_#000] active:translate-y-0.5'
                }`
              }
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{item.name}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
};
