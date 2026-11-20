import { ticketKeyOf } from '../shared/tickets';
import type { BannerMsg, ChangeRequest, ClosedChangeRequest, Ticket } from '../shared/types';
import type { IssueTrackerConfig } from './config';
import { ProviderError, type CodeHostProvider, type IssueTrackerProvider } from './providers/types';

export interface TicketSyncDeps {
  tracker: IssueTrackerProvider;
  codeHost: CodeHostProvider;
  now: () => number;
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
  private lastSuccess: number | null = null;
  private banner: BannerMsg | null = null;
  private authed = false;

  constructor(private readonly deps: TicketSyncDeps) {}

  async sync(input: { open: ChangeRequest[]; repos: string[]; config: IssueTrackerConfig }): Promise<TicketState> {
    const now = this.deps.now();
    const due = now - this.lastRefresh >= input.config.refreshIntervalSec * 1000;
    // After a failure, wait for the next refresh instead of retrying on every tick.
    if (!due && this.banner) return this.state();
    try {
      if (due) {
        const since = new Date(now - input.config.closedLookbackDays * 86_400_000).toISOString();
        this.closed = await this.deps.codeHost.fetchClosed(input.repos, since);
      }
      const keys = [...new Set([...input.open, ...this.closed].map((pr) => ticketKeyOf(pr)).filter((key): key is string => !!key))]
        .filter((key) => !this.notTickets.has(key));
      const wanted = due ? keys : keys.filter((key) => !this.tickets.has(key));
      if (due) this.lastRefresh = now;
      if (wanted.length === 0) return this.state();
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
      if (due) for (const key of [...this.tickets.keys()]) if (!keys.includes(key)) this.tickets.delete(key);
      result.tickets.forEach((ticket) => this.tickets.set(ticket.key, ticket));
      this.lastSuccess = now;
      this.banner = null;
    } catch (error) {
      if (error instanceof ProviderError && (error.kind === 'auth' || error.kind === 'missing-cli')) this.authed = false;
      // The banner shows one line; the full error helps diagnose tracker or CLI changes.
      console.error('Ticket refresh failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      const age = this.lastSuccess === null ? '' : ` Showing ticket status from ${Math.round((now - this.lastSuccess) / 60_000)} min ago.`;
      this.banner = { kind: 'tickets', message: `Ticket refresh failed: ${message}.${age}` };
      this.lastRefresh = now;
    }
    return this.state();
  }

  private state(): TicketState {
    return { tickets: Object.fromEntries(this.tickets), closed: this.closed, banner: this.banner };
  }
}
