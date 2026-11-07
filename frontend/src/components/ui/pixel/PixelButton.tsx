import React from 'react';
import './theme';
import { cx } from './cx';

export type PixelButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export interface PixelButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PixelButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  /** Shows a spinner, sets aria-busy and ignores clicks. The accessible name stays the children. */
  loading?: boolean;
  /** Icon shown before the label (decorative). */
  icon?: React.ReactNode;
  /** Force the pressed look (toggle buttons). */
  pressed?: boolean;
}

/** Button. Variants: primary (blue), secondary (tinted blue), ghost (outlined), danger (red), success (green). */
export const PixelButton = React.forwardRef<HTMLButtonElement, PixelButtonProps>(
  ({ variant = 'primary', size = 'md', loading, icon, pressed, className, children, disabled, type = 'button', onClick, ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      data-pressed={pressed || undefined}
      onClick={loading ? undefined : onClick}
      className={cx('pxl-btn pxl-focus', `pxl-btn-${size}`, `pxl-btn-${variant}`, className)}
      {...rest}
    >
      {loading ? <span className="pxl-spin" aria-hidden="true" /> : icon && <span aria-hidden="true" className="flex shrink-0 items-center">{icon}</span>}
      {children}
    </button>
  ),
);
PixelButton.displayName = 'PixelButton';
