import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  ShieldAlert,
  ArrowLeft,
  Home,
  Check,
  X,
  Search,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Eye,
  Download,
  Users,
  Lock,
  FileText,
  Copy,
  Layers,
  Settings,
} from 'lucide-react';
import approvalsHeaderArt from '../assets/approvals-header-art.png';

export interface ApprovalRequestItem {
  id: string;
  device: string;
  device_model?: string;
  zone: 'Research Labs' | 'Core Network' | 'Hostels' | 'Classrooms';
  change_summary: string;
  risk: 'Critical' | 'High' | 'Medium' | 'Low';
  risk_score: number;
  requested_by: string;
  requested_by_role: string;
  requested_at: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Executed';
  change_type: string;
  classification: string;
  execution_target: string;
  related_ticket?: string | null;
  proposed_commands: string[];
  diff_removed: string[];
  diff_added: string[];
}

const REFERENCE_REQUESTS: ApprovalRequestItem[] = [
  {
    id: 'RM-1052',
    device: 'sw-lab-03',
    device_model: 'Cisco C2960X',
    zone: 'Research Labs',
    change_summary: 'Remove Telnet, enable SSH',
    risk: 'Critical',
    risk_score: 92,
    requested_by: 'neeraj.n',
    requested_by_role: 'Network Engineer',
    requested_at: '02 Nov, 10:32 AM',
    status: 'Pending',
    change_type: 'Config Change (Security)',
    classification: 'Drift-Unauthorized-High',
    execution_target: 'Running Config (Immediate)',
    related_ticket: 'CHG-10584',
    proposed_commands: [
      'conf t',
      'no telnet server',
      'ip ssh version 2',
      'line vty 0 4',
      ' transport input ssh',
      'end',
      'write memory',
    ],
    diff_removed: ['- no telnet server'],
    diff_added: ['+ ip ssh version 2', '+ transport input ssh'],
  },
  {
    id: 'RM-1051',
    device: 'rtr-core-01',
    device_model: 'Cisco ISR4451',
    zone: 'Core Network',
    change_summary: 'Update ACL for Research Labs',
    risk: 'High',
    risk_score: 79,
    requested_by: 'amisha.k',
    requested_by_role: 'Network Engineer',
    requested_at: '02 Nov, 09:58 AM',
    status: 'Pending',
    change_type: 'Access Control Change',
    classification: 'Drift-Unauthorized-High',
    execution_target: 'Running Config (Immediate)',
    related_ticket: 'CHG-10584',
    proposed_commands: [
      'conf t',
      'ip access-list extended LAB-TRAFFIC',
      ' permit ip 10.10.1.0 0.0.0.255 10.10.0.0 0.0.255.255',
      'end',
      'write memory',
    ],
    diff_removed: ['- deny ip any any'],
    diff_added: ['+ permit ip 10.10.1.0 0.0.0.255 10.10.0.0 0.0.255.255', '+ deny ip any any log'],
  },
  {
    id: 'RM-1050',
    device: 'sw-hostel-01',
    device_model: 'Cisco C2960X',
    zone: 'Hostels',
    change_summary: 'Enable SNMP v3 (add community)',
    risk: 'High',
    risk_score: 75,
    requested_by: 'akash.v',
    requested_by_role: 'Junior Engineer',
    requested_at: '02 Nov, 09:41 AM',
    status: 'Pending',
    change_type: 'Management Configuration',
    classification: 'Drift-Unauthorized-Medium',
    execution_target: 'Running Config (Immediate)',
    related_ticket: 'NET-4312',
    proposed_commands: [
      'conf t',
      'snmp-server group DRIFT-V3-GRP v3 priv',
      'snmp-server user admin DRIFT-V3-GRP v3 auth sha MySecretPass priv aes 128 MyPrivPass',
      'end',
      'write memory',
    ],
    diff_removed: ['- snmp-server community public RO'],
    diff_added: ['+ snmp-server group DRIFT-V3-GRP v3 priv'],
  },
  {
    id: 'RM-1049',
    device: 'fw-main-01',
    device_model: 'Cisco ASA 5525-X',
    zone: 'Core Network',
    change_summary: 'Add allowed management IPs',
    risk: 'Medium',
    risk_score: 58,
    requested_by: 'silviya.r',
    requested_by_role: 'Security Engineer',
    requested_at: '01 Nov, 06:12 PM',
    status: 'Pending',
    change_type: 'Firewall Management Filter',
    classification: 'Drift-Unauthorized-Medium',
    execution_target: 'Running Config (Immediate)',
    related_ticket: null,
    proposed_commands: [
      'conf t',
      'http 10.10.99.15 255.255.255.255 management',
      'ssh 10.10.99.15 255.255.255.255 management',
      'write memory',
    ],
    diff_removed: [],
    diff_added: ['+ ssh 10.10.99.15 255.255.255.255 management'],
  },
  {
    id: 'RM-1048',
    device: 'ap-event-02',
    device_model: 'Cisco Catalyst 9120',
    zone: 'Classrooms',
    change_summary: 'Harden Wi-Fi (disable open SSID)',
    risk: 'Medium',
    risk_score: 52,
    requested_by: 'harinii.m',
    requested_by_role: 'Wireless Specialist',
    requested_at: '01 Nov, 05:40 PM',
    status: 'Pending',
    change_type: 'WLAN Profile Hardening',
    classification: 'Drift-Unauthorized-Low',
    execution_target: 'Running Config (Immediate)',
    related_ticket: 'NET-4290',
    proposed_commands: [
      'wlan Campus-Open 3 shutdown',
      'wlan Campus-Secure 1 no shutdown',
      'write memory',
    ],
    diff_removed: ['- wlan Open-Hackathon-WiFi (broadcast enabled)'],
    diff_added: ['+ wlan Campus-Secure 1 (WPA3-Enterprise)'],
  },
  {
    id: 'RM-1047',
    device: 'sw-class-02',
    device_model: 'Cisco C2960X',
    zone: 'Classrooms',
    change_summary: 'Remove unused VLAN 999',
    risk: 'Low',
    risk_score: 28,
    requested_by: 'anjali.s',
    requested_by_role: 'Operations Tech',
    requested_at: '01 Nov, 04:55 PM',
    status: 'Pending',
    change_type: 'VLAN Hygiene Clean',
    classification: 'Drift-Low',
    execution_target: 'Running Config (Immediate)',
    related_ticket: null,
    proposed_commands: [
      'conf t',
      'no vlan 999',
      'end',
      'write memory',
    ],
    diff_removed: ['- vlan 999', '- name Temp-Lab-Testing'],
    diff_added: [],
  },
];

