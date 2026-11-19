import { ConfigSchema, DEFAULT_REVIEWER_CLASSES, type Config } from '../server/config';
import { MAX_REPOS, type RepoRef } from '../shared/types';

export function parseRemote(url: string): { owner: string; repo: string } | null {
  const match = url.trim().match(/^(?:git@[^:]+:|(?:ssh|https?):\/\/(?:[^@/]+@)?[^/]+\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? { owner: match[1]!, repo: match[2]! } : null;
}

export function rankCandidates(cloned: string[], activity: RepoRef[], openCounts: Record<string, number>): RepoRef[] {
  const names = [...new Set([...activity.map((repo) => repo.name), ...cloned])];
  const activityOf = new Map(activity.map((repo) => [repo.name, repo.activity ?? 0]));
  return names
    .map((name) => ({ name, activity: activityOf.get(name) ?? 0, openCount: openCounts[name] ?? 0, cloned: cloned.includes(name) }))
    .sort((a, b) => b.activity - a.activity || b.openCount - a.openCount || a.name.localeCompare(b.name));
}

export function preselect(candidates: RepoRef[], max = MAX_REPOS): string[] {
  return candidates.filter((repo) => (repo.openCount ?? 0) > 0).slice(0, max).map((repo) => repo.name);
}

export function validateSelection(selected: string[]): true | string {
  if (selected.length === 0) return 'Pick at least one repository.';
  if (selected.length > MAX_REPOS) return `Pick at most ${MAX_REPOS} repositories (you picked ${selected.length}).`;
  return true;
}

export function mostCommonOwner(remotes: { owner: string }[]): string | null {
  const counts = new Map<string, number>();
  remotes.forEach((remote) => counts.set(remote.owner, (counts.get(remote.owner) ?? 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Prefers an org the gh user belongs to; with several, the one most local clones point at. */
export function defaultOrg(input: { existing?: string; viewerOrgs: string[]; remotes: { owner: string }[] }): string {
  const { existing, viewerOrgs, remotes } = input;
  if (existing && (viewerOrgs.length === 0 || viewerOrgs.includes(existing))) return existing;
  if (viewerOrgs.length === 1) return viewerOrgs[0]!;
  if (viewerOrgs.length > 1) return mostCommonOwner(remotes.filter((remote) => viewerOrgs.includes(remote.owner))) ?? viewerOrgs[0]!;
  return mostCommonOwner(remotes) ?? '';
}

export function buildConfig(input: { org: string; repos: string[]; teams: string[]; localRepos: string[] }, existing?: Config): Config {
  return ConfigSchema.parse({
    ...existing,
    codeHost: { ...existing?.codeHost, provider: 'github', org: input.org, repos: input.repos, teams: input.teams, localRepos: input.localRepos },
    reviewerClasses: existing?.reviewerClasses ?? DEFAULT_REVIEWER_CLASSES,
    refreshIntervalSec: existing?.refreshIntervalSec ?? 180,
  });
}
