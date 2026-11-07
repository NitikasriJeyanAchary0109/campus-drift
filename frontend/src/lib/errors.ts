/**
 * Turns an axios error into a message that is always a string.
 * FastAPI sends `detail` as a string for HTTP errors but as an array of {loc, msg} for 422 validation errors;
 * rendering that array as a React child crashes the page.
 */
export function errorText(err: any, fallback: string): string {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((d) => {
        if (typeof d === 'string') return d;
        const where = Array.isArray(d?.loc) ? d.loc.filter((p: unknown) => p !== 'body').join('.') : '';
        return where ? `${where}: ${d?.msg ?? 'invalid'}` : String(d?.msg ?? 'invalid value');
      })
      .join('; ');
  }
  if (detail && typeof detail === 'object') return String(detail.message ?? detail.msg ?? JSON.stringify(detail));
  return (typeof err?.message === 'string' && err.message) || fallback;
}
