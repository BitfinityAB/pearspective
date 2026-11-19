import { GithubProvider, ENRICH_BATCH_SIZE, ENRICH_CONCURRENCY } from '../provider';
import { describeCodeHostContract } from '../../../contract';
import { ProviderError } from '../../../types';
import type { GhClient } from '../../../../gh';
import fullPr from '../fixtures/full-pr.json';

const classes = { 'ai-review': ['copilot-pull-request-reviewer'], 'code-analysis': ['codescene-*'] };
const rateLimit = { remaining: 4990, resetAt: '2026-11-18T13:00:00Z' };
const leanNode = (number: number, repo = 'field-app') => ({ ...fullPr, id: `PR_${number}`, number, repository: { name: repo } });

/** Answers each query by its shape, so tests read like the GitHub conversation they simulate. */
function fakeGh(handlers: { match: RegExp; reply: (query: string, variables: Record<string, any>) => any }[]) {
  const queries: { query: string; variables: Record<string, any> }[] = [];
  const restPaths: string[] = [];
  const gh: GhClient = {
    async graphql(query, variables = {}) {
      queries.push({ query, variables });
      const handler = handlers.find((candidate) => candidate.match.test(query));
      if (!handler) throw new Error(`Unexpected query: ${query.slice(0, 80)}`);
      return handler.reply(query, variables);
    },
    async rest(path) {
      restPaths.push(path);
      return { behind_by: 3 } as any;
    },
  };
  return { gh, queries, restPaths };
}

