import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Wrench, CheckCircle2 } from 'lucide-react';
import { apiClient } from '../api/client';
import { errorText } from '../lib/errors';
import { useAuthStore } from '../store/useAuthStore';
import { PageHeader, DataBoundary } from '../components/page/Page';
import { PixelPanel } from '../components/ui/pixel/PixelPanel';
import { PixelRibbon } from '../components/ui/pixel/PixelRibbon';
import { PixelButton } from '../components/ui/pixel/PixelButton';
import { PixelBadge } from '../components/ui/pixel/PixelBadge';
import { PixelModal } from '../components/ui/pixel/PixelModal';
import { PixelToast } from '../components/ui/pixel/PixelToast';
import { PixelTooltip } from '../components/ui/pixel/PixelTooltip';
import { PixelTable, PixelThead, PixelTbody, PixelTr, PixelTh, PixelTd } from '../components/ui/pixel/PixelTable';
import { fmtTime, triggerDownload } from '../lib/format';

export interface DriftDetailItem {
  id: string;
  key_path: string;
  expected_value: string | null;
  actual_value: string | null;
  change_type: 'ADDED' | 'REMOVED' | 'MODIFIED' | string;
  why_it_matters?: string | null;
  source_line?: string | null;
  source_line_number?: number | null;
}

export interface DriftEventDetail {
  id: string;
  device_id: string;
  device_hostname?: string | null;
  label: string;
  risk_score: number;
  matched_ticket_ref?: string | null;
  status: string;
  detected_at: string;
  details: DriftDetailItem[];
  evidence_bundle?: { why_it_matters_summary?: string; device_group?: string; ticket_matched?: boolean } | null;
}

const CHANGE_TONE = { ADDED: 'green', REMOVED: 'red', MODIFIED: 'blue' } as const;

