import React, { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  Wrench,
  ShieldCheck,
  ShieldAlert,
  Terminal,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  Play,
  Copy,
  Check,
  ExternalLink,
  Server,
  AlertTriangle,
  Lock,
  ArrowRight,
  Info,
} from 'lucide-react';

interface ApprovalDetail {
  id: string;
  remediation_plan_id: string;
  approved_by: string;
  approver_username?: string | null;
  decision: 'APPROVED' | 'REJECTED';
  comment?: string | null;
  decided_at: string;
}

interface RemediationActionItem {
  id: string;
  remediation_plan_id: string;
  executed_commands: string[];
  result: 'SUCCESS' | 'FAILED' | 'ROLLED_BACK' | string;
  verification_snapshot_id?: string | null;
  executed_at: string;
}

interface RemediationPlanItem {
  id: string;
  drift_event_id: string;
  device_id?: string | null;
  device_hostname?: string | null;
  proposed_commands: string[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED' | string;
  created_at: string;
  approval?: ApprovalDetail | null;
  actions?: RemediationActionItem[];
}

export const Remediation: React.FC = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const planIdParam = searchParams.get('plan_id');

  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [copied, setCopied] = useState(false);
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [isRollbackModalOpen, setIsRollbackModalOpen] = useState(false);
  const [executionBanner, setExecutionBanner] = useState<{
    type: 'success' | 'warning' | 'error';
    title: string;
    message: string;
    details?: string;
  } | null>(null);

  const isAdmin = user?.role === 'Admin';
  const isNetEng = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  // 1. Fetch all remediation plans
  const {
    data: plans = [],
    isLoading: isLoadingPlans,
    isError: isPlansError,
  } = useQuery<RemediationPlanItem[]>({
    queryKey: ['remediationPlans', statusFilter],
    queryFn: async () => {
      const url = statusFilter === 'ALL' ? '/api/remediation' : `/api/remediation?status=${statusFilter}`;
      const res = await apiClient.get(url);
      return res.data;
    },
    enabled: isNetEng,
  });

  // Selected plan ID
  const activePlanId = planIdParam || (plans.length > 0 ? plans[0].id : null);

  // 2. Fetch specific plan details if selected
  const {
    data: activePlan,
    isLoading: isLoadingActivePlan,
  } = useQuery<RemediationPlanItem>({
    queryKey: ['remediationPlan', activePlanId],
    queryFn: async () => {
      const res = await apiClient.get(`/api/remediation/${activePlanId}`);
      return res.data;
    },
    enabled: !!activePlanId && isNetEng,
  });

