import React from 'react';
import { Server, AlertTriangle, ShieldCheck, Clock, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export const Dashboard: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Campus Network Overview</h2>
          <p className="text-sm text-slate-500">Live configuration drift and compliance status across all campus zones.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/drift"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <span>View Drift Events</span>
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Devices</span>
            <Server className="h-5 w-5 text-sky-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900">0</div>
          <p className="text-xs text-slate-400 mt-1">Classrooms, Hostels, Labs, Offices</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Compliance Rate</span>
            <ShieldCheck className="h-5 w-5 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-emerald-600">100%</div>
          <p className="text-xs text-slate-400 mt-1">Against active baseline rules</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Drifts</span>
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900">0</div>
          <p className="text-xs text-slate-400 mt-1">Pending review & remediation</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Pending Approvals</span>
            <Clock className="h-5 w-5 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900">0</div>
          <p className="text-xs text-slate-400 mt-1">Gated remediation plans</p>
        </div>
      </div>

      {/* Main Content Areas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4">Compliance Trends</h3>
          <div className="h-64 flex items-center justify-center border-2 border-dashed border-slate-200 rounded-lg text-slate-400 text-sm">
            Trend chart will activate in Phase 7 (/api/dashboard/summary)
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4">Campus Device Groups</h3>
          <ul className="space-y-3 text-sm">
            {['Classrooms', 'Hostels', 'Administrative Offices', 'Research Labs', 'Public Events'].map((zone) => (
              <li key={zone} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <span className="font-medium text-slate-700">{zone}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-600 font-mono">Standby</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
