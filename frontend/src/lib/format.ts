/** Date, text and severity helpers shared by the pages. */

export const fmtTime = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
  return Number.isNaN(+d) ? String(iso) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const humanize = (s: string): string => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export type AlertSeverity = 'Critical' | 'High' | 'Medium';

/** Alert types the system raises, by urgency. Anything else is Medium. */
export const alertSeverity = (type: string): AlertSeverity => {
  if (['CRITICAL_DRIFT', 'SECURITY_CHANGE', 'REMEDIATION_FAILED', 'ROLLBACK_FAILED'].includes(type)) return 'Critical';
  if (['DEVICE_DOWN', 'CONFIG_PARSE_ERROR', 'COLLECTION_FAILED'].includes(type)) return 'High';
  return 'Medium';
};

/** The status badge each alert severity is drawn with (same colours on Home and Alerts). */
export const SEVERITY_LABEL = { Critical: 'Non-Compliant', High: 'Drift-Unauthorized-High', Medium: 'Drift-Unauthorized-Medium' } as const;

export const triggerDownload = (name: string, text: string, type = 'text/plain;charset=utf-8') => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

/** Slice a list into pages (1-based). */
export function paginate<T>(items: T[], page: number, size: number): T[] {
  return items.slice((page - 1) * size, page * size);
}
