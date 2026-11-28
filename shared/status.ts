import type { ReviewerView, ReviewerViews } from './reviewers';
import { isTruncatedThreadsPlaceholder } from './threads';
import type { ActorKind, ChangeRequest, Review, SignalColor } from './types';

export type SignalKey = 'ci' | 'aiReview' | 'codeAnalysis' | 'review' | 'threads' | 'mergeable';
export interface Signal { key: SignalKey; label: string; color: SignalColor; glyph: string; detail: string }
export interface Blocker { label: string; severity: 'red' | 'amber' | 'grey' }
export type Bucket = 'blocked' | 'waiting' | 'ready' | 'draft';

export const GLYPH: Record<SignalColor, string> = { green: '✓', amber: '!', red: '✕', grey: '–' };
export const SIGNAL_LABELS: Record<SignalKey, string> = {
  ci: 'CI', aiReview: 'AI review', codeAnalysis: 'Code analysis', review: 'Review', threads: 'Threads', mergeable: 'Mergeable',
};

const makeSignal = (key: SignalKey, color: SignalColor, detail: string, glyph = GLYPH[color]): Signal =>
  ({ key, label: SIGNAL_LABELS[key], color, glyph, detail });

const unresolvedBy = (pr: ChangeRequest, kind: ActorKind) =>
  pr.threads.filter((thread) => !thread.resolved && thread.author.kind === kind && !isTruncatedThreadsPlaceholder(thread)).length;
// Threads beyond the loaded page could be unresolved, so a cut-off list never reads as all clear.
const threadsCutOff = (pr: ChangeRequest) => pr.threads.some(isTruncatedThreadsPlaceholder);

/** Reviewers often review several times; only their newest review counts. */
function latestReviewPerAuthor(reviews: Review[], kind: ActorKind): Review[] {
  const latest = new Map<string, Review>();
  for (const review of reviews) {
    if (review.author.kind !== kind) continue;
    const previous = latest.get(review.author.login);
    if (!previous || previous.submittedAt < review.submittedAt) latest.set(review.author.login, review);
  }
  return [...latest.values()];
}

function ciSignal(pr: ChangeRequest): Signal {
  const checks = pr.checks;
  if (checks.length === 0) return makeSignal('ci', 'grey', 'No checks');
  const requiredFailures = checks.filter((check) => check.required && check.state === 'failure');
  if (requiredFailures.length) {
    return makeSignal('ci', 'red', `Required check failed: ${requiredFailures.map((check) => check.name).join(', ')}`);
  }
  const pending = checks.filter((check) => check.state === 'pending');
  const optionalFailures = checks.filter((check) => !check.required && check.state === 'failure');
  if (pending.length || optionalFailures.length) {
    const parts = [
      pending.length ? `${pending.length} running` : '',
      optionalFailures.length ? `Non-required failed: ${optionalFailures.map((check) => check.name).join(', ')}` : '',
    ].filter(Boolean);
    return makeSignal('ci', 'amber', parts.join('; '));
  }
  return makeSignal('ci', 'green', `All ${checks.length} checks passed`);
}

function aiReviewSignal(pr: ChangeRequest): Signal {
  const reviewed = pr.reviews.some((review) => review.author.kind === 'ai-review');
  const requested = pr.reviewRequests.some((request) => request.type === 'person' && request.person.kind === 'ai-review');
  const unresolved = unresolvedBy(pr, 'ai-review');
  if (!reviewed && !requested) return makeSignal('aiReview', 'grey', 'Not requested');
  if (!reviewed) return makeSignal('aiReview', 'amber', 'Requested, not reviewed yet');
  if (unresolved > 0) return makeSignal('aiReview', 'amber', `Reviewed, ${unresolved} unresolved`);
  return makeSignal('aiReview', 'green', 'Reviewed, all comments resolved');
}

function codeAnalysisSignal(pr: ChangeRequest): Signal {
  const latest = latestReviewPerAuthor(pr.reviews, 'code-analysis').sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)).at(-1);
  if (latest?.state === 'approved') return makeSignal('codeAnalysis', 'green', 'Approved');
  if (latest?.state === 'changes_requested') return makeSignal('codeAnalysis', 'red', 'Changes requested');
  return makeSignal('codeAnalysis', 'grey', 'No review');
}

export function reviewCounts(pr: ChangeRequest): { approved: number; changesRequested: number } {
  const latest = latestReviewPerAuthor(pr.reviews, 'human');
  return {
    approved: latest.filter((review) => review.state === 'approved').length,
    changesRequested: latest.filter((review) => review.state === 'changes_requested').length,
  };
}

