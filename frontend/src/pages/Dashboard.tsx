import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { Server, ShieldCheck, AlertTriangle, ClipboardList, ArrowRight, CheckCircle2, Siren, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useAlerts, alertTarget } from '../lib/useAlerts';
import { useSweep } from '../lib/useSweep';
import { alertSeverity, fmtTime, humanize, SEVERITY_LABEL } from '../lib/format';
import { PageHeader } from '../components/page/Page';
import { PixelPanel } from '../components/ui/pixel/PixelPanel';
import { PixelRibbon } from '../components/ui/pixel/PixelRibbon';
import { PixelButton } from '../components/ui/pixel/PixelButton';
import { PixelStat } from '../components/ui/pixel/PixelStat';
import { PixelBadge } from '../components/ui/pixel/PixelBadge';
import { PixelToast } from '../components/ui/pixel/PixelToast';
import { PixelEmptyState } from '../components/ui/pixel/PixelEmptyState';

interface DashboardSummary {
  total_devices: number;
  compliance_percentage: number;
}

const band = (rate: number) =>
  rate >= 90 ? { tone: 'green' as const, text: 'Compliant' } : rate >= 75 ? { tone: 'yellow' as const, text: 'Needs attention' } : { tone: 'red' as const, text: 'Non-compliant' };

/** Home: is anything wrong, and what do I click. Numbers come from the server; while they load or fail they show a dash, never a made-up value. */
export const Dashboard: React.FC = () => {
  const { user } = useAuthStore();
  const canSweep = user?.role === 'Admin' || user?.role === 'NetworkEngineer';
  const summary = useQuery<DashboardSummary>({ queryKey: ['dashboardSummary'], queryFn: async () => (await apiClient.get('/api/dashboard/summary')).data, refetchInterval: 30000 });
  const alerts = useAlerts();
  const pending = useQuery<unknown[]>({ queryKey: ['approvalsPending'], queryFn: async () => (await apiClient.get('/api/approvals/pending')).data, enabled: canSweep, retry: false });

  const sweep = useSweep();
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const runSweep = async () => { const r = await sweep.run(); setNotice({ kind: r.failed ? 'error' : 'success', text: r.message }); };

  const open = (alerts.data ?? []).filter((a) => !a.acknowledged);
  const s = summary.data;
  const b = s ? band(s.compliance_percentage) : null;

  return (
    <div className="w-full space-y-5">
      <PageHeader
        title="Home"
        description="What needs your attention today."
        actions={canSweep && <PixelButton variant="ghost" onClick={runSweep} loading={sweep.running} icon={<RefreshCw className="h-4 w-4" strokeWidth={2.4} />}>Trigger Campus Sweep</PixelButton>}
      />
      {notice && <PixelToast kind={notice.kind} title={notice.text} onClose={() => setNotice(null)} />}

      {alerts.data && (
        open.length > 0 ? (
          <section aria-label="Status" className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-red-200 bg-red-50 p-5">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-red-600 text-white"><Siren size={22} /></span>
              <div>
                <p className="m-0 text-[20px] font-semibold text-red-900">{open.length === 1 ? '1 problem needs your attention' : `${open.length} problems need your attention`}</p>
                <p className="m-0 text-[14px] text-red-800">Open a problem to see what changed and fix it.</p>
              </div>
            </div>
            <Link to="/drift" className="pxl-btn pxl-btn-lg pxl-btn-primary pxl-focus"><span>Review problems</span><ArrowRight className="h-4 w-4" strokeWidth={2.6} aria-hidden="true" /></Link>
          </section>
        ) : (
          <section aria-label="Status" className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-5">
            <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-green-600 text-white"><CheckCircle2 size={22} /></span>
            <div><p className="m-0 text-[20px] font-semibold text-green-900">All clear</p><p className="m-0 text-[14px] text-green-800">Nothing needs your attention right now.</p></div>
          </section>
        )
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PixelStat label="Total Devices Managed" value={s ? s.total_devices : '—'} icon={Server} tone="blue" />
        <PixelStat label="Campus Compliance" value={s ? `${s.compliance_percentage.toFixed(1)}%` : '—'} icon={ShieldCheck} tone={b?.tone ?? 'gray'} hint={b?.text} />
        <PixelStat label="Active Unacknowledged Alerts" value={alerts.data ? open.length : '—'} icon={AlertTriangle} tone="red" />
        {canSweep && <PixelStat label="Pending Approvals" value={pending.data ? pending.data.length : '—'} icon={ClipboardList} tone="yellow" />}
      </div>
      {(summary.error || alerts.error) && <p role="alert" className="m-0 text-[14px] text-red-700">Some numbers could not be loaded. <button type="button" className="pxl-focus font-semibold underline" onClick={() => { summary.refetch(); alerts.refetch(); }}>Try again</button></p>}

      <PixelPanel
        fill="paper"
        header={<PixelRibbon as="h2" icon={<Siren size={18} strokeWidth={2.4} />} trailing={<Link to="/alerts" className="pxl-focus text-[14px] font-medium text-blue-700 hover:underline">See all alerts</Link>}>Needs attention</PixelRibbon>}
        bodyClassName="p-4"
      >
        {open.length === 0 ? (
          <PixelEmptyState title="Nothing needs your attention" description="New problems show up here as soon as a device changes." scale={3} />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {open.slice(0, 5).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3">
                <PixelBadge taxonomy={SEVERITY_LABEL[alertSeverity(a.type)]} size="sm" title={humanize(a.type)} />
                <span className="min-w-0 flex-1 text-[14px] text-slate-800">{a.message}</span>
                <span className="pxl-mono text-[13px] text-slate-500">{fmtTime(a.created_at)}</span>
                <Link to={alertTarget(a) ?? '/drift'} className="pxl-btn pxl-btn-sm pxl-btn-secondary pxl-focus shrink-0"><span>Investigate</span><ArrowRight className="h-3.5 w-3.5" strokeWidth={2.6} aria-hidden="true" /></Link>
              </li>
            ))}
          </ul>
        )}
      </PixelPanel>
    </div>
  );
};
