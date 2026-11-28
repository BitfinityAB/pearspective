import type { ChangeRequest, ChangeRequestStub, ClosedChangeRequest, OrgTeam, RepoRef } from '../../../../shared/types';
import type { GhClient } from '../../../gh';
import { ProviderError, type AuthResult, type CodeHostProvider, type MineKind, type NativeStackEntries, type ReviewerClasses } from '../../types';
import { toChangeRequest, toClosed, toStub } from './mapping';
import {
  ACTIVITY_QUERY, closedReposQuery, fullQuery, leanRepoPageQuery, leanReposQuery, mineSearch, NATIVE_STACK_QUERY,
  openCountsQuery, ORG_TEAMS_QUERY, REPO_SEARCH_QUERY, REVIEWING_BOTS_QUERY, SEARCH_PRS_QUERY, TEAM_MEMBERS_PAGE_QUERY, TEAMS_QUERY, VIEWER_ORGS_QUERY, VIEWER_QUERY,
} from './queries';

export const ENRICH_BATCH_SIZE = 25;
/** Enough parallelism to cut a cold start a lot without hammering GitHub's secondary rate limits. */
export const ENRICH_CONCURRENCY = 3;
const MAX_SEARCH_PAGES = 4;
const MAX_EXTRA_REPO_PAGES = 20;
const MAX_TEAM_PAGES = 20;

type RateLimitRaw = { remaining: number; resetAt: string };
type Page<T> = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] };
type TeamNode = { id: string; slug: string; name: string; avatarUrl?: string; members: Page<{ login: string }> };

/** Organisations the logged-in gh user belongs to; setup offers one before an org is chosen. */
export async function viewerOrganizations(gh: GhClient): Promise<string[]> {
  const data = await gh.graphql<{ viewer: { organizations: { nodes: { login: string }[] } } }>(VIEWER_ORGS_QUERY);
  return data.viewer.organizations.nodes.map((org) => org.login);
}

export class GithubProvider implements CodeHostProvider {
  readonly id = 'github';
  readonly host = 'github.com';
  readonly capabilities = { nativeStacks: true, requiredChecks: true, mergeability: true, draft: true, reviewThreads: true, teamReviewRequests: true };
  private rate: RateLimitRaw | null = null;
  private batchSize = ENRICH_BATCH_SIZE;

  constructor(private readonly gh: GhClient, private readonly org: string, private readonly classes: ReviewerClasses) {}

  private async query<T>(query: string, variables?: Record<string, unknown>): Promise<T & { rateLimit?: RateLimitRaw }> {
    const data = await this.gh.graphql<T & { rateLimit?: RateLimitRaw }>(query, variables);
    if (data?.rateLimit) this.rate = { remaining: data.rateLimit.remaining, resetAt: data.rateLimit.resetAt };
    return data;
  }

  lastRateLimit() {
    return this.rate;
  }

  async checkAuth(): Promise<AuthResult> {
    try {
      const { viewer } = await this.query<{ viewer: { login: string; name?: string | null; avatarUrl?: string } }>(VIEWER_QUERY);
      const teams = await this.query<{ organization: { teams: { nodes: { slug: string; avatarUrl?: string }[] } } | null }>(TEAMS_QUERY, { org: this.org, login: viewer.login });
      return {
        ok: true,
        viewer: {
          login: viewer.login,
          ...(viewer.name ? { name: viewer.name } : {}),
          avatarUrl: viewer.avatarUrl,
          teams: teams.organization?.teams.nodes ?? [],
        },
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        const reason = error.kind === 'missing-cli' || error.kind === 'auth' ? error.kind : 'failed';
        return { ok: false, reason, message: error.message };
      }
      throw error;
    }
  }

