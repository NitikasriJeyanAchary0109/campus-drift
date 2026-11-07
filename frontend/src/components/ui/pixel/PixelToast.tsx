import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Info, AlertOctagon, X } from 'lucide-react';
import './theme';
import { cx } from './cx';

export type ToastKind = 'success' | 'error' | 'info';
export interface ToastItem { id: number; kind: ToastKind; title: string; detail?: string }

const ICON = { success: CheckCircle2, error: AlertOctagon, info: Info } as const;
const TONE = { success: 'pxl-tone-green', error: 'pxl-tone-red', info: 'pxl-tone-blue' } as const;

/** One toast. Errors use role=alert (announced at once), the rest role=status. */
export const PixelToast: React.FC<{ kind?: ToastKind; title: string; detail?: string; onClose?: () => void; className?: string; action?: React.ReactNode }> = ({ kind = 'info', title, detail, onClose, className, action }) => {
  const Icon = ICON[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cx('pxl-pop', className)}>
      <div className={cx('flex items-start gap-3 rounded-lg border border-[var(--t-edge)] bg-[var(--t-bg)] px-3.5 py-3 text-[var(--t-fg)] shadow-md', TONE[kind])}>
        <Icon aria-hidden="true" size={20} strokeWidth={2.2} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 text-[14px] leading-snug">
          <p className="m-0 font-semibold">{title}</p>
          {detail && <p className="m-0 mt-0.5">{detail}</p>}
          {action && <p className="m-0 mt-1">{action}</p>}
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Dismiss notification" className="pxl-focus -mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-black/10">
            <X size={14} strokeWidth={2.6} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
};

interface ToastApi { push: (t: Omit<ToastItem, 'id'>) => void; success: (title: string, detail?: string) => void; error: (title: string, detail?: string) => void; info: (title: string, detail?: string) => void }
const Ctx = createContext<ToastApi | null>(null);

/** Mount once near the root; call useToast() anywhere below. Toasts clear themselves after 6 seconds (errors after 10). */
export const PixelToaster: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const drop = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-3), { ...t, id }]);
    window.setTimeout(() => drop(id), t.kind === 'error' ? 10000 : 6000);
  }, [drop]);
  const api = useMemo<ToastApi>(() => ({
    push,
    success: (title, detail) => push({ kind: 'success', title, detail }),
    error: (title, detail) => push({ kind: 'error', title, detail }),
    info: (title, detail) => push({ kind: 'info', title, detail }),
  }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {/* inline position (not a `fixed` class): the browser tests find open dialogs with the .fixed class */}
      <div className="pxl-app pointer-events-none z-[60] flex w-[min(92vw,360px)] flex-col gap-3" style={{ position: 'fixed', bottom: 16, right: 16, background: 'none' }}>
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <PixelToast kind={t.kind} title={t.title} detail={t.detail} onClose={() => drop(t.id)} />
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- hook lives beside its provider
export const useToast = (): ToastApi => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast must be used inside <PixelToaster>');
  return v;
};
