import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Store, type RefreshWrite } from '../store';
import { truncatedThreadsPlaceholder } from '../../../shared/threads';
import { makeClosed, makePerson, makePr } from '../../../test/factories';
import { makeTicket } from '../../../test/fake-tracker';
import type { ChangeRequest } from '../../../shared/types';

const viewer = { login: 'alex', name: 'Alex Rivera', avatarUrl: 'https://avatars.example.test/alex', teams: [{ slug: 'core', avatarUrl: 'https://avatars.example.test/core' }] };
const selection = { org: 'acme', repos: ['orders-api'] };

function refresh(overrides: Partial<RefreshWrite> = {}): RefreshWrite {
  const upserted = overrides.upserted ?? [];
  return {
    org: 'acme', host: 'example.test', fetchedAt: '2026-11-23T08:00:00.000Z', viewer,
    upserted, removedIds: [], overviewIds: upserted.map((pr) => pr.id), mine: { authored: [], requested: [], team: [] },
    ...overrides,
  };
}

function richPr(): ChangeRequest {
  const pr = makePr({
    isDraft: true,
    mergeState: 'blocked',
    reviewDecision: null,
    nativeStack: { number: 7, size: 3, position: 2, baseRefName: 'main' },
    checks: [
      { name: 'build', state: 'success', required: true, url: 'https://ci.example.test/1' },
      { name: 'lint', state: 'pending', required: false },
      { name: 'More checks not loaded', state: 'pending', required: false },
    ],
    reviews: [{ author: makePerson('copilot-pull-request-reviewer', 'ai-review'), state: 'commented', submittedAt: '2026-11-22T10:00:00Z' }],
    reviewRequests: [{ type: 'person', person: makePerson('kim') }, { type: 'team', slug: 'core', avatarUrl: 'https://avatars.example.test/core' }],
    commentCount: 4,
    lastComment: { author: { login: 'robin', name: 'Robin Park', kind: 'human' }, snippet: 'Looks good now', url: 'https://example.test/c/9' },
  });
  return { ...pr, threads: [{ resolved: false, author: makePerson('sam'), snippet: 'Rename this', url: 'https://example.test/t/1' }, truncatedThreadsPlaceholder(pr.url)] };
}

