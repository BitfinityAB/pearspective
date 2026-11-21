import { useCallback, useState } from 'react';
import { DEFAULT_FILTERS, type GroupBy, type ViewFilters } from '../../../shared/grouping';
import type { Bucket } from '../../../shared/status';

export type Tab = 'overview' | 'mine' | 'stacks' | 'tickets';
/** ticketsMine limits the Tickets tab to tickets the viewer created or is or was assignee on. */
export interface UrlState { tab: Tab; groupBy: GroupBy; filters: ViewFilters; selected: string | null; ticketsMine: boolean }

const TABS: Tab[] = ['overview', 'mine', 'stacks', 'tickets'];
const GROUPS: GroupBy[] = ['author', 'repo', 'ticket'];
const BUCKETS: Bucket[] = ['blocked', 'waiting', 'ready', 'draft'];

export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const showParam = params.get('show');
  const show = showParam === null
    ? { ...DEFAULT_FILTERS.show }
    : (Object.fromEntries(BUCKETS.map((bucket) => [bucket, showParam.split(',').includes(bucket)])) as Record<Bucket, boolean>);
  return {
    tab: TABS.find((tab) => tab === params.get('tab')) ?? 'overview',
    groupBy: GROUPS.find((group) => group === params.get('group')) ?? 'author',
    filters: { show, q: params.get('q') ?? '', newestFirst: params.get('sort') === 'newest' },
    selected: params.get('pr'),
    ticketsMine: params.get('mine') === '1',
  };
}

export function serializeUrlState(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.tab !== 'overview') params.set('tab', state.tab);
  if (state.groupBy !== 'author') params.set('group', state.groupBy);
  const shown = BUCKETS.filter((bucket) => state.filters.show[bucket]).join(',');
  if (shown !== BUCKETS.filter((bucket) => DEFAULT_FILTERS.show[bucket]).join(',')) params.set('show', shown);
  if (state.filters.q) params.set('q', state.filters.q);
  if (state.filters.newestFirst) params.set('sort', 'newest');
  if (state.selected) params.set('pr', state.selected);
  if (state.ticketsMine) params.set('mine', '1');
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function useUrlState(): [UrlState, (patch: Partial<UrlState>) => void] {
  const [state, setState] = useState(() => parseUrlState(window.location.search));
  const update = useCallback((patch: Partial<UrlState>) => {
    setState((current) => {
      const next = { ...current, ...patch };
      window.history.replaceState(null, '', `${window.location.pathname}${serializeUrlState(next)}`);
      return next;
    });
  }, []);
  return [state, update];
}
