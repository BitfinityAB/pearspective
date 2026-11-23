import type { StatusCategory } from '../../shared/types';
import { Store, type RefreshWrite, type Selection, type StoredState, type TicketsWrite } from './store';

export type StoreLike = Pick<Store, 'load' | 'saveRefresh' | 'saveTickets' | 'saveStatusCategories' | 'close'>;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\.$/, '');

/** The database is a cache: every failure becomes banner text and the server carries on in memory. */
export class SafeStore {
  private problem: string | null = null;

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
    return this.openError ? `Local database unavailable: ${this.openError}. Data will load from GitHub on each start.` : this.problem;
  }

  load(selection: Selection): StoredState | null {
    if (!this.store) return null;
    try {
      return this.store.load(selection);
    } catch (error) {
      console.error('Reading the local database failed:', error);
      this.problem = `Local database unavailable: ${reason(error)}. Data will load from GitHub on each start.`;
      return null;
    }
  }

  saveRefresh(write: RefreshWrite): void {
    this.write(() => this.store!.saveRefresh(write));
  }

  saveTickets(write: TicketsWrite): void {
    this.write(() => this.store!.saveTickets(write));
  }

  saveStatusCategories(categories: Record<string, StatusCategory>): void {
    this.write(() => this.store!.saveStatusCategories(categories));
  }

  close(): void {
    try { this.store?.close(); } catch (error) { console.error('Closing the local database failed:', error); }
  }

  private write(action: () => void): void {
    if (!this.store) return;
    try {
      action();
      this.problem = null;
    } catch (error) {
      console.error('Saving to the local database failed:', error);
      this.problem = `Saving to the local database failed: ${reason(error)}. The dashboard keeps working.`;
    }
  }
}
