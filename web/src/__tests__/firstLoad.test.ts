import { isFirstLoad } from '../lib/firstLoad';
import { emptySnapshot } from '../../../shared/types';

describe('isFirstLoad', () => {
  it('stays true when only the database banner is showing', () => {
    expect(isFirstLoad({ ...emptySnapshot(), banners: [{ kind: 'database', message: 'Local database unavailable: x.' }] })).toBe(true);
  });

  it('is false once data exists or another problem is shown', () => {
    expect(isFirstLoad({ ...emptySnapshot(), fetchedAt: '2026-11-23T08:00:00Z' })).toBe(false);
    expect(isFirstLoad({ ...emptySnapshot(), banners: [{ kind: 'auth', message: 'Not logged in' }] })).toBe(false);
  });
});
