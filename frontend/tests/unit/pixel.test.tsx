import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  PixelButton, PixelBadge, PixelTabs, PixelTabPanel, PixelModal, PixelTooltip, PixelPagination, PixelProgress, PixelSteps, PixelStat, PixelInput, PixelSelect,
  PixelCheckbox, PixelTable, PixelThead, PixelTh, PixelTbody, PixelTr, PixelTd, PixelToaster, useToast, PixelEmptyState, PixelSkeleton, DeviceIcon, LABEL_ORDER, LABEL_STYLES, labelStyle,
} from '../../src/components/ui/pixel';
import { pageWindow } from '../../src/components/ui/pixel/pageWindow';

describe('semantic colour mapping (one table)', () => {
  it('maps every taxonomy label to the agreed colour, with an icon and text', () => {
    const tone = (l: string) => labelStyle(l).tone;
    expect(tone('Compliant')).toBe('green');
    expect(tone('Drift-Authorized')).toBe('blue');
    expect(tone('Drift-Unauthorized-Low')).toBe('yellow');
    expect(tone('Drift-Unauthorized-Medium')).toBe('orange');
    expect(tone('Drift-Unauthorized-High')).toBe('red');
    expect(tone('Non-Compliant (Critical)')).toBe('crimson');
    expect(labelStyle('Non-Compliant (Critical)').hazard).toBe(true);
    expect(tone('NO_BASELINE')).toBe('gray');
    expect(labelStyle('NO_BASELINE').dashed).toBe(true);
    for (const k of LABEL_ORDER) { expect(LABEL_STYLES[k].icon).toBeTruthy(); expect(LABEL_STYLES[k].text.length).toBeGreaterThan(0); }
  });
  it('accepts the UI key and the backend label for the same style, and degrades for unknown labels', () => {
    expect(labelStyle('Drift-Low')).toBe(labelStyle('Drift-Unauthorized-Low'));
    expect(labelStyle('Mystery').text).toBe('Mystery');
    expect(labelStyle('Mystery').tone).toBe('gray');
  });
  it('badges show text and an icon, never colour alone, and can show the full backend label', () => {
    const { container, rerender } = render(<PixelBadge taxonomy="Drift-Unauthorized-High" />);
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<PixelBadge taxonomy="Drift-Unauthorized-High" verbose />);
    expect(screen.getByText('Drift-Unauthorized-High')).toBeInTheDocument();
    rerender(<PixelBadge taxonomy="NO_BASELINE" />);
    expect(container.firstElementChild?.className).toContain('pxl-dashed');
    rerender(<PixelBadge taxonomy="Non-Compliant" />);
    expect(container.firstElementChild?.className).toContain('pxl-tone-crimson');
  });
});

