import React from 'react';
import { Shield, Clock } from 'lucide-react';

export const Settings: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">System Settings</h2>
        <p className="text-sm text-slate-500">Configure polling schedules, credentials vault pointers, and RBAC policy parameters.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Clock className="h-4 w-4 text-sky-600" />
            <span>Scheduler Configuration</span>
          </h3>
          <p className="text-xs text-slate-500">APScheduler handles scheduled pulls directly in the FastAPI process.</p>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-700">Default Device Polling Interval</label>
            <input
              type="text"
              defaultValue="Every 15 minutes (crontab: */15 * * * *)"
              disabled
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-600"
            />
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Shield className="h-4 w-4 text-sky-600" />
            <span>Security & RBAC</span>
          </h3>
          <p className="text-xs text-slate-500">Token lifetimes and privilege tier controls.</p>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Access Token Expiry</span>
              <span className="font-mono font-medium text-slate-700">15 minutes</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Refresh Token Window</span>
              <span className="font-mono font-medium text-slate-700">7 days</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Credential Vault</span>
              <span className="font-mono font-medium text-emerald-600">Encrypted at rest (Fernet)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
