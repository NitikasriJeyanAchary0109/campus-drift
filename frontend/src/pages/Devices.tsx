import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Play, Search } from 'lucide-react';
import { apiClient } from '../api/client';
import { errorText } from '../lib/errors';
import { useAuthStore } from '../store/useAuthStore';
import { useSweep } from '../lib/useSweep';
import { fmtTime } from '../lib/format';
import { PageHeader, DataBoundary, FilterToggle } from '../components/page/Page';
import { paginate } from '../lib/format';
import { PixelPanel } from '../components/ui/pixel/PixelPanel';
import { PixelButton } from '../components/ui/pixel/PixelButton';
import { PixelInput } from '../components/ui/pixel/PixelInput';
import { PixelSelect } from '../components/ui/pixel/PixelSelect';
import { PixelBadge } from '../components/ui/pixel/PixelBadge';
import { PixelModal } from '../components/ui/pixel/PixelModal';
import { PixelToast } from '../components/ui/pixel/PixelToast';
import { PixelPagination } from '../components/ui/pixel/PixelPagination';
import { DeviceIcon } from '../components/ui/pixel/DeviceIcon';
import { PixelTable, PixelThead, PixelTbody, PixelTr, PixelTh, PixelTd } from '../components/ui/pixel/PixelTable';

export interface DeviceItem {
  id: string;
  hostname: string;
  ip_address: string;
  vendor: string;
  model: string;
  status: string;
  last_polled_at?: string | null;
  device_group?: { id: string; name: string } | null;
  collection_mode?: string;
  shadow_mode?: boolean;
}
interface GroupItem { id: string; name: string }
interface OpenEvent { id: string; device_id: string; label: string }

const PAGE_SIZE = 10;
// Same rule as the dashboard summary on the server: a ticket-covered change still differs from the approved baseline, so it counts as drifted.
const CLEAN = ['Compliant'];

type Compliance = 'drifted' | 'compliant' | 'unchecked';
const complianceOf = (d: DeviceItem, open: OpenEvent[]): { state: Compliance; count: number } => {
  const n = open.filter((e) => e.device_id === d.id && !CLEAN.includes(e.label)).length;
  if (n > 0) return { state: 'drifted', count: n };
  return { state: d.last_polled_at ? 'compliant' : 'unchecked', count: 0 };
};
const isUnreachable = (d: DeviceItem) => ['UNREACHABLE', 'OFFLINE', 'DOWN'].includes((d.status || '').toUpperCase());
const deviceKind = (d: DeviceItem) => `${d.vendor} ${d.model}`.toLowerCase().includes('router') ? 'router' : 'switch';

