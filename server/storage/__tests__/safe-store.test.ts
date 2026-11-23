import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SafeStore, type StoreLike } from '../safe-store';
import type { RefreshWrite } from '../store';

const write: RefreshWrite = { org: 'acme', host: 'example.test', fetchedAt: '2026-11-23T08:00:00.000Z', viewer: { login: 'alex', teams: [] }, upserted: [], removedIds: [], overviewIds: [], mine: { authored: [], requested: [], team: [] } };

describe('SafeStore', () => {
  it('reports an unopenable path and ignores reads and writes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pearspective-safe-'));
    const store = SafeStore.open(directory);
    expect(store.error).toMatch(/^Local database unavailable: .+\. Data will load from GitHub on each start\.$/);
    expect(store.load({ org: 'acme', repos: [] })).toBeNull();
    expect(() => store.saveRefresh(write)).not.toThrow();
  });

  it('turns a failed write into banner text and clears it after the next successful write', () => {
    let failing = true;
    const inner: StoreLike = {
      load: () => null,
      loadStatusCategories: () => ({}),
      saveRefresh: () => { if (failing) throw new Error('disk full'); },
      saveTickets: () => undefined,
      saveStatusCategories: () => undefined,
      close: () => undefined,
    };
    const store = new SafeStore(inner);
    store.saveRefresh(write);
    expect(store.error).toBe('Saving to the local database failed: disk full. The dashboard keeps working.');
    failing = false;
    store.saveRefresh(write);
    expect(store.error).toBeNull();
  });

  it('keeps a failed tickets write visible when a later categories write succeeds', () => {
    let failing = true;
    const inner: StoreLike = {
      load: () => null,
      loadStatusCategories: () => ({}),
      saveRefresh: () => undefined,
      saveTickets: () => { if (failing) throw new Error('disk full'); },
      saveStatusCategories: () => undefined,
      close: () => undefined,
    };
    const store = new SafeStore(inner);
    const ticketsWrite = { org: 'acme', provider: 'github', at: '2026-11-23T08:00:00.000Z', upserted: [], removedKeys: [], notTickets: [] };
    store.saveTickets(ticketsWrite);
    store.saveStatusCategories({ Done: 'done' });
    expect(store.error).toBe('Saving to the local database failed: disk full. The dashboard keeps working.');
    failing = false;
    store.saveTickets(ticketsWrite);
    expect(store.error).toBeNull();
  });

  it('returns no status categories without a store', () => {
    expect(new SafeStore(null).loadStatusCategories()).toEqual({});
  });

  it('works end to end with a real database', () => {
    const store = SafeStore.open(':memory:');
    store.saveRefresh(write);
    expect(store.error).toBeNull();
    expect(store.load({ org: 'acme', repos: [] })?.fetchedAt).toBe('2026-11-23T08:00:00.000Z');
    store.close();
  });
});
