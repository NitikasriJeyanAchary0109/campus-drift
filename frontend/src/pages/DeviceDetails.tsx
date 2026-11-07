import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Play } from 'lucide-react';
import { apiClient } from '../api/client';
import { errorText } from '../lib/errors';
import { useAuthStore } from '../store/useAuthStore';
import { fmtTime } from '../lib/format';
import { LegacyCoexistenceCard, ModeBadge } from '../components/LegacyCoexistenceCard';
import { PageHeader, DataBoundary } from '../components/page/Page';
import { PixelPanel } from '../components/ui/pixel/PixelPanel';
import { PixelRibbon } from '../components/ui/pixel/PixelRibbon';
import { PixelButton } from '../components/ui/pixel/PixelButton';
import { PixelBadge } from '../components/ui/pixel/PixelBadge';
import { PixelInput } from '../components/ui/pixel/PixelInput';
import { PixelSelect } from '../components/ui/pixel/PixelSelect';
import { PixelModal } from '../components/ui/pixel/PixelModal';
import { PixelToast } from '../components/ui/pixel/PixelToast';
import { PixelTable, PixelThead, PixelTbody, PixelTr, PixelTh, PixelTd } from '../components/ui/pixel/PixelTable';

interface DeviceDetail {
  id: string;
  hostname: string;
  ip_address: string;
  vendor: string;
  model: string;
  status: string;
  last_polled_at?: string | null;
  device_group?: { name: string } | null;
  has_credentials: boolean;
  collection_mode: string;
  shadow_mode: boolean;
  latest_snapshot?: { id: string; collected_at: string; collection_method: string } | null;
}
interface OpenEvent { id: string; label: string; risk_score: number; detected_at: string; status: string }

