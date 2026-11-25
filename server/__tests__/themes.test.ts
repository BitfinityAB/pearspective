import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThemeRegistry, themeDirs } from '../themes/registry';

const builtinDir = join(process.cwd(), 'themes');
const tempUserDir = () => mkdtempSync(join(tmpdir(), 'pearspective-themes-'));
const write = (dir: string, name: string, body: unknown) => writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));

describe('ThemeRegistry', () => {
  it('lists built-in themes resolved against Default', async () => {
    const registry = new ThemeRegistry({ builtinDir, userDir: tempUserDir() });
    await registry.load();
    const builtin = registry.list().find((theme) => theme.id === 'default')!;
    expect(builtin).toMatchObject({ name: 'Default', source: 'builtin', valid: true, modes: ['light', 'dark'] });
    expect(builtin.theme?.dark?.colors.bg).toBeDefined();
  });

  it('lists the built-in Terminal theme as valid, without warnings, with its font files', async () => {
    const registry = new ThemeRegistry({ builtinDir, userDir: tempUserDir() });
    await registry.load();
    const terminal = registry.list().find((theme) => theme.id === 'terminal')!;
    expect(terminal).toMatchObject({ name: 'Terminal', source: 'builtin', valid: true, modes: ['dark'], warnings: [] });
    expect(registry.fontFile('terminal', 'fonts/JetBrainsMono-Regular.woff2')).toEqual({ root: join(builtinDir, 'terminal'), file: 'fonts/JetBrainsMono-Regular.woff2' });
  });

  it('adds user themes, reports broken ones and lets a user theme replace a built-in', async () => {
    const userDir = tempUserDir();
    write(userDir, 'calm.json', { name: 'Calm', modes: ['dark'], dark: { colors: { accent: '#88ccff' } } });
    write(userDir, 'broken.json', '{ not json');
    write(userDir, 'typo.json', { name: 'Typo', modes: ['dark'], dark: { colors: { accnet: '#fff' } } });
    write(userDir, 'default.json', { name: 'My Default', modes: ['light'], light: {} });
    const registry = new ThemeRegistry({ builtinDir, userDir });
    await registry.load();
    const byId = Object.fromEntries(registry.list().map((theme) => [theme.id, theme]));
    expect(byId.calm).toMatchObject({ valid: true, source: 'user' });
    expect(byId.broken).toMatchObject({ valid: false, source: 'user' });
    expect(byId.broken!.error).toMatch(/JSON/);
    expect(byId.typo!.error).toMatch(/accnet/);
    expect(byId.default).toMatchObject({ name: 'My Default', source: 'user' });
  });

  it('resolves a partial user Default against the built-in Default', async () => {
    const userDir = tempUserDir();
    write(userDir, 'default.json', { name: 'My Default', modes: ['light'], light: {} });
    const registry = new ThemeRegistry({ builtinDir, userDir });
    await registry.load();
    const userDefault = registry.list().find((theme) => theme.id === 'default')!;
    expect(userDefault.valid).toBe(true);
    expect(userDefault.theme?.light?.colors.bg).toBeDefined();
    expect(userDefault.theme?.light?.colors.accent).toBeDefined();
  });

  it('marks a theme invalid instead of failing the load when resolving it throws', async () => {
    const userDir = tempUserDir();
    write(userDir, 'calm.json', { name: 'Calm', modes: ['dark'], dark: {} });
    const registry = new ThemeRegistry({ builtinDir, userDir });
    const resolver = await import('../../shared/themeResolve');
    const spy = vi.spyOn(resolver, 'resolveTheme').mockImplementation((id) => {
      if (id === 'calm') throw new Error('cannot resolve');
      throw new Error('unexpected');
    });
    try {
      await registry.load();
    } finally {
      spy.mockRestore();
    }
    const calm = registry.list().find((theme) => theme.id === 'calm')!;
    expect(calm).toMatchObject({ valid: false, error: 'cannot resolve' });
  });

  it('reads a theme folder with its fonts and serves only listed woff2 files inside it', async () => {
    const userDir = tempUserDir();
    mkdirSync(join(userDir, 'calm', 'fonts'), { recursive: true });
    write(join(userDir, 'calm'), 'theme.json', { name: 'Calm', modes: ['dark'], dark: {}, fontFiles: [{ family: 'Calm Sans', file: 'fonts/calm.woff2' }] });
    writeFileSync(join(userDir, 'calm', 'fonts', 'calm.woff2'), 'font');
    writeFileSync(join(userDir, 'calm', 'secret.txt'), 'nope');
    const registry = new ThemeRegistry({ builtinDir, userDir });
    await registry.load();
    expect(registry.fontFile('calm', 'fonts/calm.woff2')).toEqual({ root: join(userDir, 'calm'), file: 'fonts/calm.woff2' });
    expect(registry.fontFile('calm', 'secret.txt')).toBeNull();
    expect(registry.fontFile('calm', '../calm/fonts/calm.woff2')).toBeNull();
    expect(registry.fontFile('nope', 'fonts/calm.woff2')).toBeNull();
  });

  it('warns about a missing font file and low contrast without rejecting the theme', async () => {
    const userDir = tempUserDir();
    write(userDir, 'faint.json', { name: 'Faint', modes: ['dark'], dark: { colors: { text: '#222222', bg: '#111111' } }, fontFiles: [{ family: 'Gone', file: 'fonts/gone.woff2' }] });
    const registry = new ThemeRegistry({ builtinDir, userDir });
    await registry.load();
    const faint = registry.list().find((theme) => theme.id === 'faint')!;
    expect(faint.valid).toBe(true);
    expect(faint.warnings.join(' ')).toMatch(/gone\.woff2/);
    expect(faint.warnings.join(' ')).toMatch(/contrast/i);
  });

  it('creates the user folder with the schema file when it is missing', async () => {
    const parent = tempUserDir();
    const userDir = join(parent, 'themes');
    const registry = new ThemeRegistry({ builtinDir, userDir });
    await registry.load();
    expect(() => cpSync(join(userDir, 'theme.schema.json'), join(parent, 'copy.json'))).not.toThrow();
  });

  it('reloads and calls onChange shortly after a file changes', async () => {
    const userDir = tempUserDir();
    const onChange = vi.fn();
    const registry = new ThemeRegistry({ builtinDir, userDir, onChange });
    try {
      await registry.load();
      registry.watch();
      const before = registry.version();
      write(userDir, 'calm.json', { name: 'Calm', modes: ['dark'], dark: {} });
      // The first event can be missed while the OS watcher is still starting, so the same content is written again on each attempt.
      // The interval is longer than the 200 ms debounce, or the rewrites would keep postponing the reload.
      await vi.waitFor(() => {
        write(userDir, 'calm.json', { name: 'Calm', modes: ['dark'], dark: {} });
        expect(registry.list().some((theme) => theme.id === 'calm')).toBe(true);
      }, { timeout: 4000, interval: 400 });
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 });
      expect(registry.version()).toBeGreaterThan(before);
    } finally {
      registry.close();
    }
  });

  it('skips a dangling symlink in the user folder and lists the other themes', async () => {
    const userDir = tempUserDir();
    write(userDir, 'calm.json', { name: 'Calm', modes: ['dark'], dark: {} });
    symlinkSync(join(userDir, 'missing-target'), join(userDir, '.#calm.json'));
    const registry = new ThemeRegistry({ builtinDir, userDir });
    await expect(registry.load()).resolves.toBeUndefined();
    expect(registry.list().map((theme) => theme.id)).toEqual(['default', 'calm', 'terminal']);
  });

  it('treats a user folder that is a regular file as empty', async () => {
    const userDir = join(tempUserDir(), 'themes');
    writeFileSync(userDir, 'not a folder');
    const registry = new ThemeRegistry({ builtinDir, userDir });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(registry.load()).resolves.toBeUndefined();
    } finally {
      logged.mockRestore();
    }
    expect(registry.list().map((theme) => theme.id)).toEqual(['default', 'terminal']);
  });

  it('refuses a font that is a symlink to a file outside the theme folder', async () => {
    const userDir = tempUserDir();
    const outside = join(tempUserDir(), 'outside.woff2');
    writeFileSync(outside, 'font');
    mkdirSync(join(userDir, 'calm', 'fonts'), { recursive: true });
    write(join(userDir, 'calm'), 'theme.json', { name: 'Calm', modes: ['dark'], dark: {}, fontFiles: [{ family: 'Calm Sans', file: 'fonts/x.woff2' }] });
    symlinkSync(outside, join(userDir, 'calm', 'fonts', 'x.woff2'));
    const registry = new ThemeRegistry({ builtinDir, userDir });
    await registry.load();
    expect(registry.fontFile('calm', 'fonts/x.woff2')).toBeNull();
  });

  describe('after a watcher error', () => {
    type Watched = { watcher: { emit: (event: string, error: Error) => boolean } | null };
    const watcherOf = (registry: ThemeRegistry) => (registry as unknown as Watched).watcher;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('logs, then watches again 5 seconds later and reloads to catch missed edits', async () => {
      const onChange = vi.fn();
      const registry = new ThemeRegistry({ builtinDir, userDir: tempUserDir(), onChange });
      await registry.load();
      registry.watch();
      try {
        expect(() => watcherOf(registry)!.emit('error', new Error('boom'))).not.toThrow();
        expect(console.error).toHaveBeenCalled();
        expect(watcherOf(registry)).toBeNull();
        await vi.advanceTimersByTimeAsync(4900);
        expect(watcherOf(registry)).toBeNull();
        await vi.advanceTimersByTimeAsync(400);
        expect(watcherOf(registry)).not.toBeNull();
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
      } finally {
        registry.close();
      }
    });

    it('recreates a deleted themes folder before watching it again', async () => {
      const userDir = join(tempUserDir(), 'custom-themes');
      const registry = new ThemeRegistry({ builtinDir, userDir });
      registry.watch();
      try {
        expect(watcherOf(registry)).toBeNull();
        await vi.advanceTimersByTimeAsync(5100);
        expect(existsSync(userDir)).toBe(true);
        expect(watcherOf(registry)).not.toBeNull();
      } finally {
        registry.close();
      }
    });

    it('stops trying again once closed', async () => {
      const registry = new ThemeRegistry({ builtinDir, userDir: tempUserDir() });
      await registry.load();
      registry.watch();
      watcherOf(registry)!.emit('error', new Error('boom'));
      registry.close();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(watcherOf(registry)).toBeNull();
    });
  });

  it('says a theme file could not be read instead of calling it invalid JSON', async () => {
    const userDir = tempUserDir();
    mkdirSync(join(userDir, 'calm'));
    mkdirSync(join(userDir, 'calm', 'theme.json'));
    const registry = new ThemeRegistry({ builtinDir, userDir });
    await registry.load();
    const calm = registry.list().find((theme) => theme.id === 'calm')!;
    expect(calm.valid).toBe(false);
    expect(calm.error).toMatch(/could not be read \(EISDIR\)/);
  });

  it('leaves a theme.schema.json that is not a regular file alone', async () => {
    const userDir = tempUserDir();
    symlinkSync(join(userDir, 'missing-target'), join(userDir, 'theme.schema.json'));
    const registry = new ThemeRegistry({ builtinDir, userDir });
    await expect(registry.load()).resolves.toBeUndefined();
    expect(registry.list().map((theme) => theme.id)).toEqual(['default', 'terminal']);
  });

  it('seeds the version from the clock so a restart changes it', async () => {
    const startedAt = Date.now();
    const registry = new ThemeRegistry({ builtinDir, userDir: tempUserDir() });
    await registry.load();
    expect(registry.version()).toBeGreaterThan(startedAt);
  });

  it('skips the user pass and leaves the built-in folder untouched when both folders are the same', async () => {
    const copy = join(tempUserDir(), 'themes');
    cpSync(builtinDir, copy, { recursive: true });
    const before = readdirSync(copy).sort();
    const registry = new ThemeRegistry({ builtinDir: copy, userDir: copy });
    await registry.load();
    expect(registry.list().map((theme) => [theme.id, theme.source])).toEqual([['default', 'builtin'], ['terminal', 'builtin']]);
    expect(readdirSync(copy).sort()).toEqual(before);
    expect(readFileSync(join(copy, 'theme.schema.json'))).toEqual(readFileSync(join(builtinDir, 'theme.schema.json')));
  });

  it('builds the registry as the server does: built-ins stay built-in, custom-themes is created and its themes are user themes', async () => {
    const repo = tempUserDir();
    cpSync(builtinDir, join(repo, 'themes'), { recursive: true });
    const dirs = themeDirs(join(repo, 'config.json'), repo);
    const registry = new ThemeRegistry(dirs);
    await registry.load();
    expect(registry.list().map((theme) => [theme.id, theme.source])).toEqual([['default', 'builtin'], ['terminal', 'builtin']]);
    expect(existsSync(join(repo, 'custom-themes', 'theme.schema.json'))).toBe(true);
    expect(readdirSync(join(repo, 'themes')).sort()).toEqual(readdirSync(builtinDir).sort());
    write(join(repo, 'custom-themes'), 'calm.json', { name: 'Calm', modes: ['dark'], dark: {} });
    await registry.load();
    expect(registry.list().find((theme) => theme.id === 'calm')).toMatchObject({ source: 'user', valid: true });
    expect(registry.list().find((theme) => theme.id === 'terminal')).toMatchObject({ source: 'builtin' });
  });

  it('keeps a built-in theme and warns on it when the custom file of the same name is invalid', async () => {
    const userDir = tempUserDir();
    write(userDir, 'terminal.json', { name: 'Mine', modes: ['dark'], dark: { colors: { accnet: '#fff' } } });
    const registry = new ThemeRegistry({ builtinDir, userDir });
    await registry.load();
    const terminal = registry.list().find((theme) => theme.id === 'terminal')!;
    expect(terminal).toMatchObject({ name: 'Terminal', source: 'builtin', valid: true });
    expect(terminal.warnings).toHaveLength(1);
    expect(terminal.warnings[0]).toMatch(/^Your custom terminal\.json is invalid and is ignored: .*accnet.*\.$/);
  });

  it('lists a file whose name breaks the id rule as an invalid entry that cannot be picked', async () => {
    const userDir = tempUserDir();
    write(userDir, 'My Theme.json', { name: 'Mine', modes: ['dark'], dark: {} });
    const registry = new ThemeRegistry({ builtinDir, userDir });
    await registry.load();
    const entry = registry.list().find((theme) => theme.id === 'invalid:My Theme.json')!;
    expect(entry).toMatchObject({ valid: false, source: 'user' });
    expect(entry.error).toContain('The file name may contain only letters, digits and dashes.');
    expect(registry.fontFile('invalid:My Theme.json', 'fonts/x.woff2')).toBeNull();
  });

  it('reports two files that map to the same id as invalid duplicates instead of picking one', async () => {
    const userDir = tempUserDir();
    write(userDir, 'calm.json', { name: 'Calm', modes: ['dark'], dark: {} });
    mkdirSync(join(userDir, 'calm'));
    write(join(userDir, 'calm'), 'theme.json', { name: 'Calm folder', modes: ['dark'], dark: {} });
    const registry = new ThemeRegistry({ builtinDir, userDir });
    await registry.load();
    const ids = registry.list().map((theme) => theme.id);
    expect(ids).not.toContain('calm');
    const duplicates = registry.list().filter((theme) => theme.id.startsWith('invalid:calm'));
    expect(duplicates.map((theme) => theme.id).sort()).toEqual(['invalid:calm', 'invalid:calm.json']);
    for (const duplicate of duplicates) {
      expect(duplicate.valid).toBe(false);
      expect(duplicate.error).toMatch(/also maps to the id "calm"/);
    }
  });
});
