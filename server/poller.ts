import { emptySnapshot, type BannerMsg, type ChangeRequest, type ChangeRequestStub, type Snapshot, type Viewer } from '../shared/types';
import { buildTicketChecks } from '../shared/ticketChecks';
import { secondsToRefresh, type Config } from './config';
import { ProviderError, type CodeHostProvider } from './providers/types';
import type { TicketSync } from './ticket-sync';

export const FULL_SWEEP_MS = 15 * 60_000;
export const RATE_LIMIT_FLOOR = 500;

export interface PollerDeps {
  provider: CodeHostProvider;
  config: () => Config;
  now?: () => number;
  onChange?: (snapshot: Snapshot) => void;
  tickets?: TicketSync;
}

// CI completion does not bump updatedAt, so pending checks and unknown mergeability are re-read every tick.
function needsEnrichment(cached: ChangeRequest | undefined, stub: ChangeRequestStub): boolean {
  return !cached
    || cached.updatedAt !== stub.updatedAt
    || cached.headSha !== stub.headSha
    || cached.mergeState === 'unknown'
    || cached.checks.some((check) => check.state === 'pending');
}

const uniqueIds = (stubs: ChangeRequestStub[]) => [...new Set(stubs.map((stub) => stub.id))];

export class Poller {
  private cache = new Map<string, ChangeRequest>();
  private viewer: Viewer | null = null;
  private lastFullSweep = Number.NEGATIVE_INFINITY;
  private current: Snapshot;
  private inFlight: Promise<void> | null = null;
  private rerun: Promise<void> | null = null;
  private rerunFull = false;