  async pollLean(repos: string[]): Promise<ChangeRequestStub[]> {
    if (repos.length === 0) return [];
    const data = await this.query<Record<string, any>>(leanReposQuery(this.org, repos));
    const stubs: ChangeRequestStub[] = [];
    for (const [index, repo] of repos.entries()) {
      let connection = data[`r${index}`]?.pullRequests;
      if (!connection) continue;
      stubs.push(...connection.nodes.map(toStub));
      // The cap and the cursor check stop a repeated or missing cursor from looping forever.
      for (let extra = 0; extra < MAX_EXTRA_REPO_PAGES && connection.pageInfo.hasNextPage && connection.pageInfo.endCursor; extra += 1) {
        const page = await this.query<Record<string, any>>(leanRepoPageQuery(this.org, repo, connection.pageInfo.endCursor));
        connection = page.r0?.pullRequests;
        if (!connection) break;
        stubs.push(...connection.nodes.map(toStub));
      }
    }
    return stubs;
  }

  async fetchClosed(repos: string[], since: string): Promise<ClosedChangeRequest[]> {
    if (repos.length === 0) return [];
    const data = await this.query<Record<string, any>>(closedReposQuery(this.org, repos));
    return repos
      .flatMap((_, index) => (data[`r${index}`]?.pullRequests?.nodes ?? []).map((raw: any) => toClosed(raw, this.classes)))
      .filter((pr) => pr.closedAt >= since);
  }

  async fetchFull(stubs: ChangeRequestStub[]): Promise<ChangeRequest[]> {
    const results: ChangeRequest[] = [];
    const queue: { stubs: ChangeRequestStub[]; size: number }[] = [];
    const cut = (list: ChangeRequestStub[]) => {
      const size = this.batchSize;
      const pieces = [];
      for (let start = 0; start < list.length; start += size) pieces.push({ stubs: list.slice(start, start + size), size });
      return pieces;
    };
    queue.push(...cut(stubs));
    let failure: unknown = null;

    const worker = async () => {
      for (let batch = queue.shift(); batch; batch = queue.shift()) {
        try {
          const data = await this.query<Record<string, any>>(fullQuery(batch.stubs));
          batch.stubs.forEach((_, position) => {
            const raw = data[`p${position}`];
            if (raw) results.push(toChangeRequest(raw, this.classes));
          });
        } catch (error) {
          if (error instanceof ProviderError && error.kind === 'too-large' && batch.size > 1) {
            // Halve from the size this batch was cut with, so parallel failures do not shrink it several times over.
            this.batchSize = Math.min(this.batchSize, Math.max(1, Math.floor(batch.size / 2)));
            queue.unshift(...cut(batch.stubs));
            continue;
          }
          failure ??= error;
          // More calls cannot succeed while rate-limited or logged out.
          if (!(error instanceof ProviderError) || error.kind !== 'failed') queue.length = 0;
        }
      }
    };
    await Promise.all(Array.from({ length: ENRICH_CONCURRENCY }, worker));

    if (failure) {
      const kind = failure instanceof ProviderError ? failure.kind : 'failed';
      throw new ProviderError(kind, failure instanceof Error ? failure.message : String(failure), results);
    }
    return results;
  }

  private async searchAll<T>(query: string, q: string, maxPages: number): Promise<T[]> {
    const nodes: T[] = [];
    let after: string | null = null;
    for (let page = 0; page < maxPages; page += 1) {
      const data: any = await this.query(query, { q, after });
      nodes.push(...data.search.nodes);
      if (!data.search.pageInfo?.hasNextPage) break;
      after = data.search.pageInfo.endCursor;
    }
    return nodes;
  }

  async searchMine(kind: MineKind, team?: string): Promise<ChangeRequestStub[]> {
    const nodes = await this.searchAll<any>(SEARCH_PRS_QUERY, mineSearch(this.org, kind, team), MAX_SEARCH_PAGES);
    return nodes.filter((node) => node?.id).map(toStub);
  }

