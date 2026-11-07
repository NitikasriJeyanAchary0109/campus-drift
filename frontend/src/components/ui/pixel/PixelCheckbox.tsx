import React, { useEffect, useRef } from 'react';
import { Check, Minus } from 'lucide-react';
import './theme';
import { cx } from './cx';

export interface PixelCheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  label?: React.ReactNode;
  indeterminate?: boolean;
}

/** The native checkbox stays in the DOM (visually hidden but focusable) so role, state and keyboard handling are unchanged. */
export const PixelCheckbox = React.forwardRef<HTMLInputElement, PixelCheckboxProps>(({ label, indeterminate, className, ...rest }, ref) => {
  const inner = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (inner.current) inner.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-[14px] text-slate-800 has-[:disabled]:cursor-not-allowed', className)}>
      {/* the real input sits invisibly over the drawn box, so pointer, keyboard and screen-reader behaviour are the native ones */}
      <span className="relative inline-flex">
        <input
          ref={(el) => { inner.current = el; if (typeof ref === 'function') ref(el); else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el; }}
          type="checkbox"
          className="peer absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          {...rest}
        />
        <span className="pxl-check-box" aria-hidden="true">
          {indeterminate ? <Minus size={16} strokeWidth={4} /> : <Check size={16} strokeWidth={4} />}
        </span>
      </span>
      {label}
    </label>
  );
});
PixelCheckbox.displayName = 'PixelCheckbox';
