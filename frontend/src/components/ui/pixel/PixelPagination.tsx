import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './theme';
import { cx } from './cx';
import { PixelButton } from './PixelButton';
import { PixelSelect } from './PixelSelect';
import { pageWindow } from './pageWindow';

export interface PixelPaginationProps {
  /** 1-based current page. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
  className?: string;
  /** What is being counted, for the readout ("of 67 events"). */
  noun?: string;
  /**
   * Keeps the earlier page-control wording for pages whose tests and users rely on it: buttons named "<", "1".."5", "...", last page, ">"
   * and the readout "Showing 7 - 12 of 67 events".
   */
  legacy?: boolean;
}

/** Page numbers with ellipses, previous/next, a "Showing a-b of n" readout and an optional page-size select. */
export const PixelPagination: React.FC<PixelPaginationProps> = ({ page, pageSize, total, onPageChange, pageSizeOptions, onPageSizeChange, className, noun, legacy }) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(total, cur * pageSize);
  if (legacy) {
    const first = Array.from({ length: Math.min(5, pages) }, (_, i) => i + 1);
    const Btn: React.FC<{ n: number }> = ({ n }) => (
      <PixelButton variant={n === cur ? 'secondary' : 'ghost'} size="sm" pressed={n === cur} aria-current={n === cur ? 'page' : undefined} onClick={() => onPageChange(n)} className="min-w-[38px] !px-2">{n}</PixelButton>
    );
    return (
      <nav aria-label="Pagination" className={cx('flex flex-wrap items-center justify-between gap-3 font-body text-[14px] text-dw-ink', className)}>
        <span aria-live="polite">{`Showing ${from} - ${to} of ${total}${noun ? ` ${noun}` : ''}`}</span>
        <div className="flex flex-wrap items-center gap-2">
          <PixelButton variant="ghost" size="sm" onClick={() => onPageChange(Math.max(1, cur - 1))} disabled={cur <= 1} className="!px-3">&lt;</PixelButton>
          {first.map((n) => <Btn key={n} n={n} />)}
          {pages > 5 && <span aria-hidden="true" className="px-1 font-extrabold">...</span>}
          {pages > 5 && <Btn n={pages} />}
          <PixelButton variant="ghost" size="sm" onClick={() => onPageChange(Math.min(pages, cur + 1))} disabled={cur >= pages} className="!px-3">&gt;</PixelButton>
        </div>
      </nav>
    );
  }
  return (
    <nav aria-label="Pagination" className={cx('flex flex-wrap items-center justify-between gap-3 font-body text-[14px] text-dw-ink', className)}>
      <p className="m-0" aria-live="polite">{`Showing ${from}–${to} of ${total}${noun ? ` ${noun}` : ''}`}</p>
      <div className="flex flex-wrap items-center gap-2">
        {pageSizeOptions && onPageSizeChange && (
          <PixelSelect aria-label="Rows per page" value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} className="!min-h-[36px] !py-1 !text-[14px]" wrapperClassName="w-36">
            {pageSizeOptions.map((n) => <option key={n} value={n}>{n} / page</option>)}
          </PixelSelect>
        )}
        <PixelButton variant="ghost" size="sm" aria-label="Previous page" disabled={cur <= 1} onClick={() => onPageChange(cur - 1)} icon={<ChevronLeft size={16} strokeWidth={3} />} />
        <ul className="m-0 flex list-none gap-1.5 p-0">
          {pageWindow(cur, pages).map((p, i) => (
            <li key={`${p}-${i}`}>
              {p === '…' ? (
                <span aria-hidden="true" className="inline-flex h-[34px] w-6 items-end justify-center pb-1 font-extrabold">…</span>
              ) : (
                <PixelButton
                  variant={p === cur ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-label={`Page ${p}`}
                  aria-current={p === cur ? 'page' : undefined}
                  pressed={p === cur}
                  onClick={() => onPageChange(p)}
                  className="min-w-[38px] !px-2"
                >
                  {p}
                </PixelButton>
              )}
            </li>
          ))}
        </ul>
        <PixelButton variant="ghost" size="sm" aria-label="Next page" disabled={cur >= pages} onClick={() => onPageChange(cur + 1)} icon={<ChevronRight size={16} strokeWidth={3} />} />
      </div>
    </nav>
  );
};
