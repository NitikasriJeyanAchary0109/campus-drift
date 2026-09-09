import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  CheckSquare,
  CheckCircle,
  XCircle,
  Clock,
  Terminal,
  Server,
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
  ExternalLink,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';

interface RemediationPlanItem {
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

  const isNetEng = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  // State for modals
  const [activePlanForAction, setActivePlanForAction] = useState<RemediationPlanItem | null>(null);
  const [actionType, setActionType] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [commentError, setCommentError] = useState('');
  const [copiedPlanId, setCopiedPlanId] = useState<string | null>(null);
  const [actionSuccessBanner, setActionSuccessBanner] = useState<{
    message: string;
    planId?: string;
  } | null>(null);

  // Fetch pending approval plans
  const {
    data: pendingPlans = [],
    isLoading,
    isError,
  } = useQuery<RemediationPlanItem[]>({
    queryKey: ['approvalsPending'],
    queryFn: async () => {
      const res = await apiClient.get('/api/approvals/pending');
      return res.data;
    },
    enabled: isNetEng,
  });

  // Approval / Rejection mutation
  const decisionMutation = useMutation({
    mutationFn: async ({
      planId,
      decision,
      comment,
    }: {
      planId: string;
      decision: 'APPROVED' | 'REJECTED';
      comment: string;
    }) => {
      const res = await apiClient.post(`/api/approvals/${planId}`, {
        decision,
        comment: comment.trim() || undefined,
      });
      return res.data;
    },
    onSuccess: (_, variables) => {
      const isApproved = variables.decision === 'APPROVED';
      queryClient.invalidateQueries({ queryKey: ['approvalsPending'] });
      queryClient.invalidateQueries({ queryKey: ['remediationPlans'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });

      setActionSuccessBanner({
        message: isApproved
          ? `Plan #${variables.planId.slice(0, 8)} successfully APPROVED.`
          : `Plan #${variables.planId.slice(0, 8)} has been REJECTED.`,
        planId: isApproved ? variables.planId : undefined,
      });

      // Reset modal state
      setActivePlanForAction(null);
      setActionType(null);
      setReviewComment('');
      setCommentError('');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message || 'Failed to submit review decision.';
      setCommentError(msg);
    },
  });

  const handleOpenModal = (plan: RemediationPlanItem, type: 'APPROVE' | 'REJECT') => {
    setActivePlanForAction(plan);
    setActionType(type);
    setReviewComment('');
    setCommentError('');
  };

  const handleCloseModal = () => {
    setActivePlanForAction(null);
    setActionType(null);
    setReviewComment('');
    setCommentError('');
  };

  const handleSubmitDecision = () => {
    if (!activePlanForAction || !actionType) return;

    if (actionType === 'REJECT' && !reviewComment.trim()) {
      setCommentError('A rejection reason is mandatory to document why the plan was declined.');
      return;
    }

    decisionMutation.mutate({
      planId: activePlanForAction.id,
      decision: actionType === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      comment: reviewComment,
    });
  };

  const handleCopyCommands = (planId: string, commands: string[]) => {
    navigator.clipboard.writeText(commands.join('\n'));
    setCopiedPlanId(planId);
    setTimeout(() => setCopiedPlanId(null), 2000);
  };

  if (!isNetEng) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-white rounded-xl border border-slate-200 shadow-sm text-center">
        <ShieldAlert className="h-12 w-12 text-amber-600 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-800 mb-2">Restricted Access</h2>
        <p className="text-sm text-slate-600 mb-6">
          The Approval Queue requires NetworkEngineer or Admin privileges. Your current role is{' '}
          <strong>{user?.role || 'Viewer'}</strong>.
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg">
              <CheckSquare className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-800">Remediation Approval Queue</h2>
              <p className="text-sm text-slate-500">
                Four-eyes engineering sign-off gate before configuration changes can be pushed to production devices.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-xs font-semibold flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span>{pendingPlans.length} Pending Review</span>
          </span>
          <Link
            to="/remediation"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-colors"
          >
            <span>Remediation Workspace</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Success Banner */}
      {actionSuccessBanner && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-3 text-emerald-900 text-sm shadow-sm animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
            <span>{actionSuccessBanner.message}</span>
            {actionSuccessBanner.planId && (
              <Link
                to={`/remediation?plan_id=${actionSuccessBanner.planId}`}
                className="font-semibold text-emerald-700 underline hover:text-emerald-800 ml-2"
              >
                Go to Remediation to apply →
              </Link>
            )}
          </div>
          <button
            onClick={() => setActionSuccessBanner(null)}
            className="text-xs text-emerald-700 hover:text-emerald-900 font-semibold px-2 py-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Pending Plans List */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
          Loading pending approvals...
        </div>
      ) : isError ? (
        <div className="bg-white rounded-xl border border-rose-200 p-12 text-center text-rose-600 text-sm">
          Failed to load approval queue. Please try again.
        </div>
      ) : pendingPlans.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3 shadow-sm">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-full w-fit mx-auto">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <h3 className="text-base font-bold text-slate-800">Queue is Clear!</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            There are currently no remediation plans awaiting approval. All proposed changes have been reviewed.
          </p>
          <div className="pt-2">
            <Link
              to="/drift"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              <span>Inspect Drift Events</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {pendingPlans.map((plan) => (
            <div
              key={plan.id}
              className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all hover:border-slate-300"
            >
              {/* Card Header */}
              <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                      PENDING REVIEW
                    </span>
                    <span className="font-mono text-xs text-slate-500">Plan ID: {plan.id}</span>
                    <span className="text-xs text-slate-400">•</span>
                    <span className="text-xs text-slate-500">
                      Created {new Date(plan.created_at).toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pt-0.5">
                    <Server className="h-4 w-4 text-slate-500" />
                    <span className="font-bold text-slate-800 text-sm">
                      {plan.device_hostname || 'Network Device'}
                    </span>
                    {plan.device_id && (
                      <Link
                        to={`/devices/${plan.device_id}`}
                        className="text-xs text-sky-600 hover:underline inline-flex items-center gap-0.5"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                    <span className="text-xs text-slate-400">•</span>
                    <Link
                      to={`/drift/${plan.drift_event_id}`}
                      className="text-xs text-slate-500 hover:text-sky-600 hover:underline inline-flex items-center gap-1"
                    >
                      <span>Drift Details</span>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                </div>

                {/* Approve / Reject Actions */}
                <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0">
                  <button
                    type="button"
                    onClick={() => handleOpenModal(plan, 'APPROVE')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs"
                  >
                    <CheckCircle className="h-4 w-4" />
                    <span>Approve</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenModal(plan, 'REJECT')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-semibold transition-colors"
                  >
                    <XCircle className="h-4 w-4" />
                    <span>Reject</span>
                  </button>
                </div>
              </div>

              {/* Card Body: Proposed Commands Preview */}
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <Terminal className="h-4 w-4 text-slate-500" />
                    Proposed CLI Payloads (Jinja2 Template-Generated)
                  </span>
                  <button
                    onClick={() => handleCopyCommands(plan.id, plan.proposed_commands)}
                    className="text-[11px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 border border-slate-200 px-2 py-1 rounded hover:bg-slate-50 transition-colors"
                  >
                    {copiedPlanId === plan.id ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-600" />
                        <span className="text-emerald-600 font-medium">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Commands Terminal Box */}
                <div className="bg-slate-950 rounded-lg border border-slate-800 p-3 font-mono text-xs text-emerald-400 max-h-48 overflow-y-auto">
                  {plan.proposed_commands?.map((cmd, idx) => (
                    <div key={idx} className="flex leading-relaxed">
                      <span className="text-slate-600 w-7 select-none text-right pr-2 shrink-0">
                        {idx + 1}
                      </span>
                      <span className={cmd.startsWith('!') ? 'text-slate-500 italic' : 'text-emerald-300'}>
                        {cmd}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Guardrail Footer note */}
                <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1 text-slate-500">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                    Deterministic Jinja2 template • No arbitrary commands
                  </span>
                  <span>Pre-change snapshot backup captured automatically upon approval and apply.</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Decision Modal (Approve or Reject) */}
      {activePlanForAction && actionType && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`p-2.5 rounded-lg shrink-0 ${
                  actionType === 'APPROVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                }`}
              >
                {actionType === 'APPROVE' ? (
                  <CheckCircle className="h-6 w-6" />
                ) : (
                  <XCircle className="h-6 w-6" />
                )}
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {actionType === 'APPROVE' ? 'Approve Remediation Plan' : 'Reject Remediation Plan'}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Target device: <strong>{activePlanForAction.device_hostname}</strong>
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                {actionType === 'APPROVE' ? 'Review Comment (Optional)' : 'Rejection Reason (Required)'}
              </label>
              <textarea
                value={reviewComment}
                onChange={(e) => {
                  setReviewComment(e.target.value);
                  if (commentError) setCommentError('');
                }}
                rows={3}
                placeholder={
                  actionType === 'APPROVE'
                    ? 'e.g., Verified against change ticket CAB-1049; approved for deployment.'
                    : 'e.g., VLAN 100 configuration conflicts with upcoming maintenance window.'
                }
                className={`w-full p-2.5 text-xs rounded-lg border focus:ring-2 outline-none ${
                  commentError
                    ? 'border-rose-300 focus:ring-rose-500/20'
                    : 'border-slate-300 focus:border-sky-500 focus:ring-sky-500/20'
                }`}
              />
              {commentError && (
                <p className="text-xs text-rose-600 flex items-center gap-1 font-medium">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{commentError}</span>
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleCloseModal}
                className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={decisionMutation.isPending}
                onClick={handleSubmitDecision}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors ${
                  actionType === 'APPROVE'
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-rose-600 hover:bg-rose-500'
                }`}
              >
                {decisionMutation.isPending
                  ? 'Submitting...'
                  : actionType === 'APPROVE'
                  ? 'Confirm Approval'
                  : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
