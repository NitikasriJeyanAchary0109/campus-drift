import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Wrench, ShieldAlert, FileText } from 'lucide-react';

export const DriftDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/drift"
            className="p-2 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Drift Evidence Bundle</h2>
            <p className="text-sm text-slate-500">Event ID: {id || 'drift-sample-1'}</p>
          </div>
        </div>

        <Link
          to="/remediation"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Wrench className="h-4 w-4" />
          <span>Generate Remediation Plan</span>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-rose-600" />
            <span>Risk Assessment</span>
          </h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Classification</span>
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800 font-sans">
                Drift-Unauthorized-High
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Risk Score</span>
              <span className="font-bold text-rose-600">85 / 100</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Evidence Required</span>
              <span className="text-emerald-600 font-semibold">Yes (Score ≥ 80)</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Matching Ticket</span>
              <span className="text-slate-400">None found</span>
            </div>
          </div>
        </div>

        <div className="md:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <FileText className="h-4 w-4 text-sky-600" />
            <span>Config Diff & Key Path</span>
          </h3>
          <div className="bg-slate-900 text-slate-100 p-4 rounded-lg font-mono text-xs space-y-2">
            <p className="text-slate-400"># Key-Path: line.vty.transport_input</p>
            <p className="text-rose-400">- actual: "telnet" (INSECURE)</p>
            <p className="text-emerald-400">+ expected: "ssh"</p>
          </div>
        </div>
      </div>
    </div>
  );
};
