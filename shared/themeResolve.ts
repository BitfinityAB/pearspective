import type { ThemeFile } from './themeSchema';
import { COLOR_TOKEN_NAMES, type ColorToken, type ThemeMode } from './themeTokens';

export interface ResolvedMode { colors: Record<ColorToken, string>; fonts: { ui: string; mono: string } }
export interface ResolvedTheme {
  id: string;
  name: string;
  modes: ThemeMode[];
  light?: ResolvedMode;
  dark?: ResolvedMode;
  shape: { radius: number; radiusSmall: number; borderWidth: number; shadows: boolean };
  text: { labelCase: 'upper' | 'none'; labelSpacing: number; baseSize: number; chipCase: 'upper' | 'none' };
  effects: { glow: boolean };
  fontFiles: NonNullable<ThemeFile['fontFiles']>;
}

const FALLBACK_SHAPE = { radius: 10, radiusSmall: 6, borderWidth: 1, shadows: true };
const FALLBACK_TEXT = { labelCase: 'upper' as const, labelSpacing: 0.04, baseSize: 14 };

/** Never inherited: Default's uppercase labels would otherwise turn every theme's chips uppercase. */
const chipCaseOf = (file: ThemeFile): 'upper' | 'none' => file.text?.chipCase ?? (file.text?.labelCase === 'upper' ? 'upper' : 'none');

/** A theme only lists what it changes; every other key comes from Default, so the page is always fully styled. */
export function resolveTheme(id: string, file: ThemeFile, defaults: ThemeFile): ResolvedTheme {
  const mode = (name: ThemeMode): ResolvedMode | undefined => {
    if (!file.modes.includes(name)) return undefined;
    // A single-mode Default would leave the other mode empty; borrow the mode it has.
    const baseName: ThemeMode = defaults[name] ? name : name === 'light' ? 'dark' : 'light';
    const base = defaults[baseName];
    const own = file[name] ?? {};
    const missing = (key: string): never => { throw new Error(`Default theme is incomplete: missing ${baseName}.${key}`); };
    const colors = Object.fromEntries(COLOR_TOKEN_NAMES.map((token) => [token, own.colors?.[token] ?? base?.colors?.[token] ?? missing(`colors.${token}`)])) as Record<ColorToken, string>;
    return {
      colors,
      fonts: {
        ui: own.fonts?.ui ?? base?.fonts?.ui ?? missing('fonts.ui'),
        mono: own.fonts?.mono ?? base?.fonts?.mono ?? missing('fonts.mono'),
      },
    };
  };
  return {
    id,
    name: file.name,
    modes: file.modes,
    light: mode('light'),
    dark: mode('dark'),
    shape: { ...FALLBACK_SHAPE, ...defaults.shape, ...file.shape },
    text: { ...FALLBACK_TEXT, ...defaults.text, ...file.text, chipCase: chipCaseOf(file) },
    // Effects are a theme's own choice, never inherited from Default.
    effects: { glow: file.effects?.glow ?? false },
    fontFiles: file.fontFiles ?? [],
  };
}
