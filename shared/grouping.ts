import { ageHours } from './age';
import { blockersOf, bucketOf, signalsOf, type Blocker, type Bucket, type Signal } from './status';
import { detectStacks, membersBottomUp, stackIndex, type Stack } from './stacks';
import { prTicketKey } from './tickets';
import type { ChangeRequest, Snapshot, Verdict } from './types';

export interface TicketBrief {
  key: string;
  summary?: string;
  statusName?: string;
  verdict: Verdict;
  reason: string;
  expected: string;
}

export function ticketBrief(key: string, snapshot: Snapshot): TicketBrief {
  const ticket = snapshot.tickets[key];
  const check = snapshot.ticketChecks[key];
  return {
    key,
    summary: ticket?.summary,
    statusName: ticket?.status.name,
    verdict: check?.verdict ?? 'unknown',
    reason: check?.reason ?? 'Ticket status is not available yet.',
    expected: check?.expected ?? '',
  };
}

export type GroupBy = 'author' | 'repo' | 'ticket';
export interface ViewFilters { show: Record<Bucket, boolean>; q: string; newestFirst: boolean }
export const DEFAULT_FILTERS: ViewFilters = { show: { blocked: true, waiting: true, ready: true, draft: false }, q: '', newestFirst: false };

export interface PrView {
  pr: ChangeRequest;
  signals: Signal[];
  blockers: Blocker[];
  bucket: Bucket;
  ageHours: number;
  ticket: string | null;
  ticketInfo: TicketBrief | null;
  stackedOn: number | null;
}
/** pinned units sort first in their lane; a stack is pinned when any member is. */
export type Unit =
  | { kind: 'pr'; view: PrView; pinned: boolean }
  | { kind: 'stack'; stack: Stack; lead: PrView; membersTopDown: PrView[]; pinned: boolean };
export interface LaneModel {
  key: string;
  title: string;
  icon: 'avatar' | 'bot' | 'repo' | 'ticket' | 'team' | 'section';
  avatarUrl?: string;
  ticket?: TicketBrief;
  counts: Record<Bucket, number>;
  units: Unit[];
  defaultCollapsed: boolean;
}

const BUCKET_ORDER: Record<Bucket, number> = { blocked: 0, waiting: 1, ready: 2, draft: 3 };
const emptyCounts = (): Record<Bucket, number> => ({ blocked: 0, waiting: 0, ready: 0, draft: 0 });

export function buildPrViews(snapshot: Snapshot, now: number): Map<string, PrView> {
  const stacks = stackIndex(detectStacks(snapshot.prs));
  const byId = new Map(snapshot.prs.map((pr) => [pr.id, pr]));
  const views = new Map<string, PrView>();
  for (const pr of snapshot.prs) {
    const key = prTicketKey(pr);
    const parentId = stacks.get(pr.id)?.parentId ?? null;
    views.set(pr.id, {
      pr,
      signals: signalsOf(pr),
      blockers: blockersOf(pr),
      bucket: bucketOf(pr),
      ageHours: ageHours(pr.createdAt, now),
      ticket: key,
      ticketInfo: key && snapshot.settings.ticketsEnabled ? ticketBrief(key, snapshot) : null,
      stackedOn: parentId ? byId.get(parentId)?.number ?? null : null,
    });
  }
  return views;
}

const matchesSearch = (view: PrView, q: string) =>
  !q || `${view.pr.title} ${view.pr.repo} #${view.pr.number} ${view.pr.headRefName}`.toLowerCase().includes(q.toLowerCase());

function buildUnits(views: PrView[], filters: ViewFilters, stacks: Stack[], pinned: ReadonlySet<string>): Unit[] {
  const inLane = new Map(views.map((view) => [view.pr.id, view]));
  const consumed = new Set<string>();
  const units: Unit[] = [];

  for (const stack of stacks) {
    const members = membersBottomUp(stack).map((id) => inLane.get(id)).filter((view): view is PrView => !!view);
    if (members.length < 2) continue;
    members.forEach((view) => consumed.add(view.pr.id));
    units.push({ kind: 'stack', stack, lead: members[0]!, membersTopDown: [...members].reverse(), pinned: members.some((view) => pinned.has(view.pr.id)) });
  }
  for (const view of views) if (!consumed.has(view.pr.id)) units.push({ kind: 'pr', view, pinned: pinned.has(view.pr.id) });

  // A stack stays visible while any member passes, so a draft base cannot hide a ready or blocked child.
  const visible = units.filter((unit) => {
    const members = unit.kind === 'pr' ? [unit.view] : unit.membersTopDown;
    return members.some((view) => filters.show[view.bucket]) && members.some((view) => matchesSearch(view, filters.q));
  });
  const leadOf = (unit: Unit) => (unit.kind === 'pr' ? unit.view : unit.lead);
  return visible.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const leadA = leadOf(a);
    const leadB = leadOf(b);
    const byBucket = BUCKET_ORDER[leadA.bucket] - BUCKET_ORDER[leadB.bucket];
    if (byBucket) return byBucket;
    return filters.newestFirst ? leadA.ageHours - leadB.ageHours : leadB.ageHours - leadA.ageHours;
  });
}

