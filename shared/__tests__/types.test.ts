import { emptySnapshot, REFRESH_OPTIONS, MAX_REPOS } from '../types';

describe('shared types', () => {
  it('builds an empty snapshot with the 3 minute default refresh', () => {
    const snapshot = emptySnapshot('acme');
    expect(snapshot.settings).toEqual({
      refresh: 3, repos: [], org: 'acme', host: 'github.com', ticketUrl: null, pinned: [], ticketsEnabled: false, theme: 'default', reviewers: { aiReview: null, codeAnalysis: null },
      notifications: {
        enabled: false,
        events: { ciFailed: true, ciPassed: true, approved: true, changesRequested: true, readyToMerge: true, conflict: true, newComment: true, newThread: true, reviewRequested: false },
      },
    });
    expect(snapshot.themes).toEqual({ version: 0 });
    expect(snapshot.notification).toBeNull();
    expect(snapshot.tickets).toEqual({});
    expect(snapshot.closed).toEqual([]);
    expect(snapshot.ticketChecks).toEqual({});
    expect(snapshot.prs).toEqual([]);
  });

  it('offers exactly the Grafana-style refresh options with 3 minutes as the minimum', () => {
    expect(REFRESH_OPTIONS).toEqual(['off', 3, 5, 10, 15, 30]);
    expect(MAX_REPOS).toBe(10);
  });
});
