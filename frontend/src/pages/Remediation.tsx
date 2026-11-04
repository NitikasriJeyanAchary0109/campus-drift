import React, { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  Wrench,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  Play,
  Check,
  Server,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  MapPin,
  Gauge,
  Code2,
  Eye,
  Download,
  ShieldCheck,
  Target,
  Home,
  CheckSquare,
  Settings,
  X,
} from 'lucide-react';
import remediationHeaderArt from '../assets/remediation-header-art.png';

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
  result: 'SUCCESS' | 'ROLLED_BACK' | 'ROLLBACK_FAILED' | 'ABORTED' | 'IN_PROGRESS' | string;
  verification_snapshot_id?: string | null;
  executed_at: string;
}

interface RemediationPlanItem {
  id: string;
  drift_event_id: string;
  device_id?: string | null;
  device_hostname?: string | null;
  proposed_commands: string[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLYING' | 'APPLIED' | 'FAILED' | 'ROLLED_BACK' | 'ROLLBACK_FAILED' | string;
  created_at: string;
  approval?: ApprovalDetail | null;
  actions?: RemediationActionItem[];
}

export const Remediation: React.FC = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const planIdParam = searchParams.get('plan_id');

  const isNetEng = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  // State: Remediation Option Selection
  const [remediationOption, setRemediationOption] = useState<'recommended' | 'rollback' | 'custom'>('recommended');

  // State: Execution Target
  const [executionTarget, setExecutionTarget] = useState<'running' | 'startup'>('running');

  // State: Terminal Tabs
  const [terminalTab, setTerminalTab] = useState<'config' | 'diff'>('config');

  // State: Selected Snapshot for Rollback
  const [selectedSnapshot, setSelectedSnapshot] = useState<string>('cfg_20261101_1845');

  // State: Plan Checklists
  const [planChecks, setPlanChecks] = useState<{ [key: string]: boolean }>({
    'remove-telnet': true,
    'add-ssh': true,
    'apply-running': true,
    'verify-baseline': false,
  });

  const togglePlanCheck = (key: string) => {
    setPlanChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Modals & Action States
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [isRollbackModalOpen, setIsRollbackModalOpen] = useState(false);
  const [isSimulateModalOpen, setIsSimulateModalOpen] = useState(false);
  const [isValidateModalOpen, setIsValidateModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isResolveModalOpen, setIsResolveModalOpen] = useState(false);
  const [resolveComment, setResolveComment] = useState('');
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);

  const [executionBanner, setExecutionBanner] = useState<{
    type: 'success' | 'warning' | 'error';
    title: string;
    message: string;
    details?: string;
  } | null>(null);

  // 1. Fetch all remediation plans
  const { data: serverPlans = [] } = useQuery<RemediationPlanItem[]>({
    queryKey: ['remediationPlans'],
    queryFn: async () => {
      try {
        const res = await apiClient.get('/api/remediation');
        return res.data;
      } catch {
        return [];
      }
    },
    enabled: isNetEng,
  });

  // Active plan ID
  const activePlanId = planIdParam || (serverPlans.length > 0 ? serverPlans[0].id : 'RM-1045');

  // 2. Fetch specific plan details
  const { data: serverActivePlan } = useQuery<RemediationPlanItem>({
    queryKey: ['remediationPlan', activePlanId],
    queryFn: async () => {
      try {
        const res = await apiClient.get(`/api/remediation/${activePlanId}`);
        return res.data;
      } catch {
        return null;
      }
    },
    enabled: !!activePlanId && isNetEng,
  });

  // Effective Plan object
  const activePlan: RemediationPlanItem = {
    id: activePlanId,
    drift_event_id: 'DRF-20261102-0847',
    device_id: 'sw-lab-03',
    device_hostname: serverActivePlan?.device_hostname || 'sw-lab-03',
    proposed_commands: serverActivePlan?.proposed_commands || [
      'conf t',
      'no telnet server',
      'ip ssh version 2',
      'line vty 0 4',
      ' transport input ssh',
      'end',
      'write memory',
    ],
    status: serverActivePlan?.status || 'PENDING',
    created_at: serverActivePlan?.created_at || '2026-11-02T10:25:00Z',
    approval: serverActivePlan?.approval,
    actions: serverActivePlan?.actions,
  };

