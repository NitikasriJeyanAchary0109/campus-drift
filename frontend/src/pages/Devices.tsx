import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  Server,
  Plus,
  Filter,
  Search,
  RefreshCw,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  X,
  ChevronRight,
  Shield,
  Radio,
} from 'lucide-react';

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
  has_credentials: boolean;
}

export const Devices: React.FC = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const isAdmin = user?.role === 'Admin';
  const isNetEng = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  const [search, setSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [pollStatusMsg, setPollStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pollingDeviceId, setPollingDeviceId] = useState<string | null>(null);

  // New device form state
  const [formHostname, setFormHostname] = useState('');
  const [formIp, setFormIp] = useState('');
  const [formVendor, setFormVendor] = useState('cisco_ios');
  const [formModel, setFormModel] = useState('Catalyst 2960-X');
  const [formGroupId, setFormGroupId] = useState('');
  const [formStatus, setFormStatus] = useState('ONLINE');
  const [formError, setFormError] = useState<string | null>(null);

  // Fetch devices
  const {
    data: devices = [],
    isLoading: isDevicesLoading,
    isError: isDevicesError,
    error: devicesError,
    refetch: refetchDevices,
  } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn: async () => {
      const res = await apiClient.get('/api/devices');
      return res.data;
    },
  });

  // Fetch groups
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

  // Poll device trigger
  const handlePollDevice = async (deviceId: string, hostname: string) => {
    setPollingDeviceId(deviceId);
    setPollStatusMsg(null);
    try {
      const res = await apiClient.post(`/api/devices/${deviceId}/poll`);
      setPollStatusMsg({
        type: 'success',
        text: res.data?.message || `Successfully collected configuration for ${hostname}.`,
      });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
      queryClient.invalidateQueries({ queryKey: ['drift'] });
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || `Failed to poll device ${hostname}.`;
      setPollStatusMsg({
        type: 'error',
        text: msg,
      });
    } finally {
      setPollingDeviceId(null);
    }
  };

  // Filtered devices
  const filteredDevices = devices.filter((d) => {
    const matchesSearch =
      d.hostname.toLowerCase().includes(search.toLowerCase()) ||
      d.ip_address.includes(search) ||
      d.vendor.toLowerCase().includes(search.toLowerCase()) ||
      d.model.toLowerCase().includes(search.toLowerCase());

    const matchesGroup = selectedGroup === 'ALL' || d.device_group_id === selectedGroup;
    const matchesStatus = selectedStatus === 'ALL' || d.status === selectedStatus;

    return matchesSearch && matchesGroup && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ONLINE':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'UNREACHABLE':
        return 'bg-rose-100 text-rose-800 border-rose-200';
      case 'DECOMMISSIONED':
        return 'bg-slate-100 text-slate-600 border-slate-200';
      default:
        return 'bg-amber-100 text-amber-800 border-amber-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Campus Devices Inventory</h2>
          <p className="text-sm text-slate-500">
            Authoritative inventory of switches, routers, and firewalls across campus zones.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => refetchDevices()}
            className="p-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 bg-white shadow-sm transition-colors"
            title="Refresh devices"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={handleOpenAddModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              <span>Add Device</span>
            </button>
          )}
        </div>
      </div>

      {/* Notification banner */}
      {pollStatusMsg && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-sm ${
            pollStatusMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {pollStatusMsg.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            )}
            <span>{pollStatusMsg.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setPollStatusMsg(null)}
            className="p-1 hover:bg-black/5 rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search hostname, IP, vendor, model..."
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-500 transition-colors"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
            <Filter className="h-3.5 w-3.5" />
            <span>Group:</span>
          </div>
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 bg-slate-50 focus:outline-none focus:border-sky-500"
          >
            <option value="ALL">All Groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} (w={g.criticality_weight})
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium ml-2">
            <Radio className="h-3.5 w-3.5" />
            <span>Status:</span>
          </div>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 bg-slate-50 focus:outline-none focus:border-sky-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="ONLINE">ONLINE</option>
            <option value="UNREACHABLE">UNREACHABLE</option>
            <option value="DECOMMISSIONED">DECOMMISSIONED</option>
          </select>
        </div>
      </div>

      {/* Devices Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isDevicesLoading ? (
          <div className="py-16 text-center text-slate-400 space-y-3">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto text-sky-500" />
            <p className="text-sm">Loading campus devices...</p>
          </div>
        ) : isDevicesError ? (
          <div className="py-16 text-center text-rose-500 space-y-2">
            <AlertCircle className="h-8 w-8 mx-auto" />
            <p className="text-sm font-medium">Failed to load devices.</p>
            <p className="text-xs text-slate-500">{(devicesError as any)?.message}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">Hostname</th>
                  <th className="py-3 px-4 font-semibold">IP Address</th>
                  <th className="py-3 px-4 font-semibold">Campus Zone / Group</th>
                  <th className="py-3 px-4 font-semibold">Vendor & Model</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold">Vault Creds</th>
                  <th className="py-3 px-4 font-semibold">Last Polled</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredDevices.length > 0 ? (
                  filteredDevices.map((device) => {
                    const isPolling = pollingDeviceId === device.id;
                    return (
                      <tr key={device.id} className="hover:bg-slate-50/75 transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-slate-900">
                          <Link
                            to={`/devices/${device.id}`}
                            className="hover:text-sky-600 transition-colors flex items-center gap-1.5"
                          >
                            <span>{device.hostname}</span>
                            <ChevronRight className="h-3 w-3 text-slate-400" />
                          </Link>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-700">{device.ip_address}</td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">
                            <span>{device.device_group?.name || 'Unassigned'}</span>
                            {device.device_group?.criticality_weight && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                (w={device.device_group.criticality_weight})
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-xs font-medium text-slate-800">{device.vendor}</div>
                          <div className="text-[11px] text-slate-400">{device.model}</div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${getStatusBadge(
                              device.status
                            )}`}
                          >
                            {device.status}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {device.has_credentials ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
                              <KeyRound className="h-3.5 w-3.5 text-emerald-600" />
                              <span>Encrypted</span>
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 italic">None</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-500">
                          {device.last_polled_at
                            ? new Date(device.last_polled_at).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : 'Never'}
                        </td>
                        <td className="py-3 px-4 text-right space-x-2">
                          {isNetEng && (
                            <button
                              type="button"
                              onClick={() => handlePollDevice(device.id, device.hostname)}
                              disabled={isPolling || device.status === 'DECOMMISSIONED'}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors disabled:opacity-40"
                              title="Trigger immediate configuration snapshot"
                            >
                              <RefreshCw className={`h-3 w-3 ${isPolling ? 'animate-spin' : ''}`} />
                              <span>{isPolling ? 'Polling...' : 'Poll'}</span>
                            </button>
                          )}
                          <Link
                            to={`/devices/${device.id}`}
                            className="inline-flex items-center px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
                          >
                            Details
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      <Server className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                      <p className="font-medium text-slate-600">No matching devices found</p>
                      <p className="text-xs text-slate-400 mt-1">Try changing your search or filter parameters.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Device Modal (Admin Only) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-sky-50 text-sky-600 rounded-lg">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Add Campus Device</h3>
                  <p className="text-xs text-slate-500">Register a new switch or router in the inventory</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Hostname</label>
                  <input
                    type="text"
                    value={formHostname}
                    onChange={(e) => setFormHostname(e.target.value)}
                    placeholder="e.g. sw-lab-02"
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">IP Address</label>
                  <input
                    type="text"
                    value={formIp}
                    onChange={(e) => setFormIp(e.target.value)}
                    placeholder="e.g. 10.10.3.15"
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Vendor Driver</label>
                  <select
                    value={formVendor}
                    onChange={(e) => setFormVendor(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-sky-500 bg-white"
                  >
                    <option value="cisco_ios">cisco_ios</option>
                    <option value="vyos">vyos</option>
                    <option value="frr">frr</option>
                    <option value="arista_eos">arista_eos</option>
                    <option value="juniper_junos">juniper_junos</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Hardware Model</label>
                  <input
                    type="text"
                    value={formModel}
                    onChange={(e) => setFormModel(e.target.value)}
                    placeholder="e.g. Catalyst 2960-X"
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Campus Device Group</label>
                  <select
                    value={formGroupId}
                    onChange={(e) => setFormGroupId(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-sky-500 bg-white"
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} (w={g.criticality_weight})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Initial Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-sky-500 bg-white"
                  >
                    <option value="ONLINE">ONLINE</option>
                    <option value="UNREACHABLE">UNREACHABLE</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addDeviceMutation.isPending}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-medium transition-colors shadow-sm disabled:opacity-50"
                >
                  {addDeviceMutation.isPending ? 'Saving...' : 'Create Device'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

