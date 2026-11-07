import React from 'react';
import { PixelEmptyState } from '../ui/pixel/PixelEmptyState';
import { PixelButton } from '../ui/pixel/PixelButton';
import { errorText } from '../../lib/errors';

/** Page title, one sentence of help, and the page's one or two actions. */
export const PageHeader: React.FC<{ title: string; description?: React.ReactNode; actions?: React.ReactNode }> = ({ title, description, actions }) => (
  <header className="flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0">
      <h1 className="pxl-title-font m-0 text-[26px] leading-tight sm:text-[28px]">{title}</h1>
      {description && <p className="m-0 mt-1 text-[15px] text-slate-600">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

interface BoundaryProps {
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyText?: string;
  /** What failed to load, for the error message: "problems", "devices". */
  what: string;
  children: React.ReactNode;
}

/** Loading, error (with Retry) and empty states in one place, so no page ever shows made-up data or an empty table for a failed request. */
export const DataBoundary: React.FC<BoundaryProps> = ({ isLoading, error, onRetry, isEmpty, emptyTitle, emptyText, what, children }) => {
  if (isLoading) return <PixelEmptyState kind="loading" title={`Loading ${what}...`} scale={3} />;
  if (error) {
    return (
      <PixelEmptyState
        kind="error"
        title={`Could not load ${what}`}
        description={errorText(error, 'The server did not answer. Check your connection and try again.')}
        action={<PixelButton variant="ghost" size="sm" onClick={onRetry}>Retry</PixelButton>}
        scale={3}
      />
    );
  }
  if (isEmpty) return <PixelEmptyState title={emptyTitle ?? `No ${what}`} description={emptyText} scale={3} />;
  return <>{children}</>;
};

/** The "Filters" toggle: search stays visible, the filter controls open on demand. */
export const FilterToggle: React.FC<{ open: boolean; onToggle: () => void; active: number }> = ({ open, onToggle, active }) => (
  <PixelButton variant="ghost" size="sm" aria-expanded={open} onClick={onToggle}>
    Filters{active > 0 ? ` (${active})` : ''}
  </PixelButton>
);
