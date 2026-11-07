import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { apiClient } from '../api/client';
import { PageHeader, DataBoundary, FilterToggle } from '../components/page/Page';
import { paginate } from '../lib/format';
import { PixelPanel } from '../components/ui/pixel/PixelPanel';
import { PixelInput } from '../components/ui/pixel/PixelInput';
import { PixelSelect } from '../components/ui/pixel/PixelSelect';
import { PixelBadge } from '../components/ui/pixel/PixelBadge';
import { PixelPagination } from '../components/ui/pixel/PixelPagination';
import { PixelTable, PixelThead, PixelTbody, PixelTr, PixelTh, PixelTd } from '../components/ui/pixel/PixelTable';
import { LABEL_ORDER, labelStyle } from '../components/ui/pixel/semantic';
import { fmtTime } from '../lib/format';

export interface DriftEventItem {
  id: string;
  device_id: string;
  device_hostname?: string | null;
  label: string;
  risk_score: number;
  matched_ticket_ref?: string | null;
  status: string;
  detected_at: string;
  details_count?: number;
}

const PAGE_SIZE = 10;

/** Problems: every drift event the server has found, most serious first. Pick one to see what changed and fix it. */
export const DriftEvents: React.FC = () => {
  const navigate = useNavigate();
  const q = useQuery<DriftEventItem[]>({ queryKey: ['driftEvents'], queryFn: async () => (await apiClient.get('/api/drift')).data });

  const [search, setSearch] = useState('');
  const [label, setLabel] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...(q.data ?? [])]
      .filter((e) => (openOnly ? e.status === 'OPEN' : true))
      .filter((e) => (label ? labelStyle(e.label).label === label : true))
      .filter((e) => !needle || `${e.device_hostname ?? ''} ${e.label} ${e.matched_ticket_ref ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => b.risk_score - a.risk_score || +new Date(b.detected_at) - +new Date(a.detected_at));
  }, [q.data, search, label, openOnly]);

  const activeFilters = (label ? 1 : 0) + (openOnly ? 0 : 1);
  const reset = (fn: () => void) => { fn(); setPage(1); };

  return (
    <div className="space-y-5">
      <PageHeader title="Problems" description="Changes that left your approved settings. Pick one to see what changed, then fix it." />

      <PixelPanel fill="paper" bodyClassName="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <PixelInput
            wrapperClassName="min-w-[240px] flex-1"
            aria-label="Search problems"
            icon={<Search size={18} />}
            placeholder="Search by device or ticket"
            value={search}
            onChange={(e) => reset(() => setSearch(e.target.value))}
          />
          <FilterToggle open={filtersOpen} onToggle={() => setFiltersOpen((v) => !v)} active={activeFilters} />
        </div>
        {filtersOpen && (
          <div className="grid gap-3 sm:grid-cols-2">
            <PixelSelect label="Problem type" value={label} onChange={(e) => reset(() => setLabel(e.target.value))}>
              <option value="">All types</option>
              {LABEL_ORDER.filter((k) => k !== 'Compliant' && k !== 'NO_BASELINE').map((k) => (
                <option key={k} value={labelStyle(k).label}>{labelStyle(k).text}</option>
              ))}
            </PixelSelect>
            <PixelSelect label="Show" value={openOnly ? 'open' : 'all'} onChange={(e) => reset(() => setOpenOnly(e.target.value === 'open'))}>
              <option value="open">Open problems</option>
              <option value="all">Open and closed</option>
            </PixelSelect>
          </div>
        )}

        <DataBoundary
          what="problems"
          isLoading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          isEmpty={rows.length === 0}
          emptyTitle={(q.data ?? []).length === 0 ? 'No problems found' : 'No problems match'}
          emptyText={(q.data ?? []).length === 0 ? 'Every collected device matches its approved settings.' : 'Change the search or the filters.'}
        >
          <PixelTable caption="Problems">
            <PixelThead>
              <tr>
                <PixelTh>Detected</PixelTh>
                <PixelTh>Device</PixelTh>
                <PixelTh>Problem</PixelTh>
                <PixelTh>Risk</PixelTh>
                <PixelTh>Ticket</PixelTh>
                <PixelTh>Status</PixelTh>
                <PixelTh><span className="sr-only">Open</span></PixelTh>
              </tr>
            </PixelThead>
            <PixelTbody>
              {paginate(rows, page, PAGE_SIZE).map((e) => (
                <PixelTr key={e.id} interactive onClick={() => navigate(`/drift/${e.id}`)}>
                  <PixelTd className="whitespace-nowrap">{fmtTime(e.detected_at)}</PixelTd>
                  <PixelTd className="pxl-mono font-semibold">{e.device_hostname || 'Unknown device'}</PixelTd>
                  <PixelTd><PixelBadge taxonomy={e.label} size="sm" /></PixelTd>
                  <PixelTd className="tabular-nums">{e.risk_score}</PixelTd>
                  <PixelTd>{e.matched_ticket_ref || '—'}</PixelTd>
                  <PixelTd>{e.status === 'OPEN' ? 'Open' : e.status === 'FALSE_POSITIVE' ? 'Closed (not a problem)' : e.status.charAt(0) + e.status.slice(1).toLowerCase()}</PixelTd>
                  <PixelTd>
                    <Link to={`/drift/${e.id}`} aria-label={`Review ${e.device_hostname || 'unknown device'}`} onClick={(ev) => ev.stopPropagation()} className="pxl-focus font-semibold text-blue-700 hover:underline">
                      Review
                    </Link>
                  </PixelTd>
                </PixelTr>
              ))}
            </PixelTbody>
          </PixelTable>
          <PixelPagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} noun="problems" />
        </DataBoundary>
      </PixelPanel>
    </div>
  );
};
