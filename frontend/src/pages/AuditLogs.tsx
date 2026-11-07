import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import { apiClient } from '../api/client';
import { fmtTime, humanize, triggerDownload } from '../lib/format';
import { PageHeader, DataBoundary, FilterToggle } from '../components/page/Page';
import { paginate } from '../lib/format';
import { PixelPanel } from '../components/ui/pixel/PixelPanel';
import { PixelButton } from '../components/ui/pixel/PixelButton';
import { PixelInput } from '../components/ui/pixel/PixelInput';
import { PixelSelect } from '../components/ui/pixel/PixelSelect';
import { PixelPagination } from '../components/ui/pixel/PixelPagination';
import { PixelTable, PixelThead, PixelTbody, PixelTr, PixelTh, PixelTd } from '../components/ui/pixel/PixelTable';

interface AuditItem {
  id: string;
  username?: string | null;
  action: string;
  target_type: string;
  target_id?: string | null;
  before_state?: unknown;
  after_state?: unknown;
  timestamp: string;
}

const PAGE_SIZE = 15;

/** Audit trail: who did what and when. Entries cannot be edited or deleted. */
export const AuditLogs: React.FC = () => {
  const q = useQuery<AuditItem[]>({ queryKey: ['audit'], queryFn: async () => (await apiClient.get('/api/audit?limit=500')).data });
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [user, setUser] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const actions = useMemo(() => Array.from(new Set((q.data ?? []).map((a) => a.action))).sort(), [q.data]);
  const users = useMemo(() => Array.from(new Set((q.data ?? []).map((a) => a.username).filter(Boolean) as string[])).sort(), [q.data]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (q.data ?? [])
      .filter((a) => (!action || a.action === action) && (!user || a.username === user))
      .filter((a) => !needle || `${a.username ?? 'system'} ${a.action} ${a.target_type} ${a.target_id ?? ''}`.toLowerCase().includes(needle));
  }, [q.data, search, action, user]);

  const reset = (fn: () => void) => { fn(); setPage(1); };
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    triggerDownload('audit-trail.csv', ['time,user,action,target_type,target_id', ...rows.map((a) => [a.timestamp, a.username ?? 'system', a.action, a.target_type, a.target_id].map(esc).join(','))].join('\n'), 'text/csv;charset=utf-8');
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Audit trail" description="Every sign-in failure, approval, change and rollback. Entries cannot be edited or deleted." actions={<PixelButton variant="ghost" icon={<Download size={16} />} onClick={exportCsv} disabled={rows.length === 0}>Export CSV</PixelButton>} />
      <PixelPanel fill="paper" bodyClassName="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <PixelInput wrapperClassName="min-w-[240px] flex-1" aria-label="Search the audit trail" icon={<Search size={18} />} placeholder="Search by user, action or target" value={search} onChange={(e) => reset(() => setSearch(e.target.value))} />
          <FilterToggle open={filtersOpen} onToggle={() => setFiltersOpen((v) => !v)} active={(action ? 1 : 0) + (user ? 1 : 0)} />
        </div>
        {filtersOpen && (
          <div className="grid gap-3 sm:grid-cols-2">
            <PixelSelect label="Action" value={action} onChange={(e) => reset(() => setAction(e.target.value))}><option value="">All actions</option>{actions.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}</PixelSelect>
            <PixelSelect label="User" value={user} onChange={(e) => reset(() => setUser(e.target.value))}><option value="">Everyone</option>{users.map((u) => <option key={u} value={u}>{u}</option>)}</PixelSelect>
          </div>
        )}
        <DataBoundary what="the audit trail" isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()} isEmpty={rows.length === 0} emptyTitle={(q.data ?? []).length === 0 ? 'The audit trail is empty' : 'No entries match'}>
          <PixelTable caption="Audit trail">
            <PixelThead><tr><PixelTh>When</PixelTh><PixelTh>User</PixelTh><PixelTh>Action</PixelTh><PixelTh>Target</PixelTh><PixelTh><span className="sr-only">Details</span></PixelTh></tr></PixelThead>
            <PixelTbody>
              {paginate(rows, page, PAGE_SIZE).map((a) => (
                <React.Fragment key={a.id}>
                  <PixelTr>
                    <PixelTd className="whitespace-nowrap">{fmtTime(a.timestamp)}</PixelTd>
                    <PixelTd>{a.username ?? 'system'}</PixelTd>
                    <PixelTd className="font-semibold">{humanize(a.action)}</PixelTd>
                    <PixelTd>{a.target_type}</PixelTd>
                    <PixelTd><button type="button" aria-expanded={openId === a.id} onClick={() => setOpenId(openId === a.id ? null : a.id)} className="pxl-focus font-semibold text-blue-700 hover:underline">{openId === a.id ? 'Hide' : 'Details'}</button></PixelTd>
                  </PixelTr>
                  {openId === a.id && (
                    <tr><td colSpan={5} className="bg-slate-50 px-3 py-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div><h3 className="m-0 mb-1 text-[13px] font-semibold text-slate-600">Before</h3><pre className="pxl-mono m-0 overflow-x-auto rounded border border-slate-200 bg-white p-2 text-[13px]">{a.before_state ? JSON.stringify(a.before_state, null, 2) : '—'}</pre></div>
                        <div><h3 className="m-0 mb-1 text-[13px] font-semibold text-slate-600">After</h3><pre className="pxl-mono m-0 overflow-x-auto rounded border border-slate-200 bg-white p-2 text-[13px]">{a.after_state ? JSON.stringify(a.after_state, null, 2) : '—'}</pre></div>
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </PixelTbody>
          </PixelTable>
          <PixelPagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} noun="entries" />
        </DataBoundary>
      </PixelPanel>
    </div>
  );
};
