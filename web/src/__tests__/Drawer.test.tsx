// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Drawer } from '../components/Drawer';
import { buildPrViews } from '../../../shared/grouping';
import { emptySnapshot, type ChangeRequest } from '../../../shared/types';
import { makeClosed, makePerson, makePr } from '../../../test/factories';
import { makeTicket } from '../../../test/fake-tracker';

const copilot = makePerson('copilot-pull-request-reviewer', 'ai-review');

function setup(prs: ChangeRequest[], selectedId: string, ticketUrl: string | null = 'https://jira.example.test/browse/{key}', pinned: string[] = []) {
  const snapshot = { ...emptySnapshot('acme'), prs, settings: { ...emptySnapshot('acme').settings, ticketUrl, pinned } };
  const views = buildPrViews(snapshot, Date.parse('2026-11-18T12:00:00Z'));
  const onSelect = vi.fn();
  const onVisualize = vi.fn();
  const onTogglePin = vi.fn();
  const onClose = vi.fn();
  const result = render(<Drawer snapshot={snapshot} views={views} selectedId={selectedId} onSelect={onSelect} onVisualize={onVisualize} onTogglePin={onTogglePin} onClose={onClose} />);
  return { onSelect, onVisualize, onTogglePin, onClose, snapshot, views, ...result };
}

