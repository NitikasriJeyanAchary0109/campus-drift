import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { apiClient } from '../api/client';
import { fmtTime } from '../lib/format';
import { PageHeader } from '../components/page/Page';
import { PixelPanel } from '../components/ui/pixel/PixelPanel';
import { PixelRibbon } from '../components/ui/pixel/PixelRibbon';
import { PixelButton } from '../components/ui/pixel/PixelButton';
import { PixelBadge } from '../components/ui/pixel/PixelBadge';
import { PixelTable, PixelThead, PixelTbody, PixelTr, PixelTh, PixelTd } from '../components/ui/pixel/PixelTable';

interface Health { status: string; project: string; version: string; timestamp: string; database: string; redis?: string; environment: string }

const ok = (v?: string) => !!v && !v.startsWith('unavailable');

/** Settings: what the running system reports about itself. Nothing here is a setting you can change. */
export const Settings: React.FC = () => {
  const q = useQuery<Health>({ queryKey: ['health'], queryFn: async () => (await apiClient.get('/api/health')).data, retry: false, refetchInterval: 30000 });
  const h = q.data;
  const checks: [string, string | undefined][] = [['API', h ? 'connected' : undefined], ['Database', h?.database], ['Redis (job queue)', h?.redis]];

  return (
    <div className="space-y-5">
      <PageHeader
        title="System status"
        description="What the running system reports about itself."
        actions={<PixelButton variant="ghost" icon={<RefreshCw size={16} />} onClick={() => q.refetch()} loading={q.isFetching}>Check again</PixelButton>}
      />
      <PixelPanel fill="paper" header={<PixelRibbon as="h2" trailing={h ? <PixelBadge tone={h.status === 'ok' ? 'green' : 'orange'} size="sm">{h.status === 'ok' ? 'All systems working' : 'Degraded'}</PixelBadge> : undefined}>Services</PixelRibbon>} bodyClassName="p-4">
        {q.error ? (
          <p role="alert" className="m-0 text-[15px] text-red-700">The API did not answer, so nothing can be reported. Check that the backend is running.</p>
        ) : (
          <PixelTable caption="Service status">
            <PixelThead><tr><PixelTh>Service</PixelTh><PixelTh>State</PixelTh><PixelTh>Detail</PixelTh></tr></PixelThead>
            <PixelTbody>
              {checks.map(([name, v]) => (
                <PixelTr key={name}>
                  <PixelTd className="font-semibold">{name}</PixelTd>
                  <PixelTd>{v === undefined ? <PixelBadge tone="gray" size="sm">Checking</PixelBadge> : ok(v) ? <PixelBadge tone="green" size="sm">Working</PixelBadge> : <PixelBadge tone="red" size="sm">Not working</PixelBadge>}</PixelTd>
                  <PixelTd className="pxl-mono text-[13px]">{v ?? '—'}</PixelTd>
                </PixelTr>
              ))}
            </PixelTbody>
          </PixelTable>
        )}
      </PixelPanel>
      {h && (
        <PixelPanel fill="paper" header={<PixelRibbon as="h2">About this system</PixelRibbon>} bodyClassName="px-4 py-3 text-[15px]">
          <dl className="m-0">
            {[['Name', h.project], ['Version', h.version], ['Environment', h.environment], ['Last check', fmtTime(h.timestamp)], ['Ticket webhook', '/api/tickets/webhook (signed with the shared secret)']].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-1.5"><dt className="text-slate-600">{k}</dt><dd className="m-0 text-right font-medium">{v}</dd></div>
            ))}
          </dl>
        </PixelPanel>
      )}
    </div>
  );
};