describe('Store', () => {
  it('returns null for an org it has never saved', () => {
    const store = Store.open(':memory:');
    expect(store.load(selection)).toBeNull();
    store.close();
  });

  it('round-trips every field of a PR, its views and the viewer', () => {
    const store = Store.open(':memory:');
    const pr = richPr();
    const plain = makePr();
    store.saveRefresh(refresh({ upserted: [pr, plain], overviewIds: [plain.id, pr.id], mine: { authored: [pr.id], requested: [plain.id], team: [] } }));
    const state = store.load(selection)!;
    expect(state.fetchedAt).toBe('2026-11-23T08:00:00.000Z');
    expect(state.viewer).toEqual(viewer);
    expect(state.prs.find((item) => item.id === pr.id)).toEqual(pr);
    expect(state.prs.find((item) => item.id === plain.id)).toEqual(plain);
    expect(state.overviewIds).toEqual([plain.id, pr.id]);
    expect(state.mine).toEqual({ authored: [pr.id], requested: [plain.id], team: [] });
    store.close();
  });

  it('replaces a PR\'s children when it is saved again', () => {
    const store = Store.open(':memory:');
    const pr = richPr();
    store.saveRefresh(refresh({ upserted: [pr] }));
    const updated = { ...pr, checks: [{ name: 'build', state: 'failure' as const, required: true }], threads: [], reviews: [], reviewRequests: [], lastComment: undefined };
    store.saveRefresh(refresh({ upserted: [updated] }));
    const { lastComment: _dropped, ...expected } = updated;
    expect(store.load(selection)!.prs[0]).toEqual(expected);
    store.close();
  });

  it('deletes removed PRs together with their children and views', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pearspective-store-')), 'state.db');
    const store = Store.open(path);
    const kept = makePr();
    const dropped = richPr();
    store.saveRefresh(refresh({ upserted: [kept, dropped] }));
    store.saveRefresh(refresh({ upserted: [], removedIds: [dropped.id], overviewIds: [kept.id] }));
    expect(store.load(selection)!.prs.map((pr) => pr.id)).toEqual([kept.id]);
    store.close();
    const raw = new Database(path, { readonly: true });
    for (const table of ['checks', 'reviews', 'review_threads', 'review_requests', 'views']) {
      expect(raw.prepare(`select count(*) as n from ${table} where change_request_id = ?`).get(dropped.id)).toEqual({ n: 0 });
    }
    raw.close();
  });

  it('loads only the selected repos of the current org, plus Mine PRs from other repos', () => {
    const store = Store.open(':memory:');
    const selected = makePr({ repo: 'orders-api' });
    const unselected = makePr({ repo: 'billing' });
    const mineElsewhere = makePr({ repo: 'billing' });
    store.saveRefresh(refresh({ upserted: [selected, unselected, mineElsewhere], overviewIds: [selected.id, unselected.id], mine: { authored: [mineElsewhere.id], requested: [], team: [] } }));
    const otherOrg = makePr({ repo: 'orders-api' });
    store.saveRefresh(refresh({ org: 'globex', upserted: [otherOrg], overviewIds: [otherOrg.id] }));
    const state = store.load(selection)!;
    expect(state.prs.map((pr) => pr.id).sort()).toEqual([selected.id, mineElsewhere.id].sort());
    expect(state.overviewIds).toEqual([selected.id]);
    expect(state.mine.authored).toEqual([mineElsewhere.id]);
    expect(store.load({ org: 'globex', repos: ['orders-api'] })!.prs.map((pr) => pr.id)).toEqual([otherOrg.id]);
    store.close();
  });

  it('keeps a person\'s name and avatar when a bare reference to them is saved in the same batch', () => {
    const store = Store.open(':memory:');
    const named = makePr({ reviews: [{ author: { login: 'robin', name: 'Robin Park', kind: 'human', avatarUrl: 'https://avatars.example.test/robin' }, state: 'approved', submittedAt: '2026-11-22T10:00:00Z' }] });
    const bare = makePr({ threads: [{ resolved: false, author: { login: 'robin', kind: 'human' }, snippet: 'Why?', url: 'https://example.test/t/2' }] });
    store.saveRefresh(refresh({ upserted: [named, bare] }));
    const state = store.load(selection)!;
    const expected = { login: 'robin', name: 'Robin Park', kind: 'human', avatarUrl: 'https://avatars.example.test/robin' };
    expect(state.prs.find((pr) => pr.id === named.id)!.reviews[0]!.author).toEqual(expected);
    expect(state.prs.find((pr) => pr.id === bare.id)!.threads[0]!.author).toEqual(expected);
    store.close();
  });

  it('saves a view list that repeats an id', () => {
    const store = Store.open(':memory:');
    const pr = makePr();
    store.saveRefresh(refresh({ upserted: [pr], overviewIds: [pr.id, pr.id], mine: { authored: [pr.id, pr.id], requested: [], team: [] } }));
    const state = store.load(selection)!;
    expect(state.overviewIds).toEqual([pr.id]);
    expect(state.mine.authored).toEqual([pr.id]);
    store.close();
  });
});

