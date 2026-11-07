import React from 'react';
import { Inbox, AlertTriangle, Loader2 } from 'lucide-react';
import './theme';
import { cx } from './cx';

export type EmptyKind = 'empty' | 'error' | 'loading';

export interface PixelEmptyStateProps {
  kind?: EmptyKind;
  title: string;
  description?: React.ReactNode;
  /** A button or link row. */
  action?: React.ReactNode;
  /** Icon size step (kept for older callers): 3 is compact, 4 and up is the default. */
  scale?: number;
  className?: string;
}

/** Empty, error and loading states: a tinted icon, a title, an optional description and actions. */
export const PixelEmptyState: React.FC<PixelEmptyStateProps> = ({ kind = 'empty', title, description, action, scale = 4, className }) => {
  const Icon = kind === 'empty' ? Inbox : kind === 'error' ? AlertTriangle : Loader2;
  const tone = kind === 'error' ? 'bg-red-50 text-red-600' : kind === 'loading' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500';
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cx('flex flex-col items-center gap-3 px-4 py-8 text-center', className)}>
      <span aria-hidden="true" className={cx('flex items-center justify-center rounded-full', tone, scale >= 4 ? 'h-16 w-16' : 'h-12 w-12')}>
        <Icon size={scale >= 4 ? 30 : 24} strokeWidth={1.8} className={kind === 'loading' ? 'animate-spin' : undefined} />
      </span>
      <h2 className="m-0 text-[18px] font-semibold text-slate-900">{title}</h2>
      {description && <p className="m-0 max-w-md text-[14px] text-slate-600">{description}</p>}
      {action && <div className="mt-1 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
};
