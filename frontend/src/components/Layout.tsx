import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export const Layout: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#009fff] flex flex-col justify-between overflow-x-hidden relative">
      <Topbar />

      <div className="flex flex-1 items-start px-2 sm:px-4 py-2 gap-3 max-w-[1400px] w-full mx-auto">
        <Sidebar />
        <main className="flex-1 min-w-0 pb-4">
          <Outlet />
        </main>
      </div>

      {/* Retro Red Brick Foundation Footer */}
      <footer className="h-6 w-full bg-[#b91c1c] border-t-2 border-black flex items-center justify-between px-4 text-[9px] font-pixel text-red-200 select-none">
        <span>CAMPUS DRIFT DETECTOR</span>
        <span>AUTOMATED REMEDIATION ENGINE</span>
      </footer>
    </div>
  );
};
