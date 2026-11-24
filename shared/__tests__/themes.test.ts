import { readFileSync } from 'node:fs';
import { ThemeFileSchema } from '../themeSchema';
import { resolveTheme } from '../themeResolve';
import { COLOR_TOKENS, COLOR_TOKEN_NAMES } from '../themeTokens';

const defaults = ThemeFileSchema.parse(JSON.parse(readFileSync('themes/default.json', 'utf8')));

/** Today's values from tokens.css, per mode, so Default provably looks unchanged. */
function tokensCss(mode: 'light' | 'dark'): Record<string, string> {
  const css = readFileSync('web/src/styles/tokens.css', 'utf8');
  const block = mode === 'light' ? css.slice(css.indexOf(':root {'), css.indexOf('}')) : css.slice(css.indexOf(':root[data-theme="dark"]'));
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2]!.trim()]));
}

describe('theme schema', () => {
  it('accepts a minimal theme', () => {
    expect(ThemeFileSchema.safeParse({ name: 'Calm', modes: ['dark'], dark: { colors: { accent: '#88ccff' } } }).success).toBe(true);
  });

  it.each([
    ['an unknown top-level key', { name: 'X', modes: ['dark'], dark: {}, css: 'body{}' }],
    ['an unknown colour token', { name: 'X', modes: ['dark'], dark: { colors: { accnet: '#fff' } } }],
    ['a value that is not a colour', { name: 'X', modes: ['dark'], dark: { colors: { accent: 'url(x)' } } }],
    ['a missing mode block', { name: 'X', modes: ['light', 'dark'], dark: {} }],
    ['a block for an unlisted mode', { name: 'X', modes: ['dark'], dark: {}, light: {} }],
    ['a font path outside the theme folder', { name: 'X', modes: ['dark'], dark: {}, fontFiles: [{ family: 'F', file: '../evil.woff2' }] }],
    ['a font that is not woff2', { name: 'X', modes: ['dark'], dark: {}, fontFiles: [{ family: 'F', file: 'fonts/f.ttf' }] }],
    ['a font name with a newline', { name: 'X', modes: ['dark'], dark: { fonts: { ui: 'A\nB' } } }],
    ['a font name with a trailing newline', { name: 'X', modes: ['dark'], dark: { fonts: { ui: 'Inter\n' } } }],
    ['a whitespace-only font name', { name: 'X', modes: ['dark'], dark: { fonts: { ui: '  ' } } }],
    ['a 5-digit hex colour', { name: 'X', modes: ['dark'], dark: { colors: { accent: '#12345' } } }],
    ['a colour with a semicolon', { name: 'X', modes: ['dark'], dark: { colors: { accent: 'rgb(1,2,3);' } } }],
    ['a colour with a brace', { name: 'X', modes: ['dark'], dark: { colors: { accent: 'rgb(1,2,3)}' } } }],
    ['a colour with a quote', { name: 'X', modes: ['dark'], dark: { colors: { accent: 'rgb(1,2,3)"' } } }],
    ['duplicate modes', { name: 'X', modes: ['dark', 'dark'], dark: {} }],
    ['a font family with CSS characters', { name: 'X', modes: ['dark'], dark: { fonts: { ui: 'A; } body { x' } } }],
  ])('rejects %s', (_label, file) => {
    expect(ThemeFileSchema.safeParse(file).success).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('fills every missing key from Default', () => {
    const theme = resolveTheme('calm', ThemeFileSchema.parse({ name: 'Calm', modes: ['dark'], dark: { colors: { accent: '#88ccff' } } }), defaults);
    expect(theme.dark!.colors.accent).toBe('#88ccff');
    expect(theme.dark!.colors.bg).toBe(defaults.dark!.colors!.bg);
    expect(theme.light).toBeUndefined();
    expect(theme.shape).toEqual(resolveTheme('default', defaults, defaults).shape);
    for (const name of COLOR_TOKEN_NAMES) expect(theme.dark!.colors[name]).toMatch(/\S/);
    expect(theme.dark!.fonts).toEqual(defaults.dark!.fonts);
  });

  it('borrows the mode a single-mode Default has', () => {
    const darkOnly = ThemeFileSchema.parse({ name: 'Dark only', modes: ['dark'], dark: defaults.dark });
    const theme = resolveTheme('calm', ThemeFileSchema.parse({ name: 'Calm', modes: ['light'], light: {} }), darkOnly);
    expect(theme.light!.colors).toEqual(defaults.dark!.colors);
  });

  it('throws a clear error when Default is incomplete', () => {
    const incomplete = ThemeFileSchema.parse({ name: 'Broken', modes: ['dark'], dark: {} });
    const file = ThemeFileSchema.parse({ name: 'Calm', modes: ['dark'], dark: {} });
    expect(() => resolveTheme('calm', file, incomplete)).toThrow(/^Default theme is incomplete: missing dark\./);
  });

  it('keeps Default identical to today\'s tokens.css', () => {
    const theme = resolveTheme('default', defaults, defaults);
    for (const mode of ['light', 'dark'] as const) {
      const today = tokensCss(mode);
      expect(Object.keys(today).filter((variable) => variable !== '--mono').sort()).toEqual(Object.values(COLOR_TOKENS).sort());
      for (const name of COLOR_TOKEN_NAMES) expect([name, theme[mode]!.colors[name]]).toEqual([name, today[COLOR_TOKENS[name]]]);
    }
  });
});
