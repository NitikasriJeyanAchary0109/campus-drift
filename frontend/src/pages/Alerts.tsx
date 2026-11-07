import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { apiClient } from '../api/client';
import { errorText } from '../lib/errors';
import { useAuthStore } from '../store/useAuthStore';
import { useAlerts, alertTarget } from '../lib/useAlerts';
import { alertSeverity, fmtTime, humanize, SEVERITY_LABEL } from '../lib/format';
import { PageHeader, DataBoundary } from '../components/page/Page';
import { paginate } from '../lib/format';
import { PixelPanel } from '../components/ui/pixel/PixelPanel';
import { PixelButton } from '../components/ui/pixel/PixelButton';
import { PixelBadge } from '../components/ui/pixel/PixelBadge';
import { PixelSelect } from '../components/ui/pixel/PixelSelect';
import { PixelToast } from '../components/ui/pixel/PixelToast';
import { PixelPagination } from '../components/ui/pixel/PixelPagination';
import { PixelTable, PixelThead, PixelTbody, PixelTr, PixelTh, PixelTd } from '../components/ui/pixel/PixelTable';

const PAGE_SIZE = 15;

/** Alerts: what the system has raised, those that still need someone first. */
export const Alerts: React.FC = () => {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canAck = user?.role === 'Admin' || user?.role === 'NetworkEngineer';
  const q = useAlerts();
  const [show, setShow] = useState<'all' | 'open' | 'done'>('all');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      [...(q.data ?? [])]
        .filter((a) => (show === 'open' ? !a.acknowledged : show === 'done' ? a.acknowledged : true))
        .sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged) || +new Date(b.created_at) - +new Date(a.created_at)),
    [q.data, show],
  );
  const openCount = (q.data ?? []).filter((a) => !a.acknowledged).length;

  const ack = useMutation({
    mutationFn: async (id: string) => (await apiClient.post(`/api/alerts/${id}/ack`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alerts'] }); qc.invalidateQueries({ queryKey: ['dashboardSummary'] }); },
    onError: (err) => setNotice(errorText(err, 'The alert could not be acknowledged.')),
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Alerts" description={q.data ? `${openCount} of ${q.data.length} alerts still need attention.` : 'What the system has raised.'} />
      {notice && <PixelToast kind="error" title={notice} onClose={() => setNotice(null)} />}
      <PixelPanel fill="paper" bodyClassName="space-y-4 p-4">
        <PixelSelect label="Show" wrapperClassName="max-w-xs" value={show} onChange={(e) => { setShow(e.target.value as typeof show); setPage(1); }}>
          <option value="all">All alerts</option>
          <option value="open">Needs attention</option>
          <option value="done">Acknowledged</option>
        </PixelSelect>
        <DataBoundary what="alerts" isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()} isEmpty={rows.length === 0} emptyTitle={(q.data ?? []).length === 0 ? 'No alerts' : 'No alerts match'} emptyText={(q.data ?? []).length === 0 ? 'Nothing has been raised.' : 'Try another view.'}>
          <PixelTable caption="Alerts">
            <PixelThead><tr><PixelTh>When</PixelTh><PixelTh>Severity</PixelTh><PixelTh>What happened</PixelTh><PixelTh><span className="sr-only">Actions</span></PixelTh></tr></PixelThead>
            <PixelTbody>
              {paginate(rows, page, PAGE_SIZE).map((a) => {
                const sev = alertSeverity(a.type);
                const target = alertTarget(a);
                return (
                  <PixelTr key={a.id} className={a.acknowledged ? 'opacity-70' : ''}>
                    <PixelTd className="whitespace-nowrap">{fmtTime(a.created_at)}</PixelTd>
                    <PixelTd><PixelBadge taxonomy={SEVERITY_LABEL[sev]} size="sm" title={sev} /></PixelTd>
                    <PixelTd><span className="block font-semibold">{humanize(a.type)}</span><span className="block text-slate-700">{a.message}</span></PixelTd>
                    <PixelTd>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {target && <Link to={target} className="pxl-focus font-semibold text-blue-700 hover:underline">Investigate</Link>}
                        {a.acknowledged ? <span className="text-[13px] text-slate-600">Acknowledged</span>
                          : canAck && <PixelButton variant="ghost" size="sm" icon={<Check size={14} />} onClick={() => ack.mutate(a.id)} disabled={ack.isPending && ack.variables === a.id}>Acknowledge</PixelButton>}
                      </div>
                    </PixelTd>
                  </PixelTr>
                );
              })}
            </PixelTbody>
          </PixelTable>
          <PixelPagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} noun="alerts" />
        </DataBoundary>
      </PixelPanel>
    </div>
  );
};
