import React, { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Eye, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiClient } from '../api/client';

export type CollectionMode = 'SSH_POLL' | 'MANUAL_UPLOAD' | 'PAUSED';

const MODE_STYLES: Record<string, string> = {
  SSH_POLL: 'bg-sky-50 text-sky-700 border-sky-200',
  MANUAL_UPLOAD: 'bg-violet-50 text-violet-700 border-violet-200',
  PAUSED: 'bg-slate-100 text-slate-600 border-slate-200',
};

const MODE_LABELS: Record<string, string> = {
  SSH_POLL: 'SSH polling',
  MANUAL_UPLOAD: 'Manual upload',
  PAUSED: 'Paused',
};

export const ModeBadge: React.FC<{ mode: string; shadow: boolean }> = ({ mode, shadow }) => (
  <span className="inline-flex items-center gap-1">
    <span
      className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${MODE_STYLES[mode] || MODE_STYLES.PAUSED}`}
    >
      {MODE_LABELS[mode] || mode}
    </span>
    {shadow && (
      <span className="px-2 py-0.5 rounded text-[11px] font-semibold border bg-amber-50 text-amber-700 border-amber-200">
        Shadow
      </span>
    )}
  </span>
);

interface UploadResult {
  snapshot_id: string;
  snapshot_status: string;
  drift_label: string | null;
  risk_score: number | null;
  message: string;
}

interface Props {
  deviceId: string;
  hostname: string;
  collectionMode: string;
  shadowMode: boolean;
  isAdmin: boolean;
  canUpload: boolean;
  onChanged: () => void;
}

const MAX_BYTES = 1_048_576;

export const LegacyCoexistenceCard: React.FC<Props> = ({
  deviceId,
  hostname,
  collectionMode,
  shadowMode,
  isAdmin,
  canUpload,
  onChanged,
}) => {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [configText, setConfigText] = useState('');
  const [filename, setFilename] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState('');
  const [note, setNote] = useState('');
  const [allowMismatch, setAllowMismatch] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    onChanged();
    queryClient.invalidateQueries({ queryKey: ['deviceDrifts', deviceId] });
    queryClient.invalidateQueries({ queryKey: ['devices'] });
    queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/api/devices/${deviceId}/config-upload`, {
        config_text: configText,
        captured_at: capturedAt ? new Date(capturedAt).toISOString() : null,
        source_filename: filename,
        note: note.trim() || null,
        allow_hostname_mismatch: allowMismatch,
      });
      return res.data as UploadResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      setConfigText('');
      setFilename(null);
      setNote('');
      setAllowMismatch(false);
      if (fileInput.current) fileInput.current.value = '';
      refresh();
    },
    onError: (err: any) => {
      setResult(null);
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : err.message || 'Upload failed.');
    },
  });

  const modeMutation = useMutation({
    mutationFn: async (payload: { collection_mode?: string; shadow_mode?: boolean }) => {
      const res = await apiClient.put(`/api/devices/${deviceId}/collection-mode`, payload);
      return res.data;
    },
    onSuccess: refresh,
    onError: (err: any) => setError(err.response?.data?.detail || err.message || 'Mode change failed.'),
  });

  const handleFile = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(`File is ${(file.size / 1024).toFixed(0)} KiB; the limit is ${MAX_BYTES / 1024} KiB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setConfigText(String(reader.result ?? ''));
      setFilename(file.name);
    };
    reader.readAsText(file);
  };

  const uploadBlocked = collectionMode === 'PAUSED';

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-violet-600" />
          <h3 className="font-semibold text-slate-800 text-sm">Legacy Workflow Coexistence</h3>
          <ModeBadge mode={collectionMode} shadow={shadowMode} />
        </div>

        {isAdmin && (
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 text-slate-600">
              <span>Collection mode</span>
              <select
                value={collectionMode}
                disabled={modeMutation.isPending}
                onChange={(e) => modeMutation.mutate({ collection_mode: e.target.value })}
                className="px-2 py-1 border border-slate-300 rounded-lg bg-white text-slate-800"
              >
                <option value="SSH_POLL">SSH polling</option>
                <option value="MANUAL_UPLOAD">Manual upload</option>
                <option value="PAUSED">Paused</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-slate-600" title="Report-only: never push remediation to this device">
              <input
                type="checkbox"
                checked={shadowMode}
                disabled={modeMutation.isPending}
                onChange={(e) => modeMutation.mutate({ shadow_mode: e.target.checked })}
              />
              <Eye className="h-3.5 w-3.5" />
              <span>Shadow (report-only)</span>
            </label>
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Upload a <span className="font-mono">show running-config</span> captured from the console or a legacy backup
        system. It goes through the same normalisation, drift scoring and change-ticket matching as SSH-collected
        configurations. Remediation is never pushed to Shadow or non-SSH devices; apply approved commands on the
        console, then upload the resulting config to verify.
      </p>

      {canUpload ? (
        <div className="space-y-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept=".cfg,.conf,.txt,.config,text/plain"
              onChange={(e) => handleFile(e.target.files?.[0])}
              className="text-xs text-slate-600"
            />
            <label className="flex items-center gap-1.5 text-slate-600">
              <span>Captured at</span>
              <input
                type="datetime-local"
                value={capturedAt}
                onChange={(e) => setCapturedAt(e.target.value)}
                className="px-2 py-1 border border-slate-300 rounded-lg"
              />
            </label>
          </div>

          <textarea
            value={configText}
            onChange={(e) => {
              setConfigText(e.target.value);
              setFilename(null);
            }}
            placeholder={`Paste the running-config for ${hostname} here, or choose a file above`}
            rows={8}
            spellCheck={false}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-[11px] text-slate-800 focus:outline-none focus:border-violet-500"
          />

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={256}
              placeholder="Note (e.g. console capture after lab maintenance)"
              className="flex-1 min-w-[220px] px-3 py-2 border border-slate-300 rounded-lg"
            />
            <label className="flex items-center gap-1.5 text-slate-600">
              <input type="checkbox" checked={allowMismatch} onChange={(e) => setAllowMismatch(e.target.checked)} />
              <span>Allow hostname mismatch</span>
            </label>
            <button
              type="button"
              onClick={() => uploadMutation.mutate()}
              disabled={uploadMutation.isPending || !configText.trim() || uploadBlocked}
              className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors shadow-sm"
            >
              <Upload className="h-4 w-4" />
              <span>{uploadMutation.isPending ? 'Analysing...' : 'Upload & Analyse'}</span>
            </button>
          </div>
          {uploadBlocked && (
            <p className="text-amber-600">This device is paused. Change the collection mode to resume uploads.</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-400">Viewers cannot upload configurations.</p>
      )}

      {error && (
        <div className="p-3 rounded-lg border bg-rose-50 border-rose-200 text-rose-800 text-xs flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {result && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
            result.snapshot_status === 'PARSE_ERROR'
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p>{result.message}</p>
            {result.drift_label && (
              <p className="mt-0.5 font-semibold">
                {result.drift_label} (risk score {result.risk_score})
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
