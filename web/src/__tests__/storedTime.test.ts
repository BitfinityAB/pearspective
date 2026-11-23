import { storedTime } from '../lib/storedTime';

const now = Date.parse('2026-11-23T12:00:00Z');
const options = { locale: 'en-GB', timeZone: 'UTC' };

describe('storedTime', () => {
  it('shows only the time for today', () => {
    expect(storedTime('2026-11-23T08:05:00Z', now, options)).toBe('08:05');
  });

  it('adds the weekday within the last week', () => {
    expect(storedTime('2026-11-20T17:42:00Z', now, options)).toBe('Fri 17:42');
  });

  it('adds the date for anything older', () => {
    expect(storedTime('2026-11-10T09:00:00Z', now, options)).toBe('10 Nov 09:00');
  });
});
