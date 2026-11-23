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

export interface TicketsWrite {
  org: string;
  provider: string;
  at: string;
  upserted: Ticket[];
  removedKeys: string[];
  notTickets: string[];
  /** Replaces the org's recently closed PRs when present. */
  closed?: ClosedChangeRequest[];
  /** Set only after a full sync, so a restart knows when the next full one is due. */
  syncedAt?: string;
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
    const statusCategories = this.loadStatusCategories();
    const tickets = Object.fromEntries(this.db.select().from(s.tickets).all().map((row): [string, Ticket] => [row.key, {
      key: row.key,
      summary: row.summary,
      type: row.type,
      status: { name: row.statusName, category: statusCategories[row.statusName] ?? null },
      mine: row.mine === null ? null : row.mine === 1,
      ...(row.assigneeLogin ? { assignee: person(row.assigneeLogin) } : {}),
      url: row.url,
    }]));
    const closed = this.db.select().from(s.changeRequests)
      .where(and(eq(s.changeRequests.org, org), ne(s.changeRequests.state, 'open'))).orderBy(asc(s.changeRequests.id)).all()
      .filter((row) => repos.includes(row.repo))
      .map((row): ClosedChangeRequest => ({
        id: row.id, repo: row.repo, number: row.number, title: row.title, url: row.url,
        headRefName: row.headRef, baseRefName: row.baseRef, merged: row.state === 'merged',
        closedAt: row.closedAt ?? '', author: person(row.authorLogin),
      }));
    return {
      fetchedAt,
      viewer: viewerLogin ? { login: viewerLogin, ...(viewerName ? { name: viewerName } : {}), ...(viewerAvatarUrl ? { avatarUrl: viewerAvatarUrl } : {}), teams } : null,
      prs,
      overviewIds: listed('overview').filter((id) => repos.includes(prs.find((pr) => pr.id === id)!.repo)),
      mine: { authored: listed('authored'), requested: listed('requested'), team: listed('team') },
      closed,
      tickets,
      ticketsSyncedAt: this.meta(this.db, `tickets_synced_at:${org}`),
      statusCategories,
      notTickets: this.db.select().from(s.notTickets).all().map((row) => row.key),
    };
  }

  loadStatusCategories(): Record<string, StatusCategory> {
    return Object.fromEntries(this.db.select().from(s.statusCategories).all().map((row) => [row.statusName, row.category as StatusCategory]));
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
      // After a complete refresh the open PRs are exactly the union of the views, which also drops
      // PRs left over from partial refreshes and from repos that are no longer selected.
      const inViews = new Set([...write.overviewIds, ...write.mine.authored, ...write.mine.requested, ...write.mine.team]);
      const stale = tx.select({ id: s.changeRequests.id }).from(s.changeRequests)
        .where(and(eq(s.changeRequests.org, write.org), eq(s.changeRequests.state, 'open'))).all()
        .map((row) => row.id).filter((id) => !inViews.has(id));
      if (stale.length) tx.delete(s.changeRequests).where(inArray(s.changeRequests.id, stale)).run();
      this.replaceViews(tx, write);
    });
  }

  saveTickets(write: TicketsWrite): void {
    this.db.transaction((tx) => {
      // A tracker username can equal a code-host login; the code host's person row must win.
      this.upsertPeople(tx, write.upserted.flatMap((ticket) => (ticket.assignee ? [ticket.assignee] : [])), true);
      this.upsertPeople(tx, (write.closed ?? []).map((pr) => pr.author));
      for (const ticket of write.upserted) {
        const row = {
          key: ticket.key, summary: ticket.summary, type: ticket.type, statusName: ticket.status.name,
          assigneeLogin: ticket.assignee?.login ?? null,
          mine: ticket.mine === undefined || ticket.mine === null ? null : ticket.mine ? 1 : 0,
          url: ticket.url, fetchedAt: write.at,
        };
        tx.insert(s.tickets).values(row).onConflictDoUpdate({ target: s.tickets.key, set: row }).run();
      }
      if (write.removedKeys.length) tx.delete(s.tickets).where(inArray(s.tickets.key, write.removedKeys)).run();
      if (write.notTickets.length) tx.insert(s.notTickets).values(write.notTickets.map((key) => ({ key }))).onConflictDoNothing().run();
      if (write.closed) this.replaceClosed(tx, write.org, write.provider, write.closed);
      if (write.syncedAt) this.setMeta(tx, `tickets_synced_at:${write.org}`, write.syncedAt);
    });
  }

  saveStatusCategories(categories: Record<string, StatusCategory>): void {
    const rows = Object.entries(categories).map(([statusName, category]) => ({ statusName, category }));
    if (!rows.length) return;
    this.db.insert(s.statusCategories).values(rows)
      .onConflictDoUpdate({ target: s.statusCategories.statusName, set: { category: sql`excluded.category` } }).run();
  }

  private replaceClosed(tx: Tx, org: string, provider: string, closed: ClosedChangeRequest[]): void {
    tx.delete(s.changeRequests).where(and(eq(s.changeRequests.org, org), ne(s.changeRequests.state, 'open'))).run();
    for (const pr of closed) {
      const row = {
        id: pr.id, provider, org, repo: pr.repo, number: pr.number, title: pr.title, url: pr.url,
        authorLogin: pr.author.login, createdAt: null, updatedAt: null, closedAt: pr.closedAt,
        state: pr.merged ? 'merged' : 'closed', headSha: null, headRef: pr.headRefName, baseRef: pr.baseRefName,
        isDraft: 0, mergeState: null, reviewDecision: null, commentCount: 0,
        stackNumber: null, stackSize: null, stackPosition: null, stackBaseRef: null,
        lastCommentAuthorLogin: null, lastCommentSnippet: null, lastCommentUrl: null, threadsTruncated: 0,
      };
      // The same id may still be stored as open until the next refresh drops it.
      tx.insert(s.changeRequests).values(row).onConflictDoUpdate({ target: s.changeRequests.id, set: row }).run();
    }
    const ids = closed.map((pr) => pr.id);
    if (ids.length) {
      this.deleteChildren(tx, ids);
      tx.delete(s.views).where(inArray(s.views.changeRequestId, ids)).run();
    }
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
    const rows = VIEWS.flatMap((view) => [...new Set(lists[view])].filter((id) => existing.has(id)).map((id, position) => ({ changeRequestId: id, view, position })));
    if (rows.length) tx.insert(s.views).values(rows).run();
  }

  private upsertPeople(tx: Tx, people: Person[], keepExisting = false): void {
    // Merge per field so a bare reference cannot drop a name or avatar given elsewhere in the batch.
    const merged = new Map<string, Person>();
    for (const person of people) {
      const earlier = merged.get(person.login);
      merged.set(person.login, { ...person, name: person.name ?? earlier?.name, avatarUrl: person.avatarUrl ?? earlier?.avatarUrl });
    }
    const unique = [...merged.values()];
    if (!unique.length) return;
    const insert = tx.insert(s.people)
      .values(unique.map((person) => ({ login: person.login, name: person.name ?? null, kind: person.kind, avatarUrl: person.avatarUrl ?? null })));
    if (keepExisting) {
      insert.onConflictDoNothing().run();
      return;
    }
    insert
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
