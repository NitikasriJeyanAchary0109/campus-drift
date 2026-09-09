import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  ScrollText,
  Shield,
  ShieldAlert,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  User,
  Database,
  ArrowLeft,
  FileCode,
  Copy,
  Check,
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

  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [targetTypeFilter, setTargetTypeFilter] = useState('ALL');
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Fetch Audit Logs (Admin only)
  const {
    data: logs = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery<AuditLogItem[]>({
    queryKey: ['audit-logs', actionFilter, targetTypeFilter],
    queryFn: async () => {
      const params: Record<string, any> = { limit: 100 };
      if (actionFilter !== 'ALL') params.action = actionFilter;
      if (targetTypeFilter !== 'ALL') params.target_type = targetTypeFilter;
      const res = await apiClient.get('/api/audit', { params });
      return res.data;
    },
    enabled: isAdmin,
  });

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Route Guard: Admin-Only
  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto my-12 bg-white rounded-2xl border border-rose-200 p-8 text-center shadow-lg space-y-4">
        <div className="p-3 bg-rose-100 rounded-full w-14 h-14 flex items-center justify-center mx-auto text-rose-600">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Admin Access Required</h2>
        <p className="text-sm text-slate-600 leading-relaxed max-w-lg mx-auto">
          The Immutable Audit Trail contains security-sensitive configuration state captures and system-wide
          credential telemetry. Per Section 9 of the system specification, access is strictly restricted to
          the <span className="font-bold text-slate-800">Administrator</span> role.
        </p>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-500 max-w-md mx-auto">
          Current Role: <span className="font-bold text-slate-700">{user?.role || 'Unauthenticated'}</span>
        </div>
        <div className="pt-2">
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Return to Dashboard</span>
          </Link>
        </div>
      </div>
    );
  }

  const filteredLogs = logs.filter((log) => {
    const term = searchTerm.toLowerCase();
    const matchesUser = (log.username || 'system').toLowerCase().includes(term);
    const matchesAction = log.action.toLowerCase().includes(term);
    const matchesTarget = log.target_type.toLowerCase().includes(term);
    const matchesId = log.id.toLowerCase().includes(term) || (log.target_id || '').toLowerCase().includes(term);
    const matchesJson =
      JSON.stringify(log.before_state || {}).toLowerCase().includes(term) ||
      JSON.stringify(log.after_state || {}).toLowerCase().includes(term);

    return matchesUser || matchesAction || matchesTarget || matchesId || matchesJson;
  });

  const getActionBadge = (action: string) => {
    if (action.includes('REJECT') || action.includes('FAILED')) {
      return (
        <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
          {action}
        </span>
      );
    }
    if (action.includes('ROLLBACK')) {
      return (
        <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
          {action}
        </span>
      );
    }
    if (action.includes('APPROV') || action.includes('ACTIVAT') || action.includes('SUCCESS')) {
      return (
        <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
          {action}
        </span>
      );
    }
    if (action.includes('POLL') || action.includes('DISCOVER')) {
      return (
        <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-sky-100 text-sky-800 border border-sky-200">
          {action}
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-800 border border-slate-200">
        {action}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-100 rounded-lg text-slate-800">
            <ScrollText className="h-6 w-6 text-indigo-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-slate-800">Immutable Audit Trail</h2>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                <Shield className="h-3 w-3" />
                Append-Only
              </span>
            </div>
            <p className="text-sm text-slate-500">
              Cryptographically timestamped log of configuration mutations, approvals, and remediation actions.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => refetch()}
            disabled={isLoading || isRefetching}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
            <span>Refresh Trail</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative flex-1 w-full">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search audit trail by user, action, target, UUID, or state diff content..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Action Filter */}
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="ALL">All Actions</option>
            <option value="DEVICE_CREATED">DEVICE_CREATED</option>
            <option value="POLL_COMPLETED">POLL_COMPLETED</option>
            <option value="BASELINE_CREATED">BASELINE_CREATED</option>
            <option value="BASELINE_ACTIVATED">BASELINE_ACTIVATED</option>
            <option value="PLAN_GENERATED">PLAN_GENERATED</option>
            <option value="PLAN_APPROVED">PLAN_APPROVED</option>
            <option value="PLAN_REJECTED">PLAN_REJECTED</option>
            <option value="REMEDIATION_APPLIED">REMEDIATION_APPLIED</option>
            <option value="ROLLBACK_EXECUTED">ROLLBACK_EXECUTED</option>
            <option value="ALERT_ACKNOWLEDGED">ALERT_ACKNOWLEDGED</option>
            <option value="FALSE_POSITIVE_FLAGGED">FALSE_POSITIVE_FLAGGED</option>
          </select>

          {/* Target Type Filter */}
          <select
            value={targetTypeFilter}
            onChange={(e) => setTargetTypeFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="ALL">All Target Types</option>
            <option value="device">device</option>
            <option value="baseline">baseline</option>
            <option value="remediation">remediation</option>
            <option value="approval">approval</option>
            <option value="alert">alert</option>
            <option value="drift_event">drift_event</option>
          </select>
        </div>
      </div>

      {/* Logs Table */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3">
          <RefreshCw className="h-8 w-8 text-sky-500 animate-spin mx-auto" />
          <p className="text-sm text-slate-500 font-medium">Verifying and streaming audit log records...</p>
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3">
          <Database className="h-10 w-10 text-slate-300 mx-auto" />
          <h3 className="text-base font-semibold text-slate-800">No Audit Records Found</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            {searchTerm || actionFilter !== 'ALL' || targetTypeFilter !== 'ALL'
              ? 'No audit log entries match the specified filters.'
              : 'Audit trail is active and ready. System actions will appear here automatically.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 w-8"></th>
                  <th className="py-3 px-4 font-semibold">Timestamp (UTC)</th>
                  <th className="py-3 px-4 font-semibold">Operator</th>
                  <th className="py-3 px-4 font-semibold">Action</th>
                  <th className="py-3 px-4 font-semibold">Target Type</th>
                  <th className="py-3 px-4 font-semibold">Target ID</th>
                  <th className="py-3 px-4 font-semibold">State Captured</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredLogs.map((log) => {
                  const isExpanded = !!expandedRows[log.id];
                  const hasBefore = !!log.before_state && Object.keys(log.before_state).length > 0;
                  const hasAfter = !!log.after_state && Object.keys(log.after_state).length > 0;
                  const hasState = hasBefore || hasAfter;

                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        onClick={() => hasState && toggleRow(log.id)}
                        className={`transition-colors ${
                          hasState ? 'cursor-pointer hover:bg-slate-50/80' : ''
                        } ${isExpanded ? 'bg-slate-50/90' : ''}`}
                      >
                        <td className="py-3 px-4 text-slate-400 text-center">
                          {hasState ? (
                            isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-slate-600" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-slate-400" />
                            )
                          ) : (
                            <span className="text-slate-300">•</span>
                          )}
                        </td>

                        <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                          {new Date(log.timestamp).toISOString()}
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 font-medium text-slate-900">
                            <User className="h-3.5 w-3.5 text-slate-400" />
                            <span>{log.username ? `@${log.username}` : 'system_scheduler'}</span>
                          </div>
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          {getActionBadge(log.action)}
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                            {log.target_type}
                          </span>
                        </td>

                        <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                          {log.target_id ? (
                            <div className="flex items-center gap-1">
                              <span>{log.target_id.slice(0, 8)}...</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(log.target_id!, log.id);
                                }}
                                className="text-slate-400 hover:text-slate-600 p-0.5"
                                title="Copy full target UUID"
                              >
                                {copiedId === log.id ? (
                                  <Check className="h-3 w-3 text-emerald-600" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">(none)</span>
                          )}
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          {hasBefore && hasAfter ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              Before & After
                            </span>
                          ) : hasAfter ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              After State
                            </span>
                          ) : hasBefore ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              Before State
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px]">No state payload</span>
                          )}
                        </td>
                      </tr>

                      {/* Expandable JSON State Diff Row */}
                      {isExpanded && (
                        <tr className="bg-slate-900 text-slate-100">
                          <td colSpan={7} className="p-6">
                            <div className="space-y-4">
                              <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-2">
                                <div className="flex items-center gap-2 font-mono">
                                  <FileCode className="h-4 w-4 text-sky-400" />
                                  <span>AUDIT ID: {log.id}</span>
                                  {log.target_id && (
                                    <>
                                      <span>•</span>
                                      <span>TARGET UUID: {log.target_id}</span>
                                    </>
                                  )}
                                </div>
                                <span>Click row to collapse</span>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Before State */}
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between text-[11px] font-semibold text-amber-400 uppercase tracking-wider">
                                    <span>Before State</span>
                                    <span className="text-slate-500 font-mono text-[10px]">PRE-CHANGE</span>
                                  </div>
                                  <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-amber-300 font-mono text-xs overflow-x-auto max-h-72 leading-relaxed">
                                    {log.before_state
                                      ? JSON.stringify(log.before_state, null, 2)
                                      : '// No prior state recorded'}
                                  </pre>
                                </div>

                                {/* After State */}
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
                                    <span>After State</span>
                                    <span className="text-slate-500 font-mono text-[10px]">POST-CHANGE</span>
                                  </div>
                                  <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-emerald-300 font-mono text-xs overflow-x-auto max-h-72 leading-relaxed">
                                    {log.after_state
                                      ? JSON.stringify(log.after_state, null, 2)
                                      : '// No post state recorded'}
                                  </pre>
                                </div>
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
        </div>
      )}
    </div>
  );
};
