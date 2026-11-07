import React from 'react';
import { Check, X, Circle } from 'lucide-react';
import './theme';
import { cx } from './cx';

export interface PixelProgressProps {
  /** 0-100. Omit for an indeterminate (working) bar. */
  value?: number;
  /** Accessible name. */
  label: string;
  tone?: 'green' | 'blue' | 'yellow' | 'red';
  /** Show the value as text next to the bar. */
  showValue?: boolean;
  className?: string;
}

const FILL = { green: 'bg-green-600', blue: 'bg-blue-600', yellow: 'bg-amber-500', red: 'bg-red-600' } as const;

/** Segmented bar: the fill is cut into 8px blocks so it reads as pixels. Indeterminate bars use a moving stripe. */
export const PixelProgress: React.FC<PixelProgressProps> = ({ value, label, tone = 'green', showValue, className }) => {
  const known = typeof value === 'number';
  const v = known ? Math.min(100, Math.max(0, value!)) : 0;
  return (
    <div className={cx('flex items-center gap-3', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? Math.round(v) : undefined}
        aria-busy={known ? undefined : true}
        className="relative h-2.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className={cx('h-full rounded-full', FILL[tone], !known && 'pxl-barber')}
          style={{
            width: known ? `${v}%` : '100%',
            backgroundImage: known ? undefined : 'repeating-linear-gradient(135deg, rgba(255,255,255,.35) 0 8px, transparent 8px 16px)',
            backgroundSize: known ? undefined : '32px 32px',
          }}
        />
      </div>
      {showValue && known && <span className="w-10 shrink-0 text-right text-[14px] font-semibold tabular-nums">{Math.round(v)}%</span>}
    </div>
  );
};

export type StepState = 'pending' | 'active' | 'done' | 'failed';
export interface PixelStep { id: string; label: string; state: StepState; detail?: string }

const STEP_TONE: Record<StepState, string> = { pending: 'pxl-tone-gray', active: 'pxl-tone-yellow', done: 'pxl-tone-green', failed: 'pxl-tone-red' };

/**
 * Pipeline stepper (for example Backup, Push, Verify, Rollback). Each step shows an icon and text for its state, so colour is never
 * the only signal; the current step carries aria-current="step".
 */
export const PixelSteps: React.FC<{ steps: PixelStep[]; label: string; className?: string }> = ({ steps, label, className }) => (
  <ol aria-label={label} className={cx('m-0 flex list-none flex-wrap items-stretch gap-2 p-0', className)}>
    {steps.map((s, i) => (
      <li key={s.id} aria-current={s.state === 'active' ? 'step' : undefined} className="flex min-w-[120px] flex-1 flex-col gap-1">
        <div className={cx('flex items-center gap-2 rounded-md border border-[var(--t-edge)] bg-[var(--t-bg)] px-3 py-1.5 text-[var(--t-fg)]', STEP_TONE[s.state], s.state === 'pending' && 'pxl-dashed')}>
          <span aria-hidden="true" className="flex">
            {s.state === 'done' ? <Check size={16} strokeWidth={4} /> : s.state === 'failed' ? <X size={16} strokeWidth={4} /> : s.state === 'active' ? <span className="pxl-spin" /> : <Circle size={14} strokeWidth={3} />}
          </span>
          <span className="text-[14px] font-semibold">{i + 1}. {s.label}</span>
        </div>
        <span className="pl-1 text-[13px] text-dw-muted">{s.detail ?? { pending: 'Waiting', active: 'In progress', done: 'Done', failed: 'Failed' }[s.state]}</span>
      </li>
    ))}
  </ol>
);
