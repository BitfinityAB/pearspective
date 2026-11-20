import { buildMineLanes, buildOverviewLanes, buildPrViews, DEFAULT_FILTERS, relatedByTicket } from '../grouping';
import { emptySnapshot, type ChangeRequest, type Snapshot } from '../types';
import { makePerson, makePr } from '../../test/factories';
import { makeTicket } from '../../test/fake-tracker';

const now = Date.parse('2026-11-18T12:00:00Z');
const allBuckets = { ...DEFAULT_FILTERS, show: { blocked: true, waiting: true, ready: true, draft: true } };

function snapshotOf(prs: ChangeRequest[], extra: Partial<Snapshot> = {}): Snapshot {
  return { ...emptySnapshot('acme'), prs, overviewIds: prs.map((pr) => pr.id), ...extra };
}

describe('buildOverviewLanes', () => {
  const alex = makePerson('alex');
  const sam = makePerson('sam');
  const dependabot = makePerson('dependabot', 'bot');

  it('groups by author, puts bots in one collapsed lane last, and orders lanes by blocked count', () => {
    const snapshot = snapshotOf([
      makePr({ author: alex }),
      makePr({ author: sam, mergeState: 'conflicts' }),
      makePr({ author: sam, mergeState: 'conflicts' }),
      makePr({ author: dependabot, mergeState: 'conflicts' }),
      makePr({ author: dependabot, mergeState: 'conflicts' }),
      makePr({ author: dependabot, mergeState: 'conflicts' }),
    ]);

    const lanes = buildOverviewLanes(snapshot, { groupBy: 'author', filters: allBuckets, now });

    expect(lanes.map((lane) => [lane.title, lane.icon, lane.defaultCollapsed])).toEqual([
      ['sam', 'avatar', false],
      ['alex', 'avatar', false],
      ['Bots', 'bot', true],
    ]);
    expect(lanes[0]!.counts).toEqual({ blocked: 2, waiting: 0, ready: 0, draft: 0 });
    expect(lanes[0]!.avatarUrl).toBe(sam.avatarUrl);
  });

  it('groups by repository and by ticket with a "No ticket" lane last', () => {
    const snapshot = snapshotOf([
      makePr({ repo: 'orders-api', headRefName: 'XX-1-backend' }),
      makePr({ repo: 'orders-web', headRefName: 'XX-1-frontend' }),
      makePr({ repo: 'orders-web', headRefName: 'no-key' }),
    ]);
    expect(buildOverviewLanes(snapshot, { groupBy: 'repo', filters: allBuckets, now }).map((lane) => lane.title).sort())
      .toEqual(['orders-api', 'orders-web']);
    const byTicket = buildOverviewLanes(snapshot, { groupBy: 'ticket', filters: allBuckets, now });
    expect(byTicket.map((lane) => [lane.title, lane.units.length])).toEqual([['XX-1', 2], ['No ticket', 1]]);
  });

  it('sorts rows blocked, waiting, ready, then oldest first, and flips age order on request', () => {
    const ready = makePr({ createdAt: '2026-11-01T00:00:00Z' });
    const waitingOld = makePr({ reviewDecision: 'review_required', createdAt: '2026-10-01T00:00:00Z' });
    const waitingNew = makePr({ reviewDecision: 'review_required', createdAt: '2026-11-10T00:00:00Z' });
    const blocked = makePr({ mergeState: 'conflicts', createdAt: '2026-11-17T00:00:00Z' });
    const snapshot = snapshotOf([ready, waitingNew, blocked, waitingOld]);

    const ids = (newestFirst: boolean) => buildOverviewLanes(snapshot, { groupBy: 'author', filters: { ...allBuckets, newestFirst }, now })[0]!
      .units.map((unit) => (unit.kind === 'pr' ? unit.view.pr.id : unit.stack.id));

    expect(ids(false)).toEqual([blocked.id, waitingOld.id, waitingNew.id, ready.id]);
    expect(ids(true)).toEqual([blocked.id, waitingNew.id, waitingOld.id, ready.id]);
  });

  it('puts pinned rows and stacks first regardless of bucket and age order', () => {
    const blocked = makePr({ mergeState: 'conflicts' });
    const readyOld = makePr({ createdAt: '2026-10-01T00:00:00Z' });
    const readyNew = makePr({ createdAt: '2026-11-15T00:00:00Z' });
    const base = makePr({ headRefName: 'feature-base', createdAt: '2026-11-16T00:00:00Z' });
    const child = makePr({ headRefName: 'feature-child', baseRefName: 'feature-base', createdAt: '2026-11-17T00:00:00Z' });
    const snapshot = snapshotOf([blocked, readyOld, readyNew, base, child], {
      settings: { ...emptySnapshot('acme').settings, pinned: [readyNew.id, child.id] },
    });

    const ids = (newestFirst: boolean) => buildOverviewLanes(snapshot, { groupBy: 'author', filters: { ...allBuckets, newestFirst }, now })[0]!
      .units.map((unit) => (unit.kind === 'pr' ? unit.view.pr.id : unit.lead.pr.id));

    expect(ids(false).slice(0, 2).sort()).toEqual([readyNew.id, base.id].sort());
    expect(ids(false).slice(2)).toEqual([blocked.id, readyOld.id]);
    expect(ids(true).slice(2)).toEqual([blocked.id, readyOld.id]);
  });

  it('hides drafts by default but keeps them in the lane counts, and filters by search text', () => {
    const draft = makePr({ isDraft: true, title: 'Raise memory limits' });
    const visible = makePr({ title: 'Add scheduler lock' });
    const snapshot = snapshotOf([draft, visible]);

    const [lane] = buildOverviewLanes(snapshot, { groupBy: 'author', filters: DEFAULT_FILTERS, now });
    expect(lane!.units).toHaveLength(1);
    expect(lane!.counts.draft).toBe(1);

    const [searched] = buildOverviewLanes(snapshot, { groupBy: 'author', filters: { ...allBuckets, q: 'memory' }, now });
    expect(searched!.units.map((unit) => unit.kind === 'pr' && unit.view.pr.id)).toEqual([draft.id]);
  });

  it('collapses a stack into one unit placed by its lowest PR, with members top-down and "stacked on" set', () => {
    const lock = makePr({ number: 3420, headRefName: 'scheduler-lock', mergeState: 'conflicts' });
    const settings = makePr({ number: 3421, headRefName: 'lock-settings', baseRefName: 'scheduler-lock' });
    const snapshot = snapshotOf([settings, lock]);

    const [lane] = buildOverviewLanes(snapshot, { groupBy: 'author', filters: allBuckets, now });

    expect(lane!.units).toHaveLength(1);
    const unit = lane!.units[0]!;
    if (unit.kind !== 'stack') throw new Error('expected a stack unit');
    expect(unit.lead.pr.number).toBe(3420);
    expect(unit.membersTopDown.map((view) => view.pr.number)).toEqual([3421, 3420]);
    expect(unit.membersTopDown[0]!.stackedOn).toBe(3420);
    expect(unit.membersTopDown[1]!.stackedOn).toBeNull();
  });

  it('keeps a stack visible when its base is hidden but a member passes the filter', () => {
    const draftBase = makePr({ number: 3500, headRefName: 'base-lock', isDraft: true });
    const blockedChild = makePr({ number: 3501, headRefName: 'child-lock', baseRefName: 'base-lock', mergeState: 'conflicts' });
    const snapshot = snapshotOf([draftBase, blockedChild]);

    const [lane] = buildOverviewLanes(snapshot, { groupBy: 'author', filters: DEFAULT_FILTERS, now });

    expect(lane!.units).toHaveLength(1);
    expect(lane!.units[0]!.kind).toBe('stack');
  });

  it('hides a stack when every member is filtered out', () => {
    const draftBase = makePr({ number: 3510, headRefName: 'base-draft', isDraft: true });
    const draftChild = makePr({ number: 3511, headRefName: 'child-draft', baseRefName: 'base-draft', isDraft: true });
    const snapshot = snapshotOf([draftBase, draftChild]);

    const [lane] = buildOverviewLanes(snapshot, { groupBy: 'author', filters: DEFAULT_FILTERS, now });

    expect(lane!.units).toHaveLength(0);
    expect(lane!.counts.draft).toBe(2);
  });

  it('only shows PRs from the selected repositories', () => {
    const shown = makePr();
    const mineOnly = makePr();
    const snapshot = snapshotOf([shown, mineOnly], { overviewIds: [shown.id] });
    const [lane] = buildOverviewLanes(snapshot, { groupBy: 'author', filters: allBuckets, now });
    expect(lane!.units).toHaveLength(1);
  });
});

