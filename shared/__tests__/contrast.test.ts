import { readFileSync } from 'node:fs';
import { contrastIssues, contrastRatio } from '../contrast';
import { ThemeFileSchema } from '../themeSchema';
import { resolveTheme } from '../themeResolve';

const load = (path: string) => ThemeFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
const defaults = load('themes/default.json');

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 2);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1);
  });

  it('composites translucent colours over the backdrop', () => {
    // 50% black over white is #808080.
    expect(contrastRatio('rgba(0,0,0,.5)', '#ffffff')).toBeCloseTo(contrastRatio('#808080', '#ffffff'), 1);
    expect(contrastRatio('#e3b341', 'rgba(187,128,9,.22)', '#161b22')).toBeGreaterThan(4.5);
  });
});

describe('contrastRatio colour parsing', () => {
  it('reads hsl and normalises negative hues', () => {
    expect(contrastRatio('hsl(0,0%,0%)', 'hsl(0,0%,100%)')).toBeCloseTo(21, 1);
    expect(contrastRatio('hsl(-120,100%,50%)', '#ffffff')).toBeCloseTo(contrastRatio('hsl(240,100%,50%)', '#ffffff'), 5);
  });

  it('reads percentage rgb channels', () => {
    expect(contrastRatio('rgb(100%,0%,0%)', '#ffffff')).toBeCloseTo(contrastRatio('#ff0000', '#ffffff'), 5);
  });
});

describe('contrastIssues', () => {
  it('reports a pair that falls below the minimum', () => {
    const file = ThemeFileSchema.parse({ name: 'Pale', modes: ['light'], light: { colors: { muted: '#cccccc' } } });
    const issues = contrastIssues(resolveTheme('pale', file, defaults));
    const issue = issues.find((candidate) => candidate.pair === 'muted on bg');
    expect(issue).toMatchObject({ mode: 'light', pair: 'muted on bg' });
    expect(issue!.ratio).toBeLessThan(4.5);
    expect(issue!.ratio).toBe(Math.round(issue!.ratio * 100) / 100);
  });
});

describe('built-in themes', () => {
  it('meet 4.5:1 for text, links and badges', () => {
    expect(contrastIssues(resolveTheme('default', defaults, defaults))).toEqual([]);
  });

  it('Terminal meets 4.5:1 too', () => {
    expect(contrastIssues(resolveTheme('terminal', load('themes/terminal/theme.json'), defaults))).toEqual([]);
  });
});
