import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { contrastIssues } from '../../shared/contrast';
import { resolveTheme } from '../../shared/themeResolve';
import { ThemeFileSchema, type ThemeFile } from '../../shared/themeSchema';
import type { ThemeInfo } from '../../shared/types';

const DEBOUNCE_MS = 200;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

interface Entry { info: ThemeInfo; dir: string; file?: ThemeFile }

/** Reads built-in and user theme files; a broken file is reported and never stops the others. */
export class ThemeRegistry {
  private entries = new Map<string, Entry>();
  private versionNumber = 0;
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: { builtinDir: string; userDir: string; onChange?: () => void }) {}

  async load(): Promise<void> {
    this.ensureUserDir();
    const entries = new Map<string, Entry>();
    for (const [dir, source] of [[this.opts.builtinDir, 'builtin'], [this.opts.userDir, 'user']] as const) {
      for (const candidate of this.candidates(dir)) entries.set(candidate.id, this.read(candidate, source));
    }
    // Always the built-in Default: a partial user theme named "default" must not become the base for the rest.
    const defaults = this.builtinDefault();
    for (const entry of entries.values()) {
      if (!entry.file) continue;
      try {
        const theme = resolveTheme(entry.info.id, entry.file, defaults);
        const missing = theme.fontFiles.filter((font) => !existsSync(join(entry.dir, font.file))).map((font) => `Font file ${font.file} is missing.`);
        const contrast = contrastIssues(theme).map((issue) => `Low contrast (${issue.ratio}:1) for ${issue.pair} in ${issue.mode} mode.`);
        entry.info = { ...entry.info, theme, warnings: [...missing, ...contrast] };
      } catch (error) {
        entry.info = { ...entry.info, valid: false, error: (error as Error).message };
        delete entry.file;
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

  fontPath(id: string, file: string): string | null {
    const entry = this.entries.get(id);
    if (!entry?.file || !entry.file.fontFiles?.some((font) => font.file === file)) return null;
    const absolute = resolve(entry.dir, file);
    try {
      // Real paths, so a symlinked font cannot lead outside the theme's folder.
      return realpathSync(absolute).startsWith(realpathSync(entry.dir) + sep) && absolute.startsWith(resolve(entry.dir) + sep) ? absolute : null;
    } catch {
      return null;
    }
  }

  watch(): void {
    try {
      this.watcher = watch(this.opts.userDir, { recursive: true }, () => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.load()
            .then(() => this.opts.onChange?.())
            .catch((error) => console.error('Reloading themes failed:', error));
        }, DEBOUNCE_MS);
      });
      this.watcher.on('error', (error) => {
        console.error('Watching the themes folder failed:', error);
        this.close();
      });
    } catch (error) {
      // Without file watching, theme edits apply after a restart.
      console.error('Watching the themes folder failed:', error);
    }
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private candidates(dir: string): { id: string; path: string; dir: string }[] {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (error) {
      // A missing or unreadable themes folder means no themes from there, not a failed start.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Reading the themes folder ${dir} failed:`, error);
      return [];
    }
    return names.flatMap((name) => {
      const path = join(dir, name);
      try {
        if (name.endsWith('.json') && name !== 'theme.schema.json' && statSync(path).isFile()) return [{ id: name.slice(0, -5).toLowerCase(), path, dir }];
        if (statSync(path).isDirectory() && existsSync(join(path, 'theme.json'))) return [{ id: name.toLowerCase(), path: join(path, 'theme.json'), dir: path }];
      } catch {
        // Dangling symlinks and files removed mid-scan (editor lock files) are skipped.
      }
      return [];
    }).filter((candidate) => ID.test(candidate.id));
  }

  private read(candidate: { id: string; path: string; dir: string }, source: 'builtin' | 'user'): Entry {
    const base: ThemeInfo = { id: candidate.id, name: candidate.id, modes: [], source, valid: false, warnings: [] };
    let text: string;
    try {
      text = readFileSync(candidate.path, 'utf8');
    } catch (error) {
      return { dir: candidate.dir, info: { ...base, error: `${candidate.path}: could not be read (${(error as NodeJS.ErrnoException).code ?? (error as Error).message})` } };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      return { dir: candidate.dir, info: { ...base, error: `${candidate.path}: not valid JSON (${(error as Error).message})` } };
    }
    const parsed = ThemeFileSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const where = issue.path.join('.') || 'file';
      const detail = issue.code === 'unrecognized_keys' ? `unknown key ${issue.keys.join(', ')}` : issue.message;
      return { dir: candidate.dir, info: { ...base, error: `${candidate.path}: ${where}: ${detail}` } };
    }
    return { dir: candidate.dir, file: parsed.data, info: { ...base, name: parsed.data.name, modes: parsed.data.modes, valid: true } };
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
