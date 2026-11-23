import { classifyActor, toChangeRequest, toStub } from '../mapping';
import { signalsOf } from '../../../../../shared/status';
import { fullQuery } from '../queries';
import fullPr from '../fixtures/full-pr.json';

const classes = { 'ai-review': ['copilot-pull-request-reviewer'], 'code-analysis': ['codescene-*'] };

describe('classifyActor', () => {
  it('uses configured classes, supports a trailing wildcard, and falls back by type', () => {
    expect(classifyActor('copilot-pull-request-reviewer', 'Bot', classes)).toBe('ai-review');
    expect(classifyActor('codescene-delta-analysis', 'Bot', classes)).toBe('code-analysis');
    expect(classifyActor('dependabot', 'Bot', classes)).toBe('bot');
    expect(classifyActor('dev-one_acme', 'User', classes)).toBe('human');
  });
});

describe('toChangeRequest', () => {
  const pr = toChangeRequest(fullPr, classes);

  it('maps identity, refs and the native stack', () => {
    expect(pr).toMatchObject({
      id: 'PR_kwDOAAAA4988', provider: 'github', repo: 'field-app', number: 4988, headSha: 'abc123',
      headRefName: 'XX-412-offline-mode', baseRefName: 'XX-411-prefetch-profile-data', commentCount: 4,
      nativeStack: { number: 4964, size: 26, position: 15, baseRefName: 'main' },
      author: { login: 'dev-one_acme', name: 'Dev One', kind: 'human', avatarUrl: 'https://avatars.example.test/u/1?v=4' },
    });
  });

  it('maps merge state and review decision to neutral values', () => {
    expect(pr.mergeState).toBe('blocked');
    expect(pr.reviewDecision).toBe('review_required');
  });

  it('maps check runs and status contexts, keeping the required flag', () => {
    expect(pr.checks).toEqual([
      { name: 'build', state: 'success', required: true, url: 'https://example.test/runs/1' },
      { name: 'e2e-android', state: 'pending', required: true, url: 'https://example.test/runs/2' },
      { name: 'lint-extra', state: 'failure', required: false, url: 'https://example.test/runs/3' },
      { name: 'codescene/delta', state: 'success', required: false, url: 'https://example.test/cs' },
    ]);
  });

  it('keeps only the newest run of a check, so attempts cancelled by a newer run do not count as failures', () => {
    const run = (conclusion: string | null, startedAt: string | null, url: string) => ({
      __typename: 'CheckRun', name: 'PR Test / Lint', status: conclusion ? 'COMPLETED' : 'QUEUED', conclusion, startedAt, detailsUrl: url, isRequired: false,
    });
    const withRuns = (runs: unknown[]) => toChangeRequest({ ...fullPr, commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { pageInfo: { hasNextPage: false }, nodes: runs } } } }] } }, classes).checks;

    expect(withRuns([
      run('CANCELLED', '2026-11-23T10:32:24Z', 'https://example.test/runs/1876'),
      run('SUCCESS', '2026-11-23T10:41:22Z', 'https://example.test/runs/1878'),
      run('CANCELLED', '2026-11-23T10:32:22Z', 'https://example.test/runs/1877'),
    ])).toEqual([{ name: 'PR Test / Lint', state: 'success', required: false, url: 'https://example.test/runs/1878' }]);

    // A re-run that has not started yet is the newest attempt.
    expect(withRuns([
      run('FAILURE', '2026-11-23T10:32:24Z', 'https://example.test/runs/1'),
      run(null, null, 'https://example.test/runs/2'),
    ])).toEqual([{ name: 'PR Test / Lint', state: 'pending', required: false, url: 'https://example.test/runs/2' }]);
  });

  it('drops pending reviews and classifies reviewers', () => {
    expect(pr.reviews.map((review) => [review.author.login, review.author.kind, review.state])).toEqual([
      ['copilot-pull-request-reviewer', 'ai-review', 'commented'],
      ['codescene-access', 'code-analysis', 'approved'],
    ]);
  });

  it('maps threads and review requests to people and teams', () => {
    expect(pr.threads.map((thread) => [thread.author.kind, thread.resolved])).toEqual([['ai-review', false], ['human', false], ['human', true]]);
    expect(pr.threads[0]!.snippet).toBe('syncQueue is never cleared when the user signs out.');
    expect(pr.threads[1]!.author).toMatchObject({ login: 'dev-two_acme', name: 'Dev Two' });
    expect(pr.reviewRequests).toEqual([
      { type: 'team', slug: 'platform-team', avatarUrl: 'https://avatars.example.test/t/1?v=4' },
      { type: 'person', person: { login: 'dev-three_acme', kind: 'human', avatarUrl: 'https://avatars.example.test/u/3?v=4' } },
    ]);
  });

  it('produces the expected signals end to end', () => {
    expect(signalsOf(pr).map((signal) => signal.color)).toEqual(['amber', 'amber', 'green', 'amber', 'amber', 'amber']);
  });

  it('treats CONFLICTING as conflicts even when the merge state says otherwise', () => {
    expect(toChangeRequest({ ...fullPr, mergeable: 'CONFLICTING', mergeStateStatus: 'BLOCKED' }, classes).mergeState).toBe('conflicts');
  });

  it('appends a pending marker when GitHub says more checks exist than were loaded', () => {
    const commit = fullPr.commits.nodes[0]!.commit;
    const truncated = { ...fullPr, commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { ...commit.statusCheckRollup.contexts, pageInfo: { hasNextPage: true } } } } }] } };
    const checks = toChangeRequest(truncated, classes).checks;
    expect(checks).toHaveLength(pr.checks.length + 1);
    expect(checks.at(-1)).toEqual({ name: 'More checks not loaded', state: 'pending', required: false });
    expect(pr.checks.some((check) => check.name === 'More checks not loaded')).toBe(false);
  });

  it('appends an unresolved marker thread when GitHub says more threads exist than were loaded', () => {
    const truncated = { ...fullPr, reviewThreads: { ...fullPr.reviewThreads, pageInfo: { hasPreviousPage: true } } };
    const mapped = toChangeRequest(truncated, classes);
    expect(mapped.threads).toHaveLength(pr.threads.length + 1);
    expect(mapped.threads.at(-1)).toEqual({
      resolved: false, author: { login: 'more-threads-not-loaded', kind: 'human' }, snippet: 'More review threads not loaded', url: fullPr.url,
    });
    expect(signalsOf(mapped).find((signal) => signal.key === 'threads')!.color).not.toBe('green');
    expect(pr.threads.some((thread) => thread.author.login === 'more-threads-not-loaded')).toBe(false);
  });

  it('asks for the thread page info so a cut-off list can be detected', () => {
    expect(fullQuery([{ id: 'PR_1', number: 1 }])).toMatch(/reviewThreads\(last: \d+\) \{ pageInfo \{ hasPreviousPage \}/);
    expect(fullQuery([{ id: 'PR_1', number: 1 }])).toMatch(/lastComment: comments\(last: 1\) \{ nodes \{ bodyText url author \{/);
  });

  it('maps the newest conversation comment with its author', () => {
    expect(pr.lastComment).toEqual({
      author: { login: 'dev-two_acme', name: 'Dev Two', kind: 'human', avatarUrl: 'https://avatars.example.test/u/2?v=4' },
      snippet: 'Looks good after the rebase.',
      url: 'https://example.test/c/4',
    });
    expect(toChangeRequest({ ...fullPr, lastComment: { nodes: [] } }, classes).lastComment).toBeUndefined();
  });

  it('maps a deleted author to a ghost person', () => {
    expect(toChangeRequest({ ...fullPr, author: null }, classes).author).toEqual({ login: 'ghost', kind: 'human' });
  });
});

describe('toStub', () => {
  it('keeps only the cheap poll fields', () => {
    expect(toStub(fullPr)).toEqual({
      id: 'PR_kwDOAAAA4988', repo: 'field-app', number: 4988, updatedAt: '2026-11-17T15:00:00Z', headSha: 'abc123',
      headRefName: 'XX-412-offline-mode', baseRefName: 'XX-411-prefetch-profile-data', isDraft: false,
      nativeStack: { number: 4964, size: 26, position: 15, baseRefName: 'main' },
    });
  });

  it('omits nativeStack when the PR is not in a GitHub stack', () => {
    expect(toStub({ ...fullPr, stack: null, stackEntry: null }).nativeStack).toBeUndefined();
  });
});
