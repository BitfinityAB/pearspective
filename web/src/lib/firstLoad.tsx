import type { Snapshot } from '../../../shared/types';

/** No data yet and nothing has gone wrong: the first refresh is still running. */
export const isFirstLoad = (snapshot: Snapshot) => snapshot.fetchedAt === null && snapshot.banners.length === 0;

export const FirstLoadMessage = () => <p className="loading">Loading pull requests… the first load can take a minute.</p>;
