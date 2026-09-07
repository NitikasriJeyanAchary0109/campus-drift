import React from 'react';
import { Bell, Check } from 'lucide-react';

export const Alerts: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">System Alerts</h2>
          <p className="text-sm text-slate-500">Critical notifications on drift events, device reachability, and remediation failures.</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="bg-white p-4 rounded-xl border border-rose-200 shadow-sm flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-rose-50 text-rose-600 rounded-lg shrink-0 mt-0.5">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 uppercase">
                  Critical Drift
                </span>
                <span className="text-xs text-slate-400">Just now</span>
              </div>
              <h4 className="font-semibold text-sm text-slate-800 mt-1">
                Hard compliance rule violation on Classroom core switch
              </h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Public SNMP community string detected in active running configuration.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-medium shrink-0 transition-colors"
          >
            <Check className="h-3.5 w-3.5" />
            <span>Acknowledge</span>
          </button>
        </div>
      </div>
    </div>
  );
};