/** One device: facts from the server, its open problems, and the actions allowed for your role. */
export const DeviceDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'Admin';
  const canPoll = isAdmin || user?.role === 'NetworkEngineer';

  const q = useQuery<DeviceDetail>({ queryKey: ['device', id], queryFn: async () => (await apiClient.get(`/api/devices/${id}`)).data, enabled: !!id, retry: false });
  const problems = useQuery<OpenEvent[]>({ queryKey: ['deviceProblems', id], queryFn: async () => (await apiClient.get(`/api/drift?device_id=${id}&status=OPEN`)).data, enabled: !!id, retry: false });
  const d = q.data;

  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const poll = useMutation({
    mutationFn: async () => (await apiClient.post(`/api/devices/${id}/poll`)).data,
    onSuccess: (r) => { setNotice({ kind: 'success', text: r?.message || 'Collection started.' }); qc.invalidateQueries({ queryKey: ['device', id] }); },
    onError: (err) => setNotice({ kind: 'error', text: errorText(err, 'Collection could not be started.') }),
  });

  const [credOpen, setCredOpen] = useState(false);
  const [cred, setCred] = useState({ username: '', secret: '', auth_type: 'password' });
  const [credError, setCredError] = useState<string | null>(null);
  const saveCred = useMutation({
    mutationFn: async () => (await apiClient.post(`/api/devices/${id}/credentials`, cred)).data,
    onSuccess: () => { setCredOpen(false); setCred({ username: '', secret: '', auth_type: 'password' }); qc.invalidateQueries({ queryKey: ['device', id] }); setNotice({ kind: 'success', text: 'SSH credentials saved (encrypted).' }); },
    onError: (err) => setCredError(errorText(err, 'The credentials could not be saved.')),
  });

  const notFound = (q.error as any)?.response?.status === 404;
  const row = (k: string, v: React.ReactNode) => (<div className="flex justify-between gap-4 py-1.5"><dt className="text-slate-600">{k}</dt><dd className="m-0 text-right font-medium">{v}</dd></div>);

  return (
    <div className="space-y-5">
      <Link to="/devices" className="pxl-focus inline-flex items-center gap-1 text-[14px] font-semibold text-blue-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Devices</Link>
      {notFound ? (
        <PixelPanel fill="paper" bodyClassName="p-6"><h1 className="m-0 text-[22px] font-bold">Device not found</h1><p className="m-0 mt-2 text-slate-600">There is no device with this ID.</p></PixelPanel>
      ) : (
        <DataBoundary what="the device" isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
          {d && (
            <>
              <PageHeader
                title={d.hostname}
                description={`${d.vendor} ${d.model} · ${d.device_group?.name ?? 'No zone'}`}
                actions={
                  <>
                    {canPoll && d.collection_mode === 'SSH_POLL' && <PixelButton onClick={() => poll.mutate()} loading={poll.isPending} icon={<Play size={16} />}>Collect now</PixelButton>}
                    {isAdmin && <PixelButton variant="ghost" onClick={() => { setCredError(null); setCredOpen(true); }} icon={<KeyRound size={16} />}>SSH credentials</PixelButton>}
                  </>
                }
              />
              {notice && <PixelToast kind={notice.kind} title={notice.text} onClose={() => setNotice(null)} />}

              <div className="grid gap-5 lg:grid-cols-2">
                <PixelPanel fill="paper" header={<PixelRibbon as="h2">Device</PixelRibbon>} bodyClassName="px-4 py-3 text-[15px]">
                  <dl className="m-0">
                    {row('IP address', <span className="pxl-mono">{d.ip_address}</span>)}
                    {row('Status', d.status)}
                    {row('Collection', <ModeBadge mode={d.collection_mode} shadow={d.shadow_mode} />)}
                    {row('Last collected', d.last_polled_at ? fmtTime(d.last_polled_at) : 'Never')}
                    {row('Latest snapshot', d.latest_snapshot ? `${fmtTime(d.latest_snapshot.collected_at)} (${d.latest_snapshot.collection_method})` : 'None yet')}
                    {row('SSH credentials', d.has_credentials ? 'Stored (encrypted)' : 'Not stored')}
                  </dl>
                </PixelPanel>

                <PixelPanel fill="paper" header={<PixelRibbon as="h2" trailing={<span className="text-[14px]">{(problems.data ?? []).length} open</span>}>Open problems</PixelRibbon>} bodyClassName="p-4">
                  {problems.error ? <p role="alert" className="m-0 text-red-700">Could not load the problems for this device.</p>
                    : (problems.data ?? []).length === 0 ? <p className="m-0 text-slate-600">No open problems. This device matches its approved settings.</p>
                    : (
                      <PixelTable caption="Open problems">
                        <PixelThead><tr><PixelTh>Problem</PixelTh><PixelTh>Risk</PixelTh><PixelTh>Found</PixelTh><PixelTh><span className="sr-only">Open</span></PixelTh></tr></PixelThead>
                        <PixelTbody>
                          {(problems.data ?? []).map((e) => (
                            <PixelTr key={e.id}>
                              <PixelTd><PixelBadge taxonomy={e.label} size="sm" /></PixelTd>
                              <PixelTd>{e.risk_score}</PixelTd>
                              <PixelTd className="whitespace-nowrap">{fmtTime(e.detected_at)}</PixelTd>
                              <PixelTd><Link to={`/drift/${e.id}`} className="pxl-focus font-semibold text-blue-700 hover:underline">Review</Link></PixelTd>
                            </PixelTr>
                          ))}
                        </PixelTbody>
                      </PixelTable>
                    )}
                </PixelPanel>
              </div>

              <LegacyCoexistenceCard
                deviceId={d.id}
                hostname={d.hostname}
                collectionMode={d.collection_mode}
                shadowMode={!!d.shadow_mode}
                isAdmin={isAdmin}
                canUpload={canPoll}
                onChanged={() => { q.refetch(); problems.refetch(); }}
              />

              <PixelModal open={credOpen} onClose={() => setCredOpen(false)} title="SSH credentials" size="sm">
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setCredError(null); saveCred.mutate(); }}>
                  <PixelInput label="Username" required autoComplete="off" value={cred.username} onChange={(e) => setCred({ ...cred, username: e.target.value })} />
                  <PixelSelect label="Sign in with" value={cred.auth_type} onChange={(e) => setCred({ ...cred, auth_type: e.target.value })}>
                    <option value="password">Password</option>
                    <option value="ssh_key">SSH private key</option>
                  </PixelSelect>
                  <div>
                    <label htmlFor="cred-secret" className="mb-1 block text-[14px] font-medium">{cred.auth_type === 'ssh_key' ? 'Private key' : 'Password'}</label>
                    {cred.auth_type === 'ssh_key' ? (
                      <textarea id="cred-secret" required rows={6} autoComplete="off" spellCheck={false} value={cred.secret} onChange={(e) => setCred({ ...cred, secret: e.target.value })} className="pxl-field pxl-focus pxl-mono" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                    ) : (
                      <input id="cred-secret" type="password" required autoComplete="new-password" value={cred.secret} onChange={(e) => setCred({ ...cred, secret: e.target.value })} className="pxl-field pxl-focus" />
                    )}
                    <p className="m-0 mt-1 text-[13px] text-slate-600">Stored encrypted. It is never shown again and is sent exactly as typed.</p>
                  </div>
                  {credError && <p role="alert" className="m-0 text-[14px] font-medium text-red-700">{credError}</p>}
                  <div className="flex justify-end gap-3 border-t border-slate-200 pt-3">
                    <PixelButton variant="ghost" onClick={() => setCredOpen(false)}>Cancel</PixelButton>
                    <PixelButton type="submit" loading={saveCred.isPending}>Save credentials</PixelButton>
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
