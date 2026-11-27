import { prTicketKey } from './tickets';
import type { ChangeRequest, ClosedChangeRequest, Snapshot, Ticket, TicketCheck, Verdict } from './types';

export interface TicketRowModel {
  key: string;
  ticket?: Ticket;
  check: TicketCheck;
  open: ChangeRequest[];
  closed: ClosedChangeRequest[];
}

export interface TicketLaneModel {
  key: Verdict;
  title: string;
  rows: TicketRowModel[];
  defaultCollapsed: boolean;
}

const LANES: { key: Verdict; title: string; defaultCollapsed: boolean }[] = [
  { key: 'mismatch', title: 'Mismatches', defaultCollapsed: false },
  { key: 'review', title: 'Needs a human', defaultCollapsed: false },
  { key: 'grace', title: 'In grace period', defaultCollapsed: true },
  { key: 'ok', title: 'OK', defaultCollapsed: true },
  { key: 'unknown', title: 'Status unavailable', defaultCollapsed: true },
  { key: 'skipped', title: 'Not checked (ignored branches only)', defaultCollapsed: true },
];

/** Tickets with an open or closed PR by the viewer; the tracker cannot tell who wrote the code. */
function keysWithViewerPrs(snapshot: Snapshot): Set<string> {
  const login = snapshot.viewer?.login.toLowerCase();
  if (!login) return new Set();
  return new Set([...snapshot.prs, ...snapshot.closed]
    .filter((pr) => pr.author.login.toLowerCase() === login)
    .map((pr) => prTicketKey(pr))
    .filter((key): key is string => !!key));
}

/** The Mine filter keeps tickets the viewer is or was assignee on or has a PR for; the lanes and the tab count must agree on it. */
function visibleChecks(snapshot: Snapshot, mineOnly = false): TicketCheck[] {
  const checks = Object.values(snapshot.ticketChecks);
  if (!mineOnly) return checks;
  const withViewerPrs = keysWithViewerPrs(snapshot);
  return checks.filter((check) => snapshot.tickets[check.key]?.mine === true || withViewerPrs.has(check.key));
}

export function buildTicketLanes(snapshot: Snapshot, opts: { mineOnly?: boolean } = {}): TicketLaneModel[] {
  const checks = visibleChecks(snapshot, opts.mineOnly);
  const rows = checks.map((check): TicketRowModel => ({
    key: check.key,
    ticket: snapshot.tickets[check.key],
    check,
    open: snapshot.prs.filter((pr) => prTicketKey(pr) === check.key),
    closed: snapshot.closed.filter((pr) => prTicketKey(pr) === check.key),
  }));
  // Oldest change first: the longer a drift has lasted, the more it needs attention.
  const bySince = (a: TicketRowModel, b: TicketRowModel) => (a.check.since ?? '').localeCompare(b.check.since ?? '') || a.key.localeCompare(b.key);
  // The OK lane is mostly merged work; tickets with PRs still open are the ones worth a look, so they lead.
  const openFirst = (a: TicketRowModel, b: TicketRowModel) => Number(b.open.length > 0) - Number(a.open.length > 0) || bySince(a, b);
  return LANES.map((lane) => ({ ...lane, rows: rows.filter((row) => row.check.verdict === lane.key).sort(lane.key === 'ok' ? openFirst : bySince) }));
}

/** True when some ticket's "mine" flag is unknown, so a Mine filter may hide tickets that are in fact the viewer's. */
export function mineIsUnknown(snapshot: Snapshot): boolean {
  return Object.values(snapshot.tickets).some((ticket) => ticket.mine === null || ticket.mine === undefined);
}

export function ticketAttentionCount(snapshot: Snapshot, opts: { mineOnly?: boolean } = {}): number {
  return visibleChecks(snapshot, opts.mineOnly).filter((check) => check.verdict === 'mismatch' || check.verdict === 'review').length;
}
