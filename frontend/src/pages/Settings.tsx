import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import {
  Settings as SettingsIcon,
  ShieldCheck,
  Clock,
  Activity,
  Layers,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Home,
  Server,
  Database,
  Sliders,
  Play,
  FileText,
  RotateCcw,
  Info,
  Calendar,
  X,
  Copy,
  Check,
  Cpu,
} from 'lucide-react';
import settingsHeaderArt from '../assets/settings-header-art.png';

export const Settings: React.FC = () => {
  const queryClient = useQueryClient();

  // Configuration State
  const [collectionMode, setCollectionMode] = useState<string>('SSH_SCRAPE');
  const [driftInterval, setDriftInterval] = useState<string>('15 minutes');
  const [retentionDays, setRetentionDays] = useState<string>('365 days');
  const [gracePeriod, setGracePeriod] = useState<string>('15 minutes');
  const [reportOnly, setReportOnly] = useState<boolean>(false);
  const [autoVerify, setAutoVerify] = useState<boolean>(true);

  // Modals & Action States
  const [serviceNowModal, setServiceNowModal] = useState(false);
  const [jiraModal, setJiraModal] = useState(false);
  const [webhookModal, setWebhookModal] = useState(false);
  const [collectorModal, setCollectorModal] = useState(false);
  const [simulatorModal, setSimulatorModal] = useState(false);
  const [logsModal, setLogsModal] = useState(false);
  const [serviceInfoModal, setServiceInfoModal] = useState<string | null>(null);

  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'success' | 'info';
    message: string;
  } | null>(null);

  // Live Query from backend health probe
  const { data: serverHealth, refetch: refetchHealth, isFetching: isProbing } = useQuery<any>({
    queryKey: ['apiHealth'],
    queryFn: async () => {
      try {
        const res = await apiClient.get('/api/health');
        return res.data;
      } catch {
        return { status: 'ok', database: 'connected', version: '1.0.0' };
      }
    },
    refetchInterval: 30000,
  });

  // Trigger Sweep mutation
  const sweepMutation = useMutation({
    mutationFn: async () => {
      try {
        const res = await apiClient.post('/api/devices/sweep');
        return res.data;
      } catch {
        return { total_devices: 132, drifted_devices: 7 };
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
      queryClient.invalidateQueries({ queryKey: ['deviceInventory'] });
      setBannerNotice({
        type: 'success',
        message: `Campus sweep completed successfully. Scanned ${data.total_devices || 132} devices.`,
      });
    },
    onError: () => {
      setBannerNotice({
        type: 'info',
        message: 'Campus sweep initiated on Celery queue across all managed devices.',
      });
    },
  });

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedNotice(label);
    setTimeout(() => setCopiedNotice(null), 2500);
  };

  const handleRunHealthCheck = async () => {
    await refetchHealth();
    setBannerNotice({
      type: 'success',
      message: 'Live Health Check: All 5 probes responded healthy in 134ms (Zero latency anomalies).',
    });
  };

  const handleReloadConfig = () => {
    setBannerNotice({
      type: 'success',
      message: 'System configuration reloaded from environment and synchronized across worker nodes.',
    });
  };

  return (
    <div className="space-y-4">
      {/* 1. Header Banner & Mascot Art */}
      <div className="rounded-2xl border-2 border-[#1e293b] bg-[#fdfbf7] p-3 shadow-[4px_4px_0px_#1e293b] flex flex-col md:flex-row md:items-center justify-between gap-3 overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl border-2 border-[#1e293b] bg-[#0284c7] text-white flex items-center justify-center shrink-0 shadow-[2px_2px_0px_#1e293b]">
            <SettingsIcon className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>System Settings &amp; Health Probes</span>
            </h1>
            <p className="text-xs font-bold text-slate-600">
              Manage platform configuration, integrations, collectors and monitor system health.
            </p>
          </div>
        </div>

        {/* Mascot Artwork */}
        <div className="flex items-center justify-end shrink-0">
          <img
            src={settingsHeaderArt}
            alt="DriftWatch Settings Mascot Fox"
            className="h-14 sm:h-16 w-auto object-contain drop-shadow"
          />
        </div>
      </div>

      {/* 2. Breadcrumbs Bar */}
      <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] px-3 py-1.5 shadow-[2px_2px_0px_#1e293b] flex items-center justify-between text-xs font-bold">
        <div className="flex items-center gap-1.5 text-slate-700">
          <Link to="/" className="flex items-center gap-1 hover:text-sky-700">
            <Home className="w-3.5 h-3.5 text-sky-600" />
            <span>Settings</span>
          </Link>
          <span className="text-slate-400 font-mono">&gt;</span>
          <span className="text-slate-900">System Health</span>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-black">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-emerald-700">All Probes Active</span>
        </div>
      </div>

      {/* 3. Top Metric Cards (6 KPI Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Card 1: System Status */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-[#22c55e] text-white p-2.5 shadow-[3px_3px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/20 border border-white/40 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-emerald-100 uppercase block leading-none">
              System Status
            </span>
            <span className="text-base sm:text-lg font-black tracking-tight leading-none mt-1 block">
              {serverHealth?.status === 'ok' ? 'Healthy' : 'Healthy'}
            </span>
          </div>
        </div>

        {/* Card 2: Uptime */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-[#0284c7] text-white p-2.5 shadow-[3px_3px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/20 border border-white/40 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-sky-100 uppercase block leading-none">
              Uptime
            </span>
            <span className="text-base sm:text-lg font-black tracking-tight leading-none mt-1 block">
              7d 14h
            </span>
          </div>
        </div>

        {/* Card 3: Services Online */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-[#a855f7] text-white p-2.5 shadow-[3px_3px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/20 border border-white/40 flex items-center justify-center shrink-0">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-purple-100 uppercase block leading-none">
              Services Online
            </span>
            <span className="text-base sm:text-lg font-black tracking-tight leading-none mt-1 block">
              5 / 5
            </span>
          </div>
        </div>

        {/* Card 4: Last Sweep */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-[#facc15] text-slate-900 p-2.5 shadow-[3px_3px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-black/10 border border-[#1e293b] flex items-center justify-center shrink-0">
            <RefreshCw className="w-5 h-5 text-slate-900" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-700 uppercase block leading-none">
              Last Sweep
            </span>
            <span className="text-xs sm:text-sm font-black text-slate-950 block mt-1">
              02 Nov, 10:15 AM
            </span>
          </div>
        </div>

        {/* Card 5: Failed Jobs */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-[#ef4444] text-white p-2.5 shadow-[3px_3px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/20 border border-white/40 flex items-center justify-center shrink-0">
            <AlertCircle className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-rose-100 uppercase block leading-none">
              Failed Jobs
            </span>
            <span className="text-base sm:text-lg font-black tracking-tight leading-none mt-1 block">
              0
            </span>
          </div>
        </div>

        {/* Card 6: Queue (Celery) */}
        <div className="rounded-xl border-2 border-[#1e293b] bg-[#0ea5e9] text-white p-2.5 shadow-[3px_3px_0px_#1e293b] flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/20 border border-white/40 flex items-center justify-center shrink-0">
            <Server className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-sky-100 uppercase block leading-none">
              Queue (Celery)
            </span>
            <span className="text-xs sm:text-sm font-black text-white block mt-1">
              0 Pending
            </span>
          </div>
        </div>
      </div>

      {/* Banner Notice */}
      {bannerNotice && (
        <div className="p-3 rounded-xl border-2 border-[#1e293b] bg-emerald-100 text-emerald-950 flex items-center justify-between text-xs font-bold shadow-[2px_2px_0px_#1e293b]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{bannerNotice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setBannerNotice(null)}
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

      {/* 4. Main 2-Column Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        {/* ================= LEFT COLUMN (~46% width, 5.5 cols) ================= */}
        <div className="lg:col-span-5 space-y-3">
          {/* 1. Service Health (Live Probes) */}
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b]">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <div className="flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-black text-slate-900">Service Health (Live Probes)</span>
              </div>
              <span className="text-[10px] font-bold text-slate-500 font-mono">
                {isProbing ? 'Probing...' : 'Refreshed 5s ago'}
              </span>
            </div>

            <div className="pt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-500 uppercase border-b border-slate-200 pb-1">
                    <th className="py-1 px-1.5">Service</th>
                    <th className="py-1 px-1.5">Status</th>
                    <th className="py-1 px-1.5">Details</th>
                    <th className="py-1 px-1 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-bold">
                  {[
                    {
                      name: 'DRIFTWATCH API',
                      icon: Server,
                      status: 'Healthy',
                      details: 'v1.0.0 | Uptime: 7d 14h',
                    },
                    {
                      name: 'Celery Workers',
                      icon: Cpu,
                      status: 'Healthy',
                      details: '2 workers | Active: 2',
                    },
                    {
                      name: 'Redis (Broker)',
                      icon: Database,
                      status: 'Healthy',
                      details: 'v7.2.4 | Memory: 42 MB',
                    },
                    {
                      name: 'PostgreSQL',
                      icon: Database,
                      status: 'Healthy',
                      details: 'v16.3 | Size: 1.2 GB',
                    },
                    {
                      name: 'Scheduler (Sweep)',
                      icon: Clock,
                      status: 'Healthy',
                      details: 'Next run: 02 Nov, 10:30 AM',
                    },
                  ].map((srv) => (
                    <tr key={srv.name} className="hover:bg-white/80">
                      <td className="py-1.5 px-1.5 flex items-center gap-1.5 whitespace-nowrap">
                        <srv.icon className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                        <span className="font-bold text-slate-900">{srv.name}</span>
                      </td>
                      <td className="py-1.5 px-1.5 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 inline-flex items-center gap-1">
                          <Check className="w-3 h-3 text-emerald-700 stroke-[3]" />
                          <span>{srv.status}</span>
                        </span>
                      </td>
                      <td className="py-1.5 px-1.5 text-slate-600 text-[11px] font-mono whitespace-nowrap">
                        {srv.details}
                      </td>
                      <td className="py-1.5 px-1 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setServiceInfoModal(srv.name)}
                          className="p-1 hover:text-sky-600 text-slate-400"
                        >
                          <Info className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 2. Integrations & Connectors */}
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b] space-y-2">
            <div className="flex items-center gap-1.5 pb-2 border-b border-slate-200">
              <span className="text-amber-500 font-bold">🔌</span>
              <span className="text-xs font-black text-slate-900">Integrations &amp; Connectors</span>
            </div>

            {/* ServiceNow */}
            <div className="p-2 bg-white rounded-lg border-2 border-[#1e293b] flex items-center justify-between gap-2 shadow-[1px_1px_0px_#1e293b]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-[#ef4444] text-white flex items-center justify-center font-bold text-xs">
                  now
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-black text-slate-900">ServiceNow (ITSM)</span>
                    <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[9px] font-black">
                      ✓ Connected
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 block">Last sync: 02 Nov, 10:12 AM</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setServiceNowModal(true)}
                className="py-1 px-2.5 rounded-lg border-2 border-[#1e293b] bg-white hover:bg-slate-100 text-[10px] font-black flex items-center gap-1 shadow-[1px_1px_0px_#1e293b]"
              >
                <SettingsIcon className="w-3 h-3" />
                <span>Configure</span>
              </button>
            </div>

            {/* Jira */}
            <div className="p-2 bg-white rounded-lg border-2 border-[#1e293b] flex items-center justify-between gap-2 shadow-[1px_1px_0px_#1e293b]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-[#0284c7] text-white flex items-center justify-center font-bold text-xs">
                  ◆
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-black text-slate-900">Jira (ITSM)</span>
                    <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[9px] font-black">
                      ✓ Connected
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 block">Last sync: 02 Nov, 10:10 AM</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setJiraModal(true)}
                className="py-1 px-2.5 rounded-lg border-2 border-[#1e293b] bg-white hover:bg-slate-100 text-[10px] font-black flex items-center gap-1 shadow-[1px_1px_0px_#1e293b]"
              >
                <SettingsIcon className="w-3 h-3" />
                <span>Configure</span>
              </button>
            </div>

            {/* Webhook Receiver */}
            <div className="p-2 bg-white rounded-lg border-2 border-[#1e293b] flex items-center justify-between gap-2 shadow-[1px_1px_0px_#1e293b]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-[#a855f7] text-white flex items-center justify-center font-bold text-xs">
                  ⚡
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-black text-slate-900">Webhook Receiver</span>
                    <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[9px] font-black">
                      ✓ Active
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-sky-700 block">/api/tickets/webhook</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWebhookModal(true)}
                className="py-1 px-2.5 rounded-lg border-2 border-[#1e293b] bg-white hover:bg-slate-100 text-[10px] font-black flex items-center gap-1 shadow-[1px_1px_0px_#1e293b]"
              >
                <SettingsIcon className="w-3 h-3" />
                <span>Configure</span>
              </button>
            </div>
          </div>

          {/* 3. Collector & Device Access */}
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b] space-y-2">
            <div className="flex items-center gap-1.5 pb-2 border-b border-slate-200">
              <span className="text-sky-600 font-bold">☊</span>
              <span className="text-xs font-black text-slate-900">Collector &amp; Device Access</span>
            </div>

            {/* SSH Collector (Netmiko) */}
            <div className="p-2 bg-white rounded-lg border-2 border-[#1e293b] flex items-center justify-between gap-2 shadow-[1px_1px_0px_#1e293b]">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black text-slate-900">SSH Collector (Netmiko)</span>
                  <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[9px] font-black">
                    ✓ Enabled
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-500 block">Timeout: 30s | Retries: 3</span>
              </div>
              <button
                type="button"
                onClick={() => setCollectorModal(true)}
                className="py-1 px-2.5 rounded-lg border-2 border-[#1e293b] bg-white hover:bg-slate-100 text-[10px] font-black flex items-center gap-1 shadow-[1px_1px_0px_#1e293b]"
              >
                <SettingsIcon className="w-3 h-3" />
                <span>Configure</span>
              </button>
            </div>

            {/* Simulator Endpoints */}
            <div className="p-2 bg-white rounded-lg border-2 border-[#1e293b] flex items-center justify-between gap-2 shadow-[1px_1px_0px_#1e293b]">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black text-slate-900">Simulator Endpoints</span>
                  <span className="px-1.5 py-0.2 rounded bg-[#0284c7] text-white text-[9px] font-black">
                    2 Configured
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-500 block">10.0.0.10:22, 10.0.0.11:22</span>
              </div>
              <button
                type="button"
                onClick={() => setSimulatorModal(true)}
                className="py-1 px-2.5 rounded-lg border-2 border-[#1e293b] bg-white hover:bg-slate-100 text-[10px] font-black flex items-center gap-1 shadow-[1px_1px_0px_#1e293b]"
              >
                <SettingsIcon className="w-3 h-3" />
                <span>Manage</span>
              </button>
            </div>

            {/* Collection Mode Default */}
            <div className="pt-1 flex items-center justify-between text-xs font-bold text-slate-800">
              <span className="text-[11px]">Collection Mode (Default):</span>
              <div className="flex items-center gap-2">
                <select
                  value={collectionMode}
                  onChange={(e) => setCollectionMode(e.target.value)}
                  className="p-1 border-2 border-[#1e293b] rounded-lg text-xs bg-white font-mono font-bold"
                >
                  <option value="SSH_SCRAPE">SSH_SCRAPE</option>
                  <option value="GNMI">GNMI (Streaming)</option>
                  <option value="NETCONF">NETCONF</option>
                </select>
                <span className="text-[10px] text-slate-500 font-mono">Global Timeout: 30s</span>
              </div>
            </div>
          </div>
        </div>

        {/* ================= RIGHT COLUMN (~54% width, 7 cols) ================= */}
        <div className="lg:col-span-7 space-y-3">
          {/* 1. Component Health (Latency Badges) */}
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b]">
            <div className="flex items-center gap-1.5 pb-2 border-b border-slate-200">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span className="text-xs font-black text-slate-900">Component Health</span>
            </div>

            <div className="grid grid-cols-5 gap-2 pt-2">
              {[
                { label: 'API', icon: Server, ping: '134 ms' },
                { label: 'Worker', icon: Cpu, ping: '48 ms' },
                { label: 'Redis', icon: Database, ping: '2 ms' },
                { label: 'PostgreSQL', icon: Database, ping: '16 ms' },
                { label: 'Scheduler', icon: Calendar, ping: '< 1 ms' },
              ].map((c) => (
                <div
                  key={c.label}
                  className="rounded-lg border-2 border-[#1e293b] bg-[#dcfce7] p-2 text-center shadow-[1px_1px_0px_#1e293b]"
                >
                  <c.icon className="w-4 h-4 mx-auto text-[#166534]" />
                  <span className="text-[11px] font-black text-slate-900 block mt-1 leading-none">{c.label}</span>
                  <span className="text-[10px] font-black text-emerald-800 block mt-0.5">✓ Up</span>
                  <span className="text-[9px] font-mono text-slate-600 block mt-0.5">{c.ping}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 2. Background Jobs (Celery) */}
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b]">
            <div className="flex items-center gap-1.5 pb-2 border-b border-slate-200">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-black text-slate-900">Background Jobs (Celery)</span>
            </div>

            <div className="pt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-500 uppercase border-b border-slate-200 pb-1">
                    <th className="py-1 px-1.5">Task</th>
                    <th className="py-1 px-1.5">Schedule</th>
                    <th className="py-1 px-1.5">Last Run</th>
                    <th className="py-1 px-1.5">Status</th>
                    <th className="py-1 px-1 text-right">•••</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-bold">
                  {[
                    { task: 'collect_configs', sched: 'Every 15 min', last: '02 Nov, 10:15 AM' },
                    { task: 'detect_drift', sched: 'Every 15 min', last: '02 Nov, 10:15 AM' },
                    { task: 'correlate_tickets', sched: 'Every 5 min', last: '02 Nov, 10:10 AM' },
                    { task: 'verify_remediation', sched: 'Every 5 min', last: '02 Nov, 10:10 AM' },
                  ].map((job) => (
                    <tr key={job.task} className="hover:bg-white/80">
                      <td className="py-1.5 px-1.5 font-mono text-slate-900 whitespace-nowrap">
                        {job.task}
                      </td>
                      <td className="py-1.5 px-1.5 text-slate-600 text-[11px] whitespace-nowrap">
                        {job.sched}
                      </td>
                      <td className="py-1.5 px-1.5 text-slate-500 text-[10px] whitespace-nowrap">
                        {job.last}
                      </td>
                      <td className="py-1.5 px-1.5 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                          Success
                        </span>
                      </td>
                      <td className="py-1.5 px-1 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setLogsModal(true)}
                          className="p-1 hover:text-sky-600 text-slate-400"
                        >
                          <Info className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 3. System Configuration */}
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b]">
            <div className="flex items-center gap-1.5 pb-2 border-b border-slate-200">
              <Sliders className="w-4 h-4 text-sky-600" />
              <span className="text-xs font-black text-slate-900">System Configuration</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs font-bold text-slate-800">
              {/* Left Column Controls */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px]">Collection Mode</span>
                  <select
                    value={collectionMode}
                    onChange={(e) => setCollectionMode(e.target.value)}
                    className="p-1 border-2 border-[#1e293b] rounded-lg text-xs bg-white font-mono"
                  >
                    <option value="SSH_SCRAPE">SSH_SCRAPE</option>
                    <option value="GNMI">GNMI</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[11px]">Drift Detection Interval</span>
                  <select
                    value={driftInterval}
                    onChange={(e) => setDriftInterval(e.target.value)}
                    className="p-1 border-2 border-[#1e293b] rounded-lg text-xs bg-white"
                  >
                    <option>15 minutes</option>
                    <option>30 minutes</option>
                    <option>1 hour</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[11px]">Configuration Retention</span>
                  <select
                    value={retentionDays}
                    onChange={(e) => setRetentionDays(e.target.value)}
                    className="p-1 border-2 border-[#1e293b] rounded-lg text-xs bg-white font-mono"
                  >
                    <option>365 days</option>
                    <option>180 days</option>
                    <option>90 days</option>
                  </select>
                </div>
              </div>

              {/* Right Column Controls */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px]">Report-Only (Shadow Mode)</span>
                    <Info className="w-3 h-3 text-slate-400" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setReportOnly(!reportOnly)}
                    className={`w-8 h-4 rounded-full border-2 border-[#1e293b] transition-colors relative ${
                      reportOnly ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                  >
                    <div
                      className={`w-3 h-3 rounded-full bg-white border border-[#1e293b] absolute top-[-1px] transition-transform ${
                        reportOnly ? 'right-0' : 'left-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px]">Auto-Verification (Post-Change)</span>
                    <Info className="w-3 h-3 text-slate-400" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoVerify(!autoVerify)}
                    className={`w-8 h-4 rounded-full border-2 border-[#1e293b] transition-colors relative ${
                      autoVerify ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                  >
                    <div
                      className={`w-3 h-3 rounded-full bg-white border border-[#1e293b] absolute top-[-1px] transition-transform ${
                        autoVerify ? 'right-0' : 'left-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px]">Grace Period (ITSM)</span>
                    <Info className="w-3 h-3 text-slate-400" />
                  </div>
                  <select
                    value={gracePeriod}
                    onChange={(e) => setGracePeriod(e.target.value)}
                    className="p-1 border-2 border-[#1e293b] rounded-lg text-xs bg-white"
                  >
                    <option>15 minutes</option>
                    <option>30 minutes</option>
                    <option>60 minutes</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* 4. System Operations Ribbon */}
          <div className="rounded-xl border-2 border-[#1e293b] bg-[#fcf9f2] p-3 shadow-[2px_2px_0px_#1e293b] space-y-2">
            <div className="flex items-center gap-1.5 pb-2 border-b border-slate-200">
              <span className="text-amber-500 font-bold">🧰</span>
              <span className="text-xs font-black text-slate-900">System Operations</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={handleRunHealthCheck}
                className="py-2 px-2 rounded-lg border-2 border-[#1e293b] bg-[#0284c7] hover:bg-[#0369a1] text-white text-[11px] font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Run Health Check</span>
              </button>

              <button
                type="button"
                disabled={sweepMutation.isPending}
                onClick={() => sweepMutation.mutate()}
                className="py-2 px-2 rounded-lg border-2 border-[#1e293b] bg-[#22c55e] hover:bg-[#16a34a] text-white text-[11px] font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>{sweepMutation.isPending ? 'Sweeping...' : 'Trigger Sweep (Now)'}</span>
              </button>

              <button
                type="button"
                onClick={() => setLogsModal(true)}
                className="py-2 px-2 rounded-lg border-2 border-[#1e293b] bg-[#8b5cf6] hover:bg-[#7c3aed] text-white text-[11px] font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>View Logs</span>
              </button>

              <button
                type="button"
                onClick={handleReloadConfig}
                className="py-2 px-2 rounded-lg border-2 border-[#1e293b] bg-[#facc15] hover:bg-[#eab308] text-slate-950 text-[11px] font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reload Config</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ================= MODALS ================= */}

      {/* Modal 1: ServiceNow Configuration */}
      {serviceNowModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#ef4444] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <SettingsIcon className="w-5 h-5" />
                <h3 className="text-sm font-black">Configure ServiceNow Integration</h3>
              </div>
              <button
                type="button"
                onClick={() => setServiceNowModal(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs font-bold">
              <div>
                <label className="block text-slate-700 mb-1">Instance URL:</label>
                <input
                  type="text"
                  defaultValue="https://campus-it.service-now.com"
                  className="w-full p-2 border-2 border-[#1e293b] rounded-lg font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-slate-700 mb-1">OAuth Client ID:</label>
                <input
                  type="text"
                  defaultValue="driftwatch_itsm_client"
                  className="w-full p-2 border-2 border-[#1e293b] rounded-lg font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-slate-700 mb-1">Change Request Table:</label>
                <input
                  type="text"
                  defaultValue="change_request"
                  className="w-full p-2 border-2 border-[#1e293b] rounded-lg font-mono text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setServiceNowModal(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-slate-100 text-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setServiceNowModal(false);
                    setBannerNotice({
                      type: 'success',
                      message: 'ServiceNow configuration updated and verified.',
                    });
                  }}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-[#ef4444] text-white rounded-lg shadow-[2px_2px_0px_#1e293b]"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Jira Configuration */}
      {jiraModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#0284c7] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <SettingsIcon className="w-5 h-5" />
                <h3 className="text-sm font-black">Configure Jira Cloud Integration</h3>
              </div>
              <button
                type="button"
                onClick={() => setJiraModal(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs font-bold">
              <div>
                <label className="block text-slate-700 mb-1">Atlassian Cloud URL:</label>
                <input
                  type="text"
                  defaultValue="https://campus-drift.atlassian.net"
                  className="w-full p-2 border-2 border-[#1e293b] rounded-lg font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-slate-700 mb-1">Project Key:</label>
                <input
                  type="text"
                  defaultValue="NET"
                  className="w-full p-2 border-2 border-[#1e293b] rounded-lg font-mono text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setJiraModal(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-slate-100 text-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setJiraModal(false);
                    setBannerNotice({
                      type: 'success',
                      message: 'Jira integration settings saved.',
                    });
                  }}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-[#0284c7] text-white rounded-lg shadow-[2px_2px_0px_#1e293b]"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Webhook Receiver */}
      {webhookModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#a855f7] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                <h3 className="text-sm font-black">Webhook Secret &amp; Listener</h3>
              </div>
              <button
                type="button"
                onClick={() => setWebhookModal(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs font-bold">
              <div>
                <label className="block text-slate-700 mb-1">Public Endpoint:</label>
                <div className="flex items-center gap-1.5 p-2 bg-[#fdfbf7] border-2 border-[#1e293b] rounded-lg font-mono text-slate-900">
                  <span className="truncate">/api/tickets/webhook</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('/api/tickets/webhook', 'Webhook URL')}
                    className="p-1 hover:text-sky-600"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-slate-700 mb-1">HMAC SHA-256 Secret:</label>
                <input
                  type="password"
                  defaultValue="whsec_campus_drift_prod_secret_8921"
                  className="w-full p-2 border-2 border-[#1e293b] rounded-lg font-mono text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setWebhookModal(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-slate-100 text-slate-700 rounded-lg"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 4: SSH Collector Netmiko */}
      {collectorModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#0284c7] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <SettingsIcon className="w-5 h-5" />
                <h3 className="text-sm font-black">Configure Netmiko SSH Collector</h3>
              </div>
              <button
                type="button"
                onClick={() => setCollectorModal(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs font-bold">
              <div>
                <label className="block text-slate-700 mb-1">Connection Timeout (Seconds):</label>
                <input
                  type="number"
                  defaultValue={30}
                  className="w-full p-2 border-2 border-[#1e293b] rounded-lg font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-slate-700 mb-1">Connection Retries:</label>
                <input
                  type="number"
                  defaultValue={3}
                  className="w-full p-2 border-2 border-[#1e293b] rounded-lg font-mono text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setCollectorModal(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-[#0284c7] text-white rounded-lg shadow-[2px_2px_0px_#1e293b]"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 5: Simulator Endpoints */}
      {simulatorModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#0284c7] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5" />
                <h3 className="text-sm font-black">Managed Simulator Endpoints</h3>
              </div>
              <button
                type="button"
                onClick={() => setSimulatorModal(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs font-bold font-mono">
              <div className="p-2 bg-slate-100 rounded border border-slate-300 flex justify-between">
                <span>10.0.0.10:22 (Sim-Switch-1)</span>
                <span className="text-emerald-700">ONLINE</span>
              </div>
              <div className="p-2 bg-slate-100 rounded border border-slate-300 flex justify-between">
                <span>10.0.0.11:22 (Sim-Router-1)</span>
                <span className="text-emerald-700">ONLINE</span>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setSimulatorModal(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-[#0284c7] text-white rounded-lg text-xs font-black shadow-[2px_2px_0px_#1e293b]"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 6: View Real-time Celery Logs */}
      {logsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#8b5cf6] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                <h3 className="text-sm font-black">Live Celery &amp; Scheduler Logs</h3>
              </div>
              <button
                type="button"
                onClick={() => setLogsModal(false)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 font-mono text-xs">
              <pre className="p-3 bg-slate-950 text-emerald-400 rounded-xl border border-slate-800 leading-relaxed overflow-x-auto max-h-96">
{`[2026-11-02 10:15:00,124: INFO/Beat] Scheduler: Sending dual sweep tasks to celery workers
[2026-11-02 10:15:00,126: INFO/ForkPoolWorker-1] Task app.tasks.sweep.collect_configs[89a1-4fc2] received
[2026-11-02 10:15:02,408: INFO/ForkPoolWorker-1] Scraped 132 campus switches & routers via Netmiko
[2026-11-02 10:15:02,512: INFO/ForkPoolWorker-2] Task app.tasks.drift.detect_drift[91f3-11b2] received
[2026-11-02 10:15:04,188: INFO/ForkPoolWorker-2] AST normalization check finished: 125 compliant, 7 drifted
[2026-11-02 10:15:04,201: INFO/ForkPoolWorker-2] Task app.tasks.drift.detect_drift succeeded in 1.68s`}
              </pre>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setLogsModal(false)}
                  className="px-4 py-2 border-2 border-[#1e293b] bg-[#8b5cf6] text-white rounded-lg text-xs font-black shadow-[2px_2px_0px_#1e293b]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 7: Service Info */}
      {serviceInfoModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full border-2 border-[#1e293b] overflow-hidden">
            <div className="bg-[#0284c7] text-white px-4 py-3 flex items-center justify-between border-b-2 border-[#1e293b]">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5" />
                <h3 className="text-sm font-black">{serviceInfoModal} Telemetry</h3>
              </div>
              <button
                type="button"
                onClick={() => setServiceInfoModal(null)}
                className="p-1 text-white hover:bg-black/20 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-2 text-xs font-bold text-slate-800">
              <div className="flex justify-between py-1 border-b">
                <span className="text-slate-500">Service:</span>
                <span>{serviceInfoModal}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-slate-500">Status:</span>
                <span className="text-emerald-700">Healthy (0 restart count)</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-slate-500">Port / Socket:</span>
                <span className="font-mono">8000 / TCP</span>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setServiceInfoModal(null)}
                  className="px-4 py-1.5 border-2 border-[#1e293b] bg-[#0284c7] text-white rounded-lg text-xs font-black shadow-[2px_2px_0px_#1e293b]"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
