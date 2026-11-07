import React from 'react';
import type { LucideIcon } from 'lucide-react';
import './theme';
import { cx } from './cx';
import { labelStyle, type Tone } from './semantic';

interface Base { size?: 'sm' | 'md'; className?: string; title?: string; 'data-testid'?: string }
export interface PixelTaxonomyBadgeProps extends Base {
  /** A backend taxonomy label or UI key: colour, icon and text come from semantic.ts. */
  taxonomy: string;
  /** Show the full backend label instead of the short text. */
  verbose?: boolean;
  tone?: never; icon?: never; children?: never;
}
export interface PixelToneBadgeProps extends Base {
  tone: Tone;
  icon?: LucideIcon;
  children: React.ReactNode;
  hazard?: boolean;
  dashed?: boolean;
  taxonomy?: never; verbose?: never;
}
export type PixelBadgeProps = PixelTaxonomyBadgeProps | PixelToneBadgeProps;

/**
 * Status and severity badge. It always carries text and (for taxonomy badges) an icon, so colour is never the only signal.
 * Critical gets a hazard stripe and NO_BASELINE a dashed outline.
 */
export const PixelBadge: React.FC<PixelBadgeProps> = (props) => {
  const { size = 'md', className, title } = props;
  let tone: Tone, Icon: LucideIcon | undefined, text: React.ReactNode, dashed = false, full: string | undefined;
  if ('taxonomy' in props && props.taxonomy !== undefined) {
    const s = labelStyle(props.taxonomy);
    tone = s.tone; Icon = s.icon; dashed = !!s.dashed; full = s.label;
    text = props.verbose ? s.label : s.text;
  } else {
    const p = props as PixelToneBadgeProps;
    tone = p.tone; Icon = p.icon; text = p.children; dashed = !!p.dashed;
  }
  const font = size === 'sm' ? 'text-[12px]' : 'text-[13px]';
  const testId = props['data-testid'];
  return (
    <span
      title={title ?? full}
      data-testid={testId}
      className={cx(
        'pxl-tone-' + tone,
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-[var(--t-edge)] bg-[var(--t-bg)] align-middle font-semibold leading-none text-[var(--t-fg)]',
        size === 'sm' ? 'px-2 py-1' : 'px-2.5 py-1.5',
        font,
        dashed && 'pxl-dashed border-dashed',
        className,
      )}
    >
      {Icon && <Icon aria-hidden="true" size={size === 'sm' ? 13 : 14} strokeWidth={2.4} className="shrink-0" />}
      <span>{text}</span>
    </span>
  );
};