interface LaneInput { filters: ViewFilters; stacks: Stack[]; pinned: ReadonlySet<string> }

function lane(key: string, title: string, icon: LaneModel['icon'], views: PrView[], input: LaneInput, extra: Partial<LaneModel> = {}): LaneModel {
  const counts = emptyCounts();
  views.forEach((view) => (counts[view.bucket] += 1));
  return { key, title, icon, counts, units: buildUnits(views, input.filters, input.stacks, input.pinned), defaultCollapsed: false, ...extra };
}

function ticketGroup(view: PrView, snapshot: Snapshot) {
  if (!view.ticket) return { title: 'No ticket', icon: 'ticket' as const, last: true, views: [] as PrView[] };
  const brief = view.ticketInfo ?? undefined;
  return { title: brief?.summary ? `${view.ticket} · ${brief.summary}` : view.ticket, icon: 'ticket' as const, last: false, views: [] as PrView[], ticket: brief };
}

export function buildOverviewLanes(snapshot: Snapshot, opts: { groupBy: GroupBy; filters: ViewFilters; now: number }): LaneModel[] {
  const views = buildPrViews(snapshot, opts.now);
  const input: LaneInput = { filters: opts.filters, stacks: detectStacks(snapshot.prs), pinned: new Set(snapshot.settings.pinned) };
  const overview = snapshot.overviewIds.map((id) => views.get(id)).filter((view): view is PrView => !!view);

  const groups = new Map<string, { title: string; icon: LaneModel['icon']; avatarUrl?: string; ticket?: TicketBrief; last: boolean; views: PrView[] }>();
  for (const view of overview) {
    const isBot = view.pr.author.kind !== 'human';
    const key =
      opts.groupBy === 'repo' ? `repo:${view.pr.repo}`
      : opts.groupBy === 'ticket' ? `ticket:${view.ticket ?? ''}`
      : isBot ? 'bots' : `author:${view.pr.author.login}`;
    if (!groups.has(key)) {
      groups.set(key,
        opts.groupBy === 'repo' ? { title: view.pr.repo, icon: 'repo', last: false, views: [] }
        : opts.groupBy === 'ticket' ? ticketGroup(view, snapshot)
        : isBot ? { title: 'Bots', icon: 'bot', last: true, views: [] }
        : { title: view.pr.author.name ?? view.pr.author.login, icon: 'avatar', avatarUrl: view.pr.author.avatarUrl, last: false, views: [] });
    }
    groups.get(key)!.views.push(view);
  }

  return [...groups]
    .map(([key, group]) => ({
      group,
      model: lane(key, group.title, group.icon, group.views, input, {
        avatarUrl: group.avatarUrl,
        ticket: group.ticket,
        defaultCollapsed: key === 'bots',
      }),
    }))
    .sort((a, b) => Number(a.group.last) - Number(b.group.last) || b.model.counts.blocked - a.model.counts.blocked || a.model.title.localeCompare(b.model.title))
    .map((entry) => entry.model);
}

export function buildMineLanes(snapshot: Snapshot, opts: { filters: ViewFilters; now: number }): LaneModel[] {
  const views = buildPrViews(snapshot, opts.now);
  const input: LaneInput = { filters: opts.filters, stacks: detectStacks(snapshot.prs), pinned: new Set(snapshot.settings.pinned) };
  const pick = (ids: string[]) => ids.map((id) => views.get(id)).filter((view): view is PrView => !!view);
  const requested = new Set(snapshot.mine.requested);
  const teams = snapshot.viewer?.teams ?? [];
  const teamTitle = teams.length ? teams.map((team) => team.slug).join(', ') : 'my team';

  return [
    lane('mine:authored', 'My PRs', 'avatar', pick(snapshot.mine.authored), input, { avatarUrl: snapshot.viewer?.avatarUrl }),
    lane('mine:requested', 'Review requested from me', 'section', pick(snapshot.mine.requested), input),
    lane('mine:team', `Review requested from ${teamTitle}`, 'team', pick(snapshot.mine.team.filter((id) => !requested.has(id))), input, {
      avatarUrl: teams[0]?.avatarUrl,
      defaultCollapsed: true,
    }),
  ];
}

export function relatedByTicket(snapshot: Snapshot, prId: string, now: number): PrView[] {
  const views = buildPrViews(snapshot, now);
  const ticket = views.get(prId)?.ticket;
  if (!ticket) return [];
  return [...views.values()].filter((view) => view.ticket === ticket && view.pr.id !== prId);
}