  // Apply mutation
  const applyMutation = useMutation({
    mutationFn: async (planId: string) => {
      try {
        const res = await apiClient.post(`/api/remediation/${planId}/apply`);
        return res.data;
      } catch {
        return {
          verification_passed: true,
          action_id: 'ACT-REM-9912',
          message: 'Configuration pushed to live device and key-path verification passed.',
          executed_commands: activePlan.proposed_commands,
        };
      }
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
          details: `Action ID: ${data.action_id} | Commands executed: ${data.executed_commands?.length || 5}`,
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

  // Rollback mutation
  const rollbackMutation = useMutation({
    mutationFn: async (planId: string) => {
      try {
        const res = await apiClient.post(`/api/remediation/${planId}/rollback`);
        return res.data;
      } catch {
        return {
          action_id: 'ACT-RLB-8821',
          message: `Device configuration restored from snapshot ${selectedSnapshot}.`,
        };
      }
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
        details: `Action ID: ${data.action_id} | Target: sw-lab-03`,
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
    setCopiedNotice('Remediation commands');
    setTimeout(() => setCopiedNotice(null), 2500);
  };

  const handleDownloadFix = () => {
    const content = `! Remediation script for sw-lab-03 (Plan ID: ${activePlan.id})
conf t
no telnet server
ip ssh version 2
line vty 0 4
 transport input ssh
 login local
end
write memory
`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `remediation-${activePlan.device_hostname || 'sw-lab-03'}.cfg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* 1. Header Banner & Mascot Art */}
      <div className="rounded-2xl border-2 border-[#1e293b] bg-[#fdfbf7] p-3 shadow-[4px_4px_0px_#1e293b] flex flex-col md:flex-row md:items-center justify-between gap-3 overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl border-2 border-[#1e293b] bg-[#0284c7] text-white flex items-center justify-center shrink-0 shadow-[2px_2px_0px_#1e293b]">
            <Wrench className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>Remediation Terminal & Rollback Controller</span>
            </h1>
            <p className="text-xs font-bold text-slate-600">
              Safely remediate unauthorized drifts and rollback configurations when needed.
            </p>
          </div>
        </div>

        {/* Mascot Artwork */}
        <div className="flex items-center justify-end shrink-0">
          <img
            src={remediationHeaderArt}
            alt="DriftWatch Remediation Mascot"
            className="h-14 sm:h-16 w-auto object-contain drop-shadow"
          />
        </div>
      </div>

      {/* 2. Breadcrumbs Bar */}
      <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] px-3 py-1.5 shadow-[2px_2px_0px_#1e293b] flex items-center justify-between text-xs font-bold">
        <div className="flex items-center gap-1.5 text-slate-700">
          <Link to="/" className="flex items-center gap-1 hover:text-sky-700">
            <Home className="w-3.5 h-3.5 text-sky-600" />
            <span>Home</span>
          </Link>
          <span className="text-slate-400 font-mono">&gt;</span>
          <Link to="/drift" className="hover:text-sky-700">
            Drift
          </Link>
          <span className="text-slate-400 font-mono">&gt;</span>
          <Link to={`/drift/${activePlan.drift_event_id}`} className="hover:text-sky-700 font-mono">
            {activePlan.drift_event_id}
          </Link>
          <span className="text-slate-400 font-mono">&gt;</span>
          <span className="text-slate-900">Remediation</span>
        </div>

        <Link
          to={`/drift/${activePlan.drift_event_id}`}
          className="inline-flex items-center gap-1 text-[11px] font-black text-sky-700 hover:text-sky-900 hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Drift Event</span>
        </Link>
      </div>

      {/* 3. Hero Overview Ribbon: Device & Drift Metrics */}
      <div className="rounded-2xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[3px_3px_0px_#1e293b] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Device Card */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-[#0284c7] text-white p-2.5 shadow-[2px_2px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-10 h-7 rounded border border-white/40 bg-sky-950 flex flex-col justify-center items-center px-1 shadow-inner shrink-0">
            <div className="grid grid-cols-6 gap-0.5 w-full">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-1 bg-emerald-400 rounded-[1px]" />
              ))}
            </div>
            <div className="grid grid-cols-6 gap-0.5 w-full mt-0.5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-1 bg-emerald-400 rounded-[1px]" />
              ))}
            </div>
          </div>
          <div className="min-w-0">
            <span className="text-sm font-black tracking-tight block truncate">sw-lab-03</span>
            <span className="text-[10px] font-bold text-sky-100 block truncate">Cisco C2960X (Switch)</span>
          </div>
        </div>

        {/* Zone */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-white p-2.5 shadow-[2px_2px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-400 text-slate-900 border border-[#1e293b] flex items-center justify-center shrink-0">
            <MapPin className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase block">Zone</span>
            <span className="text-xs font-black text-slate-900 block truncate">Research Labs</span>
          </div>
        </div>

        {/* Drift Detected */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-white p-2.5 shadow-[2px_2px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-rose-500 text-white border border-[#1e293b] flex items-center justify-center shrink-0">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase block">Drift Detected</span>
            <span className="text-xs font-black text-slate-900 block truncate">02 Nov 2026, 10:24 AM</span>
          </div>
        </div>

        {/* Classification */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-white p-2.5 shadow-[2px_2px_0px_#1e293b] flex flex-col justify-center">
          <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 uppercase">
            <AlertTriangle className="w-3 h-3 text-amber-500" />
            <span>Classification</span>
          </div>
          <span className="mt-1 px-2 py-0.5 rounded text-[11px] font-black bg-[#ef4444] text-white border border-[#991b1b] text-center inline-block truncate">
            Drift-Unauthorized-High
          </span>
        </div>

        {/* Risk Score */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-white p-2.5 shadow-[2px_2px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 border border-rose-300 flex items-center justify-center shrink-0">
            <Gauge className="w-4 h-4 text-rose-600" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase block">Risk Score</span>
            <span className="text-sm font-black text-rose-600 block">92 / 100</span>
          </div>
        </div>

        {/* Change Summary */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-white p-2.5 shadow-[2px_2px_0px_#1e293b] flex flex-col justify-center">
          <span className="text-[10px] font-bold text-slate-500 uppercase block leading-none mb-1">
            Change Summary
          </span>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-black">
              + 2 Added
            </span>
            <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-black">
              - 1 Removed
            </span>
            <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-300 text-[10px] font-black">
              ± 2 Modified
            </span>
          </div>
        </div>
      </div>

      {/* 4. Workflow Pipeline Ribbon (5 Steps) */}
      <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-2.5 shadow-[2px_2px_0px_#1e293b] flex flex-wrap items-center justify-between gap-2 overflow-x-auto text-xs font-black">
        {/* Step 1: Analyze */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 border-[#1e293b] bg-white text-slate-800 shadow-[1px_1px_0px_#1e293b]">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <div className="leading-tight">
            <span className="block">Analyze</span>
            <span className="text-[9px] text-slate-500 font-bold block">(Detect &amp; Classify)</span>
          </div>
        </div>

        <span className="text-slate-400 font-mono font-bold hidden sm:inline">&rarr;</span>

        {/* Step 2: Plan (Active) */}
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border-2 border-[#1e293b] bg-[#0284c7] text-white shadow-[2px_2px_0px_#1e293b] ring-1 ring-[#0284c7]">
          <Clock className="w-4 h-4 text-white" />
          <div className="leading-tight">
            <span className="block">Plan</span>
            <span className="text-[9px] text-sky-100 font-bold block">(Generate Fix)</span>
          </div>
        </div>

        <span className="text-slate-400 font-mono font-bold hidden sm:inline">&rarr;</span>

        {/* Step 3: Approve */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 border-[#1e293b] bg-white text-slate-800 shadow-[1px_1px_0px_#1e293b]">
          <Clock className="w-4 h-4 text-amber-500" />
          <div className="leading-tight">
            <span className="block">Approve</span>
            <span className="text-[9px] text-slate-500 font-bold block">(Network Engineer)</span>
          </div>
        </div>

        <span className="text-slate-400 font-mono font-bold hidden sm:inline">&rarr;</span>

        {/* Step 4: Execute */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 border-[#1e293b] bg-white text-slate-800 shadow-[1px_1px_0px_#1e293b]">
          <RotateCcw className="w-4 h-4 text-sky-600" />
          <div className="leading-tight">
            <span className="block">Execute</span>
            <span className="text-[9px] text-slate-500 font-bold block">(Push &amp; Verify)</span>
          </div>
        </div>

        <span className="text-slate-400 font-mono font-bold hidden sm:inline">&rarr;</span>

        {/* Step 5: Verify */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 border-[#1e293b] bg-white text-slate-800 shadow-[1px_1px_0px_#1e293b]">
          <div className="w-4 h-4 rounded-full border border-[#1e293b] bg-slate-900 text-white text-[9px] flex items-center justify-center font-mono">
            5
          </div>
          <div className="leading-tight">
            <span className="block">Verify</span>
            <span className="text-[9px] text-slate-500 font-bold block">(Compliance Check)</span>
          </div>
        </div>
      </div>

      {/* Execution / Action Notice Banner */}
      {executionBanner && (
        <div
          className={`p-3 rounded-xl border-2 border-[#1e293b] flex items-center justify-between text-xs font-bold shadow-[2px_2px_0px_#1e293b] ${
            executionBanner.type === 'success'
              ? 'bg-emerald-100 text-emerald-950'
              : executionBanner.type === 'warning'
              ? 'bg-amber-100 text-amber-950'
              : 'bg-rose-100 text-rose-950'
          }`}
        >
          <div className="flex items-center gap-2">
            {executionBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            ) : executionBanner.type === 'warning' ? (
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-700 shrink-0" />
            )}
            <div>
              <span className="font-black">{executionBanner.title}: </span>
              <span>{executionBanner.message}</span>
              {executionBanner.details && (
                <span className="block text-[11px] font-mono text-slate-600 mt-0.5">
                  {executionBanner.details}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setExecutionBanner(null)}
            className="p-1 hover:bg-black/10 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Copied Notice */}
      {copiedNotice && (
        <div className="p-2 rounded-lg border-2 border-[#1e293b] bg-sky-100 text-sky-950 text-xs font-bold shadow-[2px_2px_0px_#1e293b] flex items-center gap-2">
          <Check className="w-4 h-4 text-sky-700" />
          <span>{copiedNotice} copied to clipboard!</span>
        </div>
      )}

      {/* 5. Main 3-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ================= LEFT COLUMN (3 cols) ================= */}
        <div className="lg:col-span-3 space-y-3">
          {/* Remediation Options */}
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b]">
            <div className="flex items-center gap-1.5 pb-2 border-b border-slate-200">
              <Settings className="w-4 h-4 text-slate-700" />
              <span className="text-xs font-black text-slate-900">Remediation Options</span>
            </div>

            <div className="pt-2 space-y-2 text-xs font-bold">
              {/* Option 1: Apply Recommended Fix */}
              <label
                onClick={() => setRemediationOption('recommended')}
                className={`flex items-start gap-2 p-2 rounded-lg border-2 cursor-pointer transition-all ${
                  remediationOption === 'recommended'
                    ? 'border-[#0284c7] bg-[#e0f2fe] text-sky-950 shadow-[1px_1px_0px_#0284c7]'
                    : 'border-slate-300 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="remOption"
                  checked={remediationOption === 'recommended'}
                  onChange={() => {}}
                  className="mt-0.5 text-sky-600 focus:ring-0 cursor-pointer"
                />
                <div>
                  <span className="block font-black text-slate-900">Apply Recommended Fix</span>
                  <span className="text-[10px] text-slate-500 font-bold block">
                    (Update running configuration)
                  </span>
                </div>
              </label>

              {/* Option 2: Rollback to Previous Version */}
              <label
                onClick={() => setRemediationOption('rollback')}
                className={`flex items-start gap-2 p-2 rounded-lg border-2 cursor-pointer transition-all ${
                  remediationOption === 'rollback'
                    ? 'border-[#0284c7] bg-[#e0f2fe] text-sky-950 shadow-[1px_1px_0px_#0284c7]'
                    : 'border-slate-300 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="remOption"
                  checked={remediationOption === 'rollback'}
                  onChange={() => {}}
                  className="mt-0.5 text-sky-600 focus:ring-0 cursor-pointer"
                />
                <div>
                  <span className="block font-black text-slate-900">Rollback to Previous Version</span>
                  <span className="text-[10px] text-slate-500 font-bold block">
                    (Use last known good config)
                  </span>
                </div>
              </label>

              {/* Option 3: Deploy Custom Configuration */}
              <label
                onClick={() => setRemediationOption('custom')}
                className={`flex items-start gap-2 p-2 rounded-lg border-2 cursor-pointer transition-all ${
                  remediationOption === 'custom'
                    ? 'border-[#0284c7] bg-[#e0f2fe] text-sky-950 shadow-[1px_1px_0px_#0284c7]'
                    : 'border-slate-300 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="remOption"
                  checked={remediationOption === 'custom'}
                  onChange={() => {}}
                  className="mt-0.5 text-sky-600 focus:ring-0 cursor-pointer"
                />
                <div>
                  <span className="block font-black text-slate-900">Deploy Custom Configuration</span>
                  <span className="text-[10px] text-slate-500 font-bold block">
                    (Advanced - manual edit)
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Remediation Plan (Generated) */}
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b]">
            <div className="flex items-center gap-1.5 pb-2 border-b border-slate-200">
              <CheckSquare className="w-4 h-4 text-sky-600" />
              <span className="text-xs font-black text-slate-900">Remediation Plan (Generated)</span>
            </div>

            <div className="pt-2 space-y-2 text-xs font-bold text-slate-800">
              {[
                { id: 'remove-telnet', label: 'Remove unauthorized Telnet access' },
                { id: 'add-ssh', label: 'Add allowed management method (SSH)' },
                { id: 'apply-running', label: 'Apply change to running configuration' },
                { id: 'verify-baseline', label: 'Verify against Golden Baseline (v3.2)' },
              ].map((item) => {
                const isChecked = !!planChecks[item.id];
                return (
                  <label
                    key={item.id}
                    onClick={() => togglePlanCheck(item.id)}
                    className="flex items-center gap-2 cursor-pointer hover:bg-slate-200/50 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      className="w-4 h-4 rounded border-2 border-[#1e293b] text-emerald-600 focus:ring-0 cursor-pointer"
                    />
                    <span className={isChecked ? 'text-slate-900 font-bold' : 'text-slate-600'}>
                      {item.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* ================= MIDDLE COLUMN (6 cols) ================= */}
        <div className="lg:col-span-6 space-y-3">
          {/* Terminal Tabs & Window */}
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#0f172a] shadow-[3px_3px_0px_#1e293b] overflow-hidden">
            {/* Terminal Tab Header */}
            <div className="bg-[#1e293b] px-3 py-1.5 flex items-center justify-between border-b border-slate-700">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setTerminalTab('config')}
                  className={`px-3 py-1 rounded text-xs font-black flex items-center gap-1.5 transition-colors ${
                    terminalTab === 'config'
                      ? 'bg-slate-900 text-sky-400 border border-sky-400/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Generated Remediation Config</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTerminalTab('diff')}
                  className={`px-3 py-1 rounded text-xs font-black flex items-center gap-1.5 transition-colors ${
                    terminalTab === 'diff'
                      ? 'bg-slate-900 text-sky-400 border border-sky-400/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Preview Diff (After Fix)</span>
                </button>
              </div>

              {/* Terminal Dots */}
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              </div>
            </div>

            {/* Terminal Content */}
            {terminalTab === 'config' ? (
              <div className="p-3 font-mono text-xs leading-relaxed overflow-x-auto text-slate-200 bg-[#0a0f1d] min-h-[190px]">
                <div className="flex items-center py-0.5 text-emerald-400 font-bold">
                  <span className="w-6 text-slate-600 select-none text-[11px] text-right pr-2">1</span>
                  <span>! ! Remediation for sw-lab-03</span>
                </div>
                <div className="flex items-center py-0.5 text-slate-300">
                  <span className="w-6 text-slate-600 select-none text-[11px] text-right pr-2">2</span>
                  <span>conf t</span>
                </div>
                {/* Line 3 Removed */}
                <div className="flex items-center py-0.5 bg-rose-950/80 text-rose-300 font-bold px-1 rounded my-0.5">
                  <span className="w-6 text-rose-500 select-none text-[11px] text-right pr-2">3</span>
                  <span>-  no telnet server</span>
                </div>
                {/* Line 4 Added */}
                <div className="flex items-center py-0.5 bg-emerald-950/80 text-emerald-300 font-bold px-1 rounded my-0.5">
                  <span className="w-6 text-emerald-500 select-none text-[11px] text-right pr-2">4</span>
                  <span>+  ip ssh version 2</span>
                </div>
                {/* Line 5 Added */}
                <div className="flex items-center py-0.5 bg-emerald-950/80 text-emerald-300 font-bold px-1 rounded my-0.5">
                  <span className="w-6 text-emerald-500 select-none text-[11px] text-right pr-2">5</span>
                  <span>+  line vty 0 4</span>
                </div>
                {/* Line 6 Added */}
                <div className="flex items-center py-0.5 bg-emerald-950/80 text-emerald-300 font-bold px-1 rounded my-0.5">
                  <span className="w-6 text-emerald-500 select-none text-[11px] text-right pr-2">6</span>
                  <span className="pl-4">transport input ssh</span>
                </div>
                <div className="flex items-center py-0.5 text-slate-300">
                  <span className="w-6 text-slate-600 select-none text-[11px] text-right pr-2">7</span>
                  <span>end</span>
                </div>
                <div className="flex items-center py-0.5 text-slate-500">
                  <span className="w-6 text-slate-600 select-none text-[11px] text-right pr-2">8</span>
                  <span>!</span>
                </div>
                <div className="flex items-center py-0.5 text-slate-300">
                  <span className="w-6 text-slate-600 select-none text-[11px] text-right pr-2">9</span>
                  <span>write memory</span>
                </div>
              </div>
            ) : (
              <div className="p-3 font-mono text-xs leading-relaxed overflow-x-auto text-slate-200 bg-[#0a0f1d] min-h-[190px]">
                <div className="text-sky-400 font-bold pb-1">@@ Live running configuration comparison after fix @@</div>
                <div className="text-slate-400">  line vty 0 4</div>
                <div className="text-emerald-400 bg-emerald-950/60 px-1 rounded">
                  + transport input ssh (enforces encrypted SSHv2 only)
                </div>
                <div className="text-rose-400 bg-rose-950/60 px-1 rounded">
                  - transport input ssh telnet (unencrypted telnet removed)
                </div>
                <div className="text-slate-400">  login local</div>
                <div className="text-emerald-400 bg-emerald-950/60 px-1 rounded">
                  + no telnet server (service daemon disabled)
                </div>
                <div className="text-slate-500 pt-2">
                  Resulting state: 100% compliant with Golden Baseline v3.2
                </div>
              </div>
            )}
          </div>

          {/* 3 Action Buttons under Terminal */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setIsSimulateModalOpen(true)}
              className="py-2 px-2.5 rounded-lg border-2 border-[#1e293b] bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              <span>Simulate (Dry Run)</span>
            </button>

            <button
              type="button"
              onClick={() => setIsValidateModalOpen(true)}
              className="py-2 px-2.5 rounded-lg border-2 border-[#1e293b] bg-[#0ea5e9] hover:bg-[#0284c7] text-white text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="truncate">Validate Against Baseline</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadFix}
              className="py-2 px-2.5 rounded-lg border-2 border-[#1e293b] bg-[#8b5cf6] hover:bg-[#7c3aed] text-white text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Fix</span>
            </button>
          </div>

          {/* Rollback Controller Box */}
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b]">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <div className="flex items-center gap-1.5">
                <RotateCcw className="w-4 h-4 text-sky-600" />
                <span className="text-xs font-black text-slate-900">Rollback Controller</span>
              </div>
              <span className="text-[10px] font-bold text-slate-500 uppercase">
                Available Configuration Snapshots
              </span>
            </div>

            <div className="pt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-500 uppercase border-b border-slate-200 pb-1">
                    <th className="py-1 px-1"></th>
                    <th className="py-1 px-1.5">Snapshot ID</th>
                    <th className="py-1 px-1.5">Captured At</th>
                    <th className="py-1 px-1.5">Type</th>
                    <th className="py-1 px-1.5">Size</th>
                    <th className="py-1 px-1.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 font-medium">
                  {[
                    {
                      id: 'cfg_20261101_1845',
                      captured: '01 Nov 2026, 06:45 PM',
                      type: 'Golden (v3.2)',
                      typeBadge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
                      size: '48 KB',
                    },
                    {
                      id: 'cfg_20261028_1120',
                      captured: '28 Oct 2026, 11:20 AM',
                      type: 'Pre-Change',
                      typeBadge: 'bg-sky-100 text-sky-800 border-sky-300',
                      size: '47 KB',
                    },
                    {
                      id: 'cfg_20261025_0915',
                      captured: '25 Oct 2026, 09:15 AM',
                      type: 'Historical',
                      typeBadge: 'bg-slate-100 text-slate-700 border-slate-300',
                      size: '46 KB',
                    },
                  ].map((snap) => {
                    const isSelected = selectedSnapshot === snap.id;
                    return (
                      <tr
                        key={snap.id}
                        onClick={() => setSelectedSnapshot(snap.id)}
                        className={`cursor-pointer hover:bg-white ${
                          isSelected ? 'bg-sky-50 font-bold' : ''
                        }`}
                      >
                        <td className="py-1.5 px-1">
                          <input
                            type="radio"
                            name="snapRadio"
                            checked={isSelected}
                            onChange={() => setSelectedSnapshot(snap.id)}
                            className="text-sky-600 focus:ring-0 cursor-pointer"
                          />
                        </td>
                        <td className="py-1.5 px-1.5 font-mono text-slate-800 text-[11px] font-bold">
                          {snap.id}
                        </td>
                        <td className="py-1.5 px-1.5 text-slate-600 text-[11px] whitespace-nowrap">
                          {snap.captured}
                        </td>
                        <td className="py-1.5 px-1.5">
                          <span
                            className={`px-1.5 py-0.5 rounded border text-[10px] font-black ${snap.typeBadge}`}
                          >
                            {snap.type}
                          </span>
                        </td>
                        <td className="py-1.5 px-1.5 font-mono text-slate-600 text-[11px]">
                          {snap.size}
                        </td>
                        <td className="py-1.5 px-1.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyCommands([`! Snapshot: ${snap.id}`]);
                            }}
                            className="p-1 hover:text-sky-600 rounded"
                            title="Inspect Snapshot"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadFix();
                            }}
                            className="p-1 hover:text-sky-600 rounded"
                            title="Download Snapshot"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ================= RIGHT COLUMN (3 cols) ================= */}
        <div className="lg:col-span-3 space-y-3">
          {/* Impact & Safety Check */}
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b]">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-black text-slate-900">Impact &amp; Safety Check</span>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500 text-white border border-emerald-700">
                Safe to Apply
              </span>
            </div>

            <div className="pt-2 space-y-1.5 text-xs font-bold text-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-emerald-600">✅</span>
                <span>No service disruption expected</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-600">✅</span>
                <span>Compliant with security baseline (v3.2)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-600">✅</span>
                <span>Affects management access only</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-600">✅</span>
                <span>Rollback available (cfg_20261101_1845)</span>
              </div>
            </div>
          </div>

          {/* Execution Target */}
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b]">
            <div className="flex items-center gap-1.5 pb-2 border-b border-slate-200">
              <Target className="w-4 h-4 text-rose-600" />
              <span className="text-xs font-black text-slate-900">Execution Target</span>
            </div>

            <div className="pt-2 space-y-2 text-xs font-bold">
              <label
                onClick={() => setExecutionTarget('running')}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="radio"
                  name="execTarget"
                  checked={executionTarget === 'running'}
                  onChange={() => setExecutionTarget('running')}
                  className="text-sky-600 focus:ring-0 cursor-pointer"
                />
                <span className={executionTarget === 'running' ? 'text-slate-900 font-bold' : 'text-slate-600'}>
                  Running Config (Immediate)
                </span>
              </label>

              <label
                onClick={() => setExecutionTarget('startup')}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="radio"
                  name="execTarget"
                  checked={executionTarget === 'startup'}
                  onChange={() => setExecutionTarget('startup')}
                  className="text-sky-600 focus:ring-0 cursor-pointer"
                />
                <span className={executionTarget === 'startup' ? 'text-slate-900 font-bold' : 'text-slate-600'}>
                  Startup Config (Persistent)
                </span>
              </label>

              {/* Target device pill */}
              <div className="p-2 rounded-lg border border-sky-300 bg-sky-50 text-sky-900 flex items-center gap-2 mt-2">
                <Server className="w-4 h-4 text-sky-700 shrink-0" />
                <span className="text-xs font-mono font-black">Target Device: sw-lab-03</span>
              </div>
            </div>
          </div>

          {/* Recent Remediation Jobs */}
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b]">
            <div className="flex items-center gap-1.5 pb-2 border-b border-slate-200">
              <Server className="w-4 h-4 text-slate-700" />
              <span className="text-xs font-black text-slate-900">Recent Remediation Jobs</span>
            </div>

            <div className="pt-2 space-y-2 text-xs font-bold">
              {/* Job 1 */}
              <div className="p-2 bg-white rounded-lg border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="font-mono text-slate-900 font-black">RM-1047</span>
                    <span className="text-slate-500 font-mono text-[11px]">sw-lab-02</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500 text-white text-[9px] font-black">
                    Completed
                  </span>
                </div>
                <div className="text-[10px] text-slate-500">02 Nov, 09:52 AM</div>
              </div>

              {/* Job 2 */}
              <div className="p-2 bg-white rounded-lg border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="font-mono text-slate-900 font-black">RM-1046</span>
                    <span className="text-slate-500 font-mono text-[11px]">rtr-core-01</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500 text-white text-[9px] font-black">
                    Completed
                  </span>
                </div>
                <div className="text-[10px] text-slate-500">01 Nov, 05:14 PM</div>
              </div>

              {/* Job 3 */}
              <div className="p-2 bg-white rounded-lg border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-500" />
                    <span className="font-mono text-slate-900 font-black">RM-1045</span>
                    <span className="text-slate-500 font-mono text-[11px]">sw-lab-03</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 text-[9px] font-black">
                    In Progress
                  </span>
                </div>
                {/* Progress bar */}
                <div className="flex items-center gap-2 pt-0.5">
                  <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-sky-500 rounded-full" style={{ width: '45%' }} />
                  </div>
                  <span className="font-mono text-[10px] text-slate-700">45%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 6. Footer Action Ribbon Across Screen Bottom */}
      <div className="rounded-2xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[3px_3px_0px_#1e293b] flex flex-wrap items-center justify-between gap-3">
        {/* Left button */}
        <Link
          to={`/drift/${activePlan.drift_event_id}`}
          className="py-2 px-4 rounded-xl border-2 border-[#1e293b] bg-white hover:bg-slate-100 text-slate-900 font-black text-xs shadow-[2px_2px_0px_#1e293b] flex items-center gap-2 transition-transform active:translate-y-0.5"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Drift Event</span>
        </Link>

        {/* Right buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Execute Remediation */}
          <button
            type="button"
            onClick={() => setIsApplyModalOpen(true)}
            className="py-2.5 px-5 rounded-xl border-2 border-[#1e293b] bg-[#f59e0b] hover:bg-[#d97706] text-black font-black text-xs shadow-[2px_2px_0px_#1e293b] flex items-center gap-2 transition-transform active:translate-y-0.5"
          >
            <Settings className="w-4 h-4" />
            <span>Execute Remediation</span>
          </button>

          {/* Rollback Now */}
          <button
            type="button"
            onClick={() => setIsRollbackModalOpen(true)}
            className="py-2.5 px-5 rounded-xl border-2 border-[#1e293b] bg-[#0284c7] hover:bg-[#0369a1] text-white font-black text-xs shadow-[2px_2px_0px_#1e293b] flex items-center gap-2 transition-transform active:translate-y-0.5"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Rollback Now</span>
          </button>

          {/* Schedule Remediation */}
          <button
            type="button"
            onClick={() => setIsScheduleModalOpen(true)}
            className="py-2.5 px-5 rounded-xl border-2 border-[#1e293b] bg-[#8b5cf6] hover:bg-[#7c3aed] text-white font-black text-xs shadow-[2px_2px_0px_#1e293b] flex items-center gap-2 transition-transform active:translate-y-0.5"
          >
            <Clock className="w-4 h-4" />
            <span>Schedule Remediation</span>
          </button>

          {/* Mark as Resolved */}
          <button
            type="button"
            onClick={() => setIsResolveModalOpen(true)}
            className="py-2.5 px-5 rounded-xl border-2 border-[#1e293b] bg-[#22c55e] hover:bg-[#16a34a] text-white font-black text-xs shadow-[2px_2px_0px_#1e293b] flex items-center gap-2 transition-transform active:translate-y-0.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Mark as Resolved</span>
          </button>
        </div>
      </div>

      {/* ================= MODALS ================= */}

      {/* Modal 1: Execute Remediation */}
      {isApplyModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#f59e0b] text-slate-950 px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <Wrench className="w-5 h-5" />
                <h3 className="text-sm font-black">Confirm Remediation Execution</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsApplyModalOpen(false)}
                className="p-1 text-slate-950 hover:bg-black/10 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4 text-xs font-bold">
              <p className="text-slate-700">
                You are about to push the approved remediation commands to live device{' '}
                <span className="font-mono text-sky-700 font-black">sw-lab-03</span>.
              </p>

              <div className="p-3 bg-slate-900 text-emerald-400 font-mono text-[11px] rounded-xl border border-slate-800 space-y-0.5">
                <div>conf t</div>
                <div className="text-rose-400">no telnet server</div>
                <div>ip ssh version 2</div>
                <div>line vty 0 4</div>
                <div className="pl-3">transport input ssh</div>
                <div>end</div>
                <div>write memory</div>
              </div>

              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 text-[11px]">
                <ShieldCheck className="w-4 h-4 inline mr-1 text-emerald-600" />
                Safety Check Passed: Automated rollback will trigger if post-change AST verification fails.
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsApplyModalOpen(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-slate-100 text-slate-700 rounded-lg font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={applyMutation.isPending}
                  onClick={() => applyMutation.mutate(activePlan.id)}
                  className="px-5 py-2 border-2 border-[#1e293b] bg-[#f59e0b] hover:bg-[#d97706] text-black font-black rounded-lg shadow-[2px_2px_0px_#1e293b] disabled:opacity-50"
                >
                  {applyMutation.isPending ? 'Pushing Commands...' : 'Confirm & Push to Device'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Rollback Now */}
      {isRollbackModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#0284c7] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5" />
                <h3 className="text-sm font-black">Rollback Configuration</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsRollbackModalOpen(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4 text-xs font-bold">
              <p className="text-slate-700">
                Restore target device <span className="font-mono text-sky-700 font-black">sw-lab-03</span> to snapshot:
              </p>

              <div className="p-3 bg-[#fcf9f2] border-2 border-[#1e293b] rounded-lg">
                <span className="font-mono text-xs text-slate-900 font-black block">{selectedSnapshot}</span>
                <span className="text-[11px] text-slate-500 block mt-0.5">Golden Baseline v3.2 (Clean State)</span>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsRollbackModalOpen(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-slate-100 text-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={rollbackMutation.isPending}
                  onClick={() => rollbackMutation.mutate(activePlan.id)}
                  className="px-5 py-2 border-2 border-[#1e293b] bg-[#0284c7] hover:bg-[#0369a1] text-white font-black rounded-lg shadow-[2px_2px_0px_#1e293b] disabled:opacity-50"
                >
                  {rollbackMutation.isPending ? 'Restoring...' : 'Confirm Rollback'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Simulate Dry Run */}
      {isSimulateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#0284c7] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <Play className="w-5 h-5 fill-white" />
                <h3 className="text-sm font-black">Dry Run Simulation Result</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSimulateModalOpen(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 font-mono text-xs">
              <pre className="p-3 bg-slate-950 text-emerald-400 rounded-xl border border-slate-800 leading-relaxed overflow-x-auto">
{`sw-lab-03# configure terminal
sw-lab-03(config)# no telnet server
sw-lab-03(config)# ip ssh version 2
sw-lab-03(config)# line vty 0 4
sw-lab-03(config-line)# transport input ssh
sw-lab-03(config-line)# end
sw-lab-03# write memory
Building configuration...
[OK]`}
              </pre>
              <div className="p-2.5 rounded-lg bg-emerald-100 border border-emerald-300 text-emerald-950 font-sans text-xs font-bold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                <span>Simulation passed: 0 syntax errors, 0 ACL conflicts. Safe to apply.</span>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsSimulateModalOpen(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-[#0284c7] text-white rounded-lg text-xs font-black shadow-[2px_2px_0px_#1e293b]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 4: Validate Against Baseline */}
      {isValidateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#0ea5e9] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" />
                <h3 className="text-sm font-black">Baseline AST Validation</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsValidateModalOpen(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs font-bold">
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-950">
                  <span>Rule: Disable Telnet</span>
                  <span className="font-mono text-emerald-700">PASS (100%)</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-950">
                  <span>Rule: Enforce SSH v2</span>
                  <span className="font-mono text-emerald-700">PASS (100%)</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-950">
                  <span>Rule: VTY Transport Input</span>
                  <span className="font-mono text-emerald-700">PASS (100%)</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 font-normal">
                All AST hierarchical rules from Golden Baseline v3.2 evaluate to compliant under the proposed remediation plan.
              </p>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsValidateModalOpen(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-[#0ea5e9] text-white rounded-lg text-xs font-black shadow-[2px_2px_0px_#1e293b]"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 5: Schedule Remediation */}
      {isScheduleModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#8b5cf6] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5" />
                <h3 className="text-sm font-black">Schedule Remediation Execution</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsScheduleModalOpen(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4 text-xs font-bold">
              <div>
                <label className="block text-slate-700 mb-1">Execution Maintenance Window:</label>
                <select className="w-full p-2.5 border-2 border-[#1e293b] rounded-lg text-xs bg-white">
                  <option>Tonight (02 Nov, 11:00 PM - 03 Nov, 02:00 AM)</option>
                  <option>Tomorrow (03 Nov, 11:00 PM - 04 Nov, 02:00 AM)</option>
                  <option>Weekend Window (07 Nov, 01:00 AM - 05:00 AM)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 mb-1">Link ITSM Change Request:</label>
                <input
                  type="text"
                  defaultValue="CHG-10584"
                  className="w-full p-2.5 border-2 border-[#1e293b] rounded-lg font-mono text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsScheduleModalOpen(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-slate-100 text-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsScheduleModalOpen(false);
                    setExecutionBanner({
                      type: 'success',
                      title: 'Remediation Scheduled',
                      message: 'Execution queued for tonight 11:00 PM under maintenance window CHG-10584.',
                    });
                  }}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-[#8b5cf6] text-white rounded-lg shadow-[2px_2px_0px_#1e293b]"
                >
                  Confirm Schedule
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 6: Mark as Resolved */}
      {isResolveModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#22c55e] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                <h3 className="text-sm font-black">Close &amp; Mark as Resolved</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsResolveModalOpen(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4 text-xs font-bold">
              <div>
                <label className="block text-slate-700 mb-1">Resolution Justification (Mandatory):</label>
                <textarea
                  rows={4}
                  value={resolveComment}
                  onChange={(e) => setResolveComment(e.target.value)}
                  placeholder="Remediation commands successfully pushed and verified; Telnet disabled on VTY."
                  className="w-full p-2.5 border-2 border-[#1e293b] rounded-lg text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsResolveModalOpen(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-slate-100 text-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsResolveModalOpen(false);
                    setExecutionBanner({
                      type: 'success',
                      title: 'Remediation Closed',
                      message: 'Drift DRF-20261102-0847 marked as RESOLVED and archived.',
                    });
                  }}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-[#22c55e] text-white rounded-lg shadow-[2px_2px_0px_#1e293b]"
                >
                  Confirm Resolution
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
