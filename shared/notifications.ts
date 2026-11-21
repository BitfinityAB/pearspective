import { bucketOf, signalsOf } from './status';
import type { ChangeRequest, NotificationBatch, NotificationEvent, NotificationItem, NotificationKind, Person, Snapshot } from './types';

/** More items than this in one batch are shown as a single summary. */
export const SUMMARY_THRESHOLD = 3;
const THREAD_PLACEHOLDER = 'more-threads-not-loaded';
const SNIPPET_LENGTH = 80;

const LABELS: Record<NotificationKind, string> = {
  ciFailed: 'CI failed', ciPassed: 'CI passed', approved: 'approved', changesRequested: 'changes requested',
  readyToMerge: 'ready to merge', conflict: 'new conflict', newComment: 'new comment', newThread: 'new thread',
  reviewRequested: 'review requested',
};

export const describeEvent = (event: NotificationEvent): string => event.detail ?? LABELS[event.kind];
export const describeItem = (item: NotificationItem): string => item.events.map(describeEvent).join(' · ');

const nameOf = (person: Person) => person.name ?? person.login;
const ciColor = (pr: ChangeRequest) => signalsOf(pr).find((signal) => signal.key === 'ci')?.color ?? 'grey';
const quote = (text: string) => `'${text.slice(0, SNIPPET_LENGTH)}'`;

function prEvents(before: ChangeRequest, after: ChangeRequest, viewerLogin: string): NotificationEvent[] {
  const events: NotificationEvent[] = [];
  const [ciBefore, ciAfter] = [ciColor(before), ciColor(after)];
  if (ciAfter === 'red' && ciBefore !== 'red') events.push({ kind: 'ciFailed' });
  if (ciAfter === 'green' && (ciBefore === 'amber' || ciBefore === 'red')) events.push({ kind: 'ciPassed' });
  if (after.reviewDecision === 'approved' && before.reviewDecision !== 'approved') events.push({ kind: 'approved' });
  if (after.reviewDecision === 'changes_requested' && before.reviewDecision !== 'changes_requested') events.push({ kind: 'changesRequested' });
  // While the provider is still computing mergeability, neither state is trustworthy.
  const mergeKnown = before.mergeState !== 'unknown' && after.mergeState !== 'unknown';
  if (mergeKnown && bucketOf(after) === 'ready' && bucketOf(before) !== 'ready') events.push({ kind: 'readyToMerge' });
  if (mergeKnown && after.mergeState === 'conflicts' && before.mergeState !== 'conflicts') events.push({ kind: 'conflict' });

  const comment = after.lastComment;
  // Bots and code-analysis tools comment on every push, which would drown out people.
  if (after.commentCount > before.commentCount && comment && comment.author.login !== viewerLogin
    && comment.author.kind !== 'bot' && comment.author.kind !== 'code-analysis') {
    events.push({ kind: 'newComment', detail: `new comment by ${nameOf(comment.author)}: ${quote(comment.snippet)}` });
  }

  const known = new Set(before.threads.map((thread) => thread.url));
  const byAuthor = new Map<string, { name: string; snippets: string[] }>();
  for (const thread of after.threads) {
    if (known.has(thread.url) || thread.author.login === THREAD_PLACEHOLDER || thread.author.login === viewerLogin) continue;
    const entry = byAuthor.get(thread.author.login) ?? { name: nameOf(thread.author), snippets: [] };
    entry.snippets.push(thread.snippet);
    byAuthor.set(thread.author.login, entry);
  }
  for (const { name, snippets } of byAuthor.values()) {
    events.push({ kind: 'newThread', detail: snippets.length === 1 ? `new thread by ${name}: ${quote(snippets[0]!)}` : `${name}: ${snippets.length} new threads` });
  }
  return events;
}

export function notificationEvents(input: {
  previous: Snapshot | null;
  next: Snapshot;
  viewerLogin: string;
  enabled: Record<NotificationKind, boolean>;
  at: string;
}): NotificationBatch | null {
  const { previous, next, enabled } = input;
  if (!previous) return null;
  const before = new Map(previous.prs.map((pr) => [pr.id, pr]));
  const current = new Map(next.prs.map((pr) => [pr.id, pr]));
  const items = new Map<string, NotificationItem>();
  const add = (pr: ChangeRequest, events: NotificationEvent[]) => {
    const kept = events.filter((event) => enabled[event.kind]);
    if (kept.length === 0) return;
    const item = items.get(pr.id) ?? { prId: pr.id, repo: pr.repo, number: pr.number, title: pr.title, url: pr.url, events: [] };
    item.events.push(...kept);
    items.set(pr.id, item);
  };

  for (const id of next.mine.authored) {
    const after = current.get(id);
    const was = before.get(id);
    if (after && was) add(after, prEvents(was, after, input.viewerLogin));
  }
  const wasRequested = new Set([...previous.mine.requested, ...previous.mine.team]);
  for (const id of new Set([...next.mine.requested, ...next.mine.team])) {
    const pr = current.get(id);
    if (pr && !wasRequested.has(id)) add(pr, [{ kind: 'reviewRequested' }]);
  }
  return items.size ? { id: input.at, at: input.at, items: [...items.values()] } : null;
}
