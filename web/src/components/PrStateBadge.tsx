export type PrStateLabel = 'open' | 'draft' | 'merged' | 'closed';

/** Sits before the PR title so a long title can never truncate the state away. */
export function PrStateBadge({ state }: { state: PrStateLabel }) {
  return <span className={`pr-state s-${state}`}>{state}</span>;
}
