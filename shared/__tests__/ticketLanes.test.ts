import { buildTicketLanes, mineIsUnknown, ticketAttentionCount } from '../ticketLanes';
import { emptySnapshot, type TicketCheck } from '../types';
import { makeClosed, makePr } from '../../test/factories';
import { makeTicket } from '../../test/fake-tracker';

const checkOf = (key: string, verdict: TicketCheck['verdict'], since = '2026-11-18T08:00:00Z'): TicketCheck =>
  ({ key, prState: 'merged', verdict, reason: `${key} reason`, expected: 'Done', since });

describe('buildTicketLanes', () => {
  const snapshot = {
    ...emptySnapshot('acme'),
    prs: [makePr({ headRefName: 'XX-1-work' })],
    closed: [makeClosed({ headRefName: 'XX-2-done' }), makeClosed({ headRefName: 'XX-1-part' })],
    tickets: { 'XX-1': makeTicket('XX-1', 'To Do', 'todo', { mine: true }), 'XX-2': makeTicket('XX-2', 'In Review', 'inProgress', { mine: false }) },
    ticketChecks: {
      'XX-1': checkOf('XX-1', 'mismatch', '2026-11-19T08:00:00Z'),
      'XX-2': checkOf('XX-2', 'mismatch', '2026-11-17T08:00:00Z'),
      'XX-3': checkOf('XX-3', 'ok'),
      'XX-4': checkOf('XX-4', 'unknown'),
      'XX-5': checkOf('XX-5', 'skipped'),
    },
  };

  it('orders lanes by urgency, collapses the calm ones and sorts rows oldest first', () => {
    const lanes = buildTicketLanes(snapshot);
    expect(lanes.map((lane) => [lane.key, lane.title, lane.rows.length, lane.defaultCollapsed])).toEqual([
      ['mismatch', 'Mismatches', 2, false],
      ['review', 'Needs a human', 0, false],
      ['grace', 'In grace period', 0, true],
      ['ok', 'OK', 1, true],
      ['unknown', 'Status unavailable', 1, true],
      ['skipped', 'Not checked (ignored branches only)', 1, true],
    ]);
    expect(lanes[0]!.rows.map((row) => row.key)).toEqual(['XX-2', 'XX-1']);
  });

  it('lists OK tickets that still have open PRs first, oldest first within each group', () => {
    const ok = {
      ...snapshot,
      prs: [makePr({ headRefName: 'XX-7-work' }), makePr({ headRefName: 'XX-9-work' })],
      closed: [makeClosed({ headRefName: 'XX-6-done' }), makeClosed({ headRefName: 'XX-8-done' })],
      ticketChecks: {
        'XX-6': checkOf('XX-6', 'ok', '2026-11-10T08:00:00Z'),
        'XX-7': checkOf('XX-7', 'ok', '2026-11-12T08:00:00Z'),
        'XX-8': checkOf('XX-8', 'ok', '2026-11-11T08:00:00Z'),
        'XX-9': checkOf('XX-9', 'ok', '2026-11-09T08:00:00Z'),
      },
    };
    const lane = buildTicketLanes(ok).find((candidate) => candidate.key === 'ok')!;
    expect(lane.rows.map((row) => row.key)).toEqual(['XX-9', 'XX-7', 'XX-6', 'XX-8']);
  });

  it('attaches open and closed PRs to each ticket', () => {
    const row = buildTicketLanes(snapshot)[0]!.rows.find((candidate) => candidate.key === 'XX-1')!;
    expect(row.open).toHaveLength(1);
    expect(row.closed).toHaveLength(1);
    expect(row.ticket?.status.name).toBe('To Do');
  });

  it('keeps only the viewer\'s tickets when filtered to mine', () => {
    const lanes = buildTicketLanes(snapshot, { mineOnly: true });
    expect(lanes.flatMap((lane) => lane.rows.map((row) => row.key))).toEqual(['XX-1']);
  });

  it('reports when the tracker could not tell which tickets are mine', () => {
    expect(mineIsUnknown(snapshot)).toBe(false);
    expect(mineIsUnknown({ ...snapshot, tickets: { ...snapshot.tickets, 'XX-3': makeTicket('XX-3', 'Done', 'done', { mine: null }) } })).toBe(true);
  });

  it('counts mismatches and tickets that need a human', () => {
    expect(ticketAttentionCount(snapshot)).toBe(2);
  });

  it('counts only the viewer\'s tickets when the Mine filter is on', () => {
    expect(ticketAttentionCount(snapshot, { mineOnly: true })).toBe(1);
  });
});
