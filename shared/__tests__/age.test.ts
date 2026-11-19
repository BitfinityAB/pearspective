import { ageHours, ageLabel, AGE_TICKS } from '../age';

describe('age', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');

  it('rounds age down to whole hours with a floor of one hour', () => {
    expect(ageHours('2026-11-18T11:45:00Z', now)).toBe(1);
    expect(ageHours('2026-11-17T12:00:00Z', now)).toBe(24);
  });

  it.each([
    [5, '5h'],
    [24, '1d'],
    [300, '13d'],
    [336, '2w'],
    [1300, '8w'],
  ])('labels %i hours as %s', (hours, label) => {
    expect(ageLabel(hours)).toBe(label);
  });

  it('ticks from one hour to three months', () => {
    expect(AGE_TICKS.map((tick) => tick.label)).toEqual(['1h', '6h', '1d', '3d', '1w', '2w', '1mo', '3mo']);
  });
});
