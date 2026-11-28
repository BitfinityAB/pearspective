// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import type { DashboardApi } from '../api/client';
import { emptySnapshot } from '../../../shared/types';
import { makePerson, makePr } from '../../../test/factories';

vi.mock('../components/StackDiagram', () => ({ StackDiagram: ({ label }: { label: string }) => <div data-testid="diagram">{label}</div> }));

function fakeApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  const mine = makePr({ title: 'My own change', author: makePerson('alex') });
  const theirs = makePr({ title: 'Their change', author: makePerson('sam'), mergeState: 'conflicts' });
  const snapshot = {
    ...emptySnapshot('acme'),
    viewer: { login: 'alex', teams: [] },
    prs: [mine, theirs],
    overviewIds: [mine.id, theirs.id],
    mine: { authored: [mine.id], requested: [theirs.id], team: [] },
    fetchedAt: new Date().toISOString(),
    settings: { ...emptySnapshot('acme').settings, repos: ['orders-api'] },
  };
  return {
    getSnapshot: async () => snapshot,
    subscribe: () => () => undefined,
    setVisible: async () => undefined,
    refreshNow: async () => snapshot,
    updateSettings: async ({ notifications, reviewers: _reviewers, ...patch }) => ({
      ...snapshot.settings,
      ...patch,
      notifications: notifications ? { ...snapshot.settings.notifications, enabled: notifications.enabled } : snapshot.settings.notifications,
    }),
    getThemes: async () => [],
    searchRepos: async () => [],
    stackDetail: async () => null,
    ...overrides,
  };
}

describe('App', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('renders author lanes, selects a PR into the drawer and the URL, and switches to Mine', async () => {
    render(<App api={fakeApi()} />);
    const sam = await screen.findByRole('region', { name: 'sam' });
    await userEvent.click(within(sam).getByRole('button', { name: /Their change/ }));
    expect(screen.getByRole('heading', { name: 'Their change' })).toBeInTheDocument();
    expect(window.location.search).toContain('pr=');

    await userEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(screen.getByRole('region', { name: 'My PRs' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Review requested from me' })).toBeInTheDocument();
  });

  it('opens the settings panel from the header', async () => {
    render(<App api={fakeApi()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows a loading message instead of empty lanes until the first load finishes', async () => {
    const loading = { ...emptySnapshot('acme'), settings: { ...emptySnapshot('acme').settings, repos: ['orders-api'] } };
    render(<App api={fakeApi({ getSnapshot: async () => loading })} />);
    expect(await screen.findByText('Loading pull requests… the first load can take a minute.')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(/Updated never/)).toBeNull();
    expect(screen.queryByText('Select a pull request to see its details.')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(screen.getByText('Loading pull requests… the first load can take a minute.')).toBeInTheDocument();
  });

  it('shows the lanes and banner rather than the loading message when the first load failed', async () => {
    const failed = {
      ...emptySnapshot('acme'),
      settings: { ...emptySnapshot('acme').settings, repos: ['orders-api'] },
      banners: [{ kind: 'stale' as const, message: 'Last refresh failed: boom.' }],
    };
    render(<App api={fakeApi({ getSnapshot: async () => failed })} />);
    expect(await screen.findByText('Last refresh failed: boom.')).toBeInTheDocument();
    expect(screen.queryByText(/Loading pull requests/)).toBeNull();
  });

  it('shows a dismissible error when a refresh or settings change fails', async () => {
    render(<App api={fakeApi({
      refreshNow: async () => { throw new Error('gh timed out after 60 s'); },
      updateSettings: async () => { throw new Error('Unknown origin'); },
    })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh now' }));
    expect(await screen.findByText('gh timed out after 60 s')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(screen.queryByText('gh timed out after 60 s')).toBeNull();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Auto-refresh interval' }), 'off');
    expect(await screen.findByText('Unknown origin')).toBeInTheDocument();
  });

  describe('notification settings', () => {
    const withNotifications = (api: DashboardApi, repos?: string[]): DashboardApi => ({
      ...api,
      getSnapshot: async () => {
        const base = await api.getSnapshot();
        return { ...base, settings: { ...base.settings, ...(repos ? { repos } : {}), notifications: { ...base.settings.notifications, enabled: true } } };
      },
    });

    beforeEach(() => {
      localStorage.clear();
      vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'default' }));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('shows a failed notification save inside the dialog', async () => {
      const api = withNotifications(fakeApi({ updateSettings: async () => { throw new Error('Save failed'); } }));
      render(<App api={api} />);
      await userEvent.click(await screen.findByRole('button', { name: /^Settings/ }));
      const dialog = screen.getByRole('dialog', { name: 'Settings' });
      await userEvent.click(within(dialog).getByRole('tab', { name: 'Notifications' }));
      await userEvent.click(within(dialog).getByRole('checkbox', { name: 'CI failed' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Save failed');
    });

    it('focuses the permission row only when opened from the dot', async () => {
      render(<App api={withNotifications(fakeApi(), [])} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Settings (desktop notifications not yet allowed)' }));
      expect(screen.getByRole('group', { name: 'Desktop notifications' })).toHaveFocus();
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      await userEvent.click(screen.getByRole('button', { name: 'Choose repositories' }));
      expect(screen.getByRole('tab', { name: 'Repositories' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.queryByRole('group', { name: 'Desktop notifications' })).toBeNull();
    });
  });

  it('shows a banner and uses Default when the chosen theme is missing', async () => {
    const base = fakeApi();
    const snapshot = await base.getSnapshot();
    const defaultOnly = { id: 'default', name: 'Default', modes: ['light' as const, 'dark' as const], source: 'builtin' as const, valid: true, warnings: [] };
    const api = fakeApi({
      getSnapshot: async () => ({ ...snapshot, settings: { ...snapshot.settings, theme: 'gone' } }),
      getThemes: async () => [defaultOnly],
    });
    render(<App api={api} />);
    expect(await screen.findByText("Theme 'gone' is unavailable: it was not found. Using Default.")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("Theme 'gone' is unavailable");
  });
});
