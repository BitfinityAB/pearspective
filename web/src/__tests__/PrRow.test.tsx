// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrRow } from '../components/PrRow';
import { buildPrViews } from '../../../shared/grouping';
import { emptySnapshot } from '../../../shared/types';
import { makePr } from '../../../test/factories';

const now = Date.parse('2026-11-18T12:00:00Z');
const viewOf = (...prs: ReturnType<typeof makePr>[]) => buildPrViews({ ...emptySnapshot('acme'), prs }, now);

describe('PrRow', () => {
  it('shows repo and number, title, blocker badges, six labelled squares and the age', () => {
    const pr = makePr({ number: 3412, title: 'Recalculate visit windows', mergeState: 'conflicts', createdAt: '2026-11-14T12:00:00Z' });
    render(<PrRow view={viewOf(pr).get(pr.id)!} selected={false} onSelect={() => undefined} />);

    expect(screen.getByText('orders-api #3412')).toBeInTheDocument();
    expect(screen.getByText('Recalculate visit windows')).toBeInTheDocument();
    expect(screen.getByText('Conflicts')).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(6);
    expect(screen.getByRole('img', { name: 'Mergeable: Merge conflicts' })).toHaveTextContent('✕');
    expect(screen.getByText('4d')).toBeInTheDocument();
  });

  it('shows "stacked on" as information, not a blocker', () => {
    const parent = makePr({ number: 3420, headRefName: 'lock' });
    const child = makePr({ number: 3421, baseRefName: 'lock' });
    render(<PrRow view={viewOf(parent, child).get(child.id)!} selected={false} indentPx={46} onSelect={() => undefined} />);
    expect(screen.getByText('stacked on #3420')).toHaveClass('sev-info');
  });

  it('selects on click and marks the selected row', async () => {
    const pr = makePr();
    const onSelect = vi.fn();
    render(<PrRow view={viewOf(pr).get(pr.id)!} selected onSelect={onSelect} />);
    const row = screen.getByRole('button');
    expect(row).toHaveAttribute('aria-current', 'true');
    await userEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(pr.id);
  });

  it('shows the ticket chip with its status and the reason as a tooltip', () => {
    const pr = makePr({ headRefName: 'XX-1-work' });
    const snapshot = {
      ...emptySnapshot('acme'),
      prs: [pr],
      settings: { ...emptySnapshot('acme').settings, ticketsEnabled: true },
      tickets: { 'XX-1': { key: 'XX-1', summary: 'Add lock', type: 'Story', status: { name: 'To Do', category: 'todo' as const }, url: 'https://tracker.example.test/browse/XX-1' } },
      ticketChecks: { 'XX-1': { key: 'XX-1', prState: 'open' as const, verdict: 'mismatch' as const, reason: 'PR opened 2d ago; ticket is To Do (expected In Progress).', expected: 'In Progress', since: pr.createdAt } },
    };
    const view = buildPrViews(snapshot, Date.parse('2026-11-20T12:00:00Z')).get(pr.id)!;
    render(<PrRow view={view} selected={false} onSelect={vi.fn()} />);
    const chip = screen.getByText('XX-1 · To Do');
    expect(chip).toHaveClass('ticket-chip', 'v-mismatch');
    expect(chip).toHaveAttribute('title', 'PR opened 2d ago; ticket is To Do (expected In Progress).');
  });
});
