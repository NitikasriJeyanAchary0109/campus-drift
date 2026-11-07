import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import './shell.css';
import './ui/pixel/theme';
import {
  Home,
  AlertTriangle,
  Server,
  Layers,
  Ticket,
  Siren,
  Wrench,
  ShieldCheck,
  ScrollText,
  Settings,
  ChevronDown,
  MoreHorizontal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Role = 'Admin' | 'NetworkEngineer' | 'Viewer';

interface NavItem {
  name: string;
  path: string;
  icon: LucideIcon;
  roles: Role[];
  /** The few places most people need; everything else sits under "More". */
  main?: boolean;
}

const ALL: Role[] = ['Admin', 'NetworkEngineer', 'Viewer'];
const EDITORS: Role[] = ['Admin', 'NetworkEngineer'];

// The daily path is: see what is wrong (Home), open it (Problems), check a device, approve a fix.
const navItems: NavItem[] = [
  { name: 'Home', path: '/', icon: Home, roles: ALL, main: true },
  { name: 'Problems', path: '/drift', icon: Siren, roles: ALL, main: true },
  { name: 'Devices', path: '/devices', icon: Server, roles: ALL, main: true },
  { name: 'Approvals', path: '/approvals', icon: ShieldCheck, roles: EDITORS, main: true },
  { name: 'Alerts', path: '/alerts', icon: AlertTriangle, roles: ALL },
  { name: 'Baselines', path: '/baselines', icon: Layers, roles: ALL },
  { name: 'Tickets', path: '/tickets', icon: Ticket, roles: ALL },
  { name: 'Remediation', path: '/remediation', icon: Wrench, roles: EDITORS },
  { name: 'Audit', path: '/audit', icon: ScrollText, roles: ['Admin'] },
  { name: 'Settings', path: '/settings', icon: Settings, roles: ['Admin'] },
];

const Link: React.FC<{ item: NavItem }> = ({ item }) => {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      title={item.name}
      className="pxl-btn pxl-btn-nav pxl-btn-md pxl-focus w-full !justify-start !px-3"
    >
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2.2} aria-hidden="true" />
      <span className="dw-nav-label truncate">{item.name}</span>
    </NavLink>
  );
};

/** Sidebar: four main places, the rest under "More" (it opens by itself when you are on one of those pages). Items are filtered by role. */
export const Sidebar: React.FC = () => {
  const { user } = useAuthStore();
  const { pathname } = useLocation();
  const userRole: Role = user?.role || 'Viewer';
  const visible = navItems.filter((item) => item.roles.includes(userRole));
  const main = visible.filter((i) => i.main);
  const more = visible.filter((i) => !i.main);
  const onMorePage = more.some((i) => pathname === i.path || pathname.startsWith(i.path + '/'));
  const [moreOpen, setMoreOpen] = React.useState(false);
  const open = moreOpen || onMorePage;

  return (
    <aside id="app-sidebar" className="dw-sidebar select-none">
      <div className="rounded-lg bg-slate-900 p-3 shadow-sm">
        <nav aria-label="Main" className="flex flex-col gap-1">
          {main.map((item) => <Link key={item.path} item={item} />)}

          {more.length > 0 && (
            <>
              <button
                type="button"
                aria-expanded={open}
                aria-controls="more-links"
                onClick={() => setMoreOpen((v) => !v)}
                className="pxl-btn pxl-btn-nav pxl-btn-md pxl-focus mt-2 w-full !justify-start !px-3"
              >
                <MoreHorizontal className="h-[18px] w-[18px] shrink-0" strokeWidth={2.2} aria-hidden="true" />
                <span className="dw-nav-label flex-1 text-left">More</span>
                <ChevronDown className={`dw-nav-label h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {open && (
                <div id="more-links" className="flex flex-col gap-1 border-t border-slate-700 pt-2">
                  {more.map((item) => <Link key={item.path} item={item} />)}
                </div>
              )}
            </>
          )}
        </nav>
      </div>
    </aside>
  );
};