/** Devices: what is on the network, whether it matches its baseline, and the two actions people need (collect now, add a device). */
export const Devices: React.FC = () => {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canPoll = user?.role === 'Admin' || user?.role === 'NetworkEngineer';
  const isAdmin = user?.role === 'Admin';

  const devicesQ = useQuery<DeviceItem[]>({ queryKey: ['devices'], queryFn: async () => (await apiClient.get('/api/devices')).data });
  const openQ = useQuery<OpenEvent[]>({ queryKey: ['driftOpen'], queryFn: async () => (await apiClient.get('/api/drift?status=OPEN')).data, retry: false });
  const groupsQ = useQuery<GroupItem[]>({ queryKey: ['deviceGroups'], queryFn: async () => (await apiClient.get('/api/devices/groups')).data, enabled: isAdmin });
  const open = useMemo(() => openQ.data ?? [], [openQ.data]);

  const [search, setSearch] = useState('');
  const [zone, setZone] = useState('');
  const [state, setState] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const zones = useMemo(() => Array.from(new Set((devicesQ.data ?? []).map((d) => d.device_group?.name).filter(Boolean) as string[])).sort(), [devicesQ.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (devicesQ.data ?? []).filter((d) => {
      if (needle && !`${d.hostname} ${d.ip_address} ${d.model} ${d.device_group?.name ?? ''}`.toLowerCase().includes(needle)) return false;
      if (zone && d.device_group?.name !== zone) return false;
      if (state === 'unreachable') return isUnreachable(d);
      if (state) return !isUnreachable(d) && complianceOf(d, open).state === state;
      return true;
    });
  }, [devicesQ.data, open, search, zone, state]);

  const counts = useMemo(() => {
    const all = devicesQ.data ?? [];
    return {
      total: all.length,
      unreachable: all.filter(isUnreachable).length,
      drifted: all.filter((d) => !isUnreachable(d) && complianceOf(d, open).state === 'drifted').length,
      compliant: all.filter((d) => !isUnreachable(d) && complianceOf(d, open).state === 'compliant').length,
    };
  }, [devicesQ.data, open]);

  const sweep = useSweep();
  const poll = useMutation({
    mutationFn: async (d: DeviceItem) => (await apiClient.post(`/api/devices/${d.id}/poll`)).data,
    onSuccess: (r, d) => { setNotice({ kind: 'success', text: r?.message || `Collection started on ${d.hostname}.` }); qc.invalidateQueries({ queryKey: ['devices'] }); },
    onError: (err, d) => setNotice({ kind: 'error', text: `${d.hostname}: ${errorText(err, 'collection could not be started')}` }),
  });

  // add device
  const [adding, setAdding] = useState(false);
  const blank = { hostname: '', ip_address: '', vendor: 'cisco_ios', model: '', device_group_id: '' };
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: async () => (await apiClient.post('/api/devices', form)).data,
    onSuccess: () => { setAdding(false); qc.invalidateQueries({ queryKey: ['devices'] }); setNotice({ kind: 'success', text: `${form.hostname} was added.` }); },
    onError: (err) => setFormError(errorText(err, 'The device could not be added.')),
  });
  const openAdd = () => { setForm({ ...blank, device_group_id: groupsQ.data?.[0]?.id ?? '' }); setFormError(null); setAdding(true); };

  const reset = (fn: () => void) => { fn(); setPage(1); };
  const runSweep = async () => { const r = await sweep.run(); setNotice({ kind: r.failed ? 'error' : 'success', text: r.message }); };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Devices"
        description={devicesQ.data ? `${counts.total} devices: ${counts.compliant} compliant, ${counts.drifted} drifted, ${counts.unreachable} unreachable.` : 'Everything on the campus network.'}
        actions={
          <>
            {canPoll && <PixelButton variant="ghost" onClick={runSweep} loading={sweep.running} icon={<Play size={16} />}>Start Campus Sweep</PixelButton>}
            {isAdmin && <PixelButton onClick={openAdd} icon={<Plus size={16} />}>Add device</PixelButton>}
          </>
        }
      />

      {notice && <PixelToast kind={notice.kind} title={notice.text} onClose={() => setNotice(null)} />}

      <PixelPanel fill="paper" bodyClassName="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <PixelInput wrapperClassName="min-w-[240px] flex-1" aria-label="Search devices" icon={<Search size={18} />} placeholder="Search by name, IP address or zone" value={search} onChange={(e) => reset(() => setSearch(e.target.value))} />
          <FilterToggle open={filtersOpen} onToggle={() => setFiltersOpen((v) => !v)} active={(zone ? 1 : 0) + (state ? 1 : 0)} />
        </div>
        {filtersOpen && (
          <div className="grid gap-3 sm:grid-cols-2">
            <PixelSelect label="Zone" value={zone} onChange={(e) => reset(() => setZone(e.target.value))}>
              <option value="">All zones</option>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </PixelSelect>
            <PixelSelect label="Status" value={state} onChange={(e) => reset(() => setState(e.target.value))}>
              <option value="">All</option>
              <option value="drifted">Drifted</option>
              <option value="compliant">Compliant</option>
              <option value="unchecked">Not checked yet</option>
              <option value="unreachable">Unreachable</option>
            </PixelSelect>
          </div>
        )}

        <DataBoundary what="devices" isLoading={devicesQ.isLoading} error={devicesQ.error} onRetry={() => devicesQ.refetch()} isEmpty={rows.length === 0} emptyTitle={(devicesQ.data ?? []).length === 0 ? 'No devices yet' : 'No devices match'} emptyText={(devicesQ.data ?? []).length === 0 ? (isAdmin ? 'Add the first device to start monitoring.' : 'An administrator can add devices.') : 'Change the search or the filters.'}>
          <PixelTable caption="Devices">
            <PixelThead>
              <tr><PixelTh>Device</PixelTh><PixelTh>IP address</PixelTh><PixelTh>Zone</PixelTh><PixelTh>Status</PixelTh><PixelTh>Last collected</PixelTh><PixelTh><span className="sr-only">Actions</span></PixelTh></tr>
            </PixelThead>
            <PixelTbody>
              {paginate(rows, page, PAGE_SIZE).map((d) => {
                const c = complianceOf(d, open);
                return (
                  <PixelTr key={d.id}>
                    <PixelTd>
                      <Link to={`/devices/${d.id}`} className="pxl-focus inline-flex items-center gap-2 font-semibold text-blue-700 hover:underline">
                        <DeviceIcon type={deviceKind(d)} scale={1.5} />
                        <span className="pxl-mono">{d.hostname}</span>
                      </Link>
                    </PixelTd>
                    <PixelTd className="pxl-mono">{d.ip_address}</PixelTd>
                    <PixelTd>{d.device_group?.name ?? '—'}</PixelTd>
                    <PixelTd>
                      {isUnreachable(d) ? <PixelBadge tone="red" size="sm">Unreachable</PixelBadge>
                        : c.state === 'drifted' ? <PixelBadge tone="orange" size="sm">{`Drifted (${c.count})`}</PixelBadge>
                        : c.state === 'compliant' ? <PixelBadge tone="green" size="sm">Compliant</PixelBadge>
                        : <PixelBadge tone="gray" size="sm">Not checked yet</PixelBadge>}
                    </PixelTd>
                    <PixelTd className="whitespace-nowrap">{d.last_polled_at ? fmtTime(d.last_polled_at) : 'Never'}</PixelTd>
                    <PixelTd>
                      {canPoll && (d.collection_mode ?? 'SSH_POLL') === 'SSH_POLL' && (
                        <PixelButton variant="ghost" size="sm" onClick={() => poll.mutate(d)} disabled={poll.isPending && poll.variables?.id === d.id} aria-label={`Collect ${d.hostname} now`}>Collect now</PixelButton>
                      )}
                    </PixelTd>
                  </PixelTr>
                );
              })}
            </PixelTbody>
          </PixelTable>
          <PixelPagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} noun="devices" />
        </DataBoundary>
      </PixelPanel>

      <PixelModal open={adding} onClose={() => setAdding(false)} title="Add device" size="sm">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setFormError(null); add.mutate(); }}>
          <PixelInput label="Hostname" required value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} placeholder="sw-lab-04" />
          <PixelInput label="IP address" required value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} placeholder="10.10.1.4" />
          <PixelSelect label="Type" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })}>
            <option value="cisco_ios">Cisco IOS</option>
            <option value="frr">FRRouting</option>
          </PixelSelect>
          <PixelInput label="Model" required value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="Catalyst 2960X" />
          <PixelSelect label="Zone" required value={form.device_group_id} onChange={(e) => setForm({ ...form, device_group_id: e.target.value })}>
            <option value="" disabled>Choose a zone</option>
            {(groupsQ.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </PixelSelect>
          {formError && <p role="alert" className="m-0 text-[14px] font-medium text-red-700">{formError}</p>}
          <div className="flex justify-end gap-3 border-t border-slate-200 pt-3">
            <PixelButton variant="ghost" onClick={() => setAdding(false)}>Cancel</PixelButton>
            <PixelButton type="submit" loading={add.isPending} disabled={!form.device_group_id}>Add device</PixelButton>
          </div>
        </form>
      </PixelModal>
    </div>
  );
};
