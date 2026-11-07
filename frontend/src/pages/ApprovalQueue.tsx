import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { apiClient } from '../api/client';
import { errorText } from '../lib/errors';
import { useAuthStore } from '../store/useAuthStore';
import { fmtTime } from '../lib/format';
import { PageHeader, DataBoundary } from '../components/page/Page';
import { PixelPanel } from '../components/ui/pixel/PixelPanel';
import { PixelRibbon } from '../components/ui/pixel/PixelRibbon';
import { PixelButton } from '../components/ui/pixel/PixelButton';
import { PixelBadge } from '../components/ui/pixel/PixelBadge';
import { PixelModal } from '../components/ui/pixel/PixelModal';
import { PixelToast } from '../components/ui/pixel/PixelToast';
import { PixelTooltip } from '../components/ui/pixel/PixelTooltip';
import { PixelTable, PixelThead, PixelTbody, PixelTr, PixelTh, PixelTd } from '../components/ui/pixel/PixelTable';

interface Plan {
  id: string;
  device_hostname?: string | null;
  drift_label?: string | null;
  risk_score?: number | null;
  proposed_commands: string[];
  status: string;
  created_at: string;
  created_by?: string | null;
  created_by_username?: string | null;
  approval?: { decision: string; approver_username?: string | null; comment?: string | null; decided_at: string } | null;
}

