import { Crown, Eye, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface DemoAccount {
  role: string;
  username: string;
  password: string;
  description: string;
  icon: LucideIcon;
}

/**
 * Demo accounts offered on the login page. They are only referenced when demo mode is on (Login.tsx), so a production
 * build without VITE_DEMO_MODE=true drops this module and the credentials never reach the bundle.
 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { role: 'Admin', username: 'admin', password: 'admin123', description: 'Full control, approvals & rollback', icon: Crown },
  { role: 'Network Engineer', username: 'neteng', password: 'neteng123', description: 'Plan, sweep & configuration uploads', icon: Settings },
  { role: 'Viewer', username: 'viewer', password: 'viewer123', description: 'Read-only auditing & reports', icon: Eye },
];
