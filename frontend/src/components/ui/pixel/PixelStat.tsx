import React from 'react';
import type { LucideIcon } from 'lucide-react';
import './theme';
import { cx } from './cx';
import type { Tone } from './semantic';

export interface PixelStatProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  /** Small line under the value (a threshold note, a delta). */
  hint?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * KPI card: a tinted icon, the label and a large value. The label and the value are
 * sibling paragraphs (label first), which the existing tests and screen readers read in order.
 */
export const PixelStat: React.FC<PixelStatProps> = ({ label, value, icon: Icon, tone = 'blue', hint, className, 'data-testid': testId }) => (
  <div data-testid={testId} className={cx(`pxl-tone-${tone} flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm`, className)}>
    {Icon && (
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--t-bg)] text-[var(--t-fg)]">
        <Icon size={22} strokeWidth={2.2} />
      </span>
    )}
    <div className="min-w-0">
      <p className="m-0 text-[13px] font-medium leading-tight text-slate-600">{label}</p>
      <p className="m-0 mt-0.5 text-[28px] font-bold leading-none tabular-nums text-slate-900">{value}</p>
      {hint && <p className="m-0 mt-1 text-[13px] leading-tight text-slate-600">{hint}</p>}
    </div>
  </div>
);
