import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { MAX_PINNED, MAX_REPOS, NOTIFICATION_DEFAULTS, type NotificationSettings, type RefreshSetting } from '../shared/types';
import { HIDDEN_POLL_MS } from './presence';

export const DEFAULT_REVIEWER_CLASSES = {
  'ai-review': ['copilot-pull-request-reviewer'],
  'code-analysis': ['codescene-access', 'codescene-delta-analysis'],
};

const REFRESH_SECONDS = [0, 180, 300, 600, 900, 1800] as const;

const toggle = z.boolean().optional();
export const NotificationsSchema = z.object({
  enabled: z.boolean().default(true),
  // strict() so a misspelled event name is an error instead of a silently ignored setting.
  events: z.object({
    ciFailed: toggle, ciPassed: toggle, approved: toggle, changesRequested: toggle,
    readyToMerge: toggle, conflict: toggle, newComment: toggle, newThread: toggle, reviewRequested: toggle,
  }).strict().default({}),
});

export const ConfigSchema = z.object({
  codeHost: z.object({
    provider: z.string().min(1),
    org: z.string().min(1),
    repos: z.array(z.string().min(1)).max(MAX_REPOS, `At most ${MAX_REPOS} repositories`),
    excludeRepos: z.array(z.string()).default([]),
    teams: z.array(z.string()).default([]),
    localRepos: z.array(z.string()).default([]),
  }),
  reviewerClasses: z.object({
    'ai-review': z.array(z.string()).default(DEFAULT_REVIEWER_CLASSES['ai-review']),
    'code-analysis': z.array(z.string()).default(DEFAULT_REVIEWER_CLASSES['code-analysis']),
  }).default(DEFAULT_REVIEWER_CLASSES),
  refreshIntervalSec: z.number().refine((value) => (REFRESH_SECONDS as readonly number[]).includes(value), {
    message: `refreshIntervalSec must be one of ${REFRESH_SECONDS.join(', ')}`,
  }).default(180),
  pinned: z.array(z.string()).max(MAX_PINNED, `At most ${MAX_PINNED} pinned pull requests`).default([]),
  issueTracker: z.object({
    provider: z.string(),
    baseUrl: z.string().url(),
    // false keeps ticket links only, for setups without the tracker's CLI.
    ticketStatus: z.boolean().default(true),
    refreshIntervalSec: z.number().int().min(60).default(600),
    closedLookbackDays: z.number().int().min(1).max(90).default(14),
    ignoreBases: z.array(z.string()).default(['release/*']),
    graceMinutes: z.number().int().min(0).default(30),
    // strict() rejects misspelled PR states, which would otherwise be ignored silently.
    expectedStatuses: z.object({
      draft: z.array(z.string()).optional(),
      open: z.array(z.string()).optional(),
      merged: z.array(z.string()).optional(),
      abandoned: z.array(z.string()).optional(),
    }).strict().default({}),
  }).optional(),
  notifications: NotificationsSchema.optional(),
  // Relative to config.json; pointing it outside the checkout keeps PR and ticket data out of the repo folder.
  theme: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).default('default'),
  databasePath: z.string().min(1).default('pearspective.db'),
});
export type Config = z.infer<typeof ConfigSchema>;
export type IssueTrackerConfig = NonNullable<Config['issueTracker']>;

/** No block means notifications are off; listed events override the defaults. */
export function notificationSettings(config: Config): NotificationSettings {
  const block = config.notifications;
  const listed = Object.fromEntries(Object.entries(block?.events ?? {}).filter(([, value]) => value !== undefined));
  return { enabled: Boolean(block?.enabled), events: { ...NOTIFICATION_DEFAULTS, ...listed } };
}

/** Auto-refresh off means no background API use, so hidden tabs do not poll either. */
export function hiddenPollInterval(config: Config): number | null {
  return notificationSettings(config).enabled && config.refreshIntervalSec !== 0 ? HIDDEN_POLL_MS : null;
}

export function resolveDatabasePath(config: Config, configPath: string): string {
  return resolve(dirname(configPath), config.databasePath);
}

export class ConfigError extends Error {}

function parse(raw: unknown, path: string): Config {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`${path} is invalid: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  return result.data;
}

export class ConfigStore {
  private constructor(private readonly path: string, private config: Config) {}

  static async open(path: string): Promise<ConfigStore> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ConfigError(`${path} not found. Run \`npm run setup\` first.`);
      throw error;
    }
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new ConfigError(`${path} is not valid JSON.`); }
    return new ConfigStore(path, parse(raw, path));
  }

  get(): Config {
    return this.config;
  }

  async save(next: Config): Promise<void> {
    const valid = parse(next, this.path);
    // Write then rename so a crash never leaves a half-written config.
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`);
    await rename(temporary, this.path);
    this.config = valid;
  }
}

export const refreshToSeconds = (setting: RefreshSetting): number => (setting === 'off' ? 0 : setting * 60);
export const secondsToRefresh = (seconds: number): RefreshSetting => (seconds === 0 ? 'off' : (seconds / 60) as RefreshSetting);
