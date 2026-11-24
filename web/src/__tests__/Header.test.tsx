// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header, relativeTime } from '../components/Header';
import { emptySnapshot } from '../../../shared/types';
import { makeTicket } from '../../../test/fake-tracker';
import { dismissPermissionHint, PERMISSION_HINT_KEY } from '../notifications/permission';

const snapshot = { ...emptySnapshot('acme'), viewer: { login: 'alex', teams: [] }, fetchedAt: '2026-11-18T11:59:18Z' };
const now = Date.parse('2026-11-18T12:00:00Z');

describe('Header', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('shows the viewer, how fresh the data is and the current interval', () => {
    render(<Header snapshot={snapshot} tab="overview" now={now} onTab={() => undefined} onRefresh={async () => undefined} onRefreshSetting={() => undefined} onOpenSettings={() => undefined} />);
    expect(screen.getByText('alex')).toBeInTheDocument();
    expect(screen.getByText('Updated 42s ago')).toBeInTheDocument();
    // The status can be cut short in the header, so the full text stays available as a tooltip.
    expect(screen.getAllByText('Updated 42s ago')[0]).toHaveAttribute('title', 'Updated 42s ago');
    expect(screen.getByRole('combobox', { name: 'Auto-refresh interval' })).toHaveValue('3');
  });

  it('shows the display name when GitHub has one and keeps the login as a tooltip', () => {
    const named = { ...snapshot, viewer: { login: 'alex', name: 'Alex Rivera', teams: [] } };
    render(<Header snapshot={named} tab="overview" now={now} onTab={() => undefined} onRefresh={async () => undefined} onRefreshSetting={() => undefined} onOpenSettings={() => undefined} />);
    expect(screen.getByText('Alex Rivera')).toHaveAttribute('title', 'alex');
    expect(screen.queryByText('alex')).toBeNull();
  });

  it('changes the interval and refreshes on demand', async () => {
    const onRefresh = vi.fn(async () => undefined);
    const onRefreshSetting = vi.fn();
    render(<Header snapshot={snapshot} tab="overview" now={now} onTab={() => undefined} onRefresh={onRefresh} onRefreshSetting={onRefreshSetting} onOpenSettings={() => undefined} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Auto-refresh interval' }), 'off');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    expect(onRefreshSetting).toHaveBeenCalledWith('off');
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('spins the refresh button until the refresh finishes', async () => {
    let finish = () => undefined as void;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<Header snapshot={snapshot} tab="overview" now={now} onTab={() => undefined} onRefresh={onRefresh} onRefreshSetting={() => undefined} onOpenSettings={() => undefined} />);
    const button = screen.getByRole('button', { name: 'Refresh now' });
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveClass('spinning');
    await act(async () => finish());
    expect(button).not.toHaveAttribute('aria-busy', 'true');
    expect(button).not.toHaveClass('spinning');
  });

  it('opens a menu with the organisation, status, theme and settings, and closes it on Escape', async () => {
    const onOpenSettings = vi.fn();
    render(<Header snapshot={snapshot} tab="overview" now={now} onTab={() => undefined} onRefresh={async () => undefined} onRefreshSetting={() => undefined} onOpenSettings={onOpenSettings} />);
    const menuButton = screen.getByRole('button', { name: 'More' });
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(menuButton);
    const menu = within(screen.getByRole('group', { name: 'More' }));
    expect(menu.getByText('acme')).toBeInTheDocument();
    expect(menu.getByText('Updated 42s ago')).toBeInTheDocument();
    expect(menu.getByRole('group', { name: 'Theme' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'More' })).toBeNull();
    expect(menuButton).toHaveFocus();

    await userEvent.click(menuButton);
    await userEvent.click(within(screen.getByRole('group', { name: 'More' })).getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.queryByRole('group', { name: 'More' })).toBeNull();
  });

  it('closes the menu on a click outside it', async () => {
    render(<><Header snapshot={snapshot} tab="overview" now={now} onTab={() => undefined} onRefresh={async () => undefined} onRefreshSetting={() => undefined} onOpenSettings={() => undefined} /><p>Outside</p></>);
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(screen.getByText('Outside'));
    expect(screen.queryByRole('group', { name: 'More' })).toBeNull();
  });

  it('shows the Tickets tab with the number of tickets needing attention when tickets are enabled', () => {
    const withTickets = {
      ...snapshot,
      settings: { ...snapshot.settings, ticketsEnabled: true },
      ticketChecks: { 'XX-1': { key: 'XX-1', prState: 'open' as const, verdict: 'mismatch' as const, reason: '', expected: '', since: null } },
    };
    const { rerender } = render(<Header snapshot={snapshot} tab="overview" now={now} onTab={() => undefined} onRefresh={async () => undefined} onRefreshSetting={() => undefined} onOpenSettings={() => undefined} />);
    expect(screen.queryByRole('button', { name: /Tickets/ })).toBeNull();
    rerender(<Header snapshot={withTickets} tab="overview" now={now} onTab={() => undefined} onRefresh={async () => undefined} onRefreshSetting={() => undefined} onOpenSettings={() => undefined} />);
    const ticketsTab = screen.getByRole('button', { name: 'Tickets 1' });
    // The count is a separate pill so it does not read as part of the label.
    expect(within(ticketsTab).getByText('1')).toHaveClass('tab-count');
  });

  it('formats relative times', () => {
    expect(relativeTime(42_000)).toBe('42s ago');
    expect(relativeTime(6 * 60_000)).toBe('6m ago');
    expect(relativeTime(3 * 3_600_000)).toBe('3h ago');
  });

  describe('permission dot', () => {
    const withNotifications = (enabled: boolean) => ({ ...snapshot, settings: { ...snapshot.settings, notifications: { ...snapshot.settings.notifications, enabled } } });
    const renderHeader = (enabled = true, onOpenSettings = vi.fn()) => {
      render(<Header snapshot={withNotifications(enabled)} tab="overview" now={now} onTab={() => undefined} onRefresh={async () => undefined} onRefreshSetting={() => undefined} onOpenSettings={onOpenSettings} />);
      return onOpenSettings;
    };
    const stubPermission = (permission: string) => vi.stubGlobal('Notification', Object.assign(function () {}, { permission }));

    it('marks Settings and More while desktop permission is still to be asked', () => {
      stubPermission('default');
      renderHeader();
      expect(screen.getByRole('button', { name: 'Settings (desktop notifications not yet allowed)' })).toHaveClass('has-dot');
      expect(screen.getByRole('button', { name: 'More (desktop notifications not yet allowed)' })).toHaveClass('has-dot');
    });

    it('asks the app to focus the permission row only while the dot shows', async () => {
      stubPermission('default');
      const onOpenSettings = renderHeader();
      await userEvent.click(screen.getByRole('button', { name: /^Settings/ }));
      expect(onOpenSettings).toHaveBeenLastCalledWith(true);
    });

    it('shows no dot when permission is granted, notifications are off or the hint was dismissed', () => {
      stubPermission('granted');
      const { unmount } = render(<Header snapshot={withNotifications(true)} tab="overview" now={now} onTab={() => undefined} onRefresh={async () => undefined} onRefreshSetting={() => undefined} onOpenSettings={() => undefined} />);
      expect(screen.getByRole('button', { name: 'Settings' })).not.toHaveClass('has-dot');
      unmount();
      stubPermission('default');
      const off = render(<Header snapshot={withNotifications(false)} tab="overview" now={now} onTab={() => undefined} onRefresh={async () => undefined} onRefreshSetting={() => undefined} onOpenSettings={() => undefined} />);
      expect(screen.getByRole('button', { name: 'Settings' })).not.toHaveClass('has-dot');
      off.unmount();
      localStorage.setItem(PERMISSION_HINT_KEY, '1');
      renderHeader();
      expect(screen.getByRole('button', { name: 'Settings' })).not.toHaveClass('has-dot');
    });

    it('clears the dot right after the hint is dismissed', () => {
      stubPermission('default');
      renderHeader();
      expect(screen.getByRole('button', { name: /^Settings/ })).toHaveClass('has-dot');
      act(() => dismissPermissionHint());
      expect(screen.getByRole('button', { name: 'Settings' })).not.toHaveClass('has-dot');
    });
  });

  it('says the board shows stored data while the first refresh runs', () => {
    const stored = { ...snapshot, fromStore: true, stale: true, fetchedAt: '2026-11-18T11:00:00Z' };
    render(<Header snapshot={stored} tab="overview" now={now} onTab={() => undefined} onRefresh={async () => undefined} onRefreshSetting={() => undefined} onOpenSettings={() => undefined} />);
    expect(screen.getAllByText(/^Showing data from .+, updating…$/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Updated /)).toBeNull();
  });

  it('does not promise an update when stored data is shown but sign-in is missing', () => {
    const stored = { ...snapshot, fromStore: true, stale: true, fetchedAt: '2026-11-18T11:00:00Z', banners: [{ kind: 'auth' as const, message: 'Not logged in' }] };
    render(<Header snapshot={stored} tab="overview" now={now} onTab={() => undefined} onRefresh={async () => undefined} onRefreshSetting={() => undefined} onOpenSettings={() => undefined} />);
    expect(screen.getAllByText(/^Showing data from [^,]+$/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/updating/)).toBeNull();
  });

  it('shows the Tickets count for the viewer\'s tickets while the Mine filter is on', () => {
    const check = (key: string) => ({ key, prState: 'merged' as const, verdict: 'mismatch' as const, reason: 'reason', expected: 'Done', since: '2026-11-18T08:00:00Z' });
    const withTickets = {
      ...snapshot,
      settings: { ...snapshot.settings, ticketsEnabled: true },
      tickets: { 'XX-1': makeTicket('XX-1', 'To Do', 'todo', { mine: true }), 'XX-2': makeTicket('XX-2', 'To Do', 'todo', { mine: false }) },
      ticketChecks: { 'XX-1': check('XX-1'), 'XX-2': check('XX-2') },
    };
    const props = { tab: 'tickets' as const, now, onTab: () => undefined, onRefresh: async () => undefined, onRefreshSetting: () => undefined, onOpenSettings: () => undefined };
    const { rerender } = render(<Header snapshot={withTickets} {...props} />);
    expect(screen.getByRole('button', { name: /^Tickets/ })).toHaveTextContent('Tickets 2');
    rerender(<Header snapshot={withTickets} {...props} ticketsMine />);
    expect(screen.getByRole('button', { name: /^Tickets/ })).toHaveTextContent('Tickets 1');
  });
});
