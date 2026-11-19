import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, ConfigStore, refreshToSeconds, secondsToRefresh } from '../config';

async function tempConfig(contents?: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'prdash-'));
  const path = join(dir, 'config.json');
  if (contents !== undefined) await writeFile(path, JSON.stringify(contents));
  return path;
}

const minimal = { codeHost: { provider: 'github', org: 'acme', repos: ['orders-api'] } };

describe('ConfigStore', () => {
  it('fills defaults for reviewer classes, teams and refresh', async () => {
    const store = await ConfigStore.open(await tempConfig(minimal));
    expect(store.get()).toMatchObject({
      codeHost: { excludeRepos: [], teams: [], localRepos: [] },
      reviewerClasses: { 'ai-review': ['copilot-pull-request-reviewer'], 'code-analysis': ['codescene-access', 'codescene-delta-analysis'] },
      refreshIntervalSec: 180,
    });
  });

  it('tells the user to run setup when the file is missing', async () => {
    await expect(ConfigStore.open(await tempConfig())).rejects.toThrow(/npm run setup/);
  });

  it('rejects more than ten repositories and an unsupported interval', async () => {
    const tooMany = { codeHost: { ...minimal.codeHost, repos: Array.from({ length: 11 }, (_, index) => `repo-${index}`) } };
    await expect(ConfigStore.open(await tempConfig(tooMany))).rejects.toBeInstanceOf(ConfigError);
    await expect(ConfigStore.open(await tempConfig({ ...minimal, refreshIntervalSec: 60 }))).rejects.toBeInstanceOf(ConfigError);
  });

  it('saves validated changes to disk', async () => {
    const path = await tempConfig(minimal);
    const store = await ConfigStore.open(path);
    await store.save({ ...store.get(), refreshIntervalSec: 600 });
    expect(JSON.parse(await readFile(path, 'utf8')).refreshIntervalSec).toBe(600);
    expect(store.get().refreshIntervalSec).toBe(600);
  });
});

describe('refresh conversion', () => {
  it('maps off to 0 seconds and minutes to seconds, both ways', () => {
    expect(refreshToSeconds('off')).toBe(0);
    expect(refreshToSeconds(5)).toBe(300);
    expect(secondsToRefresh(0)).toBe('off');
    expect(secondsToRefresh(1800)).toBe(30);
  });
});
