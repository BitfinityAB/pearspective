// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { themeCss } from '../themes/css';
import { THEME_CSS_KEY, applyThemeCss } from '../themes/apply';
import { ThemeFileSchema } from '../../../shared/themeSchema';
import { resolveTheme } from '../../../shared/themeResolve';

const defaults = ThemeFileSchema.parse(JSON.parse(readFileSync('themes/default.json', 'utf8')));
const url = (file: string) => `/api/themes/calm/files/${file}`;

describe('themeCss', () => {
  it('writes both modes with the same selectors as tokens.css', () => {
    const css = themeCss(resolveTheme('default', defaults, defaults), url);
    expect(css).toContain(':root {');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain(`--bg: ${defaults.light!.colors!.bg};`);
    expect(css).toContain('--font-ui: "Inter", system-ui, sans-serif;');
  });

  it('keeps chips as they are today for Default even though its labels are uppercase', () => {
    const css = themeCss(resolveTheme('default', defaults, defaults), url);
    expect(css).toContain('--label-case: uppercase;');
    expect(css).toContain('--chip-case: none;');
  });

  it('forces the only mode of a single-mode theme whatever the browser mode is', () => {
    const theme = resolveTheme('calm', ThemeFileSchema.parse({ name: 'Calm', modes: ['dark'], dark: { colors: { accent: '#88ccff' } } }), defaults);
    const css = themeCss(theme, url);
    expect(css).toContain(':root, :root[data-theme="light"], :root[data-theme="dark"], :root:not([data-theme="light"])');
    expect(css).toContain('color-scheme: dark;');
    expect(css).not.toContain('@media (prefers-color-scheme');
  });

  it('writes shape, text and font files from the theme', () => {
    const theme = resolveTheme('calm', ThemeFileSchema.parse({
      name: 'Calm', modes: ['dark'], dark: { fonts: { ui: 'Calm Sans' } },
      shape: { radius: 3, shadows: false }, text: { labelCase: 'upper', labelSpacing: 0.06 },
      fontFiles: [{ family: 'Calm Sans', file: 'fonts/calm.woff2', weight: 400 }],
    }), defaults);
    const css = themeCss(theme, url);
    expect(css).toContain('--radius: 3px;');
    expect(css).toContain('--shadow-raised: none;');
    expect(css).toContain('--shadow-float: none;');
    expect(css).toContain('--chip-case: uppercase;');
    expect(css).toContain('--label-spacing: 0.06em;');
    expect(css).toContain('@font-face { font-family: "Calm Sans"; src: url("/api/themes/calm/files/fonts/calm.woff2") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }');
  });

  it('writes the default float shadow when shadows are on', () => {
    const css = themeCss(resolveTheme('default', defaults, defaults), url);
    expect(css).toContain('--shadow-float: 0 8px 24px var(--shadow);');
  });
});

describe('applyThemeCss', () => {
  it('writes one style element and caches it for the next first paint', () => {
    applyThemeCss(':root { --bg: #000; }');
    applyThemeCss(':root { --bg: #111; }');
    const styles = document.querySelectorAll('style#theme');
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toBe(':root { --bg: #111; }');
    expect(localStorage.getItem(THEME_CSS_KEY)).toBe(':root { --bg: #111; }');
  });

  it('keeps the style element last in head so it wins over stylesheets added later', () => {
    applyThemeCss(':root { --bg: #000; }');
    document.head.appendChild(document.createElement('link'));
    applyThemeCss(':root { --bg: #222; }');
    expect(document.head.lastElementChild).toBe(document.getElementById('theme'));
  });
});
