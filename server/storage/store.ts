import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { ChangeRequest, Check, ClosedChangeRequest, Person, Review, ReviewRequest, StatusCategory, Thread, Ticket, Viewer } from '../../shared/types';
import { isTruncatedThreadsPlaceholder, truncatedThreadsPlaceholder } from '../../shared/threads';
import { openDatabase, type Db } from './db';
import * as s from './schema';

export interface Selection { org: string; repos: string[] }

export interface StoredState {
  fetchedAt: string;
  viewer: Viewer | null;
  prs: ChangeRequest[];
  overviewIds: string[];
  mine: { authored: string[]; requested: string[]; team: string[] };
  closed: ClosedChangeRequest[];
  tickets: Record<string, Ticket>;
  ticketsSyncedAt: string | null;
  statusCategories: Record<string, StatusCategory>;
  notTickets: string[];
}

export interface RefreshWrite {
  org: string;
  host: string;
  fetchedAt: string;
  viewer: Viewer;
  upserted: ChangeRequest[];
  removedIds: string[];
  overviewIds: string[];
  mine: { authored: string[]; requested: string[]; team: string[] };
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type PersonRow = typeof s.people.$inferSelect;
const VIEWS = ['overview', 'authored', 'requested', 'team'] as const;

const toPerson = (row: PersonRow): Person => ({
  login: row.login,
  ...(row.name ? { name: row.name } : {}),
  kind: row.kind as Person['kind'],
  ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}),
});

function peopleOf(pr: ChangeRequest): Person[] {
  return [
    pr.author,
    ...pr.reviews.map((review) => review.author),
    ...pr.threads.filter((thread) => !isTruncatedThreadsPlaceholder(thread)).map((thread) => thread.author),
    ...pr.reviewRequests.flatMap((request) => (request.type === 'person' ? [request.person] : [])),
    ...(pr.lastComment ? [pr.lastComment.author] : []),
  ];
}

function groupBy<T extends { changeRequestId: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(row.changeRequestId, [...(grouped.get(row.changeRequestId) ?? []), row]);
  return grouped;
}

export class Store {
  private constructor(private readonly db: Db, private readonly closeDb: () => void) {}

  static open(path: string): Store {
    const { db, close } = openDatabase(path);
    return new Store(db, close);
  }

  close(): void {
    this.closeDb();
  }

