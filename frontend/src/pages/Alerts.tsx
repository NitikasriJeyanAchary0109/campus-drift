import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  Bell,
  Check,
  CheckCircle2,
  AlertTriangle,
  ServerCrash,
  ShieldAlert,
  Flame,
  Clock,
  ExternalLink,
  Filter,
  Lock,
} from 'lucide-react';

interface AlertItem {
  id: string;
  type: 'CRITICAL_DRIFT' | 'DEVICE_DOWN' | 'REMEDIATION_FAILED' | 'SECURITY_CHANGE' | string;
  related_id?: string | null;
  message: string;
  acknowledged: boolean;
  created_at: string;
}

export const Alerts: React.FC = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const isNetEng = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [ackFilter, setAckFilter] = useState<string>('ALL');
  const [ackSuccessId, setAckSuccessId] = useState<string | null>(null);

  // Query alerts
  const {
    data: alerts = [],
    isLoading,
    isError,
  } = useQuery<AlertItem[]>({
    queryKey: ['alerts', typeFilter, ackFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeFilter !== 'ALL') params.append('type', typeFilter);
      if (ackFilter === 'UNACKNOWLEDGED') params.append('acknowledged', 'false');
      if (ackFilter === 'ACKNOWLEDGED') params.append('acknowledged', 'true');
      params.append('limit', '100');

      const res = await apiClient.get(`/api/alerts?${params.toString()}`);
      return res.data;
    },
  });

  // Acknowledge alert mutation
  const ackMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const res = await apiClient.post(`/api/alerts/${alertId}/ack`);
      return res.data;
    },
    onSuccess: (_, alertId) => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
      setAckSuccessId(alertId);
      setTimeout(() => setAckSuccessId(null), 3000);
    },
  });

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'CRITICAL_DRIFT':
        return <Flame className="h-5 w-5 text-rose-600" />;
      case 'DEVICE_DOWN':
        return <ServerCrash className="h-5 w-5 text-amber-600" />;
      case 'REMEDIATION_FAILED':
        return <AlertTriangle className="h-5 w-5 text-rose-600" />;
      case 'SECURITY_CHANGE':
      default:
        return <ShieldAlert className="h-5 w-5 text-sky-600" />;
    }
  };

  const getAlertBadge = (type: string) => {
    switch (type) {
      case 'CRITICAL_DRIFT':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200 uppercase tracking-wide">
            Critical Drift
          </span>
        );
      case 'DEVICE_DOWN':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200 uppercase tracking-wide">
            Device Down
          </span>
        );
      case 'REMEDIATION_FAILED':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-800 border border-red-200 uppercase tracking-wide">
            Remediation Failed
          </span>
        );
      case 'SECURITY_CHANGE':
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 uppercase tracking-wide">
            Security Change
          </span>
        );
    }
  };

  const unacknowledgedCount = alerts.filter((a) => !a.acknowledged).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-rose-100 text-rose-700 rounded-lg">
              <Bell className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-800">System Alerts</h2>
              <p className="text-sm text-slate-500">
                Automated incident alerts generated for high-risk drift events, reachability failures, and rollback events.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-xs font-semibold text-rose-800">
            <span className="h-2 w-2 rounded-full bg-rose-600 animate-pulse"></span>
            <span>{unacknowledgedCount} Unacknowledged</span>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Type filter */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1 shrink-0">
            <Filter className="h-3.5 w-3.5" />
            Type:
          </span>
          {['ALL', 'CRITICAL_DRIFT', 'DEVICE_DOWN', 'REMEDIATION_FAILED', 'SECURITY_CHANGE'].map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors ${
                typeFilter === t
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {t.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Ack filter */}
        <div className="flex items-center gap-2 shrink-0 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status:</span>
          {[
            { id: 'ALL', label: 'All' },
            { id: 'UNACKNOWLEDGED', label: 'Active (Unack)' },
            { id: 'ACKNOWLEDGED', label: 'Acknowledged' },
          ].map((st) => (
            <button
              key={st.id}
              onClick={() => setAckFilter(st.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                ackFilter === st.id
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Alerts List */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
          Loading alerts...
        </div>
      ) : isError ? (
        <div className="bg-white rounded-xl border border-rose-200 p-12 text-center text-rose-600 text-sm">
          Failed to load system alerts.
        </div>
      ) : alerts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-2 shadow-sm">
          <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
          <h3 className="text-base font-bold text-slate-800">No Alerts Found</h3>
          <p className="text-xs text-slate-500">
            No alerts match your current filter criteria. Campus network telemetry is nominal.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const isJustAcked = ackSuccessId === alert.id;
            return (
              <div
                key={alert.id}
                className={`bg-white rounded-xl border p-4 shadow-xs transition-all flex flex-col sm:flex-row sm:items-start justify-between gap-4 ${
                  alert.acknowledged
                    ? 'border-slate-200 opacity-75'
                    : alert.type === 'CRITICAL_DRIFT'
                    ? 'border-rose-200 bg-rose-50/20'
                    : 'border-slate-300'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`p-2.5 rounded-lg shrink-0 mt-0.5 ${
                      alert.type === 'CRITICAL_DRIFT'
                        ? 'bg-rose-100'
                        : alert.type === 'DEVICE_DOWN'
                        ? 'bg-amber-100'
                        : 'bg-sky-100'
                    }`}
                  >
                    {getAlertIcon(alert.type)}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getAlertBadge(alert.type)}
                      <span className="font-mono text-[11px] text-slate-400">ID: {alert.id.slice(0, 8)}</span>
                      <span className="text-xs text-slate-300">•</span>
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Clock className="h-3 w-3 text-slate-400" />
                        <span>{new Date(alert.created_at).toLocaleString()}</span>
                      </span>
                    </div>

                    <h4 className="text-sm font-semibold text-slate-800 pt-0.5">{alert.message}</h4>

                    {alert.related_id && (
                      <div className="pt-1 flex items-center gap-2 text-xs">
                        {alert.type === 'CRITICAL_DRIFT' ? (
                          <Link
                            to={`/drift/${alert.related_id}`}
                            className="text-sky-600 hover:underline inline-flex items-center gap-1 font-medium"
                          >
                            <span>Inspect Drift Event</span>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : alert.type === 'DEVICE_DOWN' ? (
                          <Link
                            to={`/devices/${alert.related_id}`}
                            className="text-sky-600 hover:underline inline-flex items-center gap-1 font-medium"
                          >
                            <span>Inspect Device</span>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right action: Ack status & button */}
                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                  {alert.acknowledged ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                      <Check className="h-3.5 w-3.5" />
                      Acknowledged
                    </span>
                  ) : isNetEng ? (
                    <button
                      type="button"
                      disabled={ackMutation.isPending}
                      onClick={() => ackMutation.mutate(alert.id)}
                      className="inline-flex items-center gap-1 px-3.5 py-1.5 border border-slate-300 hover:border-slate-400 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs transition-colors"
                    >
                      {ackMutation.isPending && ackMutation.variables === alert.id ? (
                        <span className="h-3.5 w-3.5 border-2 border-slate-600 border-t-transparent rounded-full animate-spin"></span>
                      ) : (
                        <Check className="h-3.5 w-3.5 text-slate-500" />
                      )}
                      <span>Acknowledge</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-400 flex items-center gap-1 italic">
                      <Lock className="h-3 w-3" />
                      Viewer (Read-only)
                    </span>
                  )}

                  {isJustAcked && (
                    <span className="text-[11px] text-emerald-600 font-medium animate-fadeIn">
                      Saved to audit trail!
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
