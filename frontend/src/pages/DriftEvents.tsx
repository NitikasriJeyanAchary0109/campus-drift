import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import {
  GitCompare,
  Filter,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Ticket,
  ChevronRight,
  ShieldAlert,
  ArrowUpRight,
} from 'lucide-react';

interface DriftEvent {
  id: string;
  device_id: string;
  device_hostname?: string;
  snapshot_id: string;
  baseline_id?: string;
  label: string;
  risk_score: number;
  underlying_severity?: number;
  matched_ticket_id?: string;
  matched_ticket_ref?: string;
  status: string;
  detected_at: string;
  details_count: number;
}

export const DriftEvents: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialDeviceId = searchParams.get('device_id') || '';

  const [search, setSearch] = useState('');
  const [selectedLabel, setSelectedLabel] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [minScore, setMinScore] = useState<number>(0);

  const {
    data: driftEvents = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<DriftEvent[]>({
    queryKey: ['driftEvents', selectedLabel, selectedStatus, minScore, initialDeviceId],
    queryFn: async () => {
      const params: Record<string, any> = {};
      if (selectedLabel !== 'ALL') params.label = selectedLabel;
      if (selectedStatus !== 'ALL') params.status = selectedStatus;
      if (minScore > 0) params.min_score = minScore;
      if (initialDeviceId) params.device_id = initialDeviceId;

      const res = await apiClient.get('/api/drift', { params });
      return res.data;
    },
  });

  const getTaxonomyBadge = (label: string) => {
    switch (label) {
      case 'Non-Compliant':
        return 'bg-rose-100 text-rose-800 border-rose-300 font-semibold';
      case 'Drift-Unauthorized-High':
        return 'bg-orange-100 text-orange-800 border-orange-300 font-semibold';
      case 'Drift-Unauthorized-Medium':
        return 'bg-amber-100 text-amber-800 border-amber-300 font-semibold';
      case 'Drift-Authorized':
        return 'bg-sky-100 text-sky-800 border-sky-300 font-semibold';
      case 'Drift-Low':
        return 'bg-slate-100 text-slate-700 border-slate-300 font-medium';
      case 'NO_BASELINE':
        return 'bg-purple-100 text-purple-800 border-purple-300 font-semibold';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200 font-medium';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-rose-600 bg-rose-50 border-rose-200';
    if (score >= 50) return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-slate-600 bg-slate-50 border-slate-200';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'OPEN':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'ACK':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'RESOLVED':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'FALSE_POSITIVE':
        return 'bg-slate-100 text-slate-600 border-slate-300 line-through';
      default:
        return 'bg-slate-50 text-slate-600 border-slate-200';
    }
  };

  const filteredEvents = driftEvents.filter((ev) => {
    const matchesSearch =
      (ev.device_hostname || '').toLowerCase().includes(search.toLowerCase()) ||
      ev.label.toLowerCase().includes(search.toLowerCase()) ||
      (ev.matched_ticket_ref || '').toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-slate-800">Configuration Drift Events</h2>
            {initialDeviceId && (
              <span className="px-2 py-0.5 rounded text-xs bg-sky-100 text-sky-800 font-mono">
                Filtered by Device
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500">
            Real-time discrepancy detection between running configurations and approved baseline rules.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 bg-white shadow-sm transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin text-sky-600' : ''}`} />
            <span>{isFetching ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-72">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search device, label, ticket..."
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-sky-500 transition-colors"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto text-xs">
          <div className="flex items-center gap-1.5 text-slate-500 font-medium">
            <Filter className="h-3.5 w-3.5" />
            <span>Classification:</span>
          </div>
          <select
            value={selectedLabel}
            onChange={(e) => setSelectedLabel(e.target.value)}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 bg-slate-50 focus:outline-none focus:border-sky-500"
          >
            <option value="ALL">All Classifications</option>
            <option value="Non-Compliant">Non-Compliant (Hard Rule)</option>
            <option value="Drift-Unauthorized-High">Drift-Unauthorized-High (80-94)</option>
            <option value="Drift-Unauthorized-Medium">Drift-Unauthorized-Medium (50-79)</option>
            <option value="Drift-Authorized">Drift-Authorized (Ticket-covered)</option>
            <option value="Drift-Low">Drift-Low (&lt;50)</option>
            <option value="NO_BASELINE">NO_BASELINE (Coverage Gap)</option>
          </select>

          <div className="flex items-center gap-1.5 text-slate-500 font-medium ml-2">
            <span>Status:</span>
          </div>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 bg-slate-50 focus:outline-none focus:border-sky-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="OPEN">OPEN</option>
            <option value="ACK">ACK</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="FALSE_POSITIVE">FALSE_POSITIVE</option>
          </select>

          <div className="flex items-center gap-1.5 text-slate-500 font-medium ml-2">
            <span>Min Score:</span>
          </div>
          <select
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 bg-slate-50 focus:outline-none focus:border-sky-500"
          >
            <option value={0}>Any Score (≥0)</option>
            <option value={50}>Moderate+ (≥50)</option>
            <option value={80}>High Risk (≥80)</option>
          </select>
        </div>
      </div>

      {/* Drift Events Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-slate-400 space-y-3">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto text-sky-500" />
            <p className="text-sm">Fetching configuration drift events...</p>
          </div>
        ) : isError ? (
          <div className="py-16 text-center text-rose-500 space-y-2">
            <AlertTriangle className="h-8 w-8 mx-auto" />
            <p className="text-sm font-medium">Failed to load drift events.</p>
            <p className="text-xs text-slate-500">{(error as any)?.message}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">Device</th>
                  <th className="py-3 px-4 font-semibold">Classification (§12)</th>
                  <th className="py-3 px-4 font-semibold">Risk Score</th>
                  <th className="py-3 px-4 font-semibold">Ticket Match</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold">Discrepancies</th>
                  <th className="py-3 px-4 font-semibold">Detected At</th>
                  <th className="py-3 px-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredEvents.length > 0 ? (
                  filteredEvents.map((ev) => (
                    <tr key={ev.id} className="hover:bg-slate-50/75 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium text-slate-900">
                        <Link
                          to={`/devices/${ev.device_id}`}
                          className="hover:text-sky-600 transition-colors flex items-center gap-1"
                        >
                          <span>{ev.device_hostname || 'Unknown Device'}</span>
                        </Link>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs border ${getTaxonomyBadge(
                            ev.label
                          )}`}
                        >
                          {ev.label}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono text-xs font-bold px-2 py-0.5 rounded border ${getScoreColor(
                              ev.risk_score
                            )}`}
                          >
                            {ev.risk_score}
                          </span>
                          {ev.underlying_severity !== null &&
                            ev.underlying_severity !== undefined &&
                            ev.underlying_severity !== ev.risk_score && (
                              <span
                                className="text-[10px] text-slate-400 font-mono"
                                title="Underlying rule severity before weighting / capping"
                              >
                                (raw: {ev.underlying_severity})
                              </span>
                            )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {ev.matched_ticket_ref ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 text-xs font-mono font-medium">
                            <Ticket className="h-3 w-3 text-sky-600" />
                            <span>{ev.matched_ticket_ref}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 italic">No approved ticket</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getStatusBadge(
                            ev.status
                          )}`}
                        >
                          {ev.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 font-mono">
                        {ev.details_count} {ev.details_count === 1 ? 'rule' : 'rules'}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-500">
                        {new Date(ev.detected_at).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Link
                          to={`/drift/${ev.id}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
                        >
                          <span>Evidence</span>
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="py-14 text-center text-slate-400">
                      <GitCompare className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                      <p className="font-semibold text-slate-700">No configuration drift events found</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Running device configurations match the approved golden baselines.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

