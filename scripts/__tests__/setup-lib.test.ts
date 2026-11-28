import { buildConfig, defaultOrg, mostCommonOwner, parseRemote, preselect, rankCandidates, reviewerCandidates, selectedReposSummary, sortCandidates, validateSelection } from '../setup-lib';

describe('selectedReposSummary', () => {
  it('lists each chosen repository on its own line', () => {
    expect(selectedReposSummary(['orders-api', 'orders-web'])).toBe('\n  orders-api\n  orders-web');
  });
});

describe('parseRemote', () => {
  it.each([
    ['git@github.com:acme/orders-api.git', { owner: 'acme', repo: 'orders-api' }],
    ['https://github.com/acme/orders-web', { owner: 'acme', repo: 'orders-web' }],
    ['ssh://git@github.com/acme/field-api.git', { owner: 'acme', repo: 'field-api' }],
    ['https://acme.ghe.com/acme/report-service.git', { owner: 'acme', repo: 'report-service' }],
  ])('parses %s', (url, expected) => {
    expect(parseRemote(url)).toEqual(expected);
  });

  it('returns null for something that is not a remote URL', () => {
    expect(parseRemote('not a url')).toBeNull();
  });
});

describe('ranking and selection', () => {
  const activity = [{ name: 'orders-api', activity: 161 }, { name: 'orders-public-api', activity: 5 }, { name: 'report-service', activity: 1 }];
  const openCounts = { 'orders-api': 42, 'orders-public-api': 0, 'report-service': 7, 'field-legacy': 3 };
  const ranked = rankCandidates(['orders-api', 'orders-public-api', 'field-legacy'], activity, openCounts);

  it('merges cloned and active repos, marking which are cloned', () => {
    expect(ranked).toEqual([
      { name: 'orders-api', activity: 161, openCount: 42, cloned: true },
      { name: 'orders-public-api', activity: 5, openCount: 0, cloned: true },
      { name: 'report-service', activity: 1, openCount: 7, cloned: false },
      { name: 'field-legacy', activity: 0, openCount: 3, cloned: true },
    ]);
  });

  it('pre-selects by activity, skipping repos without open PRs, up to the cap', () => {
    expect(preselect(ranked, 2)).toEqual(['orders-api', 'report-service']);
  });

  it('refuses an empty selection or more than ten repos', () => {
    expect(validateSelection([])).toMatch(/at least one/);
    expect(validateSelection(Array.from({ length: 11 }, (_, index) => `r${index}`))).toMatch(/10/);
    expect(validateSelection(['orders-api'])).toBe(true);
  });

  it('picks the owner most remotes point at', () => {
    expect(mostCommonOwner([{ owner: 'acme' }, { owner: 'acme' }, { owner: 'other' }])).toBe('acme');
    expect(mostCommonOwner([])).toBeNull();
  });
});

describe('defaultOrg', () => {
  const remotes = [{ owner: 'acme' }, { owner: 'globex' }, { owner: 'globex' }, { owner: 'initech' }];

  it('keeps the configured org while the gh user still belongs to it', () => {
    expect(defaultOrg({ existing: 'acme', viewerOrgs: ['acme', 'globex'], remotes })).toBe('acme');
    expect(defaultOrg({ existing: 'acme', viewerOrgs: [], remotes })).toBe('acme');
  });

  it('takes the only org of the gh user', () => {
    expect(defaultOrg({ existing: 'gone', viewerOrgs: ['initech'], remotes })).toBe('initech');
  });

  it('picks the gh org most local clones belong to, else the first gh org', () => {
    expect(defaultOrg({ viewerOrgs: ['acme', 'globex'], remotes })).toBe('globex');
    expect(defaultOrg({ viewerOrgs: ['umbrella', 'hooli'], remotes })).toBe('umbrella');
  });

  it('falls back to the most common remote owner when gh lists no orgs', () => {
    expect(defaultOrg({ viewerOrgs: [], remotes })).toBe('globex');
    expect(defaultOrg({ viewerOrgs: [], remotes: [] })).toBe('');
  });
});

