import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Play } from 'lucide-react';
import { apiClient } from '../api/client';
import { errorText } from '../lib/errors';
import { useAuthStore } from '../store/useAuthStore';
import { fmtTime, humanize } from '../lib/format';
import { PageHeader, DataBoundary } from '../components/page/Page';
import { PixelPanel } from '../components/ui/pixel/PixelPanel';
import { PixelRibbon } from '../components/ui/pixel/PixelRibbon';
import { PixelButton } from '../components/ui/pixel/PixelButton';
import { PixelBadge } from '../components/ui/pixel/PixelBadge';
import { PixelModal } from '../components/ui/pixel/PixelModal';
import { PixelToast } from '../components/ui/pixel/PixelToast';
import { PixelSteps } from '../components/ui/pixel/PixelProgress';
import { PixelTable, PixelThead, PixelTbody, PixelTr, PixelTh, PixelTd } from '../components/ui/pixel/PixelTable';

interface ActionItem { id: string; result: string; executed_at: string; executed_commands: string[] }
interface Plan {
  id: string;
  drift_event_id: string;
  device_id?: string | null;
  device_hostname?: string | null;
  drift_label?: string | null;
  risk_score?: number | null;
  proposed_commands: string[];
  status: string;
  created_at: string;
  created_by_username?: string | null;
  approval?: { decision: string; approver_username?: string | null; comment?: string | null; decided_at: string } | null;
  actions?: ActionItem[];
}

type Banner = { kind: 'success' | 'warning' | 'error' | 'info'; title: string; text: string };

const STATUS_TONE: Record<string, 'blue' | 'green' | 'red' | 'yellow' | 'gray'> = { PENDING: 'yellow', APPROVED: 'blue', APPLYING: 'blue', APPLIED: 'green', REJECTED: 'red', FAILED: 'red', ROLLED_BACK: 'yellow', ROLLBACK_FAILED: 'red' };

/** The path a fix takes: written, approved, backed up, pushed, verified. */
const steps = (p: Plan) => {
  const approved = !!p.approval && p.approval.decision === 'APPROVED';
  const applied = p.status === 'APPLIED';
  const failed = ['FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED'].includes(p.status);
  return [
    { id: 'plan', label: 'Plan written', state: 'done' as const, detail: p.created_by_username ? `by ${p.created_by_username}` : undefined },
    { id: 'approve', label: 'Approved', state: p.status === 'REJECTED' ? ('failed' as const) : approved ? ('done' as const) : ('active' as const), detail: p.status === 'REJECTED' ? 'Rejected' : approved ? `by ${p.approval?.approver_username ?? 'a second person'}` : 'Waiting for a second person' },
    { id: 'apply', label: 'Applied and checked', state: applied ? ('done' as const) : failed ? ('failed' as const) : p.status === 'APPLYING' ? ('active' as const) : ('pending' as const), detail: applied ? 'Verified against the baseline' : failed ? humanize(p.status) : undefined },
  ];
};

