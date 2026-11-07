import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, ShieldCheck, Info, AlertTriangle, AlertOctagon, Siren, CircleDashed } from 'lucide-react';
import { labelKey } from '../../../lib/labels';

export type Tone = 'green' | 'blue' | 'yellow' | 'orange' | 'red' | 'crimson' | 'gray' | 'navy' | 'cream';

export interface LabelStyle {
  /** The backend taxonomy label this style stands for. */
  label: string;
  /** Short text shown in the badge. Colour is never the only signal: every style has this text and an icon. */
  text: string;
  icon: LucideIcon;
  tone: Tone;
  /** Reserved for the critical level (solid dark red). */
  hazard?: boolean;
  /** Grey with a dashed outline. */
  dashed?: boolean;
}

/**
 * The one place that maps a taxonomy label to colour, icon and text.
 * Compliant=green, Drift-Authorized=blue, Low=yellow, Medium=orange, High=red,
 * Non-Compliant (Critical)=solid dark red, NO_BASELINE=grey with a dashed outline.
 */
export const LABEL_STYLES: Record<string, LabelStyle> = {
  Compliant: { label: 'Compliant', text: 'Compliant', icon: CheckCircle2, tone: 'green' },
  'Drift-Authorized': { label: 'Drift-Authorized', text: 'Authorized', icon: ShieldCheck, tone: 'blue' },
  'Drift-Low': { label: 'Drift-Unauthorized-Low', text: 'Low', icon: Info, tone: 'yellow' },
  'Drift-Unauthorized-Medium': { label: 'Drift-Unauthorized-Medium', text: 'Medium', icon: AlertTriangle, tone: 'orange' },
  'Drift-Unauthorized-High': { label: 'Drift-Unauthorized-High', text: 'High', icon: AlertOctagon, tone: 'red' },
  'Non-Compliant': { label: 'Non-Compliant (Critical)', text: 'Critical', icon: Siren, tone: 'crimson', hazard: true },
  NO_BASELINE: { label: 'NO_BASELINE', text: 'No baseline', icon: CircleDashed, tone: 'gray', dashed: true },
};

const UNKNOWN: LabelStyle = { label: 'Unknown', text: 'Unknown', icon: CircleDashed, tone: 'gray', dashed: true };

/** Style for a backend label ("Drift-Unauthorized-Low") or a UI key ("Drift-Low"). */
export const labelStyle = (label: string): LabelStyle => {
  const s = LABEL_STYLES[labelKey(label)];
  return s ? s : { ...UNKNOWN, label: label || UNKNOWN.label, text: label || UNKNOWN.text };
};

/** Display order, most to least urgent. */
export const LABEL_ORDER = ['Non-Compliant', 'Drift-Unauthorized-High', 'Drift-Unauthorized-Medium', 'Drift-Low', 'Drift-Authorized', 'Compliant', 'NO_BASELINE'] as const;