  constructor(private readonly deps: PollerDeps) {
    this.current = emptySnapshot(deps.config().codeHost.org, deps.provider.host);
    this.refreshSettings(false);
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  snapshot(): Snapshot {
    return this.current;
  }

  /** Re-reads settings from config, e.g. after the settings panel saved, and pushes them to open tabs. */
  refreshSettings(notify = true): void {
    const config = this.deps.config();
    const tracker = config.issueTracker;
    this.publish({
      settings: {
        refresh: secondsToRefresh(config.refreshIntervalSec),
        repos: config.codeHost.repos,
        org: config.codeHost.org,
        host: this.deps.provider.host,
        ticketUrl: tracker?.provider === 'jira' ? `${tracker.baseUrl.replace(/\/$/, '')}/browse/{key}` : null,
        pinned: config.pinned,
        ticketsEnabled: Boolean(tracker),
      },
    }, notify);
  }

  backoffFactor(): number {
    const rate = this.current.rateLimit;
    return rate && rate.remaining < RATE_LIMIT_FLOOR ? 2 : 1;
  }

  /** A call during a running tick gets one follow-up run, so changes made meanwhile (e.g. saved settings) are not lost. */
  tick(opts: { full?: boolean } = {}): Promise<void> {
    if (!this.inFlight) return this.start(opts);
    this.rerunFull ||= !!opts.full;
    this.rerun ??= this.inFlight.catch(() => undefined).then(() => {
      const full = this.rerunFull;
      this.rerun = null;
      this.rerunFull = false;
      return this.inFlight ?? this.start({ full });
    });
    return this.rerun;
  }

  private start(opts: { full?: boolean }): Promise<void> {
    this.inFlight = this.run(opts).finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  private publish(patch: Partial<Snapshot>, notify = true) {
    this.current = { ...this.current, ...patch };
    if (notify) this.deps.onChange?.(this.current);
  }

  private async run({ full = false }: { full?: boolean }): Promise<void> {
    const { provider } = this.deps;
    const config = this.deps.config();
    const now = this.now();
    try {
      if (!this.viewer) {
        const auth = await provider.checkAuth();
        if (!auth.ok) {
          this.publish({ banners: [{ kind: auth.reason === 'missing-cli' ? 'missing-cli' : 'auth', message: auth.message }], stale: this.cache.size > 0 });
          return;
        }
        this.viewer = auth.viewer;
      }

      const repos = config.codeHost.repos.filter((repo) => !config.codeHost.excludeRepos.includes(repo));
      const teams = config.codeHost.teams.length ? config.codeHost.teams : this.viewer.teams.map((team) => team.slug);
      const overview = await provider.pollLean(repos);
      const authored = await provider.searchMine('authored');
      const requested = await provider.searchMine('review-requested');
      const team = (await Promise.all(teams.map((slug) => provider.searchMine('team-review-requested', slug)))).flat();

      const stubs = new Map([...overview, ...authored, ...requested, ...team].map((stub) => [stub.id, stub]));
      const sweep = full || now - this.lastFullSweep >= FULL_SWEEP_MS;
      const toFetch = [...stubs.values()].filter((stub) => sweep || needsEnrichment(this.cache.get(stub.id), stub));
      let fetchFailure: ProviderError | null = null;
      let fetched: ChangeRequest[];
      try {
        fetched = await provider.fetchFull(toFetch);
      } catch (error) {
        // Showing the PRs that did load beats an empty board while the rest is retried.
        if (!(error instanceof ProviderError) || !error.partial || error.kind === 'auth' || error.kind === 'missing-cli') throw error;
        fetchFailure = error;
        fetched = error.partial;
      }
      const fresh = new Map(fetched.map((pr) => [pr.id, pr]));

      const next = new Map<string, ChangeRequest>();
      for (const id of stubs.keys()) {
        const pr = fresh.get(id) ?? this.cache.get(id);
        if (pr) next.set(id, pr);
      }
      this.cache = next;
      if (sweep && !fetchFailure) this.lastFullSweep = now;

      const rateLimit = provider.lastRateLimit();
      const banners: BannerMsg[] = [];
      if (rateLimit && rateLimit.remaining < RATE_LIMIT_FLOOR) {
        banners.push({ kind: 'rate-limit', message: `API budget is low (${rateLimit.remaining} left until ${new Date(rateLimit.resetAt).toLocaleTimeString()}). Refreshing half as often.` });
      }
      let ticketPatch: Partial<Snapshot> = {};
      const trackerConfig = config.issueTracker;
      if (this.deps.tickets && trackerConfig) {
        const open = [...next.values()];
        const ticketState = await this.deps.tickets.sync({ open, repos, config: trackerConfig });
        ticketPatch = {
          tickets: ticketState.tickets,
          closed: ticketState.closed,
          ticketChecks: buildTicketChecks({ open, closed: ticketState.closed, tickets: ticketState.tickets, rules: trackerConfig, now }),
        };
        if (ticketState.banner) banners.push(ticketState.banner);
      }
      const known = (list: ChangeRequestStub[]) => uniqueIds(list).filter((id) => next.has(id));
      const outcome: Partial<Snapshot> = fetchFailure
        ? { stale: true, banners: [this.failureBanner(fetchFailure.message)] }
        : { fetchedAt: new Date(now).toISOString(), stale: false, banners };
      this.publish({
        viewer: this.viewer,
        prs: [...next.values()],
        overviewIds: known(overview),
        mine: { authored: known(authored), requested: known(requested), team: known(team) },
        rateLimit,
        ...ticketPatch,
        ...outcome,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ProviderError && (error.kind === 'auth' || error.kind === 'missing-cli')) {
        this.viewer = null;
        this.publish({ stale: this.cache.size > 0, banners: [{ kind: error.kind, message }] });
        return;
      }
      this.publish({ stale: true, banners: [this.failureBanner(message)] });
    }
  }

  private failureBanner(message: string): BannerMsg {
    const since = this.current.fetchedAt ? ` Showing data from ${new Date(this.current.fetchedAt).toLocaleTimeString()}.` : '';
    return { kind: 'stale', message: `Last refresh failed: ${message}.${since}` };
  }
}
