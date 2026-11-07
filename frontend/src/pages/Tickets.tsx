import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { apiClient } from '../api/client';
import { errorText } from '../lib/errors';
import { useAuthStore } from '../store/useAuthStore';
import { fmtTime, humanize } from '../lib/format';
import { PageHeader, DataBoundary, FilterToggle } from '../components/page/Page';
import { paginate } from '../lib/format';
import { PixelPanel } from '../components/ui/pixel/PixelPanel';
import { PixelButton } from '../components/ui/pixel/PixelButton';
import { PixelBadge } from '../components/ui/pixel/PixelBadge';
import { PixelInput } from '../components/ui/pixel/PixelInput';
import { PixelSelect } from '../components/ui/pixel/PixelSelect';
import { PixelModal } from '../components/ui/pixel/PixelModal';
import { PixelToast } from '../components/ui/pixel/PixelToast';
import { PixelPagination } from '../components/ui/pixel/PixelPagination';
import { PixelTable, PixelThead, PixelTbody, PixelTr, PixelTh, PixelTd } from '../components/ui/pixel/PixelTable';

export interface TicketItem {
  id: string;
  ticket_ref: string;
  source?: string | null;
  device_id?: string | null;
  device_group_id?: string | null;
  key_path_scope: string;
  valid_from: string;
  valid_to: string;
  status: string;
}
interface Dev { id: string; hostname: string; device_group?: { id: string; name: string } | null }

const PAGE_SIZE = 10;
const blank = { ticket_ref: '', source: 'MANUAL', device_id: '', key_path_scope: '*', valid_from: '', valid_to: '' };

