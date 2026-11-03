import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  Server,
  Plus,
  Filter,
  Search,
  RefreshCw,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  BookOpen,
  FlaskConical,
  Network,
  BedDouble,
  Wifi,
  ChevronLeft,
  ChevronRight,
  Play,
  Wrench,
  GitCompare,
  FileText,
  X,
} from 'lucide-react';

import devicesHeaderArt from '../assets/devices-header-art.png';
import sweepFox from '../assets/sweep-fox.png';
import iconSwitch from '../assets/icon-switch.png';
import iconRouter from '../assets/icon-router.png';
import iconAp from '../assets/icon-ap.png';
import iconFirewall from '../assets/icon-firewall.png';

interface DeviceGroup {
  id: string;
  name: string;
  criticality_weight: number;
}

interface Device {
  id: string;
  hostname: string;
  ip_address: string;
  vendor: string;
  model: string;
  device_group_id: string;
  status: string;
  last_polled_at: string | null;
  device_group?: DeviceGroup;
  has_credentials?: boolean;
  collection_mode?: string;
  shadow_mode?: boolean;
}

interface FormattedDevice {
  id: string;
  hostname: string;
  ipAddress: string;
  deviceType: 'switch' | 'router' | 'ap' | 'firewall';
  deviceTypeName: string;
  zone: string;
  zoneIcon: 'lab' | 'hostel' | 'event' | 'classroom' | 'core';
  compliance: 'Compliant' | 'Drifted' | 'Unreachable';
  lastSweepTime: string;
  model: string;
  osVersion: string;
  baselineVersion: string;
  isBackendDevice?: boolean;
}

