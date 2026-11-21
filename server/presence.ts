import type { Poller } from './poller';

export class Presence {
  private clients = new Map<string, boolean>();
  private listeners = new Set<() => void>();

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  connect(clientId: string) {
    this.clients.set(clientId, true);
    this.emit();
  }

  disconnect(clientId: string) {
    this.clients.delete(clientId);
    this.emit();
  }

  setVisible(clientId: string, visible: boolean) {
    if (!this.clients.has(clientId)) return;
    this.clients.set(clientId, visible);
    this.emit();
  }

  anyVisible(): boolean {
    return [...this.clients.values()].some(Boolean);
  }

  anyConnected(): boolean {
    return this.clients.size > 0;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

interface PollLoopDeps {
  poller: Pick<Poller, 'tick' | 'snapshot' | 'backoffFactor'>;
  presence: Presence;
  intervalMs: () => number | null;
  hiddenIntervalMs?: () => number | null;
  now?: () => number;
}

/** Off mode retries a failed first load this often, so a broken setup does not spin. */
export const OFF_MODE_RETRY_MS = 60_000;

/** While tabs are open but hidden, polling slows to this so notifications still arrive. */
export const HIDDEN_POLL_MS = 300_000;

/** Polls while a tab is visible, and slowly while tabs are only hidden (when enabled); with no tab open it stays idle. */
export class PollLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private stopped = false;
  private lastAttemptAt: number | null = null;

  constructor(private readonly deps: PollLoopDeps) {}

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  start() {
    this.stopped = false;
    this.unsubscribe = this.deps.presence.onChange(() => this.reschedule());
    this.reschedule();
  }

  stop() {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // Failed ticks leave fetchedAt unchanged, so the attempt time is what paces retries.
  private attempt(): Promise<void> {
    this.lastAttemptAt = this.now();
    const hidden = !this.deps.presence.anyVisible();
    // The poller reports failures through its snapshot; a rejection must not end the loop.
    return this.deps.poller.tick({ hidden }).catch((error) => console.error('Poll tick failed:', error));
  }

  private async runTick() {
    try {
      await this.attempt();
    } finally {
      this.reschedule();
    }
  }

  reschedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped) return;
    const visible = this.deps.presence.anyVisible();
    const hidden = !visible && this.deps.presence.anyConnected() ? this.deps.hiddenIntervalMs?.() ?? null : null;
    if (!visible && hidden === null) return;
    const interval = visible ? this.deps.intervalMs() : hidden;
    const fetchedAt = this.deps.poller.snapshot().fetchedAt;
    const now = this.now();
    if (interval === null) {
      // With auto-refresh off the dashboard still needs one load to show anything.
      const retryDue = this.lastAttemptAt === null || now - this.lastAttemptAt >= OFF_MODE_RETRY_MS;
      if (!fetchedAt && retryDue) this.timer = setTimeout(() => void this.runTick(), 0);
      return;
    }
    const effective = interval * this.deps.poller.backoffFactor();
    const lastFetch = fetchedAt ? Date.parse(fetchedAt) : 0;
    const last = Math.max(lastFetch, this.lastAttemptAt ?? 0);
    const delay = Math.max(0, last + effective - now);
    this.timer = setTimeout(() => void this.runTick(), delay);
  }
}
