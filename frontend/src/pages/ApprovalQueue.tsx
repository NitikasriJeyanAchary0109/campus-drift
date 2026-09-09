import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  CheckSquare,
  CheckCircle2,
  XCircle,
  Clock,
  Server,
  GitCompare,
  Terminal,
  RefreshCw,
  Search,
  AlertCircle,
  ExternalLink,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';

interface ApprovalPlan {
  id: string;
  drift_event_id: string;
  device_id?: string | null;
  device_hostname?: string | null;
  proposed_commands: string[];
  status: string;
  created_at: string;
}

export const ApprovalQueue: React.FC = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isNetEngPlus = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  const [searchTerm, setSearchTerm] = useState('');
  const [actionBanner, setActionBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Reject Modal state
  const [rejectingPlan, setRejectingPlan] = useState<ApprovalPlan | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [rejectError, setRejectError] = useState('');

  // Fetch pending approvals
  const {
    data: pendingPlans = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery<ApprovalPlan[]>({
    queryKey: ['pending-approvals'],
    queryFn: async () => {
      const res = await apiClient.get('/api/approvals/pending');
      return res.data;
    },
  });

  // Submit Approval Decision Mutation
  const approvalMutation = useMutation({
    mutationFn: async ({
      planId,
      decision,
      comment,
    }: {
      planId: string;
      decision: 'APPROVED' | 'REJECTED';
      comment?: string;
    }) => {
      const res = await apiClient.post(`/api/approvals/${planId}`, {
        decision,
        comment: comment || undefined,
      });
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['remediation-plans'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
      setRejectingPlan(null);
      setRejectComment('');
      setRejectError('');
      setActionBanner({
        type: 'success',
        message:
          variables.decision === 'APPROVED'
            ? `Plan ${variables.planId.slice(0, 8)} approved. It is now eligible for execution.`
            : `Plan ${variables.planId.slice(0, 8)} rejected. Execution blocked.`,
      });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message || 'Failed to submit approval decision.';
      setActionBanner({ type: 'error', message: msg });
    },
  });

  const handleApprove = (planId: string) => {
    approvalMutation.mutate({ planId, decision: 'APPROVED' });
  };

  const handleRejectOpen = (plan: ApprovalPlan) => {
    setRejectingPlan(plan);
    setRejectComment('');
    setRejectError('');
  };

  const handleRejectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rejectComment.trim().length < 5) {
      setRejectError('Rejection comment must be at least 5 characters explaining the rationale.');
      return;
    }
    if (!rejectingPlan) return;

    approvalMutation.mutate({
      planId: rejectingPlan.id,
      decision: 'REJECTED',
      comment: rejectComment.trim(),
    });
  };

  const filteredPlans = pendingPlans.filter((plan) => {
    return (
      (plan.device_hostname || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      plan.id.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-50 rounded-lg text-emerald-700">
              <CheckSquare className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-800">Remediation Approval Queue</h2>
              <p className="text-sm text-slate-500">
                Mandatory two-person sign-off gate for Admin and Network Engineer roles prior to live device push.
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

      {/* Action Banner */}
      {actionBanner && (
        <div
          className={`p-4 rounded-xl border flex items-start justify-between gap-3 ${
            actionBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {actionBanner.type === 'success' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            )}
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

      {/* Gate Explanation Callout */}
      <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-sky-600 shrink-0 mt-0.5" />
        <div className="text-sm text-sky-900 leading-relaxed">
          <span className="font-bold">Approval Gate Enforced (§9 & §13): </span>
          All proposed remediation plans require explicit review before execution. Network Engineers and Administrators
          can approve plans for live push or reject them with mandatory documentation. Once approved, the plan
          can be executed from the <Link to="/remediation" className="font-semibold underline">Remediation Engine</Link>.
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between gap-4">
        <div className="relative flex-1 w-full">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search pending plans by device hostname or plan ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <span className="text-xs font-semibold text-slate-500 shrink-0">
          {filteredPlans.length} Pending {filteredPlans.length === 1 ? 'Plan' : 'Plans'}
        </span>
      </div>

      {/* Pending Plans List */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3">
          <RefreshCw className="h-8 w-8 text-sky-500 animate-spin mx-auto" />
          <p className="text-sm text-slate-500 font-medium">Loading pending approvals from queue...</p>
        </div>
      ) : filteredPlans.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3">
          <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
          <h3 className="text-base font-semibold text-slate-800">Queue is Clear!</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            {searchTerm
              ? 'No pending remediation plans match your search term.'
              : 'There are currently no remediation plans awaiting engineering sign-off.'}
          </p>
          <Link
            to="/remediation"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            <span>View Remediation Engine</span>
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredPlans.map((plan) => {
            const isProcessingThis =
              approvalMutation.isPending && approvalMutation.variables?.planId === plan.id;

            return (
              <div
                key={plan.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100"
              >
                {/* Card Header */}
                <div className="p-5 bg-slate-50/70 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                        <Clock className="h-3 w-3" />
                        PENDING APPROVAL
                      </span>
                      <span className="text-xs font-mono text-slate-500">Plan #{plan.id.slice(0, 8)}</span>
                      <span className="text-xs text-slate-400">•</span>
                      <span className="text-xs text-slate-500">
                        Submitted {new Date(plan.created_at).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-sm pt-1">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                        <Server className="h-4 w-4 text-slate-500" />
                        <span>Target Device:</span>
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

                  {/* Decision Actions */}
                  {isNetEngPlus ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleApprove(plan.id)}
                        disabled={isProcessingThis}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs"
                      >
                        <CheckCircle2 className={`h-3.5 w-3.5 ${isProcessingThis ? 'animate-spin' : ''}`} />
                        <span>Approve Plan</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRejectOpen(plan)}
                        disabled={isProcessingThis}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Reject Plan</span>
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 italic">
                      Sign-off requires Network Engineer or Admin role.
                    </div>
                  )}
                </div>

                {/* Proposed Commands Preview */}
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider">
                      <Terminal className="h-4 w-4 text-sky-600" />
                      <span>Proposed Device Commands</span>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      Auto-backup will be captured prior to execution
                    </span>
                  </div>

                  <pre className="p-4 bg-slate-950 text-emerald-400 font-mono text-xs rounded-xl border border-slate-800 overflow-x-auto leading-relaxed select-text shadow-inner">
                    {plan.proposed_commands && plan.proposed_commands.length > 0
                      ? plan.proposed_commands.join('\n')
                      : '! No remediation commands provided in this plan.'}
                  </pre>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rejection Modal with Mandatory Comment */}
      {rejectingPlan && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2 bg-rose-100 rounded-lg">
                <XCircle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Reject Remediation Plan</h3>
                <p className="text-xs text-slate-500">Plan #{rejectingPlan.id.slice(0, 8)} • {rejectingPlan.device_hostname}</p>
              </div>
            </div>

            <form onSubmit={handleRejectSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-slate-400" />
                  <span>Mandatory Rejection Comment *</span>
                </label>
                <textarea
                  rows={3}
                  value={rejectComment}
                  onChange={(e) => {
                    setRejectComment(e.target.value);
                    if (rejectError) setRejectError('');
                  }}
                  placeholder="Provide engineering rationale for rejecting this plan (minimum 5 characters)..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-rose-500 font-sans"
                  required
                />
                {rejectError && (
                  <p className="text-xs text-rose-600 mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    <span>{rejectError}</span>
                  </p>
                )}
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
                Rejecting a plan permanently marks it as <span className="font-semibold text-rose-700">REJECTED</span> and
                records your comment into the immutable audit trail.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setRejectingPlan(null)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={approvalMutation.isPending}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs"
                >
                  <XCircle className={`h-3.5 w-3.5 ${approvalMutation.isPending ? 'animate-spin' : ''}`} />
                  <span>{approvalMutation.isPending ? 'Submitting...' : 'Confirm Rejection'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
