import type { CodeHostProvider } from './types';

const MERGE_STATES = ['clean', 'blocked', 'unstable', 'conflicts', 'behind', 'unknown'];
const DECISIONS = ['approved', 'review_required', 'changes_requested', null];
const KINDS = ['human', 'ai-review', 'code-analysis', 'bot'];

/** Every CodeHostProvider must pass this with its own fixtures: provider data in, neutral model out. */
export function describeCodeHostContract(label: string, setup: () => { provider: CodeHostProvider; repos: string[] }) {
  describe(`${label} satisfies the CodeHostProvider contract`, () => {
    it('authenticates and reports the viewer', async () => {
      const { provider } = setup();
      const auth = await provider.checkAuth();
      expect(auth.ok).toBe(true);
      if (auth.ok) expect(typeof auth.viewer.login).toBe('string');
    });

    it('returns stubs only for the requested repositories', async () => {
      const { provider, repos } = setup();
      const stubs = await provider.pollLean(repos);
      expect(stubs.length).toBeGreaterThan(0);
      for (const stub of stubs) {
        expect(repos).toContain(stub.repo);
        expect(stub.number).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(stub.updatedAt))).toBe(false);
      }
    });

    it('returns neutral change requests for the stubs it is given', async () => {
      const { provider, repos } = setup();
      const stubs = await provider.pollLean(repos);
      const full = await provider.fetchFull(stubs);
      expect(full.map((pr) => pr.id).sort()).toEqual(stubs.map((stub) => stub.id).sort());
      for (const pr of full) {
        expect(MERGE_STATES).toContain(pr.mergeState);
        expect(DECISIONS).toContain(pr.reviewDecision);
        expect(KINDS).toContain(pr.author.kind);
        pr.reviews.forEach((review) => expect(KINDS).toContain(review.author.kind));
      }
    });

    it('reports a rate limit after a call', async () => {
      const { provider, repos } = setup();
      await provider.pollLean(repos);
      expect(provider.lastRateLimit()).not.toBeNull();
    });
  });
}
