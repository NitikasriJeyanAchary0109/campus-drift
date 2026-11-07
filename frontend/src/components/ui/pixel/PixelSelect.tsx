import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import './theme';
import { cx } from './cx';

export interface PixelSelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label?: string;
  hint?: string;
  error?: string;
  id?: string;
  wrapperClassName?: string;
}

/** Native select (keeps keyboard and screen-reader behaviour) with the Login field styling and a stepped caret. */
export const PixelSelect = React.forwardRef<HTMLSelectElement, PixelSelectProps>(
  ({ label, hint, error, className, wrapperClassName, id: idProp, children, ...rest }, ref) => {
    const auto = useId();
    const id = idProp ?? auto;
    const describedBy = [error && `${id}-err`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
    return (
      <div className={wrapperClassName}>
        {label && <label htmlFor={id} className="mb-1 block text-[14px] font-medium text-slate-800">{label}</label>}
        <div className="relative">
          <select ref={ref} id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={cx('pxl-field pxl-focus', className)} {...rest}>
            {children}
          </select>
          <ChevronDown aria-hidden="true" size={20} strokeWidth={3} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-dw-ink" />
        </div>
        {hint && !error && <p id={`${id}-hint`} className="mt-1 text-[13px] text-dw-muted">{hint}</p>}
        {error && <p id={`${id}-err`} role="alert" className="mt-1 text-[13px] font-medium text-red-700">{error}</p>}
      </div>
    );
  },
);
PixelSelect.displayName = 'PixelSelect';
