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
  });

  it('keeps Default identical to today\'s tokens.css', () => {
    const theme = resolveTheme('default', defaults, defaults);
    for (const mode of ['light', 'dark'] as const) {
      const today = tokensCss(mode);
      for (const name of COLOR_TOKEN_NAMES) expect([name, theme[mode]!.colors[name]]).toEqual([name, today[COLOR_TOKENS[name]]]);
    }
  });
});
