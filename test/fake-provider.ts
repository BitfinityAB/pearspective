import type { ChangeRequest, ChangeRequestStub, ClosedChangeRequest } from '../shared/types';
import type { CodeHostProvider } from '../server/providers/types';

export const stubOf = (pr: ChangeRequest): ChangeRequestStub => ({
  id: pr.id, repo: pr.repo, number: pr.number, updatedAt: pr.updatedAt, headSha: pr.headSha,
  headRefName: pr.headRefName, baseRefName: pr.baseRefName, isDraft: pr.isDraft, nativeStack: pr.nativeStack,
});

/** In-memory provider; `prs` can be reassigned between ticks to simulate GitHub changing. */
export function createFakeProvider(initial: ChangeRequest[], overrides: Partial<CodeHostProvider> = {}) {
  const state = { prs: initial, closed: [] as ClosedChangeRequest[], fetched: [] as string[][], mine: { authored: [] as string[], requested: [] as string[], team: [] as string[] } };
  const byIds = (ids: string[]) => state.prs.filter((pr) => ids.includes(pr.id)).map(stubOf);
  const provider: CodeHostProvider = {
    id: 'fake',
    host: 'example.test',
    capabilities: { nativeStacks: true, requiredChecks: true, mergeability: true, draft: true, reviewThreads: true, teamReviewRequests: true },
    checkAuth: async () => ({ ok: true, viewer: { login: 'alex', teams: [{ slug: 'core' }] } }),
    lastRateLimit: () => ({ remaining: 4000, resetAt: '2026-11-18T13:00:00Z' }),
    listRepos: async () => [],
    rankReposByActivity: async () => [],
    openCounts: async () => ({}),
    pollLean: async (repos) => state.prs.filter((pr) => repos.includes(pr.repo)).map(stubOf),
    fetchFull: async (stubs) => {
      state.fetched.push(stubs.map((stub) => stub.id));
      return state.prs.filter((pr) => stubs.some((stub) => stub.id === pr.id));
    },
    fetchClosed: async (repos) => state.closed.filter((pr) => repos.includes(pr.repo)),
    searchMine: async (kind) => byIds(kind === 'authored' ? state.mine.authored : kind === 'review-requested' ? state.mine.requested : state.mine.team),
    nativeStackEntries: async () => null,
    compareRefs: async () => ({ behindBy: 0 }),
    ...overrides,
  };
  return { provider, state };
}
