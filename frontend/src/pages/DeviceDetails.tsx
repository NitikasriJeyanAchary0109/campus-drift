import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';
import {
  ArrowLeft,
  RefreshCw,
  Server,
  History,
  KeyRound,
  Shield,
  CheckCircle2,
  AlertCircle,
  Clock,
  GitCompare,
  ArrowUpRight,
  X,
  Lock,
  Radio,
} from 'lucide-react';

interface DeviceDetail {
  id: string;
  hostname: string;
  ip_address: string;
  vendor: string;
  model: string;
  device_group_id: string;
  status: string;
  last_polled_at: string | null;
  device_group?: {
    id: string;
    name: string;
    criticality_weight: number;
  };
  has_credentials: boolean;
  latest_snapshot?: {
    id: string;
    collected_at: string;
    collection_method: string;
  } | null;
}

interface DriftEvent {
  id: string;
  label: string;
  risk_score: number;
  status: string;
  detected_at: string;
  matched_ticket_ref?: string | null;
}

export const DeviceDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const isAdmin = user?.role === 'Admin';
  const isNetEng = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  const [isCredModalOpen, setIsCredModalOpen] = useState(false);
  const [credUsername, setCredUsername] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [credAuthType, setCredAuthType] = useState('password');
  const [credMessage, setCredMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [pollMessage, setPollMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  // Fetch device details
  const {
    data: device,
    isLoading: isDeviceLoading,
    isError: isDeviceError,
    error: deviceError,
    refetch: refetchDevice,
  } = useQuery<DeviceDetail>({
    queryKey: ['device', id],
    queryFn: async () => {
      const res = await apiClient.get(`/api/devices/${id}`);
      return res.data;
    },
    enabled: !!id,
  });

  // Fetch device drift events
  const { data: deviceDrifts = [] } = useQuery<DriftEvent[]>({
    queryKey: ['deviceDrifts', id],
    queryFn: async () => {
      const res = await apiClient.get(`/api/drift?device_id=${id}`);
      return res.data;
    },
    enabled: !!id,
  });

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
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message || 'Failed to save credentials.';
      setCredMessage({ type: 'error', text: msg });
    },
  });

  const handlePoll = async () => {
    if (!id) return;
    setIsPolling(true);
    setPollMessage(null);
    try {
      const res = await apiClient.post(`/api/devices/${id}/poll`);
      setPollMessage({
        type: 'success',
        text: res.data?.message || 'Configuration collected and analyzed successfully.',
      });
      refetchDevice();
      queryClient.invalidateQueries({ queryKey: ['deviceDrifts', id] });
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || 'Failed to trigger device poll.';
      setPollMessage({ type: 'error', text: msg });
    } finally {
      setIsPolling(false);
    }
  };

  const handleCredSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCredMessage(null);
    credMutation.mutate({
      username: credUsername.trim(),
      secret: credPassword.trim(),
      auth_type: credAuthType,
    });
  };

  if (isDeviceLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <RefreshCw className="h-8 w-8 text-sky-500 animate-spin" />
        <p className="text-sm text-slate-500">Loading device hardware & state...</p>
      </div>
    );
  }

  if (isDeviceError || !device) {
    return (
      <div className="p-8 bg-rose-50 border border-rose-200 rounded-xl text-center space-y-3">
        <AlertCircle className="h-10 w-10 text-rose-500 mx-auto" />
        <h3 className="text-lg font-semibold text-rose-900">Device Not Found</h3>
        <p className="text-sm text-rose-600 max-w-md mx-auto">
          {(deviceError as any)?.response?.data?.detail || 'Unable to retrieve device records.'}
        </p>
        <Link
          to="/devices"
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Inventory</span>
        </Link>
      </div>
    );
  }

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
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/devices"
            className="p-2 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors bg-white shadow-sm"
            title="Back to devices"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-slate-900 font-mono">{device.hostname}</h2>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadge(
                  device.status
                )}`}
              >
                {device.status}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">UUID: {device.id}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isNetEng && (
            <button
              type="button"
              onClick={handlePoll}
              disabled={isPolling || device.status === 'DECOMMISSIONED'}
              className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
            >
              <RefreshCw className={`h-4 w-4 ${isPolling ? 'animate-spin' : ''}`} />
              <span>{isPolling ? 'Collecting Config...' : 'Trigger Poll'}</span>
            </button>
          )}

          <Link
            to={`/drift?device_id=${device.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 bg-white shadow-sm transition-colors"
          >
            <span>Drift History</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Action Banners */}
      {pollMessage && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-sm ${
            pollMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {pollMessage.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            )}
            <span>{pollMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setPollMessage(null)}
            className="p-1 hover:bg-black/5 rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {credMessage && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-sm ${
            credMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span>{credMessage.text}</span>
          <button
            type="button"
            onClick={() => setCredMessage(null)}
            className="p-1 hover:bg-black/5 rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Grid of Details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Hardware & Location */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2 text-sm">
            <Server className="h-4 w-4 text-sky-600" />
            <span>Hardware Specifications</span>
          </h3>
          <div className="space-y-2.5 text-xs">
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Hostname</span>
              <span className="font-mono font-medium text-slate-900">{device.hostname}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">IP Address</span>
              <span className="font-mono font-medium text-slate-900">{device.ip_address}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Vendor Driver</span>
              <span className="font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                {device.vendor}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Hardware Model</span>
              <span className="font-medium text-slate-800">{device.model}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Campus Group</span>
              <span className="font-medium text-slate-800">{device.device_group?.name || 'None'}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-slate-500">Criticality Weight</span>
              <span className="font-mono font-semibold text-slate-900">
                {device.device_group?.criticality_weight || 1.0}
              </span>
            </div>
          </div>
        </div>

        {/* Encrypted Vault Credentials */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2 text-sm">
              <KeyRound className="h-4 w-4 text-emerald-600" />
              <span>Vault Credentials</span>
            </h3>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsCredModalOpen(true)}
                className="text-xs text-sky-600 hover:text-sky-700 font-medium"
              >
                {device.has_credentials ? 'Update' : 'Configure'}
              </button>
            )}
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 text-xs space-y-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="font-medium text-slate-700">Fernet Encryption at Rest</span>
            </div>
            <p className="text-slate-500 leading-relaxed text-[11px]">
              {device.has_credentials
                ? 'Valid SSH credentials are encrypted and stored in the database vault. Plaintext secrets are never exposed over the API.'
                : 'No encrypted credentials have been configured for this device yet. Configuration polling over SSH requires credentials.'}
            </p>
            <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between">
              <span className="text-slate-500">Status:</span>
              {device.has_credentials ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Active in Vault
                </span>
              ) : (
                <span className="text-amber-600 font-medium">Missing</span>
              )}
            </div>
          </div>
        </div>

        {/* Latest Configuration Snapshot */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-sky-600" />
            <span>Latest Config Snapshot</span>
          </h3>

          {device.latest_snapshot ? (
            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Collected At</span>
                <span className="font-medium text-slate-800">
                  {new Date(device.latest_snapshot.collected_at).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Method</span>
                <span className="font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                  {device.latest_snapshot.collection_method}
                </span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-500">Snapshot ID</span>
                <span className="font-mono text-[10px] text-slate-500 truncate max-w-[140px]" title={device.latest_snapshot.id}>
                  {device.latest_snapshot.id}
                </span>
              </div>
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-[11px] flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span>Running configuration actively monitored.</span>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 text-center space-y-2">
              <Clock className="h-6 w-6 text-slate-400 mx-auto" />
              <p className="text-xs text-slate-600 font-medium">No snapshots collected yet</p>
              <p className="text-[11px] text-slate-400">
                Trigger an on-demand poll or wait for the scheduled collector.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Open Drift Events for Device */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-sky-600" />
            <h3 className="font-semibold text-slate-800 text-sm">Active Drift Events on {device.hostname}</h3>
          </div>
          <span className="text-xs text-slate-400">{deviceDrifts.length} recorded</span>
        </div>

        {deviceDrifts.length > 0 ? (
          <div className="divide-y divide-slate-100 border rounded-lg overflow-hidden">
            {deviceDrifts.map((ev) => (
              <div key={ev.id} className="p-3.5 flex items-center justify-between hover:bg-slate-50 text-xs">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800">{ev.label}</span>
                    <span className="font-mono text-[11px] text-slate-400">• Risk Score: {ev.risk_score}</span>
                    {ev.matched_ticket_ref && (
                      <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 font-mono text-[10px]">
                        {ev.matched_ticket_ref}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Detected: {new Date(ev.detected_at).toLocaleString()}
                  </p>
                </div>
                <Link
                  to={`/drift/${ev.id}`}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors"
                >
                  View Diff
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-slate-400 text-xs">
            <CheckCircle2 className="h-6 w-6 text-emerald-500 mx-auto mb-1.5" />
            <p className="font-medium text-slate-600">Clean baseline state</p>
            <p className="text-slate-400 mt-0.5">No open configuration drifts detected on this device.</p>
          </div>
        )}
      </div>

      {/* Set Credentials Modal (Admin Only) */}
      {isCredModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Configure Vault Credentials</h3>
                  <p className="text-xs text-slate-500">{device.hostname} ({device.ip_address})</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCredModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCredSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Auth Type</label>
                <select
                  value={credAuthType}
                  onChange={(e) => setCredAuthType(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-sky-500 bg-white"
                >
                  <option value="password">Password</option>
                  <option value="ssh_key">SSH Key</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">SSH Username</label>
                <input
                  type="text"
                  value={credUsername}
                  onChange={(e) => setCredUsername(e.target.value)}
                  placeholder="e.g. cisco, admin"
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {credAuthType === 'password' ? 'SSH Password / Secret' : 'Private Key Content'}
                </label>
                <input
                  type="password"
                  value={credPassword}
                  onChange={(e) => setCredPassword(e.target.value)}
                  placeholder="Enter secret to encrypt"
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCredModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={credMutation.isPending}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors shadow-sm disabled:opacity-50"
                >
                  {credMutation.isPending ? 'Encrypting...' : 'Save Credentials'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

