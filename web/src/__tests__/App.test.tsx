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
    updateSettings: async (patch) => ({ ...snapshot.settings, ...patch }),
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
    expect(screen.getByRole('dialog', { name: 'Repositories in Overview' })).toBeInTheDocument();
  });

  it('shows a loading message instead of empty lanes until the first load finishes', async () => {
    const loading = { ...emptySnapshot('acme'), settings: { ...emptySnapshot('acme').settings, repos: ['orders-api'] } };
    render(<App api={fakeApi({ getSnapshot: async () => loading })} />);
    expect(await screen.findByText('Loading pull requests… the first load can take a minute.')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(/Updated never/)).toBeNull();

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
});
