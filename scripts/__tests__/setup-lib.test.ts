import { buildConfig, defaultOrg, mostCommonOwner, parseRemote, preselect, rankCandidates, validateSelection } from '../setup-lib';

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

  it('keeps reviewer classes and refresh from an existing config', () => {
    const existing = buildConfig({ org: 'acme', repos: [], teams: [], localRepos: [] });
    existing.refreshIntervalSec = 600;
    existing.reviewerClasses['ai-review'] = ['custom-bot'];
    const next = buildConfig({ org: 'acme', repos: ['x'], teams: [], localRepos: [] }, existing);
    expect(next.refreshIntervalSec).toBe(600);
    expect(next.reviewerClasses['ai-review']).toEqual(['custom-bot']);
  });
});
