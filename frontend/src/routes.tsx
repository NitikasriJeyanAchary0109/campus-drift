import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
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

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route path="/" element={<Layout />}>
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
