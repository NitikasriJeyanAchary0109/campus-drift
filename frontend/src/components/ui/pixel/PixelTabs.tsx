import React, { useRef } from 'react';
import './theme';
import { cx } from './cx';

export interface PixelTab { id: string; label: React.ReactNode; icon?: React.ReactNode; disabled?: boolean }

export interface PixelTabsProps {
  tabs: PixelTab[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  /** Prefix for tab and panel ids; pair with PixelTabPanel. */
  idPrefix?: string;
  className?: string;
  /** Render plain toggle buttons (aria-pressed) inside a labelled group instead of ARIA tabs, for pages whose tests and users already treat them as buttons. */
  asButtons?: boolean;
}

/** Tab strip with roving focus: arrow keys, Home and End move between tabs. The active tab is yellow and pressed. */
export const PixelTabs: React.FC<PixelTabsProps> = ({ tabs, value, onChange, label, idPrefix = 'pxl-tabs', className, asButtons }) => {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = tabs.filter((t) => !t.disabled);
  const onKey = (e: React.KeyboardEvent) => {
    const i = enabled.findIndex((t) => t.id === value);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = enabled.length - 1;
    if (n < 0) return;
    e.preventDefault();
    const t = enabled[n];
    onChange(t.id);
    refs.current[t.id]?.focus();
  };
  return (
    <div role={asButtons ? 'group' : 'tablist'} aria-label={label} onKeyDown={asButtons ? undefined : onKey} className={cx('flex flex-wrap gap-1 border-b border-slate-200', className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el; }}
            {...(asButtons
              ? { type: 'button' as const, 'aria-pressed': active }
              : { role: 'tab', id: `${idPrefix}-tab-${t.id}`, 'aria-selected': active, 'aria-controls': `${idPrefix}-panel-${t.id}`, tabIndex: active ? 0 : -1 })}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            className={cx(
              'pxl-focus -mb-px inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-60',
              active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900',
            )}
          >
            {t.icon && <span aria-hidden="true" className="flex">{t.icon}</span>}
            {t.label}
          </button>
        );
      })}
    </div>
  );
};

export const PixelTabPanel: React.FC<{ id: string; active: boolean; idPrefix?: string; className?: string; children: React.ReactNode }> = ({ id, active, idPrefix = 'pxl-tabs', className, children }) => (
  <div role="tabpanel" id={`${idPrefix}-panel-${id}`} aria-labelledby={`${idPrefix}-tab-${id}`} hidden={!active} className={className}>
    {active ? children : null}
  </div>
);
