import React from 'react';
import './theme';
import { cx } from './cx';

/** Loading placeholder: a stepped blinking block. Decorative (aria-hidden); wrap the area in aria-busy where it matters. */
export const PixelSkeleton: React.FC<{ className?: string; width?: number | string; height?: number | string; lines?: number }> = ({ className, width, height = 16, lines = 1 }) => (
  <div aria-hidden="true" className="flex flex-col gap-2" style={{ width }}>
    {Array.from({ length: lines }, (_, i) => (
      <div
        key={i}
        className={cx('pxl-skel border-2 border-dw-ink bg-dw-cream-2', className)}
        style={{ height, width: lines > 1 && i === lines - 1 ? '60%' : '100%', borderRadius: 6 }}
      />
    ))}
  </div>
);
