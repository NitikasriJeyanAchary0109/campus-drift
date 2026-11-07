import { clsx, type ClassValue } from 'clsx';

/** Class-name joiner used by the pixel components. */
export const cx = (...v: ClassValue[]): string => clsx(v);
