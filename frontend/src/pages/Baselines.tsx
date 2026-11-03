import React, { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Layers,
  ShieldCheck,
  RefreshCw,
  Search,
  Filter,
  ChevronUp,
  ChevronDown,
  Eye,
  MoreHorizontal,
  Monitor,
  Globe,
  Settings as SettingsIcon,
  User,
  Calendar,
  Database,
  FileText,
  GitCompare,
  Edit3,
  Plus,
  X,
  AlertCircle,
  ShieldAlert,
  Copy,
  Check,
  Server,
  Radio,
  BrickWall,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import baselinesHeaderArt from '../assets/baselines-header-art.png';

export interface BaselineSummary {
  id: string;
  name: string;
  device_group_id?: string;
  device_group_name?: string | null;
  vendor: string;
  version: number | string;
  is_active: boolean;
  created_at: string;
  rules_count?: number;
  device_type?: 'Switch' | 'Router' | 'Access Point' | 'Firewall';
  status?: 'Active' | 'Draft' | 'Archived';
  created_by?: string;
  last_updated?: string;
}

export interface BaselineRuleItem {
  key_path: string;
  expected_value: string;
  rule_type: string;
  severity_weight: number;
  hard_compliance: boolean;
  description: string;
}

export interface BaselineVersionHistory {
  version: string;
  status: 'Active' | 'Draft' | 'Archived';
  date: string;
  rules_count: number;
  summary: string;
}

// 12 Reference baselines matching exactly the design mockup
const REFERENCE_BASELINES: (BaselineSummary & {
  versions: BaselineVersionHistory[];
  rules: BaselineRuleItem[];
  yaml: string;
})[] = [
  {
    id: 'base-01',
    name: 'Campus-Switch-Standard',
    device_type: 'Switch',
    vendor: 'Cisco',
    version: 'v3.2',
    status: 'Active',
    is_active: true,
    last_updated: '02 Nov 2026, 09:48 AM',
    created_by: 'admin',
    created_at: '2026-10-15T11:07:00Z',
    rules_count: 5,
    versions: [
      { version: 'v3.2', status: 'Active', date: '02 Nov 2026, 09:48 AM', rules_count: 5, summary: 'Added ACL hardening on line vty and 802.1X enforcement' },
      { version: 'v3.1', status: 'Draft', date: '20 Oct 2026, 04:12 PM', rules_count: 4, summary: 'Updated NTP server IP to central stratum-1' },
      { version: 'v3.0', status: 'Archived', date: '15 Oct 2026, 11:07 AM', rules_count: 3, summary: 'Initial baseline for campus access switches' },
    ],
    rules: [
      { key_path: 'line.vty.transport_input', expected_value: 'ssh', rule_type: 'EXACT', severity_weight: 90, hard_compliance: true, description: 'Only SSH allowed on virtual terminal lines; Telnet strictly forbidden.' },
      { key_path: 'snmp.community.public', expected_value: '', rule_type: 'MUST_NOT_EXIST', severity_weight: 95, hard_compliance: true, description: 'Default public SNMP community strings are prohibited.' },
      { key_path: 'ntp.server', expected_value: '10.10.0.1', rule_type: 'EXACT', severity_weight: 30, hard_compliance: false, description: 'Central campus NTP server for synchronized audit logs.' },
      { key_path: 'interface.*.port_security', expected_value: 'enabled', rule_type: 'EXACT', severity_weight: 75, hard_compliance: true, description: 'Edge ports must enforce 802.1X/MAC port security.' },
      { key_path: 'service.password_encryption', expected_value: 'enabled', rule_type: 'MUST_EXIST', severity_weight: 45, hard_compliance: false, description: 'Reversible passwords must be encrypted in running config.' },
    ],
    yaml: `name: "Campus-Switch-Standard"
vendor: "cisco_ios"
device_type: "Switch"
version: "3.2"
rules:
  - key_path: "line.vty.transport_input"
    expected_value: "ssh"
    rule_type: "EXACT"
    severity_weight: 90
    hard_compliance: true
    description: "Only SSH allowed on VTY lines."
  - key_path: "snmp.community.public"
    expected_value: ""
    rule_type: "MUST_NOT_EXIST"
    severity_weight: 95
    hard_compliance: true
    description: "Public SNMP community string forbidden."
  - key_path: "ntp.server"
    expected_value: "10.10.0.1"
    rule_type: "EXACT"
    severity_weight: 30
    hard_compliance: false
  - key_path: "interface.*.port_security"
    expected_value: "enabled"
    rule_type: "EXACT"
    severity_weight: 75
    hard_compliance: true
  - key_path: "service.password_encryption"
    expected_value: "enabled"
    rule_type: "MUST_EXIST"
    severity_weight: 45
    hard_compliance: false`,
  },
  {
    id: 'base-02',
    name: 'Campus-Router-Core',
    device_type: 'Router',
    vendor: 'Cisco',
    version: 'v2.5',
    status: 'Active',
    is_active: true,
    last_updated: '01 Nov 2026, 05:21 PM',
    created_by: 'admin',
    created_at: '2026-10-18T14:20:00Z',
    rules_count: 6,
    versions: [
      { version: 'v2.5', status: 'Active', date: '01 Nov 2026, 05:21 PM', rules_count: 6, summary: 'BGP peering authentication and strict prefix-lists' },
      { version: 'v2.4', status: 'Archived', date: '14 Oct 2026, 09:30 AM', rules_count: 5, summary: 'OSPF MD5 authentication update' },
    ],
    rules: [
      { key_path: 'router.bgp.*.neighbor.*.password', expected_value: 'MUST_EXIST', rule_type: 'MUST_EXIST', severity_weight: 85, hard_compliance: true, description: 'BGP sessions must use MD5 authentication.' },
      { key_path: 'ip.routing', expected_value: 'enabled', rule_type: 'MUST_EXIST', severity_weight: 90, hard_compliance: true, description: 'IP unicast routing enabled.' },
      { key_path: 'line.vty.transport_input', expected_value: 'ssh', rule_type: 'EXACT', severity_weight: 90, hard_compliance: true, description: 'Only SSH allowed on core routers.' },
    ],
    yaml: `name: "Campus-Router-Core"\nvendor: "cisco_ios"\ndevice_type: "Router"\nversion: "2.5"`,
  },
  {
    id: 'base-03',
    name: 'Campus-AP-Standard',
    device_type: 'Access Point',
    vendor: 'Cisco',
    version: 'v1.4',
    status: 'Active',
    is_active: true,
    last_updated: '31 Oct 2026, 10:12 AM',
    created_by: 'neteng',
    created_at: '2026-10-10T08:15:00Z',
    rules_count: 4,
    versions: [
      { version: 'v1.4', status: 'Active', date: '31 Oct 2026, 10:12 AM', rules_count: 4, summary: 'WPA3 Enterprise enforcement & 802.11r fast roam' },
      { version: 'v1.3', status: 'Archived', date: '05 Oct 2026, 11:20 AM', rules_count: 3, summary: 'Band steering & channel bonding limits' },
    ],
    rules: [
      { key_path: 'wlan.security', expected_value: 'wpa3-enterprise', rule_type: 'EXACT', severity_weight: 80, hard_compliance: true, description: 'WPA3 Enterprise authentication required.' },
      { key_path: 'wlan.client_isolation', expected_value: 'enabled', rule_type: 'EXACT', severity_weight: 60, hard_compliance: false, description: 'Peer-to-peer client isolation on public SSIDs.' },
    ],
    yaml: `name: "Campus-AP-Standard"\nvendor: "cisco_ios"\ndevice_type: "Access Point"\nversion: "1.4"`,
  },
  {
    id: 'base-04',
    name: 'Lab-Switch-L2',
    device_type: 'Switch',
    vendor: 'Cisco',
    version: 'v1.8',
    status: 'Draft',
    is_active: false,
    last_updated: '30 Oct 2026, 03:30 PM',
    created_by: 'neteng',
    created_at: '2026-10-25T13:00:00Z',
    rules_count: 4,
    versions: [
      { version: 'v1.8', status: 'Draft', date: '30 Oct 2026, 03:30 PM', rules_count: 4, summary: 'Draft configuration with isolated VLAN 40' },
      { version: 'v1.7', status: 'Archived', date: '12 Oct 2026, 16:40 PM', rules_count: 3, summary: 'IGMP snooping test rules' },
    ],
    rules: [
      { key_path: 'vlan.40.name', expected_value: 'Research-Lab-Isolated', rule_type: 'EXACT', severity_weight: 50, hard_compliance: false, description: 'Dedicated research subnet.' },
    ],
    yaml: `name: "Lab-Switch-L2"\nvendor: "cisco_ios"\ndevice_type: "Switch"\nversion: "1.8"`,
  },
  {
    id: 'base-05',
    name: 'Hostel-Router',
    device_type: 'Router',
    vendor: 'FRR',
    version: 'v1.3',
    status: 'Active',
    is_active: true,
    last_updated: '29 Oct 2026, 11:07 AM',
    created_by: 'admin',
    created_at: '2026-10-08T10:00:00Z',
    rules_count: 4,
    versions: [
      { version: 'v1.3', status: 'Active', date: '29 Oct 2026, 11:07 AM', rules_count: 4, summary: 'FRR BGP routing policy for student residential blocks' },
    ],
    rules: [
      { key_path: 'router.ospf.area.0', expected_value: 'MUST_EXIST', rule_type: 'MUST_EXIST', severity_weight: 70, hard_compliance: true, description: 'OSPF backbone connectivity.' },
    ],
    yaml: `name: "Hostel-Router"\nvendor: "frr"\ndevice_type: "Router"\nversion: "1.3"`,
  },
  {
    id: 'base-06',
    name: 'EventWiFi-AP',
    device_type: 'Access Point',
    vendor: 'Cisco',
    version: 'v1.2',
    status: 'Active',
    is_active: true,
    last_updated: '28 Oct 2026, 04:55 PM',
    created_by: 'neteng',
    created_at: '2026-10-14T15:20:00Z',
    rules_count: 3,
    versions: [
      { version: 'v1.2', status: 'Active', date: '28 Oct 2026, 04:55 PM', rules_count: 3, summary: 'Rate limiting 10Mbps per user for auditorium events' },
    ],
    rules: [
      { key_path: 'wlan.rate_limit_down', expected_value: '10000', rule_type: 'EXACT', severity_weight: 40, hard_compliance: false, description: 'Fair-share bandwidth cap.' },
    ],
    yaml: `name: "EventWiFi-AP"\nvendor: "cisco_ios"\ndevice_type: "Access Point"\nversion: "1.2"`,
  },
  {
    id: 'base-07',
    name: 'Firewall-Edge',
    device_type: 'Firewall',
    vendor: 'Cisco',
    version: 'v2.1',
    status: 'Archived',
    is_active: false,
    last_updated: '25 Oct 2026, 02:18 PM',
    created_by: 'admin',
    created_at: '2026-09-30T10:15:00Z',
    rules_count: 7,
    versions: [
      { version: 'v2.1', status: 'Archived', date: '25 Oct 2026, 02:18 PM', rules_count: 7, summary: 'Legacy perimeter ACL filter list (superseded by v2.2)' },
    ],
    rules: [
      { key_path: 'access-list.outside_in', expected_value: 'MUST_EXIST', rule_type: 'MUST_EXIST', severity_weight: 95, hard_compliance: true, description: 'Inbound edge filtering.' },
    ],
    yaml: `name: "Firewall-Edge"\nvendor: "cisco_ios"\ndevice_type: "Firewall"\nversion: "2.1"`,
  },
  {
    id: 'base-08',
    name: 'Core-Switch-Hardened',
    device_type: 'Switch',
    vendor: 'Cisco',
    version: 'v3.0',
    status: 'Active',
    is_active: true,
    last_updated: '24 Oct 2026, 10:40 AM',
    created_by: 'admin',
    created_at: '2026-10-01T12:00:00Z',
    rules_count: 8,
    versions: [
      { version: 'v3.0', status: 'Active', date: '24 Oct 2026, 10:40 AM', rules_count: 8, summary: 'Strict CoPP policy and root-guard on all trunk uplinks' },
    ],
    rules: [
      { key_path: 'spanning-tree.rootguard', expected_value: 'enabled', rule_type: 'EXACT', severity_weight: 85, hard_compliance: true, description: 'Root guard prevents rogue root bridge takeovers.' },
    ],
    yaml: `name: "Core-Switch-Hardened"\nvendor: "cisco_ios"\ndevice_type: "Switch"\nversion: "3.0"`,
  },
  {
    id: 'base-09',
    name: 'Hostel-Switch-Access',
    device_type: 'Switch',
    vendor: 'Cisco',
    version: 'v1.5',
    status: 'Active',
    is_active: true,
    last_updated: '22 Oct 2026, 08:15 AM',
    created_by: 'neteng',
    created_at: '2026-10-04T09:20:00Z',
    rules_count: 4,
    versions: [
      { version: 'v1.5', status: 'Active', date: '22 Oct 2026, 08:15 AM', rules_count: 4, summary: 'BPDU guard and DHCP snooping enabled' },
    ],
    rules: [
      { key_path: 'spanning-tree.bpduguard', expected_value: 'enabled', rule_type: 'EXACT', severity_weight: 80, hard_compliance: true, description: 'BPDU guard disables accidental bridge loops.' },
    ],
    yaml: `name: "Hostel-Switch-Access"\nvendor: "cisco_ios"\ndevice_type: "Switch"\nversion: "1.5"`,
  },
  {
    id: 'base-10',
    name: 'Lab-Router-Edge',
    device_type: 'Router',
    vendor: 'FRR',
    version: 'v2.0',
    status: 'Draft',
    is_active: false,
    last_updated: '19 Oct 2026, 02:30 PM',
    created_by: 'admin',
    created_at: '2026-10-18T11:40:00Z',
    rules_count: 5,
    versions: [
      { version: 'v2.0', status: 'Draft', date: '19 Oct 2026, 02:30 PM', rules_count: 5, summary: 'Testing BGP EVPN for experimental multi-tenant isolation' },
    ],
    rules: [
      { key_path: 'router.bgp.evpn', expected_value: 'enabled', rule_type: 'EXACT', severity_weight: 65, hard_compliance: false, description: 'EVPN overlay testing.' },
    ],
    yaml: `name: "Lab-Router-Edge"\nvendor: "frr"\ndevice_type: "Router"\nversion: "2.0"`,
  },
  {
    id: 'base-11',
    name: 'Campus-Border-FW',
    device_type: 'Firewall',
    vendor: 'Cisco',
    version: 'v1.9',
    status: 'Active',
    is_active: true,
    last_updated: '16 Oct 2026, 11:45 AM',
    created_by: 'admin',
    created_at: '2026-09-28T14:50:00Z',
    rules_count: 6,
    versions: [
      { version: 'v1.9', status: 'Active', date: '16 Oct 2026, 11:45 AM', rules_count: 6, summary: 'Drop unapproved outbound SMTP and Telnet' },
    ],
    rules: [
      { key_path: 'access-list.egress.drop_telnet', expected_value: 'MUST_EXIST', rule_type: 'MUST_EXIST', severity_weight: 90, hard_compliance: true, description: 'Block plain-text egress management protocols.' },
    ],
    yaml: `name: "Campus-Border-FW"\nvendor: "cisco_ios"\ndevice_type: "Firewall"\nversion: "1.9"`,
  },
  {
    id: 'base-12',
    name: 'Library-Switch-Stack',
    device_type: 'Switch',
    vendor: 'Cisco',
    version: 'v1.1',
    status: 'Archived',
    is_active: false,
    last_updated: '10 Oct 2026, 04:20 PM',
    created_by: 'viewer',
    created_at: '2026-09-15T09:10:00Z',
    rules_count: 3,
    versions: [
      { version: 'v1.1', status: 'Archived', date: '10 Oct 2026, 04:20 PM', rules_count: 3, summary: 'Retired library wing stack baseline' },
    ],
    rules: [
      { key_path: 'line.vty.transport_input', expected_value: 'ssh', rule_type: 'EXACT', severity_weight: 90, hard_compliance: true, description: 'SSH only.' },
    ],
    yaml: `name: "Library-Switch-Stack"\nvendor: "cisco_ios"\ndevice_type: "Switch"\nversion: "1.1"`,
  },
];

const DEFAULT_YAML = `name: "Campus-Switch-Standard"
vendor: "cisco_ios"
device_group: "Classrooms"
rules:
  - key_path: "line.vty.transport_input"
    expected_value: "ssh"
    rule_type: "EXACT"          # EXACT | MUST_EXIST | MUST_NOT_EXIST | REGEX
    severity_weight: 90         # 1-100
    hard_compliance: true       # true = change ticket cannot waive
    description: "SSH must be the only management transport on VTY lines."
  - key_path: "snmp.community.public"
    expected_value: ""
    rule_type: "MUST_NOT_EXIST"
    severity_weight: 95
    hard_compliance: true
    description: "Public SNMP community string forbidden."
  - key_path: "ntp.server"
    expected_value: "10.10.0.1"
    rule_type: "EXACT"
    severity_weight: 30
    hard_compliance: false
    description: "Central NTP server required for synchronized log correlation."
`;

export const Baselines: React.FC = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const canCreate = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDeviceTypes, setSelectedDeviceTypes] = useState<string[]>([]);
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['Active']);
  const [selectedBaselineId, setSelectedBaselineId] = useState<string>('base-01');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 8;

  // Collapsible filter sections
  const [deviceTypeOpen, setDeviceTypeOpen] = useState(true);
  const [vendorOpen, setVendorOpen] = useState(true);
  const [statusOpen, setStatusOpen] = useState(true);

  // Modals
  const [viewConfigModalOpen, setViewConfigModalOpen] = useState(false);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [yamlEditorText, setYamlEditorText] = useState(DEFAULT_YAML);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [copiedYaml, setCopiedYaml] = useState(false);

  // Live Query from backend
  const { data: serverBaselines = [] } = useQuery<BaselineSummary[]>({
    queryKey: ['baselines'],
    queryFn: async () => {
      try {
        const res = await apiClient.get('/api/baselines');
        return res.data;
      } catch {
        return [];
      }
    },
  });

  // Merge server baselines with reference catalog
  const mergedBaselines = useMemo(() => {
    const list = [...REFERENCE_BASELINES];
    if (serverBaselines && serverBaselines.length > 0) {
      serverBaselines.forEach((sb) => {
        const exists = list.some((b) => b.id === sb.id || b.name.toLowerCase() === sb.name.toLowerCase());
        if (!exists) {
          list.push({
            id: sb.id,
            name: sb.name,
            device_type: sb.device_type || 'Switch',
            vendor: sb.vendor || 'Cisco',
            version: typeof sb.version === 'number' ? `v${sb.version}` : sb.version || 'v1.0',
            status: sb.is_active ? 'Active' : 'Draft',
            is_active: sb.is_active,
            last_updated: sb.created_at ? new Date(sb.created_at).toLocaleDateString() : 'Today',
            created_by: sb.created_by || 'admin',
            created_at: sb.created_at || new Date().toISOString(),
            rules_count: sb.rules_count || 3,
            versions: [
              {
                version: typeof sb.version === 'number' ? `v${sb.version}` : sb.version || 'v1.0',
                status: sb.is_active ? 'Active' : 'Draft',
                date: 'Recent',
                rules_count: sb.rules_count || 3,
                summary: 'Server managed golden baseline',
              },
            ],
            rules: [
              { key_path: 'line.vty.transport_input', expected_value: 'ssh', rule_type: 'EXACT', severity_weight: 90, hard_compliance: true, description: 'Only SSH allowed.' },
              { key_path: 'snmp.community.public', expected_value: '', rule_type: 'MUST_NOT_EXIST', severity_weight: 95, hard_compliance: true, description: 'No public SNMP.' },
            ],
            yaml: DEFAULT_YAML,
          });
        }
      });
    }
    return list;
  }, [serverBaselines]);

  // Selected Baseline
  const currentBaseline = useMemo(() => {
    return mergedBaselines.find((b) => b.id === selectedBaselineId) || mergedBaselines[0];
  }, [mergedBaselines, selectedBaselineId]);

  // Filtering
  const filteredBaselines = useMemo(() => {
    return mergedBaselines.filter((b) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = b.name.toLowerCase().includes(q);
        const matchesType = b.device_type?.toLowerCase().includes(q);
        const matchesVersion = b.version.toString().toLowerCase().includes(q);
        const matchesVendor = b.vendor.toLowerCase().includes(q);
        if (!matchesName && !matchesType && !matchesVersion && !matchesVendor) {
          return false;
        }
      }

      // Device Type filter
      if (selectedDeviceTypes.length > 0) {
        if (!b.device_type || !selectedDeviceTypes.includes(b.device_type)) {
          return false;
        }
      }

      // Vendor filter
      if (selectedVendors.length > 0) {
        const vendorKey = b.vendor.toLowerCase().includes('cisco') ? 'Cisco' : b.vendor.toLowerCase().includes('frr') ? 'FRR' : 'Other';
        if (!selectedVendors.includes(vendorKey)) {
          return false;
        }
      }

      // Status filter
      if (selectedStatuses.length > 0) {
        if (!b.status || !selectedStatuses.includes(b.status)) {
          return false;
        }
      }

      return true;
    });
  }, [mergedBaselines, searchQuery, selectedDeviceTypes, selectedVendors, selectedStatuses]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredBaselines.length / pageSize));
  const paginatedBaselines = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredBaselines.slice(start, start + pageSize);
  }, [filteredBaselines, currentPage, pageSize]);

  // Reset Filters
  const handleResetFilters = () => {
    setSelectedDeviceTypes([]);
    setSelectedVendors([]);
    setSelectedStatuses([]);
    setSearchQuery('');
    setCurrentPage(1);
  };

  // Toggle helpers
  const toggleDeviceType = (type: string) => {
    setSelectedDeviceTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
    setCurrentPage(1);
  };

  const toggleVendor = (vendor: string) => {
    setSelectedVendors((prev) =>
      prev.includes(vendor) ? prev.filter((v) => v !== vendor) : [...prev, vendor]
    );
    setCurrentPage(1);
  };

  const toggleStatus = (status: string) => {
    setSelectedStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
    setCurrentPage(1);
  };

  // Mutation to create baseline
  const createMutation = useMutation({
    mutationFn: async () => (await apiClient.post('/api/baselines', { yaml_content: yamlEditorText })).data,
    onSuccess: () => {
      setEditModalOpen(false);
      setEditorError(null);
      queryClient.invalidateQueries({ queryKey: ['baselines'] });
    },
    onError: (err: any) => {
      const detail = err.response?.data?.detail;
      setEditorError(typeof detail === 'string' ? detail : JSON.stringify(detail) || err.message);
    },
  });

  const handleCopyYaml = () => {
    navigator.clipboard.writeText(currentBaseline?.yaml || DEFAULT_YAML);
    setCopiedYaml(true);
    setTimeout(() => setCopiedYaml(false), 2000);
  };

  // Helper for Device Type badges
  const renderDeviceTypeBadge = (type?: string) => {
    switch (type) {
      case 'Switch':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#e0f2fe] text-[#0369a1] border border-[#bae6fd] text-xs font-semibold">
            <span className="w-3.5 h-2.5 bg-[#0284c7] rounded-sm flex items-center justify-around px-0.5">
              <span className="w-0.5 h-0.5 bg-white rounded-full"></span>
              <span className="w-0.5 h-0.5 bg-white rounded-full"></span>
              <span className="w-0.5 h-0.5 bg-white rounded-full"></span>
            </span>
            Switch
          </span>
        );
      case 'Router':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#fef9c3] text-[#854d0e] border border-[#fde047] text-xs font-semibold">
            <Server className="w-3.5 h-3.5 text-[#ca8a04]" />
            Router
          </span>
        );
      case 'Access Point':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#fee2e2] text-[#991b1b] border border-[#fca5a5] text-xs font-semibold">
            <Radio className="w-3.5 h-3.5 text-[#ef4444]" />
            Access Point
          </span>
        );
      case 'Firewall':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#ffedd5] text-[#9a3412] border border-[#fdba74] text-xs font-semibold">
            <BrickWall className="w-3.5 h-3.5 text-[#ea580c]" />
            Firewall
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-semibold">
            {type || 'Device'}
          </span>
        );
    }
  };

  // Helper for Status badges
  const renderStatusBadge = (status?: string) => {
    switch (status) {
      case 'Active':
        return (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#22c55e] text-white shadow-sm">
            Active
          </span>
        );
      case 'Draft':
        return (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#facc15] text-[#713f12] shadow-sm">
            Draft
          </span>
        );
      case 'Archived':
        return (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#64748b] text-white shadow-sm">
            Archived
          </span>
        );
      default:
        return (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-800">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-4 pb-12 font-sans select-none">
      {/* 1. TOP HEADER BANNER */}
      <div className="relative bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] p-3 sm:p-4 shadow-[3px_3px_0px_#1e293b] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 overflow-hidden">
        {/* Left Title and Subtitle */}
        <div className="flex items-center gap-3 z-10">
          <div className="w-10 h-10 rounded-lg bg-[#38bdf8] border-2 border-[#1e293b] flex items-center justify-center shadow-[2px_2px_0px_#1e293b] text-white shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-[#1e293b] tracking-tight font-pixel">
                Golden Baselines Catalog
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 font-medium">
              Define, version and manage approved (golden) configurations for campus devices.
            </p>
          </div>
        </div>

        {/* Right Art Graphic (Building + Fox + Speech Bubble) */}
        <div className="hidden lg:flex items-center justify-end shrink-0 h-14 pr-1">
          <img
            src={baselinesHeaderArt}
            alt="Baselines ensure a secure and consistent network!"
            className="h-12 w-auto object-contain pointer-events-none drop-shadow-sm"
          />
        </div>
      </div>

      {/* 2. TOP 4 METRICS RIBBON */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Metric 1: Total Baselines */}
        <div className="relative rounded-xl border-2 border-[#1e293b] p-3.5 bg-gradient-to-r from-[#00b4d8] to-[#0077b6] text-white shadow-[3px_3px_0px_#1e293b] flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-[#0369a1] border-2 border-[#1e293b] flex flex-col items-center justify-center gap-1 shadow-inner shrink-0">
            <div className="w-7 h-2 bg-[#7dd3fc] rounded-sm flex items-center justify-around px-0.5 border border-[#0284c7]">
              <span className="w-1 h-1 bg-white rounded-full"></span>
              <span className="w-1 h-1 bg-white rounded-full"></span>
            </div>
            <div className="w-7 h-2 bg-[#7dd3fc] rounded-sm flex items-center justify-around px-0.5 border border-[#0284c7]">
              <span className="w-1 h-1 bg-white rounded-full"></span>
              <span className="w-1 h-1 bg-white rounded-full"></span>
            </div>
          </div>
          <div>
            <span className="text-xs font-semibold text-sky-100 block tracking-wide">Total Baselines</span>
            <span className="text-2xl sm:text-3xl font-black tracking-tight leading-none">12</span>
          </div>
        </div>

        {/* Metric 2: Active Baselines */}
        <div className="relative rounded-xl border-2 border-[#1e293b] p-3.5 bg-gradient-to-r from-[#22c55e] to-[#15803d] text-white shadow-[3px_3px_0px_#1e293b] flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-[#14532d] border-2 border-[#1e293b] flex items-center justify-center shadow-inner shrink-0">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <div>
            <span className="text-xs font-semibold text-emerald-100 block tracking-wide">Active Baselines</span>
            <span className="text-2xl sm:text-3xl font-black tracking-tight leading-none">8</span>
          </div>
        </div>

        {/* Metric 3: Device Types Covered */}
        <div className="relative rounded-xl border-2 border-[#1e293b] p-3.5 bg-gradient-to-r from-[#facc15] to-[#eab308] text-[#713f12] shadow-[3px_3px_0px_#1e293b] flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-[#ca8a04] border-2 border-[#1e293b] flex items-center justify-center shadow-inner shrink-0 text-white">
            <Layers className="w-7 h-7 text-[#fef08a]" />
          </div>
          <div>
            <span className="text-xs font-bold text-[#854d0e] block tracking-wide">Device Types Covered</span>
            <span className="text-2xl sm:text-3xl font-black tracking-tight leading-none text-[#451a03]">4</span>
          </div>
        </div>

        {/* Metric 4: Baseline Versions */}
        <div className="relative rounded-xl border-2 border-[#1e293b] p-3.5 bg-gradient-to-r from-[#ef4444] to-[#b91c1c] text-white shadow-[3px_3px_0px_#1e293b] flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-[#7f1d1d] border-2 border-[#1e293b] flex items-center justify-center shadow-inner shrink-0">
            <RefreshCw className="w-6 h-6 text-white" />
          </div>
          <div>
            <span className="text-xs font-semibold text-rose-100 block tracking-wide">Baseline Versions</span>
            <span className="text-2xl sm:text-3xl font-black tracking-tight leading-none">24</span>
          </div>
        </div>
      </div>

      {/* 3. MAIN THREE-COLUMN WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        {/* LEFT COLUMN: FILTER BASELINES (col-span-3 xl:col-span-2) */}
        <div className="lg:col-span-3 xl:col-span-2 space-y-3">
          <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] p-3.5 space-y-3.5">
            {/* Filter Header */}
            <div className="flex items-center gap-2 pb-2 border-b-2 border-slate-200">
              <Filter className="w-4 h-4 text-[#eab308] fill-[#eab308]" />
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Filter Baselines
              </h2>
            </div>

            {/* Filter Section 1: Device Type */}
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => setDeviceTypeOpen(!deviceTypeOpen)}
                className="w-full flex items-center justify-between text-xs font-bold text-slate-800 hover:text-sky-600 transition-colors"
              >
                <span>Device Type</span>
                {deviceTypeOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {deviceTypeOpen && (
                <div className="space-y-1 text-xs pt-0.5">
                  {[
                    { label: 'Switch', count: 5 },
                    { label: 'Router', count: 3 },
                    { label: 'Access Point', count: 2 },
                    { label: 'Firewall', count: 2 },
                  ].map((item) => {
                    const isChecked = selectedDeviceTypes.includes(item.label);
                    return (
                      <label
                        key={item.label}
                        onClick={() => toggleDeviceType(item.label)}
                        className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-[#f1ece1] cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="w-3.5 h-3.5 rounded border-[#1e293b] text-sky-600 focus:ring-0 cursor-pointer"
                          />
                          <span className="text-slate-700">{item.label}</span>
                        </div>
                        <span className="text-[11px] text-slate-400">({item.count})</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Filter Section 2: Vendor */}
            <div className="space-y-1.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setVendorOpen(!vendorOpen)}
                className="w-full flex items-center justify-between text-xs font-bold text-slate-800 hover:text-sky-600 transition-colors"
              >
                <span>Vendor</span>
                {vendorOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {vendorOpen && (
                <div className="space-y-1 text-xs pt-0.5">
                  {[
                    { label: 'Cisco', count: 8 },
                    { label: 'FRR', count: 2 },
                    { label: 'Other', count: 2 },
                  ].map((item) => {
                    const isChecked = selectedVendors.includes(item.label);
                    return (
                      <label
                        key={item.label}
                        onClick={() => toggleVendor(item.label)}
                        className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-[#f1ece1] cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="w-3.5 h-3.5 rounded border-[#1e293b] text-sky-600 focus:ring-0 cursor-pointer"
                          />
                          <span className="text-slate-700">{item.label}</span>
                        </div>
                        <span className="text-[11px] text-slate-400">({item.count})</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Filter Section 3: Status */}
            <div className="space-y-1.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setStatusOpen(!statusOpen)}
                className="w-full flex items-center justify-between text-xs font-bold text-slate-800 hover:text-sky-600 transition-colors"
              >
                <span>Status</span>
                {statusOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {statusOpen && (
                <div className="space-y-1 text-xs pt-0.5">
                  {[
                    { label: 'Active', count: 8 },
                    { label: 'Draft', count: 2 },
                    { label: 'Archived', count: 2 },
                  ].map((item) => {
                    const isChecked = selectedStatuses.includes(item.label);
                    return (
                      <label
                        key={item.label}
                        onClick={() => toggleStatus(item.label)}
                        className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-[#f1ece1] cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="w-3.5 h-3.5 rounded border-[#1e293b] text-sky-600 focus:ring-0 cursor-pointer"
                          />
                          <span className="text-slate-700">{item.label}</span>
                        </div>
                        <span className="text-[11px] text-slate-400">({item.count})</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Reset Filters Button */}
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

        {/* MIDDLE COLUMN: BASELINE CATALOG TABLE (col-span-6 xl:col-span-7) */}
        <div className="lg:col-span-6 xl:col-span-7 space-y-3">
          <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] overflow-hidden flex flex-col justify-between min-h-[520px]">
            {/* Table Card Header with Search */}
            <div className="p-3 border-b-2 border-[#1e293b] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 bg-[#fbf5e8]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-[#38bdf8] border border-[#1e293b] flex items-center justify-center text-white shrink-0 shadow-[1px_1px_0px_#1e293b]">
                  <Layers className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-black text-slate-800">
                  Baseline Catalog <span className="text-[#ef4444]">({filteredBaselines.length})</span>
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
                  placeholder="Search baseline by name, device type or version..."
                  className="w-full pl-8 pr-3 py-1 rounded-full border-2 border-[#1e293b] bg-white text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-[#f8f1de] text-slate-600 uppercase text-[10px] tracking-wider font-extrabold border-b-2 border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Baseline Name</th>
                    <th className="py-2.5 px-2.5">Device Type</th>
                    <th className="py-2.5 px-2.5">Vendor</th>
                    <th className="py-2.5 px-2.5">Latest Version</th>
                    <th className="py-2.5 px-2.5">Status</th>
                    <th className="py-2.5 px-2.5">Last Updated</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {paginatedBaselines.map((baseline) => {
                    const isSelected = baseline.id === selectedBaselineId;
                    return (
                      <tr
                        key={baseline.id}
                        onClick={() => setSelectedBaselineId(baseline.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[#e0f2fe] font-medium border-l-4 border-l-[#0284c7]'
                            : 'hover:bg-[#f7f2e4]'
                        }`}
                      >
                        {/* Name */}
                        <td className="py-2.5 px-3 font-bold text-slate-900 whitespace-nowrap">
                          {baseline.name}
                        </td>
                        {/* Device Type */}
                        <td className="py-2.5 px-2.5 whitespace-nowrap">
                          {renderDeviceTypeBadge(baseline.device_type)}
                        </td>
                        {/* Vendor */}
                        <td className="py-2.5 px-2.5 font-medium text-slate-700">
                          {baseline.vendor}
                        </td>
                        {/* Version */}
                        <td className="py-2.5 px-2.5 font-mono text-slate-800">
                          {baseline.version}
                        </td>
                        {/* Status */}
                        <td className="py-2.5 px-2.5 whitespace-nowrap">
                          {renderStatusBadge(baseline.status)}
                        </td>
                        {/* Last Updated */}
                        <td className="py-2.5 px-2.5 text-slate-500 whitespace-nowrap text-[11px]">
                          {baseline.last_updated}
                        </td>
                        {/* Actions */}
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedBaselineId(baseline.id);
                                setViewConfigModalOpen(true);
                              }}
                              className="p-1 rounded text-slate-600 hover:text-sky-600 hover:bg-slate-200/60"
                              title="View Baseline Config"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedBaselineId(baseline.id);
                                setEditModalOpen(true);
                              }}
                              className="p-1 rounded text-slate-600 hover:text-sky-600 hover:bg-slate-200/60"
                              title="More Options"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {paginatedBaselines.length === 0 && (
                <div className="p-8 text-center text-slate-500 text-xs">
                  No baselines matched your filter. Click &ldquo;Reset Filters&rdquo; to view all.
                </div>
              )}
            </div>

            {/* Table Footer with Pagination */}
            <div className="p-2.5 border-t-2 border-[#1e293b] bg-[#fbf5e8] flex items-center justify-between text-xs text-slate-600">
              <span className="text-[11px] font-medium">
                Showing {filteredBaselines.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} -{' '}
                {Math.min(currentPage * pageSize, filteredBaselines.length)} of {filteredBaselines.length} baselines
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

        {/* RIGHT COLUMN: BASELINE DETAILS & VERSION HISTORY (col-span-3) */}
        <div className="lg:col-span-3 xl:col-span-3 space-y-3">
          <div className="bg-[#fcf9f2] rounded-xl border-2 border-[#1e293b] shadow-[3px_3px_0px_#1e293b] p-3.5 space-y-3.5 flex flex-col justify-between">
            {/* Inspector Header */}
            <div>
              <div className="flex items-center gap-2 pb-2 border-b-2 border-slate-200">
                <div className="w-5 h-5 rounded bg-[#38bdf8] border border-[#1e293b] flex items-center justify-center text-white shrink-0">
                  <Layers className="w-3.5 h-3.5" />
                </div>
                <h2 className="text-xs font-black uppercase tracking-wider text-slate-800">
                  Baseline Details
                </h2>
              </div>

              {/* Title & Status Badge */}
              <div className="mt-3 flex items-start justify-between gap-2">
                <h3 className="text-sm font-black text-slate-900 leading-snug">
                  {currentBaseline.name}
                </h3>
                {renderStatusBadge(currentBaseline.status)}
              </div>

              {/* Key-Value Metadata */}
              <div className="mt-2.5 space-y-1.5 text-xs text-slate-700 font-medium">
                <div className="flex items-center gap-2">
                  <Monitor className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                  <span className="text-slate-500 w-24">Device Type</span>
                  <span className="font-bold text-slate-800">: {currentBaseline.device_type}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="text-slate-500 w-24">Vendor</span>
                  <span className="font-bold text-slate-800">: {currentBaseline.vendor}</span>
                </div>
                <div className="flex items-center gap-2">
                  <SettingsIcon className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span className="text-slate-500 w-24">Latest Version</span>
                  <span className="font-mono font-bold text-slate-800">: {currentBaseline.version}</span>
                </div>
                <div className="flex items-center gap-2">
                  <User className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                  <span className="text-slate-500 w-24">Created By</span>
                  <span className="font-bold text-slate-800">: {currentBaseline.created_by || 'admin'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  <span className="text-slate-500 w-24">Last Updated</span>
                  <span className="text-[11px] font-bold text-slate-800">: {currentBaseline.last_updated}</span>
                </div>
              </div>

              {/* Version History Section */}
              <div className="mt-4 pt-3 border-t-2 border-slate-200">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Database className="w-3.5 h-3.5 text-[#0284c7]" />
                  <h4 className="text-xs font-black text-slate-800">
                    Version History <span className="text-[#ef4444]">({currentBaseline.versions.length})</span>
                  </h4>
                </div>

                {/* Vertical Timeline */}
                <div className="relative pl-4 space-y-2.5 before:content-[''] before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#38bdf8]">
                  {currentBaseline.versions.map((ver, idx) => {
                    const isActive = ver.status === 'Active';
                    return (
                      <div key={ver.version} className="relative flex items-center justify-between gap-2">
                        {/* Timeline Circle Bullet */}
                        <span
                          className={`absolute -left-[14px] top-3 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm ${
                            isActive ? 'bg-[#22c55e]' : 'bg-[#38bdf8]'
                          }`}
                        ></span>

                        {/* Card Container */}
                        <div
                          className={`flex-1 p-2 rounded-lg border flex items-center justify-between gap-2 transition-colors ${
                            idx === 0
                              ? 'bg-[#f0f9ff] border-[#bae6fd]'
                              : 'bg-white border-slate-200'
                          }`}
                        >
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-mono font-bold text-slate-900">
                                {ver.version}
                              </span>
                              {isActive && (
                                <span className="text-[10px] font-bold text-[#16a34a]">
                                  (Active)
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 block">{ver.date}</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => setViewConfigModalOpen(true)}
                            className="p-1 rounded bg-white hover:bg-sky-50 border border-slate-200 text-sky-600 transition-colors shadow-2xs"
                            title="Inspect version configuration"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 3 Arcade Buttons at Bottom */}
            <div className="space-y-2 pt-3 border-t-2 border-slate-200">
              <button
                type="button"
                onClick={() => setViewConfigModalOpen(true)}
                className="w-full py-2 px-3 rounded-lg border-2 border-[#0369a1] bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>View Config</span>
              </button>

              <button
                type="button"
                onClick={() => setCompareModalOpen(true)}
                className="w-full py-2 px-3 rounded-lg border-2 border-[#ca8a04] bg-[#facc15] hover:bg-[#eab308] text-slate-900 text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
              >
                <GitCompare className="w-3.5 h-3.5" />
                <span>Compare</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setYamlEditorText(currentBaseline.yaml || DEFAULT_YAML);
                  setEditModalOpen(true);
                }}
                className="w-full py-2 px-3 rounded-lg border-2 border-[#15803d] bg-[#22c55e] hover:bg-[#16a34a] text-white text-xs font-black shadow-[2px_2px_0px_#1e293b] flex items-center justify-center gap-1.5 transition-transform active:translate-y-0.5"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit Baseline</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL 1: VIEW CONFIG & GOLDEN RULES */}
      {viewConfigModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#fcf9f2] rounded-2xl border-4 border-[#1e293b] shadow-[6px_6px_0px_#1e293b] max-w-3xl w-full p-5 space-y-4 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b-2 border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#0284c7] text-white border-2 border-[#1e293b] flex items-center justify-center shadow-[2px_2px_0px_#1e293b]">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 font-pixel">
                    {currentBaseline.name} · {currentBaseline.version}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Approved Golden Configuration Rules ({currentBaseline.rules.length} defined)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewConfigModalOpen(false)}
                className="p-1.5 rounded-lg border-2 border-[#1e293b] bg-white text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content Tabs / Body */}
            <div className="overflow-y-auto space-y-4 pr-1 flex-1">
              {/* Rules Table */}
              <div className="rounded-xl border-2 border-[#1e293b] bg-white overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#f4ebe1] text-slate-700 font-extrabold uppercase text-[10px] tracking-wider border-b-2 border-slate-200">
                    <tr>
                      <th className="py-2 px-3">Key Path</th>
                      <th className="py-2 px-2.5">Type</th>
                      <th className="py-2 px-2.5">Expected Value</th>
                      <th className="py-2 px-2 text-center">Weight</th>
                      <th className="py-2 px-2.5 text-center">Hard Compliance</th>
                      <th className="py-2 px-3">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                    {currentBaseline.rules.map((rule, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2 px-3 text-[#0284c7] font-bold">{rule.key_path}</td>
                        <td className="py-2 px-2.5 text-slate-600">{rule.rule_type}</td>
                        <td className="py-2 px-2.5 text-emerald-700 font-bold max-w-[140px] truncate" title={rule.expected_value || '-'}>
                          {rule.expected_value || '(Empty)'}
                        </td>
                        <td className="py-2 px-2 text-center font-bold text-slate-800">{rule.severity_weight}</td>
                        <td className="py-2 px-2.5 text-center">
                          {rule.hard_compliance ? (
                            <span className="inline-flex items-center gap-1 text-[#ef4444] font-bold text-[10px] font-sans">
                              <ShieldAlert className="w-3 h-3" /> YES
                            </span>
                          ) : (
                            <span className="text-slate-400 font-sans text-[10px]">No</span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-sans text-slate-600 text-[11px]">{rule.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* YAML Source Preview */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
                    <Database className="w-3.5 h-3.5 text-sky-600" /> Raw YAML Definition
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyYaml}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-600 hover:text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200"
                  >
                    {copiedYaml ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedYaml ? 'Copied!' : 'Copy YAML'}</span>
                  </button>
                </div>
                <pre className="p-3 rounded-xl border-2 border-[#1e293b] bg-slate-900 text-sky-300 font-mono text-xs overflow-x-auto leading-relaxed max-h-48">
                  {currentBaseline.yaml || DEFAULT_YAML}
                </pre>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-2 border-t-2 border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setViewConfigModalOpen(false)}
                className="py-1.5 px-4 rounded-lg border-2 border-[#1e293b] bg-white text-xs font-bold text-slate-700 hover:bg-slate-100 shadow-[2px_2px_0px_#1e293b]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: COMPARE BASELINE VERSIONS */}
      {compareModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#fcf9f2] rounded-2xl border-4 border-[#1e293b] shadow-[6px_6px_0px_#1e293b] max-w-4xl w-full p-5 space-y-4 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b-2 border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#eab308] text-slate-900 border-2 border-[#1e293b] flex items-center justify-center shadow-[2px_2px_0px_#1e293b]">
                  <GitCompare className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 font-pixel">
                    Version Comparison: v3.2 vs v3.1
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    {currentBaseline.name} · Rule drift and audit differential
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCompareModalOpen(false)}
                className="p-1.5 rounded-lg border-2 border-[#1e293b] bg-white text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Comparison Side-by-Side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 overflow-y-auto flex-1 font-mono text-xs">
              {/* Left: Previous Version */}
              <div className="rounded-xl border-2 border-[#1e293b] bg-slate-900 p-3 text-slate-300 space-y-1.5">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-[11px] font-sans font-bold">
                  <span className="text-slate-400">Previous Version (v3.1)</span>
                  <span className="text-slate-500">20 Oct 2026</span>
                </div>
                <div className="space-y-1 pt-1 text-[11px]">
                  <p className="text-slate-400">line vty 0 4</p>
                  <p className="text-slate-400 pl-3">transport input ssh</p>
                  <p className="text-slate-400 pl-3">login local</p>
                  <p className="text-rose-400 bg-rose-950/40 px-1 rounded">- ntp server 10.10.0.99</p>
                  <p className="text-slate-400">interface GigabitEthernet0/1</p>
                  <p className="text-slate-400 pl-3">switchport mode access</p>
                  <p className="text-rose-400 bg-rose-950/40 px-1 rounded">- switchport port-security maximum 10</p>
                </div>
              </div>

              {/* Right: Active Version */}
              <div className="rounded-xl border-2 border-[#1e293b] bg-slate-900 p-3 text-slate-300 space-y-1.5">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-[11px] font-sans font-bold">
                  <span className="text-emerald-400">Active Version (v3.2)</span>
                  <span className="text-emerald-500 font-sans">02 Nov 2026</span>
                </div>
                <div className="space-y-1 pt-1 text-[11px]">
                  <p className="text-slate-400">line vty 0 4</p>
                  <p className="text-slate-400 pl-3">transport input ssh</p>
                  <p className="text-slate-400 pl-3">login local</p>
                  <p className="text-emerald-400 bg-emerald-950/40 px-1 rounded">+ ntp server 10.10.0.1 (hard-enforced)</p>
                  <p className="text-slate-400">interface GigabitEthernet0/1</p>
                  <p className="text-slate-400 pl-3">switchport mode access</p>
                  <p className="text-emerald-400 bg-emerald-950/40 px-1 rounded">+ switchport port-security maximum 2</p>
                  <p className="text-emerald-400 bg-emerald-950/40 px-1 rounded">+ switchport port-security violation restrict</p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-2 border-t-2 border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCompareModalOpen(false)}
                className="py-1.5 px-4 rounded-lg border-2 border-[#1e293b] bg-white text-xs font-bold text-slate-700 hover:bg-slate-100 shadow-[2px_2px_0px_#1e293b]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: EDIT BASELINE / CREATE NEW VERSION */}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#fcf9f2] rounded-2xl border-4 border-[#1e293b] shadow-[6px_6px_0px_#1e293b] max-w-2xl w-full p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b-2 border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#22c55e] text-white border-2 border-[#1e293b] flex items-center justify-center shadow-[2px_2px_0px_#1e293b]">
                  <Edit3 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 font-pixel">
                    New Golden Baseline Version (YAML)
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    The version number auto-increments. Baseline is created inactive until Admin activation.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="p-1.5 rounded-lg border-2 border-[#1e293b] bg-white text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <textarea
              value={yamlEditorText}
              onChange={(e) => setYamlEditorText(e.target.value)}
              rows={14}
              spellCheck={false}
              className="w-full px-3 py-2 border-2 border-[#1e293b] rounded-xl font-mono text-xs text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            />

            {editorError && (
              <div className="p-3 rounded-lg border-2 border-[#ef4444] bg-rose-50 text-rose-800 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#ef4444]" />
                <span>{editorError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 text-xs pt-1">
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="px-4 py-2 border-2 border-[#1e293b] rounded-lg bg-white text-slate-700 hover:bg-slate-100 font-bold shadow-[2px_2px_0px_#1e293b]"
              >
                Cancel
              </button>
              {canCreate && (
                <button
                  type="button"
                  onClick={() => createMutation.mutate()}
                  disabled={createMutation.isPending || !yamlEditorText.trim()}
                  className="px-4 py-2 border-2 border-[#15803d] bg-[#22c55e] hover:bg-[#16a34a] disabled:opacity-50 text-white rounded-lg font-black shadow-[2px_2px_0px_#1e293b] flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>{createMutation.isPending ? 'Saving...' : 'Create Inactive Version'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
