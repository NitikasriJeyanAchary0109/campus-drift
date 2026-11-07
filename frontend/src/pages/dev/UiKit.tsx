import React, { useState } from 'react';
import { Search, Server, ShieldCheck, AlertTriangle, Activity, Wrench } from 'lucide-react';
import {
  PixelPanel, PixelCard, PixelButton, PixelInput, PixelSelect, PixelCheckbox, PixelBadge, PixelTable, PixelThead, PixelTbody, PixelTr, PixelTh, PixelTd,
  PixelTabs, PixelTabPanel, PixelModal, PixelToast, PixelToaster, useToast, PixelTooltip, PixelPagination, PixelSkeleton, PixelEmptyState, PixelProgress, PixelSteps,
  PixelStat, PixelRibbon, DeviceIcon, LABEL_ORDER, labelStyle,
} from '../../components/ui/pixel';
import type { PixelButtonVariant } from '../../components/ui/pixel';
import { RouteLoading } from '../../components/RouteState';

const VARIANTS: PixelButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'success'];
const SWATCHES = ['ink', 'navy', 'cream', 'paper', 'sky', 'sky-2', 'grass', 'brick', 'mortar', 'yellow', 'red', 'red-ui', 'crimson', 'orange', 'blue', 'blue-ui', 'green', 'green-dark', 'gray-light', 'gray-dark'];

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section data-kit={title} className="mb-8">
    <PixelPanel header={<PixelRibbon as="h2">{title}</PixelRibbon>} bodyClassName="p-4">{children}</PixelPanel>
  </section>
);
const Cell: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col items-start gap-2"><span className="text-[12px] font-medium text-dw-muted">{label}</span>{children}</div>
);

const Toasts: React.FC = () => {
  const t = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <PixelButton variant="success" size="sm" onClick={() => t.success('Baseline approved', 'Version 4 is now active.')}>Success toast</PixelButton>
      <PixelButton variant="danger" size="sm" onClick={() => t.error('Push failed', 'The device refused the change.')}>Error toast</PixelButton>
      <PixelButton variant="secondary" size="sm" onClick={() => t.info('Poll queued')}>Info toast</PixelButton>
    </div>
  );
};

