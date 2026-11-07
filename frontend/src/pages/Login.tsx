import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { apiClient } from '../api/client';
import { errorText } from '../lib/errors';
import { LoginCard } from '../components/auth/LoginCard';
import { DEMO_ACCOUNTS } from '../components/auth/demoRoles';
import { ShieldCheck, Search, BarChart3, CheckCircle2, Wrench } from 'lucide-react';

/** Demo role cards are only offered when VITE_DEMO_MODE=true (in development builds an unset value counts as true). */
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true' || (import.meta.env.VITE_DEMO_MODE === undefined && import.meta.env.DEV);
// An empty list (demo mode off) means the credentials are not referenced, so the bundler drops them from production builds.
const ROLES = DEMO_MODE ? DEMO_ACCOUNTS : [];

export const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
      setError(errorText(err, 'Authentication failed. Please check your credentials.'));
    } finally {
      setIsLoading(false);
    }
  };

  const setPreset = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError(null);
  };

  const STEPS = [
    { label: 'Detect', text: 'Poll devices and normalise every configuration.', icon: Search },
    { label: 'Analyze', text: 'Diff against the approved baseline and score the risk.', icon: BarChart3 },
    { label: 'Approve', text: 'Match change tickets and require a second approver.', icon: CheckCircle2 },
    { label: 'Remediate', text: 'Push a backed-up, verified fix, or roll back.', icon: Wrench },
  ] as const;

  return (
    <div className="pxl-app flex min-h-screen">
      <section aria-label="DriftWatch overview" role="region" className="hidden w-[46%] max-w-[640px] flex-col justify-center gap-8 bg-slate-900 px-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-600"><ShieldCheck size={24} strokeWidth={2.2} /></span>
          <span className="text-[22px] font-bold tracking-tight">DRIFT<span className="text-blue-400">WATCH</span></span>
        </div>
        <div>
          <h2 className="m-0 text-[30px] font-bold leading-tight">Campus network configuration-drift detector</h2>
          <p className="m-0 mt-3 text-[16px] leading-relaxed text-slate-300">Know when a device leaves its approved baseline, why it matters, and fix it under four-eyes control.</p>
        </div>
        <ol className="m-0 flex list-none flex-col gap-4 p-0">
          {STEPS.map(({ label, text, icon: Icon }) => (
            <li key={label} className="flex items-start gap-3">
              <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-800 text-blue-300"><Icon size={18} /></span>
              <span><span className="block text-[15px] font-semibold">{label}</span><span className="block text-[14px] text-slate-300">{text}</span></span>
            </li>
          ))}
        </ol>
      </section>
      <main className="flex flex-1 items-center justify-center bg-slate-100 p-6">
        <LoginCard
          username={username}
          password={password}
          showPassword={showPassword}
          error={error}
          isLoading={isLoading}
          roles={ROLES}
          onUsername={setUsername}
          onPassword={setPassword}
          onToggleShow={() => setShowPassword((v) => !v)}
          onSubmit={handleLogin}
          onPreset={(r) => setPreset(r.username, r.password)}
        />
      </main>
    </div>
  );
};
