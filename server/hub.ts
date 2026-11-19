import type { Snapshot } from '../shared/types';

export class SnapshotHub {
  private listeners = new Set<(snapshot: Snapshot) => void>();

  subscribe(listener: (snapshot: Snapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(snapshot: Snapshot): void {
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