/** Development only (route /dev/ui, compiled out of production builds): every pixel component in every state. */
export const UiKit: React.FC = () => {
  const [tab, setTab] = useState('one');
  const [modal, setModal] = useState(false);
  const [page, setPage] = useState(2);
  const [size, setSize] = useState(10);
  const [checked, setChecked] = useState(true);
  return (
    <PixelToaster>
      <main className="pxl-app min-h-screen p-4 sm:p-8">
        <h1 className="pxl-title-font m-0 mb-1 text-[32px]">DriftWatch UI kit</h1>
        <p className="mb-6 mt-0 text-dw-muted">Development only. Tokens, components and states shared by every page.</p>

        <Section title="Palette">
          <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
            {SWATCHES.map((s) => (
              <li key={s} className="w-24 text-center text-[12px]">
                <div className="h-12 rounded-lg border-[3px] border-dw-ink" style={{ background: `var(--dw-${s})` }} />
                {s}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Type, outlines, shadows, corners">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <p className="pxl-pixel-font m-0 text-[14px]">PIXEL DISPLAY: BADGES, RIBBONS</p>
              <p className="pxl-title-font m-0 text-[24px]">Heavy rounded: page titles and labels</p>
              <p className="m-0 text-[15px]">Regular readable sans for table cells, form text and paragraphs. Never the pixel font.</p>
              <p className="pxl-mono m-0 text-[14px]">monospace for configs and diffs: interface Gi0/1</p>
            </div>
            <div className="flex flex-wrap items-end gap-6">
              {[1, 2, 3].map((n) => (
                <Cell key={n} label={`outline ${[2, 3, 4][n - 1]}px, shadow ${[2, 4, 6][n - 1]}px`}>
                  <div className="h-14 w-24 bg-dw-paper" style={{ border: `var(--pxl-line-${n}) solid var(--dw-ink)`, boxShadow: `var(--pxl-shadow-${n})` }} />
                </Cell>
              ))}
              <Cell label="notched corner"><PixelPanel bodyClassName="h-14 w-24" shadow={2} /></Cell>
            </div>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="grid gap-4">
            {VARIANTS.map((v) => (
              <div key={v} className="flex flex-wrap items-end gap-5">
                <Cell label={`${v} default`}><PixelButton variant={v}>{v}</PixelButton></Cell>
                <Cell label="hover"><PixelButton variant={v} className="pxl-force-hover">{v}</PixelButton></Cell>
                <Cell label="focus"><PixelButton variant={v} className="pxl-force-focus">{v}</PixelButton></Cell>
                <Cell label="active"><PixelButton variant={v} pressed>{v}</PixelButton></Cell>
                <Cell label="disabled"><PixelButton variant={v} disabled>{v}</PixelButton></Cell>
                <Cell label="loading"><PixelButton variant={v} loading>{v}</PixelButton></Cell>
                <Cell label="with icon, sm"><PixelButton variant={v} size="sm" icon={<Wrench size={16} />}>{v}</PixelButton></Cell>
              </div>
            ))}
            <div className="flex items-end gap-5">
              <Cell label="size lg"><PixelButton size="lg">Large</PixelButton></Cell>
              <Cell label="disabled with tooltip"><PixelTooltip focusable content="Needs a second approver (four-eyes)."><PixelButton disabled>Apply</PixelButton></PixelTooltip></Cell>
            </div>
          </div>
        </Section>

        <Section title="Fields">
          <div className="grid gap-5 md:grid-cols-3">
            <Cell label="default"><PixelInput label="Hostname" placeholder="core-sw-01" icon={<Search size={18} />} /></Cell>
            <Cell label="focus"><PixelInput label="Hostname" defaultValue="core-sw-01" className="pxl-force-focus" /></Cell>
            <Cell label="hover"><PixelInput label="Hostname" defaultValue="core-sw-01" className="bg-white" /></Cell>
            <Cell label="disabled"><PixelInput label="Hostname" defaultValue="core-sw-01" disabled /></Cell>
            <Cell label="error"><PixelInput label="IP address" defaultValue="10.0.0" error="Enter a full IPv4 address." /></Cell>
            <Cell label="select"><PixelSelect label="Zone"><option>Classroom</option><option>Hostel</option></PixelSelect></Cell>
            <Cell label="select disabled"><PixelSelect label="Zone" disabled><option>Classroom</option></PixelSelect></Cell>
            <Cell label="select error"><PixelSelect label="Zone" error="Pick a zone."><option>Choose</option></PixelSelect></Cell>
            <div className="flex flex-col gap-3">
              <PixelCheckbox label="Checked" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              <PixelCheckbox label="Unchecked" defaultChecked={false} />
              <PixelCheckbox label="Indeterminate" indeterminate readOnly />
              <PixelCheckbox label="Disabled" disabled />
            </div>
          </div>
        </Section>

        <Section title="Badges: taxonomy (colour + icon + text)">
          <div className="flex flex-wrap gap-3">
            {LABEL_ORDER.map((k) => <PixelBadge key={k} taxonomy={k} />)}
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {LABEL_ORDER.map((k) => <PixelBadge key={k} taxonomy={k} verbose size="sm" />)}
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <PixelBadge tone="green" icon={Activity}>Online</PixelBadge>
            <PixelBadge tone="gray" dashed>Paused</PixelBadge>
            <PixelBadge tone="navy">Admin</PixelBadge>
          </div>
        </Section>

        <Section title="Stat tiles">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <PixelStat label="Total inventory" value={100} icon={Server} tone="blue" />
            <PixelStat label="Compliance" value="94%" icon={ShieldCheck} tone="green" hint="Target 95%" />
            <PixelStat label="Coverage gaps" value={7} icon={AlertTriangle} tone="yellow" />
            <PixelStat label="Active drifts" value={12} icon={Activity} tone="red" />
          </div>
        </Section>

        <Section title="Table, pagination">
          <PixelTable caption="Example devices">
            <PixelThead><tr><PixelTh>Device</PixelTh><PixelTh>Type</PixelTh><PixelTh>State</PixelTh></tr></PixelThead>
            <PixelTbody>
              {[['core-sw-01', 'switch', 'Compliant'], ['edge-rtr-02', 'router', 'Drift-Unauthorized-High'], ['lab-fw-01', 'firewall', 'NO_BASELINE'], ['ap-hostel-4', 'ap', 'Non-Compliant']].map(([n, t, l]) => (
                <PixelTr key={n} interactive tabIndex={0}>
                  <PixelTd><span className="inline-flex items-center gap-2"><DeviceIcon type={t} />{n}</span></PixelTd>
                  <PixelTd>{t}</PixelTd>
                  <PixelTd><PixelBadge taxonomy={l} /></PixelTd>
                </PixelTr>
              ))}
            </PixelTbody>
          </PixelTable>
          <PixelPagination className="mt-4" page={page} pageSize={size} total={96} onPageChange={setPage} pageSizeOptions={[10, 25, 50]} onPageSizeChange={setSize} />
        </Section>

        <Section title="Tabs, ribbon, panels">
          <PixelTabs label="Demo tabs" value={tab} onChange={setTab} tabs={[{ id: 'one', label: 'Overview' }, { id: 'two', label: 'Rules' }, { id: 'three', label: 'Disabled', disabled: true }]} />
          <PixelTabPanel id="one" active={tab === 'one'} className="pt-3">Overview panel content.</PixelTabPanel>
          <PixelTabPanel id="two" active={tab === 'two'} className="pt-3">Rules panel content.</PixelTabPanel>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <PixelPanel header={<PixelRibbon as="h3" trailing="3 items">Why this matters</PixelRibbon>} bodyClassName="p-4">A cream panel with a yellow ribbon header.</PixelPanel>
            <PixelCard interactive tabIndex={0} role="button">Interactive card (hover, focus, press)</PixelCard>
          </div>
        </Section>

        <Section title="Modal, toast, tooltip">
          <div className="flex flex-wrap items-center gap-4">
            <PixelButton onClick={() => setModal(true)}>Open modal</PixelButton>
            <PixelTooltip content="Tooltips show on hover and keyboard focus."><PixelButton variant="ghost">Hover or focus me</PixelButton></PixelTooltip>
            <Toasts />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <PixelToast kind="success" title="Saved" detail="Static example." />
            <PixelToast kind="error" title="Failed" detail="Static example." />
            <PixelToast kind="info" title="Heads up" detail="Static example." />
          </div>
          <PixelModal open={modal} onClose={() => setModal(false)} title="Mark as false positive" footer={<><PixelButton variant="ghost" onClick={() => setModal(false)}>Cancel</PixelButton><PixelButton onClick={() => setModal(false)}>Confirm</PixelButton></>}>
            <PixelInput label="Reason" placeholder="Why is this not drift?" />
          </PixelModal>
        </Section>

        <Section title="Progress, skeleton, stepper">
          <div className="grid gap-4 md:grid-cols-2">
            <PixelProgress label="Poll progress" value={35} showValue />
            <PixelProgress label="Compliance" value={100} tone="green" showValue />
            <PixelProgress label="Working" />
            <PixelProgress label="Failed" value={60} tone="red" showValue />
          </div>
          <PixelSteps className="mt-4" label="Remediation pipeline" steps={[{ id: 'b', label: 'Backup', state: 'done' }, { id: 'p', label: 'Push', state: 'active' }, { id: 'v', label: 'Verify', state: 'pending' }, { id: 'r', label: 'Rollback', state: 'failed', detail: 'Not needed' }]} />
          <div className="mt-4 max-w-md"><PixelSkeleton lines={3} height={18} /></div>
        </Section>

        <Section title="Empty, error and loading states, device icons">
          <div className="grid gap-4 md:grid-cols-3">
            <PixelEmptyState title="No drift events" description="Nothing has changed since the last poll." />
            <PixelEmptyState kind="error" title="Something went wrong" description="The API did not answer." action={<PixelButton size="sm">Retry</PixelButton>} />
            <PixelEmptyState kind="loading" title="Loading devices" />
          </div>
          <div className="mt-4 overflow-hidden rounded-lg border-[3px] border-dw-ink"><RouteLoading message="Restoring secure session..." /></div>
          <div className="mt-4 flex items-end gap-6">
            {['switch', 'router', 'firewall', 'ap'].map((t) => <Cell key={t} label={t}><DeviceIcon type={t} scale={4} /></Cell>)}
            <span className="text-[12px] text-dw-muted">{labelStyle('NO_BASELINE').label} uses a dashed outline</span>
          </div>
        </Section>
      </main>
    </PixelToaster>
  );
};
