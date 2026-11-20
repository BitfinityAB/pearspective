import type { ActorKind, ChangeRequest, ClosedChangeRequest, Person } from '../shared/types';

let sequence = 0;

export function makePerson(login: string, kind: ActorKind = 'human'): Person {
  return { login, kind, avatarUrl: `https://avatars.example.test/${login}` };
}

/** A PR that is green on every signal; tests override only what they exercise. */
export function makePr(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  sequence += 1;
  const number = overrides.number ?? 1000 + sequence;
  return {
    id: `PR_${number}`,
    provider: 'github',
    repo: 'orders-api',
    number,
    title: `Change ${number}`,
    url: `https://github.com/acme/orders-api/pull/${number}`,
    author: makePerson('alex'),
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-17T08:00:00Z',
    headSha: `sha${number}`,
    headRefName: `feature-${number}`,
    baseRefName: 'main',
    isDraft: false,
    mergeState: 'clean',
    reviewDecision: 'approved',
    checks: [{ name: 'build', state: 'success', required: true }],
    reviews: [{ author: makePerson('sam'), state: 'approved', submittedAt: '2026-11-16T08:00:00Z' }],
    threads: [],
    reviewRequests: [],
    commentCount: 0,
    ...overrides,
  };
}

export function makeClosed(overrides: Partial<ClosedChangeRequest> = {}): ClosedChangeRequest {
  sequence += 1;
  const number = overrides.number ?? 5000 + sequence;
  return {
    id: `PR_${number}`,
    repo: 'orders-api',
    number,
    title: `Change ${number}`,
    url: `https://github.com/acme/orders-api/pull/${number}`,
    headRefName: `feature-${number}`,
    baseRefName: 'main',
    merged: true,
    closedAt: '2026-11-17T08:00:00Z',
    author: makePerson('alex'),
    ...overrides,
  };
}