/** Remediation: one plan at a time, with its commands, its approval and its history. Apply an approved plan, or roll one back. */
export const Remediation: React.FC = () => {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const canApply = user?.role === 'Admin' || user?.role === 'NetworkEngineer';
  const isAdmin = user?.role === 'Admin';

  const list = useQuery<Plan[]>({ queryKey: ['remediationPlans'], queryFn: async () => (await apiClient.get('/api/remediation')).data });
  const selectedId = params.get('plan_id') ?? list.data?.[0]?.id ?? null;
  const detail = useQuery<Plan>({ queryKey: ['remediationPlan', selectedId], queryFn: async () => (await apiClient.get(`/api/remediation/${selectedId}`)).data, enabled: !!selectedId, retry: false });
  const plan = detail.data;

  const [confirm, setConfirm] = useState<'apply' | 'rollback' | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [job, setJob] = useState<{ id: string; kind: 'apply' | 'rollback' } | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['remediationPlans'] });
    qc.invalidateQueries({ queryKey: ['remediationPlan', selectedId] });
    qc.invalidateQueries({ queryKey: ['dashboardSummary'] });
    qc.invalidateQueries({ queryKey: ['driftEvents'] });
  };

  const show = (kind: 'apply' | 'rollback', r: any) => {
    if (kind === 'rollback') {
      setBanner(r.result === 'ROLLED_BACK' ? { kind: 'success', title: 'Rolled back', text: 'The device was restored to its pre-change configuration and the restore was verified.' } : { kind: 'error', title: 'Rollback could not be verified', text: 'Check the device by hand. The pre-change backup is in the audit trail.' });
    } else if (r.result === 'SUCCESS') {
      setBanner({ kind: 'success', title: 'Applied and verified', text: 'The commands were pushed and the device now matches its baseline.' });
    } else if (r.result === 'ROLLED_BACK') {
      setBanner({ kind: 'warning', title: 'Verification failed: rolled back', text: 'The device did not match its baseline after the change, so the pre-change backup was restored and the restore was verified.' });
    } else {
      setBanner({ kind: 'error', title: 'Rollback could not be verified', text: 'CRITICAL: the check failed and the restore could not be proven. Restore the pre-change backup by hand.' });
    }
    refresh();
  };

  const run = useMutation({
    mutationFn: async (kind: 'apply' | 'rollback') => ({ kind, data: (await apiClient.post(`/api/remediation/${selectedId}/${kind}`)).data }),
    onSuccess: ({ kind, data }) => {
      setConfirm(null);
      if (data?.task_id) {
        setJob({ id: data.task_id, kind });
        setBanner({ kind: 'info', title: kind === 'apply' ? 'Queued' : 'Rollback queued', text: 'A worker is doing this now. The page updates when it is done.' });
        return;
      }
      show(kind, data);
    },
    onError: (err, kind) => { setConfirm(null); setBanner({ kind: 'error', title: kind === 'apply' ? 'The change was not applied' : 'The rollback failed', text: errorText(err, 'The server refused the request.') }); },
  });

  const jobQ = useQuery<{ finished: boolean; result: any }>({
    queryKey: ['remediationJob', job?.id],
    queryFn: async () => (await apiClient.get(`/api/remediation/jobs/${job!.id}`)).data,
    enabled: !!job,
    refetchInterval: (q) => (q.state.data?.finished ? false : 2000),
  });
  useEffect(() => {
    if (!job || !jobQ.data?.finished) return;
    const r = jobQ.data.result;
    if (!r) setBanner({ kind: 'error', title: 'No result', text: 'The worker stopped before it reported a result. Check the device and the audit trail.' });
    else if (!r.ok) setBanner({ kind: 'error', title: job.kind === 'apply' ? 'The change was not applied' : 'The rollback failed', text: String(r.detail || 'The operation was refused.') });
    else show(job.kind, r);
    setJob(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, jobQ.data]);

  // four-eyes: whoever wrote the plan does not run it
  const wroteIt = !!plan?.created_by_username && plan.created_by_username === user?.username;

  const canRun = (kind: 'apply' | 'rollback') =>
    !!plan && !job && (kind === 'apply' ? canApply && !wroteIt && plan.status === 'APPROVED' : isAdmin && ['APPLIED', 'FAILED', 'ROLLBACK_FAILED'].includes(plan.status));

  return (
    <div className="space-y-5">
      <PageHeader title="Remediation" description="Fixes that were written, approved and applied. Each one is backed up first and checked afterwards." />

      <DataBoundary what="plans" isLoading={list.isLoading} error={list.error} onRetry={() => list.refetch()} isEmpty={(list.data ?? []).length === 0} emptyTitle="No remediation plans yet" emptyText="Open a problem and choose Create Remediation to write the first one.">
        <PixelPanel fill="paper" header={<PixelRibbon as="h2">Plans</PixelRibbon>} bodyClassName="p-4">
          <PixelTable caption="Remediation plans">
            <PixelThead><tr><PixelTh>Device</PixelTh><PixelTh>Status</PixelTh><PixelTh>Written</PixelTh><PixelTh><span className="sr-only">Open</span></PixelTh></tr></PixelThead>
            <PixelTbody>
              {(list.data ?? []).slice(0, 15).map((p) => (
                <PixelTr key={p.id} interactive selected={p.id === selectedId} onClick={() => setParams({ plan_id: p.id })}>
                  <PixelTd className="pxl-mono font-semibold">{p.device_hostname ?? '—'}</PixelTd>
                  <PixelTd><PixelBadge tone={STATUS_TONE[p.status] ?? 'gray'} size="sm">{humanize(p.status)}</PixelBadge></PixelTd>
                  <PixelTd className="whitespace-nowrap">{fmtTime(p.created_at)}</PixelTd>
                  <PixelTd><button type="button" className="pxl-focus font-semibold text-blue-700 hover:underline" onClick={(e) => { e.stopPropagation(); setParams({ plan_id: p.id }); }}>View</button></PixelTd>
                </PixelTr>
              ))}
            </PixelTbody>
          </PixelTable>
        </PixelPanel>

        {banner && <div className="mt-5"><PixelToast kind={banner.kind === 'warning' ? 'info' : banner.kind} title={`${banner.title}: ${banner.text}`} onClose={() => setBanner(null)} /></div>}

        <DataBoundary what="the plan" isLoading={detail.isLoading} error={detail.error} onRetry={() => detail.refetch()}>
          {plan && (
            <div className="mt-5 space-y-5">
              <PixelPanel
                fill="paper"
                header={<PixelRibbon as="h2" trailing={<PixelBadge tone={STATUS_TONE[plan.status] ?? 'gray'}>{humanize(plan.status)}</PixelBadge>}>{plan.device_hostname ?? 'Unknown device'}</PixelRibbon>}
                bodyClassName="space-y-4 p-4"
              >
                <div className="flex flex-wrap items-center gap-3 text-[14px] text-slate-700">
                  {plan.drift_label && <PixelBadge taxonomy={plan.drift_label} size="sm" />}
                  {plan.risk_score != null && <span>risk {plan.risk_score}</span>}
                  <Link to={`/drift/${plan.drift_event_id}`} className="pxl-focus font-semibold text-blue-700 hover:underline">Open the problem</Link>
                </div>
                <PixelSteps label="Progress of this plan" steps={steps(plan)} />
                <div>
                  <h3 className="m-0 mb-2 text-[14px] font-semibold">Commands that will be sent</h3>
                  <pre aria-label="Commands" className="pxl-mono m-0 overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-3 text-[14px] leading-[1.5] text-green-300">{plan.proposed_commands.join('\n') || '(none)'}</pre>
                  <p className="m-0 mt-1 text-[13px] text-slate-600">Only whitelisted templates produce these commands. Nothing typed by a person is ever sent.</p>
                </div>
                {plan.approval && (
                  <p className="m-0 text-[14px]">
                    <strong>{plan.approval.decision === 'APPROVED' ? 'Approved' : 'Rejected'}</strong> by {plan.approval.approver_username ?? 'a second person'} · {fmtTime(plan.approval.decided_at)}
                    {plan.approval.comment ? <span className="text-slate-600"> · “{plan.approval.comment}”</span> : null}
                  </p>
                )}
                <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
                  {isAdmin && <PixelButton variant="ghost" icon={<RotateCcw size={16} />} disabled={!canRun('rollback')} onClick={() => setConfirm('rollback')}>Rollback Now</PixelButton>}
                  {canApply && <PixelButton icon={<Play size={16} />} disabled={!canRun('apply')} onClick={() => setConfirm('apply')}>Execute Remediation</PixelButton>}
                </div>
                {canApply && wroteIt && plan.status === 'APPROVED' && <p className="m-0 text-right text-[13px] text-slate-600">You wrote this plan, so a different person has to run it.</p>}
                {canApply && plan.status !== 'APPROVED' && !['APPLIED', 'FAILED', 'ROLLBACK_FAILED', 'ROLLED_BACK'].includes(plan.status) && <p className="m-0 text-right text-[13px] text-slate-600">Only an approved plan can be applied.</p>}
              </PixelPanel>

              {(plan.actions ?? []).length > 0 && (
                <PixelPanel fill="paper" header={<PixelRibbon as="h2">What happened</PixelRibbon>} bodyClassName="p-4">
                  <PixelTable caption="Actions on this plan">
                    <PixelThead><tr><PixelTh>When</PixelTh><PixelTh>Result</PixelTh><PixelTh>Commands sent</PixelTh></tr></PixelThead>
                    <PixelTbody>
                      {(plan.actions ?? []).map((a) => (
                        <PixelTr key={a.id}>
                          <PixelTd className="whitespace-nowrap">{fmtTime(a.executed_at)}</PixelTd>
                          <PixelTd><PixelBadge tone={a.result === 'SUCCESS' ? 'green' : a.result === 'ROLLED_BACK' ? 'yellow' : 'red'} size="sm">{humanize(a.result)}</PixelBadge></PixelTd>
                          <PixelTd className="pxl-mono">{a.executed_commands?.length ?? 0}</PixelTd>
                        </PixelTr>
                      ))}
                    </PixelTbody>
                  </PixelTable>
                </PixelPanel>
              )}
            </div>
          )}
        </DataBoundary>
      </DataBoundary>

      <PixelModal open={!!confirm} onClose={() => setConfirm(null)} title={confirm === 'apply' ? 'Confirm Remediation Execution' : 'Confirm rollback'} size="sm">
        <div className="space-y-4">
          <p className="m-0 text-[15px]">
            {confirm === 'apply'
              ? <>The approved commands will be pushed to <strong className="pxl-mono">{plan?.device_hostname}</strong>. A backup is taken first, the device is checked afterwards, and it is rolled back automatically if the check fails.</>
              : <>The pre-change backup will be restored on <strong className="pxl-mono">{plan?.device_hostname}</strong> and the result checked.</>}
          </p>
          <div className="flex justify-end gap-3 border-t border-slate-200 pt-3">
            <PixelButton variant="ghost" onClick={() => setConfirm(null)}>Cancel</PixelButton>
            <PixelButton variant={confirm === 'apply' ? 'primary' : 'danger'} loading={run.isPending} onClick={() => confirm && run.mutate(confirm)}>{confirm === 'apply' ? 'Confirm & push to device' : 'Confirm rollback'}</PixelButton>
          </div>
        </div>
      </PixelModal>
    </div>
  );
};