/** One problem: what changed (expected against actual), why it matters, and the two things you can do about it. */
export const DriftDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canAct = user?.role === 'Admin' || user?.role === 'NetworkEngineer';

  const q = useQuery<DriftEventDetail>({
    queryKey: ['driftDetail', id],
    queryFn: async () => (await apiClient.get(`/api/drift/${id}`)).data,
    enabled: !!id,
    retry: false,
  });
  const event = q.data;

  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string; link?: { to: string; label: string } } | null>(null);
  const [closing, setClosing] = useState(false);
  const [comment, setComment] = useState('');

  const plan = useMutation({
    mutationFn: async () => (await apiClient.post(`/api/remediation/${id}/generate-plan`)).data,
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['remediationPlans'] });
      setBanner({ kind: 'success', text: `Remediation plan created (ID: ${p.id}). It now waits for a second person to approve it.`, link: { to: '/approvals', label: 'Open Approvals' } });
    },
    onError: (err) => {
      const text = errorText(err, 'The plan could not be created.');
      // a plan for this problem already exists: the next step is to decide on it, not to write another
      setBanner({ kind: 'error', text, link: /already has a .* remediation plan/i.test(text) ? { to: '/approvals', label: 'Open Approvals' } : undefined });
    },
  });

  const close = useMutation({
    mutationFn: async (text: string) => (await apiClient.post(`/api/drift/${id}/mark-false-positive`, { comment: text })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driftDetail', id] });
      qc.invalidateQueries({ queryKey: ['driftEvents'] });
      qc.invalidateQueries({ queryKey: ['dashboardSummary'] });
      setClosing(false);
      setComment('');
      setBanner({ kind: 'success', text: 'Closed as not a problem. The decision is in the audit trail.' });
    },
    onError: (err) => setBanner({ kind: 'error', text: errorText(err, 'The problem could not be closed.') }),
  });

  const downloadDiff = () => {
    if (!event) return;
    const lines = event.details.flatMap((d) => [`@@ ${d.key_path} (${d.change_type}) @@`, ...(d.expected_value != null ? [`- ${d.expected_value}`] : []), ...(d.actual_value != null ? [`+ ${d.actual_value}`] : [])]);
    triggerDownload(`diff-${event.device_hostname ?? 'device'}-${event.id}.txt`, `# ${event.device_hostname ?? 'device'}: expected (-) against actual (+)\n${lines.join('\n')}\n`);
  };

  const notFound = (q.error as any)?.response?.status === 404;
  const isOpen = event?.status === 'OPEN';

  return (
    <div className="space-y-5">
      <Link to="/drift" className="pxl-focus inline-flex items-center gap-1 text-[14px] font-semibold text-blue-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Problems
      </Link>

      {notFound ? (
        <PixelPanel fill="paper" bodyClassName="p-6">
          <h1 className="m-0 text-[22px] font-bold">Problem not found</h1>
          <p className="m-0 mt-2 text-slate-600">There is no problem with this ID. It may have been removed.</p>
        </PixelPanel>
      ) : (
        <DataBoundary what="the problem" isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
          {event && (
            <>
              <PageHeader
                title={event.device_hostname ?? 'Unknown device'}
                description={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <PixelBadge taxonomy={event.label} verbose />
                    <span>Risk {event.risk_score} of 100</span>
                    <span>· found {fmtTime(event.detected_at)}</span>
                    <span>· {isOpen ? 'Open' : event.status === 'FALSE_POSITIVE' ? 'Closed (not a problem)' : event.status}</span>
                    {event.matched_ticket_ref && <span>· ticket {event.matched_ticket_ref}</span>}
                  </span>
                }
                actions={
                  <>
                    <PixelButton variant="ghost" onClick={downloadDiff} icon={<Download size={16} />}>Download diff</PixelButton>
                    {canAct && (
                      <>
                        <PixelButton onClick={() => plan.mutate()} loading={plan.isPending} disabled={!isOpen} icon={<Wrench size={16} />}>Create Remediation</PixelButton>
                        <PixelTooltip content="Use this when the change is expected and is not a problem." focusable>
                          <PixelButton variant="success" onClick={() => setClosing(true)} disabled={!isOpen} icon={<CheckCircle2 size={16} />}>Close Event</PixelButton>
                        </PixelTooltip>
                      </>
                    )}
                  </>
                }
              />

              {banner && (
                <PixelToast
                  kind={banner.kind}
                  title={banner.text}
                  onClose={() => setBanner(null)}
                  action={banner.link ? <Link to={banner.link.to} className="pxl-focus font-semibold underline">{banner.link.label}</Link> : undefined}
                />
              )}

              {event.evidence_bundle?.why_it_matters_summary && (
                <PixelPanel fill="paper" header={<PixelRibbon as="h2">Why this matters</PixelRibbon>} bodyClassName="p-4">
                  <p className="m-0 text-[15px] leading-relaxed">{event.evidence_bundle.why_it_matters_summary}</p>
                </PixelPanel>
              )}

              <PixelPanel fill="paper" header={<PixelRibbon as="h2" trailing={<span className="text-[14px]">{event.details.length} {event.details.length === 1 ? 'change' : 'changes'}</span>}>What changed</PixelRibbon>} bodyClassName="p-4">
                {event.details.length === 0 ? (
                  <p className="m-0 text-slate-600">No setting-level changes were recorded for this problem.</p>
                ) : (
                  <PixelTable caption="Expected and actual values">
                    <PixelThead>
                      <tr><PixelTh>Setting</PixelTh><PixelTh>Expected</PixelTh><PixelTh>Actual</PixelTh><PixelTh>Change</PixelTh><PixelTh>Why it matters</PixelTh></tr>
                    </PixelThead>
                    <PixelTbody>
                      {event.details.map((d) => (
                        <PixelTr key={d.id}>
                          <PixelTd className="pxl-mono font-semibold">{d.key_path}</PixelTd>
                          <PixelTd className="pxl-mono"><span className="rounded bg-[var(--dw-diff-add-bg)] px-1.5 py-0.5 text-[var(--dw-diff-add-fg)]">{d.expected_value ?? '—'}</span></PixelTd>
                          <PixelTd className="pxl-mono"><span className="rounded bg-[var(--dw-diff-del-bg)] px-1.5 py-0.5 text-[var(--dw-diff-del-fg)]">{d.actual_value ?? '—'}</span></PixelTd>
                          <PixelTd><PixelBadge tone={CHANGE_TONE[d.change_type as keyof typeof CHANGE_TONE] ?? 'gray'} size="sm">{d.change_type}</PixelBadge></PixelTd>
                          <PixelTd>{d.why_it_matters || '—'}{d.source_line ? <span className="pxl-mono mt-1 block text-[13px] text-slate-600">line {d.source_line_number ?? '?'}: {d.source_line.trim()}</span> : null}</PixelTd>
                        </PixelTr>
                      ))}
                    </PixelTbody>
                  </PixelTable>
                )}
              </PixelPanel>

              <p className="m-0 text-[14px] text-slate-600">
                Device: <Link to={`/devices/${event.device_id}`} className="pxl-focus font-semibold text-blue-700 hover:underline">{event.device_hostname ?? event.device_id}</Link>
              </p>

              <PixelModal
                open={closing}
                onClose={() => setClosing(false)}
                title="Close as not a problem"
                size="sm"
              >
                <form
                  className="space-y-4"
                  onSubmit={(e) => { e.preventDefault(); if (comment.trim().length >= 5) close.mutate(comment.trim()); }}
                >
                  <div>
                    <label htmlFor="close-note" className="mb-1 block text-[14px] font-medium">Why is this not a problem? (required)</label>
                    <textarea id="close-note" rows={4} required value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Explain why this change is expected" className="pxl-field pxl-focus" />
                    <p className="m-0 mt-1 text-[13px] text-slate-600">At least 5 characters. This goes into the audit trail.</p>
                  </div>
                  <div className="flex justify-end gap-3 border-t border-slate-200 pt-3">
                    <PixelButton variant="ghost" onClick={() => setClosing(false)}>Cancel</PixelButton>
                    <PixelButton type="submit" variant="success" disabled={close.isPending || comment.trim().length < 5}>{close.isPending ? 'Saving...' : 'Confirm Closure'}</PixelButton>
                  </div>
                </form>
              </PixelModal>
            </>
          )}
        </DataBoundary>
      )}
    </div>
  );
};
