import { Poller } from '../poller';
import { ConfigSchema } from '../config';
import { ProviderError } from '../providers/types';
import { SafeStore, type StoreLike } from '../storage/safe-store';
import type { RefreshWrite } from '../storage/store';
import { createFakeProvider } from '../../test/fake-provider';
import { makePr } from '../../test/factories';
import type { ChangeRequest } from '../../shared/types';

const config = () => ConfigSchema.parse({ codeHost: { provider: 'fake', org: 'acme', repos: ['orders-api'] }, notifications: { enabled: true } });
const selection = { org: 'acme', repos: ['orders-api'] };
const STORED_AT = '2026-11-20T17:00:00.000Z';

function seededStore(prs: ChangeRequest[]): SafeStore {
  const store = SafeStore.open(':memory:');
  store.saveRefresh({ org: 'acme', host: 'example.test', fetchedAt: STORED_AT, viewer: { login: 'alex', teams: [{ slug: 'core' }] }, upserted: prs, removedIds: [], overviewIds: prs.map((pr) => pr.id), mine: { authored: prs.map((pr) => pr.id), requested: [], team: [] } });
  return store;
}

function setup(stored: ChangeRequest[], current: ChangeRequest[], store = seededStore(stored)) {
  let now = Date.parse('2026-11-23T08:00:00Z');
  const code = createFakeProvider(current);
  code.state.mine.authored = current.map((pr) => pr.id);
  const poller = new Poller({ provider: code.provider, config, now: () => now, store, stored: store.load(selection) });
  return { poller, code, store, advance: (ms: number) => (now += ms) };
}