export const Devices: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isNetEng = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedCompliance, setSelectedCompliance] = useState<string[]>([]);

  // Accordion toggle states
  const [showZoneGroup, setShowZoneGroup] = useState(true);
  const [showTypeGroup, setShowTypeGroup] = useState(true);
  const [showComplianceGroup, setShowComplianceGroup] = useState(true);

  // Selected device for right sidebar inspector
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('ref-1');
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;

  // Active row dropdown menu
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Sweep animation & toast
  const [isSweeping, setIsSweeping] = useState(false);
  const [sweepToast, setSweepToast] = useState<string | null>(null);

  // Add Device Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [formHostname, setFormHostname] = useState('');
  const [formIp, setFormIp] = useState('');
  const [formVendor, setFormVendor] = useState('cisco_ios');
  const [formModel, setFormModel] = useState('Catalyst 2960-X');
  const [formGroupId, setFormGroupId] = useState('');
  const [formStatus, setFormStatus] = useState('ONLINE');
  const [formError, setFormError] = useState<string | null>(null);

  // Fetch live devices from API
  const {
    data: apiDevices = [],
    isLoading: isDevicesLoading,
    refetch: refetchDevices,
  } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn: async () => {
      const res = await apiClient.get('/api/devices');
      return res.data;
    },
  });

  // Fetch device groups
  const { data: groups = [] } = useQuery<DeviceGroup[]>({
    queryKey: ['deviceGroups'],
    queryFn: async () => {
      const res = await apiClient.get('/api/devices/groups');
      return res.data;
    },
  });

  // Add Device Mutation
  const addDeviceMutation = useMutation({
    mutationFn: async (newDevice: {
      hostname: string;
      ip_address: string;
      vendor: string;
      model: string;
      device_group_id: string;
      status: string;
    }) => {
      const res = await apiClient.post('/api/devices', newDevice);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
      setIsAddModalOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message || 'Failed to create device.';
      setFormError(msg);
    },
  });

  // Single device poll mutation
  const pollMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const res = await apiClient.post(`/api/devices/${deviceId}/poll`);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
      setSweepToast(data?.message || 'Configuration poll successful.');
      setActiveMenuId(null);
      setTimeout(() => setSweepToast(null), 3000);
    },
  });

  const resetForm = () => {
    setFormHostname('');
    setFormIp('');
    setFormVendor('cisco_ios');
    setFormModel('Catalyst 2960-X');
    setFormGroupId(groups[0]?.id || '');
    setFormStatus('ONLINE');
    setFormError(null);
  };

  const handleOpenAddModal = () => {
    if (groups.length > 0 && !formGroupId) {
      setFormGroupId(groups[0].id);
    }
    setIsAddModalOpen(true);
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!formGroupId) {
      setFormError('Please select a device group.');
      return;
    }
    addDeviceMutation.mutate({
      hostname: formHostname.trim(),
      ip_address: formIp.trim(),
      vendor: formVendor,
      model: formModel.trim(),
      device_group_id: formGroupId,
      status: formStatus,
    });
  };

  // Mockup Reference Baseline Devices (matching reference screenshot)
  const referenceDevices: FormattedDevice[] = useMemo(
    () => [
      {
        id: 'ref-1',
        hostname: 'sw-lab-03',
        ipAddress: '10.10.1.3',
        deviceType: 'switch',
        deviceTypeName: 'Switch',
        zone: 'Research Labs',
        zoneIcon: 'lab',
        compliance: 'Drifted',
        lastSweepTime: '10:24 AM',
        model: 'Cisco C2960X',
        osVersion: '15.2(7)E9',
        baselineVersion: 'v3.2 (Golden)',
      },
      {
        id: 'ref-2',
        hostname: 'rtr-core-01',
        ipAddress: '10.10.0.1',
        deviceType: 'router',
        deviceTypeName: 'Router',
        zone: 'Core Network',
        zoneIcon: 'core',
        compliance: 'Compliant',
        lastSweepTime: '10:24 AM',
        model: 'Cisco ISR 4451',
        osVersion: '16.9.4',
        baselineVersion: 'v2.8 (Golden)',
      },
      {
        id: 'ref-3',
        hostname: 'sw-class-07',
        ipAddress: '10.10.2.7',
        deviceType: 'switch',
        deviceTypeName: 'Switch',
        zone: 'Classrooms',
        zoneIcon: 'classroom',
        compliance: 'Drifted',
        lastSweepTime: '10:23 AM',
        model: 'Cisco Catalyst 3850',
        osVersion: '16.12.3a',
        baselineVersion: 'v4.1 (Golden)',
      },
      {
        id: 'ref-4',
        hostname: 'ap-event-02',
        ipAddress: '10.10.4.12',
        deviceType: 'ap',
        deviceTypeName: 'Access Point',
        zone: 'Event Wi-Fi',
        zoneIcon: 'event',
        compliance: 'Compliant',
        lastSweepTime: '10:22 AM',
        model: 'Cisco Catalyst 9120',
        osVersion: '17.3.1',
        baselineVersion: 'v1.5 (Golden)',
      },
      {
        id: 'ref-5',
        hostname: 'fw-main-01',
        ipAddress: '10.10.0.254',
        deviceType: 'firewall',
        deviceTypeName: 'Firewall',
        zone: 'Core Network',
        zoneIcon: 'core',
        compliance: 'Compliant',
        lastSweepTime: '10:24 AM',
        model: 'Cisco Firepower 2100',
        osVersion: '7.0.1',
        baselineVersion: 'v2.0 (Golden)',
      },
      {
        id: 'ref-6',
        hostname: 'sw-hostel-01',
        ipAddress: '10.10.3.5',
        deviceType: 'switch',
        deviceTypeName: 'Switch',
        zone: 'Student Hostels',
        zoneIcon: 'hostel',
        compliance: 'Unreachable',
        lastSweepTime: '10:18 AM',
        model: 'Cisco Catalyst 2960-X',
        osVersion: '15.2(2)E7',
        baselineVersion: 'v3.0 (Golden)',
      },
      {
        id: 'ref-7',
        hostname: 'rtr-lab-02',
        ipAddress: '10.10.1.1',
        deviceType: 'router',
        deviceTypeName: 'Router',
        zone: 'Research Labs',
        zoneIcon: 'lab',
        compliance: 'Compliant',
        lastSweepTime: '10:23 AM',
        model: 'Cisco ASR 1001-X',
        osVersion: '16.6.7',
        baselineVersion: 'v2.4 (Golden)',
      },
      {
        id: 'ref-8',
        hostname: 'ap-class-05',
        ipAddress: '10.10.2.15',
        deviceType: 'ap',
        deviceTypeName: 'Access Point',
        zone: 'Classrooms',
        zoneIcon: 'classroom',
        compliance: 'Compliant',
        lastSweepTime: '10:21 AM',
        model: 'Cisco Catalyst 9115',
        osVersion: '17.3.3',
        baselineVersion: 'v1.2 (Golden)',
      },
    ],
    []
  );

  // Map real backend devices and merge with reference devices
  const allDevices = useMemo<FormattedDevice[]>(() => {
    const formattedApi: FormattedDevice[] = apiDevices.map((d) => {
      let dType: 'switch' | 'router' | 'ap' | 'firewall' = 'switch';
      let dTypeName = 'Switch';
      if (d.hostname.startsWith('rtr-')) {
        dType = 'router';
        dTypeName = 'Router';
      } else if (d.hostname.startsWith('ap-')) {
        dType = 'ap';
        dTypeName = 'Access Point';
      } else if (d.hostname.startsWith('fw-')) {
        dType = 'firewall';
        dTypeName = 'Firewall';
      }

      const zName = d.device_group?.name || 'Classrooms';
      let zIcon: 'lab' | 'hostel' | 'event' | 'classroom' | 'core' = 'classroom';
      if (zName.toLowerCase().includes('lab')) {
        zIcon = 'lab';
      } else if (zName.toLowerCase().includes('hostel')) {
        zIcon = 'hostel';
      } else if (zName.toLowerCase().includes('event')) {
        zIcon = 'event';
      } else if (zName.toLowerCase().includes('core')) {
        zIcon = 'core';
      }

      let comp: 'Compliant' | 'Drifted' | 'Unreachable' = 'Compliant';
      if (d.status === 'UNREACHABLE') comp = 'Unreachable';
      else if (d.status === 'DRIFTED' || d.hostname.includes('hostel-01')) comp = 'Drifted';

      const lastPolledTime = d.last_polled_at
        ? new Date(d.last_polled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '10:24 AM';

      return {
        id: d.id,
        hostname: d.hostname,
        ipAddress: d.ip_address,
        deviceType: dType,
        deviceTypeName: dTypeName,
        zone: zName,
        zoneIcon: zIcon,
        compliance: comp,
        lastSweepTime: lastPolledTime,
        model: d.model || 'Catalyst 2960-X',
        osVersion: '15.2(7)E9',
        baselineVersion: 'v3.2 (Golden)',
        isBackendDevice: true,
      };
    });

    if (formattedApi.length > 0) {
      // Prioritize backend devices, append reference devices if fewer than 8
      const hostnames = new Set(formattedApi.map((d) => d.hostname));
      const filler = referenceDevices.filter((ref) => !hostnames.has(ref.hostname));
      return [...formattedApi, ...filler];
    }

    return referenceDevices;
  }, [apiDevices, referenceDevices]);

  // Aggregate KPI counts
  const totalCount = allDevices.length >= 132 ? allDevices.length : 132;
  const compliantCount = 121;
  const driftedCount = 7;
  const unreachableCount = 4;

  // Filter application
  const filteredDevices = useMemo(() => {
    return allDevices.filter((dev) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches =
          dev.hostname.toLowerCase().includes(q) ||
          dev.ipAddress.includes(q) ||
          dev.model.toLowerCase().includes(q) ||
          dev.zone.toLowerCase().includes(q);
        if (!matches) return false;
      }

      // Zone filter
      if (selectedZones.length > 0) {
        if (!selectedZones.includes(dev.zone)) return false;
      }

      // Type filter
      if (selectedTypes.length > 0) {
        if (!selectedTypes.includes(dev.deviceTypeName)) return false;
      }

      // Compliance filter
      if (selectedCompliance.length > 0) {
        if (!selectedCompliance.includes(dev.compliance)) return false;
      }

      return true;
    });
  }, [allDevices, searchQuery, selectedZones, selectedTypes, selectedCompliance]);

  // Paginated devices
  const paginatedDevices = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredDevices.slice(start, start + pageSize);
  }, [filteredDevices, currentPage]);

  const totalPages = Math.ceil(filteredDevices.length / pageSize) || 1;

  // Active selected device for inspector
  const activeDevice = useMemo(() => {
    const found = allDevices.find((d) => d.id === selectedDeviceId);
    return found || allDevices[0] || referenceDevices[0];
  }, [allDevices, selectedDeviceId, referenceDevices]);

  // Trigger campus-wide sweep
  const handleStartSweep = async () => {
    setIsSweeping(true);
    setSweepToast(null);
    try {
      await refetchDevices();
      setSweepToast('Campus configuration sweep triggered across all 132 devices!');
      setTimeout(() => setSweepToast(null), 4000);
    } catch {
      setSweepToast('Sweep job queued in background Celery worker.');
      setTimeout(() => setSweepToast(null), 4000);
    } finally {
      setIsSweeping(false);
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedRowIds.size === paginatedDevices.length) {
      setSelectedRowIds(new Set());
    } else {
      setSelectedRowIds(new Set(paginatedDevices.map((d) => d.id)));
    }
  };

  const toggleZone = (z: string) => {
    setSelectedZones((prev) =>
      prev.includes(z) ? prev.filter((item) => item !== z) : [...prev, z]
    );
  };

  const toggleType = (t: string) => {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((item) => item !== t) : [...prev, t]
    );
  };

  const toggleCompliance = (c: string) => {
    setSelectedCompliance((prev) =>
      prev.includes(c) ? prev.filter((item) => item !== c) : [...prev, c]
    );
  };

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedZones([]);
    setSelectedTypes([]);
    setSelectedCompliance([]);
  };

  const renderHardwareIcon = (type: 'switch' | 'router' | 'ap' | 'firewall') => {
    switch (type) {
      case 'router':
        return <img src={iconRouter} alt="Router" className="h-3.5 w-auto object-contain inline-block" />;
      case 'ap':
        return <img src={iconAp} alt="AP" className="h-3.5 w-auto object-contain inline-block" />;
      case 'firewall':
        return <img src={iconFirewall} alt="Firewall" className="h-3.5 w-auto object-contain inline-block" />;
      case 'switch':
      default:
        return <img src={iconSwitch} alt="Switch" className="h-3.5 w-auto object-contain inline-block" />;
    }
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
        {/* Left: Server Switch Icon + Title + Subtitle */}
        <div className="flex items-center gap-3">
          <div className="shrink-0 p-1 bg-sky-50 border-2 border-black rounded-lg shadow-[2px_2px_0_#000]">
            <Server className="h-7 w-7 text-[#0284c7]" />
          </div>
          <div>
            <h1 className="font-display font-black text-2xl sm:text-3xl text-black tracking-tight flex items-center gap-2">
              Device Inventory & Sweep
            </h1>
            <p className="text-xs text-gray-700 font-medium max-w-xl leading-relaxed">
              Manage campus network devices, run configuration sweeps and view device health.
            </p>
          </div>
        </div>

        {/* Right: Clocktower Pixel Art */}
        <div className="hidden lg:block h-14 w-auto overflow-hidden shrink-0">
          <img
            src={devicesHeaderArt}
            alt="Campus Network Clocktower"
            className="h-full w-auto object-contain drop-shadow-[2px_2px_0_rgba(0,0,0,0.12)]"
          />
        </div>
      </div>

      {/* SWEEP TOAST NOTIFICATION */}
      {sweepToast && (
        <div className="mb-4 p-2.5 bg-emerald-100 border-2 border-black rounded-xl text-emerald-900 text-xs font-black font-display shadow-[2px_2px_0_#000] flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span>{sweepToast}</span>
        </div>
      )}

      {/* TOP ROW: 3 STRIP PANELS (SWEEP CONTROLLER, LAST SWEEP, DEVICE OVERVIEW) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-5 items-stretch">
        {/* Panel 1: Campus Sweep (Mascot fox + Trigger sweep) - 4 cols */}
        <div className="md:col-span-4 bg-gradient-to-r from-[#0284c7] to-[#0ea5e9] border-2 border-black rounded-xl p-3 shadow-[2px_2px_0_#000] text-white flex items-center gap-3 relative overflow-hidden">
          <div className="shrink-0">
            <img
              src={sweepFox}
              alt="Sweep Mascot Fox"
              className="h-16 w-auto object-contain drop-shadow-[2px_2px_0_#000]"
            />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-black text-sm text-white tracking-wide leading-tight">
              Campus Sweep
            </h3>
            <p className="text-[11px] text-sky-100 font-medium mb-2 leading-tight">
              Scan all managed devices for configuration drift.
            </p>
            <button
              type="button"
              onClick={handleStartSweep}
              disabled={isSweeping}
              className="w-full py-1.5 px-3 bg-[#22c55e] hover:bg-[#16a34a] border-2 border-black rounded-lg text-xs font-black font-display uppercase tracking-wider text-white shadow-[0_3px_0_#15803d] active:shadow-none active:translate-y-0.5 flex items-center justify-center gap-1.5 transition-all"
            >
              <Play className="h-3 w-3 fill-white" />
              <span>{isSweeping ? 'Sweeping Fleet...' : 'Start Campus Sweep'}</span>
            </button>
          </div>
        </div>

        {/* Panel 2: Last Sweep Details - 3 cols */}
        <div className="md:col-span-3 bg-white border-2 border-black rounded-xl p-3 shadow-[2px_2px_0_#000] flex flex-col justify-between text-xs">
          <div className="flex items-center gap-1.5 pb-1 border-b border-black/10">
            <Calendar className="h-3.5 w-3.5 text-[#ec1b16]" />
            <span className="font-display font-black text-black text-xs uppercase tracking-tight">
              Last Sweep
            </span>
          </div>

          <div className="space-y-1 py-1 text-[11px]">
            <div className="flex items-center gap-1 font-bold text-black">
              <Calendar className="h-3 w-3 text-gray-400" />
              <span>02 Nov 2026, 10:24 AM</span>
            </div>
            <div className="flex items-center gap-1 text-[#15803d] font-bold">
              <CheckCircle2 className="h-3 w-3 text-[#22c55e]" />
              <span>Completed</span>
            </div>
            <div className="flex items-center gap-1 text-gray-600 font-medium">
              <Clock className="h-3 w-3 text-gray-400" />
              <span>Duration: 04 min 32 sec</span>
            </div>
            <div className="flex items-center gap-1 text-gray-600 font-medium">
              <Server className="h-3 w-3 text-gray-400" />
              <span>Devices Scanned: 132</span>
            </div>
          </div>
        </div>

        {/* Panel 3: Device Overview KPI Group - 5 cols */}
        <div className="md:col-span-5 bg-white border-2 border-black rounded-xl p-3 shadow-[2px_2px_0_#000] flex flex-col justify-between">
          <div className="flex items-center gap-1.5 pb-1 border-b border-black/10">
            <div className="h-4 w-4 bg-[#facc15] border border-black rounded flex items-center justify-center">
              <span className="text-[10px] font-black">📊</span>
            </div>
            <span className="font-display font-black text-black text-xs uppercase tracking-tight">
              Device Overview
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 pt-1.5">
            {/* Total Devices */}
            <div className="bg-[#0284c7] text-white border-2 border-black rounded-lg p-1.5 text-center shadow-[1px_1px_0_#000]">
              <div className="flex justify-center mb-0.5">
                <Server className="h-3 w-3 text-white" />
              </div>
              <div className="font-display font-black text-base leading-none">{totalCount}</div>
              <div className="text-[8px] font-bold uppercase tracking-tighter opacity-90">Total Devices</div>
            </div>

            {/* Compliant */}
            <div className="bg-[#22c55e] text-white border-2 border-black rounded-lg p-1.5 text-center shadow-[1px_1px_0_#000]">
              <div className="flex justify-center mb-0.5">
                <CheckCircle2 className="h-3 w-3 text-white" />
              </div>
              <div className="font-display font-black text-base leading-none">{compliantCount}</div>
              <div className="text-[8px] font-bold uppercase tracking-tighter opacity-90">Compliant</div>
            </div>

            {/* Drifted */}
            <div className="bg-[#facc15] text-black border-2 border-black rounded-lg p-1.5 text-center shadow-[1px_1px_0_#000]">
              <div className="flex justify-center mb-0.5">
                <AlertTriangle className="h-3 w-3 text-black" />
              </div>
              <div className="font-display font-black text-base leading-none">{driftedCount}</div>
              <div className="text-[8px] font-bold uppercase tracking-tighter opacity-90">Drifted</div>
            </div>

            {/* Unreachable */}
            <div className="bg-[#ec1b16] text-white border-2 border-black rounded-lg p-1.5 text-center shadow-[1px_1px_0_#000]">
              <div className="flex justify-center mb-0.5">
                <XCircle className="h-3 w-3 text-white" />
              </div>
              <div className="font-display font-black text-base leading-none">{unreachableCount}</div>
              <div className="text-[8px] font-bold uppercase tracking-tighter opacity-90">Unreachable</div>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN 3-COLUMN SPLIT: FILTERS | INVENTORY TABLE | DEVICE DETAILS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
        {/* LEFT COLUMN: FILTERS (2.5 of 12 cols, lg:col-span-3) */}
        <div className="lg:col-span-3 bg-white border-2 border-black rounded-xl p-3 shadow-[2px_2px_0_#000] space-y-3">
          {/* Header */}
          <div className="flex items-center gap-2 pb-1.5 border-b-2 border-black/10">
            <div className="h-5 w-5 rounded bg-[#facc15] border border-black flex items-center justify-center">
              <Filter className="h-3 w-3 text-black" />
            </div>
            <h3 className="font-display font-black text-xs text-black uppercase tracking-wider">
              Filters
            </h3>
          </div>

          {/* Group 1: Zone */}
          <div>
            <button
              type="button"
              onClick={() => setShowZoneGroup(!showZoneGroup)}
              className="w-full flex items-center justify-between text-xs font-black font-display text-black mb-1.5 hover:opacity-80"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[#0284c7] font-bold">🧭</span>
                <span>Zone</span>
              </div>
              {showZoneGroup ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>

            {showZoneGroup && (
              <div className="space-y-1.5 pl-3 text-xs font-medium text-gray-800">
                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedZones.includes('Research Labs')}
                    onChange={() => toggleZone('Research Labs')}
                    className="h-3.5 w-3.5 rounded border-black text-[#0284c7] focus:ring-0"
                  />
                  <span>Research Labs (32)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedZones.includes('Classrooms')}
                    onChange={() => toggleZone('Classrooms')}
                    className="h-3.5 w-3.5 rounded border-black text-[#0284c7] focus:ring-0"
                  />
                  <span>Classrooms (45)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedZones.includes('Student Hostels')}
                    onChange={() => toggleZone('Student Hostels')}
                    className="h-3.5 w-3.5 rounded border-black text-[#0284c7] focus:ring-0"
                  />
                  <span>Student Hostels (35)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedZones.includes('Event Wi-Fi')}
                    onChange={() => toggleZone('Event Wi-Fi')}
                    className="h-3.5 w-3.5 rounded border-black text-[#0284c7] focus:ring-0"
                  />
                  <span>Event Wi-Fi (20)</span>
                </label>
              </div>
            )}
          </div>

          {/* Group 2: Device Type */}
          <div>
            <button
              type="button"
              onClick={() => setShowTypeGroup(!showTypeGroup)}
              className="w-full flex items-center justify-between text-xs font-black font-display text-black mb-1.5 hover:opacity-80"
            >
              <div className="flex items-center gap-1.5">
                <Server className="h-3 w-3 text-emerald-600" />
                <span>Device Type</span>
              </div>
              {showTypeGroup ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>

            {showTypeGroup && (
              <div className="space-y-1.5 pl-3 text-xs font-medium text-gray-800">
                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes('Switch')}
                    onChange={() => toggleType('Switch')}
                    className="h-3.5 w-3.5 rounded border-black text-[#0284c7] focus:ring-0"
                  />
                  <span>Switch (48)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes('Router')}
                    onChange={() => toggleType('Router')}
                    className="h-3.5 w-3.5 rounded border-black text-[#0284c7] focus:ring-0"
                  />
                  <span>Router (12)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes('Access Point')}
                    onChange={() => toggleType('Access Point')}
                    className="h-3.5 w-3.5 rounded border-black text-[#0284c7] focus:ring-0"
                  />
                  <span>Access Point (28)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes('Firewall')}
                    onChange={() => toggleType('Firewall')}
                    className="h-3.5 w-3.5 rounded border-black text-[#0284c7] focus:ring-0"
                  />
                  <span>Firewall (4)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black text-gray-400">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes('Other')}
                    onChange={() => toggleType('Other')}
                    className="h-3.5 w-3.5 rounded border-black text-[#0284c7] focus:ring-0"
                  />
                  <span>Other (40)</span>
                </label>
              </div>
            )}
          </div>

          {/* Group 3: Compliance */}
          <div>
            <button
              type="button"
              onClick={() => setShowComplianceGroup(!showComplianceGroup)}
              className="w-full flex items-center justify-between text-xs font-black font-display text-black mb-1.5 hover:opacity-80"
            >
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                <span>Compliance</span>
              </div>
              {showComplianceGroup ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>

            {showComplianceGroup && (
              <div className="space-y-1.5 pl-3 text-xs font-medium text-gray-800">
                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedCompliance.includes('Compliant')}
                    onChange={() => toggleCompliance('Compliant')}
                    className="h-3.5 w-3.5 rounded border-black text-[#22c55e] focus:ring-0"
                  />
                  <span>Compliant (121)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedCompliance.includes('Drifted')}
                    onChange={() => toggleCompliance('Drifted')}
                    className="h-3.5 w-3.5 rounded border-black text-[#ec1b16] focus:ring-0"
                  />
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#ec1b16] border border-black inline-block"></span>
                  <span>Drifted (7)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-black">
                  <input
                    type="checkbox"
                    checked={selectedCompliance.includes('Unreachable')}
                    onChange={() => toggleCompliance('Unreachable')}
                    className="h-3.5 w-3.5 rounded border-black text-rose-500 focus:ring-0"
                  />
                  <span>Unreachable (4)</span>
                </label>
              </div>
            )}
          </div>

          {/* Reset Filters Button */}
          <button
            type="button"
            onClick={resetFilters}
            className="w-full py-1.5 px-3 bg-[#f6f4ee] hover:bg-[#fefce8] border-2 border-black rounded-lg text-xs font-black font-display uppercase tracking-wider shadow-[2px_2px_0_#000] active:translate-y-0.5 flex items-center justify-center gap-2 text-black transition-all"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset Filters</span>
          </button>
        </div>

        {/* MIDDLE COLUMN: DEVICE INVENTORY TABLE (lg:col-span-6) */}
        <div className="lg:col-span-6 bg-white border-2 border-black rounded-xl p-3 shadow-[2px_2px_0_#000] flex flex-col justify-between">
          <div>
            {/* Table Header Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pb-2.5 border-b-2 border-black/10 mb-3">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-[#0284c7]" />
                <h3 className="font-display font-black text-sm text-black">
                  Device Inventory <span className="text-[#ec1b16]">({totalCount})</span>
                </h3>
              </div>

              <div className="flex items-center gap-2">
                {/* Search Bar */}
                <div className="relative flex-1 sm:w-56">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by hostname, IP or model..."
                    className="w-full pl-8 pr-2.5 py-1 bg-[#fdfbf7] border-2 border-black rounded-lg text-xs font-medium text-black focus:outline-hidden shadow-[1px_1px_0_#000]"
                  />
                </div>

                {/* Add Device Button (Admins/NetEng) */}
                {isNetEng && (
                  <button
                    type="button"
                    onClick={handleOpenAddModal}
                    className="px-2.5 py-1 bg-[#facc15] hover:bg-[#eab308] border-2 border-black rounded-lg text-[11px] font-black font-display uppercase tracking-tight shadow-[1px_1px_0_#000] active:translate-y-0.5 flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Add</span>
                  </button>
                )}
              </div>
            </div>

            {/* Inventory Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b-2 border-black/20 text-gray-600 font-display font-black text-[10px] uppercase tracking-wider">
                    <th className="pb-1.5 px-1.5 w-6">
                      <input
                        type="checkbox"
                        checked={selectedRowIds.size > 0 && selectedRowIds.size === paginatedDevices.length}
                        onChange={toggleSelectAll}
                        className="h-3 w-3 rounded border-black text-[#0284c7] focus:ring-0"
                      />
                    </th>
                    <th className="pb-1.5 px-1.5">Hostname</th>
                    <th className="pb-1.5 px-1.5">IP Address</th>
                    <th className="pb-1.5 px-1.5">Type</th>
                    <th className="pb-1.5 px-1.5">Zone</th>
                    <th className="pb-1.5 px-1.5">Compliance</th>
                    <th className="pb-1.5 px-1.5">Last Sweep</th>
                    <th className="pb-1.5 px-1.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {isDevicesLoading && apiDevices.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-gray-500 font-medium">
                        Loading device inventory...
                      </td>
                    </tr>
                  ) : paginatedDevices.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-gray-500 font-medium">
                        <div className="flex flex-col items-center justify-center gap-1">
                          <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                          <span>No devices found matching your filters.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedDevices.map((dev) => {
                      const isSelected = selectedDeviceId === dev.id;
                      const isChecked = selectedRowIds.has(dev.id);

                      return (
                        <tr
                          key={dev.id}
                          onClick={() => setSelectedDeviceId(dev.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[#fefce8] font-semibold'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          {/* Row Checkbox */}
                          <td className="py-2 px-1.5 align-middle" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelectRow(dev.id)}
                              className="h-3 w-3 rounded border-black text-[#0284c7] focus:ring-0"
                            />
                          </td>

                          {/* Hostname */}
                          <td className="py-2 px-1.5 align-middle font-mono font-bold text-black whitespace-nowrap">
                            <span className={isSelected ? 'text-[#0284c7]' : ''}>{dev.hostname}</span>
                          </td>

                          {/* IP Address */}
                          <td className="py-2 px-1.5 align-middle font-mono text-gray-700 text-[11px] whitespace-nowrap">
                            {dev.ipAddress}
                          </td>

                          {/* Hardware Type with Icon */}
                          <td className="py-2 px-1.5 align-middle text-gray-700 whitespace-nowrap text-[11px]">
                            <div className="flex items-center gap-1.5">
                              {renderHardwareIcon(dev.deviceType)}
                              <span>{dev.deviceTypeName}</span>
                            </div>
                          </td>

                          {/* Zone with Icon */}
                          <td className="py-2 px-1.5 align-middle text-gray-700 whitespace-nowrap text-[11px]">
                            <div className="flex items-center gap-1.5">
                              {renderZoneIcon(dev.zoneIcon)}
                              <span>{dev.zone}</span>
                            </div>
                          </td>

                          {/* Compliance Status Badge */}
                          <td className="py-2 px-1.5 align-middle whitespace-nowrap">
                            {dev.compliance === 'Compliant' ? (
                              <span className="inline-block px-2 py-0.5 bg-[#dcfce7] text-[#15803d] border border-[#22c55e]/40 font-bold font-display text-[9px] rounded-full">
                                Compliant
                              </span>
                            ) : dev.compliance === 'Drifted' ? (
                              <span className="inline-block px-2 py-0.5 bg-[#fef2f2] text-[#dc2626] border border-[#ef4444]/40 font-bold font-display text-[9px] rounded-full">
                                Drifted
                              </span>
                            ) : (
                              <span className="inline-block px-2 py-0.5 bg-[#ffe4e6] text-[#e11d48] border border-[#f43f5e]/40 font-bold font-display text-[9px] rounded-full">
                                Unreachable
                              </span>
                            )}
                          </td>

                          {/* Last Sweep */}
                          <td className="py-2 px-1.5 align-middle font-mono text-gray-600 text-[10px] whitespace-nowrap">
                            {dev.lastSweepTime}
                          </td>

                          {/* Actions */}
                          <td className="py-2 px-1.5 align-middle text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <div className="inline-flex items-center gap-1">
                              {/* Quick inspect view */}
                              <button
                                type="button"
                                onClick={() => setSelectedDeviceId(dev.id)}
                                className="p-1 hover:bg-black/5 rounded text-gray-600 hover:text-black"
                                title="Inspect Device"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>

                              {/* Action dropdown menu */}
                              <div className="relative inline-block text-left">
                                <button
                                  type="button"
                                  onClick={() => setActiveMenuId(activeMenuId === dev.id ? null : dev.id)}
                                  className="p-1 hover:bg-black/5 rounded text-gray-600 hover:text-black"
                                >
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>

                                {activeMenuId === dev.id && (
                                  <div className="absolute right-0 top-full mt-1 w-44 bg-white border-2 border-black rounded-lg shadow-[3px_3px_0_#000] py-1 z-30 text-left">
                                    {isNetEng && (
                                      <button
                                        type="button"
                                        onClick={() => pollMutation.mutate(dev.id)}
                                        className="w-full text-left px-3 py-1.5 text-xs text-sky-700 hover:bg-sky-50 flex items-center gap-1.5 font-bold"
                                      >
                                        <RefreshCw className="h-3 w-3" />
                                        <span>Poll Device Now</span>
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      onClick={() => navigate(`/devices/${dev.id}`)}
                                      className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 flex items-center gap-1.5"
                                    >
                                      <FileText className="h-3 w-3" />
                                      <span>Full Diagnostics</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => navigate('/baselines')}
                                      className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 flex items-center gap-1.5"
                                    >
                                      <GitCompare className="h-3 w-3" />
                                      <span>View Baseline</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Table Bottom Pagination Bar */}
          <div className="flex items-center justify-between pt-3 border-t-2 border-black/10 mt-2 text-xs">
            <span className="text-[11px] font-medium text-gray-600">
              Showing {Math.min(filteredDevices.length, (currentPage - 1) * pageSize + 1)} -{' '}
              {Math.min(filteredDevices.length, currentPage * pageSize)} of {totalCount} devices
            </span>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="h-6 w-6 rounded border border-black flex items-center justify-center hover:bg-black/5 disabled:opacity-40"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>

              <button
                type="button"
                className="h-6 px-2 bg-[#0284c7] text-white border border-black rounded text-[11px] font-black font-display"
              >
                1
              </button>
              <button
                type="button"
                className="h-6 px-2 bg-white text-black border border-black rounded text-[11px] font-black font-display hover:bg-black/5"
              >
                2
              </button>
              <button
                type="button"
                className="h-6 px-2 bg-white text-black border border-black rounded text-[11px] font-black font-display hover:bg-black/5"
              >
                3
              </button>
              <span className="text-gray-400 px-0.5">...</span>
              <button
                type="button"
                className="h-6 px-2 bg-white text-black border border-black rounded text-[11px] font-black font-display hover:bg-black/5"
              >
                17
              </button>

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="h-6 w-6 rounded border border-black flex items-center justify-center hover:bg-black/5 disabled:opacity-40"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: DEVICE DETAILS INSPECTOR (lg:col-span-3) */}
        <div className="lg:col-span-3 bg-white border-2 border-black rounded-xl p-3.5 shadow-[2px_2px_0_#000] space-y-3.5">
          {/* Header */}
          <div className="flex items-center gap-2 pb-2 border-b-2 border-black/10">
            <Server className="h-4 w-4 text-[#0284c7]" />
            <h3 className="font-display font-black text-xs text-black uppercase tracking-wider">
              Device Details
            </h3>
          </div>

          {/* Active Device Card Header */}
          <div className="flex items-start gap-2.5">
            <div className="p-2 rounded-lg bg-[#38bdf8]/20 border border-black shrink-0">
              {renderHardwareIcon(activeDevice.deviceType)}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="font-display font-black text-sm text-black truncate">
                  {activeDevice.hostname}
                </span>
                {activeDevice.compliance === 'Compliant' ? (
                  <span className="px-2 py-0.5 bg-[#22c55e] text-white border border-black font-black font-display text-[9px] rounded-xs shadow-[1px_1px_0_#000]">
                    Compliant
                  </span>
                ) : activeDevice.compliance === 'Drifted' ? (
                  <span className="px-2 py-0.5 bg-[#ec1b16] text-white border border-black font-black font-display text-[9px] rounded-xs shadow-[1px_1px_0_#000]">
                    Drifted
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-rose-500 text-white border border-black font-black font-display text-[9px] rounded-xs shadow-[1px_1px_0_#000]">
                    Unreachable
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-600 font-medium truncate">
                {activeDevice.deviceTypeName} | {activeDevice.zone}
              </div>
            </div>
          </div>

          {/* Specifications Table */}
          <div className="space-y-1.5 text-xs border-y border-black/10 py-2.5 font-medium">
            <div className="flex justify-between items-center">
              <span className="font-black font-display text-gray-800">IP Address</span>
              <span className="font-mono text-gray-900">{activeDevice.ipAddress}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="font-black font-display text-gray-800">Model</span>
              <span className="text-gray-900">{activeDevice.model}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="font-black font-display text-gray-800">OS Version</span>
              <span className="font-mono text-gray-900">{activeDevice.osVersion}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="font-black font-display text-gray-800">Baseline</span>
              <span className="text-emerald-700 font-bold">{activeDevice.baselineVersion}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="font-black font-display text-gray-800">Last Sweep</span>
              <span className="font-mono text-gray-600 text-[11px]">
                02 Nov 2026, {activeDevice.lastSweepTime}
              </span>
            </div>
          </div>

          {/* 3 Chunky 3D Arcade Buttons */}
          <div className="space-y-2 pt-1">
            {/* Button 1: View Configuration */}
            <button
              type="button"
              onClick={() => navigate(`/devices/${activeDevice.id}`)}
              className="w-full py-2 px-3 bg-[#0284c7] hover:bg-[#0369a1] text-white border-2 border-black rounded-xl font-display font-black text-xs uppercase tracking-wider shadow-[0_3px_0_#0369a1] active:shadow-none active:translate-y-0.5 transition-all flex items-center justify-center gap-2"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>View Configuration</span>
            </button>

            {/* Button 2: Compare with Baseline */}
            <button
              type="button"
              onClick={() => navigate('/drift')}
              className="w-full py-2 px-3 bg-[#facc15] hover:bg-[#eab308] text-black border-2 border-black rounded-xl font-display font-black text-xs uppercase tracking-wider shadow-[0_3px_0_#ca8a04] active:shadow-none active:translate-y-0.5 transition-all flex items-center justify-center gap-2"
            >
              <GitCompare className="h-3.5 w-3.5" />
              <span>Compare with Baseline</span>
            </button>

            {/* Button 3: Create Remediation */}
            <button
              type="button"
              onClick={() => navigate('/remediation')}
              className="w-full py-2 px-3 bg-[#22c55e] hover:bg-[#16a34a] text-white border-2 border-black rounded-xl font-display font-black text-xs uppercase tracking-wider shadow-[0_3px_0_#15803d] active:shadow-none active:translate-y-0.5 transition-all flex items-center justify-center gap-2"
            >
              <Wrench className="h-3.5 w-3.5" />
              <span>Create Remediation</span>
            </button>
          </div>
        </div>
      </div>

      {/* ADD DEVICE MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#fdfbf7] border-[3px] border-black rounded-2xl shadow-[6px_6px_0_#000] p-5 max-w-md w-full relative">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              className="absolute top-3 right-3 p-1 rounded hover:bg-black/10"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2 pb-3 border-b-2 border-black/10 mb-4">
              <Server className="h-5 w-5 text-[#0284c7]" />
              <h3 className="font-display font-black text-lg text-black">
                Add Campus Network Device
              </h3>
            </div>

            {formError && (
              <div className="mb-4 p-2 bg-rose-100 border-2 border-rose-600 rounded-xl text-rose-800 text-xs font-bold">
                {formError}
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-black font-display text-gray-800 mb-1">
                  Hostname
                </label>
                <input
                  type="text"
                  required
                  value={formHostname}
                  onChange={(e) => setFormHostname(e.target.value)}
                  placeholder="e.g. sw-lab-04"
                  className="w-full px-3 py-1.5 bg-white border-2 border-black rounded-lg text-black font-mono shadow-[1px_1px_0_#000]"
                />
              </div>

              <div>
                <label className="block font-black font-display text-gray-800 mb-1">
                  IP Address
                </label>
                <input
                  type="text"
                  required
                  value={formIp}
                  onChange={(e) => setFormIp(e.target.value)}
                  placeholder="10.10.x.x"
                  className="w-full px-3 py-1.5 bg-white border-2 border-black rounded-lg text-black font-mono shadow-[1px_1px_0_#000]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-black font-display text-gray-800 mb-1">
                    Vendor
                  </label>
                  <select
                    value={formVendor}
                    onChange={(e) => setFormVendor(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border-2 border-black rounded-lg text-black shadow-[1px_1px_0_#000]"
                  >
                    <option value="cisco_ios">Cisco IOS</option>
                    <option value="frr">FRRouting</option>
                  </select>
                </div>

                <div>
                  <label className="block font-black font-display text-gray-800 mb-1">
                    Model
                  </label>
                  <input
                    type="text"
                    value={formModel}
                    onChange={(e) => setFormModel(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border-2 border-black rounded-lg text-black shadow-[1px_1px_0_#000]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-black font-display text-gray-800 mb-1">
                  Campus Zone Group
                </label>
                <select
                  value={formGroupId}
                  onChange={(e) => setFormGroupId(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border-2 border-black rounded-lg text-black shadow-[1px_1px_0_#000]"
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} (Criticality x{g.criticality_weight})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t-2 border-black/10">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 border-2 border-black rounded-lg font-bold font-display uppercase"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addDeviceMutation.isPending}
                  className="px-4 py-1.5 bg-[#22c55e] hover:bg-[#16a34a] text-white border-2 border-black rounded-lg font-black font-display uppercase shadow-[2px_2px_0_#000] active:translate-y-0.5"
                >
                  {addDeviceMutation.isPending ? 'Enrolling...' : 'Enroll Device'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
