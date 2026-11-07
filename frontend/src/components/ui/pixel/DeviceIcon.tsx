import React from 'react';
import { Network, Router, ShieldCheck, Wifi } from 'lucide-react';

export type DeviceKind = 'switch' | 'router' | 'firewall' | 'ap';

const PX = 8; // icon size per scale step

/** Icon for a device type (switch, router, firewall, access point). Decorative unless a label is given. */
export const DeviceIcon: React.FC<{ type: string; scale?: number; label?: string; className?: string }> = ({ type, scale = 2, label, className }) => {
  const t = type.toLowerCase();
  const Icon = t.includes('router') ? Router : t.includes('fire') || t.includes('shield') ? ShieldCheck : t === 'ap' || t.includes('access') || t.includes('wireless') ? Wifi : Network;
  return <Icon size={PX * scale + 2} strokeWidth={2} className={className} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
};