describe('PixelButton', () => {
  it('renders a real button, forwards clicks and exposes variant, size and pressed state', async () => {
    const click = vi.fn();
    render(<PixelButton variant="danger" size="lg" pressed onClick={click}>Delete</PixelButton>);
    const b = screen.getByRole('button', { name: 'Delete' });
    expect(b).toHaveAttribute('type', 'button');
    expect(b.className).toContain('pxl-btn-danger');
    expect(b).toHaveAttribute('data-pressed', 'true');
    await userEvent.click(b);
    expect(click).toHaveBeenCalledTimes(1);
  });
  it('disabled keeps the native disabled attribute and ignores clicks', async () => {
    const click = vi.fn();
    render(<PixelButton disabled onClick={click}>Apply</PixelButton>);
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(click).not.toHaveBeenCalled();
  });
  it('loading sets aria-busy, ignores clicks and keeps the accessible name', async () => {
    const click = vi.fn();
    render(<PixelButton loading onClick={click}>Save</PixelButton>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(b);
    expect(click).not.toHaveBeenCalled();
  });
});

describe('fields', () => {
  it('PixelInput links label, hint and error, and flags invalid state', () => {
    render(<PixelInput label="IP address" hint="IPv4" error="Bad address" />);
    const i = screen.getByLabelText('IP address');
    expect(i).toHaveAttribute('aria-invalid', 'true');
    expect(i.getAttribute('aria-describedby')).toContain('-err');
    expect(screen.getByRole('alert')).toHaveTextContent('Bad address');
    expect(screen.queryByText('IPv4')).not.toBeInTheDocument();
  });
  it('PixelSelect is a native select with its label', async () => {
    const change = vi.fn();
    render(<PixelSelect label="Zone" onChange={change}><option value="a">A</option><option value="b">B</option></PixelSelect>);
    await userEvent.selectOptions(screen.getByLabelText('Zone'), 'b');
    expect(change).toHaveBeenCalled();
  });
  it('PixelCheckbox stays a native checkbox with state and keyboard toggle', async () => {
    const C = () => { const [v, s] = useState(false); return <PixelCheckbox label="Remember" checked={v} onChange={(e) => s(e.target.checked)} />; };
    render(<C />);
    const c = screen.getByRole('checkbox', { name: 'Remember' });
    expect(c).not.toBeChecked();
    c.focus(); await userEvent.keyboard(' ');
    expect(c).toBeChecked();
  });
});

describe('PixelTabs', () => {
  const Tabs = () => {
    const [v, s] = useState('a');
    return (
      <>
        <PixelTabs label="Sections" value={v} onChange={s} tabs={[{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }, { id: 'c', label: 'Off', disabled: true }]} />
        <PixelTabPanel id="a" active={v === 'a'}>Panel A</PixelTabPanel>
        <PixelTabPanel id="b" active={v === 'b'}>Panel B</PixelTabPanel>
      </>
    );
  };
  it('has tablist semantics, roving tabindex and arrow-key movement that skips disabled tabs', async () => {
    render(<Tabs />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    const [a, b] = [screen.getByRole('tab', { name: 'One' }), screen.getByRole('tab', { name: 'Two' })];
    expect(a).toHaveAttribute('aria-selected', 'true');
    expect(a).toHaveAttribute('tabindex', '0'); expect(b).toHaveAttribute('tabindex', '-1');
    a.focus(); await userEvent.keyboard('{ArrowRight}');
    expect(b).toHaveAttribute('aria-selected', 'true'); expect(b).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel B');
    await userEvent.keyboard('{ArrowRight}');
    expect(a).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{End}');
    expect(b).toHaveAttribute('aria-selected', 'true');
  });
});

describe('PixelModal', () => {
  const Host = ({ onClose = () => {} }: { onClose?: () => void }) => {
    const [open, set] = useState(false);
    return (
      <>
        <button onClick={() => set(true)}>Open</button>
        <PixelModal open={open} onClose={() => { onClose(); set(false); }} title="Confirm" footer={<button>OK</button>}>
          <input aria-label="Reason" />
        </PixelModal>
      </>
    );
  };
  it('is a labelled modal dialog, focuses its first field, closes on Escape and returns focus to the opener', async () => {
    const closed = vi.fn();
    render(<Host onClose={closed} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    const d = screen.getByRole('dialog', { name: 'Confirm' });
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Reason')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });
  it('keeps Tab inside the dialog and closes from the close button', async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const d = screen.getByRole('dialog');
    for (let i = 0; i < 6; i++) { await userEvent.tab(); expect(d.contains(document.activeElement)).toBe(true); }
    await userEvent.click(within(d).getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('PixelTooltip', () => {
  it('shows on hover and focus, links with aria-describedby and hides on Escape', async () => {
    render(<PixelTooltip content="Needs a second approver" focusable><PixelButton disabled>Apply</PixelButton></PixelTooltip>);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.tab();
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Needs a second approver');
    expect(tip.parentElement).toHaveAttribute('aria-describedby', tip.id);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.hover(screen.getByText('Apply'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});

describe('PixelPagination', () => {
  it('builds the page window with ellipses', () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(1, 20)).toEqual([1, 2, '…', 20]);
    expect(pageWindow(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20]);
    expect(pageWindow(20, 20)).toEqual([1, '…', 19, 20]);
  });
  it('is a labelled nav with the range readout, current page, and prev/next limits', async () => {
    const go = vi.fn();
    const { rerender } = render(<PixelPagination page={1} pageSize={10} total={95} onPageChange={go} />);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Showing 1–10 of 95');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(go).toHaveBeenCalledWith(2);
    rerender(<PixelPagination page={10} pageSize={10} total={95} onPageChange={go} />);
    expect(screen.getByRole('navigation')).toHaveTextContent('Showing 91–95 of 95');
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });
  it('shows 0–0 for an empty list', () => {
    render(<PixelPagination page={1} pageSize={10} total={0} onPageChange={() => {}} />);
    expect(screen.getByRole('navigation')).toHaveTextContent('Showing 0–0 of 0');
  });
});

describe('progress, stepper, stat, table, empty state', () => {
  it('PixelProgress exposes progressbar values and an indeterminate state', () => {
    const { rerender } = render(<PixelProgress label="Poll" value={40.4} showValue />);
    const bar = screen.getByRole('progressbar', { name: 'Poll' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('40%')).toBeInTheDocument();
    rerender(<PixelProgress label="Poll" />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-busy', 'true');
    rerender(<PixelProgress label="Poll" value={250} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
  it('PixelSteps marks the current step and writes each state as text', () => {
    render(<PixelSteps label="Pipeline" steps={[{ id: 'b', label: 'Backup', state: 'done' }, { id: 'p', label: 'Push', state: 'active' }, { id: 'v', label: 'Verify', state: 'pending' }, { id: 'r', label: 'Rollback', state: 'failed' }]} />);
    const list = screen.getByRole('list', { name: 'Pipeline' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveTextContent('Done'); expect(items[2]).toHaveTextContent('Waiting'); expect(items[3]).toHaveTextContent('Failed');
  });
  it('PixelStat prints the label first and the value in the next sibling (the shape the page tests read)', () => {
    render(<PixelStat label="Active drifts" value={12} />);
    const label = screen.getByText('Active drifts');
    expect(label.nextElementSibling).toHaveTextContent('12');
  });
  it('PixelTable has a caption, column headers and a scroll container', () => {
    const { container } = render(
      <PixelTable caption="Devices"><PixelThead><tr><PixelTh>Name</PixelTh></tr></PixelThead><PixelTbody><PixelTr><PixelTd>core</PixelTd></PixelTr></PixelTbody></PixelTable>,
    );
    expect(screen.getByRole('table', { name: 'Devices' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('scope', 'col');
    expect(container.querySelector('.pxl-scroll')).toBeInTheDocument();
    expect(container.querySelector('thead')?.className).toContain('sticky');
  });
  it('PixelEmptyState uses alert for errors and status otherwise', () => {
    const { rerender } = render(<PixelEmptyState title="Nothing" />);
    expect(screen.getByRole('status')).toHaveTextContent('Nothing');
    rerender(<PixelEmptyState kind="error" title="Broken" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Broken');
    rerender(<PixelEmptyState kind="loading" title="Loading" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
  it('PixelSkeleton is hidden from assistive technology', () => {
    const { container } = render(<PixelSkeleton lines={2} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
  it('DeviceIcon draws an icon per device type and is decorative unless labelled', () => {
    const { container, rerender } = render(<DeviceIcon type="router" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    for (const t of ['switch', 'firewall', 'ap', 'router']) { rerender(<DeviceIcon type={t} />); expect(container.querySelector('svg')).toBeInTheDocument(); }
    rerender(<DeviceIcon type="switch" label="Switch" />);
    expect(screen.getByRole('img', { name: 'Switch' })).toBeInTheDocument();
  });
});

describe('toasts', () => {
  const Trigger = () => { const t = useToast(); return (<><button onClick={() => t.success('Saved')}>ok</button><button onClick={() => t.error('Failed', 'why')}>bad</button></>); };
  it('announces success as status and errors as alert, and can be dismissed', async () => {
    render(<PixelToaster><Trigger /></PixelToaster>);
    await userEvent.click(screen.getByText('ok'));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    await userEvent.click(screen.getByText('bad'));
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
    await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[1]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('removes toasts by itself', () => {
    vi.useFakeTimers();
    render(<PixelToaster><Trigger /></PixelToaster>);
    act(() => { screen.getByText('ok').click(); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(6100); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
  it('useToast outside a provider is a clear error', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Trigger />)).toThrow(/PixelToaster/);
    quiet.mockRestore();
  });
});
