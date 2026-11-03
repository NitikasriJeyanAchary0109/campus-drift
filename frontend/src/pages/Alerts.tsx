import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  Filter,
  Calendar,
  Search,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Check,
  CheckCircle2,
  AlertTriangle,
  Info,
  Server,
  Wifi,
  BookOpen,
  FlaskConical,
  Network,
  BedDouble,
  MoreHorizontal,
  ClipboardList,
} from 'lucide-react';

import alertsIllustration from '../assets/alerts-illustration.png';
import pixelSiren from '../assets/pixel-siren.png';
import iconSwitch from '../assets/icon-switch.png';
import iconRouter from '../assets/icon-router.png';
import iconAp from '../assets/icon-ap.png';

interface AlertItem {
  id: string;
  type: 'CRITICAL_DRIFT' | 'DEVICE_DOWN' | 'REMEDIATION_FAILED' | 'SECURITY_CHANGE' | string;
  related_id?: string | null;
  message: string;
  acknowledged: boolean;
  created_at: string;
}

interface FormattedAlert {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  hostname: string;
  deviceType: 'switch' | 'router' | 'ap';
  zone: string;
  zoneIcon: 'lab' | 'hostel' | 'event' | 'classroom' | 'core';
  title: string;
  description: string;
  detectedAtTime: string;
  detectedAtDate: string;
  status: 'Active' | 'Acknowledged';
  rawType: string;
  relatedId?: string | null;
  isBackendAlert?: boolean;
}

