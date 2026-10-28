import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ticket as TicketIcon, Plus, X, AlertCircle } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuthStore';

interface ChangeTicket {
  id: string;
  ticket_ref: string;
  source: string;
  external_ref?: string | null;
  device_id?: string | null;
  device_group_id?: string | null;
  key_path_scope: string;
  valid_from: string;
  valid_to: string;
  status: string;
}

interface DeviceLite { id: string; hostname: string }
interface GroupLite { id: string; name: string }

const GRACE_MS = 30 * 60 * 1000;

// Backend timestamps are naive UTC; make them unambiguous before parsing
const parseUtc = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);

const windowState = (t: ChangeTicket): { label: string; style: string } => {
  if (t.status !== 'OPEN') return { label: 'Closed', style: 'bg-slate-100 text-slate-600 border-slate-200' };
  const now = Date.now();
  const from = parseUtc(t.valid_from).getTime();
  const to = parseUtc(t.valid_to).getTime();
  if (now < from - GRACE_MS) return { label: 'Upcoming', style: 'bg-sky-50 text-sky-700 border-sky-200' };
  if (now > to + GRACE_MS) return { label: 'Expired', style: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { label: 'In window', style: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
};

export const Tickets: React.FC = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const canCreate = user?.role === 'Admin' || user?.role === 'NetworkEngineer';
  const [statusFilter, setStatusFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ ticket_ref: '', scopeType: 'device', target: '', key_path_scope: '', from: '', to: '' });

  const { data: tickets = [], isLoading } = useQuery<ChangeTicket[]>({
    queryKey: ['tickets', statusFilter],
    queryFn: async () => (await apiClient.get('/api/tickets', { params: statusFilter ? { status: statusFilter } : {} })).data,
  });
  const { data: devices = [] } = useQuery<DeviceLite[]>({ queryKey: ['devices-lite'], queryFn: async () => (await apiClient.get('/api/devices')).data });
  const { data: groups = [] } = useQuery<GroupLite[]>({ queryKey: ['groups-lite'], queryFn: async () => (await apiClient.get('/api/devices/groups')).data });

  const deviceName = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, d.hostname])), [devices]);
  const groupName = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups]);

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        ticket_ref: form.ticket_ref.trim(),
        key_path_scope: form.key_path_scope.trim(),
        valid_from: new Date(form.from).toISOString(),
        valid_to: new Date(form.to).toISOString(),
        source: 'internal',
      };
      if (form.scopeType === 'device') body.device_id = form.target;
      else body.device_group_id = form.target;
      return (await apiClient.post('/api/tickets', body)).data;
    },
    onSuccess: () => {
      setOpen(false);
      setError(null);
      setForm({ ticket_ref: '', scopeType: 'device', target: '', key_path_scope: '', from: '', to: '' });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (err: any) => {
      const d = err.response?.data?.detail;
      setError(typeof d === 'string' ? d : Array.isArray(d) ? d.map((x: any) => x.msg).join('; ') : err.message);
    },
  });

  const formValid = form.ticket_ref.trim() && form.target && form.key_path_scope.trim() && form.from && form.to;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-sky-50 rounded-lg text-sky-600"><TicketIcon className="h-6 w-6" /></div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Change Tickets</h2>
            <p className="text-sm text-slate-500">
              Approved maintenance windows. A drift is <strong>authorized</strong> when a matching open ticket covers it at the time the
              configuration was captured (±30 min grace). Hard-compliance rules are never waived.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2 py-2 border border-slate-300 rounded-lg text-xs bg-white">
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
          {canCreate && (
            <button type="button" onClick={() => { setError(null); setOpen(true); }} className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium">
              <Plus className="h-4 w-4" /><span>New ticket</span>
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-600">
          <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] tracking-wider border-b border-slate-200">
            <tr>
              <th className="py-3 px-4 font-semibold">Ticket</th>
              <th className="py-3 px-4 font-semibold">Source</th>
              <th className="py-3 px-4 font-semibold">Applies to</th>
              <th className="py-3 px-4 font-semibold">Authorizes (key path)</th>
              <th className="py-3 px-4 font-semibold">Window (local time)</th>
              <th className="py-3 px-4 font-semibold">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={6} className="py-6 px-4 text-slate-400">Loading...</td></tr>}
            {!isLoading && tickets.length === 0 && <tr><td colSpan={6} className="py-8 px-4 text-center text-slate-400">No change tickets. Tickets arrive from ServiceNow/Jira via the webhook or can be created here.</td></tr>}
            {tickets.map((t) => {
              const st = windowState(t);
              return (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4"><div className="font-mono font-semibold text-slate-800">{t.ticket_ref}</div>{t.external_ref && t.external_ref !== t.ticket_ref && <div className="text-[11px] text-slate-400">ext: {t.external_ref}</div>}</td>
                  <td className="py-3 px-4"><span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">{t.source}</span></td>
                  <td className="py-3 px-4">{t.device_id ? <span className="font-mono">{deviceName[t.device_id] || t.device_id.slice(0, 8)}</span> : t.device_group_id ? <span>Group: {groupName[t.device_group_id] || '?'}</span> : <span className="text-slate-400">all devices</span>}</td>
                  <td className="py-3 px-4 font-mono text-sky-700">{t.key_path_scope}</td>
                  <td className="py-3 px-4 whitespace-nowrap">{parseUtc(t.valid_from).toLocaleString()} → {parseUtc(t.valid_to).toLocaleString()}</td>
                  <td className="py-3 px-4"><span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${st.style}`}>{st.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 space-y-4 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">New change ticket</h3>
              <button type="button" onClick={() => setOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <label className="block"><span className="font-semibold text-slate-700">Ticket reference</span>
              <input value={form.ticket_ref} onChange={(e) => setForm({ ...form, ticket_ref: e.target.value })} placeholder="CHG-2026-0142" className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
            <div className="grid grid-cols-3 gap-2">
              <label className="block"><span className="font-semibold text-slate-700">Applies to</span>
                <select value={form.scopeType} onChange={(e) => setForm({ ...form, scopeType: e.target.value, target: '' })} className="mt-1 w-full px-2 py-2 border border-slate-300 rounded-lg bg-white">
                  <option value="device">One device</option><option value="group">A device group</option></select></label>
              <label className="block col-span-2"><span className="font-semibold text-slate-700">{form.scopeType === 'device' ? 'Device' : 'Group'}</span>
                <select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} className="mt-1 w-full px-2 py-2 border border-slate-300 rounded-lg bg-white">
                  <option value="">Select...</option>
                  {(form.scopeType === 'device' ? devices.map((d) => ({ id: d.id, n: d.hostname })) : groups.map((g) => ({ id: g.id, n: g.name }))).map((o) => <option key={o.id} value={o.id}>{o.n}</option>)}
                </select></label>
            </div>
            <label className="block"><span className="font-semibold text-slate-700">Key path it authorizes</span>
              <input value={form.key_path_scope} onChange={(e) => setForm({ ...form, key_path_scope: e.target.value })} placeholder="ntp.server  or  interface.FastEthernet0/1" className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg font-mono" />
              <span className="text-[11px] text-slate-400">A prefix covers everything below it; * matches all.</span></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="font-semibold text-slate-700">Window start</span>
                <input type="datetime-local" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className="mt-1 w-full px-2 py-2 border border-slate-300 rounded-lg" /></label>
              <label className="block"><span className="font-semibold text-slate-700">Window end</span>
                <input type="datetime-local" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className="mt-1 w-full px-2 py-2 border border-slate-300 rounded-lg" /></label>
            </div>
            {error && <div className="p-3 rounded-lg border bg-rose-50 border-rose-200 text-rose-800 flex items-start gap-2"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><span>{error}</span></div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 font-medium">Cancel</button>
              <button type="button" onClick={() => create.mutate()} disabled={!formValid || create.isPending} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg font-medium">{create.isPending ? 'Saving...' : 'Create ticket'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
