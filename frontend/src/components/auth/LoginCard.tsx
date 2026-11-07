import React from 'react';
import { Eye, EyeOff, User, Lock, Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import type { DemoAccount } from './demoRoles';
import '../ui/pixel/theme';
import { PixelButton } from '../ui/pixel/PixelButton';
import { PixelInput } from '../ui/pixel/PixelInput';

interface Props {
  username: string;
  password: string;
  showPassword: boolean;
  error: string | null;
  isLoading: boolean;
  /** Demo accounts to offer; an empty list (demo mode off) hides the role cards and every credential. */
  roles: readonly DemoAccount[];
  onUsername: (v: string) => void;
  onPassword: (v: string) => void;
  onToggleShow: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onPreset: (account: { username: string; password: string }) => void;
}

/** The sign-in card: heading, credential fields, error alert, submit button and (in demo mode) the sample roles. */
export const LoginCard: React.FC<Props> = (p) => (
  <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-lg">
    <header className="mb-6 flex items-center gap-3">
      <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-600 text-white">
        <ShieldCheck size={24} strokeWidth={2.2} />
      </span>
      <div>
        <h1 className="m-0 text-[24px] font-bold leading-tight text-slate-900">Welcome back!</h1>
        <p className="m-0 text-[14px] text-slate-600">Sign in to access the DriftWatch workspace.</p>
      </div>
    </header>

    <form onSubmit={p.onSubmit} className="flex flex-col gap-4">
      <PixelInput
        label="Username"
        icon={<User size={18} />}
        type="text"
        autoComplete="username"
        value={p.username}
        onChange={(e) => p.onUsername(e.target.value)}
        placeholder="Enter your username"
        required
        disabled={p.isLoading}
      />
      <PixelInput
        label="Password"
        icon={<Lock size={18} />}
        type={p.showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        value={p.password}
        onChange={(e) => p.onPassword(e.target.value)}
        placeholder="Enter your password"
        required
        disabled={p.isLoading}
        trailing={
          <button
            type="button"
            onClick={p.onToggleShow}
            aria-label={p.showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={p.showPassword}
            className="pxl-focus rounded p-1 text-slate-500 hover:text-slate-900"
          >
            {p.showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        }
      />

      {p.error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[14px] font-medium text-red-800">
          <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{p.error}</span>
        </div>
      )}

      <PixelButton type="submit" size="lg" disabled={p.isLoading} className="w-full">
        {p.isLoading ? (
          <>
            <Loader2 className="animate-spin" size={18} aria-hidden="true" />
            <span>Signing in...</span>
          </>
        ) : (
          <span>Sign in to workspace</span>
        )}
      </PixelButton>
    </form>

    {p.roles.length > 0 && (
      <section aria-labelledby="demo-access" className="mt-6 border-t border-slate-200 pt-5">
        <h2 id="demo-access" className="m-0 text-[14px] font-semibold text-slate-900">Quick demo access</h2>
        <p className="m-0 mb-3 text-[13px] text-slate-600">Explore the platform with a sample role.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {p.roles.map((r) => {
            const Icon = r.icon;
            const selected = p.username === r.username;
            const credentials = `${r.username} / ${r.password}`;
            return (
              <button
                key={r.username}
                type="button"
                onClick={() => p.onPreset({ username: r.username, password: r.password })}
                aria-pressed={selected}
                aria-label={`${r.role} demo account ${credentials}. ${r.description}`}
                className={`pxl-focus flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${selected ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
              >
                <span className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-900">
                  <Icon size={16} aria-hidden="true" className="text-blue-600" />
                  {r.role}
                </span>
                <span className="font-mono text-[12px] text-slate-600">({credentials})</span>
                <span className="text-[12px] leading-snug text-slate-600">{r.description}</span>
              </button>
            );
          })}
        </div>
      </section>
    )}

    <p className="m-0 mt-6 text-center text-[12px] text-slate-500">JWT authentication · Role-based access · Campus IT operations</p>
  </div>
);