function reviewSignal(pr: ChangeRequest): Signal {
  const { approved, changesRequested } = reviewCounts(pr);
  const counts = `✓${approved} ✗${changesRequested}`;
  switch (pr.reviewDecision) {
    case 'approved': return makeSignal('review', 'green', `Approved (${counts})`);
    case 'review_required': return makeSignal('review', 'amber', `Review required (${counts})`);
    case 'changes_requested': return makeSignal('review', 'red', `Changes requested (${counts})`);
    default: return makeSignal('review', 'grey', 'No review required');
  }
}

function threadsSignal(pr: ChangeRequest, extra?: { count: number; name: string }): Signal {
  const people = unresolvedBy(pr, 'human');
  const unresolved = people + (extra?.count ?? 0);
  const cutOff = threadsCutOff(pr);
  const from = extra?.count ? ` (${extra.count} from ${extra.name})` : '';
  if (unresolved > 0) return makeSignal('threads', 'amber', `${unresolved} unresolved${from}${cutOff ? ', more not loaded' : ''}`, String(unresolved));
  return cutOff ? makeSignal('threads', 'amber', 'Not all threads loaded', '?') : makeSignal('threads', 'green', 'None unresolved');
}

function mergeableSignal(pr: ChangeRequest): Signal {
  switch (pr.mergeState) {
    case 'clean': return makeSignal('mergeable', 'green', 'Clean, can be merged');
    case 'blocked': return makeSignal('mergeable', 'amber', 'Blocked by branch protection');
    case 'unstable': return makeSignal('mergeable', 'amber', 'Non-required checks failing');
    case 'conflicts': return makeSignal('mergeable', 'red', 'Merge conflicts');
    case 'behind': return makeSignal('mergeable', 'red', 'Behind the base branch');
    default: return makeSignal('mergeable', 'grey', 'Checking…', '…');
  }
}

const isShown = (view: ReviewerView | null | undefined) => Boolean(view?.show);

/** Without reviewers every signal is returned with generic labels; with them, hidden or unconfigured tools are left out. */
export function signalsOf(pr: ChangeRequest, reviewers?: ReviewerViews): Signal[] {
  const ai = reviewers?.aiReview;
  // A hidden AI column would hide threads that can still block merging, so they move to Threads.
  const aiThreads = reviewers && ai && !ai.show ? { count: unresolvedBy(pr, 'ai-review'), name: ai.name } : undefined;
  const all = [ciSignal(pr), aiReviewSignal(pr), codeAnalysisSignal(pr), reviewSignal(pr), threadsSignal(pr, aiThreads), mergeableSignal(pr)];
  if (!reviewers) return all;
  return all
    .filter((signal) => (signal.key === 'aiReview' ? isShown(reviewers.aiReview) : signal.key === 'codeAnalysis' ? isShown(reviewers.codeAnalysis) : true))
    .map((signal) => (signal.key === 'aiReview' ? { ...signal, label: reviewers.aiReview!.name } : signal.key === 'codeAnalysis' ? { ...signal, label: reviewers.codeAnalysis!.name } : signal));
}

export function blockersOf(pr: ChangeRequest): Blocker[] {
  const blockers: Blocker[] = [];
  if (pr.isDraft) blockers.push({ label: 'Draft', severity: 'grey' });
  if (pr.mergeState === 'conflicts') blockers.push({ label: 'Conflicts', severity: 'red' });
  if (pr.mergeState === 'behind') blockers.push({ label: 'Behind base', severity: 'red' });
  if (pr.checks.some((check) => check.required && check.state === 'failure')) blockers.push({ label: 'Required check failed', severity: 'red' });
  if (pr.reviewDecision === 'changes_requested') blockers.push({ label: 'Changes requested', severity: 'red' });
  const unresolved = unresolvedBy(pr, 'human');
  if (unresolved > 0) blockers.push({ label: `${unresolved} unresolved thread${unresolved === 1 ? '' : 's'}`, severity: 'red' });
  if (unresolved === 0 && threadsCutOff(pr)) blockers.push({ label: 'Not all threads loaded', severity: 'amber' });
  if (pr.reviewDecision === 'review_required') blockers.push({ label: 'Needs approval', severity: 'amber' });
  return blockers;
}

export function bucketOf(pr: ChangeRequest): Bucket {
  if (pr.isDraft) return 'draft';
  if (blockersOf(pr).some((blocker) => blocker.severity === 'red')) return 'blocked';
  const checksRunning = pr.checks.some((check) => check.state === 'pending');
  if (pr.reviewDecision === 'review_required' || checksRunning || pr.mergeState === 'unknown' || threadsCutOff(pr)) return 'waiting';
  return 'ready';
}
