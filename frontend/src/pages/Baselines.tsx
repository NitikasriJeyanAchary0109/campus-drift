import React from 'react';
import { FileCheck2, Plus, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

export const Baselines: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-sky-50 rounded-lg text-sky-600">
            <FileCheck2 className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Approved Baselines</h2>
            <p className="text-sm text-slate-500">Gold-standard configuration rules per campus device group and vendor.</p>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span>New Baseline Version</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-100 text-sky-800">v3 (Active)</span>
              <span className="text-xs text-slate-400">cisco_ios</span>
            </div>
            <h3 className="text-lg font-bold text-slate-800">Classroom-Core-Baseline</h3>
            <p className="text-xs text-slate-500 mt-1">Target Group: Classroom Network Devices</p>
            <div className="mt-4 flex items-center gap-2 text-xs text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              <span>4 Rules defined (SSH, SNMP, PortSec, NTP)</span>
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end">
            <Link
              to="/baselines/sample-base-1"
              className="text-sm font-medium text-sky-600 hover:text-sky-700"
            >
              View Rules & YAML →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
