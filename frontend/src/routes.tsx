import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { Login } from './pages/Login';
import { RouteLoading } from './components/RouteState';

// Every route except Login is loaded on demand, so the sign-in page only downloads what it needs.
const page = <T extends Record<string, React.ComponentType<any>>>(load: () => Promise<T>, name: keyof T) =>
  React.lazy(() => load().then((m) => ({ default: m[name] })));

const Layout = page(() => import('./components/Layout'), 'Layout');
const Dashboard = page(() => import('./pages/Dashboard'), 'Dashboard');
const Devices = page(() => import('./pages/Devices'), 'Devices');
const DeviceDetails = page(() => import('./pages/DeviceDetails'), 'DeviceDetails');
const Baselines = page(() => import('./pages/Baselines'), 'Baselines');
const BaselineDetails = page(() => import('./pages/BaselineDetails'), 'BaselineDetails');
const DriftEvents = page(() => import('./pages/DriftEvents'), 'DriftEvents');
const DriftDetails = page(() => import('./pages/DriftDetails'), 'DriftDetails');
const Remediation = page(() => import('./pages/Remediation'), 'Remediation');
const ApprovalQueue = page(() => import('./pages/ApprovalQueue'), 'ApprovalQueue');
const Alerts = page(() => import('./pages/Alerts'), 'Alerts');
const AuditLogs = page(() => import('./pages/AuditLogs'), 'AuditLogs');
const Settings = page(() => import('./pages/Settings'), 'Settings');
const Tickets = page(() => import('./pages/Tickets'), 'Tickets');
const NotFound = page(() => import('./pages/StatePages'), 'NotFound');
const Forbidden = page(() => import('./pages/StatePages'), 'Forbidden');

const PageFallback: React.FC = () => <RouteLoading message="Loading..." />;

// Development-only component gallery: the condition is a build-time constant, so production builds drop it.
const UiKit = import.meta.env.DEV ? React.lazy(() => import('./pages/dev/UiKit').then((m) => ({ default: m.UiKit }))) : null;

type Role = 'Admin' | 'NetworkEngineer' | 'Viewer';
/** Show a page only to the roles that may use it (the API checks the same rule on every call). */
const RequireRole: React.FC<{ roles: Role[]; children: React.ReactElement }> = ({ roles, children }) => {
  const role = useAuthStore((s) => s.user?.role) as Role | undefined;
  return role && roles.includes(role) ? children : <Forbidden />;
};
const EDITORS: Role[] = ['Admin', 'NetworkEngineer'];

const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isLoadingAuth, initAuth } = useAuthStore();
  const location = useLocation();

  React.useEffect(() => {
    if (isLoadingAuth) {
      initAuth();
    }
  }, [isLoadingAuth, initAuth]);

  if (isLoadingAuth) {
    return <RouteLoading fullScreen message="Restoring secure session..." />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

export const AppRoutes: React.FC = () => {
  return (
    <React.Suspense fallback={<PageFallback />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      {UiKit && <Route path="/dev/ui" element={<UiKit />} />}

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
        <Route path="tickets" element={<Tickets />} />
        <Route path="drift" element={<DriftEvents />} />
        <Route path="drift/:id" element={<DriftDetails />} />
        <Route path="remediation" element={<RequireRole roles={EDITORS}><Remediation /></RequireRole>} />
        <Route path="approvals" element={<RequireRole roles={EDITORS}><ApprovalQueue /></RequireRole>} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="audit" element={<RequireRole roles={['Admin']}><AuditLogs /></RequireRole>} />
        <Route path="settings" element={<RequireRole roles={['Admin']}><Settings /></RequireRole>} />
        <Route path="*" element={<NotFound />} />
      </Route>

    </Routes>
    </React.Suspense>
  );
};