describe('buildConfig', () => {
  it('creates a config with defaults', () => {
    expect(buildConfig({ org: 'acme', repos: ['orders-api'], teams: ['core'], localRepos: ['orders-api'] })).toMatchObject({
      codeHost: { provider: 'github', org: 'acme', repos: ['orders-api'], teams: ['core'], localRepos: ['orders-api'], excludeRepos: [] },
      refreshIntervalSec: 180,
    });
  });

  it('keeps reviewers and refresh from an existing config unless new reviewers are given', () => {
    const copilot = { name: 'Copilot', logins: ['copilot-pull-request-reviewer'], show: false };
    const existing = buildConfig({ org: 'acme', repos: [], teams: [], localRepos: [], reviewers: { aiReview: copilot } });
    existing.refreshIntervalSec = 600;
    const kept = buildConfig({ org: 'acme', repos: ['x'], teams: [], localRepos: [] }, existing);
    expect(kept.refreshIntervalSec).toBe(600);
    expect(kept.reviewers).toEqual({ aiReview: copilot });
    const replaced = buildConfig({ org: 'acme', repos: ['x'], teams: [], localRepos: [], reviewers: {} }, existing);
    expect(replaced.reviewers).toEqual({});
  });
});

describe('reviewerCandidates', () => {
  it('sorts known tools into slots, most reviews first, and keeps unknown bots apart', () => {
    const { bySlot, unknown } = reviewerCandidates([
      { login: 'codescene-access', reviews: 250 },
      { login: 'copilot-pull-request-reviewer', reviews: 84 },
      { login: 'codescene-delta-analysis', reviews: 5 },
      { login: 'github-actions', reviews: 3 },
      { login: 'acme-review-bot', reviews: 2 },
    ]);
    expect(bySlot.aiReview.map((candidate) => candidate.slotConfig.name)).toEqual(['Copilot']);
    expect(bySlot.codeAnalysis).toEqual([{ slot: 'codeAnalysis', slotConfig: { name: 'CodeScene', logins: ['codescene-*'], show: true }, reviews: 255, known: true }]);
    expect(unknown).toEqual([{ login: 'acme-review-bot', reviews: 2 }]);
  });

  it('puts an existing slot first and keeps its show and short', () => {
    const existing = { codeAnalysis: { name: 'SonarQube Cloud', logins: ['sonarqubecloud'], short: 'SQ', show: false } };
    const { bySlot } = reviewerCandidates([{ login: 'codescene-access', reviews: 9 }], existing);
    expect(bySlot.codeAnalysis.map((candidate) => [candidate.slotConfig.name, candidate.slotConfig.show])).toEqual([['SonarQube Cloud', false], ['CodeScene', true]]);
  });

  it('keeps the show setting when the existing tool is found again', () => {
    const existing = { aiReview: { name: 'Copilot', logins: ['copilot-pull-request-reviewer'], show: false } };
    const { bySlot } = reviewerCandidates([{ login: 'copilot-pull-request-reviewer', reviews: 3 }], existing);
    expect(bySlot.aiReview).toEqual([{ slot: 'aiReview', slotConfig: existing.aiReview, reviews: 3, known: true }]);
  });
});

describe('sortCandidates', () => {
  const candidate = (name: string, reviews: number, known: boolean, slotConfig = { name, logins: [name], show: true }) => ({ slot: 'aiReview' as const, slotConfig, reviews, known });

  it('puts an unknown bot with more reviews ahead of a known tool', () => {
    const sorted = sortCandidates([candidate('Copilot', 5, true), candidate('Acme Bot', 40, false)], undefined);
    expect(sorted.map((entry) => entry.slotConfig.name)).toEqual(['Acme Bot', 'Copilot']);
  });

  it('keeps the existing slot first regardless of reviews', () => {
    const existing = { name: 'Copilot', logins: ['copilot'], show: true };
    const sorted = sortCandidates([candidate('Acme Bot', 40, false), candidate('Copilot', 0, true, existing)], existing);
    expect(sorted.map((entry) => entry.slotConfig.name)).toEqual(['Copilot', 'Acme Bot']);
  });
});
