import React from 'react';
import './theme';
import { cx } from './cx';

export interface PixelRibbonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Heading level for the text (the header is a heading when `as` is set). */
  as?: 'h1' | 'h2' | 'h3' | 'div';
  /** Neutral by default; green, red and blue are tinted headers (diff panes, status panels). */
  tone?: 'yellow' | 'red' | 'blue' | 'cream' | 'green';
  /** Content aligned to the right end of the header (counts, actions). */
  trailing?: React.ReactNode;
  icon?: React.ReactNode;
  /** Let long titles wrap onto a second line instead of being cut with an ellipsis. */
  wrap?: boolean;
}

const TONE = {
  yellow: 'bg-slate-50 text-slate-900 border-slate-200',
  cream: 'bg-slate-50 text-slate-900 border-slate-200',
  green: 'bg-green-50 text-green-900 border-green-200',
  red: 'bg-red-50 text-red-900 border-red-200',
  blue: 'bg-blue-50 text-blue-900 border-blue-200',
} as const;

/** Panel header: a title with an optional icon and trailing content, separated from the body by a hairline. */
export const PixelRibbon: React.FC<PixelRibbonProps> = ({ as: Tag = 'div', tone = 'yellow', trailing, icon, wrap, className, children, ...rest }) => (
  <div
    className={cx(
      wrap ? 'flex flex-wrap items-center gap-x-2 gap-y-1' : 'flex items-center gap-2',
      'border-b px-4 py-3 text-[15px] font-semibold',
      TONE[tone],
      className,
    )}
    {...rest}
  >
    {icon && <span aria-hidden="true" className="flex shrink-0 items-center text-slate-500">{icon}</span>}
    <Tag className={cx('m-0 min-w-0 flex-1 text-inherit', wrap ? 'leading-tight' : 'truncate')} style={{ font: 'inherit' }}>{children}</Tag>
    {trailing && <span className="shrink-0 font-normal">{trailing}</span>}
  </div>
);
