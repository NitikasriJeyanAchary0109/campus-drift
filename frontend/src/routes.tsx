import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { restoreSession } from './api/client';
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
import { RefreshCw } from 'lucide-react';

const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isRestoring } = useAuthStore();
  const location = useLocation();

  if (isRestoring) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 space-y-4">
        <RefreshCw className="h-8 w-8 text-sky-500 animate-spin" />
        <p className="text-sm font-medium">Validating secure session with server...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

const PublicOnlyRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isRestoring } = useAuthStore();

  if (isRestoring) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 space-y-4">
        <RefreshCw className="h-8 w-8 text-sky-500 animate-spin" />
        <p className="text-sm font-medium">Validating secure session with server...</p>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
};

const RoleRoute: React.FC<{
  allowedRoles: Array<'Admin' | 'NetworkEngineer' | 'Viewer'>;
  children: React.ReactElement;
}> = ({ allowedRoles, children }) => {
  const { user } = useAuthStore();
  const role = user?.role || 'Viewer';

  if (!allowedRoles.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

export const AppRoutes: React.FC = () => {
  useEffect(() => {
    // Silently restore session on boot using httpOnly cookie
    restoreSession();
  }, []);

  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <Login />
          </PublicOnlyRoute>
        }
      />

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
        <Route
          path="remediation"
          element={
            <RoleRoute allowedRoles={['Admin', 'NetworkEngineer']}>
              <Remediation />
            </RoleRoute>
          }
        />
        <Route
          path="approvals"
          element={
            <RoleRoute allowedRoles={['Admin', 'NetworkEngineer']}>
              <ApprovalQueue />
            </RoleRoute>
          }
        />
        <Route path="alerts" element={<Alerts />} />
        <Route
          path="audit"
          element={
            <RoleRoute allowedRoles={['Admin']}>
              <AuditLogs />
            </RoleRoute>
          }
        />
        <Route
          path="settings"
          element={
            <RoleRoute allowedRoles={['Admin']}>
              <Settings />
            </RoleRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};


