import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldAlert, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';

interface Rule {
  id: string;
  key_path: string;
  expected_value: string;
  rule_type: string;
  severity_weight: number;
  hard_compliance: boolean;
  description?: string | null;
}

interface BaselineDetail {
  id: string;
  name: string;
  device_group_name?: string | null;
  vendor: string;
  version: number;
  is_active: boolean;
  created_at: string;
  rules: Rule[];
}

export const BaselineDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'Admin';
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: baseline, isLoading, isError } = useQuery<BaselineDetail>({
    queryKey: ['baseline', id],
    queryFn: async () => (await apiClient.get(`/api/baselines/${id}`)).data,
    enabled: !!id,
  });

  const activate = useMutation({
    mutationFn: async () => (await apiClient.put(`/api/baselines/${id}/activate`)).data,
    onSuccess: () => {
      setMessage({ ok: true, text: 'Activated. It applies from the next collection of each device in this group; open drift events are re-evaluated then.' });
      queryClient.invalidateQueries({ queryKey: ['baseline', id] });
      queryClient.invalidateQueries({ queryKey: ['baselines'] });
    },
    onError: (err: any) => setMessage({ ok: false, text: err.response?.data?.detail || err.message }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/baselines" className="p-2 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">{baseline ? baseline.name : 'Baseline Rules'}</h2>
            {baseline && (
              <p className="text-sm text-slate-500">
                v{baseline.version} · {baseline.device_group_name} · {baseline.vendor} ·{' '}
                <span className={baseline.is_active ? 'text-emerald-600 font-semibold' : 'text-slate-500'}>
                  {baseline.is_active ? 'Active' : 'Inactive'}
                </span>
              </p>
            )}
          </div>
        </div>
        {baseline && !baseline.is_active && isAdmin && (
          <button
            type="button"
            onClick={() => activate.mutate()}
            disabled={activate.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>{activate.isPending ? 'Activating...' : 'Activate this version'}</span>
          </button>
        )}
        {baseline && !baseline.is_active && !isAdmin && (
          <span className="text-xs text-slate-500">Only an Admin can activate a baseline.</span>
        )}
      </div>

      {message && (
        <div className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${message.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
          {message.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}
      {isLoading && <p className="text-sm text-slate-500">Loading rules...</p>}
      {isError && <p className="text-sm text-rose-600">Baseline not found.</p>}

      {baseline && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h3 className="font-semibold text-slate-800 text-sm">Rules ({baseline.rules.length})</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Risk score = severity weight × zone weight. A hard-compliance rule can never be waived by a change ticket.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">Key Path</th>
                  <th className="py-3 px-4 font-semibold">Rule Type</th>
                  <th className="py-3 px-4 font-semibold">Expected Value</th>
                  <th className="py-3 px-4 font-semibold">Weight</th>
                  <th className="py-3 px-4 font-semibold">Hard Compliance</th>
                  <th className="py-3 px-4 font-semibold">Why it matters</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono text-xs">
                {baseline.rules.map((r) => (
                  <tr key={r.id}>
                    <td className="py-3 px-4 text-sky-600 font-medium">{r.key_path}</td>
                    <td className="py-3 px-4">{r.rule_type}</td>
                    <td className="py-3 px-4 max-w-[220px] truncate" title={r.expected_value}>{r.expected_value}</td>
                    <td className="py-3 px-4">{r.severity_weight}</td>
                    <td className="py-3 px-4">
                      {r.hard_compliance ? (
                        <span className="inline-flex items-center gap-1 text-rose-600 font-sans font-semibold">
                          <ShieldAlert className="h-3.5 w-3.5" /> YES
                        </span>
                      ) : (
                        <span className="font-sans text-slate-400">no</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-sans text-[11px] text-slate-500 max-w-[280px]">{r.description || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