  async teamMembers(): Promise<OrgTeam[]> {
    const teams: OrgTeam[] = [];
    let after: string | null = null;
    // The page caps and cursor checks stop a repeated or missing cursor from looping forever.
    for (let page = 0; page < MAX_TEAM_PAGES; page += 1) {
      const data: { organization: { teams: Page<TeamNode> } | null } = await this.query(ORG_TEAMS_QUERY, { org: this.org, after });
      const connection = data.organization?.teams;
      if (!connection) break;
      for (const node of connection.nodes) teams.push({ slug: node.slug, name: node.name, ...(node.avatarUrl ? { avatarUrl: node.avatarUrl } : {}), members: await this.allMembers(node) });
      if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) break;
      after = connection.pageInfo.endCursor;
    }
    return teams;
  }

  private async allMembers(team: TeamNode): Promise<string[]> {
    const logins = team.members.nodes.map((member) => member.login);
    let members = team.members;
    for (let page = 0; page < MAX_TEAM_PAGES && members.pageInfo.hasNextPage && members.pageInfo.endCursor; page += 1) {
      const data: { node: { members: Page<{ login: string }> } | null } = await this.query(TEAM_MEMBERS_PAGE_QUERY, { id: team.id, after: members.pageInfo.endCursor });
      if (!data.node) break;
      members = data.node.members;
      logins.push(...members.nodes.map((member) => member.login));
    }
    return logins;
  }

  async listRepos(text: string): Promise<RepoRef[]> {
    const data = await this.query<{ search: { nodes: { name?: string }[] } }>(REPO_SEARCH_QUERY, { q: `org:${this.org} archived:false ${text}`.trim() });
    return data.search.nodes.filter((node) => node.name).map((node) => ({ name: node.name! }));
  }

  async rankReposByActivity(days: number): Promise<RepoRef[]> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const counts = new Map<string, number>();
    for (const who of ['author:@me', 'reviewed-by:@me']) {
      const nodes = await this.searchAll<{ repository?: { name: string } }>(ACTIVITY_QUERY, `is:pr org:${this.org} ${who} updated:>=${since}`, 3);
      for (const node of nodes) if (node.repository) counts.set(node.repository.name, (counts.get(node.repository.name) ?? 0) + 1);
    }
    return [...counts].map(([name, activity]) => ({ name, activity })).sort((a, b) => b.activity - a.activity || a.name.localeCompare(b.name));
  }

  async openCounts(repos: string[]): Promise<Record<string, number>> {
    if (repos.length === 0) return {};
    const data = await this.query<Record<string, any>>(openCountsQuery(this.org, repos));
    return Object.fromEntries(repos.map((repo, index) => [repo, data[`c${index}`]?.pullRequests.totalCount ?? 0]));
  }

  /** Bots that reviewed, or were asked to review, recent PRs; setup uses it to suggest the AI reviewer and analysis tool. */
  async reviewingBots(repos: string[]): Promise<{ login: string; reviews: number }[]> {
    const q = ['is:pr', ...repos.map((repo) => `repo:${this.org}/${repo}`), 'sort:updated-desc'].join(' ');
    const data = await this.query<{ search: { nodes: any[] } }>(REVIEWING_BOTS_QUERY, { q });
    const counts = new Map<string, number>();
    for (const pr of data.search.nodes) {
      for (const review of pr.reviews?.nodes ?? []) {
        if (review.author?.__typename === 'Bot') counts.set(review.author.login, (counts.get(review.author.login) ?? 0) + 1);
      }
      for (const request of pr.reviewRequests?.nodes ?? []) {
        const reviewer = request.requestedReviewer;
        if (reviewer?.__typename === 'Bot' && !counts.has(reviewer.login)) counts.set(reviewer.login, 0);
      }
    }
    return [...counts].map(([login, reviews]) => ({ login, reviews })).sort((a, b) => b.reviews - a.reviews || a.login.localeCompare(b.login));
  }

  async nativeStackEntries(repo: string, number: number): Promise<NativeStackEntries | null> {
    const data = await this.query<any>(NATIVE_STACK_QUERY, { owner: this.org, name: repo, number });
    const stack = data.repository?.pullRequest?.stack;
    if (!stack) return null;
    return {
      number: stack.number,
      baseRefName: stack.baseRefName,
      entries: stack.entries.nodes.map((node: any) => ({
        position: node.position,
        number: node.pullRequest.number,
        title: node.pullRequest.title,
        state: node.pullRequest.state === 'MERGED' ? 'merged' : node.pullRequest.state === 'OPEN' ? 'open' : 'closed',
      })),
    };
  }

  async compareRefs(repo: string, base: string, head: string): Promise<{ behindBy: number }> {
    const data = await this.gh.rest<{ behind_by: number }>(`repos/${this.org}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
    return { behindBy: data.behind_by };
  }
}
