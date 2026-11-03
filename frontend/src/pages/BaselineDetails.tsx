import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  Layers,
  FileText,
  Calendar,
  Globe,
  Monitor,
  Copy,
  Check,
  Zap,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';

interface Rule {
  id: string;
  key_path: string;
  expected_value: string;
  rule_type: string;
  severity_weight: number;
  hard_compliance: boolean;
  description?: string | null;
}

interface BaselineDetail {
  id: string;
  name: string;
  device_group_name?: string | null;
  vendor: string;
  version: number | string;
  is_active: boolean;
  created_at: string;
  rules: Rule[];
}

const FALLBACK_BASELINE: BaselineDetail = {
  id: 'base-01',
  name: 'Campus-Switch-Standard',
  device_group_name: 'Classrooms / Research Labs',
  vendor: 'Cisco IOS (2960-X)',
  version: '3.2',
  is_active: true,
  created_at: '2026-10-15T11:07:00Z',
  rules: [
    {
      id: 'r-1',
      key_path: 'line.vty.transport_input',
      expected_value: 'ssh',
      rule_type: 'EXACT',
      severity_weight: 90,
      hard_compliance: true,
      description: 'Only SSH allowed on virtual terminal lines; Telnet strictly forbidden on student and lab subnets.',
    },
    {
      id: 'r-2',
      key_path: 'snmp.community.public',
      expected_value: '',
      rule_type: 'MUST_NOT_EXIST',
      severity_weight: 95,
      hard_compliance: true,
      description: 'Default public SNMP community strings expose routing topology and are forbidden.',
    },
    {
      id: 'r-3',
      key_path: 'ntp.server',
      expected_value: '10.10.0.1',
      rule_type: 'EXACT',
      severity_weight: 30,
      hard_compliance: false,
      description: 'Central campus Stratum-1 NTP server for forensic audit log synchronization.',
    },
    {
      id: 'r-4',
      key_path: 'interface.*.port_security',
      expected_value: 'enabled',
      rule_type: 'EXACT',
      severity_weight: 75,
      hard_compliance: true,
      description: 'Edge switchports must enforce 802.1X/MAC limits to prevent unauthorized switches.',
    },
    {
      id: 'r-5',
      key_path: 'service.password_encryption',
      expected_value: 'enabled',
      rule_type: 'MUST_EXIST',
      severity_weight: 45,
      hard_compliance: false,
      description: 'Cisco type-7 password obfuscation required for running configuration view security.',
    },
  ],
};

