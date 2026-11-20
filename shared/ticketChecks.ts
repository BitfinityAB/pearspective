import { ageLabel } from './age';
import { ticketKeyOf } from './tickets';
import type { ChangeRequest, ClosedChangeRequest, PrState, StatusCategory, Ticket, TicketCheck } from './types';

export interface TicketRules {
  ignoreBases: string[];
  graceMinutes: number;
  expectedStatuses: Partial<Record<PrState, string[]>>;
}

interface CountedPr { state: 'draft' | 'open' | 'merged' | 'closed'; at: string }

const CATEGORY_LABEL: Record<StatusCategory, string> = { todo: 'To Do', inProgress: 'In Progress', done: 'Done' };
// Without configured names only the categories can be judged, so "In Progress" stands for any working status.
const DEFAULT_CATEGORIES: Record<PrState, StatusCategory[]> = {
  draft: ['inProgress'],
  open: ['inProgress'],
  merged: ['inProgress', 'done'],
  abandoned: ['done'],
};
const PHRASE: Record<PrState, string> = {
  draft: 'Draft PR opened',
  open: 'PR opened',
  merged: 'PR merged',
  abandoned: 'All PRs closed without merging',
};

export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

const newest = (prs: CountedPr[]) => prs.map((pr) => pr.at).sort().at(-1)!;

/** The least-finished PR decides; closed-unmerged PRs only matter when nothing else counts. */
function prStateOf(prs: CountedPr[]): { state: PrState; since: string } | null {
  if (prs.length === 0) return null;
  for (const state of ['draft', 'open', 'merged'] as const) {
    const matching = prs.filter((pr) => pr.state === state);
    if (matching.length) return { state, since: newest(matching) };
  }
  return { state: 'abandoned', since: newest(prs) };
}

function checkOne(key: string, prs: CountedPr[], ticket: Ticket | undefined, rules: TicketRules, now: number): TicketCheck {
  const pr = prStateOf(prs);
  if (!pr) return { key, prState: null, verdict: 'unknown', reason: 'No pull request counts for this ticket.', expected: '', since: null };
  const names = rules.expectedStatuses[pr.state];
  const expected = names?.length ? names.join(' or ') : DEFAULT_CATEGORIES[pr.state].map((category) => CATEGORY_LABEL[category]).join(' or ');
  const base = { key, prState: pr.state, expected, since: pr.since };
  const hours = Math.max(0, Math.round((now - Date.parse(pr.since)) / 3_600_000));
  const phrase = `${PHRASE[pr.state]} ${ageLabel(hours)} ago`;
  if (!ticket) return { ...base, verdict: 'unknown', reason: `${phrase}; ticket status is not available.` };

  let ok: boolean;
  if (names?.length) {
    ok = names.some((name) => name.toLowerCase() === ticket.status.name.toLowerCase());
  } else if (ticket.status.category === null) {
    return { ...base, verdict: 'unknown', reason: `${phrase}; the category of status ${ticket.status.name} is not known yet.` };
  } else {
    ok = DEFAULT_CATEGORIES[pr.state].includes(ticket.status.category);
  }
  if (ok) return { ...base, verdict: 'ok', reason: `${phrase}; ticket is ${ticket.status.name}.` };
  const reason = `${phrase}; ticket is ${ticket.status.name} (expected ${expected}).`;
  const fresh = now - Date.parse(pr.since) < rules.graceMinutes * 60_000;
  if (fresh) return { ...base, verdict: 'grace', reason };
  return { ...base, verdict: pr.state === 'abandoned' ? 'review' : 'mismatch', reason };
}

export function buildTicketChecks(input: {
  open: ChangeRequest[];
  closed: ClosedChangeRequest[];
  tickets: Record<string, Ticket>;
  rules: TicketRules;
  now: number;
}): Record<string, TicketCheck> {
  const ignored = input.rules.ignoreBases.map(globToRegExp);
  const counts = (base: string) => !ignored.some((pattern) => pattern.test(base));
  const byKey = new Map<string, CountedPr[]>();
  const add = (key: string | null, pr: CountedPr | null) => {
    if (!key) return;
    const list = byKey.get(key) ?? [];
    if (pr) list.push(pr);
    byKey.set(key, list);
  };
  for (const pr of input.open) add(ticketKeyOf(pr), counts(pr.baseRefName) ? { state: pr.isDraft ? 'draft' : 'open', at: pr.createdAt } : null);
  for (const pr of input.closed) add(ticketKeyOf(pr), counts(pr.baseRefName) ? { state: pr.merged ? 'merged' : 'closed', at: pr.closedAt } : null);
  return Object.fromEntries([...byKey].map(([key, prs]) => [key, checkOne(key, prs, input.tickets[key], input.rules, input.now)]));
}
