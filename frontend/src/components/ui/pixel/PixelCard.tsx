import React from 'react';
import { PixelPanel, PixelPanelProps } from './PixelPanel';
import { cx } from './cx';

export interface PixelCardProps extends PixelPanelProps {
  /** Make the whole card a pressable surface (hover, focus). The caller adds the click handler and role. */
  interactive?: boolean;
}

/** A panel with comfortable padding. Use `interactive` for cards that act like buttons. */
export const PixelCard: React.FC<PixelCardProps> = ({ interactive, bodyClassName, className, ...rest }) => (
  <PixelPanel
    fill="paper"
    shadow={1}
    className={cx(interactive && 'pxl-focus cursor-pointer transition-shadow hover:shadow-md', className)}
    bodyClassName={cx('p-4', bodyClassName)}
    {...rest}
  />
);
