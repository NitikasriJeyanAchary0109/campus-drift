import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './theme';
import { cx } from './cx';
import { PixelPanel } from './PixelPanel';
import { PixelRibbon } from './PixelRibbon';

export interface PixelModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Buttons row, right aligned. */
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Close when the backdrop is clicked (default true). */
  dismissOnBackdrop?: boolean;
  className?: string;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const WIDTH = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' } as const;

/**
 * Dialog in a notched panel with a ribbon title. role=dialog, aria-modal, labelled by its title. Escape and the close button
 * close it, Tab is kept inside it and focus returns to the opener on close.
 */
export const PixelModal: React.FC<PixelModalProps> = ({ open, onClose, title, children, footer, size = 'md', dismissOnBackdrop = true, className }) => {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus],input,select,textarea') ?? box.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const items = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      opener.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="pxl-app fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4" style={{ background: 'rgba(15,23,42,.55)' }} onMouseDown={(e) => { if (dismissOnBackdrop && e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cx('pxl-pop my-auto w-full', WIDTH[size], className)}>
        <PixelPanel shadow={3} fill="paper" header={
          <PixelRibbon
            trailing={<button type="button" onClick={onClose} aria-label="Close dialog" className="pxl-focus flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={18} strokeWidth={2.4} aria-hidden="true" /></button>}
          >
            <span id={titleId}>{title}</span>
          </PixelRibbon>
        }>
          <div className="p-5 text-[15px]">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</div>}
        </PixelPanel>
      </div>
    </div>,
    document.body,
  );
};
