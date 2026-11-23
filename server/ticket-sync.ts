import { prTicketKey } from '../shared/tickets';
import type { BannerMsg, ChangeRequest, ClosedChangeRequest, Ticket } from '../shared/types';
import type { IssueTrackerConfig } from './config';
import type { SafeStore } from './storage/safe-store';
import type { StoredState } from './storage/store';
import { ProviderError, type CodeHostProvider, type IssueTrackerProvider } from './providers/types';

export interface TicketSyncDeps {
  tracker: IssueTrackerProvider;
  codeHost: CodeHostProvider;
  now: () => number;
  store?: SafeStore;
  stored?: StoredState | null;
}

export interface TicketState {
  tickets: Record<string, Ticket>;
  closed: ClosedChangeRequest[];
  banner: BannerMsg | null;
}

/** Runs on every poller tick but talks to the tracker only on its own, slower cadence or for new keys. */
export class TicketSync {
  private readonly tickets = new Map<string, Ticket>();
  private readonly notTickets = new Set<string>();
  private closed: ClosedChangeRequest[] = [];
  private lastRefresh = Number.NEGATIVE_INFINITY;
  private lastFullSuccess: number | null = null;
  // Keys the tracker answered neither way for; retried only on the next full refresh.
  private readonly unanswered = new Set<string>();
  private banner: BannerMsg | null = null;
  private authed = false;

  constructor(private readonly deps: TicketSyncDeps) {
    const stored = deps.stored;
    if (!stored) return;
    for (const [key, ticket] of Object.entries(stored.tickets)) this.tickets.set(key, ticket);
    stored.notTickets.forEach((key) => this.notTickets.add(key));
    this.closed = stored.closed;
    // The stored sync time decides whether the first sync after a restart is a full one.
    if (stored.ticketsSyncedAt) this.lastRefresh = this.lastFullSuccess = Date.parse(stored.ticketsSyncedAt);
  }

  async sync(input: { org: string; open: ChangeRequest[]; repos: string[]; config: IssueTrackerConfig }): Promise<TicketState> {
    const now = this.deps.now();
    const due = now - this.lastRefresh >= input.config.refreshIntervalSec * 1000;
    // After a failure, wait for the next refresh instead of retrying on every tick.
    if (!due && this.banner) return this.state();
    if (due) this.unanswered.clear();
    try {
      if (due) {
        const since = new Date(now - input.config.closedLookbackDays * 86_400_000).toISOString();
        try {
          this.closed = await this.deps.codeHost.fetchClosed(input.repos, since);
        } catch (error) {
          // Code host problems already surface through its own banners; tickets carry on with the last closed PRs.
          console.error('Fetching closed PRs failed:', error);
        }
      }
      const keys = [...new Set([...input.open, ...this.closed].map((pr) => prTicketKey(pr)).filter((key): key is string => !!key))]
        .filter((key) => !this.notTickets.has(key));
      const wanted = due ? keys : keys.filter((key) => !this.tickets.has(key) && !this.unanswered.has(key));
      if (due) this.lastRefresh = now;
      if (wanted.length === 0) {
        if (due) {
          this.lastFullSuccess = now;
          this.banner = null;
          this.persist({ org: input.org, now, due, upserted: [], removedKeys: [], notTickets: [] });
        }
        return this.state();
      }
      if (!this.authed) {
        const auth = await this.deps.tracker.checkAuth();
        if (!auth.ok) {
          this.banner = { kind: 'tickets', message: auth.reason === 'missing-cli' ? auth.message : `Ticket status unavailable: ${auth.message}` };
          this.lastRefresh = now;
          return this.state();
        }
        this.authed = true;
      }
      const result = await this.deps.tracker.getTickets(wanted);
      result.notFound.forEach((key) => this.notTickets.add(key));
      wanted.forEach((key) => this.unanswered.add(key));
      const removedKeys: string[] = [];
      if (due) {
        for (const key of [...this.tickets.keys()]) {
          if (keys.includes(key)) continue;
          this.tickets.delete(key);
          removedKeys.push(key);
        }
      }
      result.tickets.forEach((ticket) => this.tickets.set(ticket.key, ticket));
      this.persist({ org: input.org, now, due, upserted: result.tickets, removedKeys, notTickets: result.notFound });
      if (due) this.lastFullSuccess = now;
      this.banner = null;
    } catch (error) {
      if (error instanceof ProviderError && (error.kind === 'auth' || error.kind === 'missing-cli')) this.authed = false;
      // The banner shows one line; the full error helps diagnose tracker or CLI changes.
      console.error('Ticket refresh failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      const age = this.lastFullSuccess === null ? '' : ` Showing ticket status from ${Math.round((now - this.lastFullSuccess) / 60_000)} min ago.`;
      this.banner = { kind: 'tickets', message: `Ticket refresh failed: ${message}.${age}` };
      this.lastRefresh = now;
    }
    return this.state();
  }

  private persist(input: { org: string; now: number; due: boolean; upserted: Ticket[]; removedKeys: string[]; notTickets: string[] }): void {
    const store = this.deps.store;
    if (!store) return;
    const at = new Date(input.now).toISOString();
    store.saveTickets({
      org: input.org, provider: this.deps.codeHost.id, at,
      upserted: input.upserted, removedKeys: input.removedKeys, notTickets: input.notTickets,
      ...(input.due ? { closed: this.closed, syncedAt: at } : {}),
    });
    const categories = this.deps.tracker.statusCategories?.();
    if (categories) store.saveStatusCategories(categories);
  }

  private state(): TicketState {
    return { tickets: Object.fromEntries(this.tickets), closed: this.closed, banner: this.banner };
  }
}