const fullReply = (query: string) => {
  const reply: Record<string, any> = { rateLimit };
  for (const match of query.matchAll(/p(\d+): node\(id: "([^"]+)"\)/g)) reply[`p${match[1]}`] = { ...fullPr, id: match[2] };
  return reply;
};

const standardHandlers = [
  { match: /viewer \{ login/, reply: () => ({ viewer: { login: 'dev-one_acme', name: 'Dev One', avatarUrl: 'https://avatars.example.test/1' }, rateLimit }) },
  { match: /organization\(login/, reply: () => ({ organization: { teams: { nodes: [{ slug: 'platform-team', avatarUrl: 'team.png' }] } }, rateLimit }) },
  { match: /r0: repository/, reply: () => ({ r0: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [leanNode(4988), leanNode(4989)] } }, rateLimit }) },
  { match: /node\(id:/, reply: fullReply },
];

describeCodeHostContract('GithubProvider', () => ({
  provider: new GithubProvider(fakeGh(standardHandlers).gh, 'acme', classes),
  repos: ['field-app'],
}));

describe('GithubProvider', () => {
  it('returns the viewer with their teams in the org', async () => {
    const provider = new GithubProvider(fakeGh(standardHandlers).gh, 'acme', classes);
    expect(await provider.checkAuth()).toEqual({
      ok: true,
      viewer: { login: 'dev-one_acme', name: 'Dev One', avatarUrl: 'https://avatars.example.test/1', teams: [{ slug: 'platform-team', avatarUrl: 'team.png' }] },
    });
  });

  it('asks GitHub for display names of the viewer, reviewers, thread authors and requested people', async () => {
    const { gh, queries } = fakeGh([...standardHandlers]);
    const provider = new GithubProvider(gh, 'acme', classes);
    await provider.checkAuth();
    await provider.fetchFull([{ id: 'PR_1', repo: 'r', number: 1, updatedAt: 'x', headSha: 'x', headRefName: 'h', baseRefName: 'main', isDraft: false }]);
    const viewerQuery = queries.find((call) => /viewer \{/.test(call.query))!.query;
    const fullQueryText = queries.find((call) => /node\(id:/.test(call.query))!.query.replace(/\s+/g, ' ');
    expect(viewerQuery).toMatch(/viewer \{ login name /);
    expect(fullQueryText).toMatch(/reviews\(last: 10\) \{ nodes \{ state submittedAt author \{ [^}]*\.\.\. on User \{ name \}/);
    expect(fullQueryText).toMatch(/comments\(first: 1\) \{ nodes \{ bodyText url author \{ [^}]*\.\.\. on User \{ name \}/);
    expect(fullQueryText).toMatch(/\.\.\. on User \{ login name avatarUrl\(size: 64\) \}/);
  });

  it('leaves the viewer name out when the GitHub profile has none', async () => {
    const handlers = [{ match: /viewer \{ login/, reply: () => ({ viewer: { login: 'dev-one_acme', name: '', avatarUrl: 'a' }, rateLimit }) }, standardHandlers[1]!];
    const auth = await new GithubProvider(fakeGh(handlers).gh, 'acme', classes).checkAuth();
    expect(auth.ok && auth.viewer).not.toHaveProperty('name');
  });

  it('turns a logged-out gh into a failed auth result instead of throwing', async () => {
    const gh: GhClient = { graphql: async () => { throw new ProviderError('auth', 'gh is not logged in.'); }, rest: async () => ({}) as any };
    expect(await new GithubProvider(gh, 'acme', classes).checkAuth()).toEqual({ ok: false, reason: 'auth', message: 'gh is not logged in.' });
  });

  it('polls all repositories in one request and follows pagination per repository', async () => {
    const { gh, queries } = fakeGh([
      { match: /after: "cursor-1"/, reply: () => ({ r0: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [leanNode(3)] } }, rateLimit }) },
      {
        match: /r0: repository.*\n.*r1: repository/s,
        reply: () => ({
          r0: { pullRequests: { pageInfo: { hasNextPage: true, endCursor: 'cursor-1' }, nodes: [leanNode(1)] } },
          r1: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [leanNode(2, 'orders-api')] } },
          rateLimit,
        }),
      },
    ]);

    const stubs = await new GithubProvider(gh, 'acme', classes).pollLean(['field-app', 'orders-api']);

    // Each repository's extra pages are read before moving on to the next repository.
    expect(stubs.map((stub) => stub.number)).toEqual([1, 3, 2]);
    expect(queries).toHaveLength(2);
  });

  it('stops following pages after the cap when a repository keeps reporting more', async () => {
    const { gh, queries } = fakeGh([
      { match: /after: "loop"/, reply: () => ({ r0: { pullRequests: { pageInfo: { hasNextPage: true, endCursor: 'loop' }, nodes: [leanNode(2)] } }, rateLimit }) },
      { match: /r0: repository/, reply: () => ({ r0: { pullRequests: { pageInfo: { hasNextPage: true, endCursor: 'loop' }, nodes: [leanNode(1)] } }, rateLimit }) },
    ]);
    const stubs = await new GithubProvider(gh, 'acme', classes).pollLean(['field-app']);
    expect(queries).toHaveLength(21);
    expect(stubs).toHaveLength(21);
  });

  it('returns what it has gathered when a later page finds the repository gone', async () => {
    const { gh } = fakeGh([
      { match: /after: "cursor-1"/, reply: () => ({ r0: null, rateLimit }) },
      { match: /r0: repository/, reply: () => ({ r0: { pullRequests: { pageInfo: { hasNextPage: true, endCursor: 'cursor-1' }, nodes: [leanNode(1)] } }, rateLimit }) },
    ]);
    const stubs = await new GithubProvider(gh, 'acme', classes).pollLean(['field-app']);
    expect(stubs.map((stub) => stub.number)).toEqual([1]);
  });

  it('skips a repository that no longer exists', async () => {
    const { gh } = fakeGh([{ match: /r0: repository/, reply: () => ({ r0: null, rateLimit }) }]);
    expect(await new GithubProvider(gh, 'acme', classes).pollLean(['gone'])).toEqual([]);
  });

  it(`fetches full data in batches of ${ENRICH_BATCH_SIZE}`, async () => {
    const { gh, queries } = fakeGh([{ match: /node\(id:/, reply: fullReply }]);
    const stubs = Array.from({ length: 30 }, (_, index) => ({ ...leanNode(index + 1), headSha: 'x' })).map((node) => ({
      id: node.id, repo: 'field-app', number: node.number, updatedAt: node.updatedAt, headSha: 'x',
      headRefName: 'h', baseRefName: 'main', isDraft: false,
    }));

    const prs = await new GithubProvider(gh, 'acme', classes).fetchFull(stubs);

    expect(prs).toHaveLength(30);
    expect(queries.map((call) => (call.query.match(/node\(id:/g) ?? []).length)).toEqual([25, 5]);
    expect(queries[0]!.query).toContain('isRequired(pullRequestNumber: 1)');
  });

  it('halves the batch size when GitHub says a query is too large', async () => {
    let failures = 1;
    const { gh, queries } = fakeGh([{
      match: /node\(id:/,
      reply: (query) => {
        if (failures-- > 0) throw new ProviderError('too-large', 'Resource limits for this query exceeded.');
        return fullReply(query);
      },
    }]);
    const stubs = Array.from({ length: 20 }, (_, index) => ({
      id: `PR_${index}`, repo: 'r', number: index + 1, updatedAt: '2026-11-17T00:00:00Z', headSha: 'x', headRefName: 'h', baseRefName: 'main', isDraft: false,
    }));

    const prs = await new GithubProvider(gh, 'acme', classes).fetchFull(stubs);

    expect(prs).toHaveLength(20);
    expect(queries.map((call) => (call.query.match(/node\(id:/g) ?? []).length)).toEqual([20, 12, 8]);
  });

  const manyStubs = (count: number) => Array.from({ length: count }, (_, index) => ({
    id: `PR_${index}`, repo: 'r', number: index + 1, updatedAt: '2026-11-17T00:00:00Z', headSha: 'x', headRefName: 'h', baseRefName: 'main', isDraft: false,
  }));

  it(`runs at most ${ENRICH_CONCURRENCY} batches at a time`, async () => {
    let running = 0;
    let peak = 0;
    const { gh, queries } = fakeGh([{
      match: /node\(id:/,
      reply: async (query) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return fullReply(query);
      },
    }]);

    const prs = await new GithubProvider(gh, 'acme', classes).fetchFull(manyStubs(6 * ENRICH_BATCH_SIZE));

    expect(prs).toHaveLength(6 * ENRICH_BATCH_SIZE);
    expect(queries).toHaveLength(6);
    expect(peak).toBe(ENRICH_CONCURRENCY);
  });

  it('keeps the batches that succeeded when another batch fails', async () => {
    let calls = 0;
    const { gh } = fakeGh([{
      match: /node\(id:/,
      reply: (query) => {
        if (++calls === 2) throw new ProviderError('failed', 'Something went wrong');
        return fullReply(query);
      },
    }]);

    const error = await new GithubProvider(gh, 'acme', classes).fetchFull(manyStubs(3 * ENRICH_BATCH_SIZE)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: 'failed', message: 'Something went wrong' });
    expect((error as ProviderError).partial).toHaveLength(2 * ENRICH_BATCH_SIZE);
  });

  it('builds the Mine searches with the right qualifiers', async () => {
    const { gh, queries } = fakeGh([{ match: /search\(query: \$q, type: ISSUE, first: 50/, reply: () => ({ search: { pageInfo: { hasNextPage: false }, nodes: [leanNode(7), {}] }, rateLimit }) }]);
    const provider = new GithubProvider(gh, 'acme', classes);

    const authored = await provider.searchMine('authored');
    await provider.searchMine('review-requested');
    await provider.searchMine('team-review-requested', 'platform-team');

    expect(authored.map((stub) => stub.number)).toEqual([7]);
    expect(queries.map((call) => call.variables.q)).toEqual([
      'is:pr is:open archived:false org:acme author:@me',
      'is:pr is:open archived:false org:acme user-review-requested:@me',
      'is:pr is:open archived:false org:acme team-review-requested:acme/platform-team',
    ]);
  });

  it('refuses a team search without a team', async () => {
    await expect(new GithubProvider(fakeGh([]).gh, 'acme', classes).searchMine('team-review-requested')).rejects.toThrow('team is required');
  });

  it('ranks repositories by PRs authored or reviewed in the period', async () => {
    const { gh, queries } = fakeGh([{
      match: /first: 100, after: \$after\) \{ pageInfo/,
      reply: (_query, variables) => ({
        search: {
          pageInfo: { hasNextPage: false },
          nodes: variables.q.includes('author:@me')
            ? [{ repository: { name: 'orders-api' } }, { repository: { name: 'orders-api' } }]
            : [{ repository: { name: 'integration-hr' } }, { repository: { name: 'orders-api' } }],
        },
        rateLimit,
      }),
    }]);

    const ranked = await new GithubProvider(gh, 'acme', classes).rankReposByActivity(90);

    expect(ranked).toEqual([{ name: 'orders-api', activity: 3 }, { name: 'integration-hr', activity: 1 }]);
    expect(queries[0]!.variables.q).toMatch(/^is:pr org:acme author:@me updated:>=\d{4}-\d{2}-\d{2}$/);
  });

  it('reads native stack entries and maps their states', async () => {
    const { gh } = fakeGh([{
      match: /stack \{ number baseRefName entries/,
      reply: () => ({
        repository: { pullRequest: { stack: { number: 4964, baseRefName: 'main', entries: { nodes: [
          { position: 1, pullRequest: { number: 4985, title: 'Add offline storage layer', state: 'MERGED' } },
          { position: 2, pullRequest: { number: 4988, title: 'Use offline mode', state: 'OPEN' } },
        ] } } } },
        rateLimit,
      }),
    }]);

    expect(await new GithubProvider(gh, 'acme', classes).nativeStackEntries('field-app', 4988)).toEqual({
      number: 4964, baseRefName: 'main',
      entries: [
        { position: 1, number: 4985, title: 'Add offline storage layer', state: 'merged' },
        { position: 2, number: 4988, title: 'Use offline mode', state: 'open' },
      ],
    });
  });

  it('compares branches through the REST compare endpoint with encoded names', async () => {
    const { gh, restPaths } = fakeGh([]);
    const result = await new GithubProvider(gh, 'acme', classes).compareRefs('field-app', 'feature/a', 'feature/b');
    expect(result).toEqual({ behindBy: 3 });
    expect(restPaths).toEqual(['repos/acme/field-app/compare/feature%2Fa...feature%2Fb']);
  });
});
