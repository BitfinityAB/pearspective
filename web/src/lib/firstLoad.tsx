import type { Snapshot } from '../../../shared/types';

/** No data yet and nothing has gone wrong: the first refresh is still running. A database problem does not count, as the refresh still runs. */
export const isFirstLoad = (snapshot: Snapshot) => snapshot.fetchedAt === null && snapshot.banners.every((banner) => banner.kind === 'database');

export const FirstLoadMessage = () => <p className="loading">Loading pull requests… the first load can take a minute.</p>;
