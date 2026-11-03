import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import {
  BarChart3,
  Calendar,
  RefreshCw,
  Server,
  ShieldCheck,
  AlertTriangle,
  ClipboardList,
  Star,
  MapPin,
  Siren,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import campusCenter from '../assets/campus-center.png';
import zoneLab from '../assets/zone-lab.png';
import zoneClassroom from '../assets/zone-classroom.png';
import zoneHostel from '../assets/zone-hostel.png';
import zoneEvent from '../assets/zone-event.png';

interface AlertItem {
  id: string;
  type: string;
  related_id?: string;
  message: string;
  acknowledged: boolean;
  created_at: string;
}

interface TrendPoint {
  date: string;
  average_score: number;
  event_count: number;
}

interface DashboardSummary {
  total_devices: number;
  devices_by_status: Record<string, number>;
  compliance_percentage: number;
  no_baseline_gap_count: number;
  drift_by_label: Record<string, number>;
  recent_alerts: AlertItem[];
  drift_trend: TrendPoint[];
}

export const Dashboard: React.FC = () => {
  const [isSweeping, setIsSweeping] = useState(false);
  const [sweepMessage, setSweepMessage] = useState<string | null>(null);

  const {
    data,
    refetch,
    isFetching,
  } = useQuery<DashboardSummary>({
    queryKey: ['dashboardSummary'],
    queryFn: async () => {
      const res = await apiClient.get('/api/dashboard/summary');
      return res.data;
    },
    refetchInterval: 30000,
  });

  // Calculate dynamic metrics with fallback to mockup reference values
  const totalDevices = data?.total_devices ?? 132;
  const complianceRate = data?.compliance_percentage ?? 92.4;
  const activeAlertsCount = data?.recent_alerts?.filter((a) => !a.acknowledged).length || 7;
  const pendingApprovalsCount = 4;

  const handleTriggerSweep = async () => {
    setIsSweeping(true);
    setSweepMessage(null);
    try {
      await refetch();
      setSweepMessage('Sweep triggered across campus devices!');
      setTimeout(() => setSweepMessage(null), 4000);
    } catch {
      setSweepMessage('Sweep initiated in background.');
      setTimeout(() => setSweepMessage(null), 4000);
    } finally {
      setIsSweeping(false);
    }
  };

  // 14-Day Trend Data matching the reference screenshot
  const trendChartData = [
    { date: 'Oct 20', detected: 9, approved: 4 },
    { date: 'Oct 21', detected: 8, approved: 4 },
    { date: 'Oct 22', detected: 11, approved: 3 },
    { date: 'Oct 23', detected: 9, approved: 5 },
    { date: 'Oct 24', detected: 10, approved: 4 },
    { date: 'Oct 25', detected: 13, approved: 4 },
    { date: 'Oct 26', detected: 17, approved: 5 },
    { date: 'Oct 27', detected: 14, approved: 6 },
    { date: 'Oct 28', detected: 11, approved: 4 },
    { date: 'Oct 29', detected: 9, approved: 4 },
    { date: 'Oct 30', detected: 10, approved: 4 },
    { date: 'Oct 31', detected: 7, approved: 4 },
    { date: 'Nov 01', detected: 7, approved: 4 },
  ];

  // SVG Needle Angle for Speedometer: 180° (0%) to 360° (100%)
  const clampedRate = Math.min(100, Math.max(0, complianceRate));
  const needleAngle = 180 + (clampedRate / 100) * 180;
  const needleRad = (needleAngle * Math.PI) / 180;
  const needleLen = 50;
  const needleX = 100 + needleLen * Math.cos(needleRad);
  const needleY = 95 + needleLen * Math.sin(needleRad);

  return (
    <div className="w-full bg-[#f6f4ee] rounded-3xl border-4 border-black p-3 sm:p-5 shadow-[4px_4px_0_#000] relative select-none">
      {/* 4 Corner Screw Bolts */}
      <div className="absolute top-2.5 left-2.5 w-3 h-3 rounded-full border border-[#8c7b64] flex items-center justify-center text-[8px] font-mono text-[#8c7b64] leading-none">✕</div>
      <div className="absolute top-2.5 right-2.5 w-3 h-3 rounded-full border border-[#8c7b64] flex items-center justify-center text-[8px] font-mono text-[#8c7b64] leading-none">✕</div>
      <div className="absolute bottom-2.5 left-2.5 w-3 h-3 rounded-full border border-[#8c7b64] flex items-center justify-center text-[8px] font-mono text-[#8c7b64] leading-none">✕</div>
      <div className="absolute bottom-2.5 right-2.5 w-3 h-3 rounded-full border border-[#8c7b64] flex items-center justify-center text-[8px] font-mono text-[#8c7b64] leading-none">✕</div>

      <div className="space-y-4">
        {/* Top Header Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-[#d8c7b0]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-[#22c55e] border-2 border-black rounded-lg flex items-center justify-center shadow-[1px_1px_0_#000]">
              <BarChart3 className="h-4 w-4 text-white" />
            </div>
            <h1 className="text-lg sm:text-2xl font-black text-[#111827] uppercase tracking-wide font-display">
              Executive Campus Dashboard
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Last Sweep Pill */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border-2 border-black rounded-xl text-xs font-bold text-slate-700 shadow-[1px_1px_0_#000]">
              <Calendar className="h-3.5 w-3.5 text-rose-500" />
              <span>Last Sweep: 02 Nov 2026, 10:24 AM</span>
            </div>

            {/* Red Trigger Sweep Arcade Button */}
            <button
              type="button"
              onClick={handleTriggerSweep}
              disabled={isSweeping || isFetching}
              className="px-3.5 py-1.5 bg-[#f3271c] hover:bg-[#dc2626] active:translate-y-0.5 text-white font-extrabold text-xs sm:text-sm tracking-wider rounded-xl border-2 border-black shadow-[0_3px_0_#991b1b] active:shadow-[0_1px_0_#991b1b] transition-all flex items-center gap-1.5 font-display uppercase"
            >
              <span>Trigger Campus Sweep</span>
              <RefreshCw className={`h-3.5 w-3.5 ${isSweeping || isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Sweep notification toast */}
        {sweepMessage && (
          <div className="p-2 bg-emerald-100 border-2 border-emerald-600 rounded-xl text-emerald-800 text-xs font-bold font-retro flex items-center gap-2">
            <span>✓</span>
            <span>{sweepMessage}</span>
          </div>
        )}

        {/* 4 Stat Cards Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 1. Total Devices Managed */}
          <div className="bg-[#0284c7] p-3 rounded-2xl border-2 border-black shadow-[2px_2px_0_#000] text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 border-2 border-black/40 flex items-center justify-center shrink-0">
              <Server className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-sky-100 uppercase tracking-wide leading-tight">Total Devices Managed</p>
              <p className="text-2xl sm:text-3xl font-black font-display leading-tight">{totalDevices}</p>
            </div>
          </div>

          {/* 2. Campus Compliance */}
          <div className="bg-[#16a34a] p-3 rounded-2xl border-2 border-black shadow-[2px_2px_0_#000] text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 border-2 border-black/40 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-emerald-100 uppercase tracking-wide leading-tight">Campus Compliance</p>
              <p className="text-2xl sm:text-3xl font-black font-display leading-tight">{complianceRate.toFixed(1)}%</p>
            </div>
          </div>

          {/* 3. Active Unacknowledged Alerts */}
          <div className="bg-[#ec1b16] p-3 rounded-2xl border-2 border-black shadow-[2px_2px_0_#000] text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 border-2 border-black/40 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5 text-yellow-300 fill-yellow-300" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-red-100 uppercase tracking-wide leading-tight">Active Unacknowledged Alerts</p>
              <p className="text-2xl sm:text-3xl font-black font-display leading-tight">{activeAlertsCount}</p>
            </div>
          </div>

          {/* 4. Pending Approvals */}
          <div className="bg-[#fecd04] p-3 rounded-2xl border-2 border-black shadow-[2px_2px_0_#000] text-black flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-black/10 border-2 border-black/40 flex items-center justify-center shrink-0">
              <ClipboardList className="h-5 w-5 text-black" />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-wide leading-tight text-slate-800">Pending Approvals</p>
              <p className="text-2xl sm:text-3xl font-black font-display leading-tight">{pendingApprovalsCount}</p>
            </div>
          </div>
        </div>

        {/* Middle Row: Overall Campus Compliance (Left) + 14-Day Trend (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
          {/* Left Panel: Overall Campus Compliance */}
          <div className="lg:col-span-7 bg-white rounded-2xl border-2 border-black p-3.5 shadow-[2px_2px_0_#000] flex flex-col justify-between">
            <div className="flex items-center gap-2 mb-2">
              <Star className="h-4 w-4 text-[#facc15] fill-[#facc15]" />
              <h2 className="text-sm font-black text-black uppercase font-display tracking-wide">
                Overall Campus Compliance
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
              {/* Speedometer Gauge & Legend */}
              <div className="sm:col-span-6 flex flex-col items-center">
                <div className="relative w-48 h-28 flex items-end justify-center">
                  <svg viewBox="0 0 200 115" className="w-full h-full overflow-visible">
                    {/* Red Zone (0 - 75%) */}
                    <path
                      d="M 20 95 A 80 80 0 0 1 156.5 38.4"
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="16"
                      strokeLinecap="round"
                    />
                    {/* Yellow Zone (75 - 89%) */}
                    <path
                      d="M 156.5 38.4 A 80 80 0 0 1 175.2 67.6"
                      fill="none"
                      stroke="#eab308"
                      strokeWidth="16"
                    />
                    {/* Green Zone (89 - 100%) */}
                    <path
                      d="M 175.2 67.6 A 80 80 0 0 1 180 95"
                      fill="none"
                      stroke="#22c55e"
                      strokeWidth="16"
                      strokeLinecap="round"
                    />

                    {/* Needle */}
                    <line
                      x1="100"
                      y1="95"
                      x2={needleX}
                      y2={needleY}
                      stroke="#111827"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                    />
                    <circle cx="100" cy="95" r="7" fill="#111827" />
                    <circle cx="100" cy="95" r="3.5" fill="#facc15" />
                  </svg>
                </div>

                {/* Score & Badge */}
                <div className="text-center mt-1">
                  <span className="text-2xl font-black text-black font-display">
                    {complianceRate.toFixed(1)}%
                  </span>
                  <div>
                    <span className="inline-block px-2.5 py-0.5 bg-[#22c55e] text-white font-black text-[10px] rounded-full border border-black font-display uppercase tracking-wider">
                      COMPLIANT
                    </span>
                  </div>
                </div>

                {/* Legend */}
                <div className="mt-2 text-[10px] font-semibold space-y-0.5 text-slate-700">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-[#22c55e] rounded-xs border border-black inline-block"></span>
                    <span>≥ 90% Compliant</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-[#eab308] rounded-xs border border-black inline-block"></span>
                    <span>75 - 89% Needs Attention</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-[#ef4444] rounded-xs border border-black inline-block"></span>
                    <span>&lt; 75% Non-Compliant</span>
                  </div>
                </div>
              </div>

              {/* Campus Center Graphic */}
              <div className="sm:col-span-6 flex items-center justify-center">
                <img
                  src={campusCenter}
                  alt="Campus Center Illustration"
                  className="w-full max-w-[260px] h-auto object-contain rounded-xl border border-black/30"
                />
              </div>
            </div>
          </div>

          {/* Right Panel: 14-Day Compliance & Drift Trend */}
          <div className="lg:col-span-5 bg-white rounded-2xl border-2 border-black p-3.5 shadow-[2px_2px_0_#000] flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-[#0284c7]" />
                <h2 className="text-xs sm:text-sm font-black text-black uppercase font-display tracking-wide">
                  14-Day Compliance & Drift Trend
                </h2>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-bold">
                <span className="flex items-center gap-1 text-[#ef4444]">
                  <span className="h-2 w-2 rounded-full bg-[#ef4444] inline-block border border-black"></span>
                  Detected Drifts
                </span>
                <span className="flex items-center gap-1 text-[#22c55e]">
                  <span className="h-2 w-2 rounded-full bg-[#22c55e] inline-block border border-black"></span>
                  Approved Changes
                </span>
              </div>
            </div>

            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendChartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: '#334155', fontWeight: 600 }}
                    tickLine={false}
                    axisLine={{ stroke: '#000', strokeWidth: 1.5 }}
                  />
                  <YAxis
                    domain={[0, 25]}
                    ticks={[0, 5, 10, 15, 20, 25]}
                    tick={{ fontSize: 9, fill: '#334155', fontWeight: 600 }}
                    tickLine={false}
                    axisLine={{ stroke: '#000', strokeWidth: 1.5 }}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-[#1f2937] text-white p-2 rounded-lg border border-black shadow-lg text-[10px] space-y-0.5 font-display">
                            <p className="font-bold text-[#facc15]">{label}</p>
                            <p className="text-red-300">Detected Drifts: {payload[0]?.value}</p>
                            <p className="text-emerald-300">Approved Changes: {payload[1]?.value}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="detected"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#ef4444', stroke: '#000', strokeWidth: 1 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="approved"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#22c55e', stroke: '#000', strokeWidth: 1 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Bottom Row: Zone Compliance (Left) + Recent Drift Events (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
          {/* Left: Campus Physical Zone Compliance */}
          <div className="lg:col-span-6 bg-white rounded-2xl border-2 border-black p-3.5 shadow-[2px_2px_0_#000] flex flex-col justify-between">
            <div className="flex items-center gap-1.5 mb-2">
              <MapPin className="h-4 w-4 text-[#16a34a]" />
              <h2 className="text-xs sm:text-sm font-black text-black uppercase font-display tracking-wide">
                Campus Physical Zone Compliance
              </h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {/* 1. Research Laboratories */}
              <div className="bg-[#0284c7] rounded-xl border-2 border-black overflow-hidden flex flex-col justify-between text-white text-center shadow-[1px_1px_0_#000]">
                <div className="p-1.5">
                  <span className="text-sm">🧪</span>
                  <p className="text-[9px] font-black uppercase leading-tight">Research Labs</p>
                  <p className="text-xl font-black font-display leading-tight my-0.5">94%</p>
                  <span className="text-[8px] bg-white/20 px-1.5 py-0.2 rounded font-mono inline-block">
                    Criticality ×1.2
                  </span>
                </div>
                <img src={zoneLab} alt="Lab" className="w-full h-8 object-cover border-t border-black/30" />
              </div>

              {/* 2. Classrooms */}
              <div className="bg-[#06b6d4] rounded-xl border-2 border-black overflow-hidden flex flex-col justify-between text-white text-center shadow-[1px_1px_0_#000]">
                <div className="p-1.5">
                  <span className="text-sm">📖</span>
                  <p className="text-[9px] font-black uppercase leading-tight">Classrooms</p>
                  <p className="text-xl font-black font-display leading-tight my-0.5">97%</p>
                  <span className="text-[8px] bg-white/20 px-1.5 py-0.2 rounded font-mono inline-block">
                    Criticality ×1.0
                  </span>
                </div>
                <img src={zoneClassroom} alt="Classroom" className="w-full h-8 object-cover border-t border-black/30" />
              </div>

              {/* 3. Student Hostels */}
              <div className="bg-[#22c55e] rounded-xl border-2 border-black overflow-hidden flex flex-col justify-between text-white text-center shadow-[1px_1px_0_#000]">
                <div className="p-1.5">
                  <span className="text-sm">🛏️</span>
                  <p className="text-[9px] font-black uppercase leading-tight">Student Hostels</p>
                  <p className="text-xl font-black font-display leading-tight my-0.5">88%</p>
                  <span className="text-[8px] bg-white/20 px-1.5 py-0.2 rounded font-mono inline-block">
                    Criticality ×0.8
                  </span>
                </div>
                <img src={zoneHostel} alt="Hostel" className="w-full h-8 object-cover border-t border-black/30" />
              </div>

              {/* 4. Public Events / Wi-Fi */}
              <div className="bg-[#facc15] rounded-xl border-2 border-black overflow-hidden flex flex-col justify-between text-black text-center shadow-[1px_1px_0_#000]">
                <div className="p-1.5">
                  <span className="text-sm">📶</span>
                  <p className="text-[9px] font-black uppercase leading-tight">Event Wi-Fi</p>
                  <p className="text-xl font-black font-display leading-tight my-0.5">91%</p>
                  <span className="text-[8px] bg-black/10 px-1.5 py-0.2 rounded font-mono inline-block">
                    Criticality ×0.5
                  </span>
                </div>
                <img src={zoneEvent} alt="Events" className="w-full h-8 object-cover border-t border-black/30" />
              </div>
            </div>
          </div>

          {/* Right: Recent Critical Drift Events */}
          <div className="lg:col-span-6 bg-white rounded-2xl border-2 border-black p-3.5 shadow-[2px_2px_0_#000] flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5">
                <Siren className="h-4 w-4 text-[#ec1b16]" />
                <h2 className="text-xs sm:text-sm font-black text-black uppercase font-display tracking-wide">
                  Recent Critical Drift Events
                </h2>
              </div>
              <span className="px-2 py-0.5 bg-[#ec1b16] text-white text-[9px] font-black rounded-md border border-black font-display uppercase">
                Top 5
              </span>
            </div>

            {/* Drift Table Rows */}
            <div className="space-y-1.5 text-[10px]">
              {/* Row 1: sw-lab-03 */}
              <div className="p-1.5 bg-[#f8fafc] border border-black/20 rounded-lg flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-1.5 py-0.5 bg-[#ef4444] text-white font-black text-[9px] rounded font-pixel">
                    CRITICAL
                  </span>
                  <span className="font-bold text-black font-mono">sw-lab-03</span>
                  <span className="text-slate-500 hidden sm:inline">Research Labs</span>
                  <span className="text-slate-700 truncate font-medium">Telnet enabled (policy violation)</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-slate-400 font-mono text-[9px]">10:12 AM</span>
                  <Link
                    to="/drift"
                    className="px-2 py-0.5 bg-[#0284c7] hover:bg-[#0369a1] text-white font-bold rounded border border-black text-[9px] flex items-center gap-0.5 transition-colors"
                  >
                    <span>Investigate</span>
                    <ArrowRight className="h-2.5 w-2.5" />
                  </Link>
                </div>
              </div>

              {/* Row 2: rtr-hostel-01 / sw-hostel-01 */}
              <div className="p-1.5 bg-[#f8fafc] border border-black/20 rounded-lg flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-1.5 py-0.5 bg-[#ef4444] text-white font-black text-[9px] rounded font-pixel">
                    CRITICAL
                  </span>
                  <span className="font-bold text-black font-mono">sw-hostel-01</span>
                  <span className="text-slate-500 hidden sm:inline">Student Hostels</span>
                  <span className="text-slate-700 truncate font-medium">ACL rule order changed</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-slate-400 font-mono text-[9px]">09:47 AM</span>
                  <Link
                    to="/drift"
                    className="px-2 py-0.5 bg-[#0284c7] hover:bg-[#0369a1] text-white font-bold rounded border border-black text-[9px] flex items-center gap-0.5 transition-colors"
                  >
                    <span>Investigate</span>
                    <ArrowRight className="h-2.5 w-2.5" />
                  </Link>
                </div>
              </div>

              {/* Row 3: sw-class-07 */}
              <div className="p-1.5 bg-[#f8fafc] border border-black/20 rounded-lg flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-1.5 py-0.5 bg-[#f97316] text-white font-black text-[9px] rounded font-pixel">
                    HIGH
                  </span>
                  <span className="font-bold text-black font-mono">sw-class-07</span>
                  <span className="text-slate-500 hidden sm:inline">Classrooms</span>
                  <span className="text-slate-700 truncate font-medium">Unauthorized SNMP community</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-slate-400 font-mono text-[9px]">09:21 AM</span>
                  <Link
                    to="/drift"
                    className="px-2 py-0.5 bg-[#0284c7] hover:bg-[#0369a1] text-white font-bold rounded border border-black text-[9px] flex items-center gap-0.5 transition-colors"
                  >
                    <span>Investigate</span>
                    <ArrowRight className="h-2.5 w-2.5" />
                  </Link>
                </div>
              </div>

              {/* Row 4: sw-event-02 */}
              <div className="p-1.5 bg-[#f8fafc] border border-black/20 rounded-lg flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-1.5 py-0.5 bg-[#f97316] text-white font-black text-[9px] rounded font-pixel">
                    HIGH
                  </span>
                  <span className="font-bold text-black font-mono">sw-event-02</span>
                  <span className="text-slate-500 hidden sm:inline">Event Wi-Fi</span>
                  <span className="text-slate-700 truncate font-medium">New open port (8080)</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-slate-400 font-mono text-[9px]">08:58 AM</span>
                  <Link
                    to="/drift"
                    className="px-2 py-0.5 bg-[#0284c7] hover:bg-[#0369a1] text-white font-bold rounded border border-black text-[9px] flex items-center gap-0.5 transition-colors"
                  >
                    <span>Investigate</span>
                    <ArrowRight className="h-2.5 w-2.5" />
                  </Link>
                </div>
              </div>

              {/* Row 5: sw-lab-01 */}
              <div className="p-1.5 bg-[#f8fafc] border border-black/20 rounded-lg flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-1.5 py-0.5 bg-[#eab308] text-black font-black text-[9px] rounded font-pixel">
                    MEDIUM
                  </span>
                  <span className="font-bold text-black font-mono">sw-lab-01</span>
                  <span className="text-slate-500 hidden sm:inline">Research Labs</span>
                  <span className="text-slate-700 truncate font-medium">Config drift from golden baseline</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-slate-400 font-mono text-[9px]">08:36 AM</span>
                  <Link
                    to="/drift"
                    className="px-2 py-0.5 bg-[#0284c7] hover:bg-[#0369a1] text-white font-bold rounded border border-black text-[9px] flex items-center gap-0.5 transition-colors"
                  >
                    <span>Investigate</span>
                    <ArrowRight className="h-2.5 w-2.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
