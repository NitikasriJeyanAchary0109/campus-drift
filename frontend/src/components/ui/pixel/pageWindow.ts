/** The page numbers to show: first, last and the neighbours of the current page, with … for the gaps. */
export const pageWindow = (page: number, pages: number): (number | '…')[] => {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const lo = Math.max(2, page - 1), hi = Math.min(pages - 1, page + 1);
  if (lo > 2) out.push('…');
  for (let p = lo; p <= hi; p++) out.push(p);
  if (hi < pages - 1) out.push('…');
  out.push(pages);
  return out;
};
