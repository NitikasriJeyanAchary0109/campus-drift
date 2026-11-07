import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../src/components/ui/pixel/tokens.css'), 'utf8');

const vars: Record<string, string> = {};
for (const m of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
const resolveColor = (v: string): string => {
  const ref = v.match(/^var\(--([\w-]+)\)$/);
  return ref ? resolveColor(vars[ref[1]]) : v;
};
const lum = (hex: string) => {
  const h = hex.length === 4 ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(resolveColor(a)), lum(resolveColor(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const color = (name: string) => `var(--dw-${name})`;

const tones = [...css.matchAll(/\.pxl-tone-(\w+)\s*\{\s*--t-bg:\s*([^;]+);\s*--t-fg:\s*([^;]+);/g)].map((m) => ({ name: m[1], bg: m[2].trim(), fg: m[3].trim() }));

describe('design tokens (WCAG contrast, computed from tokens.css)', () => {
  it('reads the palette and the tone table from the stylesheet', () => {
    expect(vars['dw-ink']).toBe('#0f172a');
    expect(tones.map((t) => t.name).sort()).toEqual(['blue', 'cream', 'crimson', 'gray', 'green', 'navy', 'orange', 'red', 'yellow']);
  });

  it.each(tones)('tone $name: text on its fill is at least 4.5:1', ({ bg, fg }) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['ink on cream', 'ink', 'cream'], ['ink on paper', 'ink', 'paper'], ['ink on page background', 'ink', 'sky-pale'],
    ['muted on cream', 'text-muted', 'cream'], ['muted on paper', 'text-muted', 'paper'], ['muted on page background', 'text-muted', 'sky-pale'],
    ['orange text on cream', 'text-orange', 'cream'], ['error red on paper', 'red-dark', 'paper'],
    ['white on navy (table header)', 'cream', 'navy'], ['ink on yellow (active tab)', 'ink', 'yellow'], ['ink on sky-2', 'ink', 'sky-2'], ['diff added line', 'diff-add-fg', 'diff-add-bg'], ['diff removed line', 'diff-del-fg', 'diff-del-bg'],
  ])('body text: %s is at least 4.5:1', (_n, fg, bg) => {
    expect(ratio(color(fg), color(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['outline on cream', 'ink', 'cream'], ['outline on page background', 'ink', 'sky-pale'], ['focus ring (blue) on white', 'blue', 'paper'], ['input border on white', 'gray-dark', 'paper'],
    ['focus ring (ink) on navy', 'cream', 'navy'], ['focus ring (yellow) on ink', 'yellow', 'ink'],
  ])('UI boundary: %s is at least 3:1', (_n, a, b) => {
    expect(ratio(color(a), color(b))).toBeGreaterThanOrEqual(3);
  });

  it('loads no web fonts: the UI uses the system font stack', () => {
    expect(css).not.toMatch(/@font-face/);
    const theme = readFileSync(resolve(__dirname, '../../src/components/ui/pixel/theme.ts'), 'utf8');
    expect(theme).not.toMatch(/fontsource/);
    expect(vars['pxl-font-pixel']).toMatch(/system-ui/);
  });

  it.each([
    ['primary button', '#ffffff', '#2563eb'], ['secondary button', '#1e3a8a', '#eff6ff'], ['ghost button', '#0f172a', '#ffffff'],
    ['danger button', '#ffffff', '#dc2626'], ['success button', '#ffffff', '#15803d'], ['sidebar link', '#cbd5e1', '#0f172a'], ['active sidebar link', '#ffffff', '#2563eb'],
  ])('button colours: %s text is at least 4.5:1', (_n, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
