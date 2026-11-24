import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, ConfigSchema, ConfigStore, hiddenPollInterval, notificationSettings, refreshToSeconds, resolveDatabasePath, secondsToRefresh } from '../config';

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

describe('issueTracker config', () => {
  const base = { codeHost: { provider: 'github', org: 'acme', repos: [] } };

  it('fills in the ticket defaults', () => {
    const config = ConfigSchema.parse({ ...base, issueTracker: { provider: 'jira', baseUrl: 'https://tracker.example.test' } });
    expect(config.issueTracker).toEqual({
      provider: 'jira',
      baseUrl: 'https://tracker.example.test',
      ticketStatus: true,
      refreshIntervalSec: 600,
      closedLookbackDays: 14,
      ignoreBases: ['release/*'],
      graceMinutes: 30,
      expectedStatuses: {},
    });
  });

  it('accepts status names per PR state and rejects unknown states', () => {
    const ok = ConfigSchema.parse({ ...base, issueTracker: { provider: 'jira', baseUrl: 'https://tracker.example.test', expectedStatuses: { open: ['In Review'] } } });
    expect(ok.issueTracker?.expectedStatuses.open).toEqual(['In Review']);
    expect(() => ConfigSchema.parse({ ...base, issueTracker: { provider: 'jira', baseUrl: 'https://tracker.example.test', expectedStatuses: { review: ['x'] } } })).toThrow();
  });
});

describe('notifications config', () => {
  const base = { codeHost: { provider: 'github', org: 'acme', repos: [] } };

  it('is off without a notifications block', () => {
    expect(notificationSettings(ConfigSchema.parse(base))).toEqual({
      enabled: false,
      events: { ciFailed: true, ciPassed: true, approved: true, changesRequested: true, readyToMerge: true, conflict: true, newComment: true, newThread: true, reviewRequested: false },
    });
  });

  it('merges listed events over the defaults and rejects unknown event names', () => {
    const config = ConfigSchema.parse({ ...base, notifications: { events: { reviewRequested: true, newThread: false } } });
    const settings = notificationSettings(config);
    expect(settings.enabled).toBe(true);
    expect(settings.events.reviewRequested).toBe(true);
    expect(settings.events.newThread).toBe(false);
    expect(settings.events.ciFailed).toBe(true);
    expect(() => ConfigSchema.parse({ ...base, notifications: { events: { pinged: true } } })).toThrow();
  });

  it('polls hidden tabs every 5 minutes only when notifications are on and auto-refresh is on', () => {
    const on = ConfigSchema.parse({ ...base, refreshIntervalSec: 180, notifications: { enabled: true } });
    expect(hiddenPollInterval(on)).toBe(300_000);
    const autoRefreshOff = ConfigSchema.parse({ ...base, refreshIntervalSec: 0, notifications: { enabled: true } });
    expect(hiddenPollInterval(autoRefreshOff)).toBeNull();
    expect(hiddenPollInterval(ConfigSchema.parse({ ...base, refreshIntervalSec: 180 }))).toBeNull();
  });
});

describe('databasePath', () => {
  const base = { codeHost: { provider: 'fake', org: 'acme', repos: ['orders-api'] } };

  it('defaults to pearspective.db next to config.json', () => {
    const config = ConfigSchema.parse(base);
    expect(config.databasePath).toBe('pearspective.db');
    expect(resolveDatabasePath(config, '/home/alex/pearspective/config.json')).toBe('/home/alex/pearspective/pearspective.db');
  });

  it('resolves a relative path from the config folder and keeps an absolute one', () => {
    expect(resolveDatabasePath(ConfigSchema.parse({ ...base, databasePath: 'data/state.db' }), '/home/alex/pearspective/config.json')).toBe('/home/alex/pearspective/data/state.db');
    expect(resolveDatabasePath(ConfigSchema.parse({ ...base, databasePath: '/var/lib/pearspective.db' }), '/home/alex/pearspective/config.json')).toBe('/var/lib/pearspective.db');
  });
});

describe('ConfigSchema theme', () => {
  it.each([
    ['is missing', undefined, 'default'],
    ['is upper case', 'Terminal', 'terminal'],
    ['is not a valid id', 'bad id!', 'default'],
    ['is not a string', 7, 'default'],
  ])('resolves a theme that %s', (_label, theme, expected) => {
    const parsed = ConfigSchema.safeParse({ ...minimal, ...(theme === undefined ? {} : { theme }) });
    expect(parsed.success && parsed.data.theme).toBe(expected);
  });
});
