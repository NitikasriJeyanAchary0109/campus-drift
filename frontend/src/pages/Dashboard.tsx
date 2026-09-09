import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import {
  Server,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  HelpCircle,
  Bell,
  Wrench,
  AlertOctagon,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface AlertItem {
  id: string;
  type: string;
  related_id?: string;
  message: string;
  acknowledged: boolean;
  created_at: string;
}

interface RemediationItem {
  id: string;
  remediation_plan_id: string;
  device_hostname?: string;
  result: string;
  executed_commands_count: number;
  executed_at: string;
}

interface TrendPoint {
  date: string;
  average_score: number;
  event_count: number;
}

interface DashboardSummary {
  total_devices: number;
  devices_by_status: Record<string, number>;
  compliance_percentage: number;
  no_baseline_gap_count: number;
  drift_by_label: Record<string, number>;
  recent_alerts: AlertItem[];
  recent_remediations: RemediationItem[];
  drift_trend: TrendPoint[];
}

export const Dashboard: React.FC = () => {
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<DashboardSummary>({
    queryKey: ['dashboardSummary'],
    queryFn: async () => {
      const res = await apiClient.get('/api/dashboard/summary');
      return res.data;
    },
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <RefreshCw className="h-8 w-8 text-sky-500 animate-spin" />
        <p className="text-sm text-slate-500 font-medium">Aggregating campus network metrics...</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-8 bg-rose-50 border border-rose-200 rounded-xl text-center space-y-3">
        <AlertOctagon className="h-10 w-10 text-rose-500 mx-auto" />
        <h3 className="text-lg font-semibold text-rose-900">Failed to load dashboard metrics</h3>
        <p className="text-sm text-rose-600 max-w-md mx-auto">
          {(error as any)?.response?.data?.detail || 'Unable to connect to the backend monitoring service.'}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-medium hover:bg-rose-700 transition-colors"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const onlineDevices = data.devices_by_status?.ONLINE || 0;
  const unreachableDevices = data.devices_by_status?.UNREACHABLE || 0;
  const decommissionedDevices = data.devices_by_status?.DECOMMISSIONED || 0;

  const totalDrifts = Object.values(data.drift_by_label || {}).reduce((acc, count) => acc + count, 0);
  const criticalDrifts =
    (data.drift_by_label?.['Non-Compliant'] || 0) +
    (data.drift_by_label?.['Drift-Unauthorized-High'] || 0);

  const getComplianceColor = (rate: number) => {
    if (rate >= 90) return 'text-emerald-600';
    if (rate >= 75) return 'text-amber-600';
    return 'text-rose-600';
  };

  const getComplianceBg = (rate: number) => {
    if (rate >= 90) return 'bg-emerald-50 border-emerald-200';
    if (rate >= 75) return 'bg-amber-50 border-amber-200';
    return 'bg-rose-50 border-rose-200';
  };

  const labelConfig: Record<string, { bg: string; text: string; border: string }> = {
    'Non-Compliant': { bg: 'bg-rose-100', text: 'text-rose-800', border: 'border-rose-300' },
    'Drift-Unauthorized-High': { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300' },
    'Drift-Unauthorized-Medium': { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
    'Drift-Authorized': { bg: 'bg-sky-100', text: 'text-sky-800', border: 'border-sky-300' },
    'Drift-Low': { bg: 'bg-slate-100', text: 'text-slate-800', border: 'border-slate-300' },
    'NO_BASELINE': { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-300' },
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Campus Network Overview</h2>
          <p className="text-sm text-slate-500">
            Real-time configuration drift, golden baseline compliance, and automated remediation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors bg-white shadow-sm"
            title="Refresh metrics"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin text-sky-600' : ''}`} />
            <span>{isFetching ? 'Syncing...' : 'Sync Now'}</span>
          </button>

          <Link
            to="/drift"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <span>Investigate Drifts</span>
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Total Devices */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Inventory</span>
              <div className="p-2 rounded-lg bg-sky-50 text-sky-600">
                <Server className="h-5 w-5" />
              </div>
            </div>
            <div className="text-3xl font-bold text-slate-900">{data.total_devices}</div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
              {onlineDevices} Online
            </span>
            <span className="text-slate-300">•</span>
            <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
              <span className="h-2 w-2 rounded-full bg-rose-500"></span>
              {unreachableDevices} Unreachable
            </span>
            {decommissionedDevices > 0 && (
              <>
                <span className="text-slate-300">•</span>
                <span className="text-slate-500 font-medium">{decommissionedDevices} Decom</span>
              </>
            )}
          </div>
        </div>

        {/* Network Compliance */}
        <div className={`p-5 rounded-xl border shadow-sm flex flex-col justify-between ${getComplianceBg(data.compliance_percentage)}`}>
          <div>
            <div className="flex items-center justify-between text-slate-600 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Baseline Compliance</span>
              <div className="p-2 rounded-lg bg-white/80 shadow-xs">
                <ShieldCheck className={`h-5 w-5 ${getComplianceColor(data.compliance_percentage)}`} />
              </div>
            </div>
            <div className={`text-3xl font-bold ${getComplianceColor(data.compliance_percentage)}`}>
              {data.compliance_percentage.toFixed(1)}%
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-200/60 text-xs text-slate-600 flex items-center justify-between">
            <span>Evaluated vs Golden Baselines</span>
            <span className="font-semibold text-slate-700">Target: ≥95%</span>
          </div>
        </div>

        {/* Coverage Gap Metric (§14 NO_BASELINE) */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Coverage Gaps</span>
              <div className="p-2 rounded-lg bg-purple-50 text-purple-600">
                <HelpCircle className="h-5 w-5" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-bold text-slate-900">{data.no_baseline_gap_count}</div>
              <span className="text-xs text-purple-700 font-medium">Devices with NO_BASELINE</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
            Excluded from compliance denominator per §14
          </div>
        </div>

        {/* Active Drift Events */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Active Drifts</span>
              <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-bold text-slate-900">{totalDrifts}</div>
              {criticalDrifts > 0 && (
                <span className="text-xs font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                  {criticalDrifts} High Priority
                </span>
              )}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Pending remediation review</span>
            <Link to="/drift" className="text-sky-600 hover:text-sky-700 font-medium">
              View all →
            </Link>
          </div>
        </div>
      </div>

      {/* §12 Taxonomy Breakdown Banner */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-800">
            Current Drift Classification Breakdown (§12 Taxonomy)
          </h3>
          <span className="text-xs text-slate-400">Open Events by Risk Band</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Object.entries(labelConfig).map(([label, style]) => {
            const count = data.drift_by_label?.[label] || 0;
            return (
              <div
                key={label}
                className={`p-3 rounded-lg border ${style.border} ${style.bg} flex flex-col justify-between`}
              >
                <span className="text-[11px] font-medium text-slate-600 truncate" title={label}>
                  {label}
                </span>
                <span className={`text-xl font-bold ${style.text} mt-1`}>{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 14-Day Trend Chart */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
          <div>
            <h3 className="text-base font-semibold text-slate-800">14-Day Network Drift Risk Trend</h3>
            <p className="text-xs text-slate-500">
              Daily average risk score and drift occurrence count across campus devices.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-sky-500"></span>
              <span>Average Risk Score</span>
            </div>
          </div>
        </div>

        {data.drift_trend && data.drift_trend.length > 0 ? (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.drift_trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRisk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0284c7" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#0284c7" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickFormatter={(val) => val.slice(5)}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const item = payload[0].payload as TrendPoint;
                      return (
                        <div className="bg-slate-900 text-white p-3 rounded-lg shadow-xl text-xs space-y-1 border border-slate-700">
                          <p className="font-semibold text-slate-200">{label}</p>
                          <p className="text-sky-300">
                            Avg Risk Score: <span className="font-bold">{item.average_score.toFixed(1)}</span>
                          </p>
                          <p className="text-slate-400">
                            Drift Events: <span className="font-medium text-white">{item.event_count}</span>
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="average_score"
                  stroke="#0284c7"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorRisk)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-64 flex items-center justify-center border-2 border-dashed border-slate-200 rounded-lg text-slate-400 text-sm">
            No drift trend data available yet for the past 14 days.
          </div>
        )}
      </div>

      {/* Side-by-Side: Recent Alerts & Recent Remediations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Alerts */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-rose-500" />
                <h3 className="text-base font-semibold text-slate-800">Recent Security Alerts</h3>
              </div>
              <Link to="/alerts" className="text-xs font-medium text-sky-600 hover:text-sky-700">
                View Alerts →
              </Link>
            </div>

            {data.recent_alerts && data.recent_alerts.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {data.recent_alerts.slice(0, 5).map((alert) => (
                  <div key={alert.id} className="py-3 flex items-start gap-3 text-xs">
                    <div className="mt-0.5">
                      {alert.type === 'CRITICAL_DRIFT' || alert.type === 'SECURITY_CHANGE' ? (
                        <span className="h-2 w-2 rounded-full bg-rose-500 block"></span>
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-amber-500 block"></span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-800 font-mono text-[11px]">
                          {alert.type}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(alert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-slate-600 text-xs mt-0.5 truncate">{alert.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-slate-400 text-xs">
                <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                <p>No active alerts recorded.</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Remediations */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-sky-500" />
                <h3 className="text-base font-semibold text-slate-800">Recent Remediation Actions</h3>
              </div>
              <Link to="/remediation" className="text-xs font-medium text-sky-600 hover:text-sky-700">
                View Remediation →
              </Link>
            </div>

            {data.recent_remediations && data.recent_remediations.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {data.recent_remediations.slice(0, 5).map((rem) => (
                  <div key={rem.id} className="py-3 flex items-center justify-between text-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800">
                          {rem.device_hostname || 'Device'}
                        </span>
                        <span className="text-slate-400">•</span>
                        <span className="text-slate-500">{rem.executed_commands_count} cmds pushed</span>
                      </div>
                      <span className="text-[10px] text-slate-400">
                        {new Date(rem.executed_at).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                          rem.result === 'SUCCESS'
                            ? 'bg-emerald-100 text-emerald-800'
                            : rem.result === 'ROLLED_BACK'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {rem.result}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-slate-400 text-xs">
                <Clock className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p>No recent remediation actions executed.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

