import { buildTicketLanes, ticketAttentionCount } from '../ticketLanes';
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
    tickets: { 'XX-1': makeTicket('XX-1', 'To Do', 'todo'), 'XX-2': makeTicket('XX-2', 'In Review', 'inProgress') },
    ticketChecks: {
      'XX-1': checkOf('XX-1', 'mismatch', '2026-11-19T08:00:00Z'),
      'XX-2': checkOf('XX-2', 'mismatch', '2026-11-17T08:00:00Z'),
      'XX-3': checkOf('XX-3', 'ok'),
      'XX-4': checkOf('XX-4', 'unknown'),
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
    ]);
    expect(lanes[0]!.rows.map((row) => row.key)).toEqual(['XX-2', 'XX-1']);
  });

  it('attaches open and closed PRs to each ticket', () => {
    const row = buildTicketLanes(snapshot)[0]!.rows.find((candidate) => candidate.key === 'XX-1')!;
    expect(row.open).toHaveLength(1);
    expect(row.closed).toHaveLength(1);
    expect(row.ticket?.status.name).toBe('To Do');
  });

  it('counts mismatches and tickets that need a human', () => {
    expect(ticketAttentionCount(snapshot)).toBe(2);
  });
});
