export type SignalColor = 'green' | 'amber' | 'red' | 'grey';
export type MergeState = 'clean' | 'blocked' | 'unstable' | 'conflicts' | 'behind' | 'unknown';
export type ReviewDecision = 'approved' | 'review_required' | 'changes_requested' | null;
export type ActorKind = 'human' | 'ai-review' | 'code-analysis' | 'bot';

export interface Person {
  login: string;
  name?: string;
  kind: ActorKind;
  avatarUrl?: string;
}

export interface Check {
  name: string;
  state: 'success' | 'pending' | 'failure' | 'neutral';
  required: boolean;
  url?: string;
}

export interface Review {
  author: Person;
  state: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
  submittedAt: string;
}

export interface Thread {
  resolved: boolean;
  author: Person;
  snippet: string;
  url: string;
}

export type ReviewRequest =
  | { type: 'person'; person: Person }
  | { type: 'team'; slug: string; avatarUrl?: string };

export interface NativeStackRef {
  number: number;
  size: number;
  position: number;
  baseRefName: string;
}

/** What the cheap poll returns: enough to detect changes and stacks. */
export interface ChangeRequestStub {
  id: string;
  repo: string;
  number: number;
  updatedAt: string;
  headSha: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  nativeStack?: NativeStackRef;
}

export interface ChangeRequest extends ChangeRequestStub {
  provider: string;
  title: string;
  url: string;
  author: Person;
  createdAt: string;
  mergeState: MergeState;
  reviewDecision: ReviewDecision;
  checks: Check[];
  reviews: Review[];
  threads: Thread[];
  reviewRequests: ReviewRequest[];
  commentCount: number;
}

export interface Team {
  slug: string;
  avatarUrl?: string;
}

export interface Viewer {
  login: string;
  name?: string;
  avatarUrl?: string;
  teams: Team[];
}

export const REFRESH_OPTIONS = ['off', 3, 5, 10, 15, 30] as const;
export type RefreshSetting = (typeof REFRESH_OPTIONS)[number];
export const MAX_REPOS = 10;
export const MAX_PINNED = 200;

export interface BannerMsg {
  kind: 'missing-cli' | 'auth' | 'rate-limit' | 'stale' | 'tickets';
  message: string;
}

export interface Snapshot {
  viewer: Viewer | null;
  prs: ChangeRequest[];
  overviewIds: string[];
  mine: { authored: string[]; requested: string[]; team: string[] };
  fetchedAt: string | null;
  stale: boolean;
  banners: BannerMsg[];
  rateLimit: { remaining: number; resetAt: string } | null;
  tickets: Record<string, Ticket>;
  closed: ClosedChangeRequest[];
  ticketChecks: Record<string, TicketCheck>;
  /** ticketUrl is a template with {key}, or null when no issue tracker is configured. */
  /** pinned holds change request ids that sort first in their lane. */
  settings: { refresh: RefreshSetting; repos: string[]; org: string; host: string; ticketUrl: string | null; pinned: string[]; ticketsEnabled: boolean };
}

export interface StackEntryDetail {
  number: number;
  title: string;
  state: 'open' | 'merged' | 'closed';
  position?: number;
  /** The open PR this one is stacked on; absent when it sits on the base branch or a merged entry. */
  parentNumber?: number;
  /** Commits this entry's branch is behind its parent's branch. */
  behindParent?: number;
}

export interface StackDetail {
  repo: string;
  native: boolean;
  number?: number;
  baseRefName: string;
  entries: StackEntryDetail[];
}

export type StatusCategory = 'todo' | 'inProgress' | 'done';

export interface Ticket {
  key: string;
  summary: string;
  type: string;
  /** category is null until the tracker has reported which category the status name belongs to. */
  status: { name: string; category: StatusCategory | null };
  assignee?: Person;
  url: string;
}

/** A PR merged or closed recently; kept only to judge its ticket. */
export interface ClosedChangeRequest {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  merged: boolean;
  closedAt: string;
  author: Person;
}

export type PrState = 'draft' | 'open' | 'merged' | 'abandoned';
export type Verdict = 'ok' | 'mismatch' | 'review' | 'grace' | 'unknown';

export interface TicketCheck {
  key: string;
  /** null when no PR counts for the ticket. */
  prState: PrState | null;
  verdict: Verdict;
  reason: string;
  /** Human-readable expected statuses, e.g. "Ready for Test or Done"; empty when nothing is expected. */
  expected: string;
  since: string | null;
}

export interface RepoRef {
  name: string;
  openCount?: number;
  activity?: number;
  cloned?: boolean;
}

export function emptySnapshot(org = '', host = 'github.com'): Snapshot {
  return {
    viewer: null,
    prs: [],
    overviewIds: [],
    mine: { authored: [], requested: [], team: [] },
    fetchedAt: null,
    stale: false,
    banners: [],
    rateLimit: null,
    tickets: {},
    closed: [],
    ticketChecks: {},
    settings: { refresh: 3, repos: [], org, host, ticketUrl: null, pinned: [], ticketsEnabled: false },
  };
}
