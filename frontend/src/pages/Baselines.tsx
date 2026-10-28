import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Plus, CheckCircle2, AlertCircle, X, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';

export interface BaselineSummary {
  id: string;
  name: string;
  device_group_id: string;
  device_group_name?: string | null;
  vendor: string;
  version: number;
  is_active: boolean;
  created_at: string;
  rules_count: number;
}

const YAML_TEMPLATE = `name: "Hostel-Baseline-v2"
device_group: "Hostel"
vendor: "cisco_ios"
rules:
  - key_path: "line.vty.transport_input"
    expected_value: "ssh"
    rule_type: "EXACT"          # EXACT | MUST_EXIST | MUST_NOT_EXIST | REGEX
    severity_weight: 90         # 1-100
    hard_compliance: true       # true = a change ticket can never waive it
    description: "SSH must be the only management transport."
  - key_path: "ntp.server"
    expected_value: "10.10.0.1"
    rule_type: "EXACT"
    severity_weight: 30
`;

export const Baselines: React.FC = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const canCreate = user?.role === 'Admin' || user?.role === 'NetworkEngineer';
  const [open, setOpen] = useState(false);
  const [yamlText, setYamlText] = useState(YAML_TEMPLATE);
  const [error, setError] = useState<string | null>(null);

  const { data: baselines = [], isLoading, isError, refetch } = useQuery<BaselineSummary[]>({
    queryKey: ['baselines'],
    queryFn: async () => (await apiClient.get('/api/baselines')).data,
  });

  const createMutation = useMutation({
    mutationFn: async () => (await apiClient.post('/api/baselines', { yaml_content: yamlText })).data,
    onSuccess: () => {
      setOpen(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['baselines'] });
    },
    onError: (err: any) => {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : JSON.stringify(detail) || err.message);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-sky-50 rounded-lg text-sky-600">
            <FileCheck2 className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Approved Baselines</h2>
            <p className="text-sm text-slate-500">Approved configuration rules per campus device group and vendor. Only an Admin can activate a version.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => refetch()} className="p-2 border border-slate-200 rounded-lg bg-white text-slate-600 hover:bg-slate-50" title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => { setError(null); setOpen(true); }}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>New Baseline Version</span>
            </button>
          )}
        </div>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading baselines...</p>}
      {isError && <p className="text-sm text-rose-600">Could not load baselines.</p>}
      {!isLoading && !isError && baselines.length === 0 && (
        <div className="p-8 bg-white border border-slate-200 rounded-xl text-center text-sm text-slate-500">
          No baselines yet. Devices in a group without an active baseline are reported as NO_BASELINE.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {baselines.map((b) => (
          <div key={b.id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${b.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                  v{b.version} ({b.is_active ? 'Active' : 'Inactive'})
                </span>
                <span className="text-xs text-slate-400">{b.vendor}</span>
              </div>
              <h3 className="text-lg font-bold text-slate-800">{b.name}</h3>
              <p className="text-xs text-slate-500 mt-1">Target group: {b.device_group_name || 'Unknown'}</p>
              <div className="mt-4 flex items-center gap-2 text-xs text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                <span>{b.rules_count} rule{b.rules_count === 1 ? '' : 's'} defined</span>
              </div>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">Created {new Date(b.created_at).toLocaleDateString()}</span>
              <Link to={`/baselines/${b.id}`} className="text-sm font-medium text-sky-600 hover:text-sky-700">
                View rules →
              </Link>
            </div>
          </div>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">New baseline version (YAML)</h3>
                <p className="text-xs text-slate-500">The version number is assigned automatically and the baseline is created inactive. An Admin must activate it.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <textarea
              value={yamlText}
              onChange={(e) => setYamlText(e.target.value)}
              rows={16}
              spellCheck={false}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-[11px] text-slate-800 focus:outline-none focus:border-sky-500"
            />
            {error && (
              <div className="p-3 rounded-lg border bg-rose-50 border-rose-200 text-rose-800 text-xs flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 text-xs">
              <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 font-medium">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !yamlText.trim()}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg font-medium"
              >
                {createMutation.isPending ? 'Creating...' : 'Create inactive version'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
