// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header, relativeTime } from '../components/Header';
import { emptySnapshot } from '../../../shared/types';

const snapshot = { ...emptySnapshot('acme'), viewer: { login: 'alex', teams: [] }, fetchedAt: '2026-11-18T11:59:18Z' };
const now = Date.parse('2026-11-18T12:00:00Z');

describe('Header', () => {
  it('shows the viewer, how fresh the data is and the current interval', () => {
    render(<Header snapshot={snapshot} tab="overview" now={now} onTab={() => undefined} onRefresh={async () => undefined} onRefreshSetting={() => undefined} onOpenSettings={() => undefined} />);
    expect(screen.getByText('alex')).toBeInTheDocument();
    expect(screen.getByText('Updated 42s ago')).toBeInTheDocument();
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

  it('formats relative times', () => {
    expect(relativeTime(42_000)).toBe('42s ago');
    expect(relativeTime(6 * 60_000)).toBe('6m ago');
    expect(relativeTime(3 * 3_600_000)).toBe('3h ago');
  });
});
