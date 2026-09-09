import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  ArrowLeft,
  Wrench,
  ShieldAlert,
  FileText,
  RefreshCw,
  CheckCircle2,
  Ticket,
  Server,
  AlertCircle,
  X,
  Send,
  HelpCircle,
  Terminal,
  Flag,
} from 'lucide-react';

interface DriftDetailItem {
  id: string;
  key_path: string;
  expected_value: string | null;
  actual_value: string | null;
  change_type: 'ADDED' | 'REMOVED' | 'MODIFIED' | string;
  rule_id?: string | null;
  why_it_matters?: string | null;
}

interface EvidenceBundle {
  event_id: string;
  device_hostname: string;
  device_ip: string;
  device_group: string;
  risk_score: number;
  underlying_severity?: number | null;
  label: string;
  is_high_priority: boolean;
  ticket_matched: boolean;
  ticket_ref?: string | null;
  why_it_matters_summary: string;
  details: DriftDetailItem[];
}

interface DriftEventDetail {
  id: string;
  device_id: string;
  device_hostname?: string;
  snapshot_id: string;
  baseline_id?: string;
  label: string;
  risk_score: number;
  underlying_severity?: number | null;
  matched_ticket_id?: string | null;
  matched_ticket_ref?: string | null;
  status: string;
  detected_at: string;
  details_count: number;
  details: DriftDetailItem[];
  evidence_bundle?: EvidenceBundle | null;
}