describe('Poller with a local database', () => {
  it('publishes the stored state before the first refresh', () => {
    const pr = makePr();
    const { poller } = setup([pr], [pr]);
    const snapshot = poller.snapshot();
    expect(snapshot.prs.map((item) => item.id)).toEqual([pr.id]);
    expect(snapshot).toMatchObject({ stale: true, fromStore: true, fetchedAt: STORED_AT, overviewIds: [pr.id] });
    expect(snapshot.viewer?.login).toBe('alex');
  });

  it('fetches only changed PRs on the first refresh, then sweeps, and still checks the login', async () => {
    const unchanged = makePr();
    const changed = makePr();
    const { poller, code, advance } = setup([unchanged, changed], [unchanged, { ...changed, updatedAt: '2026-11-22T09:00:00Z' }]);
    code.provider.checkAuth = async () => ({ ok: true, viewer: { login: 'alex', name: 'Alex Rivera', teams: [{ slug: 'core' }] } });
    await poller.tick();
    expect(code.state.fetched).toEqual([[changed.id]]);
    expect(poller.snapshot()).toMatchObject({ stale: false, fromStore: false });
    expect(poller.snapshot().viewer?.name).toBe('Alex Rivera');
    advance(60_000);
    await poller.tick();
    expect(code.state.fetched.at(-1)?.sort()).toEqual([unchanged.id, changed.id].sort());
  });

  it('saves only re-fetched and removed PRs after a complete refresh', async () => {
    const kept = makePr();
    const changed = makePr();
    const gone = makePr();
    const { poller, store } = setup([kept, changed, gone], [kept, { ...changed, updatedAt: '2026-11-22T09:00:00Z' }]);
    const save = vi.spyOn(store, 'saveRefresh');
    await poller.tick();
    expect(save).toHaveBeenCalledOnce();
    const write = save.mock.calls[0]![0] as RefreshWrite;
    expect(write.upserted.map((pr) => pr.id)).toEqual([changed.id]);
    expect(write.removedIds).toEqual([gone.id]);
    expect(write.overviewIds.sort()).toEqual([kept.id, changed.id].sort());
    expect(store.load(selection)!.prs.map((pr) => pr.id).sort()).toEqual([kept.id, changed.id].sort());
  });

  it('saves nothing after a failed refresh', async () => {
    const pr = makePr();
    const { poller, code, store } = setup([pr], [{ ...pr, updatedAt: '2026-11-22T09:00:00Z' }]);
    code.provider.fetchFull = async () => { throw new ProviderError('failed', 'boom', []); };
    const save = vi.spyOn(store, 'saveRefresh');
    await poller.tick();
    expect(save).not.toHaveBeenCalled();
    expect(poller.snapshot().fromStore).toBe(true);
  });

  it('notifies about changes made while the server was stopped', async () => {
    const pr = makePr({ reviewDecision: 'review_required' });
    const { poller } = setup([pr], [{ ...pr, checks: [{ name: 'build', state: 'failure', required: true }], updatedAt: '2026-11-22T09:00:00Z' }]);
    await poller.tick();
    expect(poller.snapshot().notification?.items[0]).toMatchObject({ prId: pr.id, events: [{ kind: 'ciFailed' }] });
  });

  it('shows a banner when saving fails and clears it once a save works again', async () => {
    const pr = makePr();
    let failing = true;
    const inner: StoreLike = {
      load: () => null,
      saveRefresh: () => { if (failing) throw new Error('disk full'); },
      saveTickets: () => undefined,
      saveStatusCategories: () => undefined,
      close: () => undefined,
    };
    const store = new SafeStore(inner);
    const code = createFakeProvider([pr]);
    let now = Date.parse('2026-11-23T08:00:00Z');
    const poller = new Poller({ provider: code.provider, config, now: () => now, store, stored: null });
    await poller.tick();
    expect(poller.snapshot().prs).toHaveLength(1);
    expect(poller.snapshot().banners).toContainEqual({ kind: 'database', message: 'Saving to the local database failed: disk full. The dashboard keeps working.' });
    failing = false;
    now += 60_000;
    await poller.tick();
    expect(poller.snapshot().banners.some((banner) => banner.kind === 'database')).toBe(false);
  });

  it('writes PRs fetched in a partial refresh and drops ghosts once a complete refresh follows', async () => {
    const a = makePr();
    const c = makePr();
    const { poller, code, store, advance } = setup([a, c], [a, c]);
    const renamed = { ...a, title: 'Renamed', updatedAt: '2026-11-22T09:00:00Z' };
    code.state.prs = [renamed];
    code.state.mine.authored = [a.id];
    const realFetch = code.provider.fetchFull;
    code.provider.fetchFull = async (stubs) => {
      const loaded = await realFetch(stubs);
      throw new ProviderError('failed', 'partial', loaded);
    };
    await poller.tick();
    code.provider.fetchFull = realFetch;
    advance(60_000);
    await poller.tick();
    const saved = store.load(selection)!;
    expect(saved.prs.map((pr) => pr.id)).toEqual([a.id]);
    expect(saved.prs[0]!.title).toBe('Renamed');
  });

  it('sweeps at once on a warm start when a full refresh is requested', async () => {
    const first = makePr();
    const second = makePr();
    const { poller, code } = setup([first, second], [first, second]);
    await poller.tick({ full: true });
    expect(code.state.fetched.at(-1)?.sort()).toEqual([first.id, second.id].sort());
  });

  it('keeps showing stored data when the login fails, and checks again on the next tick', async () => {
    const pr = makePr();
    const { poller, code, advance } = setup([pr], [pr]);
    let checks = 0;
    code.provider.checkAuth = async () => { checks += 1; return { ok: false, reason: 'unauthenticated', message: 'not signed in' } as never; };
    await poller.tick();
    expect(poller.snapshot()).toMatchObject({ stale: true, fromStore: true });
    expect(poller.snapshot().prs).toHaveLength(1);
    advance(60_000);
    await poller.tick();
    expect(checks).toBe(2);
  });

  it('saves nothing when a refresh throws a non-partial error', async () => {
    const pr = makePr();
    const { poller, code, store } = setup([pr], [pr]);
    code.provider.fetchFull = async () => { throw new Error('boom'); };
    code.state.prs = [{ ...pr, updatedAt: '2026-11-22T09:00:00Z' }];
    const save = vi.spyOn(store, 'saveRefresh');
    await poller.tick();
    expect(save).not.toHaveBeenCalled();
  });
});
