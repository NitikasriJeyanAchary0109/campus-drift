/**
 * The backend's taxonomy labels (docs/labels-and-thresholds.md) are
 *   "Non-Compliant (Critical)", "Drift-Unauthorized-High", "Drift-Unauthorized-Medium",
 *   "Drift-Unauthorized-Low", "Drift-Authorized", "Compliant", "NO_BASELINE".
 * The UI styles and filters by short keys; this maps one to the other in a single place. (Mismatched keys had made
 * the dashboard show 0 for the critical and low tiles and style critical events as plain grey.)
 */
export type LabelKey =
  | 'Non-Compliant'
  | 'Drift-Unauthorized-High'
  | 'Drift-Unauthorized-Medium'
  | 'Drift-Low'
  | 'Drift-Authorized'
  | 'Compliant'
  | 'NO_BASELINE'
  | string;

export const labelKey = (label: string): LabelKey => {
  if (label.startsWith('Non-Compliant')) return 'Non-Compliant';
  if (label === 'Drift-Unauthorized-Low') return 'Drift-Low';
  return label;
};

/** Sum backend counts (keyed by full label) into UI keys. */
export const countByLabelKey = (counts: Record<string, number> | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  Object.entries(counts || {}).forEach(([label, n]) => {
    const k = labelKey(label);
    out[k] = (out[k] || 0) + n;
  });
  return out;
};
