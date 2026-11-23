import { resolveDatabasePath, type Config } from '../config';
import { SafeStore } from './safe-store';
import type { StatusCategory } from '../../shared/types';
import type { StoredState } from './store';

/** Opens the local database and loads the state for the configured org and repositories. */
export function openStorage(config: Config, configPath: string): { store: SafeStore; stored: StoredState | null; statusCategories: Record<string, StatusCategory> } {
  const store = SafeStore.open(resolveDatabasePath(config, configPath));
  const repos = config.codeHost.repos.filter((repo) => !config.codeHost.excludeRepos.includes(repo));
  return { store, stored: store.load({ org: config.codeHost.org, repos }), statusCategories: store.loadStatusCategories() };
}
