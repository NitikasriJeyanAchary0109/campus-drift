import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  Wrench,
  ShieldCheck,
  CheckSquare,
  Terminal,
  Play,
  RotateCcw,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
  Filter,
  RefreshCw,
  Server,
  GitCompare,
  User,
  ExternalLink,
} from 'lucide-react';

interface ApprovalInfo {
  id: string;
  remediation_plan_id: string;
  approved_by: string;
  approver_username?: string | null;
  decision: 'APPROVED' | 'REJECTED';
  comment?: string | null;
  decided_at: string;
}

interface RemediationActionInfo {
  id: string;
  remediation_plan_id: string;
  executed_commands: string[];
  result: 'SUCCESS' | 'FAILED' | 'ROLLED_BACK' | string;
  verification_snapshot_id?: string | null;
  executed_at: string;
}

interface RemediationPlan {
  id: string;
  drift_event_id: string;
  device_id?: string | null;
  device_hostname?: string | null;
  proposed_commands: string[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED' | string;
  created_at: string;
  approval?: ApprovalInfo | null;
  actions?: RemediationActionInfo[] | null;
}

export const Remediation: React.FC = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'Admin';
  const isNetEngPlus = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [actionBanner, setActionBanner] = useState<{
    type: 'success' | 'error' | 'warning';
    message: string;
  } | null>(null);

  // Rollback confirmation modal state
  const [rollbackPlan, setRollbackPlan] = useState<RemediationPlan | null>(null);

