import React from 'react';
import { CheckSquare, CheckCircle, XCircle } from 'lucide-react';

export const ApprovalQueue: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Remediation Approval Queue</h2>
          <p className="text-sm text-slate-500">Explicit sign-off gate for Admin and Network Engineer roles prior to live device push.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center gap-2">
          <CheckSquare className="h-4 w-4 text-emerald-600" />
          <h3 className="font-semibold text-slate-800 text-sm">Pending Remediation Plans</h3>
        </div>

        <div className="p-6">
          <div className="border border-slate-200 rounded-lg p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">
                  PENDING APPROVAL
                </span>
                <span className="text-xs text-slate-500">Plan #REM-001</span>
              </div>
              <h4 className="font-medium text-slate-800 text-sm">Enforce SSH on Classroom Switch sw-01</h4>
              <p className="text-xs text-slate-500 mt-1">Pre-change backup will be created automatically before execution.</p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors"
              >
                <CheckCircle className="h-3.5 w-3.5" />
                <span>Approve</span>
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-medium transition-colors"
              >
                <XCircle className="h-3.5 w-3.5" />
                <span>Reject</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
