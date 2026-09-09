import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  ScrollText,
  Shield,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  User,
  Clock,
  Filter,
  Search,
  Code2,
  RefreshCw,
} from 'lucide-react';

interface AuditLogItem {
  id: string;
  user_id?: string | null;
  username?: string | null;
  action: string;
  target_type: string;
  target_id?: string | null;
  before_state?: Record<string, any> | null;
  after_state?: Record<string, any> | null;
  timestamp: string;
}

export const AuditLogs: React.FC = () => {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'Admin';

  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [targetTypeFilter, setTargetTypeFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Fetch audit logs
  const {
    data: logs = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<AuditLogItem[]>({
    queryKey: ['auditLogs', actionFilter, targetTypeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (actionFilter !== 'ALL') params.append('action', actionFilter);
      if (targetTypeFilter !== 'ALL') params.append('target_type', targetTypeFilter);
      params.append('limit', '100');

      const res = await apiClient.get(`/api/audit?${params.toString()}`);
      return res.data;
    },
    enabled: isAdmin,
  });

  const getActionBadgeColor = (action: string) => {
    if (action.includes('REMEDIATION_APPROVED') || action.includes('SUCCESS')) {
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    }
    if (action.includes('REJECTED') || action.includes('ROLLBACK') || action.includes('FAIL')) {
      return 'bg-rose-100 text-rose-800 border-rose-200';
    }
    if (action.includes('DRIFT')) {
      return 'bg-amber-100 text-amber-800 border-amber-200';
    }
    if (action.includes('BASELINE')) {
      return 'bg-purple-100 text-purple-800 border-purple-200';
    }
    return 'bg-sky-100 text-sky-800 border-sky-200';
  };

  const filteredLogs = logs.filter((log) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      (log.username && log.username.toLowerCase().includes(query)) ||
      log.action.toLowerCase().includes(query) ||
      log.target_type.toLowerCase().includes(query) ||
      (log.target_id && log.target_id.toLowerCase().includes(query))
    );
  });

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-white rounded-xl border border-slate-200 shadow-sm text-center">
        <ShieldAlert className="h-12 w-12 text-rose-600 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-800 mb-2">403 Access Denied</h2>
        <p className="text-sm text-slate-600 mb-6">
          The Immutable Audit Trail is strictly restricted to Administrator accounts per §9 and §13 of the security architecture.
          Your current role is <strong>{user?.role || 'Viewer'}</strong>.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Return to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-lg">
            <ScrollText className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Immutable Audit Trail</h2>
            <p className="text-sm text-slate-500">
              Cryptographically timestamped, append-only ledger of all configuration changes, baseline activations, and approvals.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold">
            <Shield className="h-4 w-4" />
            <span>Tamper-Evident Append-Only</span>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
            title="Refresh Audit Trail"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by username, action, or target ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-slate-200 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 outline-none"
          />
        </div>

        {/* Dropdowns */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Action Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:ring-2 focus:ring-sky-500/20 outline-none"
            >
              <option value="ALL">All Actions</option>
              <option value="USER_LOGIN">USER_LOGIN</option>
              <option value="POLL_COMPLETED">POLL_COMPLETED</option>
              <option value="DRIFT_DETECTED">DRIFT_DETECTED</option>
              <option value="BASELINE_CREATED">BASELINE_CREATED</option>
              <option value="BASELINE_ACTIVATED">BASELINE_ACTIVATED</option>
              <option value="REMEDIATION_PLAN_GENERATED">REMEDIATION_PLAN_GENERATED</option>
              <option value="REMEDIATION_APPROVED">REMEDIATION_APPROVED</option>
              <option value="REMEDIATION_REJECTED">REMEDIATION_REJECTED</option>
              <option value="REMEDIATION_APPLIED">REMEDIATION_APPLIED</option>
              <option value="ROLLBACK_EXECUTED">ROLLBACK_EXECUTED</option>
              <option value="ALERT_ACKNOWLEDGED">ALERT_ACKNOWLEDGED</option>
              <option value="FALSE_POSITIVE_FLAGGED">FALSE_POSITIVE_FLAGGED</option>
            </select>
          </div>

          {/* Target Type Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <select
              value={targetTypeFilter}
              onChange={(e) => setTargetTypeFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:ring-2 focus:ring-sky-500/20 outline-none"
            >
              <option value="ALL">All Targets</option>
              <option value="device">Device</option>
              <option value="baseline">Baseline</option>
              <option value="drift_event">Drift Event</option>
              <option value="remediation_plan">Remediation Plan</option>
              <option value="alert">Alert</option>
            </select>
          </div>
        </div>
      </div>

      {/* Audit Trail Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400 text-sm">Loading audit logs...</div>
        ) : isError ? (
          <div className="p-12 text-center text-rose-600 text-sm">Failed to load audit trail.</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">No audit records match your filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 w-8"></th>
                  <th className="py-3 px-4 font-semibold">Timestamp (UTC)</th>
                  <th className="py-3 px-4 font-semibold">Actor / User</th>
                  <th className="py-3 px-4 font-semibold">Action</th>
                  <th className="py-3 px-4 font-semibold">Target Type</th>
                  <th className="py-3 px-4 font-semibold">Target ID</th>
                  <th className="py-3 px-4 font-semibold text-right">State Diff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans">
                {filteredLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const hasState = !!(log.before_state || log.after_state);

                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        onClick={() => hasState && setExpandedLogId(isExpanded ? null : log.id)}
                        className={`transition-colors ${
                          hasState ? 'cursor-pointer hover:bg-slate-50/80' : ''
                        } ${isExpanded ? 'bg-indigo-50/30' : ''}`}
                      >
                        <td className="py-3 px-3 text-slate-400">
                          {hasState ? (
                            isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )
                          ) : null}
                        </td>
                        <td className="py-3 px-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-slate-400" />
                            <span>{new Date(log.timestamp).toISOString().replace('T', ' ').slice(0, 19)}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5 font-medium text-slate-800">
                            <User className="h-3.5 w-3.5 text-slate-400" />
                            <span>{log.username ? `@${log.username}` : 'system_scheduler'}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getActionBadgeColor(
                              log.action
                            )}`}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-600 uppercase text-[10px] font-semibold tracking-wide">
                          {log.target_type}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                          {log.target_id ? log.target_id.slice(0, 8) : '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {hasState ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-indigo-600 font-medium">
                              <Code2 className="h-3 w-3" />
                              <span>{isExpanded ? 'Hide Payload' : 'View Payload'}</span>
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-300">—</span>
                          )}
                        </td>
                      </tr>

                      {/* Expandable State Payload Details */}
                      {isExpanded && hasState && (
                        <tr>
                          <td colSpan={7} className="p-4 bg-slate-50/70 border-b border-slate-200">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Before State */}
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                                  <span>Before State</span>
                                  {!log.before_state && (
                                    <span className="text-slate-400 italic font-normal">(None / Initial)</span>
                                  )}
                                </div>
                                <pre className="p-3 bg-slate-900 text-slate-200 font-mono text-xs rounded-lg overflow-x-auto max-h-56">
                                  {log.before_state
                                    ? JSON.stringify(log.before_state, null, 2)
                                    : '// No previous state recorded'}
                                </pre>
                              </div>

                              {/* After State */}
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                                  <span>After State</span>
                                  {!log.after_state && (
                                    <span className="text-slate-400 italic font-normal">(None)</span>
                                  )}
                                </div>
                                <pre className="p-3 bg-slate-900 text-emerald-400 font-mono text-xs rounded-lg overflow-x-auto max-h-56">
                                  {log.after_state
                                    ? JSON.stringify(log.after_state, null, 2)
                                    : '// No post-state recorded'}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
