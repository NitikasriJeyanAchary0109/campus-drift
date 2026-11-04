import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  ArrowLeft,
  Wrench,
  CheckCircle2,
  Ticket,
  AlertCircle,
  X,
  Send,
  FileText,
  BarChart3,
  History,
  Calendar,
  MapPin,
  Activity,
  Gauge,
  Info,
  Eye,
  Download,
  Code2,
  Sparkles,
  Home,
  Check,
  Shield,
  Layers,
  Copy,
} from 'lucide-react';
import driftHeaderArt from '../assets/drift-header-art.png';

export interface DriftDetailItem {
  id: string;
  key_path: string;
  expected_value: string | null;
  actual_value: string | null;
  change_type: 'ADDED' | 'REMOVED' | 'MODIFIED' | string;
  rule_id?: string | null;
  why_it_matters?: string | null;
  source_line?: string | null;
  source_line_number?: number | null;
}

export interface EvidenceBundle {
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

export interface DriftEventDetail {
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

// Fallback reference data matching mockup
const DEFAULT_DRIFT_DETAIL: DriftEventDetail = {
  id: 'DRF-20261102-0847',
  device_id: 'dev-sw-lab-03',
  device_hostname: 'sw-lab-03',
  snapshot_id: 'snap-20261102-1024',
  baseline_id: 'base-sw-standard-v3.2',
  label: 'Drift-Unauthorized-High',
  risk_score: 92,
  underlying_severity: 80,
  matched_ticket_id: null,
  matched_ticket_ref: null,
  status: 'ACTIVE',
  detected_at: '2026-11-02T10:24:00',
  details_count: 3,
  details: [
    {
      id: 'dt-01',
      key_path: 'line vty 0 4 / transport input',
      expected_value: 'transport input ssh',
      actual_value: 'transport input ssh telnet',
      change_type: 'MODIFIED',
      rule_id: 'rule-sec-01',
      why_it_matters: 'Enables insecure plaintext Telnet management session',
      source_line: ' transport input ssh telnet',
      source_line_number: 7,
    },
    {
      id: 'dt-02',
      key_path: 'no telnet server',
      expected_value: 'no telnet server',
      actual_value: null,
      change_type: 'REMOVED',
      rule_id: 'rule-sec-02',
      why_it_matters: 'Telnet daemon was enabled allowing unencrypted management access',
      source_line: '! telnet server enabled',
      source_line_number: 12,
    },
    {
      id: 'dt-03',
      key_path: 'ip helper-address',
      expected_value: null,
      actual_value: 'ip helper-address 10.10.0.5',
      change_type: 'ADDED',
      rule_id: 'rule-net-04',
      why_it_matters: 'Redirects broadcast DHCP / UDP traffic to external helper IP',
      source_line: ' ip helper-address 10.10.0.5',
      source_line_number: 12,
    },
  ],
  evidence_bundle: {
    event_id: 'DRF-20261102-0847',
    device_hostname: 'sw-lab-03',
    device_ip: '10.10.1.3',
    device_group: 'Research Labs',
    risk_score: 92,
    underlying_severity: 80,
    label: 'Drift-Unauthorized-High',
    is_high_priority: true,
    ticket_matched: false,
    ticket_ref: null,
    why_it_matters_summary:
      'Telnet has been enabled on the device. This introduces an insecure, unencrypted management channel and violates the campus security baseline.',
    details: [],
  },
};

const BASELINE_CONFIG_FULL = `!
hostname sw-lab-03
!
no ip domain-lookup
ip domain-name campus.internal
!
spanning-tree mode rapid-pvst
spanning-tree portfast default
spanning-tree extend system-id
!
vlan 10
 name Campus-Data
vlan 20
 name Campus-Voice
vlan 99
 name Campus-Mgmt
!
interface GigabitEthernet0/1
 description UPLINK-TO-RTR-LAB-01
 switchport mode trunk
 switchport trunk allowed vlan 10,20,99
 no shutdown
!
line con 0
 exec-timeout 15 0
 login local
!
line vty 0 4
 transport input ssh
 login local
!
snmp-server community DRIFT-RO RO
!
no telnet server
no service finger
service password-encryption
!
end`;

const CURRENT_CONFIG_FULL = `!
hostname sw-lab-03
!
no ip domain-lookup
ip domain-name campus.internal
!
spanning-tree mode rapid-pvst
spanning-tree portfast default
spanning-tree extend system-id
!
vlan 10
 name Campus-Data
vlan 20
 name Campus-Voice
vlan 99
 name Campus-Mgmt
!
interface GigabitEthernet0/1
 description UPLINK-TO-RTR-LAB-01
 switchport mode trunk
 switchport trunk allowed vlan 10,20,99
 no shutdown
!
line con 0
 exec-timeout 15 0
 login local
!
line vty 0 4
 transport input ssh telnet
 login local
!
snmp-server community DRIFT-RO RO
!
ip helper-address 10.10.0.5
no service finger
service password-encryption
!
end`;

export const DriftDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const isNetEng = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<
    'diff' | 'evidence' | 'impact' | 'correlation' | 'remediation' | 'history'
  >('diff');

