import type { ResolvedMode, ResolvedTheme } from '../../../shared/themeResolve';
import { COLOR_TOKENS, COLOR_TOKEN_NAMES, type ThemeMode } from '../../../shared/themeTokens';

const UI_FALLBACK = 'system-ui, sans-serif';
const MONO_FALLBACK = 'ui-monospace, monospace';

const modeVars = (mode: ThemeMode, block: ResolvedMode) => [
  `color-scheme: ${mode};`,
  ...COLOR_TOKEN_NAMES.map((token) => `${COLOR_TOKENS[token]}: ${block.colors[token]};`),
  `--font-ui: "${block.fonts.ui}", ${UI_FALLBACK};`,
  `--font-mono: "${block.fonts.mono}", ${MONO_FALLBACK};`,
].join(' ');

/** Values come from the validated theme schema, which allows only colours, numbers and plain font names. */
export function themeCss(theme: ResolvedTheme, fontUrl: (file: string) => string): string {
  const { shape, text } = theme;
  const labelCase = text.labelCase === 'upper' ? 'uppercase' : 'none';
  // The built-in Default id is pinned, so Default keeps today's mixed-case chips even though its labels are uppercase.
  const chipCase = theme.id !== 'default' && text.labelCase === 'upper' ? 'uppercase' : 'none';
  const shared = [
    `--fs-base: ${text.baseSize}px;`,
    `--radius: ${shape.radius}px;`, `--radius-small: ${shape.radiusSmall}px;`, `--radius-dialog: ${Math.round(shape.radius * 1.4)}px;`,
    `--border-width: ${shape.borderWidth}px;`,
    `--shadow-raised: ${shape.shadows ? '0 1px 2px var(--shadow)' : 'none'};`,
    `--shadow-float: ${shape.shadows ? '0 8px 24px var(--shadow)' : 'none'};`,
    `--shadow-panel: ${shape.shadows ? '0 24px 64px var(--shadow)' : 'none'};`,
    `--label-case: ${labelCase};`, `--chip-case: ${chipCase};`,
    `--label-spacing: ${text.labelSpacing}em;`,
  ].join(' ');
  const fonts = theme.fontFiles.map((font) =>
    `@font-face { font-family: "${font.family}"; src: url("${fontUrl(font.file)}") format("woff2"); font-weight: ${font.weight ?? 400}; font-style: ${font.style ?? 'normal'}; font-display: swap; }`);

  const parts = [...fonts, `:root { ${shared} }`];
  if (theme.light && theme.dark) {
    parts.push(`:root { ${modeVars('light', theme.light)} }`);
    parts.push(`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${modeVars('dark', theme.dark)} } }`);
    parts.push(`:root[data-theme="dark"] { ${modeVars('dark', theme.dark)} }`);
  } else {
    // Every selector tokens.css uses, so the theme's single mode wins whatever the browser's mode setting is.
    const only = theme.dark ? 'dark' : 'light';
    parts.push(`:root, :root[data-theme="light"], :root[data-theme="dark"], :root:not([data-theme="light"]) { ${modeVars(only, theme[only]!)} }`);
  }
  return parts.join('\n');
}
