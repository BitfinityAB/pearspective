import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { catalogEntryFor, readableName, REVIEWER_SLOTS, type ReviewerSlotKey } from '../shared/reviewers';
import { MAX_PINNED, MAX_REPOS, NOTIFICATION_DEFAULTS, type NotificationSettings, type RefreshSetting } from '../shared/types';
import { HIDDEN_POLL_MS } from './presence';
import type { ReviewerClasses } from './providers/types';

const ReviewerSlotSchema = z.object({
  name: z.string().min(1),
  logins: z.array(z.string().min(1)).min(1),
  short: z.string().min(1).optional(),
  show: z.boolean().default(true),
}).strict();

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
  // A missing slot means that tool is not configured: its column is not shown and its bots count as plain bots.
  reviewers: z.object({ aiReview: ReviewerSlotSchema.optional(), codeAnalysis: ReviewerSlotSchema.optional() }).strict().default({}),
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
  // A bad value falls back instead of stopping the server, since the Appearance tab is the only thing that needs it.
  theme: z.string().transform((value) => value.toLowerCase()).pipe(z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/)).catch('default'),
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

const OLD_CLASS: Record<ReviewerSlotKey, 'ai-review' | 'code-analysis'> = { aiReview: 'ai-review', codeAnalysis: 'code-analysis' };

/** Configs written before reviewers had names keep working: the old login lists become named slots. */
export function migrateReviewerClasses(raw: unknown): { raw: unknown; migrated: boolean } {
  if (!raw || typeof raw !== 'object' || !('reviewerClasses' in raw)) return { raw, migrated: false };
  const { reviewerClasses, ...rest } = raw as Record<string, unknown> & { reviewerClasses?: Record<string, unknown> };
  if ('reviewers' in rest) return { raw: rest, migrated: true };
  const reviewers: Record<string, unknown> = {};
  for (const slot of REVIEWER_SLOTS) {
    const logins = reviewerClasses?.[OLD_CLASS[slot]];
    if (!Array.isArray(logins) || logins.length === 0 || !logins.every((login) => typeof login === 'string')) continue;
    const known = logins.map((login) => catalogEntryFor(login.replace(/\*$/, ''))).find((entry) => entry?.slot === slot);
    reviewers[slot] = { name: known?.name ?? readableName(logins[0]!.replace(/\*$/, '')), logins, show: true };
  }
  return { raw: { ...rest, reviewers }, migrated: true };
}

export const reviewerClassesOf = (config: Pick<Config, 'reviewers'>): ReviewerClasses => ({
  'ai-review': config.reviewers.aiReview?.logins ?? [],
  'code-analysis': config.reviewers.codeAnalysis?.logins ?? [],
});

export class ConfigStore {
  private queue: Promise<unknown> = Promise.resolve();

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
    const { raw: current, migrated } = migrateReviewerClasses(raw);
    const store = new ConfigStore(path, parse(current, path));
    if (migrated) {
      await store.save(store.get());
      console.log(`Rewrote ${path}: reviewerClasses is now reviewers.`);
    }
    return store;
  }

  get(): Config {
    return this.config;
  }

  async save(next: Config): Promise<void> {
    await this.update(() => next);
  }

  /** Changes run one at a time against the latest config, so overlapping requests neither share the temp file nor undo each other. */
  update(change: (current: Config) => Config): Promise<Config> {
    const result = this.queue.then(async () => {
      const valid = parse(change(this.config), this.path);
      // Write then rename so a crash never leaves a half-written config.
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`);
      await rename(temporary, this.path);
      this.config = valid;
      return valid;
    });
    // A failed change must not block the ones queued after it.
    this.queue = result.catch(() => undefined);
    return result;
  }
}

export const refreshToSeconds = (setting: RefreshSetting): number => (setting === 'off' ? 0 : setting * 60);
export const secondsToRefresh = (seconds: number): RefreshSetting => (seconds === 0 ? 'off' : (seconds / 60) as RefreshSetting);
