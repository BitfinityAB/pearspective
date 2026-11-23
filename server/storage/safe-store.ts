import type { StatusCategory } from '../../shared/types';
import { Store, type RefreshWrite, type Selection, type StoredState, type TicketsWrite } from './store';

export type StoreLike = Pick<Store, 'load' | 'loadStatusCategories' | 'saveRefresh' | 'saveTickets' | 'saveStatusCategories' | 'close'>;

type WriteKind = 'refresh' | 'tickets' | 'categories';
type ProblemKind = WriteKind | 'read';

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\.$/, '');

/** The database is a cache: every failure becomes banner text and the server carries on in memory. */
export class SafeStore {
  // One slot per write kind, so a later success of another kind cannot hide a failure.
  private readonly problems: Record<ProblemKind, string | null> = { read: null, refresh: null, tickets: null, categories: null };

  constructor(private readonly store: StoreLike | null, private readonly openError: string | null = null) {}

  static open(path: string): SafeStore {
    try {
      return new SafeStore(Store.open(path));
    } catch (error) {
      console.error('Opening the local database failed:', error);
      return new SafeStore(null, reason(error));
    }
  }

  get error(): string | null {
    return this.openError ? `Local database unavailable: ${this.openError}. Data will load from GitHub on each start.` : Object.values(this.problems).find((message) => message !== null) ?? null;
  }

  load(selection: Selection): StoredState | null {
    if (!this.store) return null;
    try {
      const stored = this.store.load(selection);
      this.problems.read = null;
      return stored;
    } catch (error) {
      console.error('Reading the local database failed:', error);
      this.problems.read = `Local database unavailable: ${reason(error)}. Data will load from GitHub on each start.`;
      return null;
    }
  }

  loadStatusCategories(): Record<string, StatusCategory> {
    if (!this.store) return {};
    try {
      return this.store.loadStatusCategories();
    } catch (error) {
      console.error('Reading the local database failed:', error);
      return {};
    }
  }

  saveRefresh(write: RefreshWrite): void {
    this.write('refresh', () => this.store!.saveRefresh(write));
  }

  saveTickets(write: TicketsWrite): void {
    this.write('tickets', () => this.store!.saveTickets(write));
  }

  saveStatusCategories(categories: Record<string, StatusCategory>): void {
    this.write('categories', () => this.store!.saveStatusCategories(categories));
  }

  close(): void {
    try { this.store?.close(); } catch (error) { console.error('Closing the local database failed:', error); }
  }

  private write(kind: WriteKind, action: () => void): void {
    if (!this.store) return;
    try {
      action();
      this.problems[kind] = null;
    } catch (error) {
      console.error('Saving to the local database failed:', error);
      this.problems[kind] = `Saving to the local database failed: ${reason(error)}. The dashboard keeps working.`;
    }
  }
}
