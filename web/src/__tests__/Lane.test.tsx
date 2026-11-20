// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Lane } from '../components/Lane';
import type { LaneModel } from '../../../shared/grouping';
import { buildPrViews } from '../../../shared/grouping';
import { emptySnapshot } from '../../../shared/types';
import { makePr } from '../../../test/factories';

function laneOf(defaultCollapsed: boolean): LaneModel {
  const pr = makePr({ title: 'Add scheduler lock' });
  const view = buildPrViews({ ...emptySnapshot('acme'), prs: [pr] }, Date.now()).get(pr.id)!;
  return { key: 'author:alex', title: 'Alex Rivera', icon: 'avatar', counts: { blocked: 0, waiting: 0, ready: 1, draft: 0 }, units: [{ kind: 'pr', view, pinned: false }], defaultCollapsed };
}

describe('Lane', () => {
  it('shows the header summary and rows when expanded', () => {
    render(<Lane lane={laneOf(false)} selectedId={null} onSelect={() => undefined} onVisualize={() => undefined} />);
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.getByText('1 open')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '0 blocked · 0 waiting · 1 ready' })).toBeInTheDocument();
    expect(screen.getByText('Add scheduler lock')).toBeInTheDocument();
  });

  it('starts collapsed when the model says so and expands on click', async () => {
    render(<Lane lane={laneOf(true)} selectedId={null} onSelect={() => undefined} onVisualize={() => undefined} />);
    expect(screen.queryByText('Add scheduler lock')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Expand Alex Rivera' }));
    expect(screen.getByText('Add scheduler lock')).toBeInTheDocument();
  });

  it('explains an empty lane', () => {
    render(<Lane lane={{ ...laneOf(false), units: [] }} selectedId={null} onSelect={() => undefined} onVisualize={() => undefined} />);
    expect(screen.getByText('No pull requests match the filters.')).toBeInTheDocument();
  });

  it('shows the ticket status pill and an expected badge on a mismatching ticket lane', () => {
    const lane = { ...laneOf(false), icon: 'ticket' as const, title: 'XX-1 · Add lock', ticket: { key: 'XX-1', summary: 'Add lock', statusName: 'In Review', verdict: 'mismatch' as const, reason: 'PR merged 3h ago; ticket is In Review (expected Done).', expected: 'Done' } };
    render(<Lane lane={lane} selectedId={null} onSelect={vi.fn()} onVisualize={vi.fn()} />);
    expect(screen.getByText('In Review')).toHaveClass('ticket-chip', 'v-mismatch');
    expect(screen.getByText('expected Done')).toBeInTheDocument();
  });
});
