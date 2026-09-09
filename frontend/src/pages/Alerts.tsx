import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
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
  RefreshCw,
  Search,
  GitCompare,
  Clock,
  CheckCheck,
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
  const isNetEngPlus = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [ackFilter, setAckFilter] = useState<'ALL' | 'UNACK' | 'ACK'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch Alerts with backend params
  const {
    data: alerts = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery<AlertItem[]>({
    queryKey: ['alerts', typeFilter, ackFilter],
    queryFn: async () => {
      const params: Record<string, any> = { limit: 100 };
      if (typeFilter !== 'ALL') {
        params.type = typeFilter;
      }
      if (ackFilter === 'UNACK') {
        params.acknowledged = false;
      } else if (ackFilter === 'ACK') {
        params.acknowledged = true;
      }
      const res = await apiClient.get('/api/alerts', { params });
      return res.data;
    },
  });

  // Optimistic Acknowledge Mutation
  const ackMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const res = await apiClient.post(`/api/alerts/${alertId}/ack`);
      return res.data;
    },
    onMutate: async (alertId: string) => {
      // Cancel outgoing refetches so they don't overwrite optimistic update
      await queryClient.cancelQueries({ queryKey: ['alerts'] });

      // Snapshot current cache across all alert queries
      const previousData = queryClient.getQueryData<AlertItem[]>(['alerts', typeFilter, ackFilter]);

      // Optimistically update cache
      if (previousData) {
        queryClient.setQueryData<AlertItem[]>(
          ['alerts', typeFilter, ackFilter],
          previousData.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a))
        );
      }

      return { previousData };
    },
    onError: (_err, _alertId, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(['alerts', typeFilter, ackFilter], context.previousData);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
    },
  });

  const filteredAlerts = alerts.filter((alert) => {
    return (
      alert.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      alert.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (alert.related_id && alert.related_id.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  });

  const unacknowledgedCount = alerts.filter((a) => !a.acknowledged).length;

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'CRITICAL_DRIFT':
        return <Flame className="h-5 w-5 text-rose-500" />;
      case 'DEVICE_DOWN':
        return <ServerCrash className="h-5 w-5 text-amber-500" />;
      case 'REMEDIATION_FAILED':
        return <AlertTriangle className="h-5 w-5 text-rose-600" />;
      case 'SECURITY_CHANGE':
        return <ShieldAlert className="h-5 w-5 text-indigo-500" />;
      default:
        return <Bell className="h-5 w-5 text-slate-500" />;
    }
  };

  const getAlertBadge = (type: string) => {
    switch (type) {
      case 'CRITICAL_DRIFT':
        return (
          <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200 uppercase tracking-wide">
            Critical Drift
          </span>
        );
      case 'DEVICE_DOWN':
        return (
          <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200 uppercase tracking-wide">
            Device Down
          </span>
        );
      case 'REMEDIATION_FAILED':
        return (
          <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-800 border border-red-200 uppercase tracking-wide">
            Remediation Failed
          </span>
        );
      case 'SECURITY_CHANGE':
        return (
          <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 uppercase tracking-wide">
            Security Change
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 uppercase">
            {type}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rose-50 rounded-lg text-rose-600">
              <Bell className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold text-slate-800">System Alerts</h2>
                {unacknowledgedCount > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-600 text-white">
                    {unacknowledgedCount} Unacked
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500">
                Critical notifications on configuration drift, device unreachable events, and automated rollbacks.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => refetch()}
            disabled={isLoading || isRefetching}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative flex-1 w-full">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search alerts by message text or resource ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        {/* Filter Buttons */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Acknowledged Filter */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setAckFilter('ALL')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                ackFilter === 'ALL' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setAckFilter('UNACK')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                ackFilter === 'UNACK' ? 'bg-white text-rose-700 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Unacknowledged
            </button>
            <button
              onClick={() => setAckFilter('ACK')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                ackFilter === 'ACK' ? 'bg-white text-emerald-700 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Acknowledged
            </button>
          </div>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="ALL">All Alert Types</option>
            <option value="CRITICAL_DRIFT">Critical Drift</option>
            <option value="DEVICE_DOWN">Device Down</option>
            <option value="REMEDIATION_FAILED">Remediation Failed</option>
            <option value="SECURITY_CHANGE">Security Change</option>
          </select>
        </div>
      </div>

      {/* Alerts List */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3">
          <RefreshCw className="h-8 w-8 text-sky-500 animate-spin mx-auto" />
          <p className="text-sm text-slate-500 font-medium">Loading alerts stream...</p>
        </div>
      ) : filteredAlerts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3">
          <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
          <h3 className="text-base font-semibold text-slate-800">No Alerts Found</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            {searchTerm || typeFilter !== 'ALL' || ackFilter !== 'ALL'
              ? 'No alerts match your search filters.'
              : 'All systems are functioning within normal operational parameters. No active alerts recorded.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAlerts.map((alert) => {
            const isAckingThis = ackMutation.isPending && ackMutation.variables === alert.id;

            return (
              <div
                key={alert.id}
                className={`p-5 rounded-xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  alert.acknowledged
                    ? 'bg-slate-50/70 border-slate-200 opacity-80'
                    : 'bg-white border-rose-200/80 shadow-xs ring-1 ring-rose-500/10'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                      alert.acknowledged ? 'bg-slate-100' : 'bg-rose-50'
                    }`}
                  >
                    {getAlertIcon(alert.type)}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {getAlertBadge(alert.type)}

                      {alert.acknowledged ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          <CheckCheck className="h-3 w-3" />
                          Acknowledged
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                          <Clock className="h-3 w-3" />
                          Unacknowledged
                        </span>
                      )}

                      <span className="text-xs text-slate-400">•</span>
                      <span className="text-xs text-slate-500 font-mono">
                        {new Date(alert.created_at).toLocaleString()}
                      </span>
                    </div>

                    <h4 className="font-semibold text-sm text-slate-900 leading-snug">
                      {alert.message}
                    </h4>

                    {alert.related_id && (
                      <div className="flex items-center gap-2 pt-0.5">
                        <span className="text-[11px] text-slate-500">Related Resource:</span>
                        {alert.type === 'CRITICAL_DRIFT' ? (
                          <Link
                            to={`/drift/${alert.related_id}`}
                            className="text-xs font-mono text-sky-600 hover:text-sky-800 hover:underline flex items-center gap-1"
                          >
                            <GitCompare className="h-3 w-3" />
                            <span>Drift Event #{alert.related_id.slice(0, 8)}...</span>
                          </Link>
                        ) : (
                          <span className="text-xs font-mono text-slate-600">
                            {alert.related_id}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Ack Action */}
                <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                  {!alert.acknowledged ? (
                    isNetEngPlus ? (
                      <button
                        type="button"
                        onClick={() => ackMutation.mutate(alert.id)}
                        disabled={isAckingThis}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold transition-colors shadow-2xs"
                      >
                        <Check className={`h-3.5 w-3.5 text-emerald-600 ${isAckingThis ? 'animate-spin' : ''}`} />
                        <span>{isAckingThis ? 'Acknowledging...' : 'Acknowledge'}</span>
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Viewer (read-only)</span>
                    )
                  ) : (
                    <span className="text-xs text-slate-400 flex items-center gap-1 font-medium">
                      <CheckCheck className="h-4 w-4 text-emerald-600" />
                      Resolved
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
