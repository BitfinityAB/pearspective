const literal = (value: string) => JSON.stringify(value);
// Bots have no name field, so the display name is requested on the User variant only.
const PERSON = 'login __typename avatarUrl(size: 64) ... on User { name }';
const RATE = 'rateLimit { remaining resetAt }';

export const LEAN_FIELDS =
  'id number updatedAt headRefOid headRefName baseRefName isDraft repository { name } stack { number size baseRefName } stackEntry { position }';

const OPEN_PRS = (after: string | null) =>
  `pullRequests(states: OPEN, first: 100${after ? `, after: ${literal(after)}` : ''}, orderBy: { field: UPDATED_AT, direction: DESC }) { pageInfo { hasNextPage endCursor } nodes { ${LEAN_FIELDS} } }`;

export function leanReposQuery(org: string, repos: string[]): string {
  const blocks = repos.map((repo, index) => `r${index}: repository(owner: ${literal(org)}, name: ${literal(repo)}) { ${OPEN_PRS(null)} }`);
  return `query { ${blocks.join('\n')} ${RATE} }`;
}

export function leanRepoPageQuery(org: string, repo: string, after: string): string {
  return `query { r0: repository(owner: ${literal(org)}, name: ${literal(repo)}) { ${OPEN_PRS(after)} } ${RATE} }`;
}

const CLOSED_FIELDS = `id number title url closedAt merged headRefName baseRefName repository { name } author { ${PERSON} }`;

// Aliased per repository: GitHub search would need ten repo: qualifiers and exceed its 256-character limit.
export function closedReposQuery(org: string, repos: string[]): string {
  const blocks = repos.map((repo, index) =>
    `r${index}: repository(owner: ${literal(org)}, name: ${literal(repo)}) { pullRequests(states: [MERGED, CLOSED], first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${CLOSED_FIELDS} } } }`);
  return `query { ${blocks.join('\n')} ${RATE} }`;
}

// isRequired needs the PR it is evaluated against, so each PR gets its own alias.
function fullFields(number: number): string {
  return `
    id number title url createdAt updatedAt isDraft headRefOid headRefName baseRefName
    repository { name } mergeable mergeStateStatus reviewDecision
    author { ${PERSON} }
    stack { number size baseRefName } stackEntry { position }
    comments { totalCount } lastComment: comments(last: 1) { nodes { bodyText url author { ${PERSON} } } }
    commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) { pageInfo { hasNextPage } nodes { __typename
      ... on CheckRun { name status conclusion startedAt detailsUrl isRequired(pullRequestNumber: ${number}) }
      ... on StatusContext { context state targetUrl isRequired(pullRequestNumber: ${number}) } } } } } } }
    reviews(last: 10) { nodes { state submittedAt author { ${PERSON} } } }
    reviewThreads(last: 20) { pageInfo { hasPreviousPage } nodes { isResolved comments(first: 1) { nodes { bodyText url author { ${PERSON} } } } } }
    reviewRequests(first: 5) { nodes { requestedReviewer { __typename
      ... on User { login name avatarUrl(size: 64) } ... on Bot { login avatarUrl(size: 64) } ... on Team { slug avatarUrl(size: 64) } } } }`;
}

export function fullQuery(prs: { id: string; number: number }[]): string {
  const blocks = prs.map((pr, index) => `p${index}: node(id: ${literal(pr.id)}) { ... on PullRequest { ${fullFields(pr.number)} } }`);
  return `query { ${blocks.join('\n')} ${RATE} }`;
}

export const SEARCH_PRS_QUERY =
  `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 50, after: $after) { pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { ${LEAN_FIELDS} } } } ${RATE} }`;

export const ACTIVITY_QUERY =
  `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { repository { name } } } } ${RATE} }`;

export const VIEWER_QUERY = `query { viewer { login name avatarUrl(size: 64) } ${RATE} }`;

export const VIEWER_ORGS_QUERY = `query { viewer { organizations(first: 100) { nodes { login } } } ${RATE} }`;

export const TEAMS_QUERY =
  `query($org: String!, $login: String!) { organization(login: $org) { teams(first: 50, userLogins: [$login]) { nodes { slug avatarUrl(size: 64) } } } ${RATE} }`;

export const REPO_SEARCH_QUERY = `query($q: String!) { search(query: $q, type: REPOSITORY, first: 20) { nodes { ... on Repository { name } } } ${RATE} }`;

export function openCountsQuery(org: string, repos: string[]): string {
  const blocks = repos.map((repo, index) => `c${index}: repository(owner: ${literal(org)}, name: ${literal(repo)}) { pullRequests(states: OPEN) { totalCount } }`);
  return `query { ${blocks.join('\n')} ${RATE} }`;
}

export const NATIVE_STACK_QUERY =
  `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { stack { number baseRefName entries(first: 100) { nodes { position pullRequest { number title state } } } } } } ${RATE} }`;

export function mineSearch(org: string, kind: 'authored' | 'review-requested' | 'team-review-requested', team?: string): string {
  if (kind === 'team-review-requested' && !team) throw new Error('A team is required for team-review-requested searches.');
  const base = `is:pr is:open archived:false org:${org}`;
  if (kind === 'authored') return `${base} author:@me`;
  // user-review-requested excludes team requests, which have their own section.
  if (kind === 'review-requested') return `${base} user-review-requested:@me`;
  return `${base} team-review-requested:${org}/${team}`;
}
