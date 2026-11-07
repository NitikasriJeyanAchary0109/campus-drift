import React from 'react';
import './theme';
import { cx } from './cx';

export interface PixelTableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** Accessible caption (visually hidden); tables without a visible heading should set it. */
  caption?: string;
  /** Max height of the scroll area; the header stays pinned while the body scrolls. */
  maxHeight?: number | string;
  /** Classes for the scroll container. */
  containerClassName?: string;
}

/** Data table in a bordered container. It scrolls horizontally inside the container, the header row is sticky, cells are 14px. */
export const PixelTable: React.FC<PixelTableProps> = ({ caption, maxHeight, containerClassName, className, children, ...rest }) => (
  <div className={cx('pxl-scroll overflow-x-auto rounded-lg border border-slate-200 bg-white', containerClassName)} style={{ maxHeight, overflowY: maxHeight ? 'auto' : undefined }}>
    <table className={cx('w-full min-w-[640px] border-separate border-spacing-0 text-[14px] leading-[1.45] text-slate-900', className)} {...rest}>
      {caption && <caption className="sr-only">{caption}</caption>}
      {children}
    </table>
  </div>
);

export const PixelThead: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ className, ...rest }) => (
  <thead className={cx('sticky top-0 z-[1]', className)} {...rest} />
);
export const PixelTbody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ className, ...rest }) => (
  <tbody className={cx('[&>tr:nth-child(even)]:bg-slate-50/70', className)} {...rest} />
);
export const PixelTr: React.FC<React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean; selected?: boolean }> = ({ className, interactive, selected, ...rest }) => (
  <tr
    className={cx(
      interactive && 'pxl-focus cursor-pointer hover:bg-blue-50 focus-visible:bg-blue-50',
      selected && '!bg-blue-50',
      className,
    )}
    {...rest}
  />
);
export const PixelTh: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({ className, scope = 'col', ...rest }) => (
  <th
    scope={scope}
    className={cx('whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-[13px] font-semibold text-slate-600', className)}
    {...rest}
  />
);
export const PixelTd: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({ className, ...rest }) => (
  <td className={cx('border-b border-slate-100 px-3 py-2.5 align-middle', className)} {...rest} />
);