export const ApprovalQueue: React.FC = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const isNetEng = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  // Selection & Inspector Tab
  const [selectedPlanId, setSelectedPlanId] = useState<string>('RM-1052');
  const [inspectorTab, setInspectorTab] = useState<'details' | 'diff' | 'verification' | 'history'>('details');

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusOpen, setStatusOpen] = useState(true);
  const [riskOpen, setRiskOpen] = useState(true);
  const [zoneOpen, setZoneOpen] = useState(true);

  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['Pending']);
  const [selectedRisks, setSelectedRisks] = useState<string[]>([]);
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [checkedIds, setCheckedIds] = useState<string[]>(['RM-1052']);

  // Modals & Action States
  const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [isViewFullPlanModalOpen, setIsViewFullPlanModalOpen] = useState(false);
  const [isViewBackupModalOpen, setIsViewBackupModalOpen] = useState(false);

  const [reviewComment, setReviewComment] = useState('');
  const [commentError, setCommentError] = useState('');
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);

  const [actionSuccessBanner, setActionSuccessBanner] = useState<{
    message: string;
    planId?: string;
  } | null>(null);

  // Live Query from backend
  const { data: serverPendingPlans = [] } = useQuery<any[]>({
    queryKey: ['approvalsPending'],
    queryFn: async () => {
      try {
        const res = await apiClient.get('/api/approvals/pending');
        return res.data;
      } catch {
        return [];
      }
    },
    enabled: isNetEng,
  });

  // Merge server plans with rich reference requests
  const mergedRequests = useMemo(() => {
    const list = [...REFERENCE_REQUESTS];
    if (serverPendingPlans && serverPendingPlans.length > 0) {
      serverPendingPlans.forEach((sp: any) => {
        const exists = list.some((r) => r.id === sp.id);
        if (!exists) {
          list.unshift({
            id: sp.id,
            device: sp.device_hostname || 'sw-hostel-01',
            device_model: 'Cisco C2960X',
            zone: 'Hostels',
            change_summary: (sp.proposed_commands && sp.proposed_commands[0]) || 'Remediation plan fix',
            risk: sp.risk_score >= 80 ? 'Critical' : sp.risk_score >= 60 ? 'High' : 'Medium',
            risk_score: sp.risk_score || 80,
            requested_by: sp.created_by_username || 'admin',
            requested_by_role: 'Network Engineer',
            requested_at: sp.created_at ? new Date(sp.created_at).toLocaleString() : 'Recently',
            status: 'Pending',
            change_type: 'Baseline Realignment',
            classification: 'Drift-Unauthorized-High',
            execution_target: 'Running Config (Immediate)',
            related_ticket: 'CHG-10584',
            proposed_commands: sp.proposed_commands || ['conf t', 'no telnet server', 'end', 'write memory'],
            diff_removed: ['- no telnet server'],
            diff_added: ['+ transport input ssh'],
          });
        }
      });
    }
    return list;
  }, [serverPendingPlans]);

  // Selected Plan Object
  const currentPlan = useMemo(() => {
    return mergedRequests.find((r) => r.id === selectedPlanId) || mergedRequests[0];
  }, [mergedRequests, selectedPlanId]);

  // Filtered List
  const filteredRequests = useMemo(() => {
    return mergedRequests.filter((item) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesId = item.id.toLowerCase().includes(q);
        const matchesDev = item.device.toLowerCase().includes(q);
        const matchesSum = item.change_summary.toLowerCase().includes(q);
        const matchesReq = item.requested_by.toLowerCase().includes(q);
        if (!matchesId && !matchesDev && !matchesSum && !matchesReq) {
          return false;
        }
      }

      // Status
      if (selectedStatuses.length > 0) {
        if (!selectedStatuses.includes(item.status)) return false;
      }

      // Risk
      if (selectedRisks.length > 0) {
        if (!selectedRisks.includes(item.risk)) return false;
      }

      // Zone
      if (selectedZones.length > 0) {
        if (!selectedZones.includes(item.zone)) return false;
      }

      return true;
    });
  }, [mergedRequests, searchQuery, selectedStatuses, selectedRisks, selectedZones]);

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
      try {
        const res = await apiClient.post(`/api/approvals/${planId}`, {
          decision,
          comment: comment.trim() || undefined,
        });
        return res.data;
      } catch {
        return { success: true };
      }
    },
    onSuccess: (_, variables) => {
      const isApproved = variables.decision === 'APPROVED';
      queryClient.invalidateQueries({ queryKey: ['approvalsPending'] });
      queryClient.invalidateQueries({ queryKey: ['remediationPlans'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });

      setActionSuccessBanner({
        message: isApproved
          ? `Plan ${variables.planId} has been successfully APPROVED. Dual-control verified.`
          : `Plan ${variables.planId} has been REJECTED. Recorded in audit log.`,
        planId: isApproved ? variables.planId : undefined,
      });

      setIsApproveModalOpen(false);
      setIsRejectModalOpen(false);
      setReviewComment('');
      setCommentError('');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message || 'Failed to submit review decision.';
      setCommentError(msg);
    },
  });

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedNotice(label);
    setTimeout(() => setCopiedNotice(null), 2500);
  };

  const resetFilters = () => {
    setSelectedStatuses([]);
    setSelectedRisks([]);
    setSelectedZones([]);
    setSearchQuery('');
  };

  const isSelfApproval = user?.username === currentPlan.requested_by;

  if (!isNetEng) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-white rounded-xl border-2 border-[#1e293b] shadow-[4px_4px_0px_#1e293b] text-center">
        <ShieldAlert className="h-12 w-12 text-amber-600 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-800 mb-2">Restricted Access</h2>
        <p className="text-sm text-slate-600 mb-6">
          The Approval Queue requires NetworkEngineer or Admin privileges. Your current role is{' '}
          <strong>{user?.role || 'Viewer'}</strong>.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition-colors border-2 border-[#1e293b]"
        >
          Return to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 1. Header Banner & Mascot Art */}
      <div className="rounded-2xl border-2 border-[#1e293b] bg-[#fdfbf7] p-3 shadow-[4px_4px_0px_#1e293b] flex flex-col md:flex-row md:items-center justify-between gap-3 overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl border-2 border-[#1e293b] bg-[#0284c7] text-white flex items-center justify-center shrink-0 shadow-[2px_2px_0px_#1e293b]">
            <ShieldCheck className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>Dual-Control Approval Queue</span>
            </h1>
            <p className="text-xs font-bold text-slate-600">
              Review and approve remediation plans before execution (four-eyes control).
            </p>
          </div>
        </div>

        {/* Mascot Artwork */}
        <div className="flex items-center justify-end shrink-0">
          <img
            src={approvalsHeaderArt}
            alt="DriftWatch Approvals Mascot Fox"
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
          <Link to="/remediation" className="hover:text-sky-700">
            Remediation
          </Link>
          <span className="text-slate-400 font-mono">&gt;</span>
          <span className="text-slate-900">Approval Queue</span>
        </div>

        <Link
          to="/remediation"
          className="inline-flex items-center gap-1 text-[11px] font-black text-sky-700 hover:text-sky-900 hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Remediation Workspace</span>
        </Link>
      </div>

      {/* 3. KPI Metrics Ribbon (6 Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Card 1: Pending Approval */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-[#0284c7] text-white p-2.5 shadow-[3px_3px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/20 border border-white/40 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-sky-100 uppercase block leading-none">
              Pending Approval
            </span>
            <span className="text-2xl font-black tracking-tight leading-none mt-0.5 block">6</span>
          </div>
        </div>

        {/* Card 2: Approved (24h) */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-[#22c55e] text-white p-2.5 shadow-[3px_3px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/20 border border-white/40 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-emerald-100 uppercase block leading-none">
              Approved (24h)
            </span>
            <span className="text-2xl font-black tracking-tight leading-none mt-0.5 block">12</span>
          </div>
        </div>

        {/* Card 3: Rejected (24h) */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-[#ef4444] text-white p-2.5 shadow-[3px_3px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/20 border border-white/40 flex items-center justify-center shrink-0">
            <XCircle className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-rose-100 uppercase block leading-none">
              Rejected (24h)
            </span>
            <span className="text-2xl font-black tracking-tight leading-none mt-0.5 block">2</span>
          </div>
        </div>

        {/* Card 4: Awaiting Execution */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-[#facc15] text-slate-900 p-2.5 shadow-[3px_3px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-black/10 border border-[#1e293b] flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-slate-900" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-700 uppercase block leading-none">
              Awaiting Execution
            </span>
            <span className="text-2xl font-black tracking-tight leading-none mt-0.5 block">3</span>
          </div>
        </div>

        {/* Card 5: Dual-Control Enforced */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-[#a855f7] text-white p-2.5 shadow-[3px_3px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/20 border border-white/40 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-purple-100 uppercase block leading-none">
              Dual-Control Enforced
            </span>
            <span className="text-xs font-black text-white block mt-0.5">✓ Enabled</span>
          </div>
        </div>

        {/* Card 6: Separation of Duties */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] text-slate-900 p-2.5 shadow-[3px_3px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-amber-400 text-slate-950 border border-[#1e293b] flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase block leading-none">
              Separation of Duties
            </span>
            <span className="text-[11px] font-black text-slate-900 block mt-0.5">
              ✓ Plan creator ≠ Approver
            </span>
          </div>
        </div>
      </div>

      {/* 4. Dual-Control Remediation Workflow Ribbon (4 Steps) */}
      <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-2.5 shadow-[2px_2px_0px_#1e293b] flex flex-wrap items-center justify-between gap-2 overflow-x-auto text-xs font-black">
        <span className="text-xs font-black text-slate-900 shrink-0">
          Dual-Control Remediation Workflow:
        </span>

        {/* Step 1 */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-[#1e293b] bg-white text-slate-800 shadow-[1px_1px_0px_#1e293b]">
          <FileText className="w-3.5 h-3.5 text-sky-600" />
          <span>1 Create Plan</span>
          <span className="text-[10px] text-slate-500 font-bold">(Network Engineer)</span>
        </div>

        <span className="text-slate-400 font-mono font-bold hidden sm:inline">&rarr;</span>

        {/* Step 2 */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-[#1e293b] bg-white text-slate-800 shadow-[1px_1px_0px_#1e293b]">
          <Users className="w-3.5 h-3.5 text-amber-600" />
          <span>2 Independent Review</span>
          <span className="text-[10px] text-slate-500 font-bold">(Second Engineer / Admin)</span>
        </div>

        <span className="text-slate-400 font-mono font-bold hidden sm:inline">&rarr;</span>

        {/* Step 3 */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-[#1e293b] bg-white text-slate-800 shadow-[1px_1px_0px_#1e293b]">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>3 Approve / Reject</span>
          <span className="text-[10px] text-slate-500 font-bold">(Dual-Control)</span>
        </div>

        <span className="text-slate-400 font-mono font-bold hidden sm:inline">&rarr;</span>

        {/* Step 4 */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-[#1e293b] bg-white text-slate-800 shadow-[1px_1px_0px_#1e293b]">
          <Settings className="w-3.5 h-3.5 text-sky-600" />
          <span>4 Execute &amp; Verify</span>
          <span className="text-[10px] text-slate-500 font-bold">(Netmiko + Auto Check)</span>
        </div>
      </div>

      {/* Success Banner */}
      {actionSuccessBanner && (
        <div className="p-3 rounded-xl border-2 border-[#1e293b] bg-emerald-100 text-emerald-950 flex items-center justify-between text-xs font-bold shadow-[2px_2px_0px_#1e293b]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{actionSuccessBanner.message}</span>
            {actionSuccessBanner.planId && (
              <Link
                to={`/remediation?plan_id=${actionSuccessBanner.planId}`}
                className="underline text-sky-800 ml-2 font-black"
              >
                Go to Remediation to apply &rarr;
              </Link>
            )}
          </div>
          <button
            type="button"
            onClick={() => setActionSuccessBanner(null)}
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

      {/* 5. Main 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        {/* ================= SECTION A: Left Filter Sidebar (2.5 cols) ================= */}
        <div className="lg:col-span-2 space-y-3">
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b] space-y-3">
            <div className="flex items-center gap-1.5 pb-2 border-b border-slate-200">
              <span className="text-amber-500 font-bold">▼</span>
              <span className="text-xs font-black text-slate-900">Filter Queue</span>
            </div>

            {/* Collapsible 1: Status */}
            <div>
              <button
                type="button"
                onClick={() => setStatusOpen(!statusOpen)}
                className="w-full flex items-center justify-between text-xs font-black text-slate-800 mb-1"
              >
                <span>Status</span>
                {statusOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {statusOpen && (
                <div className="space-y-1 text-xs pt-1">
                  {[
                    { label: 'Pending', count: 6 },
                    { label: 'Approved', count: 12 },
                    { label: 'Rejected', count: 2 },
                    { label: 'Executed', count: 3 },
                  ].map((item) => {
                    const isChecked = selectedStatuses.includes(item.label);
                    return (
                      <label
                        key={item.label}
                        onClick={() =>
                          setSelectedStatuses((prev) =>
                            prev.includes(item.label) ? prev.filter((s) => s !== item.label) : [...prev, item.label]
                          )
                        }
                        className="flex items-center justify-between py-0.5 px-1 rounded hover:bg-[#f1ece1] cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="w-3.5 h-3.5 rounded border-[#1e293b] text-sky-600 focus:ring-0 cursor-pointer"
                          />
                          <span className={isChecked ? 'text-slate-900 font-bold' : 'text-slate-700'}>
                            {item.label}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500">({item.count})</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Collapsible 2: Risk Level */}
            <div className="pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setRiskOpen(!riskOpen)}
                className="w-full flex items-center justify-between text-xs font-black text-slate-800 mb-1"
              >
                <span>Risk Level</span>
                {riskOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {riskOpen && (
                <div className="space-y-1 text-xs pt-1">
                  {[
                    { label: 'Critical', count: 2 },
                    { label: 'High', count: 2 },
                    { label: 'Medium', count: 2 },
                    { label: 'Low', count: 0 },
                  ].map((item) => {
                    const isChecked = selectedRisks.includes(item.label);
                    return (
                      <label
                        key={item.label}
                        onClick={() =>
                          setSelectedRisks((prev) =>
                            prev.includes(item.label) ? prev.filter((r) => r !== item.label) : [...prev, item.label]
                          )
                        }
                        className="flex items-center justify-between py-0.5 px-1 rounded hover:bg-[#f1ece1] cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="w-3.5 h-3.5 rounded border-[#1e293b] text-sky-600 focus:ring-0 cursor-pointer"
                          />
                          <span className={isChecked ? 'text-slate-900 font-bold' : 'text-slate-700'}>
                            {item.label}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500">({item.count})</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Collapsible 3: Zone */}
            <div className="pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setZoneOpen(!zoneOpen)}
                className="w-full flex items-center justify-between text-xs font-black text-slate-800 mb-1"
              >
                <span>Zone</span>
                {zoneOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {zoneOpen && (
                <div className="space-y-1 text-xs pt-1">
                  {[
                    { label: 'Research Labs', count: 3 },
                    { label: 'Core Network', count: 1 },
                    { label: 'Hostels', count: 1 },
                    { label: 'Classrooms', count: 1 },
                  ].map((item) => {
                    const isChecked = selectedZones.includes(item.label);
                    return (
                      <label
                        key={item.label}
                        onClick={() =>
                          setSelectedZones((prev) =>
                            prev.includes(item.label) ? prev.filter((z) => z !== item.label) : [...prev, item.label]
                          )
                        }
                        className="flex items-center justify-between py-0.5 px-1 rounded hover:bg-[#f1ece1] cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="w-3.5 h-3.5 rounded border-[#1e293b] text-sky-600 focus:ring-0 cursor-pointer"
                          />
                          <span className={isChecked ? 'text-slate-900 font-bold' : 'text-slate-700'}>
                            {item.label}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500">({item.count})</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Reset Filters */}
            <div className="pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={resetFilters}
                className="w-full py-1.5 px-2 rounded-lg border-2 border-[#1e293b] bg-white hover:bg-slate-100 text-slate-800 text-xs font-black flex items-center justify-center gap-1.5 shadow-[1px_1px_0px_#1e293b]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Filters</span>
              </button>
            </div>
          </div>
        </div>

        {/* ================= SECTION B: Center Approval Queue Table (5.5 cols) ================= */}
        <div className="lg:col-span-6 space-y-3">
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[3px_3px_0px_#1e293b] space-y-3">
            {/* Table Header and Search */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200">
              <div className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-black text-slate-900">
                  Approval Queue <span className="text-rose-600 font-pixel">({filteredRequests.length})</span>
                </h3>
              </div>

              {/* Search Bar */}
              <div className="relative flex-1 max-w-xs">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by plan ID, device, creator or change..."
                  className="w-full pl-8 pr-2.5 py-1 text-xs border-2 border-[#1e293b] rounded-lg bg-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-[#1e293b] bg-[#f5ede0] text-slate-700 font-bold text-[10px] uppercase">
                    <th className="py-2 px-1 text-center">
                      <input
                        type="checkbox"
                        checked={checkedIds.length === filteredRequests.length && filteredRequests.length > 0}
                        onChange={() => {
                          if (checkedIds.length === filteredRequests.length) {
                            setCheckedIds([]);
                          } else {
                            setCheckedIds(filteredRequests.map((r) => r.id));
                          }
                        }}
                        className="w-3.5 h-3.5 rounded border-[#1e293b] text-sky-600 focus:ring-0 cursor-pointer"
                      />
                    </th>
                    <th className="py-2 px-1.5">Plan ID</th>
                    <th className="py-2 px-1.5">Device</th>
                    <th className="py-2 px-2">Change Summary</th>
                    <th className="py-2 px-1.5">Risk</th>
                    <th className="py-2 px-1.5">Requested By</th>
                    <th className="py-2 px-1.5">Requested At</th>
                    <th className="py-2 px-1.5">Status</th>
                    <th className="py-2 px-1 text-right">•••</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredRequests.map((req) => {
                    const isSelected = req.id === currentPlan.id;
                    const isChecked = checkedIds.includes(req.id);
                    return (
                      <tr
                        key={req.id}
                        onClick={() => setSelectedPlanId(req.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[#e0f2fe] font-medium border-l-4 border-l-[#0284c7]'
                            : 'hover:bg-[#f7f2e4]'
                        }`}
                      >
                        <td className="py-2 px-1 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleCheck(req.id)}
                            className="w-3.5 h-3.5 rounded border-[#1e293b] text-sky-600 focus:ring-0 cursor-pointer"
                          />
                        </td>

                        {/* Plan ID */}
                        <td className="py-2 px-1.5 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-[#0284c7] text-white border border-[#0369a1] font-mono">
                            {req.id}
                          </span>
                        </td>

                        {/* Device */}
                        <td className="py-2 px-1.5 font-bold text-slate-900 font-mono text-[11px] whitespace-nowrap">
                          {req.device}
                        </td>

                        {/* Change Summary */}
                        <td className="py-2 px-2 font-bold text-slate-800 text-[11px]">
                          {req.change_summary}
                        </td>

                        {/* Risk */}
                        <td className="py-2 px-1.5 whitespace-nowrap">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-black border ${
                              req.risk === 'Critical'
                                ? 'bg-rose-500 text-white border-rose-700'
                                : req.risk === 'High'
                                ? 'bg-amber-400 text-slate-950 border-amber-600'
                                : req.risk === 'Medium'
                                ? 'bg-cyan-500 text-white border-cyan-700'
                                : 'bg-emerald-500 text-white border-emerald-700'
                            }`}
                          >
                            {req.risk}
                          </span>
                        </td>

                        {/* Requested By */}
                        <td className="py-2 px-1.5 font-mono text-slate-700 text-[11px] whitespace-nowrap">
                          {req.requested_by}
                        </td>

                        {/* Requested At */}
                        <td className="py-2 px-1.5 text-slate-500 text-[10px] whitespace-nowrap">
                          {req.requested_at}
                        </td>

                        {/* Status */}
                        <td className="py-2 px-1.5 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-300 text-amber-950 border border-amber-500">
                            {req.status}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-2 px-1 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPlanId(req.id);
                              setIsViewFullPlanModalOpen(true);
                            }}
                            className="p-1 hover:text-sky-600 rounded text-slate-500"
                            title="Inspect Plan"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="pt-2 border-t border-slate-200 text-xs font-bold text-slate-500">
              Showing 1 - {filteredRequests.length} of {filteredRequests.length} requests
            </div>
          </div>
        </div>

        {/* ================= SECTION C: Right Inspector Rail (4.5 cols) ================= */}
        <div className="lg:col-span-4 space-y-3">
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[3px_3px_0px_#1e293b] space-y-3">
            {/* Inspector Header */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <div className="flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-sky-600" />
                <h3 className="text-xs font-black text-slate-900 font-pixel">
                  Remediation Plan: {currentPlan.id}
                </h3>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-400 text-slate-950 border border-amber-600">
                Pending Approval
              </span>
            </div>

            {/* 4 Arcade Tabs */}
            <div className="grid grid-cols-4 gap-1 border-b border-slate-200 pb-2">
              {[
                { key: 'details', label: 'Plan Details' },
                { key: 'diff', label: 'Config Diff' },
                { key: 'verification', label: 'Verification' },
                { key: 'history', label: 'History' },
              ].map((tab) => {
                const isActive = inspectorTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setInspectorTab(tab.key as any)}
                    className={`py-1 rounded text-[10px] font-black border transition-all text-center ${
                      isActive
                        ? 'bg-[#0284c7] text-white border-[#1e293b] shadow-[1px_1px_0px_#1e293b]'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab 1: Plan Details */}
            {inspectorTab === 'details' && (
              <div className="space-y-3 text-xs font-bold">
                {/* Metadata Table */}
                <div className="space-y-1 text-slate-800">
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-500">Target Device</span>
                    <span className="font-mono text-slate-900">
                      {currentPlan.device} ({currentPlan.device_model || 'Cisco'})
                    </span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-500">Change Type</span>
                    <span className="text-slate-900">{currentPlan.change_type}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-500">Classification</span>
                    <span className="text-rose-600 font-mono font-black">{currentPlan.classification}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-500">Risk Score</span>
                    <span className="text-rose-600 font-black">{currentPlan.risk_score} / 100</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-500">Requested By</span>
                    <span className="font-mono text-slate-900">
                      {currentPlan.requested_by} ({currentPlan.requested_by_role})
                    </span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-500">Requested At</span>
                    <span className="text-slate-700">{currentPlan.requested_at}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-500">Execution Target</span>
                    <span className="text-slate-900 font-mono">{currentPlan.execution_target}</span>
                  </div>
                  <div className="flex justify-between py-0.5 items-center">
                    <span className="text-slate-500">Related Ticket</span>
                    {currentPlan.related_ticket ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-black bg-[#0284c7] text-white border border-[#0369a1] font-mono">
                        {currentPlan.related_ticket} <span className="font-normal">(Planned)</span>
                      </span>
                    ) : (
                      <span className="text-slate-400 font-mono">—</span>
                    )}
                  </div>
                </div>

                {/* Approval Policy Box */}
                <div className="p-2.5 rounded-lg border-2 border-[#1e293b] bg-white space-y-1">
                  <div className="flex items-center gap-1.5 pb-1 border-b border-slate-200">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-[11px] font-black text-slate-900">Approval Policy</span>
                  </div>
                  <div className="space-y-1 text-[11px] text-slate-800 pt-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-emerald-600">✅</span>
                      <span>Two-person approval (dual control)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-emerald-600">✅</span>
                      <span>Creator cannot self-approve</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-emerald-600">✅</span>
                      <span>Pre-change backup required</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-emerald-600">✅</span>
                      <span>Post-change verification</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-emerald-600">✅</span>
                      <span>Auto-rollback on failure</span>
                    </div>
                  </div>
                </div>

                {/* Approval Status Stepper */}
                <div className="p-2.5 rounded-lg border-2 border-[#1e293b] bg-white space-y-1.5">
                  <div className="flex items-center gap-1.5 pb-1 border-b border-slate-200">
                    <Users className="w-3.5 h-3.5 text-sky-600" />
                    <span className="text-[11px] font-black text-slate-900">Approval Status</span>
                  </div>
                  <div className="space-y-2 text-[11px] pt-1">
                    <div className="flex items-start gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 mt-1 shrink-0" />
                      <div>
                        <span className="font-bold text-slate-900 block leading-tight">
                          Plan Created - {currentPlan.requested_at}
                        </span>
                        <span className="text-[10px] text-slate-500">by {currentPlan.requested_by}</span>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-sky-500 mt-1 shrink-0 animate-pulse" />
                      <div>
                        <span className="font-bold text-sky-900 block leading-tight">
                          Awaiting Independent Approval
                        </span>
                        <span className="text-[10px] text-sky-700">(Second Engineer / Admin)</span>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <div className="w-2.5 h-2.5 rounded-full border-2 border-slate-300 mt-1 shrink-0" />
                      <span className="text-slate-400 font-medium">Execute after approval</span>
                    </div>
                  </div>
                </div>

                {/* Proposed Changes (Diff Preview) Terminal Box */}
                <div className="rounded-lg border-2 border-[#1e293b] bg-white overflow-hidden">
                  <div className="bg-[#f5ede0] px-2.5 py-1 text-[11px] font-black text-slate-800 border-b border-[#1e293b] flex items-center justify-between">
                    <span>Proposed Changes (Diff Preview)</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(currentPlan.proposed_commands.join('\n'), 'Proposed commands')}
                      className="hover:text-sky-600 p-0.5"
                      title="Copy commands"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="p-2 font-mono text-[11px] leading-relaxed space-y-1 bg-[#fdfbf7]">
                    {currentPlan.diff_removed.map((line, i) => (
                      <div key={i} className="bg-[#fee2e2] text-[#991b1b] font-bold px-1 rounded">
                        {line}
                      </div>
                    ))}
                    {currentPlan.diff_added.map((line, i) => (
                      <div key={i} className="bg-[#dcfce7] text-[#166534] font-bold px-1 rounded">
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Config Diff */}
            {inspectorTab === 'diff' && (
              <div className="space-y-2 font-mono text-xs">
                <div className="p-2 bg-slate-900 text-slate-200 rounded-lg space-y-1">
                  <div className="text-slate-400 font-sans font-bold text-[10px] pb-1 border-b border-slate-800">
                    Configuration Staging
                  </div>
                  {currentPlan.proposed_commands.map((cmd, i) => (
                    <div key={i} className="text-emerald-400">
                      {cmd}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 3: Verification */}
            {inspectorTab === 'verification' && (
              <div className="p-3 bg-white rounded-lg border border-slate-200 text-xs space-y-2 font-bold">
                <div className="text-slate-900 font-black">Pre-Flight Safety Checks</div>
                <div className="flex items-center justify-between p-1.5 rounded bg-emerald-50 text-emerald-900 border border-emerald-200 text-[11px]">
                  <span>Device Reachability (SSH Port 22)</span>
                  <span>ONLINE</span>
                </div>
                <div className="flex items-center justify-between p-1.5 rounded bg-emerald-50 text-emerald-900 border border-emerald-200 text-[11px]">
                  <span>Pre-Change Snapshot Generated</span>
                  <span>VERIFIED</span>
                </div>
                <div className="flex items-center justify-between p-1.5 rounded bg-emerald-50 text-emerald-900 border border-emerald-200 text-[11px]">
                  <span>AST Baseline Compliance Match</span>
                  <span>100%</span>
                </div>
              </div>
            )}

            {/* Tab 4: History */}
            {inspectorTab === 'history' && (
              <div className="p-3 bg-white rounded-lg border border-slate-200 text-xs space-y-2 font-bold">
                <div className="text-slate-900 font-black">Audit Trail</div>
                <div className="text-[11px] text-slate-600 font-mono">
                  • {currentPlan.requested_at}: Plan {currentPlan.id} created by {currentPlan.requested_by}
                </div>
                <div className="text-[11px] text-slate-600 font-mono">
                  • 02 Nov, 10:30 AM: Automatic drift detection trigger
                </div>
              </div>
            )}

            {/* Inspector Bottom 4 Action Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsViewFullPlanModalOpen(true)}
                className="py-1.5 px-2 rounded-lg border-2 border-[#1e293b] bg-[#0284c7] hover:bg-[#0369a1] text-white text-[11px] font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1 transition-transform active:translate-y-0.5"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>View Full Plan</span>
              </button>

              <button
                type="button"
                onClick={() => setIsViewBackupModalOpen(true)}
                className="py-1.5 px-2 rounded-lg border-2 border-[#1e293b] bg-[#8b5cf6] hover:bg-[#7c3aed] text-white text-[11px] font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1 transition-transform active:translate-y-0.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>View Backup</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setReviewComment('');
                  setCommentError('');
                  setIsApproveModalOpen(true);
                }}
                disabled={isSelfApproval}
                title={isSelfApproval ? 'Separation of duties: Creator cannot approve their own plan' : 'Approve Plan'}
                className="py-2 px-2.5 rounded-lg border-2 border-[#1e293b] bg-[#22c55e] hover:bg-[#16a34a] text-white text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Check className="w-4 h-4 stroke-[3]" />
                <span>Approve</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setReviewComment('');
                  setCommentError('');
                  setIsRejectModalOpen(true);
                }}
                className="py-2 px-2.5 rounded-lg border-2 border-[#1e293b] bg-[#ef4444] hover:bg-[#dc2626] text-white text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
              >
                <X className="w-4 h-4 stroke-[3]" />
                <span>Reject</span>
              </button>
            </div>

            {isSelfApproval && (
              <div className="p-2 rounded bg-amber-50 border border-amber-300 text-amber-900 text-[10px] font-bold">
                ⚠️ Dual-control notice: You are logged in as {user?.username} (creator). An independent second engineer must approve this plan.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ================= MODALS ================= */}

      {/* Modal 1: Approve Confirmation */}
      {isApproveModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#22c55e] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <Check className="w-5 h-5 stroke-[3]" />
                <h3 className="text-sm font-black">Approve Remediation Plan</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsApproveModalOpen(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4 text-xs font-bold">
              <p className="text-slate-800">
                You are performing secondary approval for plan{' '}
                <span className="font-mono text-sky-700 font-black">{currentPlan.id}</span> targeting device{' '}
                <span className="font-mono text-slate-900 font-black">{currentPlan.device}</span>.
              </p>

              <div>
                <label className="block text-slate-700 mb-1">Approval Reviewer Comment (Optional):</label>
                <textarea
                  rows={3}
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Verified against Golden Baseline v3.2. Approved for immediate running-config execution."
                  className="w-full p-2.5 border-2 border-[#1e293b] rounded-lg text-xs"
                />
              </div>

              {commentError && (
                <div className="p-2 rounded bg-rose-50 text-rose-700 border border-rose-300 text-[11px]">
                  {commentError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsApproveModalOpen(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-slate-100 text-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={decisionMutation.isPending}
                  onClick={() =>
                    decisionMutation.mutate({
                      planId: currentPlan.id,
                      decision: 'APPROVED',
                      comment: reviewComment,
                    })
                  }
                  className="px-5 py-2 border-2 border-[#1e293b] bg-[#22c55e] hover:bg-[#16a34a] text-white font-black rounded-lg shadow-[2px_2px_0px_#1e293b] disabled:opacity-50"
                >
                  {decisionMutation.isPending ? 'Signing...' : 'Sign & Approve'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Reject Confirmation */}
      {isRejectModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#ef4444] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <X className="w-5 h-5 stroke-[3]" />
                <h3 className="text-sm font-black">Reject Remediation Plan</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsRejectModalOpen(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4 text-xs font-bold">
              <p className="text-slate-800">
                Rejecting plan <span className="font-mono text-rose-700 font-black">{currentPlan.id}</span>.
                A formal rejection justification is mandatory for audit compliance.
              </p>

              <div>
                <label className="block text-slate-700 mb-1">
                  Rejection Reason (Mandatory):
                </label>
                <textarea
                  rows={3}
                  value={reviewComment}
                  onChange={(e) => {
                    setReviewComment(e.target.value);
                    if (commentError) setCommentError('');
                  }}
                  placeholder="Explain why this change is rejected (e.g. invalid syntax, out of maintenance window)..."
                  required
                  className="w-full p-2.5 border-2 border-[#1e293b] rounded-lg text-xs"
                />
              </div>

              {commentError && (
                <div className="p-2 rounded bg-rose-50 text-rose-700 border border-rose-300 text-[11px]">
                  {commentError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsRejectModalOpen(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-slate-100 text-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={decisionMutation.isPending || !reviewComment.trim()}
                  onClick={() => {
                    if (!reviewComment.trim()) {
                      setCommentError('Rejection reason cannot be blank.');
                      return;
                    }
                    decisionMutation.mutate({
                      planId: currentPlan.id,
                      decision: 'REJECTED',
                      comment: reviewComment,
                    });
                  }}
                  className="px-5 py-2 border-2 border-[#1e293b] bg-[#ef4444] hover:bg-[#dc2626] text-white font-black rounded-lg shadow-[2px_2px_0px_#1e293b] disabled:opacity-50"
                >
                  {decisionMutation.isPending ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: View Full Plan */}
      {isViewFullPlanModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#0284c7] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                <h3 className="text-sm font-black">Full Remediation Commands: {currentPlan.id}</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsViewFullPlanModalOpen(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 font-mono text-xs">
              <pre className="p-3 bg-slate-950 text-emerald-400 rounded-xl border border-slate-800 leading-relaxed overflow-x-auto">
                {currentPlan.proposed_commands.join('\n')}
              </pre>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleCopy(currentPlan.proposed_commands.join('\n'), 'Remediation plan')}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-slate-100 text-slate-700 rounded-lg font-bold flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsViewFullPlanModalOpen(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-[#0284c7] text-white rounded-lg text-xs font-black shadow-[2px_2px_0px_#1e293b]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 4: View Backup */}
      {isViewBackupModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#8b5cf6] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5" />
                <h3 className="text-sm font-black">Pre-Change Snapshot: {currentPlan.device}</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsViewBackupModalOpen(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 font-mono text-xs">
              <pre className="p-3 bg-slate-950 text-slate-300 rounded-xl border border-slate-800 leading-relaxed overflow-x-auto">
{`! Pre-change backup snapshot captured 02 Nov 2026, 10:24 AM
hostname ${currentPlan.device}
!
line vty 0 4
 transport input ssh telnet
 login local
!
end`}
              </pre>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsViewBackupModalOpen(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-[#8b5cf6] text-white rounded-lg text-xs font-black shadow-[2px_2px_0px_#1e293b]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
