import type { RefreshSetting, RepoRef, Snapshot, StackDetail } from '../../../shared/types';

export interface DashboardApi {
  getSnapshot(): Promise<Snapshot>;
  subscribe(clientId: string, onSnapshot: (snapshot: Snapshot) => void, onOpen?: () => void): () => void;
  setVisible(clientId: string, visible: boolean): Promise<void>;
  refreshNow(): Promise<Snapshot>;
  updateSettings(patch: { refresh?: RefreshSetting; repos?: string[]; pinned?: string[] }): Promise<Snapshot['settings']>;
  searchRepos(q: string): Promise<RepoRef[]>;
  stackDetail(prId: string): Promise<StackDetail | null>;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function createHttpApi(base = ''): DashboardApi {
  return {
    getSnapshot: () => fetch(`${base}/api/snapshot`).then((response) => json<Snapshot>(response)),
    subscribe(clientId, onSnapshot, onOpen) {
      const source = new EventSource(`${base}/api/events?client=${encodeURIComponent(clientId)}`);
      source.addEventListener('snapshot', (event) => onSnapshot(JSON.parse((event as MessageEvent).data)));
      // Fires on every (re)connect; the server resets a client to visible each time.
      if (onOpen) source.addEventListener('open', onOpen);
      return () => source.close();
    },
    setVisible: async (clientId, visible) => {
      await fetch(`${base}/api/presence`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ client: clientId, visible }) });
    },
    refreshNow: () => fetch(`${base}/api/refresh`, { method: 'POST' }).then((response) => json<Snapshot>(response)),
    updateSettings: (patch) =>
      fetch(`${base}/api/settings`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) }).then((response) => json<Snapshot['settings']>(response)),
    searchRepos: (q) => fetch(`${base}/api/repos?q=${encodeURIComponent(q)}`).then((response) => json<RepoRef[]>(response)),
    async stackDetail(prId) {
      const response = await fetch(`${base}/api/stack?pr=${encodeURIComponent(prId)}`);
      return response.status === 404 ? null : json<StackDetail>(response);
    },
  };
}
