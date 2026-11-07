import React from 'react';

/** Loading state shown while the session is restored and while a page chunk downloads. Part of the first download, so it uses utility classes only. */
export const RouteLoading: React.FC<{ message: string; fullScreen?: boolean }> = ({ message, fullScreen }) => (
  <div
    role="status"
    className={`flex flex-col items-center justify-center gap-3 bg-slate-100 px-4 text-center text-slate-700 ${fullScreen ? 'min-h-screen' : 'min-h-[40vh]'}`}
  >
    <span aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-300 border-t-blue-600 motion-reduce:animate-none" />
    <p className="m-0 text-sm font-medium">{message}</p>
  </div>
);
