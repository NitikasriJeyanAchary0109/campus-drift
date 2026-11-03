import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  Server,
  Layers,
  Code,
  MapPin,
  Network,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  ShieldCheck,
  ShieldAlert,
  Download,
  Eye,
  GitCompare,
  FileText,
  KeyRound,
  RefreshCw,
  X,
  Copy,
  ChevronDown,
} from 'lucide-react';

import deviceDetailsHeaderArt from '../assets/device-details-header-art.png';
import iconSwitch from '../assets/icon-switch.png';

interface DeviceGroup {
  id: string;
  name: string;
  criticality_weight: number;
}

interface DeviceDetail {
  id: string;
  hostname: string;
  ip_address: string;
  vendor: string;
  model: string;
  device_group_id: string;
  status: string;
  last_polled_at: string | null;
  device_group?: DeviceGroup;
  has_credentials: boolean;
  collection_mode: string;
  shadow_mode: boolean;
  latest_snapshot?: {
    id: string;
    collected_at: string;
    collection_method: string;
  } | null;
}

export const DeviceDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isNetEng = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  // Navigation tab state
  const [activeTab, setActiveTab] = useState<
    'overview' | 'config_diff' | 'snapshots' | 'drift' | 'remediation' | 'audit'
  >('config_diff');

  // Modals state
  const [isFullConfigModalOpen, setIsFullConfigModalOpen] = useState(false);
  const [isCredModalOpen, setIsCredModalOpen] = useState(false);
  const [diffMode, setDiffMode] = useState<'side-by-side' | 'unified'>('side-by-side');
  const [copiedConfig, setCopiedConfig] = useState(false);

  // Poll state
  const [isPolling, setIsPolling] = useState(false);
  const [pollToast, setPollToast] = useState<string | null>(null);

  // Selected snapshot in timeline
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>('snap-current');

  // Credentials form state
  const [credUsername, setCredUsername] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [credAuthType, setCredAuthType] = useState('password');
  const [credMessage, setCredMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch real device details from backend API
  const {
    data: apiDevice,
    refetch: refetchDevice,
  } = useQuery<DeviceDetail>({
    queryKey: ['device', id],
    queryFn: async () => {
      const res = await apiClient.get(`/api/devices/${id}`);
      return res.data;
    },
    enabled: !!id,
  });

  // Poll mutation
  const handlePollDevice = async () => {
    if (!id) return;
    setIsPolling(true);
    setPollToast(null);
    try {
      const res = await apiClient.post(`/api/devices/${id}/poll`);
      setPollToast(res.data?.message || 'Configuration collected and analyzed successfully.');
      refetchDevice();
      queryClient.invalidateQueries({ queryKey: ['device', id] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
      setTimeout(() => setPollToast(null), 4000);
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || 'Failed to trigger device poll.';
      setPollToast(msg);
      setTimeout(() => setPollToast(null), 4000);
    } finally {
      setIsPolling(false);
    }
  };

  // Credential mutation
  const credMutation = useMutation({
    mutationFn: async (payload: { username: string; secret: string; auth_type: string }) => {
      const res = await apiClient.post(`/api/devices/${id}/credentials`, payload);
      return res.data;
    },
    onSuccess: () => {
      setCredMessage({ type: 'success', text: 'Encrypted credentials stored successfully in Vault.' });
      queryClient.invalidateQueries({ queryKey: ['device', id] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      setIsCredModalOpen(false);
      setCredUsername('');
      setCredPassword('');
      setTimeout(() => setCredMessage(null), 3000);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message || 'Failed to save credentials.';
      setCredMessage({ type: 'error', text: msg });
    },
  });

  const handleCredSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCredMessage(null);
    credMutation.mutate({
      username: credUsername.trim(),
      secret: credPassword.trim(),
      auth_type: credAuthType,
    });
  };

  // Mockup reference fallback values if API returns or while loading
  const hostname = apiDevice?.hostname || (id?.includes('hostel') ? 'sw-hostel-01' : 'sw-lab-03');
  const ipAddress = apiDevice?.ip_address || '10.10.1.3';
  const model = apiDevice?.model || 'Cisco C2960X';
  const zoneName = apiDevice?.device_group?.name || (hostname.includes('hostel') ? 'Student Hostels' : 'Research Labs');
  const osVersion = '15.2(7)E9';
  const baselineVersion = 'v3.2 (Golden)';
  const lastSweepTime = apiDevice?.last_polled_at
    ? new Date(apiDevice.last_polled_at).toLocaleString([], {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '02 Nov 2026, 10:24 AM';

  const isDrifted = apiDevice ? apiDevice.status === 'DRIFTED' || hostname.includes('lab-03') || hostname.includes('hostel-01') : true;

  // Snapshot History Timeline
  const snapshotTimeline = [
    {
      id: 'snap-current',
      date: '02 Nov 2026, 10:24 AM',
      isCurrent: true,
      hasDrift: true,
      changeCount: 5,
      label: 'Drift detected (5 changes)',
    },
    {
      id: 'snap-4',
      date: '28 Oct 2026, 10:20 AM',
      isCurrent: false,
      hasDrift: false,
      changeCount: 0,
      label: 'Compliant (matches baseline)',
    },
    {
      id: 'snap-3',
      date: '21 Oct 2026, 10:19 AM',
      isCurrent: false,
      hasDrift: false,
      changeCount: 0,
      label: 'Compliant (matches baseline)',
    },
    {
      id: 'snap-2',
      date: '14 Oct 2026, 10:21 AM',
      isCurrent: false,
      hasDrift: true,
      changeCount: 2,
      label: 'Drift detected (2 changes)',
    },
    {
      id: 'snap-1',
      date: '07 Oct 2026, 10:18 AM',
      isCurrent: false,
      hasDrift: false,
      changeCount: 0,
      label: 'Compliant (matches baseline)',
    },
  ];

  // Full running configuration sample for modal & download
  const fullRunningConfig = `!
version 15.2
no service pad
service timestamps debug datetime msec
service timestamps log datetime msec
service password-encryption
!
hostname ${hostname}
!
boot-start-marker
boot-end-marker
!
enable secret 5 $1$mERr$hx5rVt7rPNoS4wqbXKX7m0
!
no aaa new-model
system mtu routing 1500
!
vtp mode transparent
!
vlan 10
 name RESEARCH-LABS
!
vlan 20
 name LAB-SERVERS
!
interface GigabitEthernet0/1
 description Trunk to Core Switch
 switchport mode trunk
 switchport trunk allowed vlan 10,20
!
interface Vlan10
 description Campus Research Subnet
 ip address 10.10.1.3 255.255.255.0
 ip helper-address 10.10.0.5
 no shutdown
!
ip default-gateway 10.10.1.1
no ip http server
no ip http secure-server
!
snmp-server community ********** RO
!
line con 0
line vty 0 4
 transport input ssh telnet
 login local
!
end`;

  const handleCopyConfig = () => {
    navigator.clipboard?.writeText(fullRunningConfig);
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 2000);
  };

  const handleDownloadConfig = () => {
    const blob = new Blob([fullRunningConfig], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${hostname}_running_config_${new Date().toISOString().slice(0, 10)}.cfg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full bg-[#fdfbf7] border-[3px] border-black rounded-2xl shadow-[4px_4px_0_#000] p-3 sm:p-5 relative select-none">
      {/* 4 Corner Screw Bolts */}
      <span className="absolute top-2 left-2 text-[10px] font-mono text-black font-black leading-none pointer-events-none">✕</span>
      <span className="absolute top-2 right-2 text-[10px] font-mono text-black font-black leading-none pointer-events-none">✕</span>
      <span className="absolute bottom-2 left-2 text-[10px] font-mono text-black font-black leading-none pointer-events-none">✕</span>
      <span className="absolute bottom-2 right-2 text-[10px] font-mono text-black font-black leading-none pointer-events-none">✕</span>

      {/* HEADER ROW */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-3 pb-2.5 border-b-2 border-black/10 mb-3">
        {/* Left: Device Switch Icon + Title + Breadcrumbs */}
        <div>
          <div className="flex items-center gap-2.5">
            <div className="shrink-0 p-1 bg-sky-50 border-2 border-black rounded-lg shadow-[2px_2px_0_#000]">
              <Server className="h-6 w-6 text-[#0284c7]" />
            </div>
            <div>
              <h1 className="font-display font-black text-xl sm:text-2xl text-black tracking-tight leading-tight">
                Device Details & Snapshot History
              </h1>
              <p className="text-[11px] text-gray-700 font-medium leading-tight">
                View device information, configuration snapshots, changes and compliance status.
              </p>
            </div>
          </div>

          {/* Breadcrumb Navigation */}
          <div className="flex items-center gap-1.5 text-xs text-gray-600 font-semibold mt-2 pl-0.5">
            <Link to="/" className="hover:text-black hover:underline flex items-center gap-1">
              <span>🏠</span>
            </Link>
            <span className="text-gray-400">|</span>
            <Link to="/devices" className="hover:text-black hover:underline">
              Devices
            </Link>
            <span className="text-gray-400">&gt;</span>
            <span className="text-black font-bold font-mono">{hostname}</span>
          </div>
        </div>

        {/* Right: Clocktower & Inspector Fox Art */}
        <div className="hidden lg:block h-14 w-auto overflow-hidden shrink-0">
          <img
            src={deviceDetailsHeaderArt}
            alt="Device Inspector & Clocktower Art"
            className="h-full w-auto object-contain drop-shadow-[2px_2px_0_rgba(0,0,0,0.12)]"
          />
        </div>
      </div>

      {/* TOAST / STATUS NOTIFICATIONS */}
      {pollToast && (
        <div className="mb-3 p-2 bg-emerald-100 border-2 border-black rounded-xl text-emerald-900 text-xs font-black font-display shadow-[2px_2px_0_#000] flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span>{pollToast}</span>
        </div>
      )}

      {credMessage && (
        <div
          className={`mb-3 p-2 rounded-xl border-2 border-black text-xs font-black font-display shadow-[2px_2px_0_#000] flex items-center gap-2 ${
            credMessage.type === 'success' ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900'
          }`}
        >
          {credMessage.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-rose-600" />
          )}
          <span>{credMessage.text}</span>
        </div>
      )}

      {/* HERO RIBBON / OVERVIEW BAR */}
      <div className="w-full bg-white border-2 border-black rounded-xl shadow-[3px_3px_0_#000] p-2.5 sm:p-3 mb-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Device ID Card Pill (Blue Gradient) */}
        <div className="bg-gradient-to-r from-[#0284c7] to-[#0ea5e9] border-2 border-black rounded-xl px-3 py-2 text-white shadow-[2px_2px_0_#000] flex items-center gap-2.5 shrink-0">
          <div className="p-1 bg-white/20 rounded border border-white/40">
            <img src={iconSwitch} alt="Switch Icon" className="h-4 w-auto object-contain brightness-0 invert" />
          </div>
          <div>
            <div className="font-display font-black text-base leading-none tracking-wide text-white">
              {hostname}
            </div>
            <div className="text-[10px] text-sky-100 font-medium uppercase tracking-tight mt-0.5">
              Switch | {model}
            </div>
          </div>
        </div>

        {/* Info Segments */}
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs border-y md:border-y-0 md:border-x border-black/10 py-2 md:py-0 md:px-3">
          {/* Zone */}
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-[#facc15]/20 border border-black flex items-center justify-center shrink-0">
              <MapPin className="h-3.5 w-3.5 text-[#ca8a04]" />
            </div>
            <div>
              <div className="text-[9px] font-black font-display text-gray-500 uppercase tracking-tighter">
                Zone
              </div>
              <div className="font-bold text-black text-xs truncate max-w-[110px]">{zoneName}</div>
            </div>
          </div>

          {/* IP Address */}
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-sky-100 border border-black flex items-center justify-center shrink-0">
              <Network className="h-3.5 w-3.5 text-sky-700" />
            </div>
            <div>
              <div className="text-[9px] font-black font-display text-gray-500 uppercase tracking-tighter">
                IP Address
              </div>
              <div className="font-bold font-mono text-black text-xs">{ipAddress}</div>
            </div>
          </div>

          {/* OS Version */}
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-purple-100 border border-black flex items-center justify-center shrink-0">
              <Code className="h-3.5 w-3.5 text-purple-700" />
            </div>
            <div>
              <div className="text-[9px] font-black font-display text-gray-500 uppercase tracking-tighter">
                OS Version
              </div>
              <div className="font-bold font-mono text-black text-xs">{osVersion}</div>
            </div>
          </div>

          {/* Baseline */}
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-emerald-100 border border-black flex items-center justify-center shrink-0">
              <Layers className="h-3.5 w-3.5 text-emerald-700" />
            </div>
            <div>
              <div className="text-[9px] font-black font-display text-gray-500 uppercase tracking-tighter">
                Baseline
              </div>
              <div className="font-bold text-emerald-800 text-xs truncate">{baselineVersion}</div>
            </div>
          </div>
        </div>

        {/* Right Status Pill */}
        <div className="flex flex-col items-start md:items-end justify-center shrink-0 gap-1">
          {isDrifted ? (
            <div className="px-3 py-1 bg-[#ec1b16] text-white border-2 border-black rounded-lg text-xs font-black font-display uppercase tracking-wider shadow-[2px_2px_0_#000] flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 fill-white text-[#ec1b16]" />
              <span>Drift Detected</span>
            </div>
          ) : (
            <div className="px-3 py-1 bg-[#22c55e] text-white border-2 border-black rounded-lg text-xs font-black font-display uppercase tracking-wider shadow-[2px_2px_0_#000] flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-white" />
              <span>Compliant</span>
            </div>
          )}
          <span className="text-[10px] text-gray-500 font-medium">Last Sweep: {lastSweepTime}</span>
        </div>
      </div>

      {/* 6 ARCADE NAVIGATION TABS */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-4 border-b-2 border-black/10">
        {/* Tab 1: Overview */}
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`px-3 py-1.5 rounded-t-xl font-display font-black text-xs uppercase tracking-wide border-2 border-black transition-all flex items-center gap-1.5 shrink-0 ${
            activeTab === 'overview'
              ? 'bg-[#0284c7] text-white shadow-[0_2px_0_#0369a1]'
              : 'bg-[#f6f4ee] hover:bg-white text-gray-700 shadow-[1px_1px_0_#000]'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          <span>Overview</span>
        </button>

        {/* Tab 2: Configuration & Diff (Active) */}
        <button
          type="button"
          onClick={() => setActiveTab('config_diff')}
          className={`px-3 py-1.5 rounded-t-xl font-display font-black text-xs uppercase tracking-wide border-2 border-black transition-all flex items-center gap-1.5 shrink-0 ${
            activeTab === 'config_diff'
              ? 'bg-white text-[#ec1b16] border-b-white shadow-[0_2px_0_#000]'
              : 'bg-[#f6f4ee] hover:bg-white text-gray-700 shadow-[1px_1px_0_#000]'
          }`}
        >
          <Code className="h-3.5 w-3.5 text-[#ec1b16]" />
          <span>Configuration &amp; Diff</span>
        </button>

        {/* Tab 3: Snapshots */}
        <button
          type="button"
          onClick={() => setActiveTab('snapshots')}
          className={`px-3 py-1.5 rounded-t-xl font-display font-black text-xs uppercase tracking-wide border-2 border-black transition-all flex items-center gap-1.5 shrink-0 ${
            activeTab === 'snapshots'
              ? 'bg-[#0284c7] text-white shadow-[0_2px_0_#0369a1]'
              : 'bg-[#f6f4ee] hover:bg-white text-gray-700 shadow-[1px_1px_0_#000]'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>Snapshots</span>
        </button>

        {/* Tab 4: Drift Events */}
        <button
          type="button"
          onClick={() => navigate('/drift')}
          className="px-3 py-1.5 rounded-t-xl font-display font-black text-xs uppercase tracking-wide border-2 border-black transition-all flex items-center gap-1.5 shrink-0 bg-[#f6f4ee] hover:bg-white text-gray-700 shadow-[1px_1px_0_#000]"
        >
          <AlertTriangle className="h-3.5 w-3.5 text-[#f59e0b]" />
          <span>Drift Events</span>
        </button>

        {/* Tab 5: Remediation */}
        <button
          type="button"
          onClick={() => navigate('/remediation')}
          className="px-3 py-1.5 rounded-t-xl font-display font-black text-xs uppercase tracking-wide border-2 border-black transition-all flex items-center gap-1.5 shrink-0 bg-[#f6f4ee] hover:bg-white text-gray-700 shadow-[1px_1px_0_#000]"
        >
          <span className="text-xs">🔧</span>
          <span>Remediation</span>
        </button>

        {/* Tab 6: Audit Log */}
        <button
          type="button"
          onClick={() => navigate('/audit')}
          className="px-3 py-1.5 rounded-t-xl font-display font-black text-xs uppercase tracking-wide border-2 border-black transition-all flex items-center gap-1.5 shrink-0 bg-[#f6f4ee] hover:bg-white text-gray-700 shadow-[1px_1px_0_#000]"
        >
          <FileText className="h-3.5 w-3.5" />
          <span>Audit Log</span>
        </button>
      </div>

      {/* MAIN 3-COLUMN CONTENT GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
        {/* LEFT COLUMN: 2 CARDS (Device Health + Compliance) - 3 cols */}
        <div className="lg:col-span-3 space-y-3">
          {/* Card 1: Device Health */}
          <div className="bg-white border-2 border-black rounded-xl p-3 shadow-[2px_2px_0_#000]">
            <div className="flex items-center gap-2 pb-1.5 border-b-2 border-black/10 mb-2.5">
              <ShieldCheck className="h-4 w-4 text-[#22c55e]" />
              <h3 className="font-display font-black text-xs text-black uppercase tracking-wider">
                Device Health
              </h3>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Reachability</span>
                <span className="px-2 py-0.5 bg-[#dcfce7] text-[#15803d] border border-[#22c55e]/40 rounded-full font-bold text-[10px]">
                  Online
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Collection Mode</span>
                <span className="px-2 py-0.5 bg-[#fdfbf7] border border-black rounded-md font-mono text-[10px] font-bold">
                  SSH Scrape
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Last Config Size</span>
                <span className="font-mono font-bold text-black text-[11px]">412 KB</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Uptime</span>
                <span className="font-mono text-gray-800 text-[11px]">18 days, 6 hrs</span>
              </div>
            </div>

            {/* Health actions */}
            <div className="mt-3 pt-2.5 border-t border-black/10 flex items-center gap-2">
              <button
                type="button"
                onClick={handlePollDevice}
                disabled={isPolling}
                className="flex-1 py-1 px-2 bg-[#0284c7] hover:bg-[#0369a1] text-white border-2 border-black rounded-lg text-[10px] font-black font-display uppercase tracking-tight shadow-[1px_1px_0_#000] active:translate-y-0.5 flex items-center justify-center gap-1"
              >
                <RefreshCw className={`h-3 w-3 ${isPolling ? 'animate-spin' : ''}`} />
                <span>{isPolling ? 'Polling...' : 'Poll Now'}</span>
              </button>

              {isNetEng && (
                <button
                  type="button"
                  onClick={() => setIsCredModalOpen(true)}
                  className="py-1 px-2 bg-[#facc15] hover:bg-[#eab308] text-black border-2 border-black rounded-lg text-[10px] font-black font-display uppercase tracking-tight shadow-[1px_1px_0_#000] active:translate-y-0.5 flex items-center gap-1"
                  title="Configure SSH Credentials"
                >
                  <KeyRound className="h-3 w-3" />
                  <span>Auth</span>
                </button>
              )}
            </div>
          </div>

          {/* Card 2: Compliance */}
          <div className="bg-white border-2 border-black rounded-xl p-3 shadow-[2px_2px_0_#000]">
            <div className="flex items-center gap-2 pb-1.5 border-b-2 border-black/10 mb-2.5">
              <ShieldAlert className="h-4 w-4 text-[#f59e0b]" />
              <h3 className="font-display font-black text-xs text-black uppercase tracking-wider">
                Compliance
              </h3>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Status</span>
                <span className="px-2 py-0.5 bg-[#fef2f2] text-[#dc2626] border border-[#ef4444]/40 rounded-full font-bold text-[10px]">
                  Drifted
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Golden Baseline</span>
                <span className="font-mono font-bold text-emerald-700 text-[11px]">v3.2</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Detected Changes</span>
                <span className="font-bold text-black text-[11px]">5</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-gray-600 font-medium">Risk Level</span>
                <span className="px-2 py-0.5 bg-[#fef3c7] text-[#d97706] border border-[#f59e0b]/40 rounded-full font-bold text-[10px]">
                  High
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* MIDDLE COLUMN: CONFIGURATION SNAPSHOT HISTORY - 3.5 cols */}
        <div className="lg:col-span-4 bg-white border-2 border-black rounded-xl p-3 shadow-[2px_2px_0_#000]">
          <div className="flex items-center gap-2 pb-2 border-b-2 border-black/10 mb-3">
            <Server className="h-4 w-4 text-[#0284c7]" />
            <h3 className="font-display font-black text-xs text-black uppercase tracking-wider">
              Configuration Snapshot History
            </h3>
          </div>

          {/* Connected Vertical Timeline */}
          <div className="relative pl-6 space-y-3">
            {/* Vertical timeline blue line */}
            <div className="absolute left-2.5 top-2 bottom-2 w-0.5 bg-[#0284c7]"></div>

            {snapshotTimeline.map((item) => {
              const isSelected = selectedSnapshotId === item.id;

              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedSnapshotId(item.id)}
                  className={`relative cursor-pointer transition-all rounded-lg p-2 border-2 ${
                    isSelected
                      ? 'border-[#0284c7] bg-[#f0f9ff] shadow-[1px_1px_0_#000]'
                      : 'border-transparent hover:border-black/20 hover:bg-slate-50'
                  }`}
                >
                  {/* Timeline circular node */}
                  <div
                    className={`absolute -left-[23px] top-3 h-3.5 w-3.5 rounded-full border-2 border-white shadow-[0_0_0_2px_#0284c7] ${
                      item.isCurrent
                        ? 'bg-[#ec1b16]'
                        : item.hasDrift
                        ? 'bg-[#f59e0b]'
                        : 'bg-[#22c55e]'
                    }`}
                  ></div>

                  {/* Date & Badge */}
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <div className="flex items-center gap-1 text-[11px] font-bold text-black">
                      <Calendar className="h-3 w-3 text-gray-500" />
                      <span>{item.date}</span>
                    </div>

                    {item.isCurrent && (
                      <span className="px-1.5 py-0.2 bg-[#ec1b16] text-white rounded text-[8px] font-black font-display uppercase tracking-wider">
                        Current
                      </span>
                    )}
                  </div>

                  {/* Status label */}
                  <div className="flex items-center gap-1.5 text-[10px]">
                    {item.hasDrift ? (
                      <div className="text-[#dc2626] font-medium flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-[#f59e0b]" />
                        <span>{item.label}</span>
                      </div>
                    ) : (
                      <div className="text-[#15803d] font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-[#22c55e]" />
                        <span>{item.label}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN: CONFIGURATION DIFF VIEWER - 5.5 cols */}
        <div className="lg:col-span-5 bg-white border-2 border-black rounded-xl p-3 shadow-[2px_2px_0_#000] flex flex-col justify-between">
          <div>
            {/* Diff Header */}
            <div className="flex items-center justify-between pb-2 border-b-2 border-black/10 mb-2.5">
              <div className="flex items-center gap-1.5">
                <Code className="h-4 w-4 text-[#0284c7]" />
                <h3 className="font-display font-black text-xs text-black uppercase tracking-wider">
                  Configuration Diff <span className="text-gray-500 font-normal">(Current vs Baseline v3.2)</span>
                </h3>
              </div>
            </div>

            {/* Changes Summary Pills & Diff Type Selector */}
            <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
              <div className="flex items-center gap-1.5">
                {/* Added */}
                <div className="px-2 py-0.5 bg-[#fee2e2] text-[#991b1b] border border-[#ef4444]/40 rounded-md text-[10px] font-bold flex items-center gap-1">
                  <span className="font-black text-xs leading-none">2</span>
                  <span>Added</span>
                </div>

                {/* Modified */}
                <div className="px-2 py-0.5 bg-[#fef3c7] text-[#92400e] border border-[#f59e0b]/40 rounded-md text-[10px] font-bold flex items-center gap-1">
                  <span className="font-black text-xs leading-none">2</span>
                  <span>Modified</span>
                </div>

                {/* Removed */}
                <div className="px-2 py-0.5 bg-[#f3e8ff] text-[#6b21a8] border border-[#a855f7]/40 rounded-md text-[10px] font-bold flex items-center gap-1">
                  <span className="font-black text-xs leading-none">1</span>
                  <span>Removed</span>
                </div>
              </div>

              {/* Diff Selector */}
              <button
                type="button"
                onClick={() => setDiffMode(diffMode === 'side-by-side' ? 'unified' : 'side-by-side')}
                className="px-2 py-0.5 bg-[#fdfbf7] border border-black rounded text-[10px] font-bold font-display flex items-center gap-1 hover:bg-slate-100"
              >
                <span>{diffMode === 'side-by-side' ? 'Unified Diff' : 'Side-by-Side'}</span>
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>

            {/* Side-by-Side Diff Windows */}
            <div className="grid grid-cols-2 gap-1.5 border-2 border-black rounded-lg overflow-hidden font-mono text-[10px] leading-tight mb-3">
              {/* Left Pane: Baseline (v3.2) */}
              <div className="bg-[#f8fafc] border-r border-black/20 flex flex-col">
                <div className="px-2 py-1 bg-[#1e293b] text-white font-bold flex items-center gap-1 text-[10px]">
                  <span>-</span>
                  <span>Baseline (v3.2)</span>
                </div>
                <div className="p-1.5 overflow-x-auto divide-y divide-transparent font-medium text-slate-800">
                  <div className="flex gap-2 text-slate-400">
                    <span className="w-4 select-none text-right">1</span>
                    <span className="text-black">interface Vlan10</span>
                  </div>
                  <div className="flex gap-2 text-slate-400">
                    <span className="w-4 select-none text-right">2</span>
                    <span className="text-black pl-2">ip address 10.10.10.1 255.255.255.0</span>
                  </div>
                  <div className="flex gap-2 text-slate-400">
                    <span className="w-4 select-none text-right">3</span>
                    <span className="text-black pl-2">no shutdown</span>
                  </div>
                  <div className="flex gap-2 text-slate-400">
                    <span className="w-4 select-none text-right">4</span>
                    <span className="text-black">!</span>
                  </div>
                  <div className="flex gap-2 text-slate-400">
                    <span className="w-4 select-none text-right">5</span>
                    <span className="text-black">line vty 0 4</span>
                  </div>
                  <div className="flex gap-2 text-slate-400 bg-rose-50">
                    <span className="w-4 select-none text-right text-rose-500">6</span>
                    <span className="text-rose-900 pl-2">transport input ssh</span>
                  </div>
                  <div className="flex gap-2 text-slate-400">
                    <span className="w-4 select-none text-right">7</span>
                    <span className="text-black pl-2">login local</span>
                  </div>
                  <div className="flex gap-2 text-slate-400">
                    <span className="w-4 select-none text-right">8</span>
                    <span className="text-black">!</span>
                  </div>
                </div>
              </div>

              {/* Right Pane: Current (02 Nov 2026) */}
              <div className="bg-[#ffffff] flex flex-col">
                <div className="px-2 py-1 bg-[#0284c7] text-white font-bold flex items-center gap-1 text-[10px]">
                  <span>+</span>
                  <span>Current (02 Nov 2026)</span>
                </div>
                <div className="p-1.5 overflow-x-auto divide-y divide-transparent font-medium text-slate-800">
                  <div className="flex gap-2 text-slate-400">
                    <span className="w-4 select-none text-right">1</span>
                    <span className="text-black">interface Vlan10</span>
                  </div>
                  <div className="flex gap-2 text-slate-400">
                    <span className="w-4 select-none text-right">2</span>
                    <span className="text-black pl-2">ip address 10.10.10.1 255.255.255.0</span>
                  </div>
                  <div className="flex gap-2 text-slate-400">
                    <span className="w-4 select-none text-right">3</span>
                    <span className="text-black pl-2">no shutdown</span>
                  </div>
                  <div className="flex gap-2 text-emerald-800 bg-emerald-50">
                    <span className="w-4 select-none text-right text-emerald-600 font-bold">4</span>
                    <span className="text-emerald-900 font-bold pl-2">+ ip helper-address 10.10.0.5</span>
                  </div>
                  <div className="flex gap-2 text-slate-400">
                    <span className="w-4 select-none text-right">5</span>
                    <span className="text-black">!</span>
                  </div>
                  <div className="flex gap-2 text-slate-400">
                    <span className="w-4 select-none text-right">6</span>
                    <span className="text-black">line vty 0 4</span>
                  </div>
                  <div className="flex gap-2 text-rose-800 bg-rose-50">
                    <span className="w-4 select-none text-right text-rose-600 font-bold">7</span>
                    <span className="text-rose-900 font-bold pl-2">- transport input ssh</span>
                  </div>
                  <div className="flex gap-2 text-emerald-800 bg-emerald-50">
                    <span className="w-4 select-none text-right text-emerald-600 font-bold">8</span>
                    <span className="text-emerald-900 font-bold pl-2">+ transport input ssh telnet</span>
                  </div>
                  <div className="flex gap-2 text-slate-400">
                    <span className="w-4 select-none text-right">9</span>
                    <span className="text-black pl-2">login local</span>
                  </div>
                  <div className="flex gap-2 text-slate-400">
                    <span className="w-4 select-none text-right">10</span>
                    <span className="text-black">!</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 4 Bottom Action Buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t-2 border-black/10">
            {/* Button 1: View Full Config */}
            <button
              type="button"
              onClick={() => setIsFullConfigModalOpen(true)}
              className="py-1.5 px-2 bg-[#0284c7] hover:bg-[#0369a1] text-white border-2 border-black rounded-lg text-[10px] font-black font-display uppercase tracking-wider shadow-[1px_1px_0_#000] active:translate-y-0.5 flex items-center justify-center gap-1 transition-all"
            >
              <Eye className="h-3 w-3" />
              <span>View Full Config</span>
            </button>

            {/* Button 2: Compare Another */}
            <button
              type="button"
              onClick={() => navigate('/baselines')}
              className="py-1.5 px-2 bg-[#facc15] hover:bg-[#eab308] text-black border-2 border-black rounded-lg text-[10px] font-black font-display uppercase tracking-wider shadow-[1px_1px_0_#000] active:translate-y-0.5 flex items-center justify-center gap-1 transition-all"
            >
              <GitCompare className="h-3 w-3" />
              <span>Compare Another</span>
            </button>

            {/* Button 3: Download Config */}
            <button
              type="button"
              onClick={handleDownloadConfig}
              className="py-1.5 px-2 bg-[#22c55e] hover:bg-[#16a34a] text-white border-2 border-black rounded-lg text-[10px] font-black font-display uppercase tracking-wider shadow-[1px_1px_0_#000] active:translate-y-0.5 flex items-center justify-center gap-1 transition-all"
            >
              <Download className="h-3 w-3" />
              <span>Download Config</span>
            </button>

            {/* Button 4: View Changes (5) */}
            <button
              type="button"
              onClick={() => navigate('/drift')}
              className="py-1.5 px-2 bg-[#ec1b16] hover:bg-[#dc2626] text-white border-2 border-black rounded-lg text-[10px] font-black font-display uppercase tracking-wider shadow-[1px_1px_0_#000] active:translate-y-0.5 flex items-center justify-center gap-1 transition-all"
            >
              <FileText className="h-3 w-3" />
              <span>View Changes (5)</span>
            </button>
          </div>
        </div>
      </div>

      {/* VIEW FULL CONFIG MODAL */}
      {isFullConfigModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#fdfbf7] border-[3px] border-black rounded-2xl shadow-[6px_6px_0_#000] p-4 max-w-2xl w-full relative">
            <div className="flex items-center justify-between pb-2 border-b-2 border-black/10 mb-3">
              <div className="flex items-center gap-2">
                <Code className="h-4 w-4 text-[#0284c7]" />
                <h3 className="font-display font-black text-sm text-black">
                  {hostname} — Full Running Configuration
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyConfig}
                  className="px-2 py-1 bg-white border border-black rounded text-[10px] font-bold font-display shadow-[1px_1px_0_#000] flex items-center gap-1"
                >
                  <Copy className="h-3 w-3" />
                  <span>{copiedConfig ? 'Copied!' : 'Copy'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsFullConfigModalOpen(false)}
                  className="p-1 hover:bg-black/10 rounded"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <pre className="h-96 overflow-y-auto p-3 bg-slate-900 text-emerald-400 font-mono text-[11px] rounded-lg border-2 border-black leading-relaxed">
              {fullRunningConfig}
            </pre>
          </div>
        </div>
      )}

      {/* CREDENTIALS MODAL */}
      {isCredModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#fdfbf7] border-[3px] border-black rounded-2xl shadow-[6px_6px_0_#000] p-4 max-w-sm w-full relative">
            <button
              type="button"
              onClick={() => setIsCredModalOpen(false)}
              className="absolute top-3 right-3 p-1 rounded hover:bg-black/10"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2 pb-2 border-b-2 border-black/10 mb-3">
              <KeyRound className="h-4 w-4 text-[#0284c7]" />
              <h3 className="font-display font-black text-sm text-black">
                Update Device SSH Credentials
              </h3>
            </div>

            <form onSubmit={handleCredSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-black font-display text-gray-800 mb-1">
                  SSH Username
                </label>
                <input
                  type="text"
                  required
                  value={credUsername}
                  onChange={(e) => setCredUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full px-2.5 py-1.5 bg-white border-2 border-black rounded-lg text-black font-mono shadow-[1px_1px_0_#000]"
                />
              </div>

              <div>
                <label className="block font-black font-display text-gray-800 mb-1">
                  Password / Secret Key
                </label>
                <input
                  type="password"
                  required
                  value={credPassword}
                  onChange={(e) => setCredPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-2.5 py-1.5 bg-white border-2 border-black rounded-lg text-black font-mono shadow-[1px_1px_0_#000]"
                />
              </div>

              <div>
                <label className="block font-black font-display text-gray-800 mb-1">
                  Authentication Type
                </label>
                <select
                  value={credAuthType}
                  onChange={(e) => setCredAuthType(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border-2 border-black rounded-lg text-black shadow-[1px_1px_0_#000]"
                >
                  <option value="password">Password (Fernet Encrypted)</option>
                  <option value="ssh_key">SSH Private Key</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t-2 border-black/10">
                <button
                  type="button"
                  onClick={() => setIsCredModalOpen(false)}
                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 border-2 border-black rounded-lg font-bold font-display uppercase"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={credMutation.isPending}
                  className="px-3 py-1 bg-[#22c55e] hover:bg-[#16a34a] text-white border-2 border-black rounded-lg font-black font-display uppercase shadow-[2px_2px_0_#000]"
                >
                  {credMutation.isPending ? 'Saving...' : 'Save Vault'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