describe('Drawer', () => {
  it('asks the user to pick a PR when nothing is selected', () => {
    setup([makePr()], 'nothing');
    expect(screen.getByText('Select a pull request to see its details.')).toBeInTheDocument();
  });

  it('shows failing checks with links, reviewers including bots, and unresolved threads', () => {
    const pr = makePr({
      title: 'Use offline mode',
      checks: [{ name: 'e2e-android', state: 'failure', required: true, url: 'https://ci.example.test/run/2' }],
      reviews: [{ author: copilot, state: 'commented', submittedAt: '2026-11-16T10:00:00Z' }],
      reviewRequests: [{ type: 'team', slug: 'core' }],
      threads: [{ resolved: false, author: makePerson('robin'), snippet: 'Can this run twice?', url: 'https://github.example.test/t/2' }],
    });
    setup([pr], pr.id);

    expect(screen.getByRole('heading', { name: 'Use offline mode' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'e2e-android' })).toHaveAttribute('href', 'https://ci.example.test/run/2');
    const reviewers = within(screen.getByRole('region', { name: 'Reviewers' }));
    expect(reviewers.getByText('copilot-pull-request-reviewer')).toBeInTheDocument();
    expect(reviewers.getByText('Commented')).toBeInTheDocument();
    expect(reviewers.getByText('core')).toBeInTheDocument();
    expect(reviewers.getByText('Requested')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Can this run twice\?/ })).toHaveAttribute('href', 'https://github.example.test/t/2');
  });

  it('shows people by display name, falling back to the login', () => {
    const robin = { ...makePerson('robin'), name: 'Robin Park' };
    const pr = makePr({
      reviews: [],
      reviewRequests: [{ type: 'person', person: { ...makePerson('sam'), name: 'Sam Chen' } }, { type: 'person', person: makePerson('kim') }],
      threads: [{ resolved: false, author: robin, snippet: 'Can this run twice?', url: 'https://github.example.test/t/2' }],
    });
    setup([pr], pr.id);

    const reviewers = within(screen.getByRole('region', { name: 'Reviewers' }));
    expect(reviewers.getByText('Sam Chen')).toBeInTheDocument();
    expect(reviewers.getByText('kim')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Robin Park: Can this run twice\?/ })).toBeInTheDocument();
  });

  it('shows only the newest review from each reviewer', () => {
    const robin = makePerson('robin');
    const pr = makePr({
      reviews: [
        { author: robin, state: 'approved', submittedAt: '2026-11-17T10:00:00Z' },
        { author: robin, state: 'changes_requested', submittedAt: '2026-11-16T10:00:00Z' },
      ],
    });
    setup([pr], pr.id);
    const reviewers = within(screen.getByRole('region', { name: 'Reviewers' }));
    expect(reviewers.getAllByText('robin')).toHaveLength(1);
    expect(reviewers.getByText('Approved')).toBeInTheDocument();
    expect(reviewers.queryByText('Changes requested')).toBeNull();
  });

  it('marks a requested person who has not reviewed yet as Requested', () => {
    const pr = makePr({ reviews: [], reviewRequests: [{ type: 'person', person: makePerson('sam') }] });
    setup([pr], pr.id);
    const reviewers = within(screen.getByRole('region', { name: 'Reviewers' }));
    expect(reviewers.getByText('sam')).toBeInTheDocument();
    expect(reviewers.getByText('Requested')).toBeInTheDocument();
  });

  it('lists a re-requested person who already reviewed only once, with their review', () => {
    const sam = makePerson('sam');
    const pr = makePr({
      reviews: [{ author: sam, state: 'commented', submittedAt: '2026-11-17T10:00:00Z' }],
      reviewRequests: [{ type: 'person', person: sam }],
    });
    setup([pr], pr.id);
    const reviewers = within(screen.getByRole('region', { name: 'Reviewers' }));
    expect(reviewers.getAllByText('sam')).toHaveLength(1);
    expect(reviewers.getByText('Commented')).toBeInTheDocument();
    expect(reviewers.queryByText('Requested')).toBeNull();
  });

  it('offers Pin for an unpinned PR and Unpin for a pinned one', async () => {
    const pr = makePr();
    const { onTogglePin } = setup([pr], pr.id);
    await userEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(onTogglePin).toHaveBeenCalledWith(pr.id);
  });

  it('marks a pinned PR as pressed with an Unpin label', () => {
    const pr = makePr();
    setup([pr], pr.id, null, [pr.id]);
    expect(screen.getByRole('button', { name: 'Unpin' })).toHaveAttribute('aria-pressed', 'true');
  });

  describe('on a narrow screen', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query }));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('moves focus to the close button and closes on Escape', async () => {
      const pr = makePr();
      const { onClose } = setup([pr], pr.id);
      expect(screen.getByRole('button', { name: 'Close details' })).toHaveFocus();
      expect(document.documentElement).toHaveClass('drawer-open');
      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('returns focus to the row it was opened from when closed', () => {
      const pr = makePr();
      const row = document.createElement('button');
      document.body.append(row);
      row.focus();
      const { rerender, snapshot, views, onClose } = setup([pr], pr.id);
      rerender(<Drawer snapshot={snapshot} views={views} selectedId={null} onSelect={vi.fn()} onVisualize={vi.fn()} onTogglePin={vi.fn()} onClose={onClose} />);
      expect(row).toHaveFocus();
      expect(document.documentElement).not.toHaveClass('drawer-open');
      row.remove();
    });
  });

  it('closes from the close button and ignores Escape on a wide screen', async () => {
    const pr = makePr();
    const { onClose } = setup([pr], pr.id);
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('URL-encodes the ticket key in the issue tracker link', () => {
    const pr = makePr({ headRefName: 'XX-7-api' });
    const snapshot = { ...emptySnapshot('acme'), prs: [pr], settings: { ...emptySnapshot('acme').settings, ticketUrl: 'https://jira.example.test/browse/{key}' } };
    const views = buildPrViews(snapshot, Date.parse('2026-11-18T12:00:00Z'));
    views.set(pr.id, { ...views.get(pr.id)!, ticket: 'PB 7/x?y' });
    render(<Drawer snapshot={snapshot} views={views} selectedId={pr.id} onSelect={vi.fn()} onVisualize={vi.fn()} onTogglePin={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'PB 7/x?y in Jira ↗' })).toHaveAttribute('href', 'https://jira.example.test/browse/PB%207%2Fx%3Fy');
  });

  it('links the ticket, lists related PRs in other repos, and selects one on click', async () => {
    const backend = makePr({ repo: 'orders-api', headRefName: 'XX-7-api' });
    const frontend = makePr({ repo: 'orders-web', headRefName: 'XX-7-ui', title: 'Show the second day' });
    const { onSelect } = setup([backend, frontend], backend.id);

    expect(screen.getByRole('link', { name: 'XX-7 in Jira ↗' })).toHaveAttribute('href', 'https://jira.example.test/browse/XX-7');
    await userEvent.click(screen.getByRole('button', { name: /Show the second day/ }));
    expect(onSelect).toHaveBeenCalledWith(frontend.id);
  });

  it('shows the key without a link when no issue tracker is configured', () => {
    const pr = makePr({ headRefName: 'XX-7-api' });
    setup([pr], pr.id, null);
    expect(screen.queryByRole('link', { name: /in Jira/ })).toBeNull();
    expect(screen.getByText('XX-7')).toBeInTheDocument();
  });

  it('lists the stack and opens the visualisation', async () => {
    const bottom = makePr({ number: 3420, headRefName: 'lock' });
    const top = makePr({ number: 3421, baseRefName: 'lock' });
    const { onVisualize } = setup([bottom, top], top.id);
    const stack = within(screen.getByRole('region', { name: 'Stack' }));
    expect(stack.getAllByRole('button').map((button) => button.textContent)).toEqual([
      expect.stringContaining('#3421'), expect.stringContaining('#3420'), 'Visualize stack',
    ]);
    await userEvent.click(stack.getByRole('button', { name: 'Visualize stack' }));
    expect(onVisualize).toHaveBeenCalledWith(top.id);
  });

  it('shows the ticket, its verdict and all of its PRs when tickets are enabled', () => {
    const pr = makePr({ headRefName: 'XX-1-work', title: 'Add the lock' });
    const sibling = makePr({ headRefName: 'XX-1-ui', title: 'Lock settings UI' });
    const base = emptySnapshot('acme');
    const snapshot = {
      ...base,
      prs: [pr, sibling],
      closed: [makeClosed({ headRefName: 'XX-1-prep', title: 'Prepare the lock', url: 'https://github.com/acme/orders-api/pull/5009' })],
      settings: { ...base.settings, ticketsEnabled: true },
      tickets: { 'XX-1': makeTicket('XX-1', 'To Do', 'todo', { summary: 'Scheduler lock', assignee: { login: 'alex', name: 'Alex Rivera', kind: 'human' } }) },
      ticketChecks: { 'XX-1': { key: 'XX-1', prState: 'open' as const, verdict: 'mismatch' as const, reason: 'PR opened 2d ago; ticket is To Do (expected In Progress).', expected: 'In Progress', since: pr.createdAt } },
    };
    const views = buildPrViews(snapshot, Date.parse('2026-11-20T12:00:00Z'));
    render(<Drawer snapshot={snapshot} views={views} selectedId={pr.id} onSelect={vi.fn()} onVisualize={vi.fn()} onTogglePin={vi.fn()} onClose={vi.fn()} />);
    const section = within(screen.getByRole('region', { name: 'Ticket · XX-1' }));
    expect(section.getByRole('link', { name: 'Scheduler lock ↗' })).toHaveAttribute('href', 'https://tracker.example.test/browse/XX-1');
    expect(section.getByText('Story · Alex Rivera')).toBeInTheDocument();
    expect(section.getByText('To Do')).toHaveClass('ticket-chip', 'v-mismatch');
    expect(section.getByText('PR opened 2d ago; ticket is To Do (expected In Progress).')).toBeInTheDocument();
    expect(section.getByRole('button', { name: /Lock settings UI/ })).toBeInTheDocument();
    expect(section.getByRole('link', { name: /Prepare the lock · merged/ })).toHaveAttribute('href', 'https://github.com/acme/orders-api/pull/5009');
    expect(screen.queryByRole('region', { name: /Related PRs/ })).toBeNull();
  });
});
