import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Server, History } from 'lucide-react';

export const DeviceDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/devices"
            className="p-2 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Device Overview</h2>
            <p className="text-sm text-slate-500 font-mono">ID: {id || 'dev-sample'}</p>
          </div>
        </div>

        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          <span>Trigger Poll</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Server className="h-4 w-4 text-sky-600" />
            <span>Hardware & Location</span>
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Hostname</span>
              <span className="font-mono font-medium text-slate-800">sw-core-classroom-01</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">IP Address</span>
              <span className="font-mono font-medium text-slate-800">10.10.1.1</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Vendor</span>
              <span className="font-medium text-slate-800">cisco_ios</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Device Group</span>
              <span className="font-medium text-slate-800">Classroom (Weight: 1.0)</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Status</span>
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">ONLINE</span>
            </div>
          </div>
        </div>

        <div className="md:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <History className="h-4 w-4 text-sky-600" />
            <span>Configuration Snapshots</span>
          </h3>
          <div className="h-48 flex items-center justify-center border-2 border-dashed border-slate-200 rounded-lg text-slate-400 text-sm">
            Snapshots and collection history will appear in Phase 3 & 4
          </div>
        </div>
      </div>
    </div>
  );
};
