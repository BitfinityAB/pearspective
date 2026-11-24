import { z } from 'zod';
import { COLOR_TOKEN_NAMES, type ColorToken, type ThemeMode } from './themeTokens';

// Values end up inside CSS, so only plain colour notations are allowed; anything else could inject rules.
const COLOR = /^(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(rgb|rgba|hsl|hsla)\(\s*[-0-9.%,\s/]+\))$/;
// Single spaces only: newlines and line separators would corrupt the generated CSS.
const FONT_NAME = /^[\w.-]+(?: [\w.-]+)*$/;
const color = z.string().regex(COLOR, 'must be a hex, rgb(a) or hsl(a) colour');
const fontName = z.string().max(60).regex(FONT_NAME, 'may contain letters, digits, single spaces, dots, dashes and underscores');

const colors = z.object(Object.fromEntries(COLOR_TOKEN_NAMES.map((name) => [name, color.optional()])) as Record<ColorToken, z.ZodOptional<typeof color>>).strict();
const modeBlock = z.object({ colors: colors.optional(), fonts: z.object({ ui: fontName.optional(), mono: fontName.optional() }).strict().optional() }).strict();

export const ThemeFileSchema = z.object({
  $schema: z.string().optional(),
  name: z.string().min(1).max(40),
  modes: z.array(z.enum(['light', 'dark'])).min(1).max(2),
  light: modeBlock.optional(),
  dark: modeBlock.optional(),
  shape: z.object({
    radius: z.number().min(0).max(24).optional(),
    radiusSmall: z.number().min(0).max(16).optional(),
    borderWidth: z.number().min(0).max(4).optional(),
    shadows: z.boolean().optional(),
  }).strict().optional(),
  text: z.object({
    labelCase: z.enum(['upper', 'none']).optional(),
    labelSpacing: z.number().min(0).max(0.3).optional(),
    baseSize: z.number().min(11).max(18).describe('Body text size in px; other sizes stay fixed.').optional(),
    chipCase: z.enum(['upper', 'none']).optional(),
  }).strict().optional(),
  fontFiles: z.array(z.object({
    family: fontName,
    // Inside the theme's own folder, never absolute or escaping it.
    file: z.string().regex(/^(?!\/)(?!.*\.\.)(?!.*\/\/)(?!(?:.*\/)?\.\/)[\w./-]+\.woff2$/, 'must be a .woff2 path inside the theme folder'),
    weight: z.number().int().min(100).max(900).optional(),
    style: z.enum(['normal', 'italic']).optional(),
  }).strict()).max(8).optional(),
}).strict().superRefine((file, ctx) => {
  if (new Set(file.modes).size !== file.modes.length) ctx.addIssue({ code: 'custom', path: ['modes'], message: 'modes must not repeat' });
  for (const mode of ['light', 'dark'] as const) {
    const listed = file.modes.includes(mode);
    if (listed && !file[mode]) ctx.addIssue({ code: 'custom', path: [mode], message: `"${mode}" is listed in modes but has no block` });
    if (!listed && file[mode]) ctx.addIssue({ code: 'custom', path: [mode], message: `"${mode}" has a block but is not listed in modes` });
  }
});

export type ThemeFile = z.infer<typeof ThemeFileSchema>;
export type { ThemeMode };