export const DriftDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const isNetEng = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  const [isFalsePositiveModalOpen, setIsFalsePositiveModalOpen] = useState(false);
  const [fpComment, setFpComment] = useState('');
  const [actionBanner, setActionBanner] = useState<{
    type: 'success' | 'error';
    message: string;
    actionLink?: string;
    actionText?: string;
  } | null>(null);

  // Fetch full drift event details and evidence bundle
  const {
    data: event,
    isLoading,
    isError,
    error,
  } = useQuery<DriftEventDetail>({
    queryKey: ['driftDetail', id],
    queryFn: async () => {
      const res = await apiClient.get(`/api/drift/${id}`);
      return res.data;
    },
    enabled: !!id,
  });

  // Mutation to generate remediation plan
  const generatePlanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/api/remediation/${id}/generate-plan`);
      return res.data;
    },
    onSuccess: (planData) => {
      queryClient.invalidateQueries({ queryKey: ['driftDetail', id] });
      queryClient.invalidateQueries({ queryKey: ['remediation'] });
      setActionBanner({
        type: 'success',
        message: `Remediation Plan created (ID: ${planData.id}). Awaiting peer approval.`,
        actionLink: `/remediation`,
        actionText: 'Review in Remediation Queue →',
      });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message || 'Failed to generate remediation plan.';
      setActionBanner({ type: 'error', message: msg });
    },
  });

  // Mutation to mark false positive
  const markFpMutation = useMutation({
    mutationFn: async (commentText: string) => {
      const res = await apiClient.post(`/api/drift/${id}/mark-false-positive`, {
        comment: commentText,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driftDetail', id] });
      queryClient.invalidateQueries({ queryKey: ['driftEvents'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
      setIsFalsePositiveModalOpen(false);
      setFpComment('');
      setActionBanner({
        type: 'success',
        message: 'Drift event marked as FALSE_POSITIVE and logged to audit trail.',
      });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message || 'Failed to mark as false positive.';
      setActionBanner({ type: 'error', message: msg });
    },
  });

  const handleFpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (fpComment.trim().length < 5) return;
    markFpMutation.mutate(fpComment.trim());
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <RefreshCw className="h-8 w-8 text-sky-500 animate-spin" />
        <p className="text-sm text-slate-500">Compiling configuration evidence bundle & AST diffs...</p>
      </div>
    );
  }

  if (isError || !event) {
    return (
      <div className="p-8 bg-rose-50 border border-rose-200 rounded-xl text-center space-y-3">
        <AlertCircle className="h-10 w-10 text-rose-500 mx-auto" />
        <h3 className="text-lg font-semibold text-rose-900">Drift Event Not Found</h3>
        <p className="text-sm text-rose-600 max-w-md mx-auto">
          {(error as any)?.response?.data?.detail || 'Unable to retrieve drift evidence records.'}
        </p>
        <Link
          to="/drift"
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Drift Events</span>
        </Link>
      </div>
    );
  }

  const bundle = event.evidence_bundle;
  const isHighRisk = event.risk_score >= 80 || event.label === 'Non-Compliant';

  const getTaxonomyBadge = (label: string) => {
    switch (label) {
      case 'Non-Compliant':
        return 'bg-rose-100 text-rose-800 border-rose-300 font-bold';
      case 'Drift-Unauthorized-High':
        return 'bg-orange-100 text-orange-800 border-orange-300 font-bold';
      case 'Drift-Unauthorized-Medium':
        return 'bg-amber-100 text-amber-800 border-amber-300 font-bold';
      case 'Drift-Authorized':
        return 'bg-sky-100 text-sky-800 border-sky-300 font-bold';
      case 'Drift-Low':
        return 'bg-slate-100 text-slate-700 border-slate-300 font-medium';
      case 'NO_BASELINE':
        return 'bg-purple-100 text-purple-800 border-purple-300 font-bold';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200 font-medium';
    }
  };

  const getChangeTypeBadge = (type: string) => {
    switch (type) {
      case 'MODIFIED':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'ADDED':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'REMOVED':
        return 'bg-rose-100 text-rose-800 border-rose-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  return (
    <div className="space-y-6">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/drift"
            className="p-2 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors bg-white shadow-sm"
            title="Back to drift events"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-slate-900">Drift Evidence Bundle</h2>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs border ${getTaxonomyBadge(event.label)}`}
              >
                {event.label}
              </span>
              {event.status === 'FALSE_POSITIVE' && (
                <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-xs font-mono font-semibold">
                  FALSE POSITIVE
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Event UUID: {event.id} • Detected: {new Date(event.detected_at).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {isNetEng && event.status !== 'FALSE_POSITIVE' && (
            <>
              <button
                type="button"
                onClick={() => setIsFalsePositiveModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium transition-colors bg-white shadow-sm"
              >
                <Flag className="h-3.5 w-3.5 text-slate-500" />
                <span>Mark False Positive</span>
              </button>

              <button
                type="button"
                onClick={() => generatePlanMutation.mutate()}
                disabled={generatePlanMutation.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
              >
                <Wrench className="h-4 w-4" />
                <span>{generatePlanMutation.isPending ? 'Generating Plan...' : 'Generate Remediation Plan'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Action result banner */}
      {actionBanner && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-sm ${
            actionBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionBanner.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            )}
            <span>{actionBanner.message}</span>
            {actionBanner.actionLink && (
              <Link to={actionBanner.actionLink} className="underline font-semibold ml-2 hover:text-emerald-950">
                {actionBanner.actionText || 'View Details'}
              </Link>
            )}
          </div>
          <button
            type="button"
            onClick={() => setActionBanner(null)}
            className="p-1 hover:bg-black/5 rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Prominent Security Callout: "Why This Matters" */}
      <div
        className={`p-5 rounded-xl border shadow-sm ${
          isHighRisk
            ? 'bg-gradient-to-r from-rose-50 to-orange-50 border-rose-200'
            : 'bg-gradient-to-r from-sky-50 to-slate-50 border-sky-200'
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`p-2 rounded-lg mt-0.5 ${
              isHighRisk ? 'bg-rose-600 text-white' : 'bg-sky-600 text-white'
            }`}
          >
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="space-y-1.5 flex-1">
            <div className="flex items-center justify-between">
              <h3
                className={`text-sm font-bold uppercase tracking-wider ${
                  isHighRisk ? 'text-rose-900' : 'text-sky-900'
                }`}
              >
                Security & Compliance Impact Analysis
              </h3>
              {isHighRisk && (
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-600 text-white uppercase tracking-wider animate-pulse">
                  High Priority Incident
                </span>
              )}
            </div>
            <p className="text-xs text-slate-700 leading-relaxed font-medium">
              {bundle?.why_it_matters_summary ||
                'Discrepancy detected between active device configuration and approved golden baseline.'}
            </p>
          </div>
        </div>
      </div>

      {/* Risk Assessment & Metadata Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        {/* Device Information */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3 text-xs">
          <div className="flex items-center gap-2 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
            <Server className="h-4 w-4 text-sky-600" />
            <span>Target Hardware</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">Hostname:</span>
              <Link
                to={`/devices/${event.device_id}`}
                className="font-mono font-semibold text-sky-600 hover:underline"
              >
                {event.device_hostname || 'Unknown'}
              </Link>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">IP Address:</span>
              <span className="font-mono text-slate-800">{bundle?.device_ip || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Device Group:</span>
              <span className="text-slate-800 font-medium">{bundle?.device_group || 'Unassigned'}</span>
            </div>
          </div>
        </div>

        {/* Risk Score */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3 text-xs">
          <div className="flex items-center justify-between text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
            <span>Risk Score</span>
            <span className="font-mono text-xs">{event.risk_score} / 100</span>
          </div>
          <div className="space-y-2">
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  event.risk_score >= 80
                    ? 'bg-rose-500'
                    : event.risk_score >= 50
                    ? 'bg-amber-500'
                    : 'bg-slate-400'
                }`}
                style={{ width: `${Math.min(event.risk_score, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>Underlying Severity:</span>
              <span className="font-mono font-medium">
                {event.underlying_severity ?? event.risk_score}
              </span>
            </div>
          </div>
        </div>

        {/* ITSM Change Ticket Verification */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3 text-xs">
          <div className="flex items-center gap-2 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
            <Ticket className="h-4 w-4 text-sky-600" />
            <span>ITSM Ticket Match</span>
          </div>
          {event.matched_ticket_ref ? (
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-sky-50 text-sky-800 border border-sky-200 font-mono text-xs font-semibold">
                <CheckCircle2 className="h-3.5 w-3.5 text-sky-600" />
                <span>{event.matched_ticket_ref}</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Change window matched approved ticket in CMDB.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-xs font-medium">
                Unapproved Modification
              </span>
              <p className="text-[11px] text-slate-400">
                No matching change request active during detection.
              </p>
            </div>
          )}
        </div>

        {/* Evidence Status */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3 text-xs">
          <div className="flex items-center justify-between text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
            <span>Audit State</span>
            <span className="font-mono">{event.details?.length || 0} Diffs</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">Workflow:</span>
              <span className="font-semibold text-slate-800">{event.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Evidence Grade:</span>
              <span className="text-emerald-700 font-semibold">AST Normalized</span>
            </div>
          </div>
        </div>
      </div>

      {/* Side-by-Side Configuration Diff Viewer */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-slate-700" />
            <h3 className="text-base font-bold text-slate-800">
              Hierarchical Configuration Discrepancies ({event.details?.length || 0})
            </h3>
          </div>
          <span className="text-xs text-slate-500">
            Comparing Approved Baseline vs Device Running-Config
          </span>
        </div>

        {event.details && event.details.length > 0 ? (
          <div className="space-y-4">
            {event.details.map((detail, idx) => (
              <div
                key={detail.id || idx}
                className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
              >
                {/* Diff Header */}
                <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-900 bg-white px-2.5 py-1 rounded border border-slate-200 shadow-2xs">
                      {detail.key_path}
                    </span>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded border uppercase ${getChangeTypeBadge(
                        detail.change_type
                      )}`}
                    >
                      {detail.change_type}
                    </span>
                  </div>

                  {detail.why_it_matters && (
                    <div className="text-xs text-slate-600 flex items-center gap-1.5">
                      <HelpCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span className="italic">{detail.why_it_matters}</span>
                    </div>
                  )}
                </div>

                {/* Side-by-Side Panels */}
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 bg-slate-950 font-mono text-xs text-slate-200">
                  {/* Left: Expected Baseline */}
                  <div className="p-4 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 pb-2 border-b border-slate-800">
                      <span className="font-semibold text-emerald-400 uppercase tracking-wider">
                        + Expected Baseline Value
                      </span>
                      <span>Golden Baseline</span>
                    </div>
                    <pre className="p-3 bg-emerald-950/20 border border-emerald-900/40 rounded-lg text-emerald-300 whitespace-pre-wrap overflow-x-auto leading-relaxed">
                      {detail.expected_value !== null && detail.expected_value !== undefined
                        ? String(detail.expected_value)
                        : '(none / not present)'}
                    </pre>
                  </div>

                  {/* Right: Actual Device State */}
                  <div className="p-4 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 pb-2 border-b border-slate-800">
                      <span className="font-semibold text-rose-400 uppercase tracking-wider">
                        - Actual Running-Config
                      </span>
                      <span>Device Snapshot</span>
                    </div>
                    <pre className="p-3 bg-rose-950/20 border border-rose-900/40 rounded-lg text-rose-300 whitespace-pre-wrap overflow-x-auto leading-relaxed">
                      {detail.actual_value !== null && detail.actual_value !== undefined
                        ? String(detail.actual_value)
                        : '(none / omitted)'}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center bg-white rounded-xl border border-slate-200 text-slate-400 text-sm">
            <FileText className="h-8 w-8 mx-auto mb-2 text-slate-300" />
            <p className="font-semibold text-slate-700">No discrete discrepancies recorded.</p>
            <p className="text-xs text-slate-400 mt-1">
              Configuration event may represent a structural baseline check.
            </p>
          </div>
        )}
      </div>

      {/* Mark False Positive Modal */}
      {isFalsePositiveModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                  <Flag className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Mark as False Positive</h3>
                  <p className="text-xs text-slate-500">Audit trail requires mandatory explanation</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFalsePositiveModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleFpSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1.5">
                  Engineer Justification (Mandatory):
                </label>
                <textarea
                  value={fpComment}
                  onChange={(e) => setFpComment(e.target.value)}
                  rows={4}
                  placeholder="Explain why this detected drift is an expected exception or false positive..."
                  required
                  className="w-full p-3 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-sky-500 text-xs leading-relaxed"
                />
                <p className="text-[11px] text-slate-400 mt-1">Minimum 5 characters required.</p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsFalsePositiveModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={markFpMutation.isPending || fpComment.trim().length < 5}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-medium transition-colors shadow-sm disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{markFpMutation.isPending ? 'Logging Audit...' : 'Confirm False Positive'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

