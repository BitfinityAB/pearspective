import type { ResolvedTheme } from './themeResolve';
import type { ThemeMode } from './themeTokens';
import { NO_REVIEWERS, type ReviewerViews } from './reviewers';
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
  /** The newest conversation comment, used to tell who wrote a new comment. */
  lastComment?: { author: Person; snippet: string; url: string };
}

export interface Team {
  slug: string;
  avatarUrl?: string;
}

/** A team in the org and the logins of its direct members. */
export interface OrgTeam {
  slug: string;
  name: string;
  avatarUrl?: string;
  members: string[];
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
  kind: 'missing-cli' | 'auth' | 'rate-limit' | 'stale' | 'tickets' | 'database' | 'teams';
  message: string;
}

export interface Snapshot {
  viewer: Viewer | null;
  prs: ChangeRequest[];
  overviewIds: string[];
  mine: { authored: string[]; requested: string[]; team: string[] };
  fetchedAt: string | null;
  stale: boolean;
  /** True while the board shows data from the local database and this run's first refresh has not finished. */
  fromStore: boolean;
  banners: BannerMsg[];
  rateLimit: { remaining: number; resetAt: string } | null;
  tickets: Record<string, Ticket>;
  closed: ClosedChangeRequest[];
  ticketChecks: Record<string, TicketCheck>;
  notification: NotificationBatch | null;
  /** ticketUrl is a template with {key}, or null when no issue tracker is configured. */
  /** pinned holds change request ids that sort first in their lane. */
  settings: { refresh: RefreshSetting; repos: string[]; org: string; host: string; ticketUrl: string | null; pinned: string[]; ticketsEnabled: boolean; notifications: NotificationSettings; theme: string; reviewers: ReviewerViews };
  /** Bumped when theme files change on disk, so open tabs refetch the theme list. */
  themes: { version: number };
  /** Every team the viewer can see, for grouping by team; null until loaded or when the code host has no teams. */
  orgTeams: OrgTeam[] | null;
}

export interface ThemeInfo {
  id: string;
  name: string;
  modes: ThemeMode[];
  source: 'builtin' | 'user';
  valid: boolean;
  error?: string;
  warnings: string[];
  theme?: ResolvedTheme;
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
  /** Created by, or assigned now or earlier to, the viewer; null when the tracker could not tell. */
  mine?: boolean | null;
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
/** skipped: every PR of the ticket goes into an ignored base branch, so there is nothing to judge. */
export type Verdict = 'ok' | 'mismatch' | 'review' | 'grace' | 'unknown' | 'skipped';

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

export type NotificationKind =
  | 'ciFailed' | 'ciPassed' | 'approved' | 'changesRequested'
  | 'readyToMerge' | 'conflict' | 'newComment' | 'newThread' | 'reviewRequested';

export const NOTIFICATION_KINDS: NotificationKind[] = [
  'ciFailed', 'ciPassed', 'approved', 'changesRequested', 'readyToMerge', 'conflict', 'newComment', 'newThread', 'reviewRequested',
];

export const NOTIFICATION_DEFAULTS: Record<NotificationKind, boolean> = {
  ciFailed: true, ciPassed: true, approved: true, changesRequested: true,
  readyToMerge: true, conflict: true, newComment: true, newThread: true, reviewRequested: false,
};

export interface NotificationEvent { kind: NotificationKind; detail?: string }
export interface NotificationItem { prId: string; repo: string; number: number; title: string; url: string; events: NotificationEvent[] }
/** id and at are the refresh time (ISO), so later batches compare greater. */
export interface NotificationBatch { id: string; at: string; items: NotificationItem[] }
export interface NotificationSettings { enabled: boolean; events: Record<NotificationKind, boolean> }

export function emptySnapshot(org = '', host = 'github.com'): Snapshot {
  return {
    viewer: null,
    prs: [],
    overviewIds: [],
    mine: { authored: [], requested: [], team: [] },
    fetchedAt: null,
    stale: false,
    fromStore: false,
    banners: [],
    rateLimit: null,
    tickets: {},
    closed: [],
    ticketChecks: {},
    notification: null,
    settings: { refresh: 3, repos: [], org, host, ticketUrl: null, pinned: [], ticketsEnabled: false, notifications: { enabled: false, events: { ...NOTIFICATION_DEFAULTS } }, theme: 'default', reviewers: NO_REVIEWERS },
    themes: { version: 0 },
    orgTeams: null,
  };
}
