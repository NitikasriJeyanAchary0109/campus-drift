import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ShieldAlert } from 'lucide-react';

export const BaselineDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/baselines"
            className="p-2 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Baseline Rules</h2>
            <p className="text-sm text-slate-500">Version details for ID: {id}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800 text-sm">Rules Definition (Hybrid YAML + Pydantic)</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] tracking-wider border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-semibold">Key Path</th>
                <th className="py-3 px-4 font-semibold">Rule Type</th>
                <th className="py-3 px-4 font-semibold">Expected Value</th>
                <th className="py-3 px-4 font-semibold">Weight</th>
                <th className="py-3 px-4 font-semibold">Hard Compliance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono text-xs">
              <tr>
                <td className="py-3 px-4 text-sky-600 font-medium">line.vty.transport_input</td>
                <td className="py-3 px-4">EXACT</td>
                <td className="py-3 px-4">ssh</td>
                <td className="py-3 px-4">90</td>
                <td className="py-3 px-4">
                  <span className="inline-flex items-center gap-1 text-rose-600 font-sans font-semibold">
                    <ShieldAlert className="h-3.5 w-3.5" /> YES
                  </span>
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 text-sky-600 font-medium">snmp.community.public.exists</td>
                <td className="py-3 px-4">MUST_NOT_EXIST</td>
                <td className="py-3 px-4">false</td>
                <td className="py-3 px-4">95</td>
                <td className="py-3 px-4">
                  <span className="inline-flex items-center gap-1 text-rose-600 font-sans font-semibold">
                    <ShieldAlert className="h-3.5 w-3.5" /> YES
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