  // Apply mutation
  const applyMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await apiClient.post(`/api/remediation/${planId}/apply`);
      return res.data;
    },
    onSuccess: (data) => {
      setIsApplyModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['remediationPlans'] });
      queryClient.invalidateQueries({ queryKey: ['remediationPlan', activePlanId] });
      queryClient.invalidateQueries({ queryKey: ['driftEvents'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });

      if (data.verification_passed) {
        setExecutionBanner({
          type: 'success',
          title: 'Remediation Applied & Verified Successfully',
          message: data.message || 'Configuration pushed to live device and key-path verification passed.',
          details: `Action ID: ${data.action_id} | Commands executed: ${data.executed_commands?.length || 0}`,
        });
      } else {
        setExecutionBanner({
          type: 'warning',
          title: 'Verification Failed — Automated Rollback Executed',
          message: data.message || 'Post-change verification failed against approved baseline. Pre-change backup configuration was immediately restored.',
          details: `Action ID: ${data.action_id} | Device returned to clean pre-change state.`,
        });
      }
    },
    onError: (err: any) => {
      setIsApplyModalOpen(false);
      const msg = err.response?.data?.detail || err.message || 'Failed to apply remediation plan.';
      setExecutionBanner({
        type: 'error',
        title: 'Remediation Application Failed',
        message: msg,
      });
    },
  });

  // Manual Rollback mutation (Admin only)
  const rollbackMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await apiClient.post(`/api/remediation/${planId}/rollback`);
      return res.data;
    },
    onSuccess: (data) => {
      setIsRollbackModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['remediationPlans'] });
      queryClient.invalidateQueries({ queryKey: ['remediationPlan', activePlanId] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
      setExecutionBanner({
        type: 'success',
        title: 'Manual Rollback Executed Successfully',
        message: data.message || 'Device configuration has been restored to pre-change backup.',
        details: `Action ID: ${data.action_id}`,
      });
    },
    onError: (err: any) => {
      setIsRollbackModalOpen(false);
      const msg = err.response?.data?.detail || err.message || 'Failed to execute rollback.';
      setExecutionBanner({
        type: 'error',
        title: 'Rollback Failed',
        message: msg,
      });
    },
  });

  const handleCopyCommands = (commands: string[]) => {
    navigator.clipboard.writeText(commands.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approved
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200">
            <XCircle className="h-3.5 w-3.5" />
            Rejected
          </span>
        );
      case 'APPLIED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-100 text-sky-800 border border-sky-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Applied
          </span>
        );
      case 'PENDING':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            <Clock className="h-3.5 w-3.5" />
            Pending Approval
          </span>
        );
    }
  };

  if (!isNetEng) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-white rounded-xl border border-slate-200 shadow-sm text-center">
        <ShieldAlert className="h-12 w-12 text-amber-600 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-800 mb-2">Restricted Access</h2>
        <p className="text-sm text-slate-600 mb-6">
          The Remediation Engine requires NetworkEngineer or Admin privileges. Your current role is <strong>{user?.role || 'Viewer'}</strong>.
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

  const isApproved = activePlan?.status === 'APPROVED';
  const isApplied = activePlan?.status === 'APPLIED';
  const isPending = activePlan?.status === 'PENDING';

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-sky-100 text-sky-700 rounded-lg">
              <Wrench className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-800">Remediation Engine</h2>
              <p className="text-sm text-slate-500">
                Deterministic Jinja2 template-generated CLI fixes with cryptographic backup, approval gates, and automated rollback.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/approvals"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors shadow-sm shadow-emerald-700/20"
          >
            <ShieldCheck className="h-4 w-4" />
            <span>Approval Queue</span>
          </Link>
        </div>
      </div>

      {/* Execution / Rollback Result Banner */}
      {executionBanner && (
        <div
          className={`p-4 rounded-xl border flex items-start gap-3 shadow-sm ${
            executionBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : executionBanner.type === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          {executionBanner.type === 'success' && <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />}
          {executionBanner.type === 'warning' && <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />}
          {executionBanner.type === 'error' && <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />}
          <div className="flex-1 text-sm">
            <h4 className="font-semibold">{executionBanner.title}</h4>
            <p className="mt-0.5 text-xs opacity-90">{executionBanner.message}</p>
            {executionBanner.details && (
              <p className="mt-1 font-mono text-[11px] opacity-75">{executionBanner.details}</p>
            )}
          </div>
          <button
            onClick={() => setExecutionBanner(null)}
            className="text-xs opacity-60 hover:opacity-100 font-semibold px-2 py-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Grid: Sidebar List of Plans + Active Plan Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Plans List (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800 text-sm">Remediation Plans</h3>
              <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-medium">
                {plans.length} total
              </span>
            </div>

            {/* Status Filter */}
            <div className="flex flex-wrap gap-1">
              {['ALL', 'PENDING', 'APPROVED', 'APPLIED', 'REJECTED'].map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                    statusFilter === st
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            {/* List */}
            {isLoadingPlans ? (
              <div className="py-8 text-center text-slate-400 text-xs">Loading plans...</div>
            ) : isPlansError ? (
              <div className="py-8 text-center text-rose-500 text-xs">Failed to load plans</div>
            ) : plans.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-xs space-y-2">
                <p>No plans found for selected filter.</p>
                <Link to="/drift" className="text-sky-600 hover:underline inline-block font-medium">
                  View Drift Events to generate plan →
                </Link>
              </div>
            ) : (
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {plans.map((p) => {
                  const isSelected = p.id === activePlanId;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSearchParams({ plan_id: p.id })}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        isSelected
                          ? 'bg-sky-50/70 border-sky-300 ring-1 ring-sky-400/30'
                          : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-mono text-[11px] font-semibold text-slate-700 truncate">
                          {p.device_hostname || 'Unknown Device'}
                        </span>
                        {getStatusBadge(p.status)}
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center justify-between">
                        <span>{p.proposed_commands?.length || 0} commands</span>
                        <span>{new Date(p.created_at).toLocaleDateString()}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Active Plan Workspace (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {isLoadingActivePlan ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
              Loading plan details...
            </div>
          ) : !activePlan ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3">
              <Wrench className="h-10 w-10 text-slate-300 mx-auto" />
              <h3 className="font-semibold text-slate-700">No Remediation Plan Selected</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Select a plan from the left panel or navigate to a Drift Event to generate a new template-based remediation plan.
              </p>
              <Link
                to="/drift"
                className="inline-flex items-center gap-1.5 text-xs text-sky-600 font-medium hover:underline"
              >
                <span>Browse Drift Events</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Plan Metadata Card */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs text-slate-400">PLAN ID:</span>
                      <span className="font-mono text-xs text-slate-700 font-semibold">{activePlan.id}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-slate-500" />
                      <span className="font-bold text-slate-800 text-base">
                        {activePlan.device_hostname || 'Network Switch/Router'}
                      </span>
                      {activePlan.device_id && (
                        <Link
                          to={`/devices/${activePlan.device_id}`}
                          className="text-xs text-sky-600 hover:underline inline-flex items-center gap-0.5"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {getStatusBadge(activePlan.status)}
                    <Link
                      to={`/drift/${activePlan.drift_event_id}`}
                      className="text-xs px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg font-medium transition-colors inline-flex items-center gap-1"
                    >
                      <span>View Drift Event</span>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                </div>

                {/* Approval Review Status Box */}
                <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-slate-500" />
                      Engineering Approval Status
                    </span>
                    {activePlan.approval ? (
                      <span className="text-slate-500">
                        Reviewed {new Date(activePlan.approval.decided_at).toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-amber-700 font-medium">Awaiting Peer Review</span>
                    )}
                  </div>

                  {activePlan.approval ? (
                    <div className="space-y-1">
                      <p className="text-slate-700">
                        Decision:{' '}
                        <strong
                          className={
                            activePlan.approval.decision === 'APPROVED' ? 'text-emerald-700' : 'text-rose-700'
                          }
                        >
                          {activePlan.approval.decision}
                        </strong>
                        {activePlan.approval.approver_username && (
                          <span> by @{activePlan.approval.approver_username}</span>
                        )}
                      </p>
                      {activePlan.approval.comment && (
                        <p className="text-slate-600 italic bg-white p-2 rounded border border-slate-200">
                          "{activePlan.approval.comment}"
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between pt-1">
                      <p className="text-slate-500">
                        This plan must be signed off by a peer engineer or administrator before it can be applied to the device.
                      </p>
                      <Link
                        to="/approvals"
                        className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-medium transition-colors inline-flex items-center gap-1 shrink-0"
                      >
                        <Clock className="h-3 w-3" />
                        <span>Go to Queue</span>
                      </Link>
                    </div>
                  )}
                </div>

                {/* Jinja2 Guardrail Callout */}
                <div className="flex items-start gap-3 p-3.5 bg-sky-50/80 border border-sky-200 rounded-lg text-sky-900 text-xs">
                  <ShieldCheck className="h-5 w-5 text-sky-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Remediation Guardrail: Jinja2 Template Synthesis</span>
                    <p className="text-sky-800 mt-0.5">
                      All CLI commands shown below are deterministic and rendered exclusively from whitelisted, vendor-certified templates. Ad-hoc free-text typing is strictly prohibited to prevent operator error and injection vulnerabilities.
                    </p>
                  </div>
                </div>

                {/* Proposed Commands Terminal View */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-slate-800 text-xs flex items-center gap-2">
                      <Terminal className="h-4 w-4 text-slate-600" />
                      <span>Proposed Commands (Read-Only Template Payload)</span>
                    </h4>
                    <button
                      onClick={() => handleCopyCommands(activePlan.proposed_commands)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 text-slate-600 transition-colors"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-600" />
                          <span className="text-emerald-600 font-medium">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy Commands</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Terminal Box */}
                  <div className="bg-slate-950 rounded-lg border border-slate-800 overflow-hidden shadow-inner">
                    <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80"></span>
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80"></span>
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80"></span>
                        <span className="ml-2 font-mono text-slate-300">cli_preview.cmd</span>
                      </div>
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-sky-400">
                        Template Rendered • Immutable
                      </span>
                    </div>

                    <div className="p-4 font-mono text-xs overflow-x-auto text-emerald-400 max-h-72">
                      {activePlan.proposed_commands && activePlan.proposed_commands.length > 0 ? (
                        activePlan.proposed_commands.map((cmd, idx) => (
                          <div key={idx} className="flex leading-relaxed">
                            <span className="text-slate-600 w-8 select-none text-right pr-3 shrink-0">
                              {idx + 1}
                            </span>
                            <span className={cmd.startsWith('!') ? 'text-slate-500 italic' : 'text-emerald-300'}>
                              {cmd}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="text-slate-500 italic">No commands generated.</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Pipeline Execution Controls */}
                <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="text-xs text-slate-500 flex items-center gap-1.5">
                    <Info className="h-4 w-4 text-slate-400 shrink-0" />
                    <span>
                      Execution executes Backup → Apply → Verify → (Automated Rollback if verification fails).
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Manual Rollback Button (Admin Only) */}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setIsRollbackModalOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-semibold transition-colors"
                        title="Force restore device to pre-change backup configuration"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>Manual Rollback (Admin)</span>
                      </button>
                    )}

                    {/* Apply Remediation Button */}
                    <div className="relative group">
                      <button
                        type="button"
                        disabled={!isApproved || isApplied || applyMutation.isPending}
                        onClick={() => setIsApplyModalOpen(true)}
                        className={`inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm ${
                          isApproved && !isApplied
                            ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-600/25 cursor-pointer'
                            : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                        }`}
                      >
                        {applyMutation.isPending ? (
                          <>
                            <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                            <span>Applying & Verifying...</span>
                          </>
                        ) : isApplied ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            <span>Already Applied</span>
                          </>
                        ) : isPending ? (
                          <>
                            <Lock className="h-3.5 w-3.5" />
                            <span>Approval Required</span>
                          </>
                        ) : (
                          <>
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>Apply Remediation</span>
                          </>
                        )}
                      </button>

                      {/* Tooltip when disabled */}
                      {!isApproved && !isApplied && (
                        <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block z-10 w-64 p-2 bg-slate-800 text-white text-[11px] rounded shadow-lg">
                          {isPending
                            ? 'Plan requires an APPROVED decision in the Approval Queue before live execution.'
                            : 'This plan cannot be applied because it is not in the APPROVED state.'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Execution History / Actions Table */}
              {activePlan.actions && activePlan.actions.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-3">
                  <h4 className="font-bold text-slate-800 text-sm">Execution History</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-3 font-semibold">Action ID</th>
                          <th className="py-2.5 px-3 font-semibold">Result</th>
                          <th className="py-2.5 px-3 font-semibold">Commands Executed</th>
                          <th className="py-2.5 px-3 font-semibold">Executed At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activePlan.actions.map((act) => (
                          <tr key={act.id}>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700">{act.id}</td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  act.result === 'SUCCESS'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : act.result === 'ROLLED_BACK'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-rose-100 text-rose-800'
                                }`}
                              >
                                {act.result}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">
                              {act.executed_commands?.length || 0} commands
                            </td>
                            <td className="py-2.5 px-3 text-slate-500">
                              {new Date(act.executed_at).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal: Confirm Apply Remediation */}
      {isApplyModalOpen && activePlan && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-sky-100 text-sky-700 rounded-lg shrink-0">
                <Play className="h-6 w-6 fill-current" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Execute Remediation Pipeline?</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Target device: <strong>{activePlan.device_hostname}</strong>
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-2 text-slate-700">
              <p className="font-semibold text-slate-800">Automated Pipeline Safeguards:</p>
              <ul className="list-disc list-inside space-y-1 text-slate-600">
                <li>1. Pre-change configuration backup snapshot will be stored.</li>
                <li>2. Netmiko configuration session will push verified commands.</li>
                <li>3. Live device will be re-collected, normalized, and verified against baseline.</li>
                <li>
                  4. <strong className="text-amber-800">Automated Rollback:</strong> If verification fails, the device is immediately rolled back to the pre-change backup.
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsApplyModalOpen(false)}
                className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={applyMutation.isPending}
                onClick={() => applyMutation.mutate(activePlan.id)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
              >
                {applyMutation.isPending ? 'Executing Pipeline...' : 'Confirm & Apply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Manual Rollback */}
      {isRollbackModalOpen && activePlan && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-rose-100 text-rose-700 rounded-lg shrink-0">
                <RotateCcw className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Trigger Manual Rollback?</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Target device: <strong>{activePlan.device_hostname}</strong>
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
              <p className="font-semibold mb-1">Administrative Override:</p>
              <p>
                This action will restore the configuration backup captured prior to this plan's application. A high-priority audit log entry will be permanently recorded.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsRollbackModalOpen(false)}
                className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={rollbackMutation.isPending}
                onClick={() => rollbackMutation.mutate(activePlan.id)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
              >
                {rollbackMutation.isPending ? 'Restoring Backup...' : 'Confirm Rollback'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
