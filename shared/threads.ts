import type { Thread } from './types';

const PLACEHOLDER_LOGIN = 'more-threads-not-loaded';

/** Stands in for review threads that were not loaded, so the Threads signal never looks resolved by accident. */
export const truncatedThreadsPlaceholder = (url: string): Thread => ({
  resolved: false,
  author: { login: PLACEHOLDER_LOGIN, kind: 'human' },
  snippet: 'More review threads not loaded',
  url,
});

export const isTruncatedThreadsPlaceholder = (thread: Thread): boolean => thread.author.login === PLACEHOLDER_LOGIN;
