import { describeItem, notificationEvents } from '../notifications';
import { emptySnapshot, NOTIFICATION_DEFAULTS, type ChangeRequest, type NotificationKind, type Snapshot } from '../types';
import { makePerson, makePr } from '../../test/factories';

const at = '2026-11-21T12:00:00.000Z';
const allOn = Object.fromEntries(Object.keys(NOTIFICATION_DEFAULTS).map((kind) => [kind, true])) as Record<NotificationKind, boolean>;
const snap = (prs: ChangeRequest[], mine: Partial<Snapshot['mine']> = {}): Snapshot =>
  ({ ...emptySnapshot('acme'), prs, mine: { authored: prs.map((pr) => pr.id), requested: [], team: [], ...mine } });
const kinds = (before: ChangeRequest, after: ChangeRequest, enabled = allOn) =>
  notificationEvents({ previous: snap([before]), next: snap([after]), viewerLogin: 'alex', enabled, at })?.items[0]?.events.map((event) => event.kind) ?? [];

// Waiting for review, CI green, mergeable: a neutral starting point.
const base = makePr({ reviewDecision: 'review_required' });
const failing = [{ name: 'build', state: 'failure' as const, required: true }];
const pending = [{ name: 'build', state: 'pending' as const, required: true }];

describe('notificationEvents', () => {
  it('reports nothing for the first snapshot or a steady state', () => {
    expect(notificationEvents({ previous: null, next: snap([base]), viewerLogin: 'alex', enabled: allOn, at })).toBeNull();
    expect(notificationEvents({ previous: snap([base]), next: snap([base]), viewerLogin: 'alex', enabled: allOn, at })).toBeNull();
  });

  it.each<[string, Partial<ChangeRequest>, Partial<ChangeRequest>, NotificationKind[]]>([
    ['CI turns red', {}, { checks: failing }, ['ciFailed']],
    ['CI turns green after running', { checks: pending }, {}, ['ciPassed']],
    ['CI green after red', { checks: failing }, {}, ['ciPassed']],
    ['approval that also makes it ready', {}, { reviewDecision: 'approved' }, ['approved', 'readyToMerge']],
    ['changes requested', {}, { reviewDecision: 'changes_requested' }, ['changesRequested']],
    ['a new conflict', {}, { mergeState: 'conflicts' }, ['conflict']],
    ['merge state still being checked is no change', { mergeState: 'unknown' }, { mergeState: 'conflicts' }, []],
  ])('%s', (_label, before, after, expected) => {
    expect(kinds({ ...base, ...before }, { ...base, ...after })).toEqual(expected);
  });

  it('reports a new comment by someone else, but not by the viewer or a bot', () => {
    const comment = (login: string, kind: 'human' | 'bot' = 'human') => ({ ...base, commentCount: 2, lastComment: { author: { ...makePerson(login, kind), name: 'Robin Park' }, snippet: 'Can we split this?', url: 'https://example.test/c/2' } });
    const before = { ...base, commentCount: 1 };
    const batch = notificationEvents({ previous: snap([before]), next: snap([comment('robin')]), viewerLogin: 'alex', enabled: allOn, at });
    expect(batch?.items[0]?.events).toEqual([{ kind: 'newComment', detail: "new comment by Robin Park: 'Can we split this?'" }]);
    expect(kinds(before, comment('alex'))).toEqual([]);
    expect(kinds(before, comment('ci-bot', 'bot'))).toEqual([]);
  });

  it('reports new review threads, combining several by one author, and skips the viewer and the placeholder', () => {
    const thread = (login: string, url: string, snippet = 'Why twice?') => ({ resolved: false, author: makePerson(login), snippet, url });
    const after = { ...base, threads: [thread('sam', 'https://example.test/t/1'), thread('copilot', 'https://example.test/t/2'), thread('copilot', 'https://example.test/t/3'), thread('alex', 'https://example.test/t/4'), thread('more-threads-not-loaded', base.url)] };
    const batch = notificationEvents({ previous: snap([base]), next: snap([after]), viewerLogin: 'alex', enabled: allOn, at });
    expect(batch?.items[0]?.events).toEqual([
      { kind: 'newThread', detail: "new thread by sam: 'Why twice?'" },
      { kind: 'newThread', detail: 'copilot: 2 new threads' },
    ]);
  });

  it('ignores PRs that were not in the previous snapshot, except new review requests', () => {
    const fresh = { ...base, checks: failing };
    expect(notificationEvents({ previous: snap([]), next: snap([fresh]), viewerLogin: 'alex', enabled: allOn, at })).toBeNull();
    const requested = makePr();
    const batch = notificationEvents({ previous: snap([], { authored: [] }), next: snap([requested], { authored: [], requested: [requested.id] }), viewerLogin: 'alex', enabled: allOn, at });
    expect(batch?.items[0]?.events).toEqual([{ kind: 'reviewRequested' }]);
  });

  it('drops disabled kinds and groups the rest per PR into one batch', () => {
    const other = makePr({ reviewDecision: 'review_required' });
    const previous = snap([base, other]);
    const next = snap([{ ...base, checks: failing, mergeState: 'conflicts' }, { ...other, reviewDecision: 'changes_requested' }]);
    const batch = notificationEvents({ previous, next, viewerLogin: 'alex', enabled: { ...allOn, conflict: false }, at });
    expect(batch).toEqual({ id: at, at, items: [
      expect.objectContaining({ prId: base.id, events: [{ kind: 'ciFailed' }] }),
      expect.objectContaining({ prId: other.id, events: [{ kind: 'changesRequested' }] }),
    ] });
    expect(notificationEvents({ previous, next, viewerLogin: 'alex', enabled: { ...allOn, ciFailed: false, conflict: false, changesRequested: false }, at })).toBeNull();
  });

  it('describes an item as its events joined with a dot', () => {
    expect(describeItem({ prId: 'PR_1', repo: 'orders-api', number: 1, title: 'x', url: 'u', events: [{ kind: 'ciPassed' }, { kind: 'approved' }, { kind: 'newComment', detail: "new comment by Robin: 'ok'" }] }))
      .toBe("CI passed · approved · new comment by Robin: 'ok'");
  });
});
