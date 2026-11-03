import React, { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Layers,
  Code2,
  Filter,
  Search,
  MoreHorizontal,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  FileText,
  Shield,
  Terminal,
  Play,
  Save,
  Edit,
  X,
  CheckCircle2,
  Clock,
  Target,
  Sliders,
  Check,
  BookOpen,
  Network,
} from 'lucide-react';
import { apiClient } from '../api/client';
import baselineRulesHeaderArt from '../assets/baseline-rules-header-art.png';

export interface BaselineRule {
  id: string;
  number: number;
  name: string;
  category: 'Security' | 'Access Control' | 'Management' | 'Interface' | 'Routing' | 'Other';
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  expected_value: string;
  regex_pattern: string;
  severity_weight: number;
  status: 'Enabled' | 'Disabled';
  description: string;
  test_result: {
    device: string;
    result: 'PASS' | 'FAIL';
    diff_removed?: string;
    diff_added?: string;
  };
}

export interface BaselineDetail {
  id: string;
  name: string;
  device_group_name?: string | null;
  vendor: string;
  version: number | string;
  is_active: boolean;
  target_zones: string;
  devices_covered: number;
  compliance_rate: number;
  created_at: string;
  last_updated: string;
}

// 24 Detailed Rules matching the catalog and design mockup
const DEFAULT_RULES: BaselineRule[] = [
  {
    id: 'rule-01',
    number: 1,
    name: 'Disable Telnet',
    category: 'Security',
    severity: 'Critical',
    expected_value: 'no telnet server',
    regex_pattern: '^no\\s+telnet\\s+server$',
    severity_weight: 10,
    status: 'Enabled',
    description: 'Telnet must be disabled on all devices.',
    test_result: {
      device: 'sw-lab-03',
      result: 'FAIL',
      diff_removed: '- telnet server',
      diff_added: '+ no telnet server',
    },
  },
  {
    id: 'rule-02',
    number: 2,
    name: 'Enforce SSH v2',
    category: 'Security',
    severity: 'High',
    expected_value: 'ip ssh version 2',
    regex_pattern: '^ip\\s+ssh\\s+version\\s+2$',
    severity_weight: 8,
    status: 'Enabled',
    description: 'Enforce SSH version 2 protocol to prevent downgrade attacks.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-03',
    number: 3,
    name: 'SSH Access ACL',
    category: 'Access Control',
    severity: 'High',
    expected_value: 'access-list 10 ...',
    regex_pattern: '^access-list\\s+10\\s+permit\\s+10\\.10\\.0\\.0',
    severity_weight: 8,
    status: 'Enabled',
    description: 'VTY transport lines must be protected with an access class limiting access to admin subnets.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-04',
    number: 4,
    name: 'SNMP Community',
    category: 'Management',
    severity: 'Medium',
    expected_value: 'snmp-server community ...',
    regex_pattern: '^snmp-server\\s+community\\s+\\S+\\s+RO',
    severity_weight: 5,
    status: 'Enabled',
    description: 'Public or default SNMP community strings must be strictly prohibited.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-05',
    number: 5,
    name: 'NTP Configuration',
    category: 'Management',
    severity: 'Medium',
    expected_value: 'ntp server 10.10.0.5',
    regex_pattern: '^ntp\\s+server\\s+10\\.10\\.0\\.5$',
    severity_weight: 5,
    status: 'Enabled',
    description: 'Centralized Stratum-1 campus NTP synchronization for audit timestamp correlation.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-06',
    number: 6,
    name: 'Interface Description',
    category: 'Interface',
    severity: 'Low',
    expected_value: 'description .+',
    regex_pattern: '^description\\s+.+$',
    severity_weight: 3,
    status: 'Enabled',
    description: 'Active interfaces must have descriptive labels indicating connected site or VLAN.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-07',
    number: 7,
    name: 'Disable Unused Ports',
    category: 'Security',
    severity: 'High',
    expected_value: 'shutdown (unused)',
    regex_pattern: '^shutdown$',
    severity_weight: 8,
    status: 'Enabled',
    description: 'Unallocated access ports must be kept in administrative shutdown status.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-08',
    number: 8,
    name: 'ACL Ordering',
    category: 'Access Control',
    severity: 'Critical',
    expected_value: 'access-list order',
    regex_pattern: '^access-list\\s+\\d+\\s+deny\\s+any',
    severity_weight: 10,
    status: 'Enabled',
    description: 'Implicit or explicit deny statements must terminate ACL sequences.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-09',
    number: 9,
    name: 'Port Security Max MAC',
    category: 'Security',
    severity: 'High',
    expected_value: 'switchport port-security maximum 2',
    regex_pattern: '^switchport\\s+port-security\\s+maximum\\s+2$',
    severity_weight: 8,
    status: 'Enabled',
    description: 'Edge switchports must enforce a maximum limit of 2 MAC addresses to prevent rogue switches.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-10',
    number: 10,
    name: 'BPDU Guard',
    category: 'Security',
    severity: 'High',
    expected_value: 'spanning-tree bpduguard enable',
    regex_pattern: '^spanning-tree\\s+bpduguard\\s+enable$',
    severity_weight: 7,
    status: 'Enabled',
    description: 'Edge ports must drop unauthorized spanning-tree bridge protocol data units.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-11',
    number: 11,
    name: 'Root Guard Uplink',
    category: 'Security',
    severity: 'High',
    expected_value: 'spanning-tree guard root',
    regex_pattern: '^spanning-tree\\s+guard\\s+root$',
    severity_weight: 8,
    status: 'Enabled',
    description: 'Uplink trunk interfaces must enforce STP root protection.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-12',
    number: 12,
    name: 'DHCP Snooping',
    category: 'Security',
    severity: 'High',
    expected_value: 'ip dhcp snooping',
    regex_pattern: '^ip\\s+dhcp\\s+snooping$',
    severity_weight: 8,
    status: 'Enabled',
    description: 'Mitigate rogue DHCP servers offering spoofed default gateway addresses.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-13',
    number: 13,
    name: 'Password Encryption',
    category: 'Security',
    severity: 'Medium',
    expected_value: 'service password-encryption',
    regex_pattern: '^service\\s+password-encryption$',
    severity_weight: 6,
    status: 'Enabled',
    description: 'Obfuscate plain-text passwords in running configuration files.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-14',
    number: 14,
    name: 'VLAN 1 Access Prohibited',
    category: 'Access Control',
    severity: 'High',
    expected_value: 'no switchport access vlan 1',
    regex_pattern: '^no\\s+switchport\\s+access\\s+vlan\\s+1$',
    severity_weight: 7,
    status: 'Enabled',
    description: 'Default VLAN 1 must not be assigned to student or guest access ports.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-15',
    number: 15,
    name: 'Trunk Native VLAN Isolation',
    category: 'Access Control',
    severity: 'Medium',
    expected_value: 'switchport trunk native vlan 999',
    regex_pattern: '^switchport\\s+trunk\\s+native\\s+vlan\\s+999$',
    severity_weight: 6,
    status: 'Enabled',
    description: 'Direct untagged frame traffic on trunk lines into an isolated sink VLAN.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-16',
    number: 16,
    name: 'Logging Buffered Buffer',
    category: 'Management',
    severity: 'Medium',
    expected_value: 'logging buffered 64000',
    regex_pattern: '^logging\\s+buffered\\s+\\d+$',
    severity_weight: 5,
    status: 'Enabled',
    description: 'Retain local event buffer logs in circular memory for offline recovery.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-17',
    number: 17,
    name: 'Remote Syslog Host',
    category: 'Management',
    severity: 'Medium',
    expected_value: 'logging host 10.10.0.10',
    regex_pattern: '^logging\\s+host\\s+10\\.10\\.0\\.10$',
    severity_weight: 5,
    status: 'Enabled',
    description: 'Stream security audit logs to central SIEM logging collector.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-18',
    number: 18,
    name: 'OSPF Passive Interfaces',
    category: 'Routing',
    severity: 'Medium',
    expected_value: 'passive-interface default',
    regex_pattern: '^passive-interface\\s+default$',
    severity_weight: 5,
    status: 'Enabled',
    description: 'Prevent routing adjacency protocol packet leakage across edge access ports.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-19',
    number: 19,
    name: 'BGP MD5 Peering Secret',
    category: 'Routing',
    severity: 'Critical',
    expected_value: 'neighbor password',
    regex_pattern: '^neighbor\\s+\\S+\\s+password\\s+\\S+$',
    severity_weight: 10,
    status: 'Enabled',
    description: 'Inter-site backbone BGP neighbors must authenticate using MD5 secrets.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-20',
    number: 20,
    name: 'LLDP Discovery Protocol',
    category: 'Interface',
    severity: 'Low',
    expected_value: 'lldp run',
    regex_pattern: '^lldp\\s+run$',
    severity_weight: 3,
    status: 'Enabled',
    description: 'Enable IEEE 802.1AB standard Link Layer Discovery Protocol.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-21',
    number: 21,
    name: 'Storm Control Broadcast',
    category: 'Interface',
    severity: 'Medium',
    expected_value: 'storm-control broadcast level 20',
    regex_pattern: '^storm-control\\s+broadcast\\s+level',
    severity_weight: 6,
    status: 'Enabled',
    description: 'Suppress broadcast packet storm loops on edge access switches.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-22',
    number: 22,
    name: 'Banner MOTD Notice',
    category: 'Other',
    severity: 'Low',
    expected_value: 'banner motd # Authorized Access Only #',
    regex_pattern: '^banner\\s+motd',
    severity_weight: 2,
    status: 'Enabled',
    description: 'Display formal security disclaimer and login warning banner.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-23',
    number: 23,
    name: 'Dynamic ARP Inspection',
    category: 'Access Control',
    severity: 'Critical',
    expected_value: 'ip arp inspection vlan 10,20,30',
    regex_pattern: '^ip\\s+arp\\s+inspection\\s+vlan',
    severity_weight: 9,
    status: 'Disabled',
    description: 'Validate ARP packets against DHCP snooping database bindings.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
  {
    id: 'rule-24',
    number: 24,
    name: 'HTTP Server Disabled',
    category: 'Other',
    severity: 'Medium',
    expected_value: 'no ip http server',
    regex_pattern: '^no\\s+ip\\s+http\\s+server$',
    severity_weight: 4,
    status: 'Disabled',
    description: 'Disable legacy unencrypted HTTP web management service.',
    test_result: {
      device: 'sw-lab-03',
      result: 'PASS',
    },
  },
];

export const BaselineDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  // Baseline Data
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

  const baselineInfo: BaselineDetail = serverBaseline || {
    id: id || 'base-01',
    name: 'Campus-Switch-Standard',
    vendor: 'Cisco',
    version: 'v3.2',
    is_active: true,
    target_zones: 'All Campus Zones',
    devices_covered: 48,
    compliance_rate: 94.8,
    created_at: '2026-10-15T11:07:00Z',
    last_updated: '02 Nov 2026, 09:48 AM',
  };

  // State
  const [activeTab, setActiveTab] = useState<'overview' | 'rules' | 'config' | 'versions' | 'impact'>('rules');
  const [rules, setRules] = useState<BaselineRule[]>(DEFAULT_RULES);
  const [selectedRuleId, setSelectedRuleId] = useState<string>('rule-01');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['Security']);
  const [selectedSeverities, setSelectedSeverities] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['Enabled']);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 8;

  // Filter Collapsibles
  const [categoryOpen, setCategoryOpen] = useState(true);
  const [severityOpen, setSeverityOpen] = useState(true);
  const [statusOpen, setStatusOpen] = useState(true);

  // Selected Rule Checkboxes for Bulk Action
  const [checkedRuleIds, setCheckedRuleIds] = useState<string[]>(['rule-01']);

  // Modals & Notifications
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<BaselineRule | null>(null);
  const [isTestingOnDevice, setIsTestingOnDevice] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Selected Rule object
  const selectedRule = useMemo(() => {
    return rules.find((r) => r.id === selectedRuleId) || rules[0];
  }, [rules, selectedRuleId]);

  // Filtering
  const filteredRules = useMemo(() => {
    return rules.filter((r) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = r.name.toLowerCase().includes(q);
        const matchesCat = r.category.toLowerCase().includes(q);
        const matchesExpected = r.expected_value.toLowerCase().includes(q);
        if (!matchesName && !matchesCat && !matchesExpected) {
          return false;
        }
      }

      // Category
      if (selectedCategories.length > 0) {
        if (!selectedCategories.includes(r.category)) {
          return false;
        }
      }

      // Severity
      if (selectedSeverities.length > 0) {
        if (!selectedSeverities.includes(r.severity)) {
          return false;
        }
      }

      // Status
      if (selectedStatuses.length > 0) {
        if (!selectedStatuses.includes(r.status)) {
          return false;
        }
      }

      return true;
    });
  }, [rules, searchQuery, selectedCategories, selectedSeverities, selectedStatuses]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredRules.length / pageSize));
  const paginatedRules = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRules.slice(start, start + pageSize);
  }, [filteredRules, currentPage, pageSize]);

  // Toggle helpers
  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
    setCurrentPage(1);
  };

  const toggleSeverity = (sev: string) => {
    setSelectedSeverities((prev) =>
      prev.includes(sev) ? prev.filter((s) => s !== sev) : [...prev, sev]
    );
    setCurrentPage(1);
  };

  const toggleStatus = (st: string) => {
    setSelectedStatuses((prev) =>
      prev.includes(st) ? prev.filter((s) => s !== st) : [...prev, st]
    );
    setCurrentPage(1);
  };

  const handleResetFilters = () => {
    setSelectedCategories([]);
    setSelectedSeverities([]);
    setSelectedStatuses([]);
    setSearchQuery('');
    setCurrentPage(1);
  };

  const toggleCheckRule = (id: string) => {
    setCheckedRuleIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (checkedRuleIds.length === paginatedRules.length) {
      setCheckedRuleIds([]);
    } else {
      setCheckedRuleIds(paginatedRules.map((r) => r.id));
    }
  };

  const handleOpenEdit = (rule: BaselineRule) => {
    setEditingRule({ ...rule });
    setEditModalOpen(true);
  };

  const handleSaveEditRule = () => {
    if (!editingRule) return;
    setRules((prev) =>
      prev.map((r) => (r.id === editingRule.id ? editingRule : r))
    );
    setEditModalOpen(false);
    setActionNotice(`Rule "${editingRule.name}" updated successfully!`);
    setTimeout(() => setActionNotice(null), 3000);
  };

  const handleTestOnDevice = () => {
    setIsTestingOnDevice(true);
    setTimeout(() => {
      setIsTestingOnDevice(false);
      setActionNotice(`Tested rule "${selectedRule.name}" on sw-lab-03. Current Result: ${selectedRule.test_result.result}`);
      setTimeout(() => setActionNotice(null), 3500);
    }, 800);
  };

  // Severity pill helper
  const renderSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'Critical':
        return (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black bg-[#ef4444] text-white shadow-2xs">
            Critical
          </span>
        );
      case 'High':
        return (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black bg-[#facc15] text-[#713f12] shadow-2xs">
            High
          </span>
        );
      case 'Medium':
        return (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black bg-[#0284c7] text-white shadow-2xs">
            Medium
          </span>
        );
      case 'Low':
        return (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black bg-[#22c55e] text-white shadow-2xs">
            Low
          </span>
        );
      default:
        return <span>{severity}</span>;
    }
  };

  return (
    <div className="space-y-3.5 pb-12 font-sans select-none">
      {/* 1. TOP HEADER BANNER */}
      <div className="relative bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] p-3 sm:p-4 shadow-[3px_3px_0px_#1e293b] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 overflow-hidden">
        {/* Left Title and Breadcrumbs */}
        <div className="z-10 space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#38bdf8] border-2 border-[#1e293b] flex items-center justify-center text-white shadow-[2px_2px_0px_#1e293b] shrink-0 font-mono font-black text-sm">
              &lt;/&gt;
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-[#1e293b] tracking-tight font-pixel">
                Baseline Rule Inspector &amp; Editor
              </h1>
              <p className="text-xs text-slate-600 font-medium">
                Inspect, edit and manage configuration rules for a baseline.
              </p>
            </div>
          </div>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold pl-1 pt-0.5">
            <span>🏠</span>
            <span>|</span>
            <Link to="/baselines" className="hover:text-sky-600 transition-colors">Baselines</Link>
            <span>&gt;</span>
            <span className="text-slate-800 font-bold">{baselineInfo.name}</span>
            <span>&gt;</span>
            <span className="text-sky-600 font-bold">Rules</span>
          </div>
        </div>

        {/* Right Art Graphic (Building + Fox with Checklist) */}
        <div className="hidden lg:flex items-center justify-end shrink-0 h-14 pr-1">
          <img
            src={baselineRulesHeaderArt}
            alt="Baseline Rules Inspector Mascot"
            className="h-12 w-auto object-contain pointer-events-none drop-shadow-sm"
          />
        </div>
      </div>

      {/* 2. HERO OVERVIEW RIBBON */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
        {/* Blue Gradient Cartridge Badge */}
        <div className="lg:col-span-5 bg-gradient-to-r from-[#00b4d8] to-[#0077b6] text-white rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] p-3 flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-[#0369a1] border-2 border-[#1e293b] flex items-center justify-center shadow-inner shrink-0">
            <Layers className="w-7 h-7 text-[#7dd3fc]" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black tracking-tight leading-tight">
              {baselineInfo.name}
            </h2>
            <div className="flex items-center gap-2 mt-1 text-xs text-sky-100 font-semibold">
              <span>Switch</span>
              <span>|</span>
              <span>{baselineInfo.vendor}</span>
              <span>|</span>
              <span className="font-mono">{baselineInfo.version}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#22c55e] text-white shadow-sm">
                Active
              </span>
            </div>
          </div>
        </div>

        {/* 4 Metadata Cards */}
        <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {/* Card 1: Target Zones */}
          <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] p-2.5 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#ef4444] text-white border border-[#1e293b] flex items-center justify-center shrink-0">
              <Target className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Target Zones</span>
              <span className="text-xs font-black text-slate-800">{baselineInfo.target_zones}</span>
            </div>
          </div>

          {/* Card 2: Devices Covered */}
          <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] p-2.5 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0284c7] text-white border border-[#1e293b] flex items-center justify-center shrink-0">
              <Network className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Devices Covered</span>
              <span className="text-xs font-black text-slate-800">{baselineInfo.devices_covered}</span>
            </div>
          </div>

          {/* Card 3: Compliance */}
          <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] p-2.5 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#22c55e] text-white border border-[#1e293b] flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Compliance</span>
              <span className="text-xs font-black text-[#15803d]">{baselineInfo.compliance_rate}%</span>
            </div>
          </div>

          {/* Card 4: Last Updated */}
          <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] p-2.5 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#facc15] text-[#713f12] border border-[#1e293b] flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Last Updated</span>
              <span className="text-[11px] font-black text-slate-800 truncate block">{baselineInfo.last_updated}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Notice Banner */}
      {actionNotice && (
        <div className="p-2.5 rounded-xl border-2 border-[#0284c7] bg-[#f0f9ff] text-[#0369a1] text-xs font-bold flex items-center gap-2 shadow-[2px_2px_0px_#1e293b]">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* 3. FIVE ARCADE NAVIGATION TABS */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`py-1.5 px-4 rounded-lg border-2 text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center gap-1.5 whitespace-nowrap transition-transform ${
            activeTab === 'overview'
              ? 'bg-white border-[#ef4444] text-[#ef4444]'
              : 'bg-[#fcf9f2] border-[#1e293b] text-slate-700 hover:bg-white'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Overview</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('rules')}
          className={`py-1.5 px-4 rounded-lg border-2 text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center gap-1.5 whitespace-nowrap transition-transform ${
            activeTab === 'rules'
              ? 'bg-white border-[#ef4444] text-[#ef4444]'
              : 'bg-[#fcf9f2] border-[#1e293b] text-slate-700 hover:bg-white'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>Rules ({rules.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('config')}
          className={`py-1.5 px-4 rounded-lg border-2 text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center gap-1.5 whitespace-nowrap transition-transform ${
            activeTab === 'config'
              ? 'bg-white border-[#ef4444] text-[#ef4444]'
              : 'bg-[#fcf9f2] border-[#1e293b] text-slate-700 hover:bg-white'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Configuration</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('versions')}
          className={`py-1.5 px-4 rounded-lg border-2 text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center gap-1.5 whitespace-nowrap transition-transform ${
            activeTab === 'versions'
              ? 'bg-white border-[#ef4444] text-[#ef4444]'
              : 'bg-[#fcf9f2] border-[#1e293b] text-slate-700 hover:bg-white'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Version History</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('impact')}
          className={`py-1.5 px-4 rounded-lg border-2 text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center gap-1.5 whitespace-nowrap transition-transform ${
            activeTab === 'impact'
              ? 'bg-white border-[#ef4444] text-[#ef4444]'
              : 'bg-[#fcf9f2] border-[#1e293b] text-slate-700 hover:bg-white'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Usage &amp; Impact</span>
        </button>
      </div>

      {/* 4. MAIN THREE-COLUMN WORKSPACE (When tab === 'rules') */}
      {activeTab === 'rules' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
          {/* LEFT COLUMN: RULE FILTERS (col-span-3 xl:col-span-2) */}
          <div className="lg:col-span-3 xl:col-span-2 space-y-3">
            <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] p-3 space-y-3">
              {/* Filter Header */}
              <div className="flex items-center gap-2 pb-2 border-b-2 border-slate-200">
                <Filter className="w-4 h-4 text-[#eab308] fill-[#eab308]" />
                <h2 className="text-xs font-black uppercase tracking-wider text-slate-800">
                  Rule Filters
                </h2>
              </div>

              {/* Filter 1: Category */}
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setCategoryOpen(!categoryOpen)}
                  className="w-full flex items-center justify-between text-xs font-bold text-slate-800 hover:text-sky-600 transition-colors"
                >
                  <span>Category</span>
                  {categoryOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {categoryOpen && (
                  <div className="space-y-0.5 text-xs pt-0.5">
                    {[
                      { label: 'Security', count: 8 },
                      { label: 'Access Control', count: 5 },
                      { label: 'Management', count: 4 },
                      { label: 'Interface', count: 3 },
                      { label: 'Routing', count: 2 },
                      { label: 'Other', count: 2 },
                    ].map((item) => {
                      const isChecked = selectedCategories.includes(item.label);
                      return (
                        <label
                          key={item.label}
                          onClick={() => toggleCategory(item.label)}
                          className="flex items-center justify-between py-0.5 px-1 rounded hover:bg-[#f1ece1] cursor-pointer"
                        >
                          <div className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="w-3.5 h-3.5 rounded border-[#1e293b] text-rose-600 focus:ring-0 cursor-pointer"
                            />
                            <span className="text-slate-700 text-[11px]">{item.label}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">({item.count})</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Filter 2: Severity */}
              <div className="space-y-1 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setSeverityOpen(!severityOpen)}
                  className="w-full flex items-center justify-between text-xs font-bold text-slate-800 hover:text-sky-600 transition-colors"
                >
                  <span>Severity</span>
                  {severityOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {severityOpen && (
                  <div className="space-y-0.5 text-xs pt-0.5">
                    {[
                      { label: 'Critical', count: 6 },
                      { label: 'High', count: 7 },
                      { label: 'Medium', count: 8 },
                      { label: 'Low', count: 3 },
                    ].map((item) => {
                      const isChecked = selectedSeverities.includes(item.label);
                      return (
                        <label
                          key={item.label}
                          onClick={() => toggleSeverity(item.label)}
                          className="flex items-center justify-between py-0.5 px-1 rounded hover:bg-[#f1ece1] cursor-pointer"
                        >
                          <div className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="w-3.5 h-3.5 rounded border-[#1e293b] text-sky-600 focus:ring-0 cursor-pointer"
                            />
                            <span className="text-slate-700 text-[11px]">{item.label}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">({item.count})</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Filter 3: Status */}
              <div className="space-y-1 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setStatusOpen(!statusOpen)}
                  className="w-full flex items-center justify-between text-xs font-bold text-slate-800 hover:text-sky-600 transition-colors"
                >
                  <span>Status</span>
                  {statusOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {statusOpen && (
                  <div className="space-y-0.5 text-xs pt-0.5">
                    {[
                      { label: 'Enabled', count: 22 },
                      { label: 'Disabled', count: 2 },
                    ].map((item) => {
                      const isChecked = selectedStatuses.includes(item.label);
                      return (
                        <label
                          key={item.label}
                          onClick={() => toggleStatus(item.label)}
                          className="flex items-center justify-between py-0.5 px-1 rounded hover:bg-[#f1ece1] cursor-pointer"
                        >
                          <div className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="w-3.5 h-3.5 rounded border-[#1e293b] text-emerald-600 focus:ring-0 cursor-pointer"
                            />
                            <span className="text-slate-700 text-[11px]">{item.label}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">({item.count})</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Reset Filters */}
              <button
                type="button"
                onClick={handleResetFilters}
                className="w-full mt-2 py-1.5 px-3 rounded-lg border-2 border-[#1e293b] bg-white text-xs font-bold text-slate-700 hover:bg-[#f3eedf] transition-colors flex items-center justify-center gap-1.5 shadow-[2px_2px_0px_#1e293b]"
              >
                <RefreshCw className="w-3 h-3 text-slate-500" />
                <span>Reset Filters</span>
              </button>
            </div>
          </div>

          {/* MIDDLE COLUMN: BASELINE RULES TABLE (col-span-6 xl:col-span-7) */}
          <div className="lg:col-span-6 xl:col-span-7 space-y-3">
            <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] overflow-hidden flex flex-col justify-between min-h-[500px]">
              {/* Header with Search */}
              <div className="p-3 border-b-2 border-[#1e293b] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 bg-[#fbf5e8]">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded bg-[#38bdf8] border border-[#1e293b] flex items-center justify-center text-white shrink-0 shadow-[1px_1px_0px_#1e293b]">
                    <Layers className="w-4 h-4" />
                  </div>
                  <h2 className="text-sm font-black text-slate-800">
                    Baseline Rules <span className="text-[#ef4444]">({filteredRules.length})</span>
                  </h2>
                </div>

                {/* Search Bar */}
                <div className="relative w-full sm:w-64 md:w-80">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder="Search rule by name, command or tag..."
                    className="w-full pl-8 pr-3 py-1 rounded-full border-2 border-[#1e293b] bg-white text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-[#f8f1de] text-slate-600 uppercase text-[10px] tracking-wider font-extrabold border-b-2 border-slate-200">
                    <tr>
                      <th className="py-2.5 px-2 text-center w-8">
                        <input
                          type="checkbox"
                          checked={checkedRuleIds.length === paginatedRules.length && paginatedRules.length > 0}
                          onChange={toggleSelectAll}
                          className="w-3.5 h-3.5 rounded border-[#1e293b] text-sky-600 focus:ring-0 cursor-pointer"
                        />
                      </th>
                      <th className="py-2.5 px-2 text-center w-8">#</th>
                      <th className="py-2.5 px-3">Rule Name</th>
                      <th className="py-2.5 px-2.5">Category</th>
                      <th className="py-2.5 px-2.5">Severity</th>
                      <th className="py-2.5 px-3">Expected / Pattern</th>
                      <th className="py-2.5 px-2.5">Status</th>
                      <th className="py-2.5 px-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {paginatedRules.map((rule) => {
                      const isSelected = rule.id === selectedRuleId;
                      const isChecked = checkedRuleIds.includes(rule.id);
                      return (
                        <tr
                          key={rule.id}
                          onClick={() => setSelectedRuleId(rule.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[#e0f2fe] font-medium border-l-4 border-l-[#0284c7]'
                              : 'hover:bg-[#f7f2e4]'
                          }`}
                        >
                          {/* Checkbox */}
                          <td className="py-2.5 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleCheckRule(rule.id)}
                              className="w-3.5 h-3.5 rounded border-[#1e293b] text-sky-600 focus:ring-0 cursor-pointer"
                            />
                          </td>
                          {/* Index */}
                          <td className="py-2.5 px-2 text-center font-bold text-slate-500 font-mono">
                            {rule.number}
                          </td>
                          {/* Rule Name */}
                          <td className="py-2.5 px-3 font-bold text-slate-900 whitespace-nowrap">
                            <span className="flex items-center gap-1.5">
                              <Shield className="w-3.5 h-3.5 text-[#0284c7]" />
                              <span>{rule.name}</span>
                            </span>
                          </td>
                          {/* Category */}
                          <td className="py-2.5 px-2.5 text-slate-700 whitespace-nowrap font-medium">
                            {rule.category}
                          </td>
                          {/* Severity */}
                          <td className="py-2.5 px-2.5 whitespace-nowrap">
                            {renderSeverityBadge(rule.severity)}
                          </td>
                          {/* Expected Pattern */}
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-800 max-w-[170px] truncate" title={rule.expected_value}>
                            {rule.expected_value}
                          </td>
                          {/* Status */}
                          <td className="py-2.5 px-2.5 whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                rule.status === 'Enabled'
                                  ? 'bg-[#22c55e] text-white'
                                  : 'bg-slate-300 text-slate-700'
                              }`}
                            >
                              {rule.status}
                            </span>
                          </td>
                          {/* Actions */}
                          <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenEdit(rule);
                              }}
                              className="p-1 rounded text-slate-600 hover:text-sky-600 hover:bg-slate-200/60"
                              title="Edit rule"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {paginatedRules.length === 0 && (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    No rules match the current filters. Click &ldquo;Reset Filters&rdquo; to show all.
                  </div>
                )}
              </div>

              {/* Pagination Footer */}
              <div className="p-2.5 border-t-2 border-[#1e293b] bg-[#fbf5e8] flex items-center justify-between text-xs text-slate-600">
                <span className="text-[11px] font-medium">
                  Showing {filteredRules.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} -{' '}
                  {Math.min(currentPage * pageSize, filteredRules.length)} of {filteredRules.length} rules
                </span>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="w-6 h-6 rounded border border-slate-300 bg-white flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    &lt;
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      type="button"
                      onClick={() => setCurrentPage(page)}
                      className={`w-6 h-6 rounded text-xs font-bold transition-colors ${
                        currentPage === page
                          ? 'bg-[#0284c7] text-white border border-[#0369a1] shadow-sm'
                          : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className="w-6 h-6 rounded border border-slate-300 bg-white flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    &gt;
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: RULE DETAILS & TEST RULE PREVIEW (col-span-3) */}
          <div className="lg:col-span-3 xl:col-span-3 space-y-3">
            <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] p-3 space-y-3 flex flex-col justify-between">
              <div>
                {/* Rule Details Header */}
                <div className="flex items-center gap-2 pb-2 border-b-2 border-slate-200">
                  <FileText className="w-4 h-4 text-sky-600" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                    Rule Details
                  </h3>
                </div>

                {/* Rule Title and Severity Pill */}
                <div className="mt-2.5 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-[#ef4444]" />
                    <h4 className="text-sm font-black text-slate-900 leading-tight">
                      {selectedRule.name}
                    </h4>
                  </div>
                  {renderSeverityBadge(selectedRule.severity)}
                </div>

                {/* Metadata List */}
                <div className="mt-2 space-y-1.5 text-xs text-slate-700 font-medium">
                  <div className="flex items-start gap-1">
                    <span className="text-slate-400 font-bold">&gt;</span>
                    <span className="text-slate-500 w-24">Category</span>
                    <span className="font-bold text-slate-800">: {selectedRule.category}</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="text-slate-400 font-bold">&gt;</span>
                    <span className="text-slate-500 w-24">Description</span>
                    <span className="text-slate-800 leading-tight">: {selectedRule.description}</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="text-slate-400 font-bold">&gt;</span>
                    <span className="text-slate-500 w-24">Expected</span>
                    <span className="font-mono font-bold text-emerald-700">: {selectedRule.expected_value}</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="text-slate-400 font-bold">&gt;</span>
                    <span className="text-slate-500 w-24">Severity Weight</span>
                    <span className="font-bold text-slate-800">: {selectedRule.severity_weight}</span>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="text-slate-400 font-bold">&gt;</span>
                    <span className="text-slate-500 w-24">Regex Pattern</span>
                    <span className="font-mono text-[10px] text-slate-800 truncate block max-w-[130px]" title={selectedRule.regex_pattern}>
                      : {selectedRule.regex_pattern}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400 font-bold">&gt;</span>
                    <span className="text-slate-500 w-24">Status</span>
                    <span>
                      : <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#22c55e] text-white">{selectedRule.status}</span>
                    </span>
                  </div>
                </div>

                {/* Test Rule (Preview) Terminal Box */}
                <div className="mt-3 pt-3 border-t-2 border-slate-200">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Terminal className="w-3.5 h-3.5 text-[#ef4444]" />
                    <h4 className="text-xs font-black text-slate-800">
                      Test Rule (Preview)
                    </h4>
                  </div>

                  <div className="rounded-xl border-2 border-[#1e293b] bg-slate-900 p-2.5 text-xs font-mono space-y-1.5 shadow-inner">
                    <div className="flex items-center justify-between pb-1.5 border-b border-slate-800 text-[10px] font-sans">
                      <span className="text-slate-400">Running config ({selectedRule.test_result.device}):</span>
                      <span
                        className={`px-2 py-0.5 rounded font-black text-[10px] ${
                          selectedRule.test_result.result === 'FAIL'
                            ? 'bg-[#ef4444] text-white'
                            : 'bg-[#22c55e] text-white'
                        }`}
                      >
                        Result: {selectedRule.test_result.result}
                      </span>
                    </div>

                    {selectedRule.test_result.diff_removed && (
                      <p className="text-rose-400 bg-rose-950/40 px-1 py-0.5 rounded">
                        {selectedRule.test_result.diff_removed}
                      </p>
                    )}
                    {selectedRule.test_result.diff_added && (
                      <p className="text-emerald-400 bg-emerald-950/40 px-1 py-0.5 rounded">
                        {selectedRule.test_result.diff_added}
                      </p>
                    )}
                    {!selectedRule.test_result.diff_removed && !selectedRule.test_result.diff_added && (
                      <p className="text-emerald-400 text-[11px] py-1">
                        + Configuration matches baseline rule standard.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* 3 Arcade Action Buttons */}
              <div className="space-y-2 pt-3 border-t-2 border-slate-200">
                <button
                  type="button"
                  onClick={() => handleOpenEdit(selectedRule)}
                  className="w-full py-2 px-3 rounded-lg border-2 border-[#0369a1] bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
                >
                  <Edit className="w-3.5 h-3.5" />
                  <span>Edit Rule</span>
                </button>

                <button
                  type="button"
                  onClick={handleTestOnDevice}
                  disabled={isTestingOnDevice}
                  className="w-full py-2 px-3 rounded-lg border-2 border-[#ca8a04] bg-[#facc15] hover:bg-[#eab308] text-slate-900 text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5 disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-slate-900" />
                  <span>{isTestingOnDevice ? 'Testing...' : 'Test on Device'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActionNotice('All baseline rule definitions and audit weights saved successfully!');
                    setTimeout(() => setActionNotice(null), 3000);
                  }}
                  className="w-full py-2 px-3 rounded-lg border-2 border-[#15803d] bg-[#22c55e] hover:bg-[#16a34a] text-white text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Overview Tab Content */}
      {activeTab === 'overview' && (
        <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] p-5 space-y-3">
          <h3 className="text-base font-black text-slate-900 font-pixel">Baseline Overview</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            The {baselineInfo.name} enforces campus network hardening across {baselineInfo.devices_covered} access switches.
            All rules are evaluated on-demand during scheduled nightly sweeps or manually via the sweep controller.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="p-3 bg-white rounded-lg border-2 border-[#1e293b]">
              <span className="text-[11px] font-bold text-slate-500">Active Rules</span>
              <span className="text-xl font-black text-slate-900 block">{rules.filter((r) => r.status === 'Enabled').length}</span>
            </div>
            <div className="p-3 bg-white rounded-lg border-2 border-[#1e293b]">
              <span className="text-[11px] font-bold text-slate-500">Critical Checks</span>
              <span className="text-xl font-black text-rose-600 block">{rules.filter((r) => r.severity === 'Critical').length}</span>
            </div>
            <div className="p-3 bg-white rounded-lg border-2 border-[#1e293b]">
              <span className="text-[11px] font-bold text-slate-500">Fleet Conformance</span>
              <span className="text-xl font-black text-emerald-600 block">{baselineInfo.compliance_rate}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Configuration Tab Content */}
      {activeTab === 'config' && (
        <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] p-5 space-y-3">
          <h3 className="text-base font-black text-slate-900 font-pixel">Raw Golden Configuration YAML</h3>
          <pre className="p-4 rounded-xl border-2 border-[#1e293b] bg-slate-900 text-sky-300 font-mono text-xs overflow-x-auto leading-relaxed">
{`name: "${baselineInfo.name}"
vendor: "cisco_ios"
device_type: "Switch"
version: "${baselineInfo.version}"
rules_count: ${rules.length}
rules:
${rules.slice(0, 8).map((r) => `  - name: "${r.name}"
    category: "${r.category}"
    severity: "${r.severity}"
    expected_value: "${r.expected_value}"
    regex: "${r.regex_pattern}"
    weight: ${r.severity_weight}`).join('\n')}`}
          </pre>
        </div>
      )}

      {/* Version History Tab Content */}
      {activeTab === 'versions' && (
        <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] p-5 space-y-3">
          <h3 className="text-base font-black text-slate-900 font-pixel">Baseline Revision History</h3>
          <div className="space-y-2">
            {[
              { version: 'v3.2', status: 'Active', date: '02 Nov 2026, 09:48 AM', author: 'admin', note: 'Added ACL hardening on line vty and 802.1X enforcement' },
              { version: 'v3.1', status: 'Draft', date: '20 Oct 2026, 04:12 PM', author: 'neteng', note: 'Updated NTP server IP to central stratum-1' },
              { version: 'v3.0', status: 'Archived', date: '15 Oct 2026, 11:07 AM', author: 'admin', note: 'Initial baseline for campus access switches' },
            ].map((v) => (
              <div key={v.version} className="p-3 bg-white rounded-lg border-2 border-[#1e293b] flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-900">{v.version}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${v.status === 'Active' ? 'bg-[#22c55e] text-white' : 'bg-slate-200 text-slate-700'}`}>{v.status}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{v.note} · By {v.author}</p>
                </div>
                <span className="text-xs text-slate-400 font-mono">{v.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Usage & Impact Tab Content */}
      {activeTab === 'impact' && (
        <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] p-5 space-y-3">
          <h3 className="text-base font-black text-slate-900 font-pixel">Fleet Deployment Impact</h3>
          <p className="text-xs text-slate-600">
            This golden baseline is currently active across {baselineInfo.devices_covered} access switches in All Campus Zones.
          </p>
          <div className="p-4 bg-white rounded-lg border-2 border-[#1e293b]">
            <span className="text-xs font-bold text-slate-700">Target Devices:</span>
            <div className="flex flex-wrap gap-2 mt-2">
              {['sw-lab-01', 'sw-lab-02', 'sw-lab-03', 'sw-class-01', 'sw-class-02', 'sw-hostel-01', 'sw-hostel-02', 'sw-event-01'].map((dev) => (
                <span key={dev} className="px-2 py-1 rounded bg-[#e0f2fe] border border-[#bae6fd] text-[#0369a1] text-xs font-mono font-bold">
                  {dev}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT RULE */}
      {editModalOpen && editingRule && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#fcf9f2] rounded-2xl border-4 border-[#1e293b] shadow-[6px_6px_0px_#1e293b] max-w-xl w-full p-5 space-y-3.5">
            <div className="flex items-center justify-between pb-2.5 border-b-2 border-slate-200">
              <div className="flex items-center gap-2">
                <Edit className="w-5 h-5 text-sky-600" />
                <h3 className="text-base font-black text-slate-900 font-pixel">
                  Edit Baseline Rule: {editingRule.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="p-1 rounded-lg border-2 border-[#1e293b] bg-white text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Rule Name</label>
                <input
                  type="text"
                  value={editingRule.name}
                  onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                  className="w-full px-3 py-1.5 border-2 border-[#1e293b] rounded-lg bg-white text-slate-900 font-bold focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Category</label>
                  <select
                    value={editingRule.category}
                    onChange={(e) => setEditingRule({ ...editingRule, category: e.target.value as any })}
                    className="w-full px-2.5 py-1.5 border-2 border-[#1e293b] rounded-lg bg-white text-slate-900 font-bold focus:outline-none"
                  >
                    <option value="Security">Security</option>
                    <option value="Access Control">Access Control</option>
                    <option value="Management">Management</option>
                    <option value="Interface">Interface</option>
                    <option value="Routing">Routing</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Severity</label>
                  <select
                    value={editingRule.severity}
                    onChange={(e) => setEditingRule({ ...editingRule, severity: e.target.value as any })}
                    className="w-full px-2.5 py-1.5 border-2 border-[#1e293b] rounded-lg bg-white text-slate-900 font-bold focus:outline-none"
                  >
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Expected CLI Command</label>
                <input
                  type="text"
                  value={editingRule.expected_value}
                  onChange={(e) => setEditingRule({ ...editingRule, expected_value: e.target.value })}
                  className="w-full px-3 py-1.5 border-2 border-[#1e293b] rounded-lg bg-white text-slate-900 font-mono font-bold focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Regex Pattern</label>
                <input
                  type="text"
                  value={editingRule.regex_pattern}
                  onChange={(e) => setEditingRule({ ...editingRule, regex_pattern: e.target.value })}
                  className="w-full px-3 py-1.5 border-2 border-[#1e293b] rounded-lg bg-white text-slate-900 font-mono text-[11px] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Description / Rationale</label>
                <textarea
                  value={editingRule.description}
                  onChange={(e) => setEditingRule({ ...editingRule, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-1.5 border-2 border-[#1e293b] rounded-lg bg-white text-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Status</label>
                <div className="flex items-center gap-4 pt-0.5">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="status"
                      checked={editingRule.status === 'Enabled'}
                      onChange={() => setEditingRule({ ...editingRule, status: 'Enabled' })}
                      className="text-emerald-600 focus:ring-0"
                    />
                    <span className="font-bold text-slate-800">Enabled</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="status"
                      checked={editingRule.status === 'Disabled'}
                      onChange={() => setEditingRule({ ...editingRule, status: 'Disabled' })}
                      className="text-slate-600 focus:ring-0"
                    />
                    <span className="font-bold text-slate-800">Disabled</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t-2 border-slate-200">
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="py-1.5 px-3.5 rounded-lg border-2 border-[#1e293b] bg-white text-xs font-bold text-slate-700 hover:bg-slate-100 shadow-[2px_2px_0px_#1e293b]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEditRule}
                className="py-1.5 px-4 rounded-lg border-2 border-[#15803d] bg-[#22c55e] hover:bg-[#16a34a] text-white text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save Rule</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