  load({ org, repos }: Selection): StoredState | null {
    const fetchedAt = this.meta(this.db, `fetched_at:${org}`);
    if (!fetchedAt) return null;
    const people = new Map(this.db.select().from(s.people).all().map((row) => [row.login, toPerson(row)]));
    const person = (login: string): Person => people.get(login) ?? { login, kind: 'human' };

    const viewRows = this.db.select({ id: s.views.changeRequestId, view: s.views.view, repo: s.changeRequests.repo })
      .from(s.views).innerJoin(s.changeRequests, eq(s.views.changeRequestId, s.changeRequests.id))
      .where(eq(s.changeRequests.org, org)).orderBy(asc(s.views.view), asc(s.views.position)).all();
    // Mine searches span every repository, so their PRs count as selected wherever they live.
    const inMine = new Set(viewRows.filter((row) => row.view !== 'overview').map((row) => row.id));
    const rows = this.db.select().from(s.changeRequests)
      .where(and(eq(s.changeRequests.org, org), eq(s.changeRequests.state, 'open'))).all()
      .filter((row) => repos.includes(row.repo) || inMine.has(row.id));
    const ids = rows.map((row) => row.id);
    const children = <T extends { changeRequestId: string; position: number }>(table: any): Map<string, T[]> =>
      groupBy((ids.length ? this.db.select().from(table).where(inArray(table.changeRequestId, ids)).orderBy(asc(table.position)).all() : []) as T[]);
    const checks = children<typeof s.checks.$inferSelect>(s.checks);
    const reviews = children<typeof s.reviews.$inferSelect>(s.reviews);
    const threads = children<typeof s.reviewThreads.$inferSelect>(s.reviewThreads);
    const requests = children<typeof s.reviewRequests.$inferSelect>(s.reviewRequests);

    const prs = rows.map((row): ChangeRequest => ({
      id: row.id,
      provider: row.provider,
      repo: row.repo,
      number: row.number,
      title: row.title,
      url: row.url,
      author: person(row.authorLogin),
      createdAt: row.createdAt ?? '',
      updatedAt: row.updatedAt ?? '',
      headSha: row.headSha ?? '',
      headRefName: row.headRef,
      baseRefName: row.baseRef,
      isDraft: row.isDraft === 1,
      mergeState: (row.mergeState ?? 'unknown') as ChangeRequest['mergeState'],
      reviewDecision: row.reviewDecision as ChangeRequest['reviewDecision'],
      checks: (checks.get(row.id) ?? []).map((check): Check => ({ name: check.name, state: check.state as Check['state'], required: check.required === 1, ...(check.url ? { url: check.url } : {}) })),
      reviews: (reviews.get(row.id) ?? []).map((review): Review => ({ author: person(review.authorLogin), state: review.state as Review['state'], submittedAt: review.submittedAt })),
      threads: [
        ...(threads.get(row.id) ?? []).map((thread): Thread => ({ resolved: thread.resolved === 1, author: person(thread.authorLogin), snippet: thread.snippet, url: thread.url })),
        ...(row.threadsTruncated ? [truncatedThreadsPlaceholder(row.url)] : []),
      ],
      reviewRequests: (requests.get(row.id) ?? []).map((request): ReviewRequest => (request.type === 'person'
        ? { type: 'person', person: person(request.login!) }
        : { type: 'team', slug: request.teamSlug!, ...(request.teamAvatarUrl ? { avatarUrl: request.teamAvatarUrl } : {}) })),
      commentCount: row.commentCount,
      ...(row.stackNumber !== null ? { nativeStack: { number: row.stackNumber, size: row.stackSize!, position: row.stackPosition!, baseRefName: row.stackBaseRef! } } : {}),
      ...(row.lastCommentUrl ? { lastComment: { author: person(row.lastCommentAuthorLogin!), snippet: row.lastCommentSnippet ?? '', url: row.lastCommentUrl } } : {}),
    }));

    const loaded = new Set(ids);
    const listed = (view: (typeof VIEWS)[number]) => viewRows.filter((row) => row.view === view && loaded.has(row.id)).map((row) => row.id);
    const viewerLogin = this.meta(this.db, 'viewer_login');
    const teams = this.db.select().from(s.viewerTeams).all().map((team) => ({ slug: team.slug, ...(team.avatarUrl ? { avatarUrl: team.avatarUrl } : {}) }));
    const viewerName = this.meta(this.db, 'viewer_name');
    const viewerAvatarUrl = this.meta(this.db, 'viewer_avatar_url');
    return {
      fetchedAt,
      viewer: viewerLogin ? { login: viewerLogin, ...(viewerName ? { name: viewerName } : {}), ...(viewerAvatarUrl ? { avatarUrl: viewerAvatarUrl } : {}), teams } : null,
      prs,
      overviewIds: listed('overview').filter((id) => repos.includes(prs.find((pr) => pr.id === id)!.repo)),
      mine: { authored: listed('authored'), requested: listed('requested'), team: listed('team') },
      closed: [],
      tickets: {},
      ticketsSyncedAt: null,
      statusCategories: {},
      notTickets: [],
    };
  }

  saveRefresh(write: RefreshWrite): void {
    this.db.transaction((tx) => {
      this.setMeta(tx, 'host', write.host);
      this.setMeta(tx, `fetched_at:${write.org}`, write.fetchedAt);
      this.setMeta(tx, 'viewer_login', write.viewer.login);
      // The viewer's own profile lives in meta: a PR that lists them without a name must not overwrite it.
      this.setMeta(tx, 'viewer_name', write.viewer.name ?? '');
      this.setMeta(tx, 'viewer_avatar_url', write.viewer.avatarUrl ?? '');
      this.upsertPeople(tx, write.upserted.flatMap(peopleOf));
      tx.delete(s.viewerTeams).run();
      if (write.viewer.teams.length) tx.insert(s.viewerTeams).values(write.viewer.teams.map((team) => ({ slug: team.slug, avatarUrl: team.avatarUrl ?? null }))).run();
      // A PR the ticket sync already stored as closed must survive its removal from the open lists.
      if (write.removedIds.length) tx.delete(s.changeRequests).where(and(inArray(s.changeRequests.id, write.removedIds), eq(s.changeRequests.state, 'open'))).run();
      for (const pr of write.upserted) this.upsertPr(tx, write.org, pr);
      this.replaceViews(tx, write);
    });
  }

