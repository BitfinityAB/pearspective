// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TicketsView } from '../views/TicketsView';
import { emptySnapshot, type TicketCheck } from '../../../shared/types';
import { makeClosed, makePr } from '../../../test/factories';
import { makeTicket } from '../../../test/fake-tracker';

const check = (key: string, verdict: TicketCheck['verdict']): TicketCheck =>
  ({ key, prState: 'merged', verdict, reason: `PR merged 3h ago; ticket is In Review (expected Done).`, expected: 'Done', since: '2026-11-20T09:00:00Z' });

function setup(mineOnly = false) {
  const open = makePr({ headRefName: 'XX-1-work', title: 'Add the lock' });
  const snapshot = {
    ...emptySnapshot('acme'),
    fetchedAt: '2026-11-20T12:00:00Z',
    prs: [open],
    closed: [makeClosed({ headRefName: 'XX-1-part', title: 'Prepare the lock', url: 'https://github.com/acme/orders-api/pull/5001' })],
    tickets: { 'XX-1': makeTicket('XX-1', 'In Review', 'inProgress', { summary: 'Scheduler lock' }) },
    ticketChecks: { 'XX-1': check('XX-1', 'mismatch'), 'XX-9': check('XX-9', 'ok') },
  };
  const onSelect = vi.fn();
  render(<TicketsView snapshot={snapshot} selectedId={null} onSelect={onSelect} mineOnly={mineOnly} />);
  return { onSelect, open };
}

describe('TicketsView', () => {
  it('says so when none of the tickets are the viewer\'s', () => {
    setup(true);
    expect(screen.getByText('None of these tickets were created by you or assigned to you.')).toBeInTheDocument();
  });

  it('lists mismatching tickets with actual and expected status and the reason', () => {
    setup();
    const lane = within(screen.getByRole('region', { name: 'Mismatches' }));
    expect(lane.getByRole('link', { name: 'Scheduler lock' })).toHaveAttribute('href', 'https://tracker.example.test/browse/XX-1');
    expect(lane.getByText('In Review')).toHaveClass('ticket-chip', 'v-mismatch');
    expect(lane.getByText('expected Done')).toBeInTheDocument();
    expect(lane.getByText('PR merged 3h ago; ticket is In Review (expected Done).')).toBeInTheDocument();
  });

  it('opens open PRs in the drawer and links closed PRs to GitHub', async () => {
    const { onSelect, open } = setup();
    const lane = within(screen.getByRole('region', { name: 'Mismatches' }));
    await userEvent.click(lane.getByRole('button', { name: /Add the lock/ }));
    expect(onSelect).toHaveBeenCalledWith(open.id);
    const closedLink = lane.getByRole('link', { name: /Prepare the lock/ });
    expect(closedLink).toHaveAttribute('href', 'https://github.com/acme/orders-api/pull/5001');
    // The state comes first so long titles cannot hide it, and ↗ marks links that leave the dashboard.
    expect(closedLink).toHaveTextContent(/^merged.*Prepare the lock ↗$/);
    expect(lane.getByRole('button', { name: /Add the lock/ })).toHaveTextContent(/^open.*Add the lock$/);
  });

  it('keeps calm lanes collapsed until expanded', async () => {
    setup();
    const okLane = screen.getByRole('region', { name: 'OK' });
    expect(within(okLane).queryByText('XX-9')).toBeNull();
    await userEvent.click(within(okLane).getByRole('button', { name: 'Expand OK' }));
    expect(within(okLane).getAllByText(/XX-9/).length).toBeGreaterThan(0);
  });
});
