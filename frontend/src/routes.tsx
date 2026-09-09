import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Devices } from './pages/Devices';
import { DeviceDetails } from './pages/DeviceDetails';
import { Baselines } from './pages/Baselines';
import { BaselineDetails } from './pages/BaselineDetails';
import { DriftEvents } from './pages/DriftEvents';
import { DriftDetails } from './pages/DriftDetails';
import { Remediation } from './pages/Remediation';
import { ApprovalQueue } from './pages/ApprovalQueue';
import { Alerts } from './pages/Alerts';
import { AuditLogs } from './pages/AuditLogs';
import { Settings } from './pages/Settings';

const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isLoadingAuth, initAuth } = useAuthStore();
  const location = useLocation();

  React.useEffect(() => {
    if (isLoadingAuth) {
      initAuth();
    }
  }, [isLoadingAuth, initAuth]);

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300">
        <div className="flex items-center gap-3">
          <span className="h-5 w-5 rounded-full border-2 border-sky-500 border-t-transparent animate-spin"></span>
          <span className="text-sm font-medium">Restoring secure session...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="devices" element={<Devices />} />
        <Route path="devices/:id" element={<DeviceDetails />} />
        <Route path="baselines" element={<Baselines />} />
        <Route path="baselines/:id" element={<BaselineDetails />} />
        <Route path="drift" element={<DriftEvents />} />
        <Route path="drift/:id" element={<DriftDetails />} />
        <Route path="remediation" element={<Remediation />} />
        <Route path="approvals" element={<ApprovalQueue />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="audit" element={<AuditLogs />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