  private upsertPr(tx: Tx, org: string, pr: ChangeRequest): void {
    const row = {
      id: pr.id, provider: pr.provider, org, repo: pr.repo, number: pr.number, title: pr.title, url: pr.url,
      authorLogin: pr.author.login, createdAt: pr.createdAt, updatedAt: pr.updatedAt, closedAt: null, state: 'open',
      headSha: pr.headSha, headRef: pr.headRefName, baseRef: pr.baseRefName, isDraft: pr.isDraft ? 1 : 0,
      mergeState: pr.mergeState, reviewDecision: pr.reviewDecision, commentCount: pr.commentCount,
      stackNumber: pr.nativeStack?.number ?? null, stackSize: pr.nativeStack?.size ?? null,
      stackPosition: pr.nativeStack?.position ?? null, stackBaseRef: pr.nativeStack?.baseRefName ?? null,
      lastCommentAuthorLogin: pr.lastComment?.author.login ?? null, lastCommentSnippet: pr.lastComment?.snippet ?? null,
      lastCommentUrl: pr.lastComment?.url ?? null,
      threadsTruncated: pr.threads.some(isTruncatedThreadsPlaceholder) ? 1 : 0,
    };
    tx.insert(s.changeRequests).values(row).onConflictDoUpdate({ target: s.changeRequests.id, set: row }).run();
    this.deleteChildren(tx, [pr.id]);
    const id = pr.id;
    if (pr.checks.length) tx.insert(s.checks).values(pr.checks.map((check, position) => ({ changeRequestId: id, position, name: check.name, state: check.state, required: check.required ? 1 : 0, url: check.url ?? null }))).run();
    if (pr.reviews.length) tx.insert(s.reviews).values(pr.reviews.map((review, position) => ({ changeRequestId: id, position, authorLogin: review.author.login, state: review.state, submittedAt: review.submittedAt }))).run();
    const threads = pr.threads.filter((thread) => !isTruncatedThreadsPlaceholder(thread));
    if (threads.length) tx.insert(s.reviewThreads).values(threads.map((thread, position) => ({ changeRequestId: id, position, resolved: thread.resolved ? 1 : 0, authorLogin: thread.author.login, snippet: thread.snippet, url: thread.url }))).run();
    if (pr.reviewRequests.length) tx.insert(s.reviewRequests).values(pr.reviewRequests.map((request, position) => (request.type === 'person'
      ? { changeRequestId: id, position, type: 'person', login: request.person.login, teamSlug: null, teamAvatarUrl: null }
      : { changeRequestId: id, position, type: 'team', login: null, teamSlug: request.slug, teamAvatarUrl: request.avatarUrl ?? null }))).run();
  }

  private deleteChildren(tx: Tx, ids: string[]): void {
    for (const table of [s.checks, s.reviews, s.reviewThreads, s.reviewRequests]) tx.delete(table).where(inArray(table.changeRequestId, ids)).run();
  }

  private replaceViews(tx: Tx, write: RefreshWrite): void {
    const orgIds = tx.select({ id: s.changeRequests.id }).from(s.changeRequests).where(eq(s.changeRequests.org, write.org));
    tx.delete(s.views).where(inArray(s.views.changeRequestId, orgIds)).run();
    const lists: Record<(typeof VIEWS)[number], string[]> = { overview: write.overviewIds, ...write.mine };
    const wanted = [...new Set(Object.values(lists).flat())];
    // Only rows that exist can be listed; foreign keys would otherwise fail the whole write.
    const existing = new Set(wanted.length ? tx.select({ id: s.changeRequests.id }).from(s.changeRequests).where(inArray(s.changeRequests.id, wanted)).all().map((row) => row.id) : []);
    const rows = VIEWS.flatMap((view) => lists[view].filter((id) => existing.has(id)).map((id, position) => ({ changeRequestId: id, view, position })));
    if (rows.length) tx.insert(s.views).values(rows).run();
  }

  private upsertPeople(tx: Tx, people: Person[]): void {
    const unique = [...new Map(people.map((person) => [person.login, person])).values()];
    if (!unique.length) return;
    tx.insert(s.people)
      .values(unique.map((person) => ({ login: person.login, name: person.name ?? null, kind: person.kind, avatarUrl: person.avatarUrl ?? null })))
      // A reference without a name or avatar must not erase what an earlier one stored.
      .onConflictDoUpdate({ target: s.people.login, set: { name: sql`coalesce(excluded.name, ${s.people.name})`, kind: sql`excluded.kind`, avatarUrl: sql`coalesce(excluded.avatar_url, ${s.people.avatarUrl})` } })
      .run();
  }

  private meta(db: Db | Tx, key: string): string | null {
    return db.select().from(s.meta).where(eq(s.meta.key, key)).get()?.value ?? null;
  }

  private setMeta(tx: Tx, key: string, value: string): void {
    tx.insert(s.meta).values({ key, value }).onConflictDoUpdate({ target: s.meta.key, set: { value } }).run();
  }
}
