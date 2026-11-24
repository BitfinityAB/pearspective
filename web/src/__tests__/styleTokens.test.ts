import { readFileSync } from 'node:fs';

const css = readFileSync('web/src/styles/app.css', 'utf8');

describe('app.css uses theme tokens', () => {
  it('has no hard-coded font families', () => {
    expect(css.match(/font(-family)?:[^;}]*(Inter|system-ui|monospace)/g) ?? []).toEqual([]);
  });

  it('takes panel and control radii from tokens', () => {
    // 50% (circles), 999px (pills) and 0 (a full-screen drawer) are shapes, not theme choices.
    const hardRadii = [...css.matchAll(/border-radius:\s*([^;}]+)/g)].map((match) => match[1]!.trim()).filter((value) => !/var\(|50%|999px/.test(value) && value !== '0');
    expect(hardRadii).toEqual([]);
  });

  it('takes uppercase labels and letter spacing from tokens', () => {
    expect(css.match(/text-transform:\s*uppercase/g) ?? []).toEqual([]);
    expect(css.match(/letter-spacing:\s*\.0\d+em/g) ?? []).toEqual([]);
  });

  it('takes box shadows from tokens', () => {
    // The inset bar marks the selected row; it is not a theme choice.
    expect([...css.matchAll(/box-shadow:\s*([^;}]+)/g)].map((match) => match[1]!.trim()).filter((value) => !value.startsWith('var(') && !value.startsWith('inset ') && value !== 'none')).toEqual([]);
  });
});