/** Change tickets: planned work. A change made inside a ticket's window is "authorized", the rest is a problem. */
export const Tickets: React.FC = () => {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canCreate = user?.role === 'Admin' || user?.role === 'NetworkEngineer';
  const q = useQuery<TicketItem[]>({ queryKey: ['tickets'], queryFn: async () => (await apiClient.get('/api/tickets')).data });
  const devices = useQuery<Dev[]>({ queryKey: ['devices'], queryFn: async () => (await apiClient.get('/api/devices')).data });

  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const host = (t: TicketItem) => devices.data?.find((d) => d.id === t.device_id)?.hostname;
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...(q.data ?? [])]
      .filter((t) => (!source || (t.source ?? '') === source) && (!status || t.status === status))
      .filter((t) => !needle || `${t.ticket_ref} ${host(t) ?? ''} ${t.key_path_scope}`.toLowerCase().includes(needle))
      .sort((a, b) => +new Date(b.valid_from) - +new Date(a.valid_from));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, devices.data, search, source, status]);
  const statuses = Array.from(new Set((q.data ?? []).map((t) => t.status))).sort();
  const sources = Array.from(new Set((q.data ?? []).map((t) => t.source ?? '').filter(Boolean))).sort();

  const create = useMutation({
    mutationFn: async () => (await apiClient.post('/api/tickets', {
      ticket_ref: form.ticket_ref.trim(),
      source: form.source,
      device_id: form.device_id || undefined,
      key_path_scope: form.key_path_scope.trim() || '*',
      valid_from: new Date(form.valid_from).toISOString(),
      valid_to: new Date(form.valid_to).toISOString(),
    })).data,
    onSuccess: () => { setCreating(false); qc.invalidateQueries({ queryKey: ['tickets'] }); setNotice(`Ticket ${form.ticket_ref} was created.`); },
    onError: (err) => setFormError(errorText(err, 'The ticket could not be created.')),
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (new Date(form.valid_to) <= new Date(form.valid_from)) { setFormError('The end of the window must be after its start.'); return; }
    create.mutate();
  };
  const reset = (fn: () => void) => { fn(); setPage(1); };

  return (
    <div className="space-y-5">
      <PageHeader title="Change tickets" description="Planned work. Changes made inside a ticket's window are treated as authorized." actions={canCreate && <PixelButton icon={<Plus size={16} />} onClick={() => { setForm(blank); setFormError(null); setCreating(true); }}>New Ticket</PixelButton>} />
      {notice && <PixelToast kind="success" title={notice} onClose={() => setNotice(null)} />}
      <PixelPanel fill="paper" bodyClassName="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <PixelInput wrapperClassName="min-w-[240px] flex-1" aria-label="Search tickets" icon={<Search size={18} />} placeholder="Search by ticket or device" value={search} onChange={(e) => reset(() => setSearch(e.target.value))} />
          <FilterToggle open={filtersOpen} onToggle={() => setFiltersOpen((v) => !v)} active={(source ? 1 : 0) + (status ? 1 : 0)} />
        </div>
        {filtersOpen && (
          <div className="grid gap-3 sm:grid-cols-2">
            <PixelSelect label="Source" value={source} onChange={(e) => reset(() => setSource(e.target.value))}><option value="">All sources</option>{sources.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</PixelSelect>
            <PixelSelect label="Status" value={status} onChange={(e) => reset(() => setStatus(e.target.value))}><option value="">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</PixelSelect>
          </div>
        )}
        <DataBoundary what="tickets" isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()} isEmpty={rows.length === 0} emptyTitle={(q.data ?? []).length === 0 ? 'No tickets yet' : 'No tickets match'} emptyText={(q.data ?? []).length === 0 ? 'Tickets arrive from ServiceNow or Jira, or can be added here.' : 'Change the search or the filters.'}>
          <PixelTable caption="Change tickets">
            <PixelThead><tr><PixelTh>Ticket</PixelTh><PixelTh>Source</PixelTh><PixelTh>Applies to</PixelTh><PixelTh>Window</PixelTh><PixelTh>Status</PixelTh></tr></PixelThead>
            <PixelTbody>
              {paginate(rows, page, PAGE_SIZE).map((t) => (
                <PixelTr key={t.id}>
                  <PixelTd className="pxl-mono font-semibold">{t.ticket_ref}</PixelTd>
                  <PixelTd>{t.source ? humanize(t.source) : '—'}</PixelTd>
                  <PixelTd>{host(t) ?? (t.device_id ? 'One device' : 'All devices in scope')}<span className="pxl-mono block text-[13px] text-slate-600">{t.key_path_scope}</span></PixelTd>
                  <PixelTd className="whitespace-nowrap">{fmtTime(t.valid_from)}<span className="block text-[13px] text-slate-600">to {fmtTime(t.valid_to)}</span></PixelTd>
                  <PixelTd><PixelBadge tone={t.status === 'OPEN' || t.status === 'ACTIVE' ? 'green' : 'gray'} size="sm">{humanize(t.status)}</PixelBadge></PixelTd>
                </PixelTr>
              ))}
            </PixelTbody>
          </PixelTable>
          <PixelPagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} noun="tickets" />
        </DataBoundary>
      </PixelPanel>

      <PixelModal open={creating} onClose={() => setCreating(false)} title="New change ticket" size="md">
        <form className="space-y-4" onSubmit={submit}>
          <PixelInput label="Ticket reference" required value={form.ticket_ref} onChange={(e) => setForm({ ...form, ticket_ref: e.target.value })} placeholder="CHG-10584" />
          <div className="grid gap-3 sm:grid-cols-2">
            <PixelSelect label="Source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}><option value="MANUAL">Manual</option><option value="SERVICENOW">ServiceNow</option><option value="JIRA">Jira</option></PixelSelect>
            <PixelSelect label="Device" value={form.device_id} onChange={(e) => setForm({ ...form, device_id: e.target.value })}><option value="">Any device</option>{(devices.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.hostname}</option>)}</PixelSelect>
          </div>
          <PixelInput label="Settings covered" value={form.key_path_scope} onChange={(e) => setForm({ ...form, key_path_scope: e.target.value })} hint="A setting path, or * for everything." />
          <div className="grid gap-3 sm:grid-cols-2">
            <PixelInput label="Window starts" type="datetime-local" required value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
            <PixelInput label="Window ends" type="datetime-local" required value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} />
          </div>
          {formError && <p role="alert" className="m-0 text-[14px] font-medium text-red-700">{formError}</p>}
          <div className="flex justify-end gap-3 border-t border-slate-200 pt-3">
            <PixelButton variant="ghost" onClick={() => setCreating(false)}>Cancel</PixelButton>
            <PixelButton type="submit" loading={create.isPending}>Create ticket</PixelButton>
          </div>
        </form>
      </PixelModal>
    </div>
  );
};
