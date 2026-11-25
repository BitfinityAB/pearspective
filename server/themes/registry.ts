import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { contrastIssues } from '../../shared/contrast';
import { resolveTheme } from '../../shared/themeResolve';
import { ThemeFileSchema, type ThemeFile } from '../../shared/themeSchema';
import type { ThemeInfo } from '../../shared/types';

const DEBOUNCE_MS = 200;
const REARM_MIN_MS = 5_000;
const REARM_MAX_MS = 5 * 60_000;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

interface Entry { info: ThemeInfo; dir: string; file?: ThemeFile; shown: string }
interface Candidate { id: string; path: string; dir: string; shown: string; problem?: string }

/** Built-in themes ship in the repo's themes/ folder; the user's own live apart from it, next to config.json. */
export function themeDirs(configPath: string, repoRoot = process.cwd()): { builtinDir: string; userDir: string } {
  return { builtinDir: resolve(repoRoot, 'themes'), userDir: resolve(dirname(configPath), 'custom-themes') };
}

/** Reads built-in and user theme files; a broken file is reported and never stops the others. */
export class ThemeRegistry {
  private entries = new Map<string, Entry>();
  // Seeded from the clock so a restart changes the version and open tabs refetch.
  private versionNumber = Date.now();
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private rearmTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: { builtinDir: string; userDir: string; onChange?: () => void }) {}

  async load(): Promise<void> {
    // The same folder twice would otherwise list every built-in as a user theme and write the schema over itself.
    const separate = this.separateDirs();
    if (separate) this.ensureUserDir();
    const defaults = this.builtinDefault();
    const entries = new Map<string, Entry>();
    for (const candidate of this.candidates(this.opts.builtinDir)) entries.set(candidate.id, this.prepare(this.read(candidate, 'builtin'), defaults));
    if (separate) {
      for (const candidate of this.candidates(this.opts.userDir)) {
        const entry = this.prepare(this.read(candidate, 'user'), defaults);
        const builtin = entries.get(candidate.id);
        if (builtin && !entry.info.valid) {
          // A broken file must not take a working built-in away, so the built-in stays and carries the warning.
          builtin.info = { ...builtin.info, warnings: [...builtin.info.warnings, `Your custom ${entry.shown} is invalid and is ignored: ${entry.info.error}.`] };
        } else {
          entries.set(candidate.id, entry);
        }
      }
    }
    this.entries = entries;
    this.versionNumber += 1;
  }

  list(): ThemeInfo[] {
    return [...this.entries.values()].map((entry) => entry.info).sort((a, b) => (a.id === 'default' ? -1 : b.id === 'default' ? 1 : a.name.localeCompare(b.name)));
  }

  version(): number {
    return this.versionNumber;
  }

  /** The folder and the relative file, so the caller can serve with `root` and dot-folders above the theme are not blocked. */
  fontFile(id: string, file: string): { root: string; file: string } | null {
    const entry = this.entries.get(id);
    if (!entry?.file || !entry.file.fontFiles?.some((font) => font.file === file)) return null;
    const absolute = resolve(entry.dir, file);
    try {
      // Real paths, so a symlinked font cannot lead outside the theme's folder.
      return realpathSync(absolute).startsWith(realpathSync(entry.dir) + sep) && absolute.startsWith(resolve(entry.dir) + sep) ? { root: resolve(entry.dir), file } : null;
    } catch {
      return null;
    }
  }

  watch(): void {
    this.close();
    this.startWatching(REARM_MIN_MS);
  }

  close(): void {
    this.stopWatching();
    if (this.rearmTimer) clearTimeout(this.rearmTimer);
    this.rearmTimer = null;
  }

  /** Returns whether watching started; on failure it tries again later, backing off, so theme edits keep applying without a restart. */
  private startWatching(retryMs: number): boolean {
    try {
      this.watcher = watch(this.opts.userDir, { recursive: true }, () => this.reloadSoon());
      this.watcher.on('error', (error) => {
        console.error('Watching the themes folder failed, trying again shortly:', error);
        this.stopWatching();
        this.rearmLater(REARM_MIN_MS);
      });
      return true;
    } catch (error) {
      console.error('Watching the themes folder failed, trying again shortly:', error);
      this.watcher = null;
      this.rearmLater(retryMs);
      return false;
    }
  }

  private rearmLater(delayMs: number): void {
    if (this.rearmTimer) clearTimeout(this.rearmTimer);
    this.rearmTimer = setTimeout(() => {
      this.rearmTimer = null;
      // The folder may have been deleted, which is what broke the watcher.
      if (this.separateDirs()) this.ensureUserDir();
      // Edits made while nothing was watching would otherwise go unseen until the next one.
      if (this.startWatching(Math.min(delayMs * 2, REARM_MAX_MS))) this.reloadSoon();
    }, delayMs);
  }

  private reloadSoon(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.load()
        .then(() => this.opts.onChange?.())
        .catch((error) => console.error('Reloading themes failed:', error));
    }, DEBOUNCE_MS);
  }

  private stopWatching(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private separateDirs(): boolean {
    return resolve(this.opts.userDir) !== resolve(this.opts.builtinDir);
  }

  private candidates(dir: string): Candidate[] {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (error) {
      // A missing or unreadable themes folder means no themes from there, not a failed start.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Reading the themes folder ${dir} failed:`, error);
      return [];
    }
    const found = names.flatMap((name): (Candidate & { name: string })[] => {
      // Editor and OS bookkeeping files (lock files, AppleDouble) are not themes.
      if (name.startsWith('.')) return [];
      const path = join(dir, name);
      try {
        if (name.endsWith('.json') && name !== 'theme.schema.json' && statSync(path).isFile()) return [{ name, id: name.slice(0, -5).toLowerCase(), path, dir, shown: name }];
        if (statSync(path).isDirectory() && existsSync(join(path, 'theme.json'))) return [{ name, id: name.toLowerCase(), path: join(path, 'theme.json'), dir: path, shown: `${name}/theme.json` }];
      } catch {
        // Dangling symlinks and files removed mid-scan (editor lock files) are skipped.
      }
      return [];
    });
    const perId = new Map<string, number>();
    for (const candidate of found) perId.set(candidate.id, (perId.get(candidate.id) ?? 0) + 1);
    return found.map(({ name, ...candidate }) => {
      if (!ID.test(candidate.id)) return { ...candidate, id: `invalid:${name}`, problem: 'The file name may contain only letters, digits and dashes.' };
      // Which of two files would win depends on read order, so neither is used.
      if (perId.get(candidate.id)! > 1) return { ...candidate, id: `invalid:${name}`, problem: `Another file also maps to the id "${candidate.id}"; keep only one of them.` };
      return candidate;
    });
  }

  private read(candidate: Candidate, source: 'builtin' | 'user'): Entry {
    const base: ThemeInfo = { id: candidate.id, name: candidate.id, modes: [], source, valid: false, warnings: [] };
    if (candidate.problem) return { dir: candidate.dir, shown: candidate.shown, info: { ...base, name: candidate.shown, error: `${candidate.shown}: ${candidate.problem}` } };
    let text: string;
    try {
      text = readFileSync(candidate.path, 'utf8');
    } catch (error) {
      return { dir: candidate.dir, shown: candidate.shown, info: { ...base, error: `${candidate.path}: could not be read (${(error as NodeJS.ErrnoException).code ?? (error as Error).message})` } };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      return { dir: candidate.dir, shown: candidate.shown, info: { ...base, error: `${candidate.path}: not valid JSON (${(error as Error).message})` } };
    }
    const parsed = ThemeFileSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const where = issue.path.join('.') || 'file';
      const detail = issue.code === 'unrecognized_keys' ? `unknown key ${issue.keys.join(', ')}` : issue.message;
      return { dir: candidate.dir, shown: candidate.shown, info: { ...base, error: `${candidate.path}: ${where}: ${detail}` } };
    }
    return { dir: candidate.dir, shown: candidate.shown, file: parsed.data, info: { ...base, name: parsed.data.name, modes: parsed.data.modes, valid: true } };
  }

  private prepare(entry: Entry, defaults: ThemeFile): Entry {
    if (!entry.file) return entry;
    try {
      // Always against the built-in Default: a partial user theme named "default" must not become the base for the rest.
      const theme = resolveTheme(entry.info.id, entry.file, defaults);
      const missing = theme.fontFiles.filter((font) => !existsSync(join(entry.dir, font.file))).map((font) => `Font file ${font.file} is missing.`);
      const contrast = contrastIssues(theme).map((issue) => `Low contrast (${issue.ratio}:1) for ${issue.pair} in ${issue.mode} mode.`);
      return { ...entry, info: { ...entry.info, theme, warnings: [...missing, ...contrast] } };
    } catch (error) {
      const { file: _dropped, ...rest } = entry;
      return { ...rest, info: { ...entry.info, valid: false, error: (error as Error).message } };
    }
  }

  private builtinDefault(): ThemeFile {
    return ThemeFileSchema.parse(JSON.parse(readFileSync(join(this.opts.builtinDir, 'default.json'), 'utf8')));
  }

  private ensureUserDir(): void {
    try {
      if (!existsSync(this.opts.userDir)) mkdirSync(this.opts.userDir, { recursive: true });
      // A copy next to the user's themes makes "$schema": "./theme.schema.json" work in their editor.
      // Written only when it differs: an unconditional write would trigger the watcher and reload in a loop.
      const target = join(this.opts.userDir, 'theme.schema.json');
      const schema = readFileSync(join(this.opts.builtinDir, 'theme.schema.json'));
      let regular = true;
      try { regular = lstatSync(target).isFile(); } catch { /* absent: write it */ }
      if (regular && (!existsSync(target) || !readFileSync(target).equals(schema))) writeFileSync(target, schema);
    } catch (error) {
      console.error('Preparing the themes folder failed:', error);
    }
  }
}
