import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';

export interface AlertItem {
  id: string;
  type: string;
  related_id?: string | null;
  message: string;
  acknowledged: boolean;
  created_at: string;
}

/** The latest alerts (newest first). Shared by the top bar badge, Home and the Alerts page. */
export const useAlerts = () =>
  useQuery<AlertItem[]>({
    queryKey: ['alerts'],
    queryFn: async () => (await apiClient.get('/api/alerts?limit=100')).data,
    refetchInterval: 30000,
  });

/** Where "Investigate" goes for an alert, by what it is about. */
export const alertTarget = (a: AlertItem): string | null => {
  if (!a.related_id) return null;
  if (/^(DEVICE|COLLECTION)/.test(a.type)) return `/devices/${a.related_id}`;
  if (/^(REMEDIATION|ROLLBACK)/.test(a.type)) return `/remediation?plan_id=${a.related_id}`;
  return `/drift/${a.related_id}`;
};

