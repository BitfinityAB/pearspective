import { Poller, FULL_SWEEP_MS } from '../poller';
import { ProviderError } from '../providers/types';
import type { Config } from '../config';
import { createFakeProvider } from '../../test/fake-provider';
import { makePr } from '../../test/factories';

const config: Config = {
  codeHost: { provider: 'fake', org: 'acme', repos: ['orders-api'], excludeRepos: [], teams: [], localRepos: [] },
  reviewerClasses: { 'ai-review': [], 'code-analysis': [] },
  refreshIntervalSec: 180,
  pinned: [],
  theme: 'default',
  databasePath: 'pearspective.db',
};

function setup(prs = [makePr(), makePr()]) {
  let now = Date.parse('2026-11-18T12:00:00Z');
  const fake = createFakeProvider(prs);
  const published: number[] = [];
  const poller = new Poller({ provider: fake.provider, config: () => config, now: () => now, onChange: (snapshot) => published.push(snapshot.prs.length) });
  return { poller, fake, published, advance: (ms: number) => (now += ms) };
}

describe('Poller', () => {
  it('publishes the viewer, PRs, overview ids and settings after the first tick', async () => {
    const { poller, published } = setup();
    await poller.tick();
    const snapshot = poller.snapshot();
    expect(snapshot.viewer?.login).toBe('alex');
    expect(snapshot.prs).toHaveLength(2);
    expect(snapshot.overviewIds).toHaveLength(2);
    expect(snapshot.settings).toMatchObject({ refresh: 3, repos: ['orders-api'], org: 'acme', host: 'example.test' });
    expect(snapshot.fetchedAt).toBe('2026-11-18T12:00:00.000Z');
    expect(published).toEqual([2]);
  });

  it('enriches only new, changed, pending or unknown PRs on later ticks', async () => {
    const steady = makePr();
    const changing = makePr();
    const pending = makePr({ checks: [{ name: 'build', state: 'pending', required: true }] });
    const unknown = makePr({ mergeState: 'unknown' });
    const { poller, fake, advance } = setup([steady, changing, pending, unknown]);
    await poller.tick();

    fake.state.prs = fake.state.prs.map((pr) => (pr.id === changing.id ? { ...pr, updatedAt: '2026-11-18T12:01:00Z' } : pr));
    advance(180_000);
    await poller.tick();

    expect(fake.state.fetched.at(-1)!.sort()).toEqual([changing.id, pending.id, unknown.id].sort());
  });

  it('re-enriches everything on the full sweep', async () => {
    const { poller, fake, advance } = setup();
    await poller.tick();
    advance(FULL_SWEEP_MS);
    await poller.tick();
    expect(fake.state.fetched.at(-1)).toHaveLength(2);
  });

  it('drops PRs that are no longer open', async () => {
    const closing = makePr();
    const { poller, fake } = setup([closing, makePr()]);
    await poller.tick();
    fake.state.prs = fake.state.prs.filter((pr) => pr.id !== closing.id);
    await poller.tick();
    expect(poller.snapshot().prs.map((pr) => pr.id)).not.toContain(closing.id);
  });

  it('fills the Mine lists and removes duplicates across team searches', async () => {
    const mine = makePr();
    const requested = makePr();
    const { poller, fake } = setup([mine, requested]);
    fake.state.mine = { authored: [mine.id], requested: [requested.id], team: [requested.id] };
    await poller.tick();
    expect(poller.snapshot().mine).toEqual({ authored: [mine.id], requested: [requested.id], team: [requested.id] });
  });

  it('keeps the last data and marks it stale when a refresh fails', async () => {
    const { poller, fake } = setup();
    await poller.tick();
    fake.provider.pollLean = async () => { throw new ProviderError('failed', 'boom'); };
    await poller.tick();
    const snapshot = poller.snapshot();
    expect(snapshot.prs).toHaveLength(2);
    expect(snapshot.stale).toBe(true);
    expect(snapshot.banners[0]).toMatchObject({ kind: 'stale' });
    expect(snapshot.banners[0]!.message).toContain('boom');
  });

  it('keeps the PRs fetched before a partial failure and retries the rest on the next tick', async () => {
    const fetched = makePr();
    const missing = makePr();
    const { poller, fake } = setup([fetched, missing]);
    const fetchFull = fake.provider.fetchFull;
    fake.provider.fetchFull = async (stubs) => {
      fake.state.fetched.push(stubs.map((stub) => stub.id));
      throw new ProviderError('failed', 'boom', fake.state.prs.filter((pr) => pr.id === fetched.id));
    };

    await poller.tick();

    const snapshot = poller.snapshot();
    expect(snapshot.prs.map((pr) => pr.id)).toEqual([fetched.id]);
    expect(snapshot.overviewIds).toEqual([fetched.id]);
    expect(snapshot.stale).toBe(true);
    expect(snapshot.fetchedAt).toBeNull();
    expect(snapshot.banners).toEqual([expect.objectContaining({ kind: 'stale', message: expect.stringContaining('boom') })]);

    fake.provider.fetchFull = fetchFull;
    await poller.tick();
    // The failed sweep is not counted as done, so it is retried in full.
    expect(fake.state.fetched.at(-1)!.sort()).toEqual([fetched.id, missing.id].sort());
    expect(poller.snapshot()).toMatchObject({ stale: false, banners: [] });
    expect(poller.snapshot().prs).toHaveLength(2);
  });

  it('still shows the auth banner when full details fail because gh logged out', async () => {
    const { poller, fake } = setup();
    fake.provider.fetchFull = async () => { throw new ProviderError('auth', 'gh is not logged in. Run `gh auth login`.', []); };
    await poller.tick();
    expect(poller.snapshot().banners).toEqual([{ kind: 'auth', message: 'gh is not logged in. Run `gh auth login`.' }]);
  });

  it('shows an auth banner and retries authentication on the next tick', async () => {
    const { poller, fake } = setup();
    let attempts = 0;
    fake.provider.checkAuth = async () => (++attempts === 1
      ? { ok: false, reason: 'auth', message: 'gh is not logged in. Run `gh auth login`.' }
      : { ok: true, viewer: { login: 'alex', teams: [] } });
    await poller.tick();
    expect(poller.snapshot().banners).toEqual([{ kind: 'auth', message: 'gh is not logged in. Run `gh auth login`.' }]);
    await poller.tick();
    expect(poller.snapshot().banners).toEqual([]);
  });

  it('warns and backs off when the rate limit is low', async () => {
    const { poller, fake } = setup();
    fake.provider.lastRateLimit = () => ({ remaining: 120, resetAt: '2026-11-18T12:40:00Z' });
    await poller.tick();
    expect(poller.snapshot().banners[0]).toMatchObject({ kind: 'rate-limit' });
    expect(poller.snapshot().banners[0]!.message).toMatch(/^API budget is low \(120 left/);
    expect(poller.backoffFactor()).toBe(2);
  });

  it('coalesces callers that arrive during a running tick into one rerun', async () => {
    const { poller, fake } = setup();
    await Promise.all([poller.tick(), poller.tick(), poller.tick()]);
    expect(fake.state.fetched).toHaveLength(2);
  });

  it('reruns with the new config when settings change during a running tick', async () => {
    const backend = makePr({ repo: 'orders-api' });
    const frontend = makePr({ repo: 'orders-web' });
    const fake = createFakeProvider([backend, frontend]);
    let current: Config = config;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((started) => {
      const pollLean = fake.provider.pollLean;
      let calls = 0;
      fake.provider.pollLean = async (repos) => {
        if (++calls === 1) {
          started();
          await new Promise<void>((release) => (releaseFirst = release));
        }
        return pollLean(repos);
      };
    });
    const poller = new Poller({ provider: fake.provider, config: () => current });

    const first = poller.tick();
    await firstStarted;
    current = { ...config, codeHost: { ...config.codeHost, repos: ['orders-web'] } };
    const second = poller.tick();
    releaseFirst();
    await Promise.all([first, second]);

    expect(poller.snapshot().overviewIds).toEqual([frontend.id]);
  });
});
