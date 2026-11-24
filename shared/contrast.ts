import type { ResolvedTheme } from './themeResolve';
import type { ColorToken, ThemeMode } from './themeTokens';

type Rgba = [number, number, number, number];

function parse(color: string): Rgba {
  const hex = color.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex;
    const [r, g, b, a = 255] = full.match(/../g)!.map((pair) => parseInt(pair, 16));
    return [r!, g!, b!, a / 255];
  }
  const tokens = color.match(/[-\d.]+%?/g) ?? [];
  const numbers = tokens.map((part) => (part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part)));
  if (color.startsWith('hsl')) {
    const [rawHue = 0, s = 0, l = 0, a = 1] = numbers;
    const h = ((rawHue % 360) + 360) % 360;
    const k = (n: number) => (n + h / 30) % 12;
    const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0) * 255, f(8) * 255, f(4) * 255, a];
  }
  const [r = 0, g = 0, b = 0, a = 1] = numbers.map((value, index) => (index < 3 && tokens[index]!.endsWith('%') ? value * 255 : value));
  return [r, g, b, a];
}

const over = ([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];
const luminance = ([r, g, b]: Rgba) => {
  const channel = (value: number) => { const s = value / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** WCAG 2 contrast; translucent colours are composited over the backdrop first, as the browser would paint them. */
export function contrastRatio(foreground: string, background: string, backdrop = '#ffffff'): number {
  const base = parse(backdrop);
  const bg = over(parse(background), base);
  const fg = over(parse(foreground), bg);
  const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (light! + 0.05) / (dark! + 0.05);
}

export interface ContrastIssue { mode: ThemeMode; pair: string; ratio: number }

// Text that people read, on the surfaces it appears on; badge text on its own badge background.
const PAIRS: [ColorToken, ColorToken][] = [
  ['text', 'bg'], ['text', 'surface'], ['text2', 'bg'], ['text2', 'surface'], ['muted', 'bg'], ['muted', 'surface'], ['accent', 'surface'],
  ['greenText', 'greenBg'], ['amberText', 'amberBg'], ['redText', 'redBg'], ['neutralText', 'neutralBg'], ['blueText', 'blueBg'],
];

export function contrastIssues(theme: ResolvedTheme, minimum = 4.5): ContrastIssue[] {
  return (['light', 'dark'] as const).flatMap((mode) => {
    const colors = theme[mode]?.colors;
    if (!colors) return [];
    return PAIRS.map(([fg, bg]) => ({ mode, pair: `${fg} on ${bg}`, ratio: contrastRatio(colors[fg], colors[bg], colors.surface) }))
      .filter((issue) => issue.ratio < minimum)
      .map((issue) => ({ ...issue, ratio: Math.round(issue.ratio * 100) / 100 }));
  });
}
