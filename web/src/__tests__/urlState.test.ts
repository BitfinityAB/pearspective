import { parseUrlState, serializeUrlState } from '../state/urlState';

describe('URL state', () => {
  it('defaults to Overview grouped by author, oldest first, drafts hidden', () => {
    expect(parseUrlState('')).toEqual({
      tab: 'overview', groupBy: 'author', selected: null,
      filters: { show: { blocked: true, waiting: true, ready: true, draft: false }, q: '', newestFirst: false },
    });
  });

  it('writes nothing for the defaults', () => {
    expect(serializeUrlState(parseUrlState(''))).toBe('');
  });

  it('round-trips every setting', () => {
    const state = {
      tab: 'mine' as const, groupBy: 'ticket' as const, selected: 'PR_4988',
      filters: { show: { blocked: true, waiting: false, ready: false, draft: true }, q: 'offline mode', newestFirst: true },
    };
    const search = serializeUrlState(state);
    expect(search).toBe('?tab=mine&group=ticket&show=blocked%2Cdraft&q=offline+mode&sort=newest&pr=PR_4988');
    expect(parseUrlState(search)).toEqual(state);
  });

  it('ignores unknown values', () => {
    expect(parseUrlState('?tab=nope&group=nope')).toMatchObject({ tab: 'overview', groupBy: 'author' });
  });
});
