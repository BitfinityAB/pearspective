import { ticketKeyOf } from './tickets';
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

export function buildTicketLanes(snapshot: Snapshot, opts: { mineOnly?: boolean } = {}): TicketLaneModel[] {
  const checks = Object.values(snapshot.ticketChecks).filter((check) => !opts.mineOnly || snapshot.tickets[check.key]?.mine === true);
  const rows = checks.map((check): TicketRowModel => ({
    key: check.key,
    ticket: snapshot.tickets[check.key],
    check,
    open: snapshot.prs.filter((pr) => ticketKeyOf(pr) === check.key),
    closed: snapshot.closed.filter((pr) => ticketKeyOf(pr) === check.key),
  }));
  // Oldest change first: the longer a drift has lasted, the more it needs attention.
  const bySince = (a: TicketRowModel, b: TicketRowModel) => (a.check.since ?? '').localeCompare(b.check.since ?? '') || a.key.localeCompare(b.key);
  return LANES.map((lane) => ({ ...lane, rows: rows.filter((row) => row.check.verdict === lane.key).sort(bySince) }));
}

/** True when some ticket's "mine" flag is unknown, so a Mine filter may hide tickets that are in fact the viewer's. */
export function mineIsUnknown(snapshot: Snapshot): boolean {
  return Object.values(snapshot.tickets).some((ticket) => ticket.mine === null || ticket.mine === undefined);
}

export function ticketAttentionCount(snapshot: Snapshot): number {
  return Object.values(snapshot.ticketChecks).filter((check) => check.verdict === 'mismatch' || check.verdict === 'review').length;
}
