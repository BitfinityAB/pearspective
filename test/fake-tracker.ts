import type { StatusCategory, Ticket } from '../shared/types';
import type { IssueTrackerProvider } from '../server/providers/types';

export function makeTicket(key: string, statusName: string, category: StatusCategory | null, overrides: Partial<Ticket> = {}): Ticket {
  return { key, summary: `Summary of ${key}`, type: 'Story', status: { name: statusName, category }, url: `https://tracker.example.test/browse/${key}`, ...overrides };
}

/** In-memory tracker; `tickets` can be reassigned between calls to simulate status changes. */
export function createFakeTracker(initial: Ticket[], overrides: Partial<IssueTrackerProvider> = {}) {
  const state = { tickets: initial, requested: [] as string[][], authCalls: 0 };
  const tracker: IssueTrackerProvider = {
    id: 'fake-tracker',
    checkAuth: async () => {
      state.authCalls += 1;
      return { ok: true, login: 'alex' };
    },
    getTickets: async (keys) => {
      state.requested.push(keys);
      const tickets = state.tickets.filter((ticket) => keys.includes(ticket.key));
      return { tickets, notFound: keys.filter((key) => !tickets.some((ticket) => ticket.key === key)) };
    },
    ticketUrl: (key) => `https://tracker.example.test/browse/${key}`,
    ...overrides,
  };
  return { tracker, state };
}
