import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { apiClient } from '../api/client';
import { User, Lock, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';

import driftwatchHero from '../assets/driftwatch-hero.png';
import foxAvatar from '../assets/fox-avatar.png';
import shieldDivider from '../assets/shield-divider.png';

export const Login: React.FC = () => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await apiClient.post('/api/auth/login', {
        username,
        password,
      });

      const { access_token, user } = response.data;
      setAuth(access_token, {
        id: user.id,
        username: user.username,
        role: user.role,
        is_active: user.is_active,
      });

      navigate('/');
    } catch (err: any) {
      const message =
        err.response?.data?.detail ||
        err.message ||
        'Authentication failed. Please check your credentials.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const setPreset = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#009fff] flex flex-col justify-center items-center p-2 sm:p-4 select-none">
      {/* Main retro gaming card container */}
      <div className="w-full max-w-[1060px] bg-[#009fff] flex flex-col lg:flex-row items-center justify-center gap-3 sm:gap-4">
        
        {/* Left Side: Pixel Art Scene & Mascot Showcase */}
        <div className="w-full lg:w-[58%] flex items-center justify-center">
          <div className="relative w-full overflow-hidden rounded-2xl border-4 border-black shadow-[4px_4px_0_#000] bg-sky-400">
            <img
              src={driftwatchHero}
              alt="DriftWatch Campus Network Configuration-Drift Detector"
              className="w-full h-auto object-cover block"
            />
          </div>
        </div>

        {/* Right Side: Welcome Back Cartridge / Interactive Form */}
        <div className="w-full lg:w-[42%] flex items-center justify-center">
          <div className="w-full max-w-[460px] bg-[#f6f4ee] rounded-3xl border-4 border-black p-3 sm:p-4 shadow-[4px_4px_0_#000] relative">
            
            {/* Corner Screw Accents */}
            <div className="absolute top-2 left-2.5 w-3 h-3 rounded-full border border-[#8c7b64] flex items-center justify-center text-[8px] font-mono text-[#8c7b64] leading-none">✕</div>
            <div className="absolute top-2 right-2.5 w-3 h-3 rounded-full border border-[#8c7b64] flex items-center justify-center text-[8px] font-mono text-[#8c7b64] leading-none">✕</div>
            <div className="absolute bottom-2 left-2.5 w-3 h-3 rounded-full border border-[#8c7b64] flex items-center justify-center text-[8px] font-mono text-[#8c7b64] leading-none">✕</div>
            <div className="absolute bottom-2 right-2.5 w-3 h-3 rounded-full border border-[#8c7b64] flex items-center justify-center text-[8px] font-mono text-[#8c7b64] leading-none">✕</div>

            {/* Inset dashed frame */}
            <div className="border border-dashed border-[#d8c7b0] rounded-2xl p-3 sm:p-4 flex flex-col gap-3">
              
              {/* Header: Fox Avatar + WELCOME BACK! */}
              <div className="flex items-center gap-2.5 pt-1">
                <div className="shrink-0 w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center">
                  <img
                    src={foxAvatar}
                    alt="DriftWatch Fox Mascot"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-xl sm:text-2xl font-black text-[#111827] tracking-tight font-display leading-tight uppercase">
                    WELCOME BACK!
                  </h1>
                  <p className="text-[11px] sm:text-xs text-[#4b5563] font-medium leading-snug">
                    Sign in to access the DriftWatch workspace.
                  </p>
                  <p className="text-[9px] font-bold text-[#f3271c] uppercase tracking-wider font-retro">
                    Campus Drift Detector
                  </p>
                </div>
              </div>

              {/* Error Message Alert */}
              {error && (
                <div className="p-2 rounded-lg bg-red-100 border-2 border-red-500 text-red-700 text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                  <span className="font-semibold">{error}</span>
                </div>
              )}

              {/* Login Form */}
              <form onSubmit={handleLogin} className="space-y-2.5">
                {/* Username Input */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-bold text-[#1f2937] uppercase tracking-wide mb-1">
                    <User className="h-3.5 w-3.5 text-[#eab308] fill-[#eab308]" />
                    <span>Username</span>
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your username"
                    className="w-full bg-white border-2 border-[#1f2937] rounded-xl px-3.5 py-2 text-sm text-[#111827] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#f3271c] font-medium shadow-inner"
                    required
                    disabled={isLoading}
                  />
                </div>

                {/* Password Input */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-bold text-[#1f2937] uppercase tracking-wide mb-1">
                    <Lock className="h-3.5 w-3.5 text-[#eab308] fill-[#eab308]" />
                    <span>Password</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full bg-white border-2 border-[#1f2937] rounded-xl px-3.5 py-2 pr-10 text-sm text-[#111827] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#f3271c] font-medium shadow-inner"
                      required
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-gray-500 hover:text-black transition-colors"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Chunky Arcade Submit Button */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-2.5 sm:py-3 bg-[#f3271c] hover:bg-[#dc2626] active:translate-y-0.5 text-white font-black text-sm sm:text-base tracking-wider rounded-xl border-[2.5px] border-black shadow-[0_4px_0_#991b1b] active:shadow-[0_1px_0_#991b1b] transition-all flex items-center justify-center gap-2 font-display uppercase mt-3"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>SIGNING IN...</span>
                    </>
                  ) : (
                    <>
                      <span>SIGN IN TO WORKSPACE</span>
                      <span className="text-base sm:text-lg leading-none">➔</span>
                    </>
                  )}
                </button>
              </form>

              {/* Shield Divider */}
              <div className="relative flex items-center justify-center my-0.5">
                <div className="w-full border-t border-[#d8c7b0]"></div>
                <div className="absolute px-2 bg-[#f6f4ee]">
                  <img src={shieldDivider} alt="DriftWatch Shield" className="h-6 w-auto object-contain" />
                </div>
              </div>

              {/* Quick Demo Access Header */}
              <div className="flex flex-col items-center">
                <div className="inline-flex items-center gap-1.5 px-3 py-0.5 bg-[#fecd04] border-2 border-black rounded-md shadow-[2px_2px_0_#000]">
                  <span className="text-[#854d0e] text-[10px] leading-none">✨</span>
                  <span className="text-[10px] sm:text-[11px] font-black text-black uppercase tracking-wider font-pixel">
                    QUICK DEMO ACCESS
                  </span>
                  <span className="text-[#854d0e] text-[10px] leading-none">✨</span>
                </div>
                <p className="text-[11px] text-[#4b5563] font-medium mt-1">
                  Explore the platform with a sample role.
                </p>
              </div>

              {/* 3 Chunky Demo Role Cards */}
              <div className="grid grid-cols-3 gap-2">
                {/* 1. ADMIN */}
                <button
                  type="button"
                  onClick={() => setPreset('admin', 'admin123')}
                  className={`group rounded-xl border-2 border-black overflow-hidden flex flex-col text-left transition-transform active:scale-95 shadow-[2px_2px_0_#000] hover:-translate-y-0.5 ${
                    username === 'admin' ? 'ring-2 ring-black ring-offset-1' : ''
                  }`}
                >
                  <div className="bg-[#ec1b16] py-1 px-1.5 text-center text-white flex flex-col items-center">
                    <span className="text-base leading-tight">👑</span>
                    <span className="font-black text-[11px] tracking-wider uppercase font-display leading-tight">ADMIN</span>
                    <span className="text-[8px] text-red-100 font-mono leading-none">(admin / admin123)</span>
                  </div>
                  <div className="bg-white p-1.5 flex-1 flex items-center justify-center text-center">
                    <span className="text-[9px] text-[#1f2937] font-semibold leading-tight">
                      Full control, approvals & rollback
                    </span>
                  </div>
                </button>

                {/* 2. NETWORK ENGINEER */}
                <button
                  type="button"
                  onClick={() => setPreset('neteng', 'neteng123')}
                  className={`group rounded-xl border-2 border-black overflow-hidden flex flex-col text-left transition-transform active:scale-95 shadow-[2px_2px_0_#000] hover:-translate-y-0.5 ${
                    username === 'neteng' ? 'ring-2 ring-black ring-offset-1' : ''
                  }`}
                >
                  <div className="bg-[#02a3f4] py-1 px-1.5 text-center text-white flex flex-col items-center">
                    <span className="text-base leading-tight">⚙️</span>
                    <span className="font-black text-[9px] sm:text-[10px] tracking-wider uppercase font-display leading-tight text-center">NETWORK ENGINEER</span>
                    <span className="text-[8px] text-sky-100 font-mono leading-none">(neteng / neteng123)</span>
                  </div>
                  <div className="bg-white p-1.5 flex-1 flex items-center justify-center text-center">
                    <span className="text-[9px] text-[#1f2937] font-semibold leading-tight">
                      Plan, sweep & configuration uploads
                    </span>
                  </div>
                </button>

                {/* 3. VIEWER */}
                <button
                  type="button"
                  onClick={() => setPreset('viewer', 'viewer123')}
                  className={`group rounded-xl border-2 border-black overflow-hidden flex flex-col text-left transition-transform active:scale-95 shadow-[2px_2px_0_#000] hover:-translate-y-0.5 ${
                    username === 'viewer' ? 'ring-2 ring-black ring-offset-1' : ''
                  }`}
                >
                  <div className="bg-[#40c534] py-1 px-1.5 text-center text-white flex flex-col items-center">
                    <span className="text-base leading-tight">👁️</span>
                    <span className="font-black text-[11px] tracking-wider uppercase font-display leading-tight">VIEWER</span>
                    <span className="text-[8px] text-emerald-100 font-mono leading-none">(viewer / viewer123)</span>
                  </div>
                  <div className="bg-white p-1.5 flex-1 flex items-center justify-center text-center">
                    <span className="text-[9px] text-[#1f2937] font-semibold leading-tight">
                      Read-only auditing & reports
                    </span>
                  </div>
                </button>
              </div>

              {/* Bottom Footer Info Bar */}
              <div className="pt-2 mt-0.5 border-t border-[#e2d6c3] flex items-center justify-center gap-1.5 text-[8.5px] sm:text-[9.5px] font-bold text-[#4b5563] tracking-wide uppercase">
                <span className="text-xs">💾</span>
                <span>JWT AUTHENTICATION</span>
                <span className="text-[#9ca3af]">|</span>
                <span>ROLE-BASED ACCESS</span>
                <span className="text-[#9ca3af]">|</span>
                <span>CAMPUS IT OPERATIONS</span>
              </div>

            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
