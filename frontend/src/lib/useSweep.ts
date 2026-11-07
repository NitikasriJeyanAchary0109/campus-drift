import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';

export interface SweepResult { started: number; failed: number; skipped: number; message: string }

/** Campus sweep: ask the server to collect the configuration of every SSH-managed device. Results appear as the collections finish. */
export function useSweep() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SweepResult | null>(null);

  const run = async (): Promise<SweepResult> => {
    setRunning(true);
    setResult(null);
    try {
      const devices: any[] = (await apiClient.get('/api/devices')).data ?? [];
      const targets = devices.filter((d) => (d.collection_mode ?? 'SSH_POLL') === 'SSH_POLL');
      const outcomes = await Promise.allSettled(targets.map((d) => apiClient.post(`/api/devices/${d.id}/poll`)));
      const failed = outcomes.filter((o) => o.status === 'rejected').length;
      const started = outcomes.length - failed;
      const skipped = devices.length - targets.length;
      const message =
        targets.length === 0
          ? 'No devices are set to be collected over SSH.'
          : failed === 0
            ? `Collection started on ${started} ${started === 1 ? 'device' : 'devices'}. Results appear as each one finishes.`
            : `Collection started on ${started} of ${targets.length} devices; ${failed} could not be started.`;
      const r = { started, failed, skipped, message };
      setResult(r);
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['dashboardSummary'] });
      return r;
    } catch (err: any) {
      const r = { started: 0, failed: 1, skipped: 0, message: `The sweep did not start: ${err?.response?.data?.detail ?? err?.message ?? 'unknown error'}` };
      setResult(r);
      return r;
    } finally {
      setRunning(false);
    }
  };

  return { run, running, result, clear: () => setResult(null) };
}
