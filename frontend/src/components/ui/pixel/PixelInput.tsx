import React, { useId } from 'react';
import './theme';
import { cx } from './cx';

export interface PixelInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Visible label. Without one, pass aria-label. */
  label?: string;
  hint?: string;
  /** Error text; also sets aria-invalid and is announced through aria-describedby. */
  error?: string;
  /** Decorative icon inside the left edge. */
  icon?: React.ReactNode;
  /** Element inside the right edge (a clear or reveal button). */
  trailing?: React.ReactNode;
  id?: string;
  wrapperClassName?: string;
}

export const PixelInput = React.forwardRef<HTMLInputElement, PixelInputProps>(
  ({ label, hint, error, icon, trailing, className, wrapperClassName, id: idProp, style, ...rest }, ref) => {
    const auto = useId();
    const id = idProp ?? auto;
    const describedBy = [error && `${id}-err`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
    return (
      <div className={wrapperClassName}>
        {label && <label htmlFor={id} className="mb-1 block text-[14px] font-medium text-slate-800">{label}</label>}
        <div className="relative">
          {icon && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-dw-ink">{icon}</span>}
          <input
            ref={ref}
            id={id}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cx('pxl-field pxl-focus', className)}
            style={{ ...(icon ? { paddingLeft: 40 } : null), ...(trailing ? { paddingRight: 44 } : null), ...style }}
            {...rest}
          />
          {trailing && <span className="absolute inset-y-0 right-2 flex items-center">{trailing}</span>}
        </div>
        {hint && !error && <p id={`${id}-hint`} className="mt-1 text-[13px] text-dw-muted">{hint}</p>}
        {error && <p id={`${id}-err`} role="alert" className="mt-1 text-[13px] font-medium text-red-700">{error}</p>}
      </div>
    );
  },
);
PixelInput.displayName = 'PixelInput';
