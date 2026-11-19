import { readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { MAX_PINNED, MAX_REPOS, type RefreshSetting } from '../shared/types';

export const DEFAULT_REVIEWER_CLASSES = {
  'ai-review': ['copilot-pull-request-reviewer'],
  'code-analysis': ['codescene-access', 'codescene-delta-analysis'],
};

const REFRESH_SECONDS = [0, 180, 300, 600, 900, 1800] as const;

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
  issueTracker: z.object({ provider: z.string(), baseUrl: z.string().url() }).optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

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