  // Fetch remediation plans
  const {
    data: plans = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery<RemediationPlan[]>({
    queryKey: ['remediation-plans'],
    queryFn: async () => {
      const res = await apiClient.get('/api/remediation/plans');
      return res.data;
    },
  });

  // Apply Remediation Mutation
  const applyMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await apiClient.post(`/api/remediation/${planId}/apply`);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['remediation-plans'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
      queryClient.invalidateQueries({ queryKey: ['driftEvents'] });
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      if (data.verification_passed) {
        setActionBanner({
          type: 'success',
          message: data.message || 'Remediation applied and verified against baseline successfully!',
        });
      } else {
        setActionBanner({
          type: 'warning',
          message: data.message || 'Verification failed: automated rollback was executed to restore pre-change backup.',
        });
      }
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message || 'Failed to apply remediation plan.';
      setActionBanner({ type: 'error', message: msg });
    },
  });

  // Rollback Mutation (Admin only)
  const rollbackMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await apiClient.post(`/api/remediation/${planId}/rollback`);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['remediation-plans'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
      queryClient.invalidateQueries({ queryKey: ['driftEvents'] });
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      setRollbackPlan(null);
      setActionBanner({
        type: 'success',
        message: data.message || 'Device configuration successfully rolled back to pre-change backup.',
      });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message || 'Rollback failed.';
      setActionBanner({ type: 'error', message: msg });
    },
  });

  const filteredPlans = plans.filter((plan) => {
    const matchesSearch =
      (plan.device_hostname || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      plan.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || plan.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            <Clock className="h-3 w-3" />
            PENDING APPROVAL
          </span>
        );
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="h-3 w-3" />
            APPROVED
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200">
            <XCircle className="h-3 w-3" />
            REJECTED
          </span>
        );
      case 'APPLIED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-100 text-sky-800 border border-sky-200">
            <CheckSquare className="h-3 w-3" />
            APPLIED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
            {status}
          </span>
        );
    }
  };

  const getActionResultBadge = (result: string) => {
    switch (result) {
      case 'SUCCESS':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="h-3 w-3" />
            VERIFIED SUCCESS
          </span>
        );
      case 'ROLLED_BACK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
            <RotateCcw className="h-3 w-3" />
            ROLLED BACK
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
            <AlertTriangle className="h-3 w-3" />
            EXECUTION FAILED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-slate-800 text-slate-300">
            {result}
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
            <div className="p-2 bg-slate-100 rounded-lg text-slate-800">
              <Wrench className="h-6 w-6 text-sky-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-800">Remediation Engine</h2>
              <p className="text-sm text-slate-500">
                Jinja2 template-generated CLI commands gated behind strict approvals and automated rollback.
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
          <Link
            to="/approvals"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors shadow-xs"
          >
            <CheckSquare className="h-4 w-4" />
            <span>Go to Approval Queue</span>
          </Link>
        </div>
      </div>

      {/* Action Banner */}
      {actionBanner && (
        <div
          className={`p-4 rounded-xl border flex items-start justify-between gap-3 ${
            actionBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : actionBanner.type === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {actionBanner.type === 'success' && <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />}
            {actionBanner.type === 'warning' && <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />}
            {actionBanner.type === 'error' && <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />}
            <div className="text-sm font-medium">{actionBanner.message}</div>
          </div>
          <button
            onClick={() => setActionBanner(null)}
            className="text-slate-400 hover:text-slate-600 text-sm font-semibold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Security Guardrail Callout */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900 leading-relaxed">
          <span className="font-bold">Security Guardrail Active: </span>
          Free-text CLI execution is strictly prohibited. All proposed remediation commands are rendered exclusively
          from approved, whitelisted Jinja2 templates. Before any device modification, a full pre-change backup is
          automatically captured. If post-apply verification detects discrepancy, an automated rollback restores the backup immediately.
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative flex-1 w-full">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by device hostname or plan ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider shrink-0 flex items-center gap-1">
            <Filter className="h-3.5 w-3.5" /> Status:
          </span>
          {['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'APPLIED'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${
                statusFilter === st
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Plans List */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3">
          <RefreshCw className="h-8 w-8 text-sky-500 animate-spin mx-auto" />
          <p className="text-sm text-slate-500 font-medium">Loading remediation plans and approvals...</p>
        </div>
      ) : filteredPlans.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3">
          <CheckSquare className="h-10 w-10 text-slate-300 mx-auto" />
          <h3 className="text-base font-semibold text-slate-800">No Remediation Plans Found</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            {searchTerm || statusFilter !== 'ALL'
              ? 'No plans match the specified filters.'
              : 'No remediation plans have been generated yet. You can generate a plan directly from any active Drift Event.'}
          </p>
          <Link
            to="/drift"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            <GitCompare className="h-4 w-4" />
            <span>Browse Drift Events</span>
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredPlans.map((plan) => {
            const isApproved = plan.status === 'APPROVED' || plan.approval?.decision === 'APPROVED';
            const isPending = plan.status === 'PENDING';
            const isApplied = plan.status === 'APPLIED';
            const isApplyingThis = applyMutation.isPending && applyMutation.variables === plan.id;
            const isRollingBackThis = rollbackMutation.isPending && rollbackMutation.variables === plan.id;

            return (
              <div
                key={plan.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100"
              >
                {/* Plan Header */}
                <div className="p-5 bg-slate-50/70 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      {getStatusBadge(plan.status)}
                      <span className="text-xs font-mono text-slate-500">ID: {plan.id}</span>
                      <span className="text-xs text-slate-400">•</span>
                      <span className="text-xs text-slate-500">
                        Created {new Date(plan.created_at).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-sm pt-1">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                        <Server className="h-4 w-4 text-slate-500" />
                        <span>Target:</span>
                        {plan.device_id ? (
                          <Link
                            to={`/devices/${plan.device_id}`}
                            className="text-sky-600 hover:text-sky-800 hover:underline flex items-center gap-1"
                          >
                            {plan.device_hostname || 'Unknown Device'}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          <span className="font-mono text-slate-700">{plan.device_hostname || 'Unknown Device'}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 text-slate-600">
                        <GitCompare className="h-4 w-4 text-slate-400" />
                        <span>Drift Event:</span>
                        <Link
                          to={`/drift/${plan.drift_event_id}`}
                          className="font-mono text-xs text-sky-600 hover:underline"
                        >
                          {plan.drift_event_id.slice(0, 8)}...
                        </Link>
                      </div>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Apply Button */}
                    {isNetEngPlus && (
                      <div className="relative group">
                        <button
                          type="button"
                          onClick={() => applyMutation.mutate(plan.id)}
                          disabled={!isApproved || isApplyingThis || isApplied}
                          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                            isApproved && !isApplied
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs cursor-pointer'
                              : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                          }`}
                        >
                          <Play className={`h-3.5 w-3.5 ${isApplyingThis ? 'animate-spin' : ''}`} />
                          <span>
                            {isApplyingThis
                              ? 'Applying & Verifying...'
                              : isApplied
                              ? 'Already Executed'
                              : 'Apply Remediation'}
                          </span>
                        </button>

                        {!isApproved && !isApplied && (
                          <div className="absolute right-0 bottom-full mb-2 hidden group-hover:flex flex-col items-center z-20 w-64">
                            <div className="bg-slate-900 text-white text-[11px] rounded-lg py-1.5 px-3 shadow-lg border border-slate-800 text-center">
                              {isPending
                                ? 'Plan must be approved in the Approval Queue before execution.'
                                : 'Plan was rejected or is not approved.'}
                            </div>
                            <div className="w-2 h-2 bg-slate-900 rotate-45 -mt-1" />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Rollback Button (Admin only) */}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setRollbackPlan(plan)}
                        disabled={isRollingBackThis}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 rounded-lg text-xs font-semibold transition-colors"
                        title="Rollback device to pre-change backup configuration"
                      >
                        <RotateCcw className={`h-3.5 w-3.5 ${isRollingBackThis ? 'animate-spin' : ''}`} />
                        <span>Rollback to Backup</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Approval Review Status */}
                {plan.approval && (
                  <div
                    className={`px-5 py-3 text-xs flex flex-wrap items-center justify-between gap-2 ${
                      plan.approval.decision === 'APPROVED'
                        ? 'bg-emerald-50/50 text-emerald-900'
                        : 'bg-rose-50/50 text-rose-900'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-slate-500" />
                      <span>
                        <span className="font-semibold">Review Decision:</span> {plan.approval.decision} by{' '}
                        <span className="font-semibold">@{plan.approval.approver_username || 'Engineer'}</span> on{' '}
                        {new Date(plan.approval.decided_at).toLocaleString()}
                      </span>
                    </div>
                    {plan.approval.comment && (
                      <div className="italic text-slate-600 max-w-xl truncate">
                        "{plan.approval.comment}"
                      </div>
                    )}
                  </div>
                )}

                {/* Action History if Executed */}
                {plan.actions && plan.actions.length > 0 && (
                  <div className="px-5 py-3 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 font-semibold">Execution Audit:</span>
                      {getActionResultBadge(plan.actions[plan.actions.length - 1].result)}
                      <span className="text-slate-400">
                        on {new Date(plan.actions[plan.actions.length - 1].executed_at).toLocaleString()}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">
                      Action ID: {plan.actions[plan.actions.length - 1].id.slice(0, 8)}
                    </span>
                  </div>
                )}

                {/* Proposed Commands Preview (Immutable) */}
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider">
                      <Terminal className="h-4 w-4 text-sky-600" />
                      <span>TEMPLATE-GENERATED PREVIEW (IMMUTABLE)</span>
                    </div>
                    <span className="text-[11px] text-slate-500 italic">
                      Predefined Jinja2 Template • Direct edits disabled by security guardrail
                    </span>
                  </div>

                  <div className="relative">
                    <pre className="p-4 bg-slate-950 text-emerald-400 font-mono text-xs rounded-xl border border-slate-800 overflow-x-auto leading-relaxed select-text shadow-inner">
                      {plan.proposed_commands && plan.proposed_commands.length > 0
                        ? plan.proposed_commands.join('\n')
                        : '! No remediation commands generated.'}
                    </pre>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Admin Manual Rollback Confirmation Modal */}
      {rollbackPlan && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <div className="p-2 bg-amber-100 rounded-lg">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Confirm Manual Rollback</h3>
                <p className="text-xs text-slate-500">Target Device: {rollbackPlan.device_hostname}</p>
              </div>
            </div>

            <div className="text-sm text-slate-600 space-y-2">
              <p>
                Are you sure you want to trigger a manual rollback for Plan{' '}
                <span className="font-mono font-semibold text-slate-800">{rollbackPlan.id.slice(0, 8)}</span>?
              </p>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                <span className="font-bold">Caution: </span>
                This will re-push the pre-change configuration backup snapshot to the live device, overwriting
                any post-change modifications. This action is permanently audited in the system log.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRollbackPlan(null)}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => rollbackMutation.mutate(rollbackPlan.id)}
                disabled={rollbackMutation.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs"
              >
                <RotateCcw className={`h-3.5 w-3.5 ${rollbackMutation.isPending ? 'animate-spin' : ''}`} />
                <span>{rollbackMutation.isPending ? 'Rolling back...' : 'Confirm & Execute Rollback'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
