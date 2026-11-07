import React from 'react';
import { BellRing } from 'lucide-react';

/** Alert icon used by the Alerts page header (replaces the old picture). Decorative. */
export const SirenIcon: React.FC<{ className?: string }> = ({ className }) => (
  <BellRing aria-hidden="true" className={className ?? 'h-7 w-7 text-red-600'} strokeWidth={2} />
);
