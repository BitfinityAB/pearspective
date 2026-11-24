import { mkdirSync, mkdtempSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThemeRegistry } from '../themes/registry';

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
    expect(registry.fontPath('calm', 'fonts/calm.woff2')).toBe(join(userDir, 'calm', 'fonts', 'calm.woff2'));
    expect(registry.fontPath('calm', 'secret.txt')).toBeNull();
    expect(registry.fontPath('calm', '../calm/fonts/calm.woff2')).toBeNull();
    expect(registry.fontPath('nope', 'fonts/calm.woff2')).toBeNull();
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
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 });
      expect(registry.version()).toBeGreaterThan(before);
      expect(registry.list().some((theme) => theme.id === 'calm')).toBe(true);
    } finally {
      registry.close();
    }
  });
});
