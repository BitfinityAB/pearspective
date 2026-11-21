import { parseUrlState, serializeUrlState } from '../state/urlState';

describe('URL state', () => {
  it('defaults to Overview grouped by author, oldest first, drafts hidden', () => {
    expect(parseUrlState('')).toEqual({
      tab: 'overview', groupBy: 'author', selected: null, ticketsMine: false,
      filters: { show: { blocked: true, waiting: true, ready: true, draft: false }, q: '', newestFirst: false },
    });
  });

  it('writes nothing for the defaults', () => {
    expect(serializeUrlState(parseUrlState(''))).toBe('');
  });

  it('round-trips every setting', () => {
    const state = {
      tab: 'mine' as const, groupBy: 'ticket' as const, selected: 'PR_4988', ticketsMine: true,
      filters: { show: { blocked: true, waiting: false, ready: false, draft: true }, q: 'offline mode', newestFirst: true },
    };
    const search = serializeUrlState(state);
    expect(search).toBe('?tab=mine&group=ticket&show=blocked%2Cdraft&q=offline+mode&sort=newest&pr=PR_4988&mine=1');
    expect(parseUrlState(search)).toEqual(state);
  });

  it('ignores unknown values', () => {
    expect(parseUrlState('?tab=nope&group=nope')).toMatchObject({ tab: 'overview', groupBy: 'author' });
  });

  it('reads and writes the tickets tab', () => {
    expect(parseUrlState('?tab=tickets').tab).toBe('tickets');
    expect(serializeUrlState({ ...parseUrlState(''), tab: 'tickets' })).toBe('?tab=tickets');
  });

  it('reads and writes the mine filter for tickets', () => {
    expect(parseUrlState('').ticketsMine).toBe(false);
    expect(parseUrlState('?tab=tickets&mine=1').ticketsMine).toBe(true);
    expect(serializeUrlState({ ...parseUrlState('?tab=tickets'), ticketsMine: true })).toBe('?tab=tickets&mine=1');
  });
});