describe('buildMineLanes', () => {
  it('returns my PRs, requests to me, and team requests without duplicates, with the team lane collapsed', () => {
    const mine = makePr();
    const requested = makePr();
    const teamOnly = makePr();
    const snapshot = snapshotOf([mine, requested, teamOnly], {
      viewer: { login: 'alex', avatarUrl: 'https://avatars.example.test/alex', teams: [{ slug: 'platform-team', avatarUrl: 'team.png' }] },
      mine: { authored: [mine.id], requested: [requested.id], team: [requested.id, teamOnly.id] },
    });

    const lanes = buildMineLanes(snapshot, { filters: allBuckets, now });

    expect(lanes.map((lane) => [lane.title, lane.icon, lane.units.length, lane.defaultCollapsed])).toEqual([
      ['My PRs', 'avatar', 1, false],
      ['Review requested from me', 'section', 1, false],
      ['Review requested from platform-team', 'team', 1, true],
    ]);
    expect(lanes[0]!.avatarUrl).toBe('https://avatars.example.test/alex');
    expect(lanes[2]!.avatarUrl).toBe('team.png');
  });
});

describe('relatedByTicket', () => {
  it('finds other open PRs with the same key in any repository', () => {
    const backend = makePr({ repo: 'orders-api', headRefName: 'XX-7-api' });
    const frontend = makePr({ repo: 'orders-web', headRefName: 'XX-7-ui' });
    const unrelated = makePr({ headRefName: 'XX-8-other' });
    const related = relatedByTicket(snapshotOf([backend, frontend, unrelated]), backend.id, now);
    expect(related.map((view) => view.pr.id)).toEqual([frontend.id]);
  });
});

