import React, { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, LogOut, User } from 'lucide-react';
import shieldLogo from '../assets/shield-divider.png';
import pixelCloud from '../assets/pixel-cloud.png';

export const Topbar: React.FC = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="h-16 bg-[#009fff] px-3 sm:px-6 flex items-center justify-between shrink-0 select-none relative z-20">
      {/* Left: Logo & Subtitle Ribbon */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div
          className="flex items-center gap-2 cursor-pointer hover:opacity-95 transition-opacity"
          onClick={() => navigate('/')}
        >
          <img
            src={shieldLogo}
            alt="DriftWatch Shield"
            className="h-8 w-auto object-contain drop-shadow-[2px_2px_0_#000]"
          />
          <span className="font-black text-xl sm:text-2xl text-white tracking-wider font-display drop-shadow-[2px_2px_0_#000]">
            DRIFT<span className="text-[#facc15]">WATCH</span>
          </span>
        </div>

        {/* Ribbon: Campus Network Configuration-Drift Detector */}
        <div className="hidden md:inline-flex items-center px-3 py-1 bg-white border-2 border-black rounded-md shadow-[2px_2px_0_#000] text-xs font-black tracking-wide font-display">
          <span>Campus Network Configuration-</span>
          <span className="text-[#ef4444]">Drift Detector</span>
        </div>
      </div>

      {/* Center Pixel Cloud (Decor) */}
      <div className="hidden lg:block absolute left-1/2 -translate-x-1/2 top-2 pointer-events-none opacity-90">
        <img src={pixelCloud} alt="Cloud" className="h-8 w-auto" />
      </div>

      {/* Right: Notifications & User Capsule */}
      <div className="flex items-center gap-3">
        {/* Notification Bell with Red Badge */}
        <button
          type="button"
          onClick={() => navigate('/alerts')}
          className="relative p-2 bg-[#fecd04] hover:bg-[#eab308] border-2 border-black rounded-xl shadow-[2px_2px_0_#000] active:translate-y-0.5 transition-all"
          title="Active Alerts"
        >
          <Bell className="h-4 w-4 text-black fill-black" />
          <span className="absolute -top-1.5 -right-1.5 h-4 w-4 bg-[#ef4444] text-white border border-black rounded-full text-[9px] font-black flex items-center justify-center font-pixel">
            3
          </span>
        </button>

        {/* User Capsule */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 px-3 py-1 bg-white border-2 border-black rounded-xl shadow-[2px_2px_0_#000] hover:bg-slate-50 transition-all text-left"
          >
            <div className="w-6 h-6 rounded-full bg-[#fecd04] border border-black flex items-center justify-center">
              <User className="h-3.5 w-3.5 text-black" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-extrabold text-xs text-black uppercase font-display">
                {user?.role || 'Admin'}
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {user?.username || 'admin'}
              </span>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-slate-600 ml-0.5" />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-44 bg-[#f6f4ee] border-2 border-black rounded-xl shadow-[4px_4px_0_#000] p-1.5 z-30 font-display">
              <div className="px-2.5 py-1.5 border-b border-[#d8c7b0] text-xs">
                <p className="font-bold text-black uppercase">{user?.username || 'admin'}</p>
                <p className="text-[10px] text-slate-500 font-mono">{user?.role || 'Admin'}</p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full mt-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-bold text-rose-600 hover:bg-rose-100 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
