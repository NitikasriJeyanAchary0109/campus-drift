import { describe, expect, it } from 'vitest';
import { countByLabelKey, labelKey } from '../../src/lib/labels';

describe('labels (white-box: every branch of lib/labels.ts)', () => {
  it('maps the backend labels onto the UI keys', () => {
    expect(labelKey('Non-Compliant (Critical)')).toBe('Non-Compliant');
    expect(labelKey('Non-Compliant')).toBe('Non-Compliant');
    expect(labelKey('Drift-Unauthorized-Low')).toBe('Drift-Low');
  });

  it.each(['Drift-Unauthorized-High', 'Drift-Unauthorized-Medium', 'Drift-Authorized', 'Compliant', 'NO_BASELINE', '', 'Something-Else'])(
    'passes %j through unchanged',
    (l) => expect(labelKey(l)).toBe(l),
  );

  it('sums counts that fold onto the same key and tolerates undefined', () => {
    expect(countByLabelKey({ 'Non-Compliant (Critical)': 2, 'Non-Compliant': 1, 'Drift-Unauthorized-Low': 3, 'Drift-Low': 1 })).toEqual({ 'Non-Compliant': 3, 'Drift-Low': 4 });
    expect(countByLabelKey(undefined)).toEqual({});
    expect(countByLabelKey({})).toEqual({});
  });
});
