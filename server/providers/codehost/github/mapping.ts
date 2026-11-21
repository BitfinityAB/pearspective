import type { ActorKind, ChangeRequest, ChangeRequestStub, Check, ClosedChangeRequest, MergeState, Person, Review, ReviewDecision, ReviewRequest, Thread } from '../../../../shared/types';
import type { ReviewerClasses } from '../../types';

const matches = (login: string, pattern: string) =>
  pattern.endsWith('*') ? login.startsWith(pattern.slice(0, -1)) : login === pattern;

export function classifyActor(login: string, typename: string, classes: ReviewerClasses): ActorKind {
  if (classes['ai-review'].some((pattern) => matches(login, pattern))) return 'ai-review';
  if (classes['code-analysis'].some((pattern) => matches(login, pattern))) return 'code-analysis';
  return typename === 'Bot' ? 'bot' : 'human';
}

function toPerson(raw: any, classes: ReviewerClasses): Person {
  if (!raw) return { login: 'ghost', kind: 'human' };
  const person: Person = { login: raw.login, kind: classifyActor(raw.login, raw.__typename ?? 'User', classes) };
  if (raw.name) person.name = raw.name;
  if (raw.avatarUrl) person.avatarUrl = raw.avatarUrl;
  return person;
}

function toMergeState(mergeable: string, status: string): MergeState {
  if (mergeable === 'CONFLICTING') return 'conflicts';
  switch (status) {
    case 'CLEAN': case 'HAS_HOOKS': return 'clean';
    case 'BLOCKED': case 'DRAFT': return 'blocked';
    case 'UNSTABLE': return 'unstable';
    case 'DIRTY': return 'conflicts';
    case 'BEHIND': return 'behind';
    default: return 'unknown';
  }
}

function toReviewDecision(decision: string | null): ReviewDecision {
  if (decision === 'APPROVED') return 'approved';
  if (decision === 'REVIEW_REQUIRED') return 'review_required';
  if (decision === 'CHANGES_REQUESTED') return 'changes_requested';
  return null;
}

const FAILED_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

function toCheck(raw: any): Check {
  if (raw.__typename === 'StatusContext') {
    const state = raw.state === 'SUCCESS' ? 'success' : raw.state === 'PENDING' || raw.state === 'EXPECTED' ? 'pending' : 'failure';
    return { name: raw.context, state, required: !!raw.isRequired, url: raw.targetUrl ?? undefined };
  }
  const state: Check['state'] =
    raw.status !== 'COMPLETED' ? 'pending'
    : raw.conclusion === 'SUCCESS' ? 'success'
    : FAILED_CONCLUSIONS.has(raw.conclusion) ? 'failure'
    : 'neutral';
  return { name: raw.name, state, required: !!raw.isRequired, url: raw.detailsUrl ?? undefined };
}

export function toClosed(raw: any, classes: ReviewerClasses): ClosedChangeRequest {
  return {
    id: raw.id,
    repo: raw.repository.name,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    merged: Boolean(raw.merged),
    closedAt: raw.closedAt,
    author: toPerson(raw.author, classes),
  };
}

const REVIEW_STATES: Record<string, Review['state']> = {
  APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested', COMMENTED: 'commented', DISMISSED: 'dismissed',
};

export function toStub(raw: any): ChangeRequestStub {
  const stub: ChangeRequestStub = {
    id: raw.id,
    repo: raw.repository.name,
    number: raw.number,
    updatedAt: raw.updatedAt,
    headSha: raw.headRefOid,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    isDraft: raw.isDraft,
  };
  if (raw.stack && raw.stackEntry) {
    stub.nativeStack = { number: raw.stack.number, size: raw.stack.size, position: raw.stackEntry.position, baseRefName: raw.stack.baseRefName };
  }
  return stub;
}

export function toChangeRequest(raw: any, classes: ReviewerClasses): ChangeRequest {
  const contextConnection = raw.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts;
  const contexts: any[] = contextConnection?.nodes ?? [];
  // A cut-off list could hide a failing required check; a pending marker keeps CI from looking falsely green.
  const truncationMarker: Check[] = contextConnection?.pageInfo?.hasNextPage ? [{ name: 'More checks not loaded', state: 'pending', required: false }] : [];
  const reviews: Review[] = (raw.reviews?.nodes ?? [])
    .filter((review: any) => REVIEW_STATES[review.state])
    .map((review: any) => ({ author: toPerson(review.author, classes), state: REVIEW_STATES[review.state]!, submittedAt: review.submittedAt }));
  const threads: Thread[] = (raw.reviewThreads?.nodes ?? []).map((thread: any) => {
    const first = thread.comments?.nodes?.[0];
    return { resolved: thread.isResolved, author: toPerson(first?.author, classes), snippet: (first?.bodyText ?? '').slice(0, 200), url: first?.url ?? raw.url };
  });
  // Same reason as the checks marker: hidden threads must not let Threads look resolved.
  // With last: 20, the cut-off older threads are the ones before the loaded page.
  if (raw.reviewThreads?.pageInfo?.hasPreviousPage) {
    threads.push({ resolved: false, author: { login: 'more-threads-not-loaded', kind: 'human' }, snippet: 'More review threads not loaded', url: raw.url });
  }
  const reviewRequests: ReviewRequest[] = (raw.reviewRequests?.nodes ?? [])
    .map((request: any) => request.requestedReviewer)
    .filter(Boolean)
    .map((reviewer: any): ReviewRequest =>
      reviewer.__typename === 'Team'
        ? { type: 'team', slug: reviewer.slug, avatarUrl: reviewer.avatarUrl }
        : { type: 'person', person: toPerson(reviewer, classes) });

  const newest = raw.lastComment?.nodes?.[0];
  const lastComment = newest ? { author: toPerson(newest.author, classes), snippet: (newest.bodyText ?? '').slice(0, 200), url: newest.url ?? raw.url } : undefined;

  return {
    ...toStub(raw),
    provider: 'github',
    title: raw.title,
    url: raw.url,
    author: toPerson(raw.author, classes),
    createdAt: raw.createdAt,
    mergeState: toMergeState(raw.mergeable, raw.mergeStateStatus),
    reviewDecision: toReviewDecision(raw.reviewDecision),
    checks: [...contexts.map(toCheck), ...truncationMarker],
    reviews,
    threads,
    reviewRequests,
    commentCount: raw.comments?.totalCount ?? 0,
    ...(lastComment ? { lastComment } : {}),
  };
}
