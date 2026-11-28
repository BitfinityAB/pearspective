export type ReviewerSlotKey = 'aiReview' | 'codeAnalysis';
export const REVIEWER_SLOTS: ReviewerSlotKey[] = ['aiReview', 'codeAnalysis'];

/** A tool as configured: which logins it reviews as, and how its column is labelled. */
export interface ReviewerSlot { name: string; logins: string[]; short?: string; show: boolean }
/** What the UI needs; null in ReviewerViews means the slot is not configured. */
export interface ReviewerView { name: string; short: string; show: boolean }
export type ReviewerViews = Record<ReviewerSlotKey, ReviewerView | null>;
export const NO_REVIEWERS: ReviewerViews = { aiReview: null, codeAnalysis: null };

export const matchesLogin = (login: string, pattern: string): boolean =>
  pattern.endsWith('*') ? login.startsWith(pattern.slice(0, -1)) : login === pattern;

/** Initials read well for camel-cased product names; short single words read better truncated. */
export function deriveShort(name: string): string {
  const capitals = name.match(/[A-Z]/g) ?? [];
  return capitals.length >= 2 ? capitals.join('') : name.trim().slice(0, 3);
}

export function readableName(login: string): string {
  return login.replace(/\[bot\]$/, '').split(/[-_]+/).filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(' ');
}

export interface CatalogEntry { slot: ReviewerSlotKey; name: string; logins: string[]; short?: string }

export const REVIEWER_CATALOG: CatalogEntry[] = [
  { slot: 'aiReview', name: 'Copilot', logins: ['copilot-pull-request-reviewer'] },
  { slot: 'aiReview', name: 'CodeRabbit', logins: ['coderabbitai'] },
  { slot: 'aiReview', name: 'Gemini Code Assist', logins: ['gemini-code-assist'], short: 'Gem' },
  { slot: 'aiReview', name: 'Sourcery', logins: ['sourcery-ai'] },
  { slot: 'codeAnalysis', name: 'CodeScene', logins: ['codescene-*'] },
  { slot: 'codeAnalysis', name: 'SonarQube Cloud', logins: ['sonarqubecloud', 'sonarcloud'], short: 'SQ' },
  { slot: 'codeAnalysis', name: 'Codacy', logins: ['codacy-*'] },
  { slot: 'codeAnalysis', name: 'DeepSource', logins: ['deepsource-*'] },
];

// Housekeeping bots review or comment too, but are never an AI reviewer or analysis tool.
export const IGNORED_BOTS = ['github-actions', 'dependabot', 'renovate'];

export const catalogEntryFor = (login: string): CatalogEntry | null =>
  REVIEWER_CATALOG.find((entry) => entry.logins.some((pattern) => matchesLogin(login, pattern))) ?? null;

export const isIgnoredBot = (login: string): boolean => IGNORED_BOTS.includes(login.replace(/\[bot\]$/, ''));

export function toReviewerView(slot: ReviewerSlot | undefined): ReviewerView | null {
  return slot ? { name: slot.name, short: slot.short ?? deriveShort(slot.name), show: slot.show } : null;
}
