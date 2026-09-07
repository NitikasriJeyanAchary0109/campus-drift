import React from 'react';
import { ScrollText, Shield } from 'lucide-react';

export const AuditLogs: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-100 rounded-lg text-slate-700">
            <ScrollText className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Immutable Audit Trail</h2>
            <p className="text-sm text-slate-500">Append-only record of all configuration state changes, approvals, and remediation actions.</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold">
          <Shield className="h-4 w-4" />
          <span>Append-Only Enforced</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] tracking-wider border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-semibold">Timestamp (UTC)</th>
                <th className="py-3 px-4 font-semibold">User</th>
                <th className="py-3 px-4 font-semibold">Action</th>
                <th className="py-3 px-4 font-semibold">Target Type</th>
                <th className="py-3 px-4 font-semibold">Target ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono text-xs">
              <tr>
                <td className="py-3 px-4 text-slate-500">2026-09-07T05:30:00Z</td>
                <td className="py-3 px-4 font-semibold text-slate-700 font-sans">system_scheduler</td>
                <td className="py-3 px-4 text-sky-600">POLL_COMPLETED</td>
                <td className="py-3 px-4 font-sans">device</td>
                <td className="py-3 px-4 text-slate-400">dev-core-01</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
