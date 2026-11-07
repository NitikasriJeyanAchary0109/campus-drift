import React from 'react';
import './theme';
import { cx } from './cx';

export interface PixelPanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Surface of the body. */
  fill?: 'cream' | 'paper' | 'navy' | 'ink';
  /** Outline colour (default neutral). */
  frame?: 'ink' | 'green' | 'red' | 'blue' | 'yellow' | 'orange';
  /** Outline thickness step: 1 and 2 are 1px, 3 is 2px (used to emphasise coloured outlines). */
  line?: 1 | 2 | 3;
  /** Elevation: 0 none, 1 subtle, 2 card, 3 raised. */
  shadow?: 0 | 1 | 2 | 3;
  /** Extra classes for the body. */
  bodyClassName?: string;
  /** Header content (a PixelRibbon) shown above the body. */
  header?: React.ReactNode;
}

const FILL = { cream: 'bg-slate-50 text-slate-900', paper: 'bg-white text-slate-900', navy: 'bg-slate-800 text-white', ink: 'bg-slate-900 text-white' } as const;
const FRAME = { ink: 'border-slate-200', green: 'border-green-600', red: 'border-red-600', blue: 'border-blue-600', yellow: 'border-amber-500', orange: 'border-orange-500' } as const;
const SHADOW = ['', 'shadow-sm', 'shadow', 'shadow-lg'] as const;

/** Card surface: white, 1px border, 8px corners. All other attributes land on the outer element. */
export const PixelPanel: React.FC<PixelPanelProps> = ({ fill = 'cream', frame = 'ink', line = 3, shadow = 2, bodyClassName, header, className, children, ...rest }) => (
  <div className={cx('overflow-hidden rounded-lg bg-white', line === 3 && frame !== 'ink' ? 'border-2' : 'border', FRAME[frame], SHADOW[shadow], className)} {...rest}>
    {header}
    <div className={cx(FILL[fill], bodyClassName)}>{children}</div>
  </div>
);
