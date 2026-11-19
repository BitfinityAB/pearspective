// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StackRow } from '../components/StackRow';
import { buildOverviewLanes } from '../../../shared/grouping';
import { emptySnapshot } from '../../../shared/types';
import { makePr } from '../../../test/factories';

function stackUnit() {
  const bottom = makePr({ number: 4988, headRefName: 'a', mergeState: 'conflicts', nativeStack: { number: 4964, size: 4, position: 3, baseRefName: 'main' } });
  const top = makePr({ number: 4989, headRefName: 'b', nativeStack: { number: 4964, size: 4, position: 4, baseRefName: 'main' } });
  const snapshot = { ...emptySnapshot('acme'), prs: [bottom, top], overviewIds: [bottom.id, top.id] };
  const unit = buildOverviewLanes(snapshot, { groupBy: 'author', filters: { show: { blocked: true, waiting: true, ready: true, draft: true }, q: '', newestFirst: false }, now: Date.now() })[0]!.units[0]!;
  if (unit.kind !== 'stack') throw new Error('expected a stack');
  return unit;
}

describe('StackRow', () => {
  it('summarises the stack with its range, kind, counts and one pip per PR', () => {
    render(<StackRow unit={stackUnit()} expanded={false} onToggle={() => undefined} onVisualize={() => undefined} />);
    expect(screen.getByText('Stack of 2 open PRs · 2 merged or closed')).toBeInTheDocument();
    expect(screen.getByText('orders-api · GitHub stack #4964 · #4988 → #4989')).toBeInTheDocument();
    expect(screen.getByText('1 blocked')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '1 blocked, 0 waiting, 1 ready' }).querySelectorAll('i')).toHaveLength(2);
  });

  it('toggles and opens the visualisation through separate buttons', async () => {
    const onToggle = vi.fn();
    const onVisualize = vi.fn();
    render(<StackRow unit={stackUnit()} expanded={false} onToggle={onToggle} onVisualize={onVisualize} />);
    await userEvent.click(screen.getByRole('button', { name: /Stack of 2 open PRs/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Visualize stack' }));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onVisualize).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /Stack of 2 open PRs/ })).toHaveAttribute('aria-expanded', 'false');
  });
});
