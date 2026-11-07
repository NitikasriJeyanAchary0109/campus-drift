import React, { useId, useState } from 'react';
import './theme';
import { cx } from './cx';

export interface PixelTooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  placement?: 'top' | 'bottom';
  /** Make the wrapper focusable. Use it around disabled controls, which cannot take focus themselves. */
  focusable?: boolean;
  className?: string;
}

/** Hover and focus tooltip (role=tooltip, linked with aria-describedby). Escape hides it. */
export const PixelTooltip: React.FC<PixelTooltipProps> = ({ content, children, placement = 'top', focusable, className }) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className={cx('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cx(
            'pxl-pop pointer-events-none absolute left-1/2 z-40 w-max max-w-[260px] -translate-x-1/2 rounded-md bg-slate-900 px-3 py-1.5 text-left text-[13px] font-medium leading-snug text-white shadow-lg',
            placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
};
