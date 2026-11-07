import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { apiClient } from '../api/client';
import { errorText } from '../lib/errors';
import { useAuthStore } from '../store/useAuthStore';
import { fmtTime } from '../lib/format';
import { PageHeader, DataBoundary } from '../components/page/Page';
import { PixelPanel } from '../components/ui/pixel/PixelPanel';
import { PixelButton } from '../components/ui/pixel/PixelButton';
import { PixelBadge } from '../components/ui/pixel/PixelBadge';
import { PixelSelect } from '../components/ui/pixel/PixelSelect';
import { PixelModal } from '../components/ui/pixel/PixelModal';
import { PixelToast } from '../components/ui/pixel/PixelToast';
import { PixelTable, PixelThead, PixelTbody, PixelTr, PixelTh, PixelTd } from '../components/ui/pixel/PixelTable';

export interface BaselineItem {
  id: string;
  name: string;
  device_group_name?: string | null;
  vendor: string;
  version: number;
  is_active: boolean;
  created_at: string;
  rules_count?: number;
}
interface Group { id: string; name: string }

const EXAMPLE = `name: Campus switch standard
vendor: cisco_ios
rules:
  - key_path: line.vty.transport_input
    expected_value: ssh
    rule_type: EXACT
    severity_weight: 90
    hard_compliance: true
  - key_path: snmp.community.public.exists
    expected_value: "false"
    rule_type: MUST_NOT_EXIST
    severity_weight: 80
    hard_compliance: false`;

/** Baselines: the approved settings every device is compared with. One version per zone and type is active. */
export const Baselines: React.FC = () => {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canCreate = user?.role === 'Admin' || user?.role === 'NetworkEngineer';
  const isAdmin = user?.role === 'Admin';
  const q = useQuery<BaselineItem[]>({ queryKey: ['baselines'], queryFn: async () => (await apiClient.get('/api/baselines')).data });
  const groups = useQuery<Group[]>({ queryKey: ['deviceGroups'], queryFn: async () => (await apiClient.get('/api/devices/groups')).data, enabled: canCreate });

  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const activate = useMutation({
    mutationFn: async (b: BaselineItem) => (await apiClient.put(`/api/baselines/${b.id}/activate`)).data,
    onSuccess: (_d, b) => { qc.invalidateQueries({ queryKey: ['baselines'] }); setNotice({ kind: 'success', text: `${b.name} version ${b.version} is now active.` }); },
    onError: (err) => setNotice({ kind: 'error', text: errorText(err, 'The baseline could not be activated.') }),
  });

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ device_group_id: '', yaml_content: EXAMPLE });
  const [formError, setFormError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async () => (await apiClient.post('/api/baselines', { device_group_id: form.device_group_id || undefined, yaml_content: form.yaml_content })).data,
    onSuccess: (b) => { setCreating(false); qc.invalidateQueries({ queryKey: ['baselines'] }); setNotice({ kind: 'success', text: `Baseline ${b?.name ?? ''} version ${b?.version ?? ''} was created. Activate it to start using it.` }); },
    onError: (err) => setFormError(errorText(err, 'The baseline could not be created.')),
  });

  const rows = [...(q.data ?? [])].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name) || b.version - a.version);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Baselines"
        description="The approved settings each device is compared with."
        actions={canCreate && <PixelButton onClick={() => { setForm({ device_group_id: groups.data?.[0]?.id ?? '', yaml_content: EXAMPLE }); setFormError(null); setCreating(true); }} icon={<Plus size={16} />}>New baseline</PixelButton>}
      />
      {notice && <PixelToast kind={notice.kind} title={notice.text} onClose={() => setNotice(null)} />}
      <PixelPanel fill="paper" bodyClassName="p-4">
        <DataBoundary what="baselines" isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()} isEmpty={rows.length === 0} emptyTitle="No baselines yet" emptyText={canCreate ? 'Create the first baseline from a short YAML file.' : 'An engineer can create the first baseline.'}>
          <PixelTable caption="Baselines">
            <PixelThead><tr><PixelTh>Name</PixelTh><PixelTh>Zone</PixelTh><PixelTh>Type</PixelTh><PixelTh>Version</PixelTh><PixelTh>Status</PixelTh><PixelTh>Rules</PixelTh><PixelTh>Created</PixelTh><PixelTh><span className="sr-only">Actions</span></PixelTh></tr></PixelThead>
            <PixelTbody>
              {rows.map((b) => (
                <PixelTr key={b.id}>
                  <PixelTd><Link to={`/baselines/${b.id}`} className="pxl-focus font-semibold text-blue-700 hover:underline">{b.name}</Link></PixelTd>
                  <PixelTd>{b.device_group_name ?? '—'}</PixelTd>
                  <PixelTd>{b.vendor}</PixelTd>
                  <PixelTd>v{b.version}</PixelTd>
                  <PixelTd>{b.is_active ? <PixelBadge tone="green" size="sm">Active</PixelBadge> : <PixelBadge tone="gray" size="sm">Not active</PixelBadge>}</PixelTd>
                  <PixelTd>{b.rules_count ?? '—'}</PixelTd>
                  <PixelTd className="whitespace-nowrap">{fmtTime(b.created_at)}</PixelTd>
                  <PixelTd>{isAdmin && !b.is_active && <PixelButton variant="ghost" size="sm" onClick={() => activate.mutate(b)} disabled={activate.isPending}>Activate</PixelButton>}</PixelTd>
                </PixelTr>
              ))}
            </PixelTbody>
          </PixelTable>
        </DataBoundary>
      </PixelPanel>

      <PixelModal open={creating} onClose={() => setCreating(false)} title="New baseline" size="lg">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setFormError(null); create.mutate(); }}>
          <PixelSelect label="Zone" value={form.device_group_id} onChange={(e) => setForm({ ...form, device_group_id: e.target.value })}>
            <option value="">Use the zone named in the file</option>
            {(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </PixelSelect>
          <div>
            <label htmlFor="baseline-yaml" className="mb-1 block text-[14px] font-medium">Rules (YAML)</label>
            <textarea id="baseline-yaml" rows={14} spellCheck={false} value={form.yaml_content} onChange={(e) => setForm({ ...form, yaml_content: e.target.value })} className="pxl-field pxl-focus pxl-mono" />
            <p className="m-0 mt-1 text-[13px] text-slate-600">Each rule names a setting, the expected value, how to compare, how serious a difference is (1–100) and whether it is a hard compliance rule.</p>
          </div>
          {formError && <p role="alert" className="m-0 text-[14px] font-medium text-red-700">{formError}</p>}
          <div className="flex justify-end gap-3 border-t border-slate-200 pt-3">
            <PixelButton variant="ghost" onClick={() => setCreating(false)}>Cancel</PixelButton>
            <PixelButton type="submit" loading={create.isPending}>Create baseline</PixelButton>
          </div>
        </form>
      </PixelModal>
    </div>
  );
};