export const Alerts: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isNetEng = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSeverities, setSelectedSeverities] = useState<string[]>(['CRITICAL']);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string[]>(['ACTIVE']);
  const [dateRange, setDateRange] = useState('Last 14 Days');

  // Collapsible accordion state for filter sections
  const [showSeverityGroup, setShowSeverityGroup] = useState(true);
  const [showTypeGroup, setShowTypeGroup] = useState(true);
  const [showStatusGroup, setShowStatusGroup] = useState(true);

  // Active action menu row id
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [ackSuccessId, setAckSuccessId] = useState<string | null>(null);

  // Fetch real alerts from backend API
  const {
    data: apiAlerts = [],
    isLoading,
  } = useQuery<AlertItem[]>({
    queryKey: ['alerts'],
    queryFn: async () => {
      const res = await apiClient.get('/api/alerts?limit=100');
      return res.data;
    },
  });

  // Acknowledge alert mutation
  const ackMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const res = await apiClient.post(`/api/alerts/${alertId}/ack`);
      return res.data;
    },
    onSuccess: (_, alertId) => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
      setAckSuccessId(alertId);
      setActiveMenuId(null);
      setTimeout(() => setAckSuccessId(null), 3000);
    },
  });

  // Reference Mockup Baseline Alerts (from reference image)
  const referenceAlerts: FormattedAlert[] = useMemo(
    () => [
      {
        id: 'ref-1',
        severity: 'CRITICAL',
        hostname: 'sw-lab-03',
        deviceType: 'switch',
        zone: 'Research Labs',
        zoneIcon: 'lab',
        title: 'Telnet enabled (policy violation)',
        description: 'Telnet service detected in running config.',
        detectedAtTime: '10:12 AM',
        detectedAtDate: 'Nov 02, 2026',
        status: 'Active',
        rawType: 'CRITICAL_DRIFT',
        relatedId: 'drift-lab-03',
      },
      {
        id: 'ref-2',
        severity: 'CRITICAL',
        hostname: 'rtr-hostel-01',
        deviceType: 'router',
        zone: 'Student Hostels',
        zoneIcon: 'hostel',
        title: 'ACL rule order changed',
        description: 'Access control list sequence modified.',
        detectedAtTime: '09:47 AM',
        detectedAtDate: 'Nov 02, 2026',
        status: 'Active',
        rawType: 'CRITICAL_DRIFT',
        relatedId: 'drift-hostel-01',
      },
      {
        id: 'ref-3',
        severity: 'CRITICAL',
        hostname: 'sw-event-05',
        deviceType: 'switch',
        zone: 'Event Wi-Fi',
        zoneIcon: 'event',
        title: 'Unauthorized management access',
        description: 'New SSH access source detected.',
        detectedAtTime: '09:31 AM',
        detectedAtDate: 'Nov 02, 2026',
        status: 'Active',
        rawType: 'SECURITY_CHANGE',
        relatedId: 'drift-event-05',
      },
      {
        id: 'ref-4',
        severity: 'HIGH',
        hostname: 'sw-class-07',
        deviceType: 'switch',
        zone: 'Classrooms',
        zoneIcon: 'classroom',
        title: 'Unauthorized SNMP community',
        description: 'SNMP community string changed.',
        detectedAtTime: '09:21 AM',
        detectedAtDate: 'Nov 02, 2026',
        status: 'Active',
        rawType: 'CRITICAL_DRIFT',
        relatedId: 'drift-class-07',
      },
      {
        id: 'ref-5',
        severity: 'HIGH',
        hostname: 'rtr-core-01',
        deviceType: 'router',
        zone: 'Core Network',
        zoneIcon: 'core',
        title: 'Configuration drift from baseline',
        description: 'Running config differs from golden baseline.',
        detectedAtTime: '08:58 AM',
        detectedAtDate: 'Nov 02, 2026',
        status: 'Active',
        rawType: 'CRITICAL_DRIFT',
        relatedId: 'drift-core-01',
      },
      {
        id: 'ref-6',
        severity: 'MEDIUM',
        hostname: 'sw-lab-01',
        deviceType: 'switch',
        zone: 'Research Labs',
        zoneIcon: 'lab',
        title: 'Config drift from golden baseline',
        description: 'Non-critical config variation detected.',
        detectedAtTime: '08:36 AM',
        detectedAtDate: 'Nov 02, 2026',
        status: 'Acknowledged',
        rawType: 'CRITICAL_DRIFT',
        relatedId: 'drift-lab-01',
      },
      {
        id: 'ref-7',
        severity: 'MEDIUM',
        hostname: 'ap-event-02',
        deviceType: 'ap',
        zone: 'Event Wi-Fi',
        zoneIcon: 'event',
        title: 'Channel changed (auto)',
        description: 'Wi-Fi channel changed by controller.',
        detectedAtTime: '08:20 AM',
        detectedAtDate: 'Nov 02, 2026',
        status: 'Acknowledged',
        rawType: 'SECURITY_CHANGE',
        relatedId: 'device-ap-02',
      },
    ],
    []
  );

  // Map real backend alerts into formatted alerts and merge
  const allAlerts = useMemo<FormattedAlert[]>(() => {
    const formattedApiAlerts: FormattedAlert[] = apiAlerts.map((al) => {
      const msg = al.message || 'Configuration drift event detected';
      const isCritical = al.type === 'CRITICAL_DRIFT' || al.type === 'SECURITY_CHANGE';
      const isDeviceDown = al.type === 'DEVICE_DOWN';

      // Infer hostname from message or fallback
      let hostname = 'sw-hostel-01';
      const hostMatch = msg.match(/(sw-[a-z0-9-]+|rtr-[a-z0-9-]+|ap-[a-z0-9-]+)/i);
      if (hostMatch) {
        hostname = hostMatch[1].toLowerCase();
      }

      // Infer device type
      let deviceType: 'switch' | 'router' | 'ap' = 'switch';
      if (hostname.startsWith('rtr-')) deviceType = 'router';
      else if (hostname.startsWith('ap-')) deviceType = 'ap';

      // Infer zone
      let zone = 'Student Hostels';
      let zoneIcon: 'lab' | 'hostel' | 'event' | 'classroom' | 'core' = 'hostel';
      if (hostname.includes('lab')) {
        zone = 'Research Labs';
        zoneIcon = 'lab';
      } else if (hostname.includes('class')) {
        zone = 'Classrooms';
        zoneIcon = 'classroom';
      } else if (hostname.includes('event')) {
        zone = 'Event Wi-Fi';
        zoneIcon = 'event';
      } else if (hostname.includes('core')) {
        zone = 'Core Network';
        zoneIcon = 'core';
      }

      const dateObj = new Date(al.created_at);
      const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = dateObj.toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' });

      const severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = isCritical
        ? 'CRITICAL'
        : isDeviceDown
        ? 'HIGH'
        : 'MEDIUM';

      return {
        id: al.id,
        severity,
        hostname,
        deviceType,
        zone,
        zoneIcon,
        title: msg,
        description: `Automated alert for ${hostname} (${al.type.replace('_', ' ')})`,
        detectedAtTime: timeStr,
        detectedAtDate: dateStr,
        status: al.acknowledged ? 'Acknowledged' : 'Active',
        rawType: al.type,
        relatedId: al.related_id,
        isBackendAlert: true,
      };
    });

    if (formattedApiAlerts.length > 0) {
      // Prioritize backend alerts, append demo items if fewer than 7
      const existingIds = new Set(formattedApiAlerts.map((a) => a.id));
      const neededFill = referenceAlerts.filter((ref) => !existingIds.has(ref.id));
      return [...formattedApiAlerts, ...neededFill];
    }

    return referenceAlerts;
  }, [apiAlerts, referenceAlerts]);

  // Aggregate KPI metrics
  const activeAlertsCount = allAlerts.filter((a) => a.status === 'Active').length;
  const criticalCount = allAlerts.filter((a) => a.severity === 'CRITICAL' && a.status === 'Active').length;
  const highCount = allAlerts.filter((a) => a.severity === 'HIGH' && a.status === 'Active').length;
  const mediumCount = allAlerts.filter((a) => a.severity === 'MEDIUM' && a.status === 'Active').length;
  const ackedCount = allAlerts.filter((a) => a.status === 'Acknowledged').length;

  // Filter application
  const filteredAlerts = useMemo(() => {
    return allAlerts.filter((alert) => {
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          alert.hostname.toLowerCase().includes(q) ||
          alert.zone.toLowerCase().includes(q) ||
          alert.title.toLowerCase().includes(q) ||
          alert.description.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }

      // Severity filter (if none selected, show all; otherwise check match)
      if (selectedSeverities.length > 0) {
        if (!selectedSeverities.includes(alert.severity)) return false;
      }

      // Alert Type filter
      if (selectedTypes.length > 0) {
        const typeMatch = selectedTypes.some((t) => {
          if (t === 'Configuration Drift' && alert.rawType === 'CRITICAL_DRIFT') return true;
          if (t === 'Device Down' && alert.rawType === 'DEVICE_DOWN') return true;
          if (t === 'Remediation Failed' && alert.rawType === 'REMEDIATION_FAILED') return true;
          if (t === 'Policy Violation' && alert.rawType === 'SECURITY_CHANGE') return true;
          return false;
        });
        if (!typeMatch) return false;
      }

      // Status filter
      if (selectedStatus.length > 0) {
        const statusMatch = selectedStatus.some((s) => {
          if (s === 'ACTIVE' && alert.status === 'Active') return true;
          if (s === 'ACKNOWLEDGED' && alert.status === 'Acknowledged') return true;
          return false;
        });
        if (!statusMatch) return false;
      }

      return true;
    });
  }, [allAlerts, searchQuery, selectedSeverities, selectedTypes, selectedStatus]);

  const toggleSeverity = (sev: string) => {
    setSelectedSeverities((prev) =>
      prev.includes(sev) ? prev.filter((s) => s !== sev) : [...prev, sev]
    );
  };

  const toggleType = (t: string) => {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((item) => item !== t) : [...prev, t]
    );
  };

  const toggleStatus = (st: string) => {
    setSelectedStatus((prev) =>
      prev.includes(st) ? prev.filter((item) => item !== st) : [...prev, st]
    );
  };

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedSeverities(['CRITICAL']);
    setSelectedTypes([]);
    setSelectedStatus(['ACTIVE']);
  };

  const renderDeviceIcon = (type: 'switch' | 'router' | 'ap') => {
    if (type === 'router') {
      return <img src={iconRouter} alt="Router" className="h-3.5 w-auto object-contain inline-block" />;
    }
    if (type === 'ap') {
      return <img src={iconAp} alt="AP" className="h-3.5 w-auto object-contain inline-block" />;
    }
    return <img src={iconSwitch} alt="Switch" className="h-3.5 w-auto object-contain inline-block" />;
  };

  const renderZoneIcon = (icon: 'lab' | 'hostel' | 'event' | 'classroom' | 'core') => {
    switch (icon) {
      case 'lab':
        return <FlaskConical className="h-3.5 w-3.5 text-rose-600 shrink-0 inline-block" />;
      case 'hostel':
        return <BedDouble className="h-3.5 w-3.5 text-emerald-600 shrink-0 inline-block" />;
      case 'event':
        return <Wifi className="h-3.5 w-3.5 text-amber-600 shrink-0 inline-block" />;
      case 'classroom':
        return <BookOpen className="h-3.5 w-3.5 text-sky-600 shrink-0 inline-block" />;
      case 'core':
      default:
        return <Network className="h-3.5 w-3.5 text-indigo-600 shrink-0 inline-block" />;
    }
  };

  return (
    <div className="w-full bg-[#fdfbf7] border-[3px] border-black rounded-2xl shadow-[4px_4px_0_#000] p-3 sm:p-5 relative select-none">
      {/* 4 Corner Screw Bolts */}
      <span className="absolute top-2 left-2 text-[10px] font-mono text-black font-black leading-none pointer-events-none">✕</span>
      <span className="absolute top-2 right-2 text-[10px] font-mono text-black font-black leading-none pointer-events-none">✕</span>
      <span className="absolute bottom-2 left-2 text-[10px] font-mono text-black font-black leading-none pointer-events-none">✕</span>
      <span className="absolute bottom-2 right-2 text-[10px] font-mono text-black font-black leading-none pointer-events-none">✕</span>

      {/* HEADER ROW */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-3 pb-3 border-b-2 border-black/10 mb-4">
        {/* Left: Siren + Title + Subtitle */}
        <div className="flex items-center gap-3">
          <div className="shrink-0 p-1 bg-rose-50 border-2 border-black rounded-lg shadow-[2px_2px_0_#000]">
            <img src={pixelSiren} alt="Siren" className="h-8 w-8 object-contain animate-pulse" />
          </div>
          <div>
            <h1 className="font-display font-black text-2xl sm:text-3xl text-black tracking-tight flex items-center gap-2">
              Alerts Center
            </h1>
            <p className="text-xs text-gray-700 font-medium max-w-xl leading-relaxed">
              Detect, prioritize and respond to configuration and security drifts across the campus network.
            </p>
          </div>
        </div>

        {/* Center/Right: Clocktower + Fox Illustration + Active Alerts Badge */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden lg:block h-16 w-auto overflow-hidden">
            <img
              src={alertsIllustration}
              alt="Alerts Investigation Clocktower & Fox"
              className="h-full w-auto object-contain drop-shadow-[2px_2px_0_rgba(0,0,0,0.15)]"
            />
          </div>

          {/* Active Alerts Badge Card */}
          <div className="bg-white border-2 border-black rounded-xl p-2 sm:px-3 sm:py-2 shadow-[3px_3px_0_#000] flex items-center gap-2.5">
            <span className="text-3xl sm:text-4xl font-black font-display text-[#ec1b16] leading-none">
              {activeAlertsCount}
            </span>
            <div className="flex flex-col text-left">
              <span className="font-display font-black text-xs sm:text-sm text-black leading-tight">
                Active
              </span>
              <span className="font-display font-black text-xs sm:text-sm text-[#ec1b16] leading-tight">
                Alerts!
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* TOP 5 KPI METRIC CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-5">
        {/* Card 1: Total Active Alerts */}
        <div className="bg-white border-2 border-black rounded-xl p-2.5 shadow-[2px_2px_0_#000] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-[#38bdf8]/20 border border-black flex items-center justify-center shrink-0">
              <Server className="h-4 w-4 text-[#0284c7]" />
            </div>
            <div>
              <div className="text-[10px] font-black font-display text-gray-600 uppercase tracking-tight">
                Total Active Alerts
              </div>
              <div className="text-2xl font-black font-display text-black leading-tight">
                {activeAlertsCount}
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Critical Alerts */}
        <div className="bg-[#ec1b16] border-2 border-black rounded-xl p-2.5 shadow-[2px_2px_0_#000] flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-white border border-black flex items-center justify-center shrink-0">
              <span className="font-black font-display text-[#ec1b16] text-lg leading-none">!</span>
            </div>
            <div>
              <div className="text-[10px] font-black font-display text-white/90 uppercase tracking-tight">
                Critical Alerts
              </div>
              <div className="text-2xl font-black font-display text-white leading-tight">
                {criticalCount}
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: High Alerts */}
        <div className="bg-[#facc15] border-2 border-black rounded-xl p-2.5 shadow-[2px_2px_0_#000] flex items-center justify-between text-black">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-black/10 border border-black flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4 text-black fill-black/20" />
            </div>
            <div>
              <div className="text-[10px] font-black font-display text-black/80 uppercase tracking-tight">
                High Alerts
              </div>
              <div className="text-2xl font-black font-display text-black leading-tight">
                {highCount}
              </div>
            </div>
          </div>
        </div>

        {/* Card 4: Medium Alerts */}
        <div className="bg-white border-2 border-black rounded-xl p-2.5 shadow-[2px_2px_0_#000] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-[#0284c7] border border-black flex items-center justify-center shrink-0">
              <Info className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="text-[10px] font-black font-display text-gray-600 uppercase tracking-tight">
                Medium Alerts
              </div>
              <div className="text-2xl font-black font-display text-black leading-tight">
                {mediumCount}
              </div>
            </div>
          </div>
        </div>

        {/* Card 5: Acknowledged Alerts */}
        <div className="bg-[#22c55e] border-2 border-black rounded-xl p-2.5 shadow-[2px_2px_0_#000] flex items-center justify-between text-white col-span-2 sm:col-span-1">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-white border border-black flex items-center justify-center shrink-0">
              <Check className="h-4 w-4 text-[#22c55e] stroke-[3]" />
            </div>
            <div>
              <div className="text-[10px] font-black font-display text-white/90 uppercase tracking-tight">
                Acknowledged Alerts
              </div>
              <div className="text-2xl font-black font-display text-white leading-tight">
                {ackedCount}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN SPLIT CONTENT: FILTER SIDEBAR & ALERT FEED TABLE */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* LEFT COLUMN: FILTER ALERTS PANEL */}
        <div className="w-full lg:w-64 shrink-0 bg-white border-2 border-black rounded-xl p-3 shadow-[2px_2px_0_#000] space-y-3.5">
          {/* Header */}
          <div className="flex items-center gap-2 pb-2 border-b-2 border-black/10">
            <div className="h-5 w-5 rounded bg-[#facc15] border border-black flex items-center justify-center">
              <Filter className="h-3 w-3 text-black" />
            </div>
            <h3 className="font-display font-black text-xs text-black uppercase tracking-wider">
              Filter Alerts
            </h3>
          </div>

          {/* Group 1: Severity */}
          <div>
            <button
              type="button"
              onClick={() => setShowSeverityGroup(!showSeverityGroup)}
              className="w-full flex items-center justify-between text-xs font-black font-display text-black mb-1.5 hover:opacity-80"
            >
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#0284c7] inline-block border border-black"></span>
                <span>Severity</span>
              </div>
              {showSeverityGroup ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>

            {showSeverityGroup && (
              <div className="space-y-1.5 pl-4 text-xs font-medium text-gray-800">
                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedSeverities.includes('CRITICAL')}
                    onChange={() => toggleSeverity('CRITICAL')}
                    className="h-3.5 w-3.5 rounded border-black text-[#ec1b16] focus:ring-0"
                  />
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#ec1b16] border border-black inline-block"></span>
                  <span>Critical ({allAlerts.filter((a) => a.severity === 'CRITICAL').length})</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedSeverities.includes('HIGH')}
                    onChange={() => toggleSeverity('HIGH')}
                    className="h-3.5 w-3.5 rounded border-black text-[#f59e0b] focus:ring-0"
                  />
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#f59e0b] border border-black inline-block"></span>
                  <span>High ({allAlerts.filter((a) => a.severity === 'HIGH').length})</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedSeverities.includes('MEDIUM')}
                    onChange={() => toggleSeverity('MEDIUM')}
                    className="h-3.5 w-3.5 rounded border-black text-[#0284c7] focus:ring-0"
                  />
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#0284c7] border border-black inline-block"></span>
                  <span>Medium ({allAlerts.filter((a) => a.severity === 'MEDIUM').length})</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black text-gray-400">
                  <input
                    type="checkbox"
                    checked={selectedSeverities.includes('LOW')}
                    onChange={() => toggleSeverity('LOW')}
                    className="h-3.5 w-3.5 rounded border-black text-gray-400 focus:ring-0"
                  />
                  <span className="h-2.5 w-2.5 rounded-xs bg-gray-400 border border-black inline-block"></span>
                  <span>Low (0)</span>
                </label>
              </div>
            )}
          </div>

          {/* Group 2: Alert Type */}
          <div>
            <button
              type="button"
              onClick={() => setShowTypeGroup(!showTypeGroup)}
              className="w-full flex items-center justify-between text-xs font-black font-display text-black mb-1.5 hover:opacity-80"
            >
              <div className="flex items-center gap-1.5">
                <Network className="h-3 w-3 text-emerald-600" />
                <span>Alert Type</span>
              </div>
              {showTypeGroup ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>

            {showTypeGroup && (
              <div className="space-y-1.5 pl-4 text-xs font-medium text-gray-800">
                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes('Configuration Drift')}
                    onChange={() => toggleType('Configuration Drift')}
                    className="h-3.5 w-3.5 rounded border-black text-sky-600 focus:ring-0"
                  />
                  <span>Configuration Drift (5)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes('Device Down')}
                    onChange={() => toggleType('Device Down')}
                    className="h-3.5 w-3.5 rounded border-black text-sky-600 focus:ring-0"
                  />
                  <span>Device Down (1)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes('Remediation Failed')}
                    onChange={() => toggleType('Remediation Failed')}
                    className="h-3.5 w-3.5 rounded border-black text-sky-600 focus:ring-0"
                  />
                  <span>Remediation Failed (1)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black text-gray-400">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes('Policy Violation')}
                    onChange={() => toggleType('Policy Violation')}
                    className="h-3.5 w-3.5 rounded border-black text-sky-600 focus:ring-0"
                  />
                  <span>Policy Violation (0)</span>
                </label>
              </div>
            )}
          </div>

          {/* Group 3: Status */}
          <div>
            <button
              type="button"
              onClick={() => setShowStatusGroup(!showStatusGroup)}
              className="w-full flex items-center justify-between text-xs font-black font-display text-black mb-1.5 hover:opacity-80"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-amber-500 font-bold">⚑</span>
                <span>Status</span>
              </div>
              {showStatusGroup ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>

            {showStatusGroup && (
              <div className="space-y-1.5 pl-4 text-xs font-medium text-gray-800">
                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedStatus.includes('ACTIVE')}
                    onChange={() => toggleStatus('ACTIVE')}
                    className="h-3.5 w-3.5 rounded border-black text-[#ec1b16] focus:ring-0"
                  />
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#ec1b16] border border-black inline-block"></span>
                  <span>Active ({activeAlertsCount})</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedStatus.includes('ACKNOWLEDGED')}
                    onChange={() => toggleStatus('ACKNOWLEDGED')}
                    className="h-3.5 w-3.5 rounded border-black text-[#22c55e] focus:ring-0"
                  />
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#22c55e] border border-black inline-block"></span>
                  <span>Acknowledged ({ackedCount})</span>
                </label>
              </div>
            )}
          </div>

          {/* Reset Filters Arcade Button */}
          <button
            type="button"
            onClick={resetFilters}
            className="w-full py-1.5 px-3 bg-[#f6f4ee] hover:bg-[#fefce8] border-2 border-black rounded-lg text-xs font-black font-display uppercase tracking-wider shadow-[2px_2px_0_#000] active:translate-y-0.5 flex items-center justify-center gap-2 text-black transition-all"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset Filters</span>
          </button>
        </div>

        {/* RIGHT COLUMN: ALERT FEED PANEL */}
        <div className="flex-1 min-w-0 w-full bg-white border-2 border-black rounded-xl p-3 shadow-[2px_2px_0_#000]">
          {/* Feed Header bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-3 border-b-2 border-black/10 mb-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-[#ec1b16]" />
              <h3 className="font-display font-black text-sm text-black">
                Alert Feed <span className="text-[#ec1b16]">({filteredAlerts.length})</span>
              </h3>
              {ackSuccessId && (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-400 px-2 py-0.5 rounded-full">
                  ✓ Alert acknowledged!
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Search Box */}
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by hostname, zone or event..."
                  className="w-full pl-8 pr-3 py-1 bg-[#fdfbf7] border-2 border-black rounded-lg text-xs font-medium text-black focus:outline-hidden shadow-[1px_1px_0_#000]"
                />
              </div>

              {/* Date Filter Dropdown */}
              <button
                type="button"
                onClick={() =>
                  setDateRange((prev) =>
                    prev === 'Last 14 Days'
                      ? 'Last 7 Days'
                      : prev === 'Last 7 Days'
                      ? 'Last 24 Hours'
                      : 'Last 14 Days'
                  )
                }
                className="flex items-center gap-1.5 px-2.5 py-1 bg-[#fdfbf7] border-2 border-black rounded-lg text-xs font-bold font-display shadow-[1px_1px_0_#000] cursor-pointer hover:bg-[#fefce8]"
              >
                <Calendar className="h-3.5 w-3.5 text-black" />
                <span>{dateRange}</span>
                <ChevronDown className="h-3 w-3 text-black" />
              </button>
            </div>
          </div>

          {/* Alert Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-black/20 text-gray-600 font-display font-black text-[11px] uppercase tracking-wider">
                  <th className="pb-2 px-2">Severity</th>
                  <th className="pb-2 px-2">Hostname</th>
                  <th className="pb-2 px-2">Zone</th>
                  <th className="pb-2 px-2">Event / Description</th>
                  <th className="pb-2 px-2">Detected At</th>
                  <th className="pb-2 px-2">Status</th>
                  <th className="pb-2 px-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {isLoading && apiAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-500 font-medium">
                      Loading latest campus alerts...
                    </td>
                  </tr>
                ) : filteredAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-gray-500 font-medium">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <CheckCircle2 className="h-8 w-8 text-[#22c55e]" />
                        <span>No alerts match your filter criteria.</span>
                        <button
                          onClick={resetFilters}
                          className="text-xs font-bold text-sky-600 hover:underline"
                        >
                          Clear all filters
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredAlerts.map((alert) => (
                    <tr
                      key={alert.id}
                      className="hover:bg-[#fefce8]/60 transition-colors group relative"
                    >
                      {/* Severity Badge */}
                      <td className="py-2.5 px-2 align-middle">
                        {alert.severity === 'CRITICAL' ? (
                          <span className="inline-block px-2 py-0.5 bg-[#ec1b16] text-white border border-black font-black font-display text-[10px] rounded-xs shadow-[1px_1px_0_#000]">
                            CRITICAL
                          </span>
                        ) : alert.severity === 'HIGH' ? (
                          <span className="inline-block px-2 py-0.5 bg-[#f59e0b] text-black border border-black font-black font-display text-[10px] rounded-xs shadow-[1px_1px_0_#000]">
                            HIGH
                          </span>
                        ) : alert.severity === 'MEDIUM' ? (
                          <span className="inline-block px-2 py-0.5 bg-[#0284c7] text-white border border-black font-black font-display text-[10px] rounded-xs shadow-[1px_1px_0_#000]">
                            MEDIUM
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 bg-gray-400 text-white border border-black font-black font-display text-[10px] rounded-xs shadow-[1px_1px_0_#000]">
                            LOW
                          </span>
                        )}
                      </td>

                      {/* Hostname with device icon */}
                      <td className="py-2.5 px-2 align-middle font-mono font-bold text-black whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {renderDeviceIcon(alert.deviceType)}
                          <span>{alert.hostname}</span>
                        </div>
                      </td>

                      {/* Zone with zone icon */}
                      <td className="py-2.5 px-2 align-middle text-gray-700 whitespace-nowrap font-medium text-[11px]">
                        <div className="flex items-center gap-1.5">
                          {renderZoneIcon(alert.zoneIcon)}
                          <span>{alert.zone}</span>
                        </div>
                      </td>

                      {/* Event / Description */}
                      <td className="py-2.5 px-2 align-middle max-w-xs sm:max-w-sm">
                        <div className="font-bold text-black truncate">{alert.title}</div>
                        <div className="text-[11px] text-gray-500 truncate">{alert.description}</div>
                      </td>

                      {/* Detected At */}
                      <td className="py-2.5 px-2 align-middle whitespace-nowrap">
                        <div className="flex items-center gap-1 font-bold text-black text-[11px]">
                          <Calendar className="h-3 w-3 text-gray-500" />
                          <span>{alert.detectedAtTime}</span>
                        </div>
                        <div className="text-[10px] text-gray-500 pl-4">{alert.detectedAtDate}</div>
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-2 align-middle whitespace-nowrap">
                        {alert.status === 'Active' ? (
                          <span className="inline-block px-2 py-0.5 bg-[#ffe4e6] text-[#e11d48] border border-[#f43f5e]/40 font-bold text-[10px] rounded-full">
                            Active
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 bg-[#dcfce7] text-[#15803d] border border-[#22c55e]/40 font-bold text-[10px] rounded-full">
                            Acknowledged
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-2 align-middle text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {alert.status === 'Active' ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (alert.relatedId) {
                                  navigate(`/drift/${alert.relatedId}`);
                                } else {
                                  navigate('/drift');
                                }
                              }}
                              className="px-2.5 py-1 bg-[#0284c7] hover:bg-[#0369a1] text-white border-2 border-black rounded-lg font-display font-black text-[10px] shadow-[2px_2px_0_#000] active:translate-y-0.5 transition-all inline-flex items-center gap-1"
                            >
                              <span>Investigate</span>
                              <span>➔</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => navigate('/devices')}
                              className="px-2.5 py-1 bg-[#0284c7] hover:bg-[#0369a1] text-white border-2 border-black rounded-lg font-display font-black text-[10px] shadow-[2px_2px_0_#000] active:translate-y-0.5 transition-all inline-flex items-center gap-1"
                            >
                              <span>View Device</span>
                              <span>➔</span>
                            </button>
                          )}

                          {/* Action Dropdown Menu Trigger */}
                          <div className="relative inline-block text-left">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuId(activeMenuId === alert.id ? null : alert.id);
                              }}
                              className="p-1 hover:bg-black/5 rounded border border-transparent hover:border-black/20 text-gray-700"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>

                            {/* Dropdown Card */}
                            {activeMenuId === alert.id && (
                              <div className="absolute right-0 top-full mt-1 w-44 bg-white border-2 border-black rounded-lg shadow-[3px_3px_0_#000] py-1 z-30 text-left">
                                {alert.status === 'Active' && isNetEng && alert.isBackendAlert && (
                                  <button
                                    type="button"
                                    onClick={() => ackMutation.mutate(alert.id)}
                                    className="w-full text-left px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 flex items-center gap-1.5"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                    <span>Acknowledge Alert</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard?.writeText(alert.id);
                                    setActiveMenuId(null);
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 flex items-center gap-1.5"
                                >
                                  <span>Copy Alert ID</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    navigate('/devices');
                                    setActiveMenuId(null);
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 flex items-center gap-1.5"
                                >
                                  <span>Device Inventory</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