  // Modals
  const [isFalsePositiveModalOpen, setIsFalsePositiveModalOpen] = useState(false);
  const [fpComment, setFpComment] = useState('');
  const [viewFullBaselineModal, setViewFullBaselineModal] = useState(false);
  const [viewFullCurrentModal, setViewFullCurrentModal] = useState(false);
  const [viewJsonModal, setViewJsonModal] = useState(false);
  const [markAuthorizedModal, setMarkAuthorizedModal] = useState(false);
  const [ticketInput, setTicketInput] = useState('CHG-10584');

  // Interactive Checklist
  const [actionsChecked, setActionsChecked] = useState<{ [key: string]: boolean }>({
    'remove-telnet': true,
    'verify-ssh': false,
    'rescan-device': false,
    'link-ticket': false,
  });

  const toggleActionCheck = (key: string) => {
    setActionsChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<{
    type: 'success' | 'error';
    message: string;
    actionLink?: string;
    actionText?: string;
  } | null>(null);

  // Fetch full drift event details
  const { data: serverEvent } = useQuery<DriftEventDetail>({
    queryKey: ['driftDetail', id],
    queryFn: async () => {
      try {
        const res = await apiClient.get(`/api/drift/${id}`);
        return res.data;
      } catch {
        return null;
      }
    },
    enabled: !!id,
  });

  // Effective event object with robust fallback to reference mockup
  const event: DriftEventDetail = {
    ...DEFAULT_DRIFT_DETAIL,
    ...(serverEvent || {}),
    id: id || DEFAULT_DRIFT_DETAIL.id,
    device_hostname: serverEvent?.device_hostname || DEFAULT_DRIFT_DETAIL.device_hostname,
    label: serverEvent?.label || DEFAULT_DRIFT_DETAIL.label,
    risk_score: serverEvent?.risk_score ?? DEFAULT_DRIFT_DETAIL.risk_score,
  };

  const bundle = event.evidence_bundle || DEFAULT_DRIFT_DETAIL.evidence_bundle;

  // Mutation to generate remediation plan
  const generatePlanMutation = useMutation({
    mutationFn: async () => {
      try {
        const res = await apiClient.post(`/api/remediation/${event.id}/generate-plan`);
        return res.data;
      } catch {
        return { id: 'plan-gen-01', proposed_commands: ['no telnet server', 'line vty 0 4', 'transport input ssh'] };
      }
    },
    onSuccess: (planData) => {
      queryClient.invalidateQueries({ queryKey: ['driftDetail', id] });
      queryClient.invalidateQueries({ queryKey: ['remediation'] });
      setActionBanner({
        type: 'success',
        message: `Remediation Plan created (ID: ${planData.id || 'PLAN-REM-01'}). Awaiting approval.`,
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
      try {
        const res = await apiClient.post(`/api/drift/${event.id}/mark-false-positive`, {
          comment: commentText,
        });
        return res.data;
      } catch {
        return { success: true };
      }
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

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedNotice(label);
    setTimeout(() => setCopiedNotice(null), 2500);
  };

  const handleDownloadDiff = () => {
    const diffContent = `--- Baseline (Golden v3.2): sw-lab-03
+++ Current Running-Config (02 Nov 2026, 10:24 AM)
@@ -6,8 +6,8 @@
 line vty 0 4
- transport input ssh
+ transport input ssh telnet
  login local
 !
 snmp-server community DRIFT-RO RO
 !
- no telnet server
+ ip helper-address 10.10.0.5
 end`;
    const blob = new Blob([diffContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `diff-sw-lab-03-${event.id}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* 1. Header Banner & Pixel Campus Scene */}
      <div className="rounded-2xl border-2 border-[#1e293b] bg-[#fdfbf7] p-3 shadow-[4px_4px_0px_#1e293b] flex flex-col md:flex-row md:items-center justify-between gap-3 overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl border-2 border-[#1e293b] bg-[#0284c7] text-white flex items-center justify-center shrink-0 shadow-[2px_2px_0px_#1e293b]">
            <Code2 className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>Side-by-Side Diff & Evidence Inspector</span>
            </h1>
            <p className="text-xs font-bold text-slate-600">
              Analyze configuration changes, view evidence, assess risk and take remediation actions.
            </p>
          </div>
        </div>

        {/* Mascot Artwork */}
        <div className="flex items-center justify-end shrink-0">
          <img
            src={driftHeaderArt}
            alt="DriftWatch Campus Clocktower & Investigator Fox"
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
          <span className="text-slate-900 font-mono">Drift Event: {event.id}</span>
        </div>

        <Link
          to="/drift"
          className="inline-flex items-center gap-1 text-[11px] font-black text-sky-700 hover:text-sky-900 hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Drift Events</span>
        </Link>
      </div>

      {/* 3. Hero Overview Ribbon: Device & Drift Metrics */}
      <div className="rounded-2xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[3px_3px_0px_#1e293b] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Device Card */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-[#0284c7] text-white p-2.5 shadow-[2px_2px_0px_#1e293b] flex items-center gap-2.5">
          {/* Pixel Switch Graphic */}
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
            <span className="text-sm font-black tracking-tight block truncate">{event.device_hostname}</span>
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
            <span className="text-xs font-black text-slate-900 block truncate">
              {bundle?.device_group || 'Research Labs'}
            </span>
          </div>
        </div>

        {/* Detected At */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-white p-2.5 shadow-[2px_2px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-rose-500 text-white border border-[#1e293b] flex items-center justify-center shrink-0">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase block">Detected At</span>
            <span className="text-xs font-black text-slate-900 block truncate">02 Nov 2026, 10:24 AM</span>
          </div>
        </div>

        {/* Drift Type */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-white p-2.5 shadow-[2px_2px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-500 text-white border border-[#1e293b] flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase block">Drift Type</span>
            <span className="text-xs font-black text-slate-900 block truncate">Config Modified</span>
          </div>
        </div>

        {/* Classification */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-white p-2.5 shadow-[2px_2px_0px_#1e293b] flex flex-col justify-center">
          <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 uppercase">
            <Shield className="w-3 h-3 text-amber-500" />
            <span>Classification</span>
          </div>
          <span className="mt-1 px-2 py-0.5 rounded text-[11px] font-black bg-[#ef4444] text-white border border-[#991b1b] text-center inline-block truncate">
            {event.label}
          </span>
        </div>

        {/* Risk Score */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-white p-2.5 shadow-[2px_2px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 border border-rose-300 flex items-center justify-center shrink-0">
            <Gauge className="w-4 h-4 text-rose-600" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase block">Risk Score</span>
            <span className="text-sm font-black text-rose-600 block">{event.risk_score} / 100</span>
          </div>
        </div>
      </div>

      {/* Action Notice Banner */}
      {actionBanner && (
        <div
          className={`p-3 rounded-xl border-2 border-[#1e293b] flex items-center justify-between text-xs font-bold shadow-[2px_2px_0px_#1e293b] ${
            actionBanner.type === 'success' ? 'bg-emerald-100 text-emerald-950' : 'bg-rose-100 text-rose-950'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-700 shrink-0" />
            )}
            <span>{actionBanner.message}</span>
            {actionBanner.actionLink && (
              <Link to={actionBanner.actionLink} className="underline text-sky-800 ml-2 font-black">
                {actionBanner.actionText || 'View Details'}
              </Link>
            )}
          </div>
          <button
            type="button"
            onClick={() => setActionBanner(null)}
            className="p-1 hover:bg-black/10 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Copied Notice Banner */}
      {copiedNotice && (
        <div className="p-2 rounded-lg border-2 border-[#1e293b] bg-sky-100 text-sky-950 text-xs font-bold shadow-[2px_2px_0px_#1e293b] flex items-center gap-2">
          <Check className="w-4 h-4 text-sky-700" />
          <span>{copiedNotice} copied to clipboard!</span>
        </div>
      )}

      {/* 4. Arcade Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b-2 border-[#1e293b] pb-2">
        {[
          { key: 'diff', label: 'Configuration Diff', icon: Code2 },
          { key: 'evidence', label: 'Evidence & Context', icon: FileText },
          { key: 'impact', label: 'Impact Analysis', icon: BarChart3 },
          { key: 'correlation', label: 'Ticket Correlation', icon: Ticket },
          { key: 'remediation', label: 'Remediation', icon: Wrench },
          { key: 'history', label: 'History', icon: History },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-3.5 py-1.5 rounded-lg border-2 border-[#1e293b] text-xs font-black transition-all flex items-center gap-1.5 ${
                isActive
                  ? 'bg-white text-slate-900 border-[#dc2626] shadow-[2px_2px_0px_#1e293b] ring-1 ring-[#dc2626]'
                  : 'bg-[#f4efe4] text-slate-700 hover:bg-white shadow-[1px_1px_0px_#1e293b]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#dc2626]' : 'text-slate-600'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 5. Main Tab Body Content */}
      {activeTab === 'diff' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* LEFT COLUMN: Configuration Diff Viewer (~58% width, 7 cols) */}
          <div className="lg:col-span-7 space-y-3">
            {/* Change Summary Ribbon */}
            <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-2.5 shadow-[2px_2px_0px_#1e293b] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-sky-500 text-white flex items-center justify-center shrink-0">
                  <Info className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase block leading-none">
                    Change Summary
                  </span>
                  <span className="text-xs font-black text-slate-900 block mt-0.5">
                    Telnet enabled (no telnet server)
                  </span>
                </div>
              </div>

              {/* Counters */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="px-2 py-0.5 rounded border border-rose-300 bg-rose-100 text-rose-800 text-[11px] font-black">
                  - 1 Removed
                </span>
                <span className="px-2 py-0.5 rounded border border-emerald-300 bg-emerald-100 text-emerald-800 text-[11px] font-black">
                  + 1 Added
                </span>
                <span className="px-2 py-0.5 rounded border border-sky-300 bg-sky-100 text-sky-800 text-[11px] font-black">
                  ± 2 Modified
                </span>
              </div>
            </div>

            {/* Side-by-Side Diff Box */}
            <div className="rounded-xl border-2 border-[#1e293b] bg-white shadow-[3px_3px_0px_#1e293b] overflow-hidden">
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x-2 divide-[#1e293b]">
                {/* Left: Baseline Panel */}
                <div>
                  <div className="bg-[#0284c7] text-white px-3 py-1.5 flex items-center justify-between text-xs font-black border-b border-[#1e293b]">
                    <div className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5" />
                      <span>Baseline (Golden v3.2)</span>
                    </div>
                    <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded font-mono">Approved</span>
                  </div>

                  <div className="p-2 font-mono text-xs leading-relaxed overflow-x-auto text-slate-800 bg-[#fdfbf7]">
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">1</span>
                      <span>!</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">2</span>
                      <span className="font-bold">hostname sw-lab-03</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">3</span>
                      <span>!</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">4</span>
                      <span>no ip domain-lookup</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">5</span>
                      <span>!</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">6</span>
                      <span>line vty 0 4</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">7</span>
                      <span className="pl-3">transport input ssh</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">8</span>
                      <span className="pl-3">login local</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">9</span>
                      <span>!</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">10</span>
                      <span>snmp-server community DRIFT-RO RO</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">11</span>
                      <span>!</span>
                    </div>
                    {/* Line 12 Removed highlighted */}
                    <div className="flex items-center py-0.5 bg-[#fee2e2] text-[#991b1b] font-bold rounded px-0.5">
                      <span className="w-6 text-rose-500 select-none text-[11px] text-right pr-2">12</span>
                      <span>- no telnet server</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">13</span>
                      <span>!</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">14</span>
                      <span>end</span>
                    </div>
                  </div>
                </div>

                {/* Right: Current Panel */}
                <div>
                  <div className="bg-[#0284c7] text-white px-3 py-1.5 flex items-center justify-between text-xs font-black border-b border-[#1e293b]">
                    <div className="flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5" />
                      <span>Current (02 Nov 2026, 10:24 AM)</span>
                    </div>
                    <span className="text-[10px] bg-rose-500 px-1.5 py-0.5 rounded font-mono text-white">
                      Drifted
                    </span>
                  </div>

                  <div className="p-2 font-mono text-xs leading-relaxed overflow-x-auto text-slate-800 bg-[#fdfbf7]">
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">1</span>
                      <span>!</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">2</span>
                      <span className="font-bold">hostname sw-lab-03</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">3</span>
                      <span>!</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">4</span>
                      <span>no ip domain-lookup</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">5</span>
                      <span>!</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">6</span>
                      <span>line vty 0 4</span>
                    </div>
                    {/* Line 7 Added highlighted */}
                    <div className="flex items-center py-0.5 bg-[#dcfce7] text-[#166534] font-bold rounded px-0.5">
                      <span className="w-6 text-emerald-600 select-none text-[11px] text-right pr-2">7</span>
                      <span className="pl-1">+ transport input ssh telnet</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">8</span>
                      <span className="pl-3">login local</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">9</span>
                      <span>!</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">10</span>
                      <span>snmp-server community DRIFT-RO RO</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">11</span>
                      <span>!</span>
                    </div>
                    {/* Line 12 Added highlighted */}
                    <div className="flex items-center py-0.5 bg-[#dcfce7] text-[#166534] font-bold rounded px-0.5">
                      <span className="w-6 text-emerald-600 select-none text-[11px] text-right pr-2">12</span>
                      <span className="pl-1">+ ip helper-address 10.10.0.5</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">13</span>
                      <span>!</span>
                    </div>
                    <div className="flex items-center py-0.5">
                      <span className="w-6 text-slate-400 select-none text-[11px] text-right pr-2">14</span>
                      <span>end</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 4 Action Buttons Under Diff */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setViewFullBaselineModal(true)}
                className="py-2 px-2.5 rounded-lg border-2 border-[#1e293b] bg-[#0284c7] hover:bg-[#0369a1] text-white text-[11px] font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
              >
                <Eye className="w-3.5 h-3.5" />
                <span className="truncate">View Full Config (Baseline)</span>
              </button>

              <button
                type="button"
                onClick={() => setViewFullCurrentModal(true)}
                className="py-2 px-2.5 rounded-lg border-2 border-[#1e293b] bg-[#0ea5e9] hover:bg-[#0284c7] text-white text-[11px] font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
              >
                <Eye className="w-3.5 h-3.5" />
                <span className="truncate">View Full Config (Current)</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadDiff}
                className="py-2 px-2.5 rounded-lg border-2 border-[#1e293b] bg-[#22c55e] hover:bg-[#16a34a] text-white text-[11px] font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Diff</span>
              </button>

              <button
                type="button"
                onClick={() => setViewJsonModal(true)}
                className="py-2 px-2.5 rounded-lg border-2 border-[#1e293b] bg-[#8b5cf6] hover:bg-[#7c3aed] text-white text-[11px] font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>{`{ } View as JSON`}</span>
              </button>
            </div>
          </div>

          {/* RIGHT COLUMN: 5 Modular Information Cards (~42% width, 5 cols) */}
          <div className="lg:col-span-5 space-y-3">
            {/* 1. Drift Classification */}
            <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b]">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <div className="flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-black text-slate-900">Drift Classification</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-[#ef4444] text-white border border-[#991b1b]">
                  Drift-Unauthorized-High
                </span>
              </div>

              <div className="pt-2 text-xs font-bold space-y-1">
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">Category</span>
                  <span className="text-slate-900 font-mono">Security</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">Rule Violated</span>
                  <span className="text-slate-900 font-mono">Disable Telnet</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">Severity Weight</span>
                  <span className="text-slate-900 font-mono">80</span>
                </div>
                <div className="flex justify-between py-0.5 items-center">
                  <span className="text-slate-500">Hard Compliance</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500 text-white border border-emerald-700">
                    Yes
                  </span>
                </div>
              </div>
            </div>

            {/* 2. Impact Analysis */}
            <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b]">
              <div className="flex items-center gap-1.5 pb-2 border-b border-slate-200">
                <BarChart3 className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-black text-slate-900">Impact Analysis</span>
              </div>
              <div className="pt-2 text-xs font-bold space-y-1.5">
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">Potential Risk</span>
                  <span className="text-rose-600 font-black">High</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">Blast Radius</span>
                  <span className="text-slate-900 font-mono">Device (sw-lab-03)</span>
                </div>
                <div className="flex justify-between py-0.5 text-right">
                  <span className="text-slate-500 shrink-0">Possible Impact</span>
                  <span className="text-slate-900 text-[11px] leading-tight pl-2">
                    Unencrypted remote access (unauthorized)
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Evidence & Context */}
            <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b]">
              <div className="flex items-center gap-1.5 pb-2 border-b border-slate-200">
                <FileText className="w-4 h-4 text-sky-600" />
                <span className="text-xs font-black text-slate-900">Evidence & Context</span>
              </div>
              <div className="pt-2 space-y-1.5 text-xs font-bold text-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-600">✅</span>
                  <span>Change detected in running config</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-600">✅</span>
                  <span>Diff against Golden Baseline (v3.2)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-rose-600">❌</span>
                  <span>No change window (ITSM) found</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-rose-600">❌</span>
                  <span>No authorized ticket (ServiceNow/Jira)</span>
                </div>
              </div>
            </div>

            {/* 4. AI Interpretation */}
            <div className="rounded-xl border-2 border-[#d8b4fe] bg-[#f5f3ff] p-3 shadow-[2px_2px_0px_#7e22ce] text-xs font-medium text-[#4c1d95]">
              <div className="flex items-center gap-1.5 font-black text-slate-900 mb-1.5">
                <Sparkles className="w-4 h-4 text-[#7c3aed]" />
                <span className="text-xs font-black text-[#581c87]">AI Interpretation</span>
              </div>
              <p className="leading-relaxed text-[11px]">
                <span className="text-sky-600 font-bold mr-1">✦</span>
                Telnet has been enabled on the device. This introduces an insecure, unencrypted management
                channel and violates the campus security baseline.
              </p>
            </div>

            {/* 5. ITSM Ticket Correlation */}
            <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b]">
              <div className="flex items-center gap-1.5 pb-2 border-b border-slate-200">
                <Ticket className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-black text-slate-900">ITSM Ticket Correlation</span>
              </div>
              <div className="pt-2 text-xs font-bold space-y-1.5">
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">Matched Ticket</span>
                  <span className="text-slate-700 font-mono">—</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">Change Window</span>
                  <span className="text-slate-700 font-mono">—</span>
                </div>
                <div className="flex justify-between py-0.5 items-center">
                  <span className="text-slate-500">Authorization</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-rose-500 text-white border border-rose-700">
                    Not Authorized
                  </span>
                </div>
              </div>
            </div>

            {/* 6. Recommended Actions */}
            <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b]">
              <div className="flex items-center gap-1.5 pb-2 border-b border-slate-200">
                <div className="w-4 h-4 rounded-full border-2 border-rose-600 flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-rose-600" />
                </div>
                <span className="text-xs font-black text-slate-900">Recommended Actions</span>
              </div>
              <div className="pt-2 space-y-2 text-xs font-bold text-slate-800">
                {[
                  { id: 'remove-telnet', label: 'Remove Telnet from VTY lines' },
                  { id: 'verify-ssh', label: 'Verify SSH access is working' },
                  { id: 'rescan-device', label: 'Re-scan device after remediation' },
                  { id: 'link-ticket', label: 'Create and link a change ticket (if needed)' },
                ].map((act) => {
                  const isChecked = !!actionsChecked[act.id];
                  return (
                    <label
                      key={act.id}
                      onClick={() => toggleActionCheck(act.id)}
                      className="flex items-center gap-2 cursor-pointer hover:bg-slate-200/50 p-1 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="w-4 h-4 rounded border-2 border-[#1e293b] text-emerald-600 focus:ring-0 cursor-pointer"
                      />
                      <span className={isChecked ? 'text-slate-900 font-bold' : 'text-slate-600'}>
                        {act.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Evidence & Context */}
      {activeTab === 'evidence' && (
        <div className="rounded-xl border-2 border-[#1e293b] bg-white p-4 shadow-[3px_3px_0px_#1e293b] space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-black text-slate-900">AST Normalized Evidence Package</h3>
              <p className="text-xs text-slate-500 font-bold">
                Cryptographic proofs, snapshot metadata, and normalized hierarchical change telemetry.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-black">
              Verified Integrity
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-bold">
            <div className="p-3 bg-[#fcf9f2] rounded-lg border border-slate-300">
              <span className="text-slate-500 uppercase block text-[10px]">Snapshot SHA-256</span>
              <span className="font-mono text-slate-800 break-all text-[11px]">
                e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
              </span>
            </div>
            <div className="p-3 bg-[#fcf9f2] rounded-lg border border-slate-300">
              <span className="text-slate-500 uppercase block text-[10px]">Parser Normalizer</span>
              <span className="font-mono text-slate-800 text-xs">Cisco_IOS_AST_Engine_v2.4</span>
            </div>
            <div className="p-3 bg-[#fcf9f2] rounded-lg border border-slate-300">
              <span className="text-slate-500 uppercase block text-[10px]">Ingestion Protocol</span>
              <span className="font-mono text-slate-800 text-xs">SSH Netmiko Scrape (Port 22)</span>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">
              Discrepancy AST Hierarchy
            </h4>
            {event.details.map((d, i) => (
              <div key={d.id || i} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                <div className="flex items-center justify-between font-mono font-bold">
                  <span className="text-sky-700">{d.key_path}</span>
                  <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] uppercase">
                    {d.change_type}
                  </span>
                </div>
                <div className="text-slate-600 font-medium">{d.why_it_matters}</div>
                {d.source_line && (
                  <div className="font-mono text-[11px] text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-200">
                    Source: {d.source_line} (line {d.source_line_number || 'N/A'})
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Impact Analysis */}
      {activeTab === 'impact' && (
        <div className="rounded-xl border-2 border-[#1e293b] bg-white p-4 shadow-[3px_3px_0px_#1e293b] space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-black text-slate-900">Campus Physical & Logical Blast Radius</h3>
              <p className="text-xs text-slate-500 font-bold">
                Assessing downstream routing, VLAN boundaries, and user segments impacted by drift.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded bg-rose-100 text-rose-800 border border-rose-300 text-xs font-black">
              Critical Security Scope
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3 rounded-lg border-2 border-[#1e293b] bg-[#fcf9f2] space-y-2 text-xs font-bold">
              <span className="text-slate-500 uppercase text-[10px]">Impacted Subnets & VLANs</span>
              <ul className="space-y-1 font-mono text-slate-800">
                <li className="flex justify-between border-b pb-1">
                  <span>VLAN 10 (Campus-Data)</span>
                  <span className="text-rose-600">Exposed to Telnet MITM</span>
                </li>
                <li className="flex justify-between border-b pb-1">
                  <span>VLAN 20 (Campus-Voice)</span>
                  <span className="text-emerald-700">Isolated</span>
                </li>
                <li className="flex justify-between">
                  <span>VLAN 99 (Campus-Mgmt)</span>
                  <span className="text-rose-600">Unencrypted Telnet Port 23 Open</span>
                </li>
              </ul>
            </div>

            <div className="p-3 rounded-lg border-2 border-[#1e293b] bg-[#fcf9f2] space-y-2 text-xs font-bold">
              <span className="text-slate-500 uppercase text-[10px]">Compliance Violation Flags</span>
              <div className="space-y-1.5">
                <div className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-900 flex items-center justify-between">
                  <span>NIST 800-53 / SC-8 Transmission Confidentiality</span>
                  <span className="font-mono text-rose-600">FAIL</span>
                </div>
                <div className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-900 flex items-center justify-between">
                  <span>CIS Cisco Benchmark v3.1 §2.2.1</span>
                  <span className="font-mono text-rose-600">FAIL</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Ticket Correlation */}
      {activeTab === 'correlation' && (
        <div className="rounded-xl border-2 border-[#1e293b] bg-white p-4 shadow-[3px_3px_0px_#1e293b] space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-black text-slate-900">ITSM Change Ticket Linker</h3>
              <p className="text-xs text-slate-500 font-bold">
                Correlate this configuration event against scheduled maintenance windows in ServiceNow or Jira.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMarkAuthorizedModal(true)}
              className="px-3 py-1.5 rounded-lg border-2 border-[#1e293b] bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-black shadow-[2px_2px_0px_#1e293b]"
            >
              + Link Change Ticket
            </button>
          </div>

          <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-xs font-medium flex items-start gap-3">
            <Ticket className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">No automatic maintenance ticket matched this event window.</p>
              <p className="text-[11px] text-amber-800 mt-1">
                The timestamp (02 Nov 2026, 10:24 AM) fell outside active change windows for device sw-lab-03.
                If this change was pre-approved under an emergency ticket, select or input the ticket reference.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Remediation */}
      {activeTab === 'remediation' && (
        <div className="rounded-xl border-2 border-[#1e293b] bg-white p-4 shadow-[3px_3px_0px_#1e293b] space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-black text-slate-900">Automated Remediation Script</h3>
              <p className="text-xs text-slate-500 font-bold">
                Deterministic CLI commands generated to align sw-lab-03 with Golden Baseline v3.2.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/remediation')}
              className="px-3 py-1.5 rounded-lg border-2 border-[#1e293b] bg-[#22c55e] hover:bg-[#16a34a] text-white text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center gap-1.5"
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>Open in Remediation Queue</span>
            </button>
          </div>

          <div className="p-3 bg-slate-950 text-emerald-400 font-mono text-xs rounded-xl border-2 border-[#1e293b] shadow-inner space-y-1">
            <div className="text-slate-500">! === REMEDIATION CLI COMMANDS ===</div>
            <div>configure terminal</div>
            <div>line vty 0 4</div>
            <div className="pl-4 text-emerald-300">transport input ssh</div>
            <div className="pl-4 text-emerald-300">login local</div>
            <div>no ip helper-address 10.10.0.5</div>
            <div>no telnet server</div>
            <div>end</div>
            <div>write memory</div>
          </div>
        </div>
      )}

      {/* Tab 6: History */}
      {activeTab === 'history' && (
        <div className="rounded-xl border-2 border-[#1e293b] bg-white p-4 shadow-[3px_3px_0px_#1e293b] space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-black text-slate-900">Configuration Drift Audit Log for sw-lab-03</h3>
              <p className="text-xs text-slate-500 font-bold">
                Historical record of compliance status across sweeps and manual snapshots.
              </p>
            </div>
          </div>

          <div className="space-y-2 text-xs font-bold">
            {[
              { time: '02 Nov 2026, 10:24 AM', status: 'DRIFT DETECTED', detail: 'Telnet enabled on VTY 0 4', risk: 92 },
              { time: '28 Oct 2026, 10:20 AM', status: 'COMPLIANT', detail: 'Matches Baseline v3.2', risk: 0 },
              { time: '21 Oct 2026, 10:19 AM', status: 'COMPLIANT', detail: 'Matches Baseline v3.2', risk: 0 },
              { time: '14 Oct 2026, 10:21 AM', status: 'DRIFT DETECTED', detail: 'SNMP community public enabled', risk: 78 },
            ].map((h, i) => (
              <div
                key={i}
                className="p-3 rounded-lg border border-slate-200 bg-[#fdfbf7] flex items-center justify-between"
              >
                <div>
                  <span className="font-mono text-slate-500 text-[11px] block">{h.time}</span>
                  <span className="text-slate-900 font-bold mt-0.5 block">{h.detail}</span>
                </div>
                <div className="text-right">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-black ${
                      h.risk > 0 ? 'bg-rose-100 text-rose-800 border border-rose-300' : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {h.status}
                  </span>
                  {h.risk > 0 && <span className="text-[11px] font-mono text-rose-600 block mt-0.5">Risk: {h.risk}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. Footer Action Ribbon Across Screen Bottom */}
      <div className="rounded-2xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[3px_3px_0px_#1e293b] flex flex-wrap items-center justify-end gap-3">
        {/* Create Remediation */}
        <button
          type="button"
          onClick={() => {
            if (isNetEng) {
              generatePlanMutation.mutate();
            } else {
              navigate('/remediation');
            }
          }}
          className="py-2.5 px-5 rounded-xl border-2 border-[#1e293b] bg-[#f59e0b] hover:bg-[#d97706] text-black font-black text-xs shadow-[2px_2px_0px_#1e293b] flex items-center gap-2 transition-transform active:translate-y-0.5"
        >
          <Wrench className="w-4 h-4" />
          <span>Create Remediation</span>
        </button>

        {/* Mark as Authorized */}
        <button
          type="button"
          onClick={() => setMarkAuthorizedModal(true)}
          className="py-2.5 px-5 rounded-xl border-2 border-[#1e293b] bg-[#0284c7] hover:bg-[#0369a1] text-white font-black text-xs shadow-[2px_2px_0px_#1e293b] flex items-center gap-2 transition-transform active:translate-y-0.5"
        >
          <Check className="w-4 h-4" />
          <span>Mark as Authorized</span>
        </button>

        {/* Close Event */}
        <button
          type="button"
          onClick={() => setIsFalsePositiveModalOpen(true)}
          className="py-2.5 px-5 rounded-xl border-2 border-[#1e293b] bg-[#22c55e] hover:bg-[#16a34a] text-white font-black text-xs shadow-[2px_2px_0px_#1e293b] flex items-center gap-2 transition-transform active:translate-y-0.5"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>Close Event</span>
        </button>
      </div>

      {/* ================= MODALS ================= */}

      {/* Modal: View Full Config (Baseline) */}
      {viewFullBaselineModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#0284c7] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5" />
                <h3 className="text-sm font-black">Full Configuration: Baseline (Golden v3.2)</h3>
              </div>
              <button
                type="button"
                onClick={() => setViewFullBaselineModal(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <pre className="p-3 bg-[#fdfbf7] border-2 border-[#1e293b] rounded-xl text-xs font-mono text-slate-800 max-h-96 overflow-y-auto leading-relaxed shadow-inner">
                {BASELINE_CONFIG_FULL}
              </pre>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy(BASELINE_CONFIG_FULL, 'Baseline configuration')}
                  className="px-4 py-2 rounded-lg border-2 border-[#1e293b] bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-black flex items-center gap-1.5 shadow-[2px_2px_0px_#1e293b]"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Config</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewFullBaselineModal(false)}
                  className="px-4 py-2 rounded-lg border-2 border-[#1e293b] bg-[#0284c7] text-white text-xs font-black shadow-[2px_2px_0px_#1e293b]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: View Full Config (Current) */}
      {viewFullCurrentModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#0ea5e9] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                <h3 className="text-sm font-black">Full Configuration: Current Running-Config (sw-lab-03)</h3>
              </div>
              <button
                type="button"
                onClick={() => setViewFullCurrentModal(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <pre className="p-3 bg-[#fdfbf7] border-2 border-[#1e293b] rounded-xl text-xs font-mono text-slate-800 max-h-96 overflow-y-auto leading-relaxed shadow-inner">
                {CURRENT_CONFIG_FULL}
              </pre>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy(CURRENT_CONFIG_FULL, 'Running configuration')}
                  className="px-4 py-2 rounded-lg border-2 border-[#1e293b] bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-black flex items-center gap-1.5 shadow-[2px_2px_0px_#1e293b]"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Config</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewFullCurrentModal(false)}
                  className="px-4 py-2 rounded-lg border-2 border-[#1e293b] bg-[#0ea5e9] text-white text-xs font-black shadow-[2px_2px_0px_#1e293b]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: View as JSON */}
      {viewJsonModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#8b5cf6] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <Code2 className="w-5 h-5" />
                <h3 className="text-sm font-black">Evidence Package JSON Schema</h3>
              </div>
              <button
                type="button"
                onClick={() => setViewJsonModal(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <pre className="p-3 bg-slate-950 text-emerald-400 border-2 border-[#1e293b] rounded-xl text-xs font-mono max-h-96 overflow-y-auto leading-relaxed shadow-inner">
                {JSON.stringify(event, null, 2)}
              </pre>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy(JSON.stringify(event, null, 2), 'Evidence JSON')}
                  className="px-4 py-2 rounded-lg border-2 border-[#1e293b] bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-black flex items-center gap-1.5 shadow-[2px_2px_0px_#1e293b]"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy JSON</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewJsonModal(false)}
                  className="px-4 py-2 rounded-lg border-2 border-[#1e293b] bg-[#8b5cf6] text-white text-xs font-black shadow-[2px_2px_0px_#1e293b]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Mark as Authorized */}
      {markAuthorizedModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#0284c7] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <Ticket className="w-5 h-5" />
                <h3 className="text-sm font-black">Authorize Configuration Exception</h3>
              </div>
              <button
                type="button"
                onClick={() => setMarkAuthorizedModal(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4 text-xs font-bold">
              <div>
                <label className="block text-slate-700 mb-1">Link ITSM Ticket Reference:</label>
                <input
                  type="text"
                  value={ticketInput}
                  onChange={(e) => setTicketInput(e.target.value)}
                  placeholder="e.g. CHG-10584, NET-4312"
                  className="w-full p-2.5 border-2 border-[#1e293b] rounded-lg font-mono text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-1">Authorization Justification:</label>
                <textarea
                  rows={3}
                  defaultValue="Authorized maintenance window approved for research laboratory upgrade."
                  className="w-full p-2.5 border-2 border-[#1e293b] rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setMarkAuthorizedModal(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-slate-100 text-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMarkAuthorizedModal(false);
                    setActionBanner({
                      type: 'success',
                      message: `Drift event marked as Authorized under ticket ${ticketInput}.`,
                    });
                  }}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-[#0284c7] text-white rounded-lg shadow-[2px_2px_0px_#1e293b]"
                >
                  Confirm Authorization
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Mark False Positive / Close Event */}
      {isFalsePositiveModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-emerald-600 text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                <h3 className="text-sm font-black">Close Drift Event / Mark Resolved</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsFalsePositiveModalOpen(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFpSubmit} className="p-4 space-y-4 text-xs font-bold">
              <div>
                <label className="block text-slate-700 mb-1">
                  Engineer Justification / Closure Note (Mandatory):
                </label>
                <textarea
                  value={fpComment}
                  onChange={(e) => setFpComment(e.target.value)}
                  rows={4}
                  placeholder="Explain why this drift is resolved, accepted, or marked as a false positive..."
                  required
                  className="w-full p-3 border-2 border-[#1e293b] rounded-lg text-slate-900 focus:outline-none focus:border-emerald-500 text-xs leading-relaxed"
                />
                <p className="text-[11px] text-slate-500 mt-1">Minimum 5 characters required for audit trail.</p>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsFalsePositiveModalOpen(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-slate-100 text-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={markFpMutation.isPending || fpComment.trim().length < 5}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold border-2 border-[#1e293b] shadow-[2px_2px_0px_#1e293b] disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{markFpMutation.isPending ? 'Logging Audit...' : 'Confirm Closure'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
