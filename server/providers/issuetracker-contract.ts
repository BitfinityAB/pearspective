import type { IssueTrackerProvider } from './types';

const CATEGORIES = ['todo', 'inProgress', 'done', null];

/** Every IssueTrackerProvider must pass this with its own fixtures: tracker data in, neutral tickets out. */
export function describeIssueTrackerContract(label: string, setup: () => { tracker: IssueTrackerProvider; knownKeys: string[]; unknownKey: string }) {
  describe(`${label} satisfies the IssueTrackerProvider contract`, () => {
    it('authenticates and reports a login', async () => {
      const auth = await setup().tracker.checkAuth();
      expect(auth.ok).toBe(true);
      if (auth.ok) expect(typeof auth.login).toBe('string');
    });

    it('returns the known keys as tickets and the unknown key as not found', async () => {
      const { tracker, knownKeys, unknownKey } = setup();
      const result = await tracker.getTickets([...knownKeys, unknownKey]);
      expect(result.tickets.map((ticket) => ticket.key).sort()).toEqual([...knownKeys].sort());
      expect(result.notFound).toEqual([unknownKey]);
    });

    it('returns neutral tickets', async () => {
      const { tracker, knownKeys } = setup();
      for (const ticket of (await tracker.getTickets(knownKeys)).tickets) {
        expect(typeof ticket.summary).toBe('string');
        expect(ticket.status.name).not.toBe('');
        expect(CATEGORIES).toContain(ticket.status.category);
        expect(ticket.url).toContain(encodeURIComponent(ticket.key));
      }
    });
  });
}