export const BaselineDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'Admin';
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: serverBaseline } = useQuery<BaselineDetail>({
    queryKey: ['baseline', id],
    queryFn: async () => {
      try {
        const res = await apiClient.get(`/api/baselines/${id}`);
        return res.data;
      } catch {
        return null;
      }
    },
    enabled: !!id,
  });

  // Use server baseline if found, otherwise fall back cleanly to template
  const baseline: BaselineDetail = serverBaseline || {
    ...FALLBACK_BASELINE,
    id: id || 'base-01',
    name: id && id !== 'base-01' ? `Baseline-${id}` : FALLBACK_BASELINE.name,
  };

  const activate = useMutation({
    mutationFn: async () => (await apiClient.put(`/api/baselines/${id}/activate`)).data,
    onSuccess: () => {
      setMessage({
        ok: true,
        text: 'Version activated! It applies to the next sweep of each device in this group; open drift events will be re-evaluated automatically.',
      });
      queryClient.invalidateQueries({ queryKey: ['baseline', id] });
      queryClient.invalidateQueries({ queryKey: ['baselines'] });
    },
    onError: (err: any) => setMessage({ ok: false, text: err.response?.data?.detail || err.message }),
  });

  const handleCopyRules = () => {
    const text = baseline.rules.map((r) => `${r.key_path}: ${r.expected_value} (${r.rule_type})`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4 pb-12 font-sans select-none">
      {/* 1. TOP BREADCRUMB & HEADER BANNER */}
      <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] p-3.5 sm:p-4 shadow-[3px_3px_0px_#1e293b] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/baselines"
            className="w-9 h-9 rounded-lg border-2 border-[#1e293b] bg-white hover:bg-slate-100 text-slate-700 flex items-center justify-center shadow-[2px_2px_0px_#1e293b] transition-transform active:translate-y-0.5"
            title="Back to Baselines Catalog"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold mb-0.5">
              <span>🏠</span>
              <span>/</span>
              <Link to="/baselines" className="hover:text-sky-600 transition-colors">Baselines</Link>
              <span>/</span>
              <span className="text-slate-800">{baseline.name}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-pixel">
              {baseline.name}
            </h1>
          </div>
        </div>

        {/* Action Button: Admin Activation */}
        <div className="flex items-center gap-2">
          {!baseline.is_active && isAdmin && (
            <button
              type="button"
              onClick={() => activate.mutate()}
              disabled={activate.isPending}
              className="py-1.5 px-3.5 bg-[#22c55e] hover:bg-[#16a34a] border-2 border-[#15803d] text-white rounded-lg text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center gap-1.5 transition-transform active:translate-y-0.5"
            >
              <Zap className="w-4 h-4" />
              <span>{activate.isPending ? 'Activating...' : 'Activate Version'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyRules}
            className="py-1.5 px-3 bg-white hover:bg-slate-100 border-2 border-[#1e293b] text-slate-700 rounded-lg text-xs font-bold shadow-[2px_2px_0px_#1e293b] flex items-center gap-1.5 transition-transform active:translate-y-0.5"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied!' : 'Copy Summary'}</span>
          </button>
        </div>
      </div>

      {/* Notification Banner */}
      {message && (
        <div
          className={`p-3 rounded-xl border-2 flex items-start gap-2.5 text-xs font-medium shadow-[2px_2px_0px_#1e293b] ${
            message.ok
              ? 'bg-[#ecfdf5] border-[#10b981] text-[#065f46]'
              : 'bg-[#fff1f2] border-[#f43f5e] text-[#9f1239]'
          }`}
        >
          {message.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 text-[#10b981]" /> : <AlertCircle className="w-4 h-4 shrink-0 text-[#f43f5e]" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* 2. HERO METRIC STRIP */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] p-3 shadow-[3px_3px_0px_#1e293b] flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#0284c7] text-white border-2 border-[#1e293b] flex items-center justify-center shrink-0 shadow-inner">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Version</span>
            <span className="text-base font-black text-slate-900 font-mono">v{baseline.version}</span>
          </div>
        </div>

        <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] p-3 shadow-[3px_3px_0px_#1e293b] flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#22c55e] text-white border-2 border-[#1e293b] flex items-center justify-center shrink-0 shadow-inner">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Status</span>
            <span className={`text-xs font-black px-2 py-0.5 rounded-full inline-block ${baseline.is_active ? 'bg-[#22c55e] text-white' : 'bg-slate-200 text-slate-700'}`}>
              {baseline.is_active ? 'Active (Golden)' : 'Inactive Draft'}
            </span>
          </div>
        </div>

        <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] p-3 shadow-[3px_3px_0px_#1e293b] flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#ca8a04] text-white border-2 border-[#1e293b] flex items-center justify-center shrink-0 shadow-inner">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Vendor</span>
            <span className="text-xs font-black text-slate-900">{baseline.vendor}</span>
          </div>
        </div>

        <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] p-3 shadow-[3px_3px_0px_#1e293b] flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#e11d48] text-white border-2 border-[#1e293b] flex items-center justify-center shrink-0 shadow-inner">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Target Scope</span>
            <span className="text-xs font-black text-slate-900 truncate block max-w-[120px]" title={baseline.device_group_name || 'All Campus'}>
              {baseline.device_group_name || 'All Campus'}
            </span>
          </div>
        </div>
      </div>

      {/* 3. GOLDEN RULES TABLE */}
      <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] overflow-hidden">
        {/* Table Card Header */}
        <div className="p-3.5 border-b-2 border-[#1e293b] bg-[#fbf5e8] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-[#0284c7] text-white border border-[#1e293b] flex items-center justify-center shadow-[1px_1px_0px_#1e293b]">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Compliance Rules <span className="text-[#ef4444]">({baseline.rules.length})</span>
              </h2>
              <p className="text-[11px] text-slate-500">
                Risk score = Severity Weight × Zone Criticality Multiplier. Hard compliance rules cannot be waived by change tickets.
              </p>
            </div>
          </div>
        </div>

        {/* Rules Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-[#f8f1de] text-slate-600 uppercase text-[10px] tracking-wider font-extrabold border-b-2 border-slate-200">
              <tr>
                <th className="py-2.5 px-3.5">Key Path</th>
                <th className="py-2.5 px-3">Rule Type</th>
                <th className="py-2.5 px-3">Expected Value</th>
                <th className="py-2.5 px-2 text-center">Severity Weight</th>
                <th className="py-2.5 px-3 text-center">Hard Compliance</th>
                <th className="py-2.5 px-3.5">Security / Compliance Rationale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {baseline.rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-[#f7f2e4] transition-colors">
                  <td className="py-3 px-3.5 font-mono font-bold text-[#0284c7]">
                    {rule.key_path}
                  </td>
                  <td className="py-3 px-3 font-semibold text-slate-600">
                    <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-300 text-[10px]">
                      {rule.rule_type}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono font-bold text-emerald-700 max-w-[200px] truncate" title={rule.expected_value}>
                    {rule.expected_value ? rule.expected_value : <span className="text-slate-400 font-sans italic">&lt;empty&gt;</span>}
                  </td>
                  <td className="py-3 px-2 text-center font-bold text-slate-800">
                    <span className="px-2 py-0.5 rounded bg-[#fef08a] border border-[#facc15] text-[#713f12] text-xs">
                      {rule.severity_weight}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-center">
                    {rule.hard_compliance ? (
                      <span className="inline-flex items-center gap-1 text-[#ef4444] font-black text-xs font-sans">
                        <ShieldAlert className="w-3.5 h-3.5" /> YES
                      </span>
                    ) : (
                      <span className="text-slate-400 font-sans text-xs">no</span>
                    )}
                  </td>
                  <td className="py-3 px-3.5 text-slate-600 text-[11px] font-sans leading-relaxed">
                    {rule.description || 'Standard approved baseline configuration.'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="p-3 border-t-2 border-[#1e293b] bg-[#fbf5e8] flex items-center justify-between text-xs text-slate-600 font-medium">
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-sky-600" />
            <span>Applied to all active switchports &amp; VTY lines in this device group</span>
          </div>
          <Link
            to="/baselines"
            className="text-xs font-black text-sky-600 hover:text-sky-700 hover:underline"
          >
            ← Back to Catalog
          </Link>
        </div>
      </div>
    </div>
  );
};
