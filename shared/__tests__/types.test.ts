import { emptySnapshot, REFRESH_OPTIONS, MAX_REPOS } from '../types';

describe('shared types', () => {
  it('builds an empty snapshot with the 3 minute default refresh', () => {
    const snapshot = emptySnapshot('acme');
    expect(snapshot.settings).toEqual({ refresh: 3, repos: [], org: 'acme', host: 'github.com', ticketUrl: null, pinned: [] });
    expect(snapshot.prs).toEqual([]);
  });

  it('offers exactly the Grafana-style refresh options with 3 minutes as the minimum', () => {
    expect(REFRESH_OPTIONS).toEqual(['off', 3, 5, 10, 15, 30]);
    expect(MAX_REPOS).toBe(10);
  });
});
