// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { useUrlState } from '../state/urlState';

describe('useUrlState', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('adds a history entry for a new view or PR, so Back returns to the previous one', async () => {
    const { result } = renderHook(() => useUrlState());
    const start = window.history.length;
    act(() => result.current[1]({ tab: 'mine' }));
    act(() => result.current[1]({ selected: 'PR_1001' }));
    expect(window.history.length).toBe(start + 2);
    expect(window.location.search).toBe('?tab=mine&pr=PR_1001');

    act(() => window.history.back());
    await waitFor(() => expect(result.current[0].selected).toBeNull());
    expect(result.current[0].tab).toBe('mine');

    act(() => window.history.back());
    await waitFor(() => expect(result.current[0].tab).toBe('overview'));

    act(() => window.history.forward());
    await waitFor(() => expect(result.current[0].tab).toBe('mine'));
  });

  it('replaces the entry for filters and search, so typing does not fill the history', () => {
    const { result } = renderHook(() => useUrlState());
    const start = window.history.length;
    act(() => result.current[1]({ filters: { ...result.current[0].filters, q: 'offline' } }));
    act(() => result.current[1]({ groupBy: 'repo' }));
    act(() => result.current[1]({ ticketsMine: true }));
    expect(window.history.length).toBe(start);
    expect(result.current[0]).toMatchObject({ groupBy: 'repo', ticketsMine: true, filters: expect.objectContaining({ q: 'offline' }) });
  });

  it('adds no entry when nothing changes', () => {
    const { result } = renderHook(() => useUrlState());
    const start = window.history.length;
    act(() => result.current[1]({ tab: 'overview', selected: null }));
    expect(window.history.length).toBe(start);
  });

  it('keeps both changes when two updates happen in the same tick', () => {
    const { result } = renderHook(() => useUrlState());
    act(() => {
      result.current[1]({ tab: 'tickets' });
      result.current[1]({ ticket: 'XX-1' });
    });
    expect(result.current[0]).toMatchObject({ tab: 'tickets', ticket: 'XX-1' });
    expect(window.location.search).toBe('?tab=tickets&ticket=XX-1');
  });
});