/** Approvals: plans written by one person wait here for a second person. Approve or reject, with the commands in front of you. */
export const ApprovalQueue: React.FC = () => {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const pending = useQuery<Plan[]>({ queryKey: ['approvalsPending'], queryFn: async () => (await apiClient.get('/api/approvals/pending')).data });
  const history = useQuery<Plan[]>({ queryKey: ['remediationPlans'], queryFn: async () => (await apiClient.get('/api/remediation?limit=50')).data, retry: false });

  const [decision, setDecision] = useState<{ plan: Plan; kind: 'APPROVED' | 'REJECTED' } | null>(null);
  const [comment, setComment] = useState('');
  const [shown, setShown] = useState(10);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const decide = useMutation({
    mutationFn: async (v: { plan: Plan; kind: 'APPROVED' | 'REJECTED'; comment: string }) =>
      (await apiClient.post(`/api/approvals/${v.plan.id}`, { decision: v.kind, comment: v.comment || undefined })).data,
    onSuccess: (_d, v) => {
      setDecision(null);
      setComment('');
      qc.invalidateQueries({ queryKey: ['approvalsPending'] });
      qc.invalidateQueries({ queryKey: ['remediationPlans'] });
      qc.invalidateQueries({ queryKey: ['dashboardSummary'] });
      setNotice({ kind: 'success', text: v.kind === 'APPROVED' ? `Approved. ${v.plan.device_hostname ?? 'The plan'} can now be applied from Remediation.` : 'Rejected. The reason is in the audit trail.' });
    },
    onError: (err) => { setDecision(null); setNotice({ kind: 'error', text: errorText(err, 'The decision could not be saved.') }); },
  });

  const isAuthor = (p: Plan) => (!!p.created_by && p.created_by === user?.id) || (!!p.created_by_username && p.created_by_username === user?.username);
  const decided = (history.data ?? []).filter((p) => p.status !== 'PENDING').slice(0, 10);
  const canSubmit = decision?.kind === 'APPROVED' || comment.trim().length > 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Approvals" description="A second person checks every fix before it touches a device." />
      {notice && <PixelToast kind={notice.kind} title={notice.text} onClose={() => setNotice(null)} />}

      <PixelPanel fill="paper" header={<PixelRibbon as="h2" trailing={<span className="text-[14px]">{(pending.data ?? []).length} waiting</span>}>Waiting for approval</PixelRibbon>} bodyClassName="space-y-3 p-4">
        <DataBoundary what="approvals" isLoading={pending.isLoading} error={pending.error} onRetry={() => pending.refetch()} isEmpty={(pending.data ?? []).length === 0} emptyTitle="Nothing is waiting" emptyText="When someone creates a remediation plan it appears here.">
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {(pending.data ?? []).slice(0, shown).map((p) => (
              <li key={p.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="pxl-mono text-[16px] font-bold">{p.device_hostname ?? 'Unknown device'}</span>
                    {p.drift_label && <PixelBadge taxonomy={p.drift_label} size="sm" />}
                    {p.risk_score != null && <span className="text-[14px] text-slate-600">risk {p.risk_score}</span>}
                  </div>
                  <span className="text-[14px] text-slate-600">Written by <strong>{p.created_by_username ?? 'unknown'}</strong> · {fmtTime(p.created_at)}</span>
                </div>
                <details className="mt-3">
                  <summary className="pxl-focus cursor-pointer text-[14px] font-semibold text-blue-700">Show the {p.proposed_commands.length} {p.proposed_commands.length === 1 ? 'command' : 'commands'}</summary>
                  <pre className="pxl-mono mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-3 text-[14px] leading-[1.5] text-green-300">{p.proposed_commands.join('\n')}</pre>
                </details>
                <div className="mt-4 flex flex-wrap justify-end gap-3">
                  <PixelButton variant="ghost" icon={<X size={16} />} onClick={() => { setComment(''); setDecision({ plan: p, kind: 'REJECTED' }); }}>Reject</PixelButton>
                  {isAuthor(p) ? (
                    <PixelTooltip content="You wrote this plan. A second person has to approve it." focusable>
                      <PixelButton variant="success" disabled icon={<Check size={16} />}>Approve</PixelButton>
                    </PixelTooltip>
                  ) : (
                    <PixelButton variant="success" icon={<Check size={16} />} onClick={() => { setComment(''); setDecision({ plan: p, kind: 'APPROVED' }); }}>Approve</PixelButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {(pending.data ?? []).length > shown && (
            <div className="flex justify-center">
              <PixelButton variant="ghost" onClick={() => setShown((n) => n + 10)}>Show 10 more ({(pending.data ?? []).length - shown} not shown)</PixelButton>
            </div>
          )}
        </DataBoundary>
      </PixelPanel>

      {decided.length > 0 && (
        <PixelPanel fill="paper" header={<PixelRibbon as="h2">Recently decided</PixelRibbon>} bodyClassName="p-4">
          <PixelTable caption="Recently decided plans">
            <PixelThead><tr><PixelTh>Device</PixelTh><PixelTh>Status</PixelTh><PixelTh>Decided by</PixelTh><PixelTh><span className="sr-only">Open</span></PixelTh></tr></PixelThead>
            <PixelTbody>
              {decided.map((p) => (
                <PixelTr key={p.id}>
                  <PixelTd className="pxl-mono font-semibold">{p.device_hostname ?? '—'}</PixelTd>
                  <PixelTd><PixelBadge tone={p.status === 'REJECTED' || p.status.includes('FAIL') ? 'red' : p.status === 'APPROVED' ? 'blue' : 'green'} size="sm">{p.status.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</PixelBadge></PixelTd>
                  <PixelTd>{p.approval?.approver_username ?? '—'}{p.approval?.decided_at ? ` · ${fmtTime(p.approval.decided_at)}` : ''}</PixelTd>
                  <PixelTd><Link to={`/remediation?plan_id=${p.id}`} className="pxl-focus font-semibold text-blue-700 hover:underline">Open</Link></PixelTd>
                </PixelTr>
              ))}
            </PixelTbody>
          </PixelTable>
        </PixelPanel>
      )}

      <PixelModal open={!!decision} onClose={() => setDecision(null)} title={decision?.kind === 'APPROVED' ? 'Approve this plan' : 'Reject this plan'} size="sm">
        {decision && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (canSubmit) decide.mutate({ plan: decision.plan, kind: decision.kind, comment: comment.trim() }); }}>
            <p className="m-0 text-[15px]">
              {decision.kind === 'APPROVED' ? 'The commands will be allowed to run on ' : 'The plan for '}<strong className="pxl-mono">{decision.plan.device_hostname}</strong>{decision.kind === 'APPROVED' ? '.' : ' will not run.'}
            </p>
            <div>
              <label htmlFor="decision-note" className="mb-1 block text-[14px] font-medium">{decision.kind === 'APPROVED' ? 'Note (optional)' : 'Why are you rejecting it? (required)'}</label>
              <textarea id="decision-note" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} className="pxl-field pxl-focus" required={decision.kind === 'REJECTED'} />
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-3">
              <PixelButton variant="ghost" onClick={() => setDecision(null)}>Cancel</PixelButton>
              <PixelButton type="submit" variant={decision.kind === 'APPROVED' ? 'success' : 'danger'} loading={decide.isPending} disabled={!canSubmit}>{decision.kind === 'APPROVED' ? 'Confirm approval' : 'Confirm rejection'}</PixelButton>
            </div>
          </form>
        )}
      </PixelModal>
    </div>
  );
};
