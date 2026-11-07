import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import './shell.css';
import './ui/pixel/theme';
import { PixelToaster } from './ui/pixel/PixelToast';

/** The signed-in shell: top bar, sidebar on every page, content area and a slim footer. */
export const Layout: React.FC = () => {
  const { pathname } = useLocation();
  return (
    <PixelToaster>
      <div className="pxl-app relative flex min-h-screen flex-col overflow-x-hidden">
        <Topbar />

        <div className="mx-auto flex w-full max-w-[1480px] flex-1 items-start gap-5 px-3 py-5 sm:px-6">
          <Sidebar />
          <main id="main" className="min-w-0 flex-1 pb-4">
            <ErrorBoundary resetKey={pathname}><Outlet /></ErrorBoundary>
          </main>
        </div>

        <footer className="select-none border-t border-slate-200 bg-white">
          <div className="mx-auto flex w-full max-w-[1480px] items-center justify-between gap-3 px-4 py-3 text-[12px] font-medium tracking-wide text-slate-500 sm:px-6">
            <span>CAMPUS DRIFT DETECTOR</span>
            <span className="hidden sm:inline">AUTOMATED REMEDIATION ENGINE</span>
          </div>
        </footer>
      </div>
    </PixelToaster>
  );
};
