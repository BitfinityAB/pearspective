import type { ChangeRequest, ChangeRequestStub, RepoRef, Ticket, Viewer } from '../../shared/types';

export type ProviderErrorKind = 'missing-cli' | 'auth' | 'rate-limit' | 'too-large' | 'failed';

export class ProviderError extends Error {
  /** `partial` carries what was fetched before the failure, so callers can still show it. */
  constructor(public readonly kind: ProviderErrorKind, message: string, public readonly partial?: ChangeRequest[]) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ReviewerClasses { 'ai-review': string[]; 'code-analysis': string[] }

export type AuthResult =
  | { ok: true; viewer: Viewer }
  | { ok: false; reason: 'missing-cli' | 'auth' | 'failed'; message: string };

export type MineKind = 'authored' | 'review-requested' | 'team-review-requested';

export interface NativeStackEntries {
  number: number;
  baseRefName: string;
  entries: { position: number; number: number; title: string; state: 'open' | 'merged' | 'closed' }[];
}

export interface CodeHostCapabilities {
  nativeStacks: boolean;
  requiredChecks: boolean;
  mergeability: boolean;
  draft: boolean;
  reviewThreads: boolean;
  teamReviewRequests: boolean;
}

export interface CodeHostProvider {
  readonly id: string;
  readonly host: string;
  readonly capabilities: CodeHostCapabilities;
  checkAuth(): Promise<AuthResult>;
  /** Taken from the most recent response; null until the first call. */
  lastRateLimit(): { remaining: number; resetAt: string } | null;
  listRepos(text: string): Promise<RepoRef[]>;
  rankReposByActivity(days: number): Promise<RepoRef[]>;
  openCounts(repos: string[]): Promise<Record<string, number>>;
  pollLean(repos: string[]): Promise<ChangeRequestStub[]>;
  fetchFull(stubs: ChangeRequestStub[]): Promise<ChangeRequest[]>;
  searchMine(kind: MineKind, team?: string): Promise<ChangeRequestStub[]>;
  nativeStackEntries(repo: string, number: number): Promise<NativeStackEntries | null>;
  compareRefs(repo: string, base: string, head: string): Promise<{ behindBy: number }>;
}

export type TrackerAuthResult =
  | { ok: true; login: string }
  | { ok: false; reason: 'missing-cli' | 'auth' | 'failed'; message: string };

export interface IssueTrackerProvider {
  readonly id: string;
  checkAuth(): Promise<TrackerAuthResult>;
  /** Keys that do not exist come back in notFound rather than failing the call. */
  getTickets(keys: string[]): Promise<{ tickets: Ticket[]; notFound: string[] }>;
  ticketUrl(key: string): string;
}