describe('Store tickets', () => {
  const saved = () => {
    const store = Store.open(':memory:');
    store.saveRefresh(refresh());
    return store;
  };

  it('round-trips tickets with their category, not-a-ticket keys, closed PRs and the sync time', () => {
    const store = saved();
    const assigned = makeTicket('XX-1', 'In Review', null, { mine: true, assignee: makePerson('kim') });
    const unassigned = makeTicket('XX-2', 'Done', null, { mine: null });
    const closed = [makeClosed({ repo: 'orders-api', merged: true }), makeClosed({ repo: 'orders-api', merged: false })];
    store.saveStatusCategories({ 'In Review': 'inProgress', Done: 'done' });
    store.saveTickets({ org: 'acme', provider: 'github', at: '2026-11-23T08:00:00.000Z', upserted: [assigned, unassigned], removedKeys: [], notTickets: ['XX-9'], closed, syncedAt: '2026-11-23T08:00:00.000Z' });
    const state = store.load(selection)!;
    expect(state.tickets).toEqual({
      'XX-1': { ...assigned, status: { name: 'In Review', category: 'inProgress' } },
      'XX-2': { ...unassigned, status: { name: 'Done', category: 'done' } },
    });
    expect(state.statusCategories).toEqual({ 'In Review': 'inProgress', Done: 'done' });
    expect(state.notTickets).toEqual(['XX-9']);
    expect(state.closed).toEqual(closed);
    expect(state.ticketsSyncedAt).toBe('2026-11-23T08:00:00.000Z');
    store.close();
  });

  it('deletes removed tickets and replaces closed PRs only when a closed list is given', () => {
    const store = saved();
    const first = makeClosed({ repo: 'orders-api' });
    store.saveTickets({ org: 'acme', provider: 'github', at: '2026-11-23T08:00:00.000Z', upserted: [makeTicket('XX-1', 'Done', 'done'), makeTicket('XX-2', 'Done', 'done')], removedKeys: [], notTickets: [], closed: [first] });
    store.saveTickets({ org: 'acme', provider: 'github', at: '2026-11-23T08:05:00.000Z', upserted: [], removedKeys: ['XX-2'], notTickets: [] });
    expect(Object.keys(store.load(selection)!.tickets)).toEqual(['XX-1']);
    expect(store.load(selection)!.closed).toEqual([first]);
    const second = makeClosed({ repo: 'orders-api' });
    store.saveTickets({ org: 'acme', provider: 'github', at: '2026-11-23T08:10:00.000Z', upserted: [], removedKeys: [], notTickets: [], closed: [second] });
    expect(store.load(selection)!.closed).toEqual([second]);
    store.close();
  });

  it('keeps a PR stored as closed when a later refresh removes it from the open lists', () => {
    const store = Store.open(':memory:');
    const pr = makePr();
    store.saveRefresh(refresh({ upserted: [pr] }));
    const closed = makeClosed({ id: pr.id, number: pr.number, repo: pr.repo });
    store.saveTickets({ org: 'acme', provider: 'github', at: '2026-11-23T08:05:00.000Z', upserted: [], removedKeys: [], notTickets: [], closed: [closed] });
    store.saveRefresh(refresh({ upserted: [], removedIds: [pr.id], overviewIds: [] }));
    const state = store.load(selection)!;
    expect(state.prs).toEqual([]);
    expect(state.closed).toEqual([closed]);
    store.close();
  });

  it('deletes open PRs of the org that are in no view, and leaves closed rows and other orgs alone', () => {
    const store = Store.open(':memory:');
    const kept = makePr();
    const ghost = makePr();
    const other = makePr();
    store.saveRefresh(refresh({ upserted: [kept, ghost] }));
    store.saveRefresh(refresh({ org: 'other-org', upserted: [other] }));
    const closed = makeClosed();
    store.saveTickets({ org: 'acme', provider: 'fake', upserted: [], removedKeys: [], notTickets: [], closed: [closed], at: '2026-11-23T08:00:00.000Z' });
    store.saveRefresh(refresh({ upserted: [], overviewIds: [kept.id] }));
    const state = store.load(selection)!;
    expect(state.prs.map((pr) => pr.id)).toEqual([kept.id]);
    expect(state.closed.map((pr) => pr.id)).toEqual([closed.id]);
    expect(store.load({ org: 'other-org', repos: ['orders-api'] })!.prs.map((pr) => pr.id)).toEqual([other.id]);
  });
});
