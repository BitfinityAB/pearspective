import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '../../config';
import { openStorage } from '../startup';

const base = { codeHost: { provider: 'fake', org: 'acme', repos: ['orders-api', 'billing'], excludeRepos: ['billing'] } };

describe('openStorage', () => {
  it('opens the database next to config.json and loads nothing on the first run', () => {
    const folder = mkdtempSync(join(tmpdir(), 'pearspective-start-'));
    const { store, stored } = openStorage(ConfigSchema.parse(base), join(folder, 'config.json'));
    expect(store.error).toBeNull();
    expect(stored).toBeNull();
    store.close();
  });

  it('loads what an earlier run saved for the configured repos', () => {
    const folder = mkdtempSync(join(tmpdir(), 'pearspective-start-'));
    const config = ConfigSchema.parse(base);
    const first = openStorage(config, join(folder, 'config.json'));
    first.store.saveRefresh({ org: 'acme', host: 'example.test', fetchedAt: '2026-11-23T08:00:00.000Z', viewer: { login: 'alex', teams: [] }, upserted: [], removedIds: [], overviewIds: [], mine: { authored: [], requested: [], team: [] } });
    first.store.close();
    const second = openStorage(config, join(folder, 'config.json'));
    expect(second.stored?.fetchedAt).toBe('2026-11-23T08:00:00.000Z');
    second.store.close();
  });

  it('carries on without a database when the path cannot be opened', () => {
    const folder = mkdtempSync(join(tmpdir(), 'pearspective-start-'));
    mkdirSync(join(folder, 'taken'));
    const { store, stored } = openStorage(ConfigSchema.parse({ ...base, databasePath: 'taken' }), join(folder, 'config.json'));
    expect(store.error).toMatch(/^Local database unavailable:/);
    expect(stored).toBeNull();
  });
});