describe('ticket info', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const pr = makePr({ headRefName: 'XX-1-work' });
  const withTickets = {
    ...emptySnapshot('acme'),
    prs: [pr],
    overviewIds: [pr.id],
    tickets: { 'XX-1': makeTicket('XX-1', 'To Do', 'todo') },
    ticketChecks: { 'XX-1': { key: 'XX-1', prState: 'open' as const, verdict: 'mismatch' as const, reason: 'PR opened 2d ago; ticket is To Do (expected In Progress).', expected: 'In Progress', since: pr.createdAt } },
  };

  it('is attached to PR views only when tickets are enabled', () => {
    expect(buildPrViews(withTickets, now).get(pr.id)!.ticketInfo).toBeNull();
    const enabled = { ...withTickets, settings: { ...withTickets.settings, ticketsEnabled: true } };
    expect(buildPrViews(enabled, now).get(pr.id)!.ticketInfo).toEqual({
      key: 'XX-1', summary: 'Summary of XX-1', statusName: 'To Do', verdict: 'mismatch',
      reason: 'PR opened 2d ago; ticket is To Do (expected In Progress).', expected: 'In Progress',
    });
  });

  it('titles ticket lanes with the summary and carries the brief', () => {
    const enabled = { ...withTickets, settings: { ...withTickets.settings, ticketsEnabled: true } };
    const [lane] = buildOverviewLanes(enabled, { groupBy: 'ticket', filters: DEFAULT_FILTERS, now });
    expect(lane!.title).toBe('XX-1 · Summary of XX-1');
    expect(lane!.ticket?.statusName).toBe('To Do');
  });
});
