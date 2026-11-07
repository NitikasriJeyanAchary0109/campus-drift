import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { apiClient } from '../api/client';
import { fmtTime } from '../lib/format';
import { PageHeader, DataBoundary } from '../components/page/Page';
import { PixelPanel } from '../components/ui/pixel/PixelPanel';
import { PixelBadge } from '../components/ui/pixel/PixelBadge';
import { PixelTable, PixelThead, PixelTbody, PixelTr, PixelTh, PixelTd } from '../components/ui/pixel/PixelTable';
import type { BaselineItem } from './Baselines';

interface Rule { id: string; key_path: string; expected_value: string; rule_type: string; severity_weight: number; hard_compliance: boolean; description?: string | null }

/** One baseline: its details and the rules it contains. */
export const BaselineDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const base = useQuery<BaselineItem>({ queryKey: ['baseline', id], queryFn: async () => (await apiClient.get(`/api/baselines/${id}`)).data, enabled: !!id, retry: false });
  const rules = useQuery<Rule[]>({ queryKey: ['baselineRules', id], queryFn: async () => (await apiClient.get(`/api/baselines/${id}/rules`)).data, enabled: !!id, retry: false });
  const b = base.data;
  const notFound = (base.error as any)?.response?.status === 404;

  return (
    <div className="space-y-5">
      <Link to="/baselines" className="pxl-focus inline-flex items-center gap-1 text-[14px] font-semibold text-blue-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Baselines</Link>
      {notFound ? (
        <PixelPanel fill="paper" bodyClassName="p-6"><h1 className="m-0 text-[22px] font-bold">Baseline not found</h1><p className="m-0 mt-2 text-slate-600">There is no baseline with this ID.</p></PixelPanel>
      ) : (
        <DataBoundary what="the baseline" isLoading={base.isLoading} error={base.error} onRetry={() => base.refetch()}>
          {b && (
            <>
              <PageHeader
                title={b.name}
                description={<span className="inline-flex flex-wrap items-center gap-2"><span>Version {b.version}</span><span>· {b.device_group_name ?? 'no zone'}</span><span>· {b.vendor}</span><span>· created {fmtTime(b.created_at)}</span>{b.is_active ? <PixelBadge tone="green" size="sm">Active</PixelBadge> : <PixelBadge tone="gray" size="sm">Not active</PixelBadge>}</span>}
              />
              <PixelPanel fill="paper" bodyClassName="p-4">
                <DataBoundary what="the rules" isLoading={rules.isLoading} error={rules.error} onRetry={() => rules.refetch()} isEmpty={(rules.data ?? []).length === 0} emptyTitle="This baseline has no rules">
                  <PixelTable caption="Baseline rules">
                    <PixelThead><tr><PixelTh>Setting</PixelTh><PixelTh>Expected</PixelTh><PixelTh>Compare</PixelTh><PixelTh>Severity</PixelTh><PixelTh>Hard rule</PixelTh></tr></PixelThead>
                    <PixelTbody>
                      {(rules.data ?? []).map((r) => (
                        <PixelTr key={r.id}>
                          <PixelTd className="pxl-mono font-semibold">{r.key_path}{r.description ? <span className="mt-0.5 block font-sans text-[13px] font-normal text-slate-600">{r.description}</span> : null}</PixelTd>
                          <PixelTd className="pxl-mono">{r.expected_value}</PixelTd>
                          <PixelTd>{r.rule_type}</PixelTd>
                          <PixelTd className="tabular-nums">{r.severity_weight}</PixelTd>
                          <PixelTd>{r.hard_compliance ? <PixelBadge tone="crimson" size="sm">Hard rule</PixelBadge> : '—'}</PixelTd>
                        </PixelTr>
                      ))}
                    </PixelTbody>
                  </PixelTable>
                </DataBoundary>
              </PixelPanel>
            </>
          )}
        </DataBoundary>
      )}
    </div>
  );
};
