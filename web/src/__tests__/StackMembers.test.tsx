// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { StackMembers } from '../components/StackMembers';
import { buildOverviewLanes } from '../../../shared/grouping';
import { emptySnapshot } from '../../../shared/types';
import { makePr } from '../../../test/factories';

describe('StackMembers', () => {
  it('renders members top-down, the base branch, and one link per member', () => {
    const bottom = makePr({ number: 3420, headRefName: 'lock' });
    const top = makePr({ number: 3421, baseRefName: 'lock' });
    const snapshot = { ...emptySnapshot('acme'), prs: [bottom, top], overviewIds: [bottom.id, top.id] };
    const unit = buildOverviewLanes(snapshot, { groupBy: 'author', filters: { show: { blocked: true, waiting: true, ready: true, draft: true }, q: '', newestFirst: false }, now: Date.now() })[0]!.units[0]!;
    if (unit.kind !== 'stack') throw new Error('expected a stack');

    const { container } = render(<StackMembers stack={unit.stack} membersTopDown={unit.membersTopDown} selectedId={top.id} onSelect={() => undefined} />);

    expect(screen.getAllByRole('button').map((row) => row.getAttribute('data-node'))).toEqual([top.id, bottom.id]);
    expect(screen.getByText('main')).toHaveClass('base-pill');
    expect(container.querySelectorAll('.stack-links path.link')).toHaveLength(2);
    expect(container.querySelectorAll('.stack-links path.link.hot')).toHaveLength(1);
  });
});
