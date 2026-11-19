# Pearspective v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, read-only dashboard of open GitHub PRs. It has an Overview of swimlanes, a Mine view, and stack visualisation. The data comes from the `gh` CLI, the server is Node, and the UI is React + D3.

**Architecture:**
- The **Node/Express server** (127.0.0.1 only) polls GitHub through a `CodeHostProvider` interface. The GitHub implementation shells out to `gh api graphql`. The server keeps an in-memory snapshot of neutral domain types and pushes it to the browser over SSE.
- **All status, stack and grouping logic** lives in pure `shared/` modules that both sides import.
- **The React UI** is a thin layer of components over view models produced by `shared/grouping.ts`, so a later design (the Lovable output) can replace the components without touching the logic.

**Tech Stack:** Node ≥ 22, TypeScript 5 (ESM), Express 5, `tsx`, Vite 7, React 19, D3 v7, Zod 3, `@inquirer/prompts`, Vitest 3, Testing Library, Supertest, `concurrently`.

**Spec:** `docs/design.md`. Also read `docs/mockup/overview-swimlanes.html` (the visual and interaction reference; open it in a browser) and `docs/lovable-prompt.md` (the UI spec in prose).

## Global Constraints

- **Read-only.** No GitHub mutations, ever. All GitHub access goes through the `gh` CLI (`gh api graphql` / `gh api <rest path>`), using whatever account is active.
- **Network:** the server binds to `127.0.0.1` only, on port `4100`. Vite dev runs on `127.0.0.1:5173` and proxies `/api` to the server.
- **Neutral domain model:**
  - Provider vocabulary (GraphQL field names, `mergeStateStatus`, `DIRTY`, …) never appears outside `server/providers/`.
  - `shared/`, `server/poller.ts`, `server/app.ts` and `web/` use only the types in `shared/types.ts`.
- **Limits:**
  - `MAX_REPOS = 10`
  - refresh options exactly `off | 3 | 5 | 10 | 15 | 30` minutes (3 is the minimum)
  - full sweep every 15 minutes
  - full-field batch size 25, halved on a resource-limit or 502 error
  - rate-limit floor 500 (below it: banner, and the poll interval doubles)
- **Reviewer classes** come from `config.json` `reviewerClasses` (`ai-review`, `code-analysis`). Defaults:
  - `ai-review: ["copilot-pull-request-reviewer"]`
  - `code-analysis: ["codescene-access", "codescene-delta-analysis"]`
  - Any other `Bot` is class `bot`. A `User` is `human`. Only `human` counts as a human review.
- **Styling:**
  - Colours only as CSS custom properties.
  - Themes: System (default) / Light / Dark, saved in `localStorage` under `theme` and applied as `data-theme` on `<html>` before first paint.
  - Text contrast at least 4.5:1 in both themes.
- **Code style** (from the user's CLAUDE.md):
  - No variable names like `foo`, `bar`, `sut`.
  - Comments are short and say *why*, never *what*.
  - No Jira IDs or customer names in comments.
- **Commits:** short 1–2 sentence messages, **no** `Co-authored-by` footer.
- **Tests:** Vitest. `describe`/`it` names read as sentences, for example `it('is red when a required check failed')`. Web component tests start with `// @vitest-environment jsdom`.

## Decisions made while planning (differences from `design.md`)

1. **Mine section 2** uses the search qualifier `user-review-requested:@me`, not `review-requested:@me`. The latter also matches requests to your teams, which belong in section 3.
2. **The lean poll** uses `first:100` per repo with `pageInfo` pagination. `design.md` says `first:50`, but at least one repo has 49 open PRs.
3. **`isRequired` on check contexts** needs the PR in its argument. Each PR in a full-field batch is fetched by alias (`p0: node(id: "…")`), so the query can pass `isRequired(pullRequestNumber: N)`.
4. **Stack detection** runs client-side in `shared/stacks.ts`, from fields already in the snapshot. The stack dialog's merged entries and "N behind" counts are fetched on demand from `GET /api/stack`.
5. **The lane-header stacked bar** is plain CSS (flex widths). D3 is used where it adds something: the log-scale age axis and the stack diagrams.
6. **The Jira link in the drawer** comes from `config.issueTracker.baseUrl` (provider `jira` → `<baseUrl>/browse/{key}`). Without an issue tracker in config, the drawer still shows the key, but not as a link.
7. **The stack dialog** is a focus-managed `role="dialog"` overlay rather than `<dialog>`, because jsdom (used by the component tests) does not implement `showModal()`.
8. **Deliberately deferred to v2:**
   - **The issue-tracker side of the provider interfaces.** v1 ships only the code-host interface (`CodeHostProvider` plus registry). The ticket-key pattern stays in `shared/tickets.ts`, the Jira URL template in `Poller.refreshSettings`, and the "in Jira" label in the drawer. v2 replaces all three with an `IssueTrackerProvider` (`id`, `keyPattern`, `ticketUrl(key)`, then `getTickets`) and its registry, alongside the Jira CLI work in `docs/v2-proposal.md`.
   - **Showing `capabilities` in the UI.** GitHub supports every capability, so there is nothing to hide yet. The first provider that lacks one (for example, no native stacks) adds `capabilities` to `Snapshot.settings`, and the affected components hide their parts.
9. **Git:** Task 1 runs `git init` locally with no remote. Whether this becomes a personal or org repository is still undecided (`docs/v2-proposal.md`).

## File Structure

```
pearspective/
  package.json, tsconfig.json, vite.config.ts, vitest.config.ts, .gitignore, config.example.json, README.md
  shared/                         pure logic, imported by server and web
    types.ts                      neutral domain model, Snapshot, API payloads
    status.ts                     six signals, blockers, bucket
    stacks.ts                     native and branch-chained stack detection, tree helpers
    tickets.ts                    Jira-key extraction
    age.ts                        age in hours, labels, log scale domain
    grouping.ts                   PrView, lanes for Overview and Mine, filters, sorting
    __tests__/*.test.ts
  test/factories.ts               makePr(), makePerson() builders for tests
  test/fake-provider.ts           in-memory CodeHostProvider for server tests
  test/setup.ts                   registers jest-dom matchers
  server/
    index.ts                      process entry: load config, build provider, start app
    app.ts                        Express routes + SSE
    hub.ts                        fan-out of snapshots to SSE clients
    stack-detail.ts               merged entries + behind counts for the stack dialog
    config.ts                     load, validate (zod) and save config.json
    poller.ts                     lean poll → enrich → snapshot; backoff, banners
    presence.ts                   Presence (visible clients) + PollLoop (scheduling)
    gh.ts                         `gh` process runner + error classification
    providers/types.ts            CodeHostProvider interface, RepoRef
    providers/registry.ts         chooses a provider from config
    providers/contract.ts         shared contract-test suite for any CodeHostProvider
    providers/codehost/github/
      queries.ts                  GraphQL query builders
      mapping.ts                  GitHub JSON → neutral types
      provider.ts                 GithubProvider implements CodeHostProvider
      fixtures/*.json             anonymised GraphQL responses
      __tests__/*.test.ts
    __tests__/*.test.ts
  scripts/
    setup.ts                      interactive `npm run setup`
    setup-lib.ts                  pure helpers (remote parsing, ranking, selection)
    smoke-github.ts               read-only check of every GitHub query against the real org
    __tests__/setup-lib.test.ts
  web/
    index.html                    pre-paint theme script
    src/main.tsx, App.tsx
    src/theme.ts                  read and apply System/Light/Dark
    src/styles/tokens.css, app.css
    src/api/client.ts             DashboardApi interface + HTTP implementation
    src/api/useDashboard.ts       snapshot state, SSE, presence
    src/state/urlState.ts         tab, group, filters, sort, search and selected PR in the URL
    src/lib/ageScale.ts           shared D3 log scale for age bars and the ruler
    src/lib/stackLayout.ts        pure stack → tree layout for the diagrams
    src/lib/stackConnectors.ts    branch columns + orthogonal arrow paths for expanded stacks in lanes
    src/components/               Avatar, ThemeToggle, Header, Banners, Toolbar, StatusSquares,
                                  AgeBar, ColumnHeader, PrRow, StackRow, StackMembers, Lane, Drawer,
                                  StackDiagram, StackDialog, SettingsPanel
    src/views/                    OverviewView, MineView, StacksView
    src/__tests__/*.test.ts(x)
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `vite.config.ts`, `.gitignore`, `config.example.json`, `shared/types.ts`, `shared/__tests__/types.test.ts`

**Interfaces:**
- Produces: every type in `shared/types.ts` (used by every later task).

- [ ] **Step 1: Initialise the repo and install dependencies**

```bash
cd ~/Projects/pearspective
git init -b main
npm init -y
npm pkg set type=module name=pearspective
npm pkg set private=true --json
npm pkg set engines.node=">=22"
npm i express@5 zod@3 d3@7 react@19 react-dom@19 @inquirer/prompts
npm i -D typescript@5 tsx vite@7 @vitejs/plugin-react vitest@3 jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom supertest @types/supertest @types/express @types/node@22 @types/d3 @types/react @types/react-dom concurrently
npm pkg set scripts.dev="concurrently -k -n server,web \"tsx watch server/index.ts\" \"vite\""
npm pkg set scripts.start="tsx server/index.ts"
npm pkg set scripts.setup="tsx scripts/setup.ts"
npm pkg set scripts.build="vite build"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.typecheck="tsc --noEmit"
```

- [ ] **Step 2: Write config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node", "vitest/globals", "@testing-library/jest-dom"],
    "noEmit": true
  },
  "include": ["shared", "server", "scripts", "web/src", "test", "*.config.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['**/__tests__/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./test/setup.ts'],
  },
});
```

`test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4100' },
    // The web root is web/, but it imports ../shared.
    fs: { allow: ['..'] },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
```

`.gitignore`:
```
node_modules/
dist/
config.json
.DS_Store
```

`config.example.json`:
```json
{
  "codeHost": {
    "provider": "github",
    "org": "acme",
    "repos": ["orders-api", "orders-web"],
    "excludeRepos": [],
    "teams": ["platform-team"],
    "localRepos": []
  },
  "reviewerClasses": {
    "ai-review": ["copilot-pull-request-reviewer"],
    "code-analysis": ["codescene-access", "codescene-delta-analysis"]
  },
  "refreshIntervalSec": 180
}
```

- [ ] **Step 3: Write the neutral domain model**

`shared/types.ts`:
```ts
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
  avatarUrl?: string;
  teams: Team[];
}

export const REFRESH_OPTIONS = ['off', 3, 5, 10, 15, 30] as const;
export type RefreshSetting = (typeof REFRESH_OPTIONS)[number];
export const MAX_REPOS = 10;

export interface BannerMsg {
  kind: 'missing-cli' | 'auth' | 'rate-limit' | 'stale';
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
  /** ticketUrl is a template with {key}, or null when no issue tracker is configured. */
  settings: { refresh: RefreshSetting; repos: string[]; org: string; host: string; ticketUrl: string | null };
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
    settings: { refresh: 3, repos: [], org, host, ticketUrl: null },
  };
}
```

- [ ] **Step 4: Write a smoke test that proves the toolchain runs**

`shared/__tests__/types.test.ts`:
```ts
import { emptySnapshot, REFRESH_OPTIONS, MAX_REPOS } from '../types';

describe('shared types', () => {
  it('builds an empty snapshot with the 3 minute default refresh', () => {
    const snapshot = emptySnapshot('acme');
    expect(snapshot.settings).toEqual({ refresh: 3, repos: [], org: 'acme', host: 'github.com', ticketUrl: null });
    expect(snapshot.prs).toEqual([]);
  });

  it('offers exactly the Grafana-style refresh options with 3 minutes as the minimum', () => {
    expect(REFRESH_OPTIONS).toEqual(['off', 3, 5, 10, 15, 30]);
    expect(MAX_REPOS).toBe(10);
  });
});
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: 2 tests pass; typecheck prints no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Scaffold pearspective with the neutral domain model."
```

---

### Task 2: Test factories and status rules

**Files:**
- Create: `test/factories.ts`, `shared/status.ts`, `shared/__tests__/status.test.ts`

**Interfaces:**
- Consumes: `ChangeRequest`, `Person`, `Check`, `Review`, `Thread`, `ReviewRequest`, `SignalColor` from `shared/types.ts`.
- Produces:
  - `type SignalKey = 'ci' | 'aiReview' | 'codeAnalysis' | 'review' | 'threads' | 'mergeable'`
  - `interface Signal { key: SignalKey; label: string; color: SignalColor; glyph: string; detail: string }`
  - `interface Blocker { label: string; severity: 'red' | 'amber' | 'grey' }`
  - `type Bucket = 'blocked' | 'waiting' | 'ready' | 'draft'`
  - `signalsOf(pr): Signal[]` (always 6, in the order above), `blockersOf(pr): Blocker[]`, `bucketOf(pr): Bucket`, `reviewCounts(pr): { approved: number; changesRequested: number }`, `GLYPH: Record<SignalColor, string>`
  - `makePr(overrides?: Partial<ChangeRequest>): ChangeRequest` and `makePerson(login, kind?): Person` in `test/factories.ts`

- [ ] **Step 1: Write the factories**

`test/factories.ts`:
```ts
import type { ActorKind, ChangeRequest, Person } from '../shared/types';

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
```

- [ ] **Step 2: Write the failing tests**

`shared/__tests__/status.test.ts`:
```ts
import { blockersOf, bucketOf, reviewCounts, signalsOf } from '../status';
import { makePerson, makePr } from '../../test/factories';

const signal = (pr: ReturnType<typeof makePr>, key: string) => signalsOf(pr).find((s) => s.key === key)!;
const copilot = makePerson('copilot-pull-request-reviewer', 'ai-review');
const codescene = makePerson('codescene-access', 'code-analysis');

describe('signalsOf', () => {
  it('returns six signals in a fixed order', () => {
    expect(signalsOf(makePr()).map((s) => s.key)).toEqual(['ci', 'aiReview', 'codeAnalysis', 'review', 'threads', 'mergeable']);
  });

  describe('CI', () => {
    it('is grey when there are no checks', () => {
      expect(signal(makePr({ checks: [] }), 'ci').color).toBe('grey');
    });
    it('is red when a required check failed', () => {
      const pr = makePr({ checks: [{ name: 'e2e-android', state: 'failure', required: true }] });
      expect(signal(pr, 'ci')).toMatchObject({ color: 'red', glyph: '✕', detail: 'Required check failed: e2e-android' });
    });
    it('is amber when only a non-required check failed', () => {
      const pr = makePr({ checks: [{ name: 'lint-extra', state: 'failure', required: false }, { name: 'build', state: 'success', required: true }] });
      expect(signal(pr, 'ci').color).toBe('amber');
    });
    it('is amber while a check is pending', () => {
      const pr = makePr({ checks: [{ name: 'build', state: 'pending', required: true }] });
      expect(signal(pr, 'ci')).toMatchObject({ color: 'amber', detail: '1 running' });
    });
    it('is green when every check passed', () => {
      expect(signal(makePr(), 'ci')).toMatchObject({ color: 'green', detail: 'All 1 checks passed' });
    });
  });

  describe('AI review (Copilot)', () => {
    it('is grey when not requested and not reviewed', () => {
      expect(signal(makePr(), 'aiReview').color).toBe('grey');
    });
    it('is amber when requested but not reviewed yet', () => {
      const pr = makePr({ reviewRequests: [{ type: 'person', person: copilot }] });
      expect(signal(pr, 'aiReview')).toMatchObject({ color: 'amber', detail: 'Requested, not reviewed yet' });
    });
    it('is amber when it reviewed and left unresolved threads', () => {
      const pr = makePr({
        reviews: [{ author: copilot, state: 'commented', submittedAt: '2026-11-16T08:00:00Z' }],
        threads: [{ resolved: false, author: copilot, snippet: 'Possible null', url: 'u' }],
      });
      expect(signal(pr, 'aiReview')).toMatchObject({ color: 'amber', detail: 'Reviewed, 1 unresolved' });
    });
    it('is green when it reviewed and every thread it opened is resolved', () => {
      const pr = makePr({
        reviews: [{ author: copilot, state: 'commented', submittedAt: '2026-11-16T08:00:00Z' }],
        threads: [{ resolved: true, author: copilot, snippet: 'x', url: 'u' }],
      });
      expect(signal(pr, 'aiReview').color).toBe('green');
    });
  });

  describe('code analysis (CodeScene)', () => {
    it('is grey without a review', () => {
      expect(signal(makePr(), 'codeAnalysis').color).toBe('grey');
    });
    it('follows its latest review state', () => {
      const pr = makePr({
        reviews: [
          { author: codescene, state: 'changes_requested', submittedAt: '2026-11-15T08:00:00Z' },
          { author: codescene, state: 'approved', submittedAt: '2026-11-16T08:00:00Z' },
        ],
      });
      expect(signal(pr, 'codeAnalysis').color).toBe('green');
    });
    it('is red when its latest review requested changes', () => {
      const pr = makePr({ reviews: [{ author: codescene, state: 'changes_requested', submittedAt: '2026-11-16T08:00:00Z' }] });
      expect(signal(pr, 'codeAnalysis').color).toBe('red');
    });
  });

  describe('human review', () => {
    it.each([
      ['approved', 'green'],
      ['review_required', 'amber'],
      ['changes_requested', 'red'],
      [null, 'grey'],
    ] as const)('maps decision %s to %s', (decision, color) => {
      expect(signal(makePr({ reviewDecision: decision }), 'review').color).toBe(color);
    });
  });

  describe('threads', () => {
    it('counts only unresolved human threads and shows the count as the glyph', () => {
      const pr = makePr({
        threads: [
          { resolved: false, author: makePerson('robin'), snippet: 'a', url: 'u' },
          { resolved: false, author: makePerson('robin'), snippet: 'b', url: 'u' },
          { resolved: false, author: copilot, snippet: 'c', url: 'u' },
          { resolved: true, author: makePerson('robin'), snippet: 'd', url: 'u' },
        ],
      });
      expect(signal(pr, 'threads')).toMatchObject({ color: 'amber', glyph: '2', detail: '2 unresolved' });
    });
  });

  describe('mergeable', () => {
    it.each([
      ['clean', 'green'],
      ['blocked', 'amber'],
      ['unstable', 'amber'],
      ['conflicts', 'red'],
      ['behind', 'red'],
      ['unknown', 'grey'],
    ] as const)('maps %s to %s', (state, color) => {
      expect(signal(makePr({ mergeState: state }), 'mergeable').color).toBe(color);
    });
    it('shows an ellipsis while mergeability is being computed', () => {
      expect(signal(makePr({ mergeState: 'unknown' }), 'mergeable')).toMatchObject({ glyph: '…', detail: 'Checking…' });
    });
  });
});

describe('blockersOf', () => {
  it('returns nothing for a clean approved PR', () => {
    expect(blockersOf(makePr())).toEqual([]);
  });
  it('lists every blocker as its own badge', () => {
    const pr = makePr({
      isDraft: true,
      mergeState: 'conflicts',
      reviewDecision: 'changes_requested',
      checks: [{ name: 'build', state: 'failure', required: true }],
      threads: [{ resolved: false, author: makePerson('robin'), snippet: 'a', url: 'u' }],
    });
    expect(blockersOf(pr).map((b) => b.label)).toEqual([
      'Draft', 'Conflicts', 'Required check failed', 'Changes requested', '1 unresolved thread',
    ]);
  });
  it('marks a missing approval as amber, not red', () => {
    expect(blockersOf(makePr({ reviewDecision: 'review_required' }))).toEqual([{ label: 'Needs approval', severity: 'amber' }]);
  });
  it('treats being behind the base branch as red', () => {
    expect(blockersOf(makePr({ mergeState: 'behind' }))).toEqual([{ label: 'Behind base', severity: 'red' }]);
  });
});

describe('bucketOf', () => {
  it('puts drafts in the draft bucket regardless of other state', () => {
    expect(bucketOf(makePr({ isDraft: true, mergeState: 'conflicts' }))).toBe('draft');
  });
  it('is blocked when any red blocker exists', () => {
    expect(bucketOf(makePr({ mergeState: 'conflicts' }))).toBe('blocked');
  });
  it('is waiting when only an approval is missing', () => {
    expect(bucketOf(makePr({ reviewDecision: 'review_required', mergeState: 'blocked' }))).toBe('waiting');
  });
  it('is waiting while checks run or mergeability is unknown', () => {
    expect(bucketOf(makePr({ checks: [{ name: 'build', state: 'pending', required: true }] }))).toBe('waiting');
    expect(bucketOf(makePr({ mergeState: 'unknown' }))).toBe('waiting');
  });
  it('is ready when nothing blocks or waits', () => {
    expect(bucketOf(makePr())).toBe('ready');
  });
});

describe('reviewCounts', () => {
  it('counts each human reviewer once by their latest state', () => {
    const sam = makePerson('sam');
    const pr = makePr({
      reviews: [
        { author: sam, state: 'changes_requested', submittedAt: '2026-11-14T08:00:00Z' },
        { author: sam, state: 'approved', submittedAt: '2026-11-15T08:00:00Z' },
        { author: makePerson('robin'), state: 'changes_requested', submittedAt: '2026-11-15T09:00:00Z' },
        { author: copilot, state: 'commented', submittedAt: '2026-11-15T10:00:00Z' },
      ],
    });
    expect(reviewCounts(pr)).toEqual({ approved: 1, changesRequested: 1 });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run shared/__tests__/status.test.ts`
Expected: FAIL, `Cannot find module '../status'`.

- [ ] **Step 4: Implement `shared/status.ts`**

```ts
import type { ActorKind, ChangeRequest, Review, SignalColor } from './types';

export type SignalKey = 'ci' | 'aiReview' | 'codeAnalysis' | 'review' | 'threads' | 'mergeable';
export interface Signal { key: SignalKey; label: string; color: SignalColor; glyph: string; detail: string }
export interface Blocker { label: string; severity: 'red' | 'amber' | 'grey' }
export type Bucket = 'blocked' | 'waiting' | 'ready' | 'draft';

export const GLYPH: Record<SignalColor, string> = { green: '✓', amber: '!', red: '✕', grey: '–' };
export const SIGNAL_LABELS: Record<SignalKey, string> = {
  ci: 'CI', aiReview: 'Copilot', codeAnalysis: 'CodeScene', review: 'Review', threads: 'Threads', mergeable: 'Mergeable',
};

const makeSignal = (key: SignalKey, color: SignalColor, detail: string, glyph = GLYPH[color]): Signal =>
  ({ key, label: SIGNAL_LABELS[key], color, glyph, detail });

const unresolvedBy = (pr: ChangeRequest, kind: ActorKind) =>
  pr.threads.filter((thread) => !thread.resolved && thread.author.kind === kind).length;

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

function threadsSignal(pr: ChangeRequest): Signal {
  const unresolved = unresolvedBy(pr, 'human');
  return unresolved > 0
    ? makeSignal('threads', 'amber', `${unresolved} unresolved`, String(unresolved))
    : makeSignal('threads', 'green', 'None unresolved');
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

export function signalsOf(pr: ChangeRequest): Signal[] {
  return [ciSignal(pr), aiReviewSignal(pr), codeAnalysisSignal(pr), reviewSignal(pr), threadsSignal(pr), mergeableSignal(pr)];
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
  if (pr.reviewDecision === 'review_required') blockers.push({ label: 'Needs approval', severity: 'amber' });
  return blockers;
}

export function bucketOf(pr: ChangeRequest): Bucket {
  if (pr.isDraft) return 'draft';
  if (blockersOf(pr).some((blocker) => blocker.severity === 'red')) return 'blocked';
  const checksRunning = pr.checks.some((check) => check.state === 'pending');
  if (pr.reviewDecision === 'review_required' || checksRunning || pr.mergeState === 'unknown') return 'waiting';
  return 'ready';
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run shared/__tests__/status.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add test shared
git commit -m "Add status rules: six signals, blockers and buckets."
```

---

### Task 3: Ticket keys and age scale

**Files:**
- Create: `shared/tickets.ts`, `shared/age.ts`, `shared/__tests__/tickets.test.ts`, `shared/__tests__/age.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_TICKET_PATTERN: RegExp`, `ticketKeyOf(pr: { headRefName: string; title: string }, pattern?: RegExp): string | null`
  - `ageHours(createdAt: string, now: number): number`, `ageLabel(hours: number): string`, `AGE_DOMAIN_HOURS: [1, 2160]`, `AGE_TICKS: { hours: number; label: string }[]`

- [ ] **Step 1: Write the failing tests**

`shared/__tests__/tickets.test.ts`:
```ts
import { ticketKeyOf } from '../tickets';

describe('ticketKeyOf', () => {
  it('reads the key from the branch name first', () => {
    expect(ticketKeyOf({ headRefName: 'bugfix/XX-320-fix-versioning-test', title: 'Fix test (XX-1)' })).toBe('XX-320');
  });
  it('falls back to the title', () => {
    expect(ticketKeyOf({ headRefName: 'fix-versioning', title: '[XX-310] Show the second day' })).toBe('XX-310');
  });
  it('returns null when neither has a key', () => {
    expect(ticketKeyOf({ headRefName: 'dependabot/npm/vite-6.2.0', title: 'Bump vite from 5.4.2 to 6.2.0' })).toBeNull();
  });
  it('does not treat version-like text as a key', () => {
    expect(ticketKeyOf({ headRefName: 'react-router-7', title: 'Upgrade to UTF-8 handling' })).toBeNull();
  });
});
```

`shared/__tests__/age.test.ts`:
```ts
import { ageHours, ageLabel, AGE_TICKS } from '../age';

describe('age', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');

  it('rounds age down to whole hours with a floor of one hour', () => {
    expect(ageHours('2026-11-18T11:45:00Z', now)).toBe(1);
    expect(ageHours('2026-11-17T12:00:00Z', now)).toBe(24);
  });

  it.each([
    [5, '5h'],
    [24, '1d'],
    [300, '13d'],
    [336, '2w'],
    [1300, '8w'],
  ])('labels %i hours as %s', (hours, label) => {
    expect(ageLabel(hours)).toBe(label);
  });

  it('ticks from one hour to three months', () => {
    expect(AGE_TICKS.map((tick) => tick.label)).toEqual(['1h', '6h', '1d', '3d', '1w', '2w', '1mo', '3mo']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run shared/__tests__/tickets.test.ts shared/__tests__/age.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`shared/tickets.ts`:
```ts
// The project key must start with a letter, so version strings like UTF-8 do not match.
export const DEFAULT_TICKET_PATTERN = /\b([A-Z][A-Z0-9]+-\d+)\b/;
const VERSION_LIKE = /^(UTF|ISO|SHA|ES|TLS|HTTP)-\d+$/;

export function ticketKeyOf(pr: { headRefName: string; title: string }, pattern = DEFAULT_TICKET_PATTERN): string | null {
  for (const text of [pr.headRefName, pr.title]) {
    const key = text.match(pattern)?.[1];
    if (key && !VERSION_LIKE.test(key)) return key;
  }
  return null;
}
```

`shared/age.ts`:
```ts
export const AGE_DOMAIN_HOURS: [number, number] = [1, 2160];

export const AGE_TICKS = [
  { hours: 1, label: '1h' }, { hours: 6, label: '6h' }, { hours: 24, label: '1d' }, { hours: 72, label: '3d' },
  { hours: 168, label: '1w' }, { hours: 336, label: '2w' }, { hours: 720, label: '1mo' }, { hours: 2160, label: '3mo' },
];

export function ageHours(createdAt: string, now: number): number {
  return Math.max(1, Math.floor((now - Date.parse(createdAt)) / 3_600_000));
}

export function ageLabel(hours: number): string {
  if (hours < 24) return `${hours}h`;
  if (hours < 336) return `${Math.round(hours / 24)}d`;
  return `${Math.round(hours / 168)}w`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run shared/__tests__/tickets.test.ts shared/__tests__/age.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "Add Jira key extraction and the age scale."
```

---

### Task 4: Stack detection

**Files:**
- Create: `shared/stacks.ts`, `shared/__tests__/stacks.test.ts`

**Interfaces:**
- Consumes: `ChangeRequestStub`, `ChangeRequest` from `shared/types.ts`; `makePr` from `test/factories.ts`.
- Produces:
  - `interface StackMember { id: string; parentId: string | null }` (`null` means the PR sits on the base branch or on a merged entry)
  - `interface Stack { id: string; repo: string; native: boolean; number?: number; baseRefName: string; members: StackMember[]; notOpenCount: number }`
  - `detectStacks(prs: ChangeRequestStub[]): Stack[]` (only stacks with at least 2 open members)
  - `stackIndex(stacks): Map<string, { stack: Stack; parentId: string | null }>` (keyed by PR id)
  - `membersBottomUp(stack): string[]` (PR ids ordered by depth, then by the order they appear in `members`)

- [ ] **Step 1: Write the failing tests**

`shared/__tests__/stacks.test.ts`:
```ts
import { detectStacks, membersBottomUp, stackIndex } from '../stacks';
import { makePr } from '../../test/factories';

describe('detectStacks', () => {
  it('builds a native stack ordered by position and counts entries that are no longer open', () => {
    const native = (number: number, position: number) =>
      makePr({ number, repo: 'field-app', nativeStack: { number: 4964, size: 26, position, baseRefName: 'main' } });
    const prs = [native(4990, 17), native(4988, 15), native(4989, 16)];

    const [stack] = detectStacks(prs);

    expect(stack).toMatchObject({ id: 'field-app#s4964', native: true, number: 4964, baseRefName: 'main', notOpenCount: 23 });
    expect(stack!.members).toEqual([
      { id: 'PR_4988', parentId: null },
      { id: 'PR_4989', parentId: 'PR_4988' },
      { id: 'PR_4990', parentId: 'PR_4989' },
    ]);
  });

  it('leaves a gap in native positions as a stack with a null parent above the gap', () => {
    const native = (number: number, position: number) =>
      makePr({ number, nativeStack: { number: 2640, size: 4, position, baseRefName: 'main' } });
    const [stack] = detectStacks([native(2637, 1), native(2638, 3)]);
    expect(stack!.members).toEqual([{ id: 'PR_2637', parentId: null }, { id: 'PR_2638', parentId: null }]);
  });

  it('chains PRs whose base branch is another open PR head in the same repo, including forks', () => {
    const lock = makePr({ number: 3420, headRefName: 'scheduler-lock', baseRefName: 'main' });
    const settings = makePr({ number: 3421, headRefName: 'lock-settings', baseRefName: 'scheduler-lock' });
    const metrics = makePr({ number: 3422, headRefName: 'lock-metrics', baseRefName: 'scheduler-lock' });
    const unrelated = makePr({ number: 3500, headRefName: 'other', baseRefName: 'main' });

    const [stack] = detectStacks([metrics, unrelated, settings, lock]);

    expect(stack).toMatchObject({ id: 'orders-api#chain-3420', native: false, baseRefName: 'main', notOpenCount: 0 });
    expect(stack!.members).toEqual([
      { id: 'PR_3420', parentId: null },
      { id: 'PR_3421', parentId: 'PR_3420' },
      { id: 'PR_3422', parentId: 'PR_3420' },
    ]);
  });

  it('does not chain across repositories', () => {
    const parent = makePr({ repo: 'orders-api', headRefName: 'shared-name', baseRefName: 'main' });
    const child = makePr({ repo: 'orders-web', headRefName: 'child', baseRefName: 'shared-name' });
    expect(detectStacks([parent, child])).toEqual([]);
  });

  it('prefers the native stack when a PR is in one', () => {
    const native = makePr({ number: 1, headRefName: 'a', nativeStack: { number: 9, size: 2, position: 1, baseRefName: 'main' } });
    const nativeTop = makePr({ number: 2, headRefName: 'b', baseRefName: 'a', nativeStack: { number: 9, size: 2, position: 2, baseRefName: 'main' } });
    const stacks = detectStacks([native, nativeTop]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.native).toBe(true);
  });

  it('survives a branch cycle without looping forever', () => {
    const first = makePr({ headRefName: 'a', baseRefName: 'b' });
    const second = makePr({ headRefName: 'b', baseRefName: 'a' });
    expect(() => detectStacks([first, second])).not.toThrow();
  });
});

describe('stackIndex and membersBottomUp', () => {
  it('maps each member to its stack and parent, and orders members from the base upwards', () => {
    const lock = makePr({ number: 3420, headRefName: 'scheduler-lock' });
    const settings = makePr({ number: 3421, headRefName: 'lock-settings', baseRefName: 'scheduler-lock' });
    const top = makePr({ number: 3423, headRefName: 'top', baseRefName: 'lock-settings' });
    const stacks = detectStacks([top, settings, lock]);

    expect(stackIndex(stacks).get('PR_3423')).toEqual({ stack: stacks[0], parentId: 'PR_3421' });
    expect(membersBottomUp(stacks[0]!)).toEqual(['PR_3420', 'PR_3421', 'PR_3423']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run shared/__tests__/stacks.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `shared/stacks.ts`**

```ts
import type { ChangeRequestStub } from './types';

export interface StackMember { id: string; parentId: string | null }
export interface Stack {
  id: string;
  repo: string;
  native: boolean;
  number?: number;
  baseRefName: string;
  members: StackMember[];
  /** Entries GitHub still lists in the stack that are not open any more (merged or closed). */
  notOpenCount: number;
}

function nativeStacks(prs: ChangeRequestStub[]): Stack[] {
  const groups = new Map<string, ChangeRequestStub[]>();
  for (const pr of prs) {
    if (!pr.nativeStack) continue;
    const key = `${pr.repo}#s${pr.nativeStack.number}`;
    groups.set(key, [...(groups.get(key) ?? []), pr]);
  }
  return [...groups].map(([id, group]) => {
    const ordered = [...group].sort((a, b) => a.nativeStack!.position - b.nativeStack!.position);
    const byPosition = new Map(ordered.map((pr) => [pr.nativeStack!.position, pr]));
    const first = ordered[0]!;
    return {
      id,
      repo: first.repo,
      native: true,
      number: first.nativeStack!.number,
      baseRefName: first.nativeStack!.baseRefName,
      members: ordered.map((pr) => ({ id: pr.id, parentId: byPosition.get(pr.nativeStack!.position - 1)?.id ?? null })),
      notOpenCount: first.nativeStack!.size - ordered.length,
    };
  });
}

function chainedStacks(prs: ChangeRequestStub[]): Stack[] {
  const candidates = prs.filter((pr) => !pr.nativeStack);
  const byHead = new Map(candidates.map((pr) => [`${pr.repo}\u0000${pr.headRefName}`, pr]));
  const parentOf = new Map<string, ChangeRequestStub>();
  for (const pr of candidates) {
    const parent = byHead.get(`${pr.repo}\u0000${pr.baseRefName}`);
    if (parent && parent.id !== pr.id) parentOf.set(pr.id, parent);
  }

  const rootOf = (pr: ChangeRequestStub): ChangeRequestStub => {
    const seen = new Set<string>();
    let current = pr;
    while (parentOf.has(current.id) && !seen.has(current.id)) {
      seen.add(current.id);
      current = parentOf.get(current.id)!;
    }
    return current;
  };

  const groups = new Map<string, ChangeRequestStub[]>();
  for (const pr of candidates) {
    const isChild = parentOf.has(pr.id);
    const isParent = [...parentOf.values()].some((parent) => parent.id === pr.id);
    if (!isChild && !isParent) continue;
    const root = rootOf(pr);
    groups.set(root.id, [...(groups.get(root.id) ?? []), pr]);
  }

  return [...groups].map(([rootId, group]) => {
    const root = group.find((pr) => pr.id === rootId) ?? group[0]!;
    const ordered = [...group].sort((a, b) => a.number - b.number);
    return {
      id: `${root.repo}#chain-${root.number}`,
      repo: root.repo,
      native: false,
      baseRefName: root.baseRefName,
      members: ordered.map((pr) => ({ id: pr.id, parentId: pr.id === root.id ? null : parentOf.get(pr.id)?.id ?? null })),
      notOpenCount: 0,
    };
  });
}

export function detectStacks(prs: ChangeRequestStub[]): Stack[] {
  return [...nativeStacks(prs), ...chainedStacks(prs)].filter((stack) => stack.members.length >= 2);
}

export function stackIndex(stacks: Stack[]): Map<string, { stack: Stack; parentId: string | null }> {
  const index = new Map<string, { stack: Stack; parentId: string | null }>();
  for (const stack of stacks) for (const member of stack.members) index.set(member.id, { stack, parentId: member.parentId });
  return index;
}

export function membersBottomUp(stack: Stack): string[] {
  const depth = new Map<string, number>();
  const parentOf = new Map(stack.members.map((member) => [member.id, member.parentId]));
  const depthOf = (id: string, guard = 0): number => {
    if (depth.has(id)) return depth.get(id)!;
    const parent = parentOf.get(id);
    const value = parent && guard < stack.members.length ? depthOf(parent, guard + 1) + 1 : 0;
    depth.set(id, value);
    return value;
  };
  return stack.members
    .map((member, order) => ({ id: member.id, depth: depthOf(member.id), order }))
    .sort((a, b) => a.depth - b.depth || a.order - b.order)
    .map((entry) => entry.id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run shared/__tests__/stacks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "Detect native and branch-chained PR stacks."
```

---

### Task 5: View models and grouping

**Files:**
- Create: `shared/grouping.ts`, `shared/__tests__/grouping.test.ts`

**Interfaces:**
- Consumes: `signalsOf`, `blockersOf`, `bucketOf`, `Signal`, `Blocker`, `Bucket` (Task 2); `ticketKeyOf` (Task 3); `ageHours` (Task 3); `detectStacks`, `stackIndex`, `membersBottomUp`, `Stack` (Task 4); `Snapshot`, `ChangeRequest` (Task 1).
- Produces:
  - `type GroupBy = 'author' | 'repo' | 'ticket'`
  - `interface ViewFilters { show: Record<Bucket, boolean>; q: string; newestFirst: boolean }`, `DEFAULT_FILTERS: ViewFilters` (drafts hidden)
  - `interface PrView { pr: ChangeRequest; signals: Signal[]; blockers: Blocker[]; bucket: Bucket; ageHours: number; ticket: string | null; stackedOn: number | null }`
  - `type Unit = { kind: 'pr'; view: PrView } | { kind: 'stack'; stack: Stack; lead: PrView; membersTopDown: PrView[] }`
  - `interface LaneModel { key: string; title: string; icon: 'avatar' | 'bot' | 'repo' | 'ticket' | 'team' | 'section'; avatarUrl?: string; counts: Record<Bucket, number>; units: Unit[]; defaultCollapsed: boolean }`
  - `buildPrViews(snapshot: Snapshot, now: number): Map<string, PrView>`
  - `buildOverviewLanes(snapshot, opts: { groupBy: GroupBy; filters: ViewFilters; now: number }): LaneModel[]`
  - `buildMineLanes(snapshot, opts: { filters: ViewFilters; now: number }): LaneModel[]`
  - `relatedByTicket(snapshot, prId: string, now: number): PrView[]`

- [ ] **Step 1: Write the failing tests**

`shared/__tests__/grouping.test.ts`:
```ts
import { buildMineLanes, buildOverviewLanes, DEFAULT_FILTERS, relatedByTicket } from '../grouping';
import { emptySnapshot, type ChangeRequest, type Snapshot } from '../types';
import { makePerson, makePr } from '../../test/factories';

const now = Date.parse('2026-11-18T12:00:00Z');
const allBuckets = { ...DEFAULT_FILTERS, show: { blocked: true, waiting: true, ready: true, draft: true } };

function snapshotOf(prs: ChangeRequest[], extra: Partial<Snapshot> = {}): Snapshot {
  return { ...emptySnapshot('acme'), prs, overviewIds: prs.map((pr) => pr.id), ...extra };
}

describe('buildOverviewLanes', () => {
  const alex = makePerson('alex');
  const sam = makePerson('sam');
  const dependabot = makePerson('dependabot', 'bot');

  it('groups by author, puts bots in one collapsed lane last, and orders lanes by blocked count', () => {
    const snapshot = snapshotOf([
      makePr({ author: alex }),
      makePr({ author: sam, mergeState: 'conflicts' }),
      makePr({ author: sam, mergeState: 'conflicts' }),
      makePr({ author: dependabot, mergeState: 'conflicts' }),
      makePr({ author: dependabot, mergeState: 'conflicts' }),
      makePr({ author: dependabot, mergeState: 'conflicts' }),
    ]);

    const lanes = buildOverviewLanes(snapshot, { groupBy: 'author', filters: allBuckets, now });

    expect(lanes.map((lane) => [lane.title, lane.icon, lane.defaultCollapsed])).toEqual([
      ['sam', 'avatar', false],
      ['alex', 'avatar', false],
      ['Bots', 'bot', true],
    ]);
    expect(lanes[0]!.counts).toEqual({ blocked: 2, waiting: 0, ready: 0, draft: 0 });
    expect(lanes[0]!.avatarUrl).toBe(sam.avatarUrl);
  });

  it('groups by repository and by ticket with a "No ticket" lane last', () => {
    const snapshot = snapshotOf([
      makePr({ repo: 'orders-api', headRefName: 'XX-1-backend' }),
      makePr({ repo: 'orders-web', headRefName: 'XX-1-frontend' }),
      makePr({ repo: 'orders-web', headRefName: 'no-key' }),
    ]);
    expect(buildOverviewLanes(snapshot, { groupBy: 'repo', filters: allBuckets, now }).map((lane) => lane.title).sort())
      .toEqual(['orders-api', 'orders-web']);
    const byTicket = buildOverviewLanes(snapshot, { groupBy: 'ticket', filters: allBuckets, now });
    expect(byTicket.map((lane) => [lane.title, lane.units.length])).toEqual([['XX-1', 2], ['No ticket', 1]]);
  });

  it('sorts rows blocked, waiting, ready, then oldest first, and flips age order on request', () => {
    const ready = makePr({ createdAt: '2026-11-01T00:00:00Z' });
    const waitingOld = makePr({ reviewDecision: 'review_required', createdAt: '2026-10-01T00:00:00Z' });
    const waitingNew = makePr({ reviewDecision: 'review_required', createdAt: '2026-11-10T00:00:00Z' });
    const blocked = makePr({ mergeState: 'conflicts', createdAt: '2026-11-17T00:00:00Z' });
    const snapshot = snapshotOf([ready, waitingNew, blocked, waitingOld]);

    const ids = (newestFirst: boolean) => buildOverviewLanes(snapshot, { groupBy: 'author', filters: { ...allBuckets, newestFirst }, now })[0]!
      .units.map((unit) => (unit.kind === 'pr' ? unit.view.pr.id : unit.stack.id));

    expect(ids(false)).toEqual([blocked.id, waitingOld.id, waitingNew.id, ready.id]);
    expect(ids(true)).toEqual([blocked.id, waitingNew.id, waitingOld.id, ready.id]);
  });

  it('hides drafts by default but keeps them in the lane counts, and filters by search text', () => {
    const draft = makePr({ isDraft: true, title: 'Raise memory limits' });
    const visible = makePr({ title: 'Add scheduler lock' });
    const snapshot = snapshotOf([draft, visible]);

    const [lane] = buildOverviewLanes(snapshot, { groupBy: 'author', filters: DEFAULT_FILTERS, now });
    expect(lane!.units).toHaveLength(1);
    expect(lane!.counts.draft).toBe(1);

    const [searched] = buildOverviewLanes(snapshot, { groupBy: 'author', filters: { ...allBuckets, q: 'memory' }, now });
    expect(searched!.units.map((unit) => unit.kind === 'pr' && unit.view.pr.id)).toEqual([draft.id]);
  });

  it('collapses a stack into one unit placed by its lowest PR, with members top-down and "stacked on" set', () => {
    const lock = makePr({ number: 3420, headRefName: 'scheduler-lock', mergeState: 'conflicts' });
    const settings = makePr({ number: 3421, headRefName: 'lock-settings', baseRefName: 'scheduler-lock' });
    const snapshot = snapshotOf([settings, lock]);

    const [lane] = buildOverviewLanes(snapshot, { groupBy: 'author', filters: allBuckets, now });

    expect(lane!.units).toHaveLength(1);
    const unit = lane!.units[0]!;
    if (unit.kind !== 'stack') throw new Error('expected a stack unit');
    expect(unit.lead.pr.number).toBe(3420);
    expect(unit.membersTopDown.map((view) => view.pr.number)).toEqual([3421, 3420]);
    expect(unit.membersTopDown[0]!.stackedOn).toBe(3420);
    expect(unit.membersTopDown[1]!.stackedOn).toBeNull();
  });

  it('only shows PRs from the selected repositories', () => {
    const shown = makePr();
    const mineOnly = makePr();
    const snapshot = snapshotOf([shown, mineOnly], { overviewIds: [shown.id] });
    const [lane] = buildOverviewLanes(snapshot, { groupBy: 'author', filters: allBuckets, now });
    expect(lane!.units).toHaveLength(1);
  });
});

describe('buildMineLanes', () => {
  it('returns my PRs, requests to me, and team requests without duplicates, with the team lane collapsed', () => {
    const mine = makePr();
    const requested = makePr();
    const teamOnly = makePr();
    const snapshot = snapshotOf([mine, requested, teamOnly], {
      viewer: { login: 'alex', avatarUrl: 'https://avatars.example.test/alex', teams: [{ slug: 'platform-team', avatarUrl: 'team.png' }] },
      mine: { authored: [mine.id], requested: [requested.id], team: [requested.id, teamOnly.id] },
    });

    const lanes = buildMineLanes(snapshot, { filters: allBuckets, now });

    expect(lanes.map((lane) => [lane.title, lane.icon, lane.units.length, lane.defaultCollapsed])).toEqual([
      ['My PRs', 'avatar', 1, false],
      ['Review requested from me', 'section', 1, false],
      ['Review requested from platform-team', 'team', 1, true],
    ]);
    expect(lanes[0]!.avatarUrl).toBe('https://avatars.example.test/alex');
    expect(lanes[2]!.avatarUrl).toBe('team.png');
  });
});

describe('relatedByTicket', () => {
  it('finds other open PRs with the same key in any repository', () => {
    const backend = makePr({ repo: 'orders-api', headRefName: 'XX-7-api' });
    const frontend = makePr({ repo: 'orders-web', headRefName: 'XX-7-ui' });
    const unrelated = makePr({ headRefName: 'XX-8-other' });
    const related = relatedByTicket(snapshotOf([backend, frontend, unrelated]), backend.id, now);
    expect(related.map((view) => view.pr.id)).toEqual([frontend.id]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run shared/__tests__/grouping.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `shared/grouping.ts`**

```ts
import { ageHours } from './age';
import { blockersOf, bucketOf, signalsOf, type Blocker, type Bucket, type Signal } from './status';
import { detectStacks, membersBottomUp, stackIndex, type Stack } from './stacks';
import { ticketKeyOf } from './tickets';
import type { ChangeRequest, Snapshot } from './types';

export type GroupBy = 'author' | 'repo' | 'ticket';
export interface ViewFilters { show: Record<Bucket, boolean>; q: string; newestFirst: boolean }
export const DEFAULT_FILTERS: ViewFilters = { show: { blocked: true, waiting: true, ready: true, draft: false }, q: '', newestFirst: false };

export interface PrView {
  pr: ChangeRequest;
  signals: Signal[];
  blockers: Blocker[];
  bucket: Bucket;
  ageHours: number;
  ticket: string | null;
  stackedOn: number | null;
}
export type Unit =
  | { kind: 'pr'; view: PrView }
  | { kind: 'stack'; stack: Stack; lead: PrView; membersTopDown: PrView[] };
export interface LaneModel {
  key: string;
  title: string;
  icon: 'avatar' | 'bot' | 'repo' | 'ticket' | 'team' | 'section';
  avatarUrl?: string;
  counts: Record<Bucket, number>;
  units: Unit[];
  defaultCollapsed: boolean;
}

const BUCKET_ORDER: Record<Bucket, number> = { blocked: 0, waiting: 1, ready: 2, draft: 3 };
const emptyCounts = (): Record<Bucket, number> => ({ blocked: 0, waiting: 0, ready: 0, draft: 0 });

export function buildPrViews(snapshot: Snapshot, now: number): Map<string, PrView> {
  const stacks = stackIndex(detectStacks(snapshot.prs));
  const byId = new Map(snapshot.prs.map((pr) => [pr.id, pr]));
  const views = new Map<string, PrView>();
  for (const pr of snapshot.prs) {
    const parentId = stacks.get(pr.id)?.parentId ?? null;
    views.set(pr.id, {
      pr,
      signals: signalsOf(pr),
      blockers: blockersOf(pr),
      bucket: bucketOf(pr),
      ageHours: ageHours(pr.createdAt, now),
      ticket: ticketKeyOf(pr),
      stackedOn: parentId ? byId.get(parentId)?.number ?? null : null,
    });
  }
  return views;
}

const matchesSearch = (view: PrView, q: string) =>
  !q || `${view.pr.title} ${view.pr.repo} #${view.pr.number} ${view.pr.headRefName}`.toLowerCase().includes(q.toLowerCase());

function buildUnits(views: PrView[], filters: ViewFilters, stacks: Stack[]): Unit[] {
  const inLane = new Map(views.map((view) => [view.pr.id, view]));
  const consumed = new Set<string>();
  const units: Unit[] = [];

  for (const stack of stacks) {
    const members = membersBottomUp(stack).map((id) => inLane.get(id)).filter((view): view is PrView => !!view);
    if (members.length < 2) continue;
    members.forEach((view) => consumed.add(view.pr.id));
    units.push({ kind: 'stack', stack, lead: members[0]!, membersTopDown: [...members].reverse() });
  }
  for (const view of views) if (!consumed.has(view.pr.id)) units.push({ kind: 'pr', view });

  const visible = units.filter((unit) => {
    const lead = unit.kind === 'pr' ? unit.view : unit.lead;
    const members = unit.kind === 'pr' ? [unit.view] : unit.membersTopDown;
    return filters.show[lead.bucket] && members.some((view) => matchesSearch(view, filters.q));
  });
  const leadOf = (unit: Unit) => (unit.kind === 'pr' ? unit.view : unit.lead);
  return visible.sort((a, b) => {
    const leadA = leadOf(a);
    const leadB = leadOf(b);
    const byBucket = BUCKET_ORDER[leadA.bucket] - BUCKET_ORDER[leadB.bucket];
    if (byBucket) return byBucket;
    return filters.newestFirst ? leadA.ageHours - leadB.ageHours : leadB.ageHours - leadA.ageHours;
  });
}

function lane(key: string, title: string, icon: LaneModel['icon'], views: PrView[], filters: ViewFilters, stacks: Stack[], extra: Partial<LaneModel> = {}): LaneModel {
  const counts = emptyCounts();
  views.forEach((view) => (counts[view.bucket] += 1));
  return { key, title, icon, counts, units: buildUnits(views, filters, stacks), defaultCollapsed: false, ...extra };
}

export function buildOverviewLanes(snapshot: Snapshot, opts: { groupBy: GroupBy; filters: ViewFilters; now: number }): LaneModel[] {
  const views = buildPrViews(snapshot, opts.now);
  const stacks = detectStacks(snapshot.prs);
  const overview = snapshot.overviewIds.map((id) => views.get(id)).filter((view): view is PrView => !!view);

  const groups = new Map<string, { title: string; icon: LaneModel['icon']; avatarUrl?: string; last: boolean; views: PrView[] }>();
  for (const view of overview) {
    const isBot = view.pr.author.kind !== 'human';
    const key =
      opts.groupBy === 'repo' ? `repo:${view.pr.repo}`
      : opts.groupBy === 'ticket' ? `ticket:${view.ticket ?? ''}`
      : isBot ? 'bots' : `author:${view.pr.author.login}`;
    if (!groups.has(key)) {
      groups.set(key,
        opts.groupBy === 'repo' ? { title: view.pr.repo, icon: 'repo', last: false, views: [] }
        : opts.groupBy === 'ticket' ? { title: view.ticket ?? 'No ticket', icon: 'ticket', last: !view.ticket, views: [] }
        : isBot ? { title: 'Bots', icon: 'bot', last: true, views: [] }
        : { title: view.pr.author.name ?? view.pr.author.login, icon: 'avatar', avatarUrl: view.pr.author.avatarUrl, last: false, views: [] });
    }
    groups.get(key)!.views.push(view);
  }

  return [...groups]
    .map(([key, group]) => ({
      group,
      model: lane(key, group.title, group.icon, group.views, opts.filters, stacks, {
        avatarUrl: group.avatarUrl,
        defaultCollapsed: key === 'bots',
      }),
    }))
    .sort((a, b) => Number(a.group.last) - Number(b.group.last) || b.model.counts.blocked - a.model.counts.blocked || a.model.title.localeCompare(b.model.title))
    .map((entry) => entry.model);
}

export function buildMineLanes(snapshot: Snapshot, opts: { filters: ViewFilters; now: number }): LaneModel[] {
  const views = buildPrViews(snapshot, opts.now);
  const stacks = detectStacks(snapshot.prs);
  const pick = (ids: string[]) => ids.map((id) => views.get(id)).filter((view): view is PrView => !!view);
  const requested = new Set(snapshot.mine.requested);
  const teams = snapshot.viewer?.teams ?? [];
  const teamTitle = teams.length ? teams.map((team) => team.slug).join(', ') : 'my team';

  return [
    lane('mine:authored', 'My PRs', 'avatar', pick(snapshot.mine.authored), opts.filters, stacks, { avatarUrl: snapshot.viewer?.avatarUrl }),
    lane('mine:requested', 'Review requested from me', 'section', pick(snapshot.mine.requested), opts.filters, stacks),
    lane('mine:team', `Review requested from ${teamTitle}`, 'team', pick(snapshot.mine.team.filter((id) => !requested.has(id))), opts.filters, stacks, {
      avatarUrl: teams[0]?.avatarUrl,
      defaultCollapsed: true,
    }),
  ];
}

export function relatedByTicket(snapshot: Snapshot, prId: string, now: number): PrView[] {
  const views = buildPrViews(snapshot, now);
  const ticket = views.get(prId)?.ticket;
  if (!ticket) return [];
  return [...views.values()].filter((view) => view.ticket === ticket && view.pr.id !== prId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run shared/__tests__/grouping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "Build lane view models for Overview and Mine."
```

---

### Task 6: Provider contract and the `gh` runner

**Files:**
- Create: `server/providers/types.ts`, `server/gh.ts`, `server/__tests__/gh.test.ts`

**Interfaces:**
- Consumes: `ChangeRequest`, `ChangeRequestStub`, `RepoRef`, `Viewer` (Task 1).
- Produces (`server/providers/types.ts`):
  - `class ProviderError extends Error { kind: ProviderErrorKind }` with `type ProviderErrorKind = 'missing-cli' | 'auth' | 'rate-limit' | 'too-large' | 'failed'`
  - `interface ReviewerClasses { 'ai-review': string[]; 'code-analysis': string[] }`
  - `type AuthResult = { ok: true; viewer: Viewer } | { ok: false; reason: 'missing-cli' | 'auth' | 'failed'; message: string }`
  - `type MineKind = 'authored' | 'review-requested' | 'team-review-requested'`
  - `interface NativeStackEntries { number: number; baseRefName: string; entries: { position: number; number: number; title: string; state: 'open' | 'merged' | 'closed' }[] }`
  - `interface CodeHostProvider` (exact members below)
- Produces (`server/gh.ts`):
  - `type ProcessRunner = (args: string[], stdin?: string) => Promise<{ code: number; stdout: string; stderr: string }>`
  - `spawnGh: ProcessRunner`
  - `interface GhClient { graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>; rest<T>(path: string): Promise<T> }`
  - `createGhClient(run?: ProcessRunner): GhClient`

- [ ] **Step 1: Write the provider contract types**

`server/providers/types.ts`:
```ts
import type { ChangeRequest, ChangeRequestStub, RepoRef, Viewer } from '../../shared/types';

export type ProviderErrorKind = 'missing-cli' | 'auth' | 'rate-limit' | 'too-large' | 'failed';

export class ProviderError extends Error {
  constructor(public readonly kind: ProviderErrorKind, message: string) {
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
```

- [ ] **Step 2: Write the failing runner tests**

`server/__tests__/gh.test.ts`:
```ts
import { createGhClient, type ProcessRunner } from '../gh';
import { ProviderError } from '../providers/types';

const respond = (stdout: string, code = 0, stderr = ''): ProcessRunner => async () => ({ code, stdout, stderr });

describe('createGhClient', () => {
  it('sends GraphQL through stdin and returns the data object', async () => {
    const calls: { args: string[]; stdin?: string }[] = [];
    const client = createGhClient(async (args, stdin) => {
      calls.push({ args, stdin });
      return { code: 0, stdout: JSON.stringify({ data: { viewer: { login: 'alex' } } }), stderr: '' };
    });

    const data = await client.graphql<{ viewer: { login: string } }>('query { viewer { login } }', { first: 1 });

    expect(data.viewer.login).toBe('alex');
    expect(calls[0]!.args).toEqual(['api', 'graphql', '--input', '-']);
    expect(JSON.parse(calls[0]!.stdin!)).toEqual({ query: 'query { viewer { login } }', variables: { first: 1 } });
  });

  it('reports a missing gh binary as missing-cli', async () => {
    const client = createGhClient(async () => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); });
    await expect(client.graphql('query {}')).rejects.toMatchObject({ kind: 'missing-cli' });
  });

  it('reports a logged-out gh as auth', async () => {
    const client = createGhClient(respond('', 4, 'To get started with GitHub CLI, please run:  gh auth login'));
    await expect(client.graphql('query {}')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('reports resource limits and gateway timeouts as too-large so callers can shrink the batch', async () => {
    const limits = createGhClient(respond(JSON.stringify({ errors: [{ message: 'Resource limits for this query exceeded.' }] }), 1));
    await expect(limits.graphql('query {}')).rejects.toMatchObject({ kind: 'too-large' });
    const gateway = createGhClient(respond('', 1, 'gh: HTTP 502: Bad Gateway'));
    await expect(gateway.graphql('query {}')).rejects.toMatchObject({ kind: 'too-large' });
  });

  it('reports rate limiting as rate-limit', async () => {
    const client = createGhClient(respond(JSON.stringify({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }), 1));
    await expect(client.graphql('query {}')).rejects.toMatchObject({ kind: 'rate-limit' });
  });

  it('returns partial data when only some aliases were not found or forbidden', async () => {
    const body = { data: { r0: { name: 'kept' }, r1: null }, errors: [{ type: 'NOT_FOUND', message: "Could not resolve to a Repository with the name 'acme/gone'." }] };
    const client = createGhClient(respond(JSON.stringify(body), 1));
    expect(await client.graphql('query {}')).toEqual({ r0: { name: 'kept' }, r1: null });
  });

  it('reports other GraphQL errors as failed and keeps their message', async () => {
    const client = createGhClient(respond(JSON.stringify({ errors: [{ message: "Field 'nope' doesn't exist" }] }), 1));
    const error = await client.graphql('query {}').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: 'failed', message: "Field 'nope' doesn't exist" });
  });

  it('calls REST paths with gh api and parses the JSON', async () => {
    const calls: string[][] = [];
    const client = createGhClient(async (args) => {
      calls.push(args);
      return { code: 0, stdout: '{"behind_by":3}', stderr: '' };
    });
    expect(await client.rest<{ behind_by: number }>('repos/acme/app/compare/a...b')).toEqual({ behind_by: 3 });
    expect(calls[0]).toEqual(['api', 'repos/acme/app/compare/a...b']);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/gh.test.ts`
Expected: FAIL, module `../gh` not found.

- [ ] **Step 4: Implement `server/gh.ts`**

```ts
import { spawn } from 'node:child_process';
import { ProviderError } from './providers/types';

export interface ProcessResult { code: number; stdout: string; stderr: string }
export type ProcessRunner = (args: string[], stdin?: string) => Promise<ProcessResult>;

export const spawnGh: ProcessRunner = (args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(stdin ?? '');
  });

export interface GhClient {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
  rest<T>(path: string): Promise<T>;
}

function parseJson(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

const TOLERATED_ERROR_TYPES = new Set(['NOT_FOUND', 'FORBIDDEN']);

function classify(result: ProcessResult): ProviderError | null {
  const body = parseJson(result.stdout);
  const errors: { type?: string; message: string }[] | undefined = body?.errors;
  // One renamed repo or deleted PR in an aliased query must not fail the whole refresh; its alias is simply null.
  if (errors?.length && body?.data && errors.every((error) => TOLERATED_ERROR_TYPES.has(error.type ?? ''))) return null;
  if (errors?.length) {
    const message = errors.map((error) => error.message).join('; ');
    if (errors.some((error) => error.type === 'RATE_LIMITED') || /rate limit/i.test(message)) return new ProviderError('rate-limit', message);
    if (/resource limits/i.test(message)) return new ProviderError('too-large', message);
    return new ProviderError('failed', message);
  }
  if (result.code === 0) return null;
  const stderr = result.stderr.trim();
  if (/gh auth login|not logged in|HTTP 401|authentication required/i.test(stderr)) return new ProviderError('auth', 'gh is not logged in. Run `gh auth login`.');
  // Large GraphQL pages time out at GitHub's gateway rather than returning an error body.
  if (/HTTP 50[24]|timeout/i.test(stderr)) return new ProviderError('too-large', stderr);
  if (/rate limit/i.test(stderr)) return new ProviderError('rate-limit', stderr);
  return new ProviderError('failed', stderr || `gh exited with code ${result.code}`);
}

async function run(runner: ProcessRunner, args: string[], stdin?: string): Promise<ProcessResult> {
  try {
    return await runner(args, stdin);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ProviderError('missing-cli', 'The GitHub CLI (gh) is not installed or not on PATH.');
    }
    throw error;
  }
}

export function createGhClient(runner: ProcessRunner = spawnGh): GhClient {
  return {
    async graphql<T>(query: string, variables: Record<string, unknown> = {}) {
      const result = await run(runner, ['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables }));
      const error = classify(result);
      if (error) throw error;
      return parseJson(result.stdout).data as T;
    },
    async rest<T>(path: string) {
      const result = await run(runner, ['api', path]);
      const error = classify(result);
      if (error) throw error;
      return parseJson(result.stdout) as T;
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/gh.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "Add the code host provider contract and the gh process runner."
```

---

### Task 7: GitHub → neutral mapping

**Files:**
- Create: `server/providers/codehost/github/mapping.ts`, `server/providers/codehost/github/fixtures/full-pr.json`, `server/providers/codehost/github/__tests__/mapping.test.ts`

**Interfaces:**
- Consumes: `ReviewerClasses` (Task 6); neutral types (Task 1); `signalsOf` (Task 2) in the test only.
- Produces:
  - `classifyActor(login: string, typename: string, classes: ReviewerClasses): ActorKind`
  - `toStub(raw: any): ChangeRequestStub`
  - `toChangeRequest(raw: any, classes: ReviewerClasses): ChangeRequest`

- [ ] **Step 1: Add the anonymised fixture**

This is the shape of one PR node returned by the full-field query in Task 8. Field names must match the query exactly.

`server/providers/codehost/github/fixtures/full-pr.json`:
```json
{
  "id": "PR_kwDOAAAA4988",
  "number": 4988,
  "title": "Use offline mode when it is available",
  "url": "https://github.com/acme/field-app/pull/4988",
  "createdAt": "2026-10-27T09:00:00Z",
  "updatedAt": "2026-11-17T15:00:00Z",
  "isDraft": false,
  "headRefOid": "abc123",
  "headRefName": "XX-412-offline-mode",
  "baseRefName": "XX-411-prefetch-profile-data",
  "repository": { "name": "field-app" },
  "mergeable": "MERGEABLE",
  "mergeStateStatus": "BLOCKED",
  "reviewDecision": "REVIEW_REQUIRED",
  "author": { "login": "dev-one_acme", "__typename": "User", "avatarUrl": "https://avatars.example.test/u/1?v=4", "name": "Dev One" },
  "stack": { "number": 4964, "size": 26, "baseRefName": "main" },
  "stackEntry": { "position": 15 },
  "comments": { "totalCount": 4 },
  "commits": { "nodes": [ { "commit": { "statusCheckRollup": { "contexts": { "nodes": [
    { "__typename": "CheckRun", "name": "build", "status": "COMPLETED", "conclusion": "SUCCESS", "detailsUrl": "https://example.test/runs/1", "isRequired": true },
    { "__typename": "CheckRun", "name": "e2e-android", "status": "IN_PROGRESS", "conclusion": null, "detailsUrl": "https://example.test/runs/2", "isRequired": true },
    { "__typename": "CheckRun", "name": "lint-extra", "status": "COMPLETED", "conclusion": "FAILURE", "detailsUrl": "https://example.test/runs/3", "isRequired": false },
    { "__typename": "StatusContext", "context": "codescene/delta", "state": "SUCCESS", "targetUrl": "https://example.test/cs", "isRequired": false }
  ] } } } } ] },
  "reviews": { "nodes": [
    { "state": "COMMENTED", "submittedAt": "2026-11-16T10:00:00Z", "author": { "login": "copilot-pull-request-reviewer", "__typename": "Bot", "avatarUrl": "https://avatars.example.test/in/946600?v=4" } },
    { "state": "APPROVED", "submittedAt": "2026-11-16T11:00:00Z", "author": { "login": "codescene-access", "__typename": "Bot", "avatarUrl": "https://avatars.example.test/in/3755875?v=4" } },
    { "state": "PENDING", "submittedAt": null, "author": { "login": "dev-two_acme", "__typename": "User", "avatarUrl": "https://avatars.example.test/u/2?v=4" } }
  ] },
  "reviewThreads": { "nodes": [
    { "isResolved": false, "comments": { "nodes": [ { "bodyText": "syncQueue is never cleared when the user signs out.", "url": "https://example.test/t/1", "author": { "login": "copilot-pull-request-reviewer", "__typename": "Bot", "avatarUrl": "https://avatars.example.test/in/946600?v=4" } } ] } },
    { "isResolved": false, "comments": { "nodes": [ { "bodyText": "Can this run twice?", "url": "https://example.test/t/2", "author": { "login": "dev-two_acme", "__typename": "User", "avatarUrl": "https://avatars.example.test/u/2?v=4" } } ] } },
    { "isResolved": true, "comments": { "nodes": [ { "bodyText": "Rename this.", "url": "https://example.test/t/3", "author": { "login": "dev-two_acme", "__typename": "User", "avatarUrl": "https://avatars.example.test/u/2?v=4" } } ] } }
  ] },
  "reviewRequests": { "nodes": [
    { "requestedReviewer": { "__typename": "Team", "slug": "platform-team", "avatarUrl": "https://avatars.example.test/t/1?v=4" } },
    { "requestedReviewer": { "__typename": "User", "login": "dev-three_acme", "avatarUrl": "https://avatars.example.test/u/3?v=4" } }
  ] }
}
```

- [ ] **Step 2: Write the failing tests**

`server/providers/codehost/github/__tests__/mapping.test.ts`:
```ts
import { classifyActor, toChangeRequest, toStub } from '../mapping';
import { signalsOf } from '../../../../../shared/status';
import fullPr from '../fixtures/full-pr.json';

const classes = { 'ai-review': ['copilot-pull-request-reviewer'], 'code-analysis': ['codescene-*'] };

describe('classifyActor', () => {
  it('uses configured classes, supports a trailing wildcard, and falls back by type', () => {
    expect(classifyActor('copilot-pull-request-reviewer', 'Bot', classes)).toBe('ai-review');
    expect(classifyActor('codescene-delta-analysis', 'Bot', classes)).toBe('code-analysis');
    expect(classifyActor('dependabot', 'Bot', classes)).toBe('bot');
    expect(classifyActor('dev-one_acme', 'User', classes)).toBe('human');
  });
});

describe('toChangeRequest', () => {
  const pr = toChangeRequest(fullPr, classes);

  it('maps identity, refs and the native stack', () => {
    expect(pr).toMatchObject({
      id: 'PR_kwDOAAAA4988', provider: 'github', repo: 'field-app', number: 4988, headSha: 'abc123',
      headRefName: 'XX-412-offline-mode', baseRefName: 'XX-411-prefetch-profile-data', commentCount: 4,
      nativeStack: { number: 4964, size: 26, position: 15, baseRefName: 'main' },
      author: { login: 'dev-one_acme', name: 'Dev One', kind: 'human', avatarUrl: 'https://avatars.example.test/u/1?v=4' },
    });
  });

  it('maps merge state and review decision to neutral values', () => {
    expect(pr.mergeState).toBe('blocked');
    expect(pr.reviewDecision).toBe('review_required');
  });

  it('maps check runs and status contexts, keeping the required flag', () => {
    expect(pr.checks).toEqual([
      { name: 'build', state: 'success', required: true, url: 'https://example.test/runs/1' },
      { name: 'e2e-android', state: 'pending', required: true, url: 'https://example.test/runs/2' },
      { name: 'lint-extra', state: 'failure', required: false, url: 'https://example.test/runs/3' },
      { name: 'codescene/delta', state: 'success', required: false, url: 'https://example.test/cs' },
    ]);
  });

  it('drops pending reviews and classifies reviewers', () => {
    expect(pr.reviews.map((review) => [review.author.login, review.author.kind, review.state])).toEqual([
      ['copilot-pull-request-reviewer', 'ai-review', 'commented'],
      ['codescene-access', 'code-analysis', 'approved'],
    ]);
  });

  it('maps threads and review requests to people and teams', () => {
    expect(pr.threads.map((thread) => [thread.author.kind, thread.resolved])).toEqual([['ai-review', false], ['human', false], ['human', true]]);
    expect(pr.threads[0]!.snippet).toBe('syncQueue is never cleared when the user signs out.');
    expect(pr.reviewRequests).toEqual([
      { type: 'team', slug: 'platform-team', avatarUrl: 'https://avatars.example.test/t/1?v=4' },
      { type: 'person', person: { login: 'dev-three_acme', kind: 'human', avatarUrl: 'https://avatars.example.test/u/3?v=4' } },
    ]);
  });

  it('produces the expected signals end to end', () => {
    expect(signalsOf(pr).map((signal) => signal.color)).toEqual(['amber', 'amber', 'green', 'amber', 'amber', 'amber']);
  });

  it('treats CONFLICTING as conflicts even when the merge state says otherwise', () => {
    expect(toChangeRequest({ ...fullPr, mergeable: 'CONFLICTING', mergeStateStatus: 'BLOCKED' }, classes).mergeState).toBe('conflicts');
  });

  it('maps a deleted author to a ghost person', () => {
    expect(toChangeRequest({ ...fullPr, author: null }, classes).author).toEqual({ login: 'ghost', kind: 'human' });
  });
});

describe('toStub', () => {
  it('keeps only the cheap poll fields', () => {
    expect(toStub(fullPr)).toEqual({
      id: 'PR_kwDOAAAA4988', repo: 'field-app', number: 4988, updatedAt: '2026-11-17T15:00:00Z', headSha: 'abc123',
      headRefName: 'XX-412-offline-mode', baseRefName: 'XX-411-prefetch-profile-data', isDraft: false,
      nativeStack: { number: 4964, size: 26, position: 15, baseRefName: 'main' },
    });
  });

  it('omits nativeStack when the PR is not in a GitHub stack', () => {
    expect(toStub({ ...fullPr, stack: null, stackEntry: null }).nativeStack).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run server/providers/codehost/github/__tests__/mapping.test.ts`
Expected: FAIL, module `../mapping` not found.

- [ ] **Step 4: Implement `mapping.ts`**

```ts
import type { ActorKind, ChangeRequest, ChangeRequestStub, Check, MergeState, Person, Review, ReviewDecision, ReviewRequest, Thread } from '../../../../shared/types';
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
  const contexts: any[] = raw.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  const reviews: Review[] = (raw.reviews?.nodes ?? [])
    .filter((review: any) => REVIEW_STATES[review.state])
    .map((review: any) => ({ author: toPerson(review.author, classes), state: REVIEW_STATES[review.state]!, submittedAt: review.submittedAt }));
  const threads: Thread[] = (raw.reviewThreads?.nodes ?? []).map((thread: any) => {
    const first = thread.comments?.nodes?.[0];
    return { resolved: thread.isResolved, author: toPerson(first?.author, classes), snippet: (first?.bodyText ?? '').slice(0, 200), url: first?.url ?? raw.url };
  });
  const reviewRequests: ReviewRequest[] = (raw.reviewRequests?.nodes ?? [])
    .map((request: any) => request.requestedReviewer)
    .filter(Boolean)
    .map((reviewer: any): ReviewRequest =>
      reviewer.__typename === 'Team'
        ? { type: 'team', slug: reviewer.slug, avatarUrl: reviewer.avatarUrl }
        : { type: 'person', person: toPerson(reviewer, classes) });

  return {
    ...toStub(raw),
    provider: 'github',
    title: raw.title,
    url: raw.url,
    author: toPerson(raw.author, classes),
    createdAt: raw.createdAt,
    mergeState: toMergeState(raw.mergeable, raw.mergeStateStatus),
    reviewDecision: toReviewDecision(raw.reviewDecision),
    checks: contexts.map(toCheck),
    reviews,
    threads,
    reviewRequests,
    commentCount: raw.comments?.totalCount ?? 0,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/providers/codehost/github/__tests__/mapping.test.ts`
Expected: PASS. If the end-to-end signal test fails, re-derive it by hand from the fixture: CI amber (e2e running), Copilot amber (1 unresolved), CodeScene green, Review amber, Threads amber (1 human), Mergeable amber (blocked). Fix whichever side is wrong.

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "Map GitHub PR data to the neutral model."
```

---

### Task 8: GitHub provider (queries, batching, search) and contract suite

**Files:**
- Create: `server/providers/codehost/github/queries.ts`, `server/providers/codehost/github/provider.ts`, `server/providers/contract.ts`, `server/providers/registry.ts`, `server/providers/codehost/github/__tests__/provider.test.ts`, `scripts/smoke-github.ts`

**Interfaces:**
- Consumes: `GhClient` (Task 6), `ProviderError`, `CodeHostProvider`, `ReviewerClasses`, `MineKind` (Task 6), `toStub`, `toChangeRequest` (Task 7).
- Produces:
  - `class GithubProvider implements CodeHostProvider` with `constructor(gh: GhClient, org: string, classes: ReviewerClasses)`
  - `ENRICH_BATCH_SIZE = 25`
  - `describeCodeHostContract(label: string, setup: () => { provider: CodeHostProvider; repos: string[] }): void`
  - `createCodeHost(config: { codeHost: { provider: string; org: string }; reviewerClasses: ReviewerClasses }, gh: GhClient): CodeHostProvider`

- [ ] **Step 1: Write the queries**

`server/providers/codehost/github/queries.ts`:
```ts
const literal = (value: string) => JSON.stringify(value);
const PERSON = 'login __typename avatarUrl(size: 64)';
const RATE = 'rateLimit { remaining resetAt }';

export const LEAN_FIELDS =
  'id number updatedAt headRefOid headRefName baseRefName isDraft repository { name } stack { number size baseRefName } stackEntry { position }';

const OPEN_PRS = (after: string | null) =>
  `pullRequests(states: OPEN, first: 100${after ? `, after: ${literal(after)}` : ''}, orderBy: { field: UPDATED_AT, direction: DESC }) { pageInfo { hasNextPage endCursor } nodes { ${LEAN_FIELDS} } }`;

export function leanReposQuery(org: string, repos: string[]): string {
  const blocks = repos.map((repo, index) => `r${index}: repository(owner: ${literal(org)}, name: ${literal(repo)}) { ${OPEN_PRS(null)} }`);
  return `query { ${blocks.join('\n')} ${RATE} }`;
}

export function leanRepoPageQuery(org: string, repo: string, after: string): string {
  return `query { r0: repository(owner: ${literal(org)}, name: ${literal(repo)}) { ${OPEN_PRS(after)} } ${RATE} }`;
}

// isRequired needs the PR it is evaluated against, so each PR gets its own alias.
function fullFields(number: number): string {
  return `
    id number title url createdAt updatedAt isDraft headRefOid headRefName baseRefName
    repository { name } mergeable mergeStateStatus reviewDecision
    author { ${PERSON} ... on User { name } }
    stack { number size baseRefName } stackEntry { position }
    comments { totalCount }
    commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 30) { nodes { __typename
      ... on CheckRun { name status conclusion detailsUrl isRequired(pullRequestNumber: ${number}) }
      ... on StatusContext { context state targetUrl isRequired(pullRequestNumber: ${number}) } } } } } } }
    reviews(last: 10) { nodes { state submittedAt author { ${PERSON} } } }
    reviewThreads(first: 20) { nodes { isResolved comments(first: 1) { nodes { bodyText url author { ${PERSON} } } } } }
    reviewRequests(first: 5) { nodes { requestedReviewer { __typename
      ... on User { login avatarUrl(size: 64) } ... on Bot { login avatarUrl(size: 64) } ... on Team { slug avatarUrl(size: 64) } } } }`;
}

export function fullQuery(prs: { id: string; number: number }[]): string {
  const blocks = prs.map((pr, index) => `p${index}: node(id: ${literal(pr.id)}) { ... on PullRequest { ${fullFields(pr.number)} } }`);
  return `query { ${blocks.join('\n')} ${RATE} }`;
}

export const SEARCH_PRS_QUERY =
  `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 50, after: $after) { pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { ${LEAN_FIELDS} } } } ${RATE} }`;

export const ACTIVITY_QUERY =
  `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { repository { name } } } } ${RATE} }`;

export const VIEWER_QUERY = `query { viewer { login avatarUrl(size: 64) } ${RATE} }`;

export const TEAMS_QUERY =
  `query($org: String!, $login: String!) { organization(login: $org) { teams(first: 50, userLogins: [$login]) { nodes { slug avatarUrl(size: 64) } } } ${RATE} }`;

export const REPO_SEARCH_QUERY = `query($q: String!) { search(query: $q, type: REPOSITORY, first: 20) { nodes { ... on Repository { name } } } ${RATE} }`;

export function openCountsQuery(org: string, repos: string[]): string {
  const blocks = repos.map((repo, index) => `c${index}: repository(owner: ${literal(org)}, name: ${literal(repo)}) { pullRequests(states: OPEN) { totalCount } }`);
  return `query { ${blocks.join('\n')} ${RATE} }`;
}

export const NATIVE_STACK_QUERY =
  `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { stack { number baseRefName entries(first: 100) { nodes { position pullRequest { number title state } } } } } } ${RATE} }`;

export function mineSearch(org: string, kind: 'authored' | 'review-requested' | 'team-review-requested', team?: string): string {
  const base = `is:pr is:open archived:false org:${org}`;
  if (kind === 'authored') return `${base} author:@me`;
  // user-review-requested excludes team requests, which have their own section.
  if (kind === 'review-requested') return `${base} user-review-requested:@me`;
  return `${base} team-review-requested:${org}/${team}`;
}
```

- [ ] **Step 2: Write the contract suite and the failing provider tests**

`server/providers/contract.ts`:
```ts
import type { CodeHostProvider } from './types';

const MERGE_STATES = ['clean', 'blocked', 'unstable', 'conflicts', 'behind', 'unknown'];
const DECISIONS = ['approved', 'review_required', 'changes_requested', null];
const KINDS = ['human', 'ai-review', 'code-analysis', 'bot'];

/** Every CodeHostProvider must pass this with its own fixtures: provider data in, neutral model out. */
export function describeCodeHostContract(label: string, setup: () => { provider: CodeHostProvider; repos: string[] }) {
  describe(`${label} satisfies the CodeHostProvider contract`, () => {
    it('authenticates and reports the viewer', async () => {
      const { provider } = setup();
      const auth = await provider.checkAuth();
      expect(auth.ok).toBe(true);
      if (auth.ok) expect(typeof auth.viewer.login).toBe('string');
    });

    it('returns stubs only for the requested repositories', async () => {
      const { provider, repos } = setup();
      const stubs = await provider.pollLean(repos);
      expect(stubs.length).toBeGreaterThan(0);
      for (const stub of stubs) {
        expect(repos).toContain(stub.repo);
        expect(stub.number).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(stub.updatedAt))).toBe(false);
      }
    });

    it('returns neutral change requests for the stubs it is given', async () => {
      const { provider, repos } = setup();
      const stubs = await provider.pollLean(repos);
      const full = await provider.fetchFull(stubs);
      expect(full.map((pr) => pr.id).sort()).toEqual(stubs.map((stub) => stub.id).sort());
      for (const pr of full) {
        expect(MERGE_STATES).toContain(pr.mergeState);
        expect(DECISIONS).toContain(pr.reviewDecision);
        expect(KINDS).toContain(pr.author.kind);
        pr.reviews.forEach((review) => expect(KINDS).toContain(review.author.kind));
      }
    });

    it('reports a rate limit after a call', async () => {
      const { provider, repos } = setup();
      await provider.pollLean(repos);
      expect(provider.lastRateLimit()).not.toBeNull();
    });
  });
}
```

`server/providers/codehost/github/__tests__/provider.test.ts`:
```ts
import { GithubProvider, ENRICH_BATCH_SIZE } from '../provider';
import { describeCodeHostContract } from '../../../contract';
import { ProviderError } from '../../../types';
import type { GhClient } from '../../../../gh';
import fullPr from '../fixtures/full-pr.json';

const classes = { 'ai-review': ['copilot-pull-request-reviewer'], 'code-analysis': ['codescene-*'] };
const rateLimit = { remaining: 4990, resetAt: '2026-11-18T13:00:00Z' };
const leanNode = (number: number, repo = 'field-app') => ({ ...fullPr, id: `PR_${number}`, number, repository: { name: repo } });

/** Answers each query by its shape, so tests read like the GitHub conversation they simulate. */
function fakeGh(handlers: { match: RegExp; reply: (query: string, variables: Record<string, any>) => any }[]) {
  const queries: { query: string; variables: Record<string, any> }[] = [];
  const restPaths: string[] = [];
  const gh: GhClient = {
    async graphql(query, variables = {}) {
      queries.push({ query, variables });
      const handler = handlers.find((candidate) => candidate.match.test(query));
      if (!handler) throw new Error(`Unexpected query: ${query.slice(0, 80)}`);
      return handler.reply(query, variables);
    },
    async rest(path) {
      restPaths.push(path);
      return { behind_by: 3 } as any;
    },
  };
  return { gh, queries, restPaths };
}

const fullReply = (query: string) => {
  const reply: Record<string, any> = { rateLimit };
  for (const match of query.matchAll(/p(\d+): node\(id: "([^"]+)"\)/g)) reply[`p${match[1]}`] = { ...fullPr, id: match[2] };
  return reply;
};

const standardHandlers = [
  { match: /viewer \{ login/, reply: () => ({ viewer: { login: 'dev-one_acme', avatarUrl: 'https://avatars.example.test/1' }, rateLimit }) },
  { match: /organization\(login/, reply: () => ({ organization: { teams: { nodes: [{ slug: 'platform-team', avatarUrl: 'team.png' }] } }, rateLimit }) },
  { match: /r0: repository/, reply: () => ({ r0: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [leanNode(4988), leanNode(4989)] } }, rateLimit }) },
  { match: /node\(id:/, reply: fullReply },
];

describeCodeHostContract('GithubProvider', () => ({
  provider: new GithubProvider(fakeGh(standardHandlers).gh, 'acme', classes),
  repos: ['field-app'],
}));

describe('GithubProvider', () => {
  it('returns the viewer with their teams in the org', async () => {
    const provider = new GithubProvider(fakeGh(standardHandlers).gh, 'acme', classes);
    expect(await provider.checkAuth()).toEqual({
      ok: true,
      viewer: { login: 'dev-one_acme', avatarUrl: 'https://avatars.example.test/1', teams: [{ slug: 'platform-team', avatarUrl: 'team.png' }] },
    });
  });

  it('turns a logged-out gh into a failed auth result instead of throwing', async () => {
    const gh: GhClient = { graphql: async () => { throw new ProviderError('auth', 'gh is not logged in.'); }, rest: async () => ({}) as any };
    expect(await new GithubProvider(gh, 'acme', classes).checkAuth()).toEqual({ ok: false, reason: 'auth', message: 'gh is not logged in.' });
  });

  it('polls all repositories in one request and follows pagination per repository', async () => {
    const { gh, queries } = fakeGh([
      { match: /after: "cursor-1"/, reply: () => ({ r0: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [leanNode(3)] } }, rateLimit }) },
      {
        match: /r0: repository.*\n.*r1: repository/s,
        reply: () => ({
          r0: { pullRequests: { pageInfo: { hasNextPage: true, endCursor: 'cursor-1' }, nodes: [leanNode(1)] } },
          r1: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [leanNode(2, 'orders-api')] } },
          rateLimit,
        }),
      },
    ]);

    const stubs = await new GithubProvider(gh, 'acme', classes).pollLean(['field-app', 'orders-api']);

    // Each repository's extra pages are read before moving on to the next repository.
    expect(stubs.map((stub) => stub.number)).toEqual([1, 3, 2]);
    expect(queries).toHaveLength(2);
  });

  it('skips a repository that no longer exists', async () => {
    const { gh } = fakeGh([{ match: /r0: repository/, reply: () => ({ r0: null, rateLimit }) }]);
    expect(await new GithubProvider(gh, 'acme', classes).pollLean(['gone'])).toEqual([]);
  });

  it(`fetches full data in batches of ${ENRICH_BATCH_SIZE}`, async () => {
    const { gh, queries } = fakeGh([{ match: /node\(id:/, reply: fullReply }]);
    const stubs = Array.from({ length: 30 }, (_, index) => ({ ...leanNode(index + 1), headSha: 'x' })).map((node) => ({
      id: node.id, repo: 'field-app', number: node.number, updatedAt: node.updatedAt, headSha: 'x',
      headRefName: 'h', baseRefName: 'main', isDraft: false,
    }));

    const prs = await new GithubProvider(gh, 'acme', classes).fetchFull(stubs);

    expect(prs).toHaveLength(30);
    expect(queries.map((call) => (call.query.match(/node\(id:/g) ?? []).length)).toEqual([25, 5]);
    expect(queries[0]!.query).toContain('isRequired(pullRequestNumber: 1)');
  });

  it('halves the batch size when GitHub says a query is too large', async () => {
    let failures = 1;
    const { gh, queries } = fakeGh([{
      match: /node\(id:/,
      reply: (query) => {
        if (failures-- > 0) throw new ProviderError('too-large', 'Resource limits for this query exceeded.');
        return fullReply(query);
      },
    }]);
    const stubs = Array.from({ length: 20 }, (_, index) => ({
      id: `PR_${index}`, repo: 'r', number: index + 1, updatedAt: '2026-11-17T00:00:00Z', headSha: 'x', headRefName: 'h', baseRefName: 'main', isDraft: false,
    }));

    const prs = await new GithubProvider(gh, 'acme', classes).fetchFull(stubs);

    expect(prs).toHaveLength(20);
    expect(queries.map((call) => (call.query.match(/node\(id:/g) ?? []).length)).toEqual([20, 12, 8]);
  });

  it('builds the Mine searches with the right qualifiers', async () => {
    const { gh, queries } = fakeGh([{ match: /search\(query: \$q, type: ISSUE, first: 50/, reply: () => ({ search: { pageInfo: { hasNextPage: false }, nodes: [leanNode(7), {}] }, rateLimit }) }]);
    const provider = new GithubProvider(gh, 'acme', classes);

    const authored = await provider.searchMine('authored');
    await provider.searchMine('review-requested');
    await provider.searchMine('team-review-requested', 'platform-team');

    expect(authored.map((stub) => stub.number)).toEqual([7]);
    expect(queries.map((call) => call.variables.q)).toEqual([
      'is:pr is:open archived:false org:acme author:@me',
      'is:pr is:open archived:false org:acme user-review-requested:@me',
      'is:pr is:open archived:false org:acme team-review-requested:acme/platform-team',
    ]);
  });

  it('ranks repositories by PRs authored or reviewed in the period', async () => {
    const { gh, queries } = fakeGh([{
      match: /first: 100, after: \$after\) \{ pageInfo/,
      reply: (_query, variables) => ({
        search: {
          pageInfo: { hasNextPage: false },
          nodes: variables.q.includes('author:@me')
            ? [{ repository: { name: 'orders-api' } }, { repository: { name: 'orders-api' } }]
            : [{ repository: { name: 'integration-hr' } }, { repository: { name: 'orders-api' } }],
        },
        rateLimit,
      }),
    }]);

    const ranked = await new GithubProvider(gh, 'acme', classes).rankReposByActivity(90);

    expect(ranked).toEqual([{ name: 'orders-api', activity: 3 }, { name: 'integration-hr', activity: 1 }]);
    expect(queries[0]!.variables.q).toMatch(/^is:pr org:acme author:@me updated:>=\d{4}-\d{2}-\d{2}$/);
  });

  it('reads native stack entries and maps their states', async () => {
    const { gh } = fakeGh([{
      match: /stack \{ number baseRefName entries/,
      reply: () => ({
        repository: { pullRequest: { stack: { number: 4964, baseRefName: 'main', entries: { nodes: [
          { position: 1, pullRequest: { number: 4985, title: 'Add offline storage layer', state: 'MERGED' } },
          { position: 2, pullRequest: { number: 4988, title: 'Use offline mode', state: 'OPEN' } },
        ] } } } },
        rateLimit,
      }),
    }]);

    expect(await new GithubProvider(gh, 'acme', classes).nativeStackEntries('field-app', 4988)).toEqual({
      number: 4964, baseRefName: 'main',
      entries: [
        { position: 1, number: 4985, title: 'Add offline storage layer', state: 'merged' },
        { position: 2, number: 4988, title: 'Use offline mode', state: 'open' },
      ],
    });
  });

  it('compares branches through the REST compare endpoint with encoded names', async () => {
    const { gh, restPaths } = fakeGh([]);
    const result = await new GithubProvider(gh, 'acme', classes).compareRefs('field-app', 'feature/a', 'feature/b');
    expect(result).toEqual({ behindBy: 3 });
    expect(restPaths).toEqual(['repos/acme/field-app/compare/feature%2Fa...feature%2Fb']);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run server/providers/codehost/github/__tests__/provider.test.ts`
Expected: FAIL, module `../provider` not found.

- [ ] **Step 4: Implement the provider and registry**

`server/providers/codehost/github/provider.ts`:
```ts
import type { ChangeRequest, ChangeRequestStub, RepoRef } from '../../../../shared/types';
import type { GhClient } from '../../../gh';
import { ProviderError, type AuthResult, type CodeHostProvider, type MineKind, type NativeStackEntries, type ReviewerClasses } from '../../types';
import { toChangeRequest, toStub } from './mapping';
import {
  ACTIVITY_QUERY, fullQuery, leanRepoPageQuery, leanReposQuery, mineSearch, NATIVE_STACK_QUERY,
  openCountsQuery, REPO_SEARCH_QUERY, SEARCH_PRS_QUERY, TEAMS_QUERY, VIEWER_QUERY,
} from './queries';

export const ENRICH_BATCH_SIZE = 25;
const MAX_SEARCH_PAGES = 4;

type RateLimitRaw = { remaining: number; resetAt: string };

export class GithubProvider implements CodeHostProvider {
  readonly id = 'github';
  readonly host = 'github.com';
  readonly capabilities = { nativeStacks: true, requiredChecks: true, mergeability: true, draft: true, reviewThreads: true, teamReviewRequests: true };
  private rate: RateLimitRaw | null = null;
  private batchSize = ENRICH_BATCH_SIZE;

  constructor(private readonly gh: GhClient, private readonly org: string, private readonly classes: ReviewerClasses) {}

  private async query<T>(query: string, variables?: Record<string, unknown>): Promise<T & { rateLimit?: RateLimitRaw }> {
    const data = await this.gh.graphql<T & { rateLimit?: RateLimitRaw }>(query, variables);
    if (data?.rateLimit) this.rate = { remaining: data.rateLimit.remaining, resetAt: data.rateLimit.resetAt };
    return data;
  }

  lastRateLimit() {
    return this.rate;
  }

  async checkAuth(): Promise<AuthResult> {
    try {
      const { viewer } = await this.query<{ viewer: { login: string; avatarUrl?: string } }>(VIEWER_QUERY);
      const teams = await this.query<{ organization: { teams: { nodes: { slug: string; avatarUrl?: string }[] } } | null }>(TEAMS_QUERY, { org: this.org, login: viewer.login });
      return { ok: true, viewer: { login: viewer.login, avatarUrl: viewer.avatarUrl, teams: teams.organization?.teams.nodes ?? [] } };
    } catch (error) {
      if (error instanceof ProviderError) {
        const reason = error.kind === 'missing-cli' || error.kind === 'auth' ? error.kind : 'failed';
        return { ok: false, reason, message: error.message };
      }
      throw error;
    }
  }

  async pollLean(repos: string[]): Promise<ChangeRequestStub[]> {
    if (repos.length === 0) return [];
    const data = await this.query<Record<string, any>>(leanReposQuery(this.org, repos));
    const stubs: ChangeRequestStub[] = [];
    for (const [index, repo] of repos.entries()) {
      let connection = data[`r${index}`]?.pullRequests;
      if (!connection) continue;
      stubs.push(...connection.nodes.map(toStub));
      while (connection.pageInfo.hasNextPage) {
        const page = await this.query<Record<string, any>>(leanRepoPageQuery(this.org, repo, connection.pageInfo.endCursor));
        connection = page.r0.pullRequests;
        stubs.push(...connection.nodes.map(toStub));
      }
    }
    return stubs;
  }

  async fetchFull(stubs: ChangeRequestStub[]): Promise<ChangeRequest[]> {
    const results: ChangeRequest[] = [];
    let index = 0;
    while (index < stubs.length) {
      const batch = stubs.slice(index, index + this.batchSize);
      try {
        const data = await this.query<Record<string, any>>(fullQuery(batch));
        batch.forEach((_, position) => {
          const raw = data[`p${position}`];
          if (raw) results.push(toChangeRequest(raw, this.classes));
        });
        index += batch.length;
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'too-large' && this.batchSize > 1) {
          this.batchSize = Math.max(1, Math.floor(this.batchSize / 2));
          continue;
        }
        throw error;
      }
    }
    return results;
  }

  private async searchAll<T>(query: string, q: string, maxPages: number): Promise<T[]> {
    const nodes: T[] = [];
    let after: string | null = null;
    for (let page = 0; page < maxPages; page += 1) {
      const data: any = await this.query(query, { q, after });
      nodes.push(...data.search.nodes);
      if (!data.search.pageInfo?.hasNextPage) break;
      after = data.search.pageInfo.endCursor;
    }
    return nodes;
  }

  async searchMine(kind: MineKind, team?: string): Promise<ChangeRequestStub[]> {
    const nodes = await this.searchAll<any>(SEARCH_PRS_QUERY, mineSearch(this.org, kind, team), MAX_SEARCH_PAGES);
    return nodes.filter((node) => node?.id).map(toStub);
  }

  async listRepos(text: string): Promise<RepoRef[]> {
    const data = await this.query<{ search: { nodes: { name?: string }[] } }>(REPO_SEARCH_QUERY, { q: `org:${this.org} archived:false ${text}`.trim() });
    return data.search.nodes.filter((node) => node.name).map((node) => ({ name: node.name! }));
  }

  async rankReposByActivity(days: number): Promise<RepoRef[]> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const counts = new Map<string, number>();
    for (const who of ['author:@me', 'reviewed-by:@me']) {
      const nodes = await this.searchAll<{ repository?: { name: string } }>(ACTIVITY_QUERY, `is:pr org:${this.org} ${who} updated:>=${since}`, 3);
      for (const node of nodes) if (node.repository) counts.set(node.repository.name, (counts.get(node.repository.name) ?? 0) + 1);
    }
    return [...counts].map(([name, activity]) => ({ name, activity })).sort((a, b) => b.activity - a.activity || a.name.localeCompare(b.name));
  }

  async openCounts(repos: string[]): Promise<Record<string, number>> {
    if (repos.length === 0) return {};
    const data = await this.query<Record<string, any>>(openCountsQuery(this.org, repos));
    return Object.fromEntries(repos.map((repo, index) => [repo, data[`c${index}`]?.pullRequests.totalCount ?? 0]));
  }

  async nativeStackEntries(repo: string, number: number): Promise<NativeStackEntries | null> {
    const data = await this.query<any>(NATIVE_STACK_QUERY, { owner: this.org, name: repo, number });
    const stack = data.repository?.pullRequest?.stack;
    if (!stack) return null;
    return {
      number: stack.number,
      baseRefName: stack.baseRefName,
      entries: stack.entries.nodes.map((node: any) => ({
        position: node.position,
        number: node.pullRequest.number,
        title: node.pullRequest.title,
        state: node.pullRequest.state === 'MERGED' ? 'merged' : node.pullRequest.state === 'OPEN' ? 'open' : 'closed',
      })),
    };
  }

  async compareRefs(repo: string, base: string, head: string): Promise<{ behindBy: number }> {
    const data = await this.gh.rest<{ behind_by: number }>(`repos/${this.org}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
    return { behindBy: data.behind_by };
  }
}
```

`server/providers/registry.ts`:
```ts
import type { GhClient } from '../gh';
import { GithubProvider } from './codehost/github/provider';
import type { CodeHostProvider, ReviewerClasses } from './types';

const CODE_HOSTS: Record<string, (org: string, classes: ReviewerClasses, gh: GhClient) => CodeHostProvider> = {
  github: (org, classes, gh) => new GithubProvider(gh, org, classes),
};

export function createCodeHost(config: { codeHost: { provider: string; org: string }; reviewerClasses: ReviewerClasses }, gh: GhClient): CodeHostProvider {
  const factory = CODE_HOSTS[config.codeHost.provider];
  if (!factory) throw new Error(`Unknown code host provider "${config.codeHost.provider}". Available: ${Object.keys(CODE_HOSTS).join(', ')}.`);
  return factory(config.codeHost.org, config.reviewerClasses, gh);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/providers`
Expected: PASS, including the four contract tests.

- [ ] **Step 6: Smoke-test against real GitHub (read-only)**

This exercises every query against the real org. It costs about 30 API points. Save it as `scripts/smoke-github.ts`, which is kept for future debugging, and run `npx tsx scripts/smoke-github.ts`:
```ts
import { createGhClient } from '../server/gh';
import { GithubProvider } from '../server/providers/codehost/github/provider';

const org = 'acme';
const repos = ['orders-api', 'orders-web', 'integration-hr', 'orders-deploy', 'field-app',
  'integration-deployment', 'claude', 'field-api', 'integration-time', 'field-deploy'];
const provider = new GithubProvider(createGhClient(), org, { 'ai-review': ['copilot-pull-request-reviewer'], 'code-analysis': ['codescene-*'] });

const auth = await provider.checkAuth();
console.log('auth', auth.ok, auth.ok ? auth.viewer.teams.map((team) => team.slug) : auth);

const stubs = await provider.pollLean(repos);
console.log('lean stubs across 10 repos', stubs.length, 'native-stacked', stubs.filter((stub) => stub.nativeStack).length);

const full = await provider.fetchFull(stubs);
console.log('full', full.length, 'merge states', [...new Set(full.map((pr) => pr.mergeState))]);
console.log('max check contexts on one PR', Math.max(...full.map((pr) => pr.checks.length)), '(30 means it may be truncated)');
const kinds = new Map<string, string>();
for (const pr of full) {
  for (const review of pr.reviews) kinds.set(review.author.login, review.author.kind);
  for (const thread of pr.threads) kinds.set(thread.author.login, thread.author.kind);
  for (const request of pr.reviewRequests) if (request.type === 'person') kinds.set(request.person.login, request.person.kind);
}
console.log('non-human actors', [...kinds].filter(([, kind]) => kind !== 'human'));

for (const kind of ['authored', 'review-requested'] as const) console.log(kind, (await provider.searchMine(kind)).length);
if (auth.ok) for (const team of auth.viewer.teams) console.log('team', team.slug, (await provider.searchMine('team-review-requested', team.slug)).length);

const stacked = stubs.find((stub) => stub.nativeStack);
if (stacked) console.log('native stack entries', JSON.stringify(await provider.nativeStackEntries(stacked.repo, stacked.number)).slice(0, 300));
const slashed = stubs.find((stub) => stub.headRefName.includes('/'));
if (slashed) console.log('compare with a slash in the branch', slashed.headRefName, await provider.compareRefs(slashed.repo, slashed.baseRefName, slashed.headRefName));

console.log('rate', provider.lastRateLimit());
```
Expected:
- `auth true` with `platform-team`.
- About 200 lean stubs and as many full PRs, with no resource-limit failure that the halving cannot absorb.
- Non-human actors include `copilot-pull-request-reviewer` as `ai-review` and `codescene-*` as `code-analysis`. If Copilot appears under a different login on threads or requests, for example a `copilot` login without the suffix, add it to `DEFAULT_REVIEWER_CLASSES` in Task 9 and to `config.example.json`.
- Non-zero Mine counts.
- Native stack entries for field-app.
- A numeric `behindBy` for a branch with a slash.
- If "max check contexts" reaches 30, raise `contexts(first: 30)` to 50 in `queries.ts`. Then rerun and confirm the batch size still holds.

If GraphQL rejects a field, for example `isRequired(pullRequestNumber:)` or the `stack` fields, fix `queries.ts` and the fixture together, then rerun Step 5.

- [ ] **Step 7: Commit**

```bash
git add server scripts
git commit -m "Add the GitHub provider with batched enrichment and a provider contract suite."
```

---

### Task 9: Config store

**Files:**
- Create: `server/config.ts`, `server/__tests__/config.test.ts`

**Interfaces:**
- Consumes: `MAX_REPOS`, `RefreshSetting` (Task 1).
- Produces:
  - `ConfigSchema` (zod), `type Config`
  - `class ConfigError extends Error`
  - `class ConfigStore { static open(path): Promise<ConfigStore>; get(): Config; save(next: Config): Promise<void> }`
  - `refreshToSeconds(setting: RefreshSetting): number`, `secondsToRefresh(seconds: number): RefreshSetting`
  - `DEFAULT_REVIEWER_CLASSES`

- [ ] **Step 1: Write the failing tests**

`server/__tests__/config.test.ts`:
```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, ConfigStore, refreshToSeconds, secondsToRefresh } from '../config';

async function tempConfig(contents?: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'prdash-'));
  const path = join(dir, 'config.json');
  if (contents !== undefined) await writeFile(path, JSON.stringify(contents));
  return path;
}

const minimal = { codeHost: { provider: 'github', org: 'acme', repos: ['orders-api'] } };

describe('ConfigStore', () => {
  it('fills defaults for reviewer classes, teams and refresh', async () => {
    const store = await ConfigStore.open(await tempConfig(minimal));
    expect(store.get()).toMatchObject({
      codeHost: { excludeRepos: [], teams: [], localRepos: [] },
      reviewerClasses: { 'ai-review': ['copilot-pull-request-reviewer'], 'code-analysis': ['codescene-access', 'codescene-delta-analysis'] },
      refreshIntervalSec: 180,
    });
  });

  it('tells the user to run setup when the file is missing', async () => {
    await expect(ConfigStore.open(await tempConfig())).rejects.toThrow(/npm run setup/);
  });

  it('rejects more than ten repositories and an unsupported interval', async () => {
    const tooMany = { codeHost: { ...minimal.codeHost, repos: Array.from({ length: 11 }, (_, index) => `repo-${index}`) } };
    await expect(ConfigStore.open(await tempConfig(tooMany))).rejects.toBeInstanceOf(ConfigError);
    await expect(ConfigStore.open(await tempConfig({ ...minimal, refreshIntervalSec: 60 }))).rejects.toBeInstanceOf(ConfigError);
  });

  it('saves validated changes to disk', async () => {
    const path = await tempConfig(minimal);
    const store = await ConfigStore.open(path);
    await store.save({ ...store.get(), refreshIntervalSec: 600 });
    expect(JSON.parse(await readFile(path, 'utf8')).refreshIntervalSec).toBe(600);
    expect(store.get().refreshIntervalSec).toBe(600);
  });
});

describe('refresh conversion', () => {
  it('maps off to 0 seconds and minutes to seconds, both ways', () => {
    expect(refreshToSeconds('off')).toBe(0);
    expect(refreshToSeconds(5)).toBe(300);
    expect(secondsToRefresh(0)).toBe('off');
    expect(secondsToRefresh(1800)).toBe(30);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/config.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `server/config.ts`**

```ts
import { readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { MAX_REPOS, type RefreshSetting } from '../shared/types';

export const DEFAULT_REVIEWER_CLASSES = {
  'ai-review': ['copilot-pull-request-reviewer'],
  'code-analysis': ['codescene-access', 'codescene-delta-analysis'],
};

const REFRESH_SECONDS = [0, 180, 300, 600, 900, 1800] as const;

export const ConfigSchema = z.object({
  codeHost: z.object({
    provider: z.string().min(1),
    org: z.string().min(1),
    repos: z.array(z.string().min(1)).max(MAX_REPOS, `At most ${MAX_REPOS} repositories`),
    excludeRepos: z.array(z.string()).default([]),
    teams: z.array(z.string()).default([]),
    localRepos: z.array(z.string()).default([]),
  }),
  reviewerClasses: z.object({
    'ai-review': z.array(z.string()).default(DEFAULT_REVIEWER_CLASSES['ai-review']),
    'code-analysis': z.array(z.string()).default(DEFAULT_REVIEWER_CLASSES['code-analysis']),
  }).default(DEFAULT_REVIEWER_CLASSES),
  refreshIntervalSec: z.number().refine((value) => (REFRESH_SECONDS as readonly number[]).includes(value), {
    message: `refreshIntervalSec must be one of ${REFRESH_SECONDS.join(', ')}`,
  }).default(180),
  issueTracker: z.object({ provider: z.string(), baseUrl: z.string().url() }).optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {}

function parse(raw: unknown, path: string): Config {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`${path} is invalid: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  return result.data;
}

export class ConfigStore {
  private constructor(private readonly path: string, private config: Config) {}

  static async open(path: string): Promise<ConfigStore> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ConfigError(`${path} not found. Run \`npm run setup\` first.`);
      throw error;
    }
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new ConfigError(`${path} is not valid JSON.`); }
    return new ConfigStore(path, parse(raw, path));
  }

  get(): Config {
    return this.config;
  }

  async save(next: Config): Promise<void> {
    const valid = parse(next, this.path);
    // Write then rename so a crash never leaves a half-written config.
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`);
    await rename(temporary, this.path);
    this.config = valid;
  }
}

export const refreshToSeconds = (setting: RefreshSetting): number => (setting === 'off' ? 0 : setting * 60);
export const secondsToRefresh = (seconds: number): RefreshSetting => (seconds === 0 ? 'off' : (seconds / 60) as RefreshSetting);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "Add the validated config store."
```

---

### Task 10: Poller

**Files:**
- Create: `server/poller.ts`, `server/__tests__/poller.test.ts`, `test/fake-provider.ts`

**Interfaces:**
- Consumes: `CodeHostProvider`, `ProviderError` (Task 6); `Config` (Task 9); `secondsToRefresh` (Task 9); `Snapshot`, `emptySnapshot`, `ChangeRequest`, `ChangeRequestStub`, `BannerMsg` (Task 1); `makePr` (Task 2).
- Produces:
  - `class Poller { constructor(deps: PollerDeps); snapshot(): Snapshot; tick(opts?: { full?: boolean }): Promise<void>; backoffFactor(): number; refreshSettings(): void }`
  - `interface PollerDeps { provider: CodeHostProvider; config: () => Config; now?: () => number; onChange?: (snapshot: Snapshot) => void }`
  - `FULL_SWEEP_MS = 900_000`, `RATE_LIMIT_FLOOR = 500`
  - `createFakeProvider(prs: ChangeRequest[], overrides?: Partial<CodeHostProvider>)` in `test/fake-provider.ts`

- [ ] **Step 1: Write the fake provider**

`test/fake-provider.ts`:
```ts
import type { ChangeRequest, ChangeRequestStub } from '../shared/types';
import type { CodeHostProvider } from '../server/providers/types';

export const stubOf = (pr: ChangeRequest): ChangeRequestStub => ({
  id: pr.id, repo: pr.repo, number: pr.number, updatedAt: pr.updatedAt, headSha: pr.headSha,
  headRefName: pr.headRefName, baseRefName: pr.baseRefName, isDraft: pr.isDraft, nativeStack: pr.nativeStack,
});

/** In-memory provider; `prs` can be reassigned between ticks to simulate GitHub changing. */
export function createFakeProvider(initial: ChangeRequest[], overrides: Partial<CodeHostProvider> = {}) {
  const state = { prs: initial, fetched: [] as string[][], mine: { authored: [] as string[], requested: [] as string[], team: [] as string[] } };
  const byIds = (ids: string[]) => state.prs.filter((pr) => ids.includes(pr.id)).map(stubOf);
  const provider: CodeHostProvider = {
    id: 'fake',
    host: 'example.test',
    capabilities: { nativeStacks: true, requiredChecks: true, mergeability: true, draft: true, reviewThreads: true, teamReviewRequests: true },
    checkAuth: async () => ({ ok: true, viewer: { login: 'alex', teams: [{ slug: 'core' }] } }),
    lastRateLimit: () => ({ remaining: 4000, resetAt: '2026-11-18T13:00:00Z' }),
    listRepos: async () => [],
    rankReposByActivity: async () => [],
    openCounts: async () => ({}),
    pollLean: async (repos) => state.prs.filter((pr) => repos.includes(pr.repo)).map(stubOf),
    fetchFull: async (stubs) => {
      state.fetched.push(stubs.map((stub) => stub.id));
      return state.prs.filter((pr) => stubs.some((stub) => stub.id === pr.id));
    },
    searchMine: async (kind) => byIds(kind === 'authored' ? state.mine.authored : kind === 'review-requested' ? state.mine.requested : state.mine.team),
    nativeStackEntries: async () => null,
    compareRefs: async () => ({ behindBy: 0 }),
    ...overrides,
  };
  return { provider, state };
}
```

- [ ] **Step 2: Write the failing tests**

`server/__tests__/poller.test.ts`:
```ts
import { Poller, FULL_SWEEP_MS } from '../poller';
import { ProviderError } from '../providers/types';
import type { Config } from '../config';
import { createFakeProvider } from '../../test/fake-provider';
import { makePr } from '../../test/factories';

const config: Config = {
  codeHost: { provider: 'fake', org: 'acme', repos: ['orders-api'], excludeRepos: [], teams: [], localRepos: [] },
  reviewerClasses: { 'ai-review': [], 'code-analysis': [] },
  refreshIntervalSec: 180,
};

function setup(prs = [makePr(), makePr()]) {
  let now = Date.parse('2026-11-18T12:00:00Z');
  const fake = createFakeProvider(prs);
  const published: number[] = [];
  const poller = new Poller({ provider: fake.provider, config: () => config, now: () => now, onChange: (snapshot) => published.push(snapshot.prs.length) });
  return { poller, fake, published, advance: (ms: number) => (now += ms) };
}

describe('Poller', () => {
  it('publishes the viewer, PRs, overview ids and settings after the first tick', async () => {
    const { poller, published } = setup();
    await poller.tick();
    const snapshot = poller.snapshot();
    expect(snapshot.viewer?.login).toBe('alex');
    expect(snapshot.prs).toHaveLength(2);
    expect(snapshot.overviewIds).toHaveLength(2);
    expect(snapshot.settings).toMatchObject({ refresh: 3, repos: ['orders-api'], org: 'acme', host: 'example.test' });
    expect(snapshot.fetchedAt).toBe('2026-11-18T12:00:00.000Z');
    expect(published).toEqual([2]);
  });

  it('enriches only new, changed, pending or unknown PRs on later ticks', async () => {
    const steady = makePr();
    const changing = makePr();
    const pending = makePr({ checks: [{ name: 'build', state: 'pending', required: true }] });
    const unknown = makePr({ mergeState: 'unknown' });
    const { poller, fake, advance } = setup([steady, changing, pending, unknown]);
    await poller.tick();

    fake.state.prs = fake.state.prs.map((pr) => (pr.id === changing.id ? { ...pr, updatedAt: '2026-11-18T12:01:00Z' } : pr));
    advance(180_000);
    await poller.tick();

    expect(fake.state.fetched.at(-1)!.sort()).toEqual([changing.id, pending.id, unknown.id].sort());
  });

  it('re-enriches everything on the full sweep', async () => {
    const { poller, fake, advance } = setup();
    await poller.tick();
    advance(FULL_SWEEP_MS);
    await poller.tick();
    expect(fake.state.fetched.at(-1)).toHaveLength(2);
  });

  it('drops PRs that are no longer open', async () => {
    const closing = makePr();
    const { poller, fake } = setup([closing, makePr()]);
    await poller.tick();
    fake.state.prs = fake.state.prs.filter((pr) => pr.id !== closing.id);
    await poller.tick();
    expect(poller.snapshot().prs.map((pr) => pr.id)).not.toContain(closing.id);
  });

  it('fills the Mine lists and removes duplicates across team searches', async () => {
    const mine = makePr();
    const requested = makePr();
    const { poller, fake } = setup([mine, requested]);
    fake.state.mine = { authored: [mine.id], requested: [requested.id], team: [requested.id] };
    await poller.tick();
    expect(poller.snapshot().mine).toEqual({ authored: [mine.id], requested: [requested.id], team: [requested.id] });
  });

  it('keeps the last data and marks it stale when a refresh fails', async () => {
    const { poller, fake } = setup();
    await poller.tick();
    fake.provider.pollLean = async () => { throw new ProviderError('failed', 'boom'); };
    await poller.tick();
    const snapshot = poller.snapshot();
    expect(snapshot.prs).toHaveLength(2);
    expect(snapshot.stale).toBe(true);
    expect(snapshot.banners[0]).toMatchObject({ kind: 'stale' });
    expect(snapshot.banners[0]!.message).toContain('boom');
  });

  it('shows an auth banner and retries authentication on the next tick', async () => {
    const { poller, fake } = setup();
    let attempts = 0;
    fake.provider.checkAuth = async () => (++attempts === 1
      ? { ok: false, reason: 'auth', message: 'gh is not logged in. Run `gh auth login`.' }
      : { ok: true, viewer: { login: 'alex', teams: [] } });
    await poller.tick();
    expect(poller.snapshot().banners).toEqual([{ kind: 'auth', message: 'gh is not logged in. Run `gh auth login`.' }]);
    await poller.tick();
    expect(poller.snapshot().banners).toEqual([]);
  });

  it('warns and backs off when the rate limit is low', async () => {
    const { poller, fake } = setup();
    fake.provider.lastRateLimit = () => ({ remaining: 120, resetAt: '2026-11-18T12:40:00Z' });
    await poller.tick();
    expect(poller.snapshot().banners[0]).toMatchObject({ kind: 'rate-limit' });
    expect(poller.backoffFactor()).toBe(2);
  });

  it('shares one in-flight tick between concurrent callers', async () => {
    const { poller, fake } = setup();
    await Promise.all([poller.tick(), poller.tick()]);
    expect(fake.state.fetched).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/poller.test.ts`
Expected: FAIL, module `../poller` not found.

- [ ] **Step 4: Implement `server/poller.ts`**

```ts
import { emptySnapshot, type BannerMsg, type ChangeRequest, type ChangeRequestStub, type Snapshot, type Viewer } from '../shared/types';
import { secondsToRefresh, type Config } from './config';
import { ProviderError, type CodeHostProvider } from './providers/types';

export const FULL_SWEEP_MS = 15 * 60_000;
export const RATE_LIMIT_FLOOR = 500;

export interface PollerDeps {
  provider: CodeHostProvider;
  config: () => Config;
  now?: () => number;
  onChange?: (snapshot: Snapshot) => void;
}

// CI completion does not bump updatedAt, so pending checks and unknown mergeability are re-read every tick.
function needsEnrichment(cached: ChangeRequest | undefined, stub: ChangeRequestStub): boolean {
  return !cached
    || cached.updatedAt !== stub.updatedAt
    || cached.headSha !== stub.headSha
    || cached.mergeState === 'unknown'
    || cached.checks.some((check) => check.state === 'pending');
}

const uniqueIds = (stubs: ChangeRequestStub[]) => [...new Set(stubs.map((stub) => stub.id))];

export class Poller {
  private cache = new Map<string, ChangeRequest>();
  private viewer: Viewer | null = null;
  private lastFullSweep = Number.NEGATIVE_INFINITY;
  private current: Snapshot;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly deps: PollerDeps) {
    this.current = emptySnapshot(deps.config().codeHost.org, deps.provider.host);
    this.refreshSettings(false);
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  snapshot(): Snapshot {
    return this.current;
  }

  /** Re-reads settings from config, e.g. after the settings panel saved, and pushes them to open tabs. */
  refreshSettings(notify = true): void {
    const config = this.deps.config();
    const tracker = config.issueTracker;
    this.publish({
      settings: {
        refresh: secondsToRefresh(config.refreshIntervalSec),
        repos: config.codeHost.repos,
        org: config.codeHost.org,
        host: this.deps.provider.host,
        ticketUrl: tracker?.provider === 'jira' ? `${tracker.baseUrl.replace(/\/$/, '')}/browse/{key}` : null,
      },
    }, notify);
  }

  backoffFactor(): number {
    const rate = this.current.rateLimit;
    return rate && rate.remaining < RATE_LIMIT_FLOOR ? 2 : 1;
  }

  tick(opts: { full?: boolean } = {}): Promise<void> {
    if (!this.inFlight) this.inFlight = this.run(opts).finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  private publish(patch: Partial<Snapshot>, notify = true) {
    this.current = { ...this.current, ...patch };
    if (notify) this.deps.onChange?.(this.current);
  }

  private async run({ full = false }: { full?: boolean }): Promise<void> {
    const { provider } = this.deps;
    const config = this.deps.config();
    const now = this.now();
    try {
      if (!this.viewer) {
        const auth = await provider.checkAuth();
        if (!auth.ok) {
          this.publish({ banners: [{ kind: auth.reason === 'missing-cli' ? 'missing-cli' : 'auth', message: auth.message }], stale: this.cache.size > 0 });
          return;
        }
        this.viewer = auth.viewer;
      }

      const repos = config.codeHost.repos.filter((repo) => !config.codeHost.excludeRepos.includes(repo));
      const teams = config.codeHost.teams.length ? config.codeHost.teams : this.viewer.teams.map((team) => team.slug);
      const overview = await provider.pollLean(repos);
      const authored = await provider.searchMine('authored');
      const requested = await provider.searchMine('review-requested');
      const team = (await Promise.all(teams.map((slug) => provider.searchMine('team-review-requested', slug)))).flat();

      const stubs = new Map([...overview, ...authored, ...requested, ...team].map((stub) => [stub.id, stub]));
      const sweep = full || now - this.lastFullSweep >= FULL_SWEEP_MS;
      const toFetch = [...stubs.values()].filter((stub) => sweep || needsEnrichment(this.cache.get(stub.id), stub));
      const fresh = new Map((await provider.fetchFull(toFetch)).map((pr) => [pr.id, pr]));

      const next = new Map<string, ChangeRequest>();
      for (const id of stubs.keys()) {
        const pr = fresh.get(id) ?? this.cache.get(id);
        if (pr) next.set(id, pr);
      }
      this.cache = next;
      if (sweep) this.lastFullSweep = now;

      const rateLimit = provider.lastRateLimit();
      const banners: BannerMsg[] = [];
      if (rateLimit && rateLimit.remaining < RATE_LIMIT_FLOOR) {
        banners.push({ kind: 'rate-limit', message: `GitHub API budget is low (${rateLimit.remaining} left until ${new Date(rateLimit.resetAt).toLocaleTimeString()}). Refreshing half as often.` });
      }
      const known = (list: ChangeRequestStub[]) => uniqueIds(list).filter((id) => next.has(id));
      this.publish({
        viewer: this.viewer,
        prs: [...next.values()],
        overviewIds: known(overview),
        mine: { authored: known(authored), requested: known(requested), team: known(team) },
        fetchedAt: new Date(now).toISOString(),
        stale: false,
        banners,
        rateLimit,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ProviderError && (error.kind === 'auth' || error.kind === 'missing-cli')) {
        this.viewer = null;
        this.publish({ stale: this.cache.size > 0, banners: [{ kind: error.kind, message }] });
        return;
      }
      const since = this.current.fetchedAt ? ` Showing data from ${new Date(this.current.fetchedAt).toLocaleTimeString()}.` : '';
      this.publish({ stale: true, banners: [{ kind: 'stale', message: `Last refresh failed: ${message}.${since}` }] });
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/poller.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server test
git commit -m "Add the poller: lean poll, selective enrichment, sweeps, banners and backoff."
```

---

### Task 11: Presence and the poll loop

**Files:**
- Create: `server/presence.ts`, `server/__tests__/presence.test.ts`

**Interfaces:**
- Consumes: `Poller` (Task 10; only `tick`, `snapshot`, `backoffFactor`).
- Produces:
  - `class Presence { connect(clientId: string): void; disconnect(clientId: string): void; setVisible(clientId: string, visible: boolean): void; anyVisible(): boolean; onChange(listener: () => void): () => void }`
  - `class PollLoop { constructor(deps: { poller: Pick<Poller, 'tick' | 'snapshot' | 'backoffFactor'>; presence: Presence; intervalMs: () => number | null; now?: () => number }); start(): void; reschedule(): void; stop(): void }`

- [ ] **Step 1: Write the failing tests**

`server/__tests__/presence.test.ts`:
```ts
import { PollLoop, Presence } from '../presence';
import { emptySnapshot, type Snapshot } from '../../shared/types';

function setup(initialIntervalMs: number | null = 180_000) {
  const presence = new Presence();
  let snapshot: Snapshot = emptySnapshot('acme');
  let ticks = 0;
  let factor = 1;
  let intervalMs = initialIntervalMs;
  const poller = {
    tick: async () => { ticks += 1; snapshot = { ...snapshot, fetchedAt: new Date(Date.now()).toISOString() }; },
    snapshot: () => snapshot,
    backoffFactor: () => factor,
  };
  const loop = new PollLoop({ poller, presence, intervalMs: () => intervalMs });
  loop.start();
  return {
    presence, loop,
    ticks: () => ticks,
    setFactor: (value: number) => (factor = value),
    setIntervalMs: (value: number | null) => (intervalMs = value),
  };
}

describe('Presence', () => {
  it('is visible only while a connected client says so', () => {
    const presence = new Presence();
    presence.connect('tab-1');
    expect(presence.anyVisible()).toBe(true);
    presence.setVisible('tab-1', false);
    expect(presence.anyVisible()).toBe(false);
    presence.setVisible('tab-1', true);
    presence.disconnect('tab-1');
    expect(presence.anyVisible()).toBe(false);
  });
});

describe('PollLoop', () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-11-18T12:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('does not poll while no tab is visible', async () => {
    const { ticks } = setup();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(ticks()).toBe(0);
  });

  it('polls at once when a tab appears and then every interval', async () => {
    const { presence, ticks } = setup();
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks()).toBe(1);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(ticks()).toBe(2);
  });

  it('pauses when the tab is hidden and resumes without an extra tick if data is fresh', async () => {
    const { presence, ticks } = setup();
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    presence.setVisible('tab-1', false);
    await vi.advanceTimersByTimeAsync(60_000);
    presence.setVisible('tab-1', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks()).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ticks()).toBe(2);
  });

  it('loads once and then stops when auto-refresh is off', async () => {
    const { presence, loop, ticks, setIntervalMs } = setup();
    setIntervalMs(null);
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(ticks()).toBe(1);
    loop.reschedule();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(ticks()).toBe(1);
  });

  it('doubles the interval while the poller asks for backoff', async () => {
    const { presence, ticks, setFactor } = setup();
    setFactor(2);
    presence.connect('tab-1');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(ticks()).toBe(1);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(ticks()).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/presence.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `server/presence.ts`**

```ts
import type { Poller } from './poller';

export class Presence {
  private clients = new Map<string, boolean>();
  private listeners = new Set<() => void>();

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  connect(clientId: string) {
    this.clients.set(clientId, true);
    this.emit();
  }

  disconnect(clientId: string) {
    this.clients.delete(clientId);
    this.emit();
  }

  setVisible(clientId: string, visible: boolean) {
    if (!this.clients.has(clientId)) return;
    this.clients.set(clientId, visible);
    this.emit();
  }

  anyVisible(): boolean {
    return [...this.clients.values()].some(Boolean);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

interface PollLoopDeps {
  poller: Pick<Poller, 'tick' | 'snapshot' | 'backoffFactor'>;
  presence: Presence;
  intervalMs: () => number | null;
  now?: () => number;
}

/** Polls only while someone is looking, so an idle dashboard spends no API budget. */
export class PollLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: PollLoopDeps) {}

  start() {
    this.unsubscribe = this.deps.presence.onChange(() => this.reschedule());
    this.reschedule();
  }

  stop() {
    this.unsubscribe?.();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  reschedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.deps.presence.anyVisible()) return;
    const interval = this.deps.intervalMs();
    const fetchedAt = this.deps.poller.snapshot().fetchedAt;
    if (interval === null) {
      // With auto-refresh off the dashboard still needs one load to show anything.
      if (!fetchedAt) this.timer = setTimeout(() => void this.deps.poller.tick(), 0);
      return;
    }
    const effective = interval * this.deps.poller.backoffFactor();
    const last = fetchedAt ? Date.parse(fetchedAt) : 0;
    const now = (this.deps.now ?? Date.now)();
    const delay = Math.max(0, last + effective - now);
    this.timer = setTimeout(async () => {
      await this.deps.poller.tick();
      this.reschedule();
    }, delay);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/presence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "Poll only while a dashboard tab is visible."
```

---

### Task 12: HTTP API, SSE, stack details and server entry

**Files:**
- Create: `server/hub.ts`, `server/stack-detail.ts`, `server/app.ts`, `server/index.ts`, `server/__tests__/stack-detail.test.ts`, `server/__tests__/app.test.ts`

**Interfaces:**
- Consumes: `Poller` (Task 10), `Presence`, `PollLoop` (Task 11), `ConfigStore`, `refreshToSeconds` (Task 9), `CodeHostProvider` (Task 6), `createCodeHost` (Task 8), `createGhClient` (Task 6), `detectStacks`, `stackIndex`, `membersBottomUp` (Task 4), `REFRESH_OPTIONS`, `MAX_REPOS`, `StackDetail` (Task 1).
- Produces:
  - `class SnapshotHub { subscribe(listener: (snapshot: Snapshot) => void): () => void; publish(snapshot: Snapshot): void }`
  - `buildStackDetail(provider: CodeHostProvider, snapshot: Snapshot, prId: string): Promise<StackDetail | null>`
  - `createApp(deps: AppDeps): express.Express`, where `AppDeps = { poller; presence; loop; provider; store: ConfigStore; hub: SnapshotHub }`
  - HTTP API used by the web client in Task 15:

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/snapshot` | — | `Snapshot` |
| GET | `/api/events?client=<id>` | — | SSE stream of `event: snapshot` |
| POST | `/api/presence` | `{ client: string, visible: boolean }` | 204 |
| POST | `/api/refresh` | — | `Snapshot` (after the tick) |
| PUT | `/api/settings` | `{ refresh?: RefreshSetting, repos?: string[] }` | `Snapshot['settings']`, or 400 `{ error }` |
| GET | `/api/repos?q=` | — | `RepoRef[]` (cloned flag set) |
| GET | `/api/stack?pr=<id>` | — | `StackDetail`, or 404 |

- [ ] **Step 1: Write the failing tests**

`server/__tests__/stack-detail.test.ts`:
```ts
import { buildStackDetail } from '../stack-detail';
import { createFakeProvider } from '../../test/fake-provider';
import { makePr } from '../../test/factories';
import { emptySnapshot } from '../../shared/types';

describe('buildStackDetail', () => {
  it('lists merged native entries below the open ones and fills behind counts', async () => {
    const bottom = makePr({ number: 4988, headRefName: 'offline-mode', nativeStack: { number: 4964, size: 4, position: 3, baseRefName: 'main' } });
    const top = makePr({ number: 4989, headRefName: 'orders', nativeStack: { number: 4964, size: 4, position: 4, baseRefName: 'main' } });
    const { provider } = createFakeProvider([bottom, top], {
      nativeStackEntries: async () => ({
        number: 4964, baseRefName: 'main',
        entries: [
          { position: 1, number: 4985, title: 'Add storage', state: 'merged' },
          { position: 2, number: 4986, title: 'Prefetch profile', state: 'merged' },
          { position: 3, number: 4988, title: bottom.title, state: 'open' },
          { position: 4, number: 4989, title: top.title, state: 'open' },
        ],
      }),
      compareRefs: async (_repo, base, head) => ({ behindBy: base === 'offline-mode' && head === 'orders' ? 2 : 0 }),
    });
    const snapshot = { ...emptySnapshot('acme'), prs: [bottom, top] };

    const detail = await buildStackDetail(provider, snapshot, top.id);

    expect(detail).toEqual({
      repo: 'orders-api', native: true, number: 4964, baseRefName: 'main',
      entries: [
        { number: 4985, title: 'Add storage', state: 'merged', position: 1 },
        { number: 4986, title: 'Prefetch profile', state: 'merged', position: 2 },
        { number: 4988, title: bottom.title, state: 'open', position: 3, behindParent: 0 },
        { number: 4989, title: top.title, state: 'open', position: 4, parentNumber: 4988, behindParent: 2 },
      ],
    });
  });

  it('returns null for a PR that is not in a stack', async () => {
    const lone = makePr();
    const { provider } = createFakeProvider([lone]);
    expect(await buildStackDetail(provider, { ...emptySnapshot('acme'), prs: [lone] }, lone.id)).toBeNull();
  });
});
```

`server/__tests__/app.test.ts`:
```ts
import request from 'supertest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { ConfigStore } from '../config';
import { SnapshotHub } from '../hub';
import { Poller } from '../poller';
import { PollLoop, Presence } from '../presence';
import { createFakeProvider } from '../../test/fake-provider';
import { makePr } from '../../test/factories';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'prdash-app-'));
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify({ codeHost: { provider: 'fake', org: 'acme', repos: ['orders-api'], localRepos: ['orders-api', 'orders-web'] } }));
  const store = await ConfigStore.open(path);
  const fake = createFakeProvider([makePr(), makePr()], { listRepos: async () => [{ name: 'report-service' }] });
  const hub = new SnapshotHub();
  const poller = new Poller({ provider: fake.provider, config: () => store.get(), onChange: (snapshot) => hub.publish(snapshot) });
  const presence = new Presence();
  const loop = new PollLoop({ poller, presence, intervalMs: () => null });
  const app = createApp({ poller, presence, loop, provider: fake.provider, store, hub });
  return { app, store, presence, poller };
}

describe('HTTP API', () => {
  it('refreshes on demand and returns the new snapshot', async () => {
    const { app } = await setup();
    const response = await request(app).post('/api/refresh').expect(200);
    expect(response.body.prs).toHaveLength(2);
    const snapshot = await request(app).get('/api/snapshot').expect(200);
    expect(snapshot.body.viewer.login).toBe('alex');
  });

  it('saves a valid refresh interval and rejects an invalid one', async () => {
    const { app, store } = await setup();
    const saved = await request(app).put('/api/settings').send({ refresh: 10 }).expect(200);
    expect(saved.body.refresh).toBe(10);
    expect(store.get().refreshIntervalSec).toBe(600);
    await request(app).put('/api/settings').send({ refresh: 1 }).expect(400);
  });

  it('rejects more than ten repositories', async () => {
    const { app } = await setup();
    const repos = Array.from({ length: 11 }, (_, index) => `repo-${index}`);
    const response = await request(app).put('/api/settings').send({ repos }).expect(400);
    expect(response.body.error).toMatch(/10/);
  });

  it('lists local clones when the search is empty and searches GitHub otherwise', async () => {
    const { app } = await setup();
    expect((await request(app).get('/api/repos').expect(200)).body).toEqual([
      { name: 'orders-api', cloned: true }, { name: 'orders-web', cloned: true },
    ]);
    expect((await request(app).get('/api/repos?q=report').expect(200)).body).toEqual([{ name: 'report-service', cloned: false }]);
  });

  it('tracks presence for connected clients', async () => {
    const { app, presence } = await setup();
    presence.connect('tab-1');
    await request(app).post('/api/presence').send({ client: 'tab-1', visible: false }).expect(204);
    expect(presence.anyVisible()).toBe(false);
  });

  it('streams the snapshot over SSE', async () => {
    const { app } = await setup();
    const server = app.listen(0, '127.0.0.1');
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/events?client=tab-1`, { signal: controller.signal });
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const { value } = await response.body!.getReader().read();
      expect(new TextDecoder().decode(value)).toContain('event: snapshot');
    } finally {
      controller.abort();
      server.close();
    }
  });

  it('returns 404 for the stack of a PR that is not stacked', async () => {
    const { app } = await setup();
    await request(app).post('/api/refresh');
    await request(app).get('/api/stack?pr=missing').expect(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/stack-detail.test.ts server/__tests__/app.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the hub and stack detail**

`server/hub.ts`:
```ts
import type { Snapshot } from '../shared/types';

export class SnapshotHub {
  private listeners = new Set<(snapshot: Snapshot) => void>();

  subscribe(listener: (snapshot: Snapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(snapshot: Snapshot): void {
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
```

`server/stack-detail.ts`:
```ts
import { detectStacks, membersBottomUp, stackIndex } from '../shared/stacks';
import type { Snapshot, StackDetail, StackEntryDetail } from '../shared/types';
import type { CodeHostProvider } from './providers/types';

export async function buildStackDetail(provider: CodeHostProvider, snapshot: Snapshot, prId: string): Promise<StackDetail | null> {
  const entry = stackIndex(detectStacks(snapshot.prs)).get(prId);
  if (!entry) return null;
  const { stack } = entry;
  const byId = new Map(snapshot.prs.map((pr) => [pr.id, pr]));
  const parentOf = new Map(stack.members.map((member) => [member.id, member.parentId]));
  const ordered = membersBottomUp(stack).map((id) => byId.get(id)!);

  const open: StackEntryDetail[] = await Promise.all(ordered.map(async (pr) => {
    const parent = parentOf.get(pr.id) ? byId.get(parentOf.get(pr.id)!) : undefined;
    const base = parent?.headRefName ?? pr.baseRefName;
    const { behindBy } = await provider.compareRefs(pr.repo, base, pr.headRefName);
    const detail: StackEntryDetail = { number: pr.number, title: pr.title, state: 'open', behindParent: behindBy };
    if (pr.nativeStack) detail.position = pr.nativeStack.position;
    if (parent) detail.parentNumber = parent.number;
    return detail;
  }));

  let notOpen: StackEntryDetail[] = [];
  if (stack.native) {
    const native = await provider.nativeStackEntries(stack.repo, ordered[0]!.number);
    const lowestOpen = Math.min(...ordered.map((pr) => pr.nativeStack?.position ?? Number.POSITIVE_INFINITY));
    notOpen = (native?.entries ?? [])
      .filter((candidate) => candidate.state !== 'open' && candidate.position < lowestOpen)
      .sort((a, b) => a.position - b.position)
      .map((candidate) => ({ number: candidate.number, title: candidate.title, state: candidate.state, position: candidate.position }));
  }

  const detail: StackDetail = { repo: stack.repo, native: stack.native, baseRefName: stack.baseRefName, entries: [...notOpen, ...open] };
  if (stack.number !== undefined) detail.number = stack.number;
  return detail;
}
```

- [ ] **Step 4: Implement the app and entry point**

`server/app.ts`:
```ts
import express from 'express';
import { MAX_REPOS, REFRESH_OPTIONS, type RefreshSetting } from '../shared/types';
import { refreshToSeconds, type ConfigStore } from './config';
import type { SnapshotHub } from './hub';
import type { Poller } from './poller';
import type { PollLoop, Presence } from './presence';
import type { CodeHostProvider } from './providers/types';
import { buildStackDetail } from './stack-detail';

export interface AppDeps {
  poller: Poller;
  presence: Presence;
  loop: PollLoop;
  provider: CodeHostProvider;
  store: ConfigStore;
  hub: SnapshotHub;
}

export function createApp({ poller, presence, loop, provider, store, hub }: AppDeps) {
  const app = express();
  app.use(express.json());

  app.get('/api/snapshot', (_req, res) => res.json(poller.snapshot()));

  app.get('/api/events', (req, res) => {
    const client = String(req.query.client ?? `anon-${Date.now()}`);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (snapshot: unknown) => res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    send(poller.snapshot());
    const unsubscribe = hub.subscribe(send);
    presence.connect(client);
    req.on('close', () => {
      unsubscribe();
      presence.disconnect(client);
    });
  });

  app.post('/api/presence', (req, res) => {
    presence.setVisible(String(req.body.client), Boolean(req.body.visible));
    res.status(204).end();
  });

  app.post('/api/refresh', async (_req, res) => {
    await poller.tick();
    loop.reschedule();
    res.json(poller.snapshot());
  });

  app.put('/api/settings', async (req, res) => {
    const { refresh, repos } = req.body as { refresh?: RefreshSetting; repos?: unknown };
    if (refresh !== undefined && !(REFRESH_OPTIONS as readonly unknown[]).includes(refresh)) {
      res.status(400).json({ error: `refresh must be one of ${REFRESH_OPTIONS.join(', ')}` });
      return;
    }
    if (repos !== undefined && (!Array.isArray(repos) || repos.length > MAX_REPOS || repos.some((repo) => typeof repo !== 'string'))) {
      res.status(400).json({ error: `repos must be a list of at most ${MAX_REPOS} names` });
      return;
    }
    const current = store.get();
    await store.save({
      ...current,
      refreshIntervalSec: refresh !== undefined ? refreshToSeconds(refresh) : current.refreshIntervalSec,
      codeHost: { ...current.codeHost, repos: (repos as string[] | undefined) ?? current.codeHost.repos },
    });
    poller.refreshSettings();
    if (repos !== undefined) await poller.tick();
    loop.reschedule();
    res.json(poller.snapshot().settings);
  });

  app.get('/api/repos', async (req, res) => {
    const text = String(req.query.q ?? '').trim();
    const local = new Set(store.get().codeHost.localRepos);
    const repos = text ? await provider.listRepos(text) : [...local].map((name) => ({ name }));
    res.json(repos.map((repo) => ({ ...repo, cloned: local.has(repo.name) })));
  });

  app.get('/api/stack', async (req, res) => {
    const detail = await buildStackDetail(provider, poller.snapshot(), String(req.query.pr ?? ''));
    if (!detail) {
      res.status(404).json({ error: 'Not part of a stack' });
      return;
    }
    res.json(detail);
  });

  return app;
}
```

`server/index.ts`:
```ts
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from './app';
import { ConfigError, ConfigStore } from './config';
import { createGhClient } from './gh';
import { SnapshotHub } from './hub';
import { Poller } from './poller';
import { PollLoop, Presence } from './presence';
import { createCodeHost } from './providers/registry';

const PORT = 4100;
const HOST = '127.0.0.1';

async function main() {
  const store = await ConfigStore.open(resolve(process.cwd(), 'config.json'));
  const provider = createCodeHost(store.get(), createGhClient());
  const hub = new SnapshotHub();
  const poller = new Poller({
    provider,
    config: () => store.get(),
    onChange: (snapshot) => {
      hub.publish(snapshot);
      // One line per refresh makes it easy to confirm polling stops when no tab is visible.
      console.log(`[${new Date().toLocaleTimeString()}] ${snapshot.prs.length} PRs, ${snapshot.rateLimit?.remaining ?? '?'} API points left${snapshot.stale ? ', stale' : ''}`);
    },
  });
  const presence = new Presence();
  const loop = new PollLoop({
    poller,
    presence,
    intervalMs: () => (store.get().refreshIntervalSec === 0 ? null : store.get().refreshIntervalSec * 1000),
  });
  const app = createApp({ poller, presence, loop, provider, store, hub });

  const dist = resolve(process.cwd(), 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }

  app.listen(PORT, HOST, () => console.log(`pearspective API on http://${HOST}:${PORT}`));
  loop.start();
}

main().catch((error) => {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server`
Expected: PASS (all server tests).

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "Add the HTTP API with SSE, settings, repo search and stack details."
```

---

### Task 13: `npm run setup`

**Files:**
- Create: `scripts/setup-lib.ts`, `scripts/setup.ts`, `scripts/__tests__/setup-lib.test.ts`

**Interfaces:**
- Consumes: `ConfigStore`, `ConfigSchema`, `DEFAULT_REVIEWER_CLASSES`, `Config` (Task 9); `createGhClient` (Task 6); `GithubProvider` (Task 8); `MAX_REPOS`, `RepoRef` (Task 1).
- Produces:
  - `parseRemote(url: string): { owner: string; repo: string } | null`
  - `rankCandidates(cloned: string[], activity: RepoRef[], openCounts: Record<string, number>): RepoRef[]`
  - `preselect(candidates: RepoRef[], max?: number): string[]`
  - `validateSelection(selected: string[]): true | string`
  - `mostCommonOwner(remotes: { owner: string }[]): string | null`
  - `buildConfig(input: { org: string; repos: string[]; teams: string[]; localRepos: string[] }, existing?: Config): Config`

- [ ] **Step 1: Write the failing tests**

`scripts/__tests__/setup-lib.test.ts`:
```ts
import { buildConfig, mostCommonOwner, parseRemote, preselect, rankCandidates, validateSelection } from '../setup-lib';

describe('parseRemote', () => {
  it.each([
    ['git@github.com:acme/orders-api.git', { owner: 'acme', repo: 'orders-api' }],
    ['https://github.com/acme/orders-web', { owner: 'acme', repo: 'orders-web' }],
    ['ssh://git@github.com/acme/field-api.git', { owner: 'acme', repo: 'field-api' }],
    ['https://acme.ghe.com/acme/report-service.git', { owner: 'acme', repo: 'report-service' }],
  ])('parses %s', (url, expected) => {
    expect(parseRemote(url)).toEqual(expected);
  });

  it('returns null for something that is not a remote URL', () => {
    expect(parseRemote('not a url')).toBeNull();
  });
});

describe('ranking and selection', () => {
  const activity = [{ name: 'orders-api', activity: 161 }, { name: 'orders-public-api', activity: 5 }, { name: 'report-service', activity: 1 }];
  const openCounts = { 'orders-api': 42, 'orders-public-api': 0, 'report-service': 7, 'field-legacy': 3 };
  const ranked = rankCandidates(['orders-api', 'orders-public-api', 'field-legacy'], activity, openCounts);

  it('merges cloned and active repos, marking which are cloned', () => {
    expect(ranked).toEqual([
      { name: 'orders-api', activity: 161, openCount: 42, cloned: true },
      { name: 'orders-public-api', activity: 5, openCount: 0, cloned: true },
      { name: 'report-service', activity: 1, openCount: 7, cloned: false },
      { name: 'field-legacy', activity: 0, openCount: 3, cloned: true },
    ]);
  });

  it('pre-selects by activity, skipping repos without open PRs, up to the cap', () => {
    expect(preselect(ranked, 2)).toEqual(['orders-api', 'report-service']);
  });

  it('refuses an empty selection or more than ten repos', () => {
    expect(validateSelection([])).toMatch(/at least one/);
    expect(validateSelection(Array.from({ length: 11 }, (_, index) => `r${index}`))).toMatch(/10/);
    expect(validateSelection(['orders-api'])).toBe(true);
  });

  it('picks the owner most remotes point at', () => {
    expect(mostCommonOwner([{ owner: 'acme' }, { owner: 'acme' }, { owner: 'other' }])).toBe('acme');
    expect(mostCommonOwner([])).toBeNull();
  });
});

describe('buildConfig', () => {
  it('creates a config with defaults', () => {
    expect(buildConfig({ org: 'acme', repos: ['orders-api'], teams: ['core'], localRepos: ['orders-api'] })).toMatchObject({
      codeHost: { provider: 'github', org: 'acme', repos: ['orders-api'], teams: ['core'], localRepos: ['orders-api'], excludeRepos: [] },
      refreshIntervalSec: 180,
    });
  });

  it('keeps reviewer classes and refresh from an existing config', () => {
    const existing = buildConfig({ org: 'acme', repos: [], teams: [], localRepos: [] });
    existing.refreshIntervalSec = 600;
    existing.reviewerClasses['ai-review'] = ['custom-bot'];
    const next = buildConfig({ org: 'acme', repos: ['x'], teams: [], localRepos: [] }, existing);
    expect(next.refreshIntervalSec).toBe(600);
    expect(next.reviewerClasses['ai-review']).toEqual(['custom-bot']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `scripts/setup-lib.ts`**

```ts
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

export function buildConfig(input: { org: string; repos: string[]; teams: string[]; localRepos: string[] }, existing?: Config): Config {
  return ConfigSchema.parse({
    ...existing,
    codeHost: { ...existing?.codeHost, provider: 'github', org: input.org, repos: input.repos, teams: input.teams, localRepos: input.localRepos },
    reviewerClasses: existing?.reviewerClasses ?? DEFAULT_REVIEWER_CLASSES,
    refreshIntervalSec: existing?.refreshIntervalSec ?? 180,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts`
Expected: PASS.

- [ ] **Step 5: Implement the interactive script**

`scripts/setup.ts`:
```ts
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { checkbox, input } from '@inquirer/prompts';
import { ConfigStore, type Config } from '../server/config';
import { createGhClient } from '../server/gh';
import { GithubProvider } from '../server/providers/codehost/github/provider';
import { buildConfig, mostCommonOwner, parseRemote, preselect, rankCandidates, validateSelection } from './setup-lib';

const run = promisify(execFile);
const CONFIG_PATH = resolve(process.cwd(), 'config.json');

async function gitDirs(root: string, depth = 2): Promise<string[]> {
  if (existsSync(join(root, '.git'))) return [root];
  if (depth === 0) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => gitDirs(join(root, entry.name), depth - 1)));
  return nested.flat();
}

async function originOf(dir: string) {
  const { stdout } = await run('git', ['-C', dir, 'remote', 'get-url', 'origin']).catch(() => ({ stdout: '' }));
  return parseRemote(stdout);
}

async function main() {
  const existing: Config | undefined = await ConfigStore.open(CONFIG_PATH).then((store) => store.get()).catch(() => undefined);
  const folder = await input({ message: 'Folder with your git clones', default: dirname(process.cwd()) });
  const remotes = (await Promise.all((await gitDirs(resolve(folder))).map(originOf))).filter((remote): remote is NonNullable<typeof remote> => !!remote);
  const org = await input({ message: 'GitHub organisation', default: existing?.codeHost.org ?? mostCommonOwner(remotes) ?? '' });
  const cloned = [...new Set(remotes.filter((remote) => remote.owner === org).map((remote) => remote.repo))];
  console.log(`Found ${cloned.length} local clones in ${org}. Asking GitHub for your activity…`);

  const provider = new GithubProvider(createGhClient(), org, existing?.reviewerClasses ?? { 'ai-review': [], 'code-analysis': [] });
  const auth = await provider.checkAuth();
  if (!auth.ok) throw new Error(auth.message);
  const activity = await provider.rankReposByActivity(90);
  const candidates = [...new Set([...cloned, ...activity.slice(0, 30).map((repo) => repo.name)])];
  const openCounts = await provider.openCounts(candidates);
  const ranked = rankCandidates(cloned, activity.filter((repo) => candidates.includes(repo.name)), openCounts);
  const preselected = new Set(existing?.codeHost.repos.length ? existing.codeHost.repos : preselect(ranked));

  const repos = await checkbox({
    message: 'Repositories for the Overview (max 10, space to toggle)',
    pageSize: 20,
    choices: ranked.map((repo) => ({
      name: `${repo.name.padEnd(36)} ${String(repo.openCount).padStart(3)} open · activity ${repo.activity}${repo.cloned ? '' : ' · not cloned'}`,
      value: repo.name,
      checked: preselected.has(repo.name),
    })),
    validate: (choices) => validateSelection(choices.map((choice) => choice.value)),
  });

  const config = buildConfig({ org, repos, teams: auth.viewer.teams.map((team) => team.slug), localRepos: cloned }, existing);
  if (existsSync(CONFIG_PATH)) await (await ConfigStore.open(CONFIG_PATH)).save(config);
  else {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  }
  console.log(`Saved ${CONFIG_PATH} with ${repos.length} repositories and teams: ${config.codeHost.teams.join(', ') || 'none'}.`);
  console.log(`API points left: ${provider.lastRateLimit()?.remaining ?? 'unknown'}. Next: npm run dev`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 6: Run setup for real**

Run: `npm run setup` and accept the defaults. The folder defaults to the parent of the project, which is `~/Projects`.
Expected:
- It lists about 26 local clones plus active repos that aren't cloned.
- About 10 of them are pre-checked: the most active ones that have open PRs.
- Checking an 11th shows the validation message.
- `config.json` is written with `teams: ["platform-team"]`.

- [ ] **Step 7: Commit**

```bash
git add scripts
git commit -m "Add npm run setup to choose repositories and write config.json."
```

---

### Task 14: Web shell: theme tokens, Avatar, ThemeToggle

**Files:**
- Create: `web/index.html`, `web/src/styles/tokens.css`, `web/src/styles/app.css`, `web/src/theme.ts`, `web/src/components/Avatar.tsx`, `web/src/components/ThemeToggle.tsx`, `web/src/__tests__/Avatar.test.tsx`, `web/src/__tests__/ThemeToggle.test.tsx`

**Interfaces:**
- Produces:
  - `type ThemeChoice = 'system' | 'light' | 'dark'`, `readTheme(): ThemeChoice`, `applyTheme(choice: ThemeChoice): void`
  - `<Avatar name: string url?: string size?: number />`: initials on a deterministic tint, with the image layered on top once it loads
  - `<ThemeToggle />`: System / Light / Dark segmented control
  - CSS class vocabulary used by every later component:
    - layout and controls: `segs seg on icon-btn chip off row sel stack pr prtext rn title badges badge sigs dot age track age-label lane lane-head stackbar stack-members stack-links link arrow hot stack-base base-pill drawer modal`
    - colours: `k-{green|amber|red|grey}`, `sev-{red|amber|grey|info}`, `fill-{blocked|waiting|ready|draft}`

- [ ] **Step 1: Write the theme tokens**

`web/src/styles/tokens.css` (the same values as the mockup, plus avatar tints):
```css
:root {
  color-scheme: light;
  --bg:#f6f7f9; --surface:#fff; --subtle:#f6f8fa; --border:#d0d7de; --hair:#eaeef2; --text:#1f2328; --text2:#424a53; --muted:#59636e; --accent:#0969da; --accent-fg:#fff;
  --g-bg:#dafbe1; --g-fg:#116329; --a-bg:#fff1c2; --a-fg:#6f4a00; --r-bg:#ffe0e3; --r-fg:#a40e26; --n-bg:#eef1f4; --n-fg:#4b535d; --b-bg:#ddf4ff; --b-fg:#0550ae;
  --c-blocked:#cf222e; --c-waiting:#d4a72c; --c-ready:#2da44e; --c-draft:#8c959f; --c-merged:#8250df; --behind:#953800;
  --hatch-a:#8c959f; --hatch-b:#d0d7de; --sel:#eef5ff; --stackrow:#f6f8ff; --track:#f0f2f5; --canvas:#fbfcfd;
  --edge:#8c959f; --edge-merged:#c4ccd4; --merged-card:#f6f8fa; --pill:#1f2328; --pill-fg:#fff; --shadow:rgba(31,35,40,.15); --backdrop:rgba(31,35,40,.45);
  --av0-bg:#ddf4ff; --av0-fg:#0550ae; --av1-bg:#fbefff; --av1-fg:#6e40c9; --av2-bg:#fff1e5; --av2-fg:#953800; --av3-bg:#dafbe1; --av3-fg:#116329; --av4-bg:#ffeff7; --av4-fg:#99286e;
  --mono:'JetBrains Mono', ui-monospace, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg:#0d1117; --surface:#161b22; --subtle:#1c2128; --border:#30363d; --hair:#21262d; --text:#e6edf3; --text2:#c9d1d9; --muted:#9198a1; --accent:#4493f8; --accent-fg:#0d1117;
    --g-bg:rgba(46,160,67,.2); --g-fg:#56d364; --a-bg:rgba(187,128,9,.22); --a-fg:#e3b341; --r-bg:rgba(248,81,73,.2); --r-fg:#ff7b72; --n-bg:#262c36; --n-fg:#9198a1; --b-bg:rgba(56,139,253,.2); --b-fg:#79c0ff;
    --c-blocked:#f85149; --c-waiting:#d29922; --c-ready:#3fb950; --c-draft:#6e7681; --c-merged:#a371f7; --behind:#f0883e;
    --hatch-a:#6e7681; --hatch-b:#30363d; --sel:rgba(56,139,253,.14); --stackrow:#161d2b; --track:#21262d; --canvas:#0d1117;
    --edge:#6e7681; --edge-merged:#3d444d; --merged-card:#1c2128; --pill:#e6edf3; --pill-fg:#0d1117; --shadow:rgba(0,0,0,.5); --backdrop:rgba(1,4,9,.7);
    --av0-bg:rgba(56,139,253,.2); --av0-fg:#79c0ff; --av1-bg:rgba(163,113,247,.2); --av1-fg:#d2a8ff; --av2-bg:rgba(240,136,62,.2); --av2-fg:#ffa657; --av3-bg:rgba(46,160,67,.2); --av3-fg:#56d364; --av4-bg:rgba(219,97,162,.2); --av4-fg:#ff9bce;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg:#0d1117; --surface:#161b22; --subtle:#1c2128; --border:#30363d; --hair:#21262d; --text:#e6edf3; --text2:#c9d1d9; --muted:#9198a1; --accent:#4493f8; --accent-fg:#0d1117;
  --g-bg:rgba(46,160,67,.2); --g-fg:#56d364; --a-bg:rgba(187,128,9,.22); --a-fg:#e3b341; --r-bg:rgba(248,81,73,.2); --r-fg:#ff7b72; --n-bg:#262c36; --n-fg:#9198a1; --b-bg:rgba(56,139,253,.2); --b-fg:#79c0ff;
  --c-blocked:#f85149; --c-waiting:#d29922; --c-ready:#3fb950; --c-draft:#6e7681; --c-merged:#a371f7; --behind:#f0883e;
  --hatch-a:#6e7681; --hatch-b:#30363d; --sel:rgba(56,139,253,.14); --stackrow:#161d2b; --track:#21262d; --canvas:#0d1117;
  --edge:#6e7681; --edge-merged:#3d444d; --merged-card:#1c2128; --pill:#e6edf3; --pill-fg:#0d1117; --shadow:rgba(0,0,0,.5); --backdrop:rgba(1,4,9,.7);
  --av0-bg:rgba(56,139,253,.2); --av0-fg:#79c0ff; --av1-bg:rgba(163,113,247,.2); --av1-fg:#d2a8ff; --av2-bg:rgba(240,136,62,.2); --av2-fg:#ffa657; --av3-bg:rgba(46,160,67,.2); --av3-fg:#56d364; --av4-bg:rgba(219,97,162,.2); --av4-fg:#ff9bce;
}
```

- [ ] **Step 2: Write the component styles**

`web/src/styles/app.css`:
```css
* { box-sizing: border-box }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.4 Inter, system-ui, sans-serif }
a { color: var(--accent) } a:hover { color: var(--b-fg) }
button, input, select { font: inherit; color: inherit }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0) }
.muted { color: var(--muted) } .small { font-size: 12px } .grow { flex: 1 1 auto }
.app { max-width: 1440px; margin: 0 auto; padding-bottom: 48px }
.loading, .empty-state { padding: 48px 24px; color: var(--muted) }

.top { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; padding: 14px 24px; background: var(--surface); border-bottom: 1px solid var(--border) }
.brand { display: flex; align-items: center; gap: 10px } .brand b { font-size: 16px }
.hdr-right { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); flex-wrap: wrap }
.segs { display: flex; gap: 4px; background: var(--subtle); border: 1px solid var(--border); border-radius: 8px; padding: 3px; align-items: center }
.segs .lbl { font-size: 12px; color: var(--muted); padding: 0 8px }
.seg { border: 0; background: transparent; cursor: pointer; height: 30px; padding: 0 12px; border-radius: 6px; font-size: 13px; font-weight: 500; color: var(--muted) }
.seg.on { background: var(--surface); box-shadow: 0 1px 2px var(--shadow); color: var(--text) }
select { height: 32px; border: 1px solid var(--border); border-radius: 6px; padding: 0 8px; background: var(--surface) }
.icon-btn { border: 1px solid var(--border); background: var(--surface); cursor: pointer; width: 32px; height: 32px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center }
.icon-btn:hover { background: var(--hair) } .icon-btn.ghost { border: 0; background: transparent; width: 28px; height: 28px }
.who { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px 0 4px; border-radius: 999px; background: var(--subtle); border: 1px solid var(--border); color: var(--text) }

.avatar { position: relative; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; flex: 0 0 auto; overflow: hidden }
.avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity .15s }
.av-0 { background: var(--av0-bg); color: var(--av0-fg) } .av-1 { background: var(--av1-bg); color: var(--av1-fg) } .av-2 { background: var(--av2-bg); color: var(--av2-fg) }
.av-3 { background: var(--av3-bg); color: var(--av3-fg) } .av-4 { background: var(--av4-bg); color: var(--av4-fg) }

.banner { margin: 12px 24px 0; padding: 10px 14px; border-radius: 8px; font-size: 13px }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 14px 24px }
.chip { cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 999px; font-size: 13px; font-weight: 500; border: 1px solid var(--text); background: var(--surface) }
.chip.off { border-style: dashed; border-color: var(--border); background: transparent; color: var(--muted) }
.chip .n { color: var(--muted); font-weight: 600 } .chip .d { width: 8px; height: 8px; border-radius: 50% }
.search { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; flex: 0 1 280px }
.search input { border: 0; outline: none; font-size: 13px; width: 100%; background: transparent }

.layout { display: flex; flex-wrap: wrap; gap: 20px; padding: 0 24px; align-items: flex-start }
.board-wrap { flex: 999 1 760px; min-width: 0; overflow-x: auto }
.board { min-width: 820px; display: flex; flex-direction: column; gap: 14px }
.cols, .row { display: grid; grid-template-columns: minmax(0, 1fr) 216px 300px; gap: 16px; align-items: center }
.cols { padding: 0 16px; font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; align-items: end }
.sig-heads { display: flex; gap: 8px } .sig-heads span { width: 28px; text-align: center }
.ruler { position: relative; height: 16px }
.ruler span { position: absolute; bottom: 0; transform: translateX(-50%); text-transform: none; letter-spacing: 0; font-weight: 500 }
.note { margin: 4px 0 0; font-size: 12px; color: var(--muted) }

.lane { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden }
.lane-head { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 10px 16px; background: var(--subtle) }
.lane-title { font-weight: 600; font-size: 15px }
.lane-icon { width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--n-bg); color: var(--n-fg) }
.stackbar { display: flex; width: 180px; height: 10px; border-radius: 999px; overflow: hidden; background: var(--hair) }
.empty { padding: 14px 16px; font-size: 13px; color: var(--muted); border-top: 1px solid var(--hair) }

.row { padding: 10px 16px; border: 0; border-top: 1px solid var(--hair); background: transparent; cursor: pointer; width: 100%; text-align: left }
.row:hover { background: var(--subtle) }
.row.sel { background: var(--sel); box-shadow: inset 3px 0 0 var(--accent) }
.row.stack { background: var(--stackrow); cursor: default }
.pr { display: flex; gap: 10px; min-width: 0 }
.stack-members { position: relative }
.stack-links { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible }
.stack-links .link { fill: none; stroke: var(--edge); stroke-width: 1.5; stroke-linejoin: miter }
.stack-links .link.hot { stroke: var(--accent); stroke-width: 2 }
.stack-links .arrow { fill: var(--edge) } .stack-links .arrow.hot { fill: var(--accent) }
.stack-base { display: flex; align-items: center; gap: 10px; padding: 8px 16px 12px; border-top: 1px solid var(--hair); background: var(--stackrow) }
.base-pill { font: 600 12px var(--mono); padding: 3px 10px; border-radius: 999px; background: var(--pill); color: var(--pill-fg) }
.prtext { display: flex; flex-direction: column; gap: 4px; min-width: 0 }
.rn { font-size: 12px; color: var(--muted); font-family: var(--mono) }
.title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.badges { display: flex; flex-wrap: wrap; gap: 4px }
.badge { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap }
.k-green, .sev-green { background: var(--g-bg); color: var(--g-fg) }
.k-amber, .sev-amber { background: var(--a-bg); color: var(--a-fg) }
.k-red, .sev-red { background: var(--r-bg); color: var(--r-fg) }
.k-grey, .sev-grey { background: var(--n-bg); color: var(--n-fg) }
.sev-info { background: var(--b-bg); color: var(--b-fg) }
.sigs { display: flex; gap: 8px }
.dot { width: 28px; height: 24px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; font-family: var(--mono) }
.age { display: flex; align-items: center; gap: 8px }
.track { position: relative; flex: 1 1 auto; height: 12px; border-radius: 3px; background: var(--track) }
.track i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px }
.age-label { width: 34px; text-align: right; font-size: 12px; color: var(--muted); font-family: var(--mono) }
.fill-blocked { background: var(--c-blocked) } .fill-waiting { background: var(--c-waiting) } .fill-ready { background: var(--c-ready) }
.fill-draft { background: repeating-linear-gradient(45deg, var(--hatch-a) 0 4px, var(--hatch-b) 4px 8px) }
.toggle { border: 0; background: transparent; cursor: pointer; display: flex; align-items: center; gap: 10px; text-align: left; padding: 0; min-width: 0 }
.pips { display: flex; gap: 3px; flex-wrap: wrap } .pips i { width: 14px; height: 14px; border-radius: 4px }
.btn { cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); font-size: 12px; font-weight: 600 }
.btn:hover { background: var(--hair) } .btn:disabled { opacity: .5; cursor: not-allowed }

.drawer { flex: 1 1 340px; min-width: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px; display: flex; flex-direction: column; gap: 16px }
.drawer h2 { margin: 0; font-size: 18px; line-height: 1.3 }
.sec { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em }
.sline { display: flex; align-items: center; gap: 10px; font-size: 13px } .sline b { width: 92px }
.snip { font-size: 13px; background: var(--subtle); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px }
.mini { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 8px; align-items: center; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; font-size: 13px; text-align: left; width: 100% }
.mini:hover { background: var(--subtle) } .mini.cur { background: var(--sel) }
.mini i { width: 14px; height: 14px; border-radius: 4px } .mini span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis }

.modal-backdrop { position: fixed; inset: 0; background: var(--backdrop); display: flex; align-items: center; justify-content: center; z-index: 10 }
.modal { background: var(--surface); color: var(--text); border-radius: 14px; width: min(1000px, 94vw); height: min(820px, 90vh); display: flex; flex-direction: column; box-shadow: 0 24px 64px var(--shadow) }
.modal-head { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--hair); flex-wrap: wrap }
.modal-head h3 { margin: 0; font-size: 16px }
.modal-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: auto; padding: 0 }
.legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--muted); padding: 10px 18px; border-top: 1px solid var(--hair) }
.legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 6px; vertical-align: -1px }
.stack-svg { display: block; width: 100%; flex: 1 1 auto; min-height: 420px; background: var(--canvas); cursor: grab }
.stacks { display: grid; grid-template-columns: repeat(auto-fill, minmax(520px, 1fr)); gap: 16px; padding: 0 24px }
.scard { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; display: flex; flex-direction: column }
.scard-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--hair); flex-wrap: wrap }
.settings-list { display: flex; flex-direction: column; gap: 4px; padding: 12px 18px; overflow: auto }
.settings-list label { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 6px }
.settings-list label:hover { background: var(--subtle) }
```

- [ ] **Step 3: Write `web/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pearspective</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<script>
  // Applied before first paint so a dark-mode user never sees a white flash.
  try { var saved = localStorage.getItem('theme'); if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved; } catch (e) {}
</script>
</head>
<body>
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 4: Write the failing tests**

`web/src/__tests__/Avatar.test.tsx`:
```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { Avatar } from '../components/Avatar';

describe('Avatar', () => {
  it('shows initials and keeps the image invisible until it loads', () => {
    const { container } = render(<Avatar name="Alex Rivera" url="https://avatars.example.test/alex" />);
    expect(screen.getByText('ML')).toBeInTheDocument();
    const image = container.querySelector('img')!;
    expect(image).toHaveStyle({ opacity: '0' });
    fireEvent.load(image);
    expect(image).toHaveStyle({ opacity: '1' });
  });

  it('drops the image and keeps the initials when it fails to load', () => {
    const { container } = render(<Avatar name="platform-team" url="https://avatars.example.test/broken" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('CA')).toBeInTheDocument();
  });

  it('gives the same name the same tint every time', () => {
    const first = render(<Avatar name="sam" />).container.firstElementChild!.className;
    const second = render(<Avatar name="sam" />).container.firstElementChild!.className;
    expect(first).toBe(second);
    expect(first).toMatch(/av-\d/);
  });
});
```

`web/src/__tests__/ThemeToggle.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from '../components/ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('starts on System and marks it pressed', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'System theme' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('applies and remembers Dark, and System clears both again', async () => {
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button', { name: 'Dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');

    await userEvent.click(screen.getByRole('button', { name: 'System theme' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('theme')).toBeNull();
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run web/src/__tests__/Avatar.test.tsx web/src/__tests__/ThemeToggle.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 6: Implement**

`web/src/theme.ts`:
```ts
export type ThemeChoice = 'system' | 'light' | 'dark';

export function readTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem('theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', choice);
  } catch {
    // Storage can be blocked; the theme still applies for this page view.
  }
}
```

`web/src/components/Avatar.tsx`:
```tsx
import { useState } from 'react';

const initialsOf = (name: string) =>
  name.split(/[\s_-]+/).filter(Boolean).map((part) => part[0]!).join('').slice(0, 2).toUpperCase();

function tintIndex(name: string): number {
  let total = 0;
  for (const character of name) total += character.charCodeAt(0);
  return total % 5;
}

/** Decorative: callers always show the name next to it, so screen readers skip it. */
export function Avatar({ name, url, size = 28 }: { name: string; url?: string; size?: number }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className={`avatar av-${tintIndex(name)}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {initialsOf(name)}
      {url && !failed && (
        <img src={url} alt="" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} style={{ opacity: loaded ? 1 : 0 }} />
      )}
    </span>
  );
}
```

`web/src/components/ThemeToggle.tsx`:
```tsx
import { useState, type ReactNode } from 'react';
import { applyTheme, readTheme, type ThemeChoice } from '../theme';

const icon = (paths: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
);

const OPTIONS: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System', icon: icon(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>) },
  { value: 'light', label: 'Light', icon: icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>) },
  { value: 'dark', label: 'Dark', icon: icon(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />) },
];

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  return (
    <div className="segs" role="group" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`seg${choice === option.value ? ' on' : ''}`}
          style={{ padding: '0 8px' }}
          aria-pressed={choice === option.value}
          aria-label={`${option.label} theme`}
          title={option.label}
          onClick={() => {
            applyTheme(option.value);
            setChoice(option.value);
          }}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run web/src/__tests__/Avatar.test.tsx web/src/__tests__/ThemeToggle.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web
git commit -m "Add the web shell with theme tokens, Avatar and ThemeToggle."
```

---

### Task 15: Web data layer: API client, live snapshot, URL state

**Files:**
- Create: `web/src/api/client.ts`, `web/src/api/useDashboard.ts`, `web/src/state/urlState.ts`, `web/src/main.tsx`, `web/src/App.tsx` (minimal first version; replaced in Tasks 17 and 21), `web/src/__tests__/urlState.test.ts`, `web/src/__tests__/client.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `RefreshSetting`, `RepoRef`, `StackDetail` (Task 1); `GroupBy`, `ViewFilters`, `DEFAULT_FILTERS` (Task 5); `Bucket` (Task 2).
- Produces:
  - `interface DashboardApi { getSnapshot(); subscribe(clientId, onSnapshot): () => void; setVisible(clientId, visible): Promise<void>; refreshNow(): Promise<Snapshot>; updateSettings(patch: { refresh?: RefreshSetting; repos?: string[] }): Promise<Snapshot['settings']>; searchRepos(q: string): Promise<RepoRef[]>; stackDetail(prId: string): Promise<StackDetail | null> }`
  - `createHttpApi(base?: string): DashboardApi`
  - `useDashboard(api): { snapshot: Snapshot | null; refreshNow(): Promise<void>; updateSettings(patch): Promise<void> }`
  - `type Tab = 'overview' | 'mine' | 'stacks'`, `interface UrlState { tab: Tab; groupBy: GroupBy; filters: ViewFilters; selected: string | null }`
  - `parseUrlState(search: string): UrlState`, `serializeUrlState(state: UrlState): string`, `useUrlState(): [UrlState, (patch: Partial<UrlState>) => void]`

- [ ] **Step 1: Write the failing tests**

`web/src/__tests__/urlState.test.ts`:
```ts
import { parseUrlState, serializeUrlState } from '../state/urlState';

describe('URL state', () => {
  it('defaults to Overview grouped by author, oldest first, drafts hidden', () => {
    expect(parseUrlState('')).toEqual({
      tab: 'overview', groupBy: 'author', selected: null,
      filters: { show: { blocked: true, waiting: true, ready: true, draft: false }, q: '', newestFirst: false },
    });
  });

  it('writes nothing for the defaults', () => {
    expect(serializeUrlState(parseUrlState(''))).toBe('');
  });

  it('round-trips every setting', () => {
    const state = {
      tab: 'mine' as const, groupBy: 'ticket' as const, selected: 'PR_4988',
      filters: { show: { blocked: true, waiting: false, ready: false, draft: true }, q: 'offline mode', newestFirst: true },
    };
    const search = serializeUrlState(state);
    expect(search).toBe('?tab=mine&group=ticket&show=blocked%2Cdraft&q=offline+mode&sort=newest&pr=PR_4988');
    expect(parseUrlState(search)).toEqual(state);
  });

  it('ignores unknown values', () => {
    expect(parseUrlState('?tab=nope&group=nope')).toMatchObject({ tab: 'overview', groupBy: 'author' });
  });
});
```

`web/src/__tests__/client.test.ts`:
```ts
import { createHttpApi } from '../api/client';

describe('createHttpApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('surfaces the server error message when settings are rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'repos must be a list of at most 10 names' }), { status: 400 })));
    await expect(createHttpApi().updateSettings({ repos: [] })).rejects.toThrow('repos must be a list of at most 10 names');
  });

  it('returns null for a PR that is not in a stack', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    expect(await createHttpApi().stackDetail('PR_1')).toBeNull();
  });

  it('sends presence as JSON', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await createHttpApi().setVisible('tab-1', false);
    expect(fetchMock).toHaveBeenCalledWith('/api/presence', expect.objectContaining({ method: 'POST', body: '{"client":"tab-1","visible":false}' }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run web/src/__tests__/urlState.test.ts web/src/__tests__/client.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`web/src/api/client.ts`:
```ts
import type { RefreshSetting, RepoRef, Snapshot, StackDetail } from '../../../shared/types';

export interface DashboardApi {
  getSnapshot(): Promise<Snapshot>;
  subscribe(clientId: string, onSnapshot: (snapshot: Snapshot) => void): () => void;
  setVisible(clientId: string, visible: boolean): Promise<void>;
  refreshNow(): Promise<Snapshot>;
  updateSettings(patch: { refresh?: RefreshSetting; repos?: string[] }): Promise<Snapshot['settings']>;
  searchRepos(q: string): Promise<RepoRef[]>;
  stackDetail(prId: string): Promise<StackDetail | null>;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function createHttpApi(base = ''): DashboardApi {
  return {
    getSnapshot: () => fetch(`${base}/api/snapshot`).then((response) => json<Snapshot>(response)),
    subscribe(clientId, onSnapshot) {
      const source = new EventSource(`${base}/api/events?client=${encodeURIComponent(clientId)}`);
      source.addEventListener('snapshot', (event) => onSnapshot(JSON.parse((event as MessageEvent).data)));
      return () => source.close();
    },
    setVisible: async (clientId, visible) => {
      await fetch(`${base}/api/presence`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ client: clientId, visible }) });
    },
    refreshNow: () => fetch(`${base}/api/refresh`, { method: 'POST' }).then((response) => json<Snapshot>(response)),
    updateSettings: (patch) =>
      fetch(`${base}/api/settings`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) }).then((response) => json<Snapshot['settings']>(response)),
    searchRepos: (q) => fetch(`${base}/api/repos?q=${encodeURIComponent(q)}`).then((response) => json<RepoRef[]>(response)),
    async stackDetail(prId) {
      const response = await fetch(`${base}/api/stack?pr=${encodeURIComponent(prId)}`);
      return response.status === 404 ? null : json<StackDetail>(response);
    },
  };
}
```

`web/src/api/useDashboard.ts`:
```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RefreshSetting, Snapshot } from '../../../shared/types';
import type { DashboardApi } from './client';

export function useDashboard(api: DashboardApi) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const clientId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    let active = true;
    api.getSnapshot().then((initial) => active && setSnapshot(initial)).catch(() => undefined);
    const unsubscribe = api.subscribe(clientId, setSnapshot);
    // The server polls only while some tab is visible, to save API budget.
    const onVisibility = () => void api.setVisible(clientId, document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [api, clientId]);

  const refreshNow = useCallback(async () => setSnapshot(await api.refreshNow()), [api]);
  const updateSettings = useCallback(async (patch: { refresh?: RefreshSetting; repos?: string[] }) => {
    const settings = await api.updateSettings(patch);
    setSnapshot((current) => (current ? { ...current, settings } : current));
  }, [api]);

  return { snapshot, refreshNow, updateSettings };
}
```

`web/src/state/urlState.ts`:
```ts
import { useCallback, useState } from 'react';
import { DEFAULT_FILTERS, type GroupBy, type ViewFilters } from '../../../shared/grouping';
import type { Bucket } from '../../../shared/status';

export type Tab = 'overview' | 'mine' | 'stacks';
export interface UrlState { tab: Tab; groupBy: GroupBy; filters: ViewFilters; selected: string | null }

const TABS: Tab[] = ['overview', 'mine', 'stacks'];
const GROUPS: GroupBy[] = ['author', 'repo', 'ticket'];
const BUCKETS: Bucket[] = ['blocked', 'waiting', 'ready', 'draft'];

export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const showParam = params.get('show');
  const show = showParam === null
    ? { ...DEFAULT_FILTERS.show }
    : (Object.fromEntries(BUCKETS.map((bucket) => [bucket, showParam.split(',').includes(bucket)])) as Record<Bucket, boolean>);
  return {
    tab: TABS.find((tab) => tab === params.get('tab')) ?? 'overview',
    groupBy: GROUPS.find((group) => group === params.get('group')) ?? 'author',
    filters: { show, q: params.get('q') ?? '', newestFirst: params.get('sort') === 'newest' },
    selected: params.get('pr'),
  };
}

export function serializeUrlState(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.tab !== 'overview') params.set('tab', state.tab);
  if (state.groupBy !== 'author') params.set('group', state.groupBy);
  const shown = BUCKETS.filter((bucket) => state.filters.show[bucket]).join(',');
  if (shown !== BUCKETS.filter((bucket) => DEFAULT_FILTERS.show[bucket]).join(',')) params.set('show', shown);
  if (state.filters.q) params.set('q', state.filters.q);
  if (state.filters.newestFirst) params.set('sort', 'newest');
  if (state.selected) params.set('pr', state.selected);
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function useUrlState(): [UrlState, (patch: Partial<UrlState>) => void] {
  const [state, setState] = useState(() => parseUrlState(window.location.search));
  const update = useCallback((patch: Partial<UrlState>) => {
    setState((current) => {
      const next = { ...current, ...patch };
      window.history.replaceState(null, '', `${window.location.pathname}${serializeUrlState(next)}`);
      return next;
    });
  }, []);
  return [state, update];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run web/src/__tests__/urlState.test.ts web/src/__tests__/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the entry point and a minimal App, so the browser path is proven early**

`web/src/main.tsx` (final; later tasks only replace `App.tsx`):
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHttpApi } from './api/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App api={createHttpApi()} />
  </StrictMode>,
);
```

`web/src/App.tsx` (first version):
```tsx
import type { DashboardApi } from './api/client';
import { useDashboard } from './api/useDashboard';
import { ThemeToggle } from './components/ThemeToggle';

export function App({ api }: { api: DashboardApi }) {
  const { snapshot } = useDashboard(api);
  const status = !snapshot
    ? 'Loading…'
    : `${snapshot.prs.length} open PRs loaded · ${snapshot.fetchedAt ? `updated ${new Date(snapshot.fetchedAt).toLocaleTimeString()}` : 'waiting for the first refresh'}`;
  return (
    <div className="app">
      <header className="top"><b>Pearspective</b><span className="grow" /><ThemeToggle /></header>
      <p className="loading">{status}</p>
      {snapshot?.banners.map((banner) => <p key={banner.kind} className="banner sev-amber">{banner.message}</p>)}
    </div>
  );
}
```

- [ ] **Step 6: Open it in a browser**

You need a `config.json` from Task 13 (`npm run setup`). Run `npm run dev` in the background, then open `http://127.0.0.1:5173`.

Expected:
- The page shows "Loading…", then "N open PRs loaded · updated HH:MM:SS" within a few seconds. That proves the Vite proxy, SSE, presence and the poller end to end.
- The server log prints one refresh line.
- The theme toggle switches light and dark.

If Vite answers 403 for `/@fs/.../shared/...`, check that `server.fs.allow: ['..']` is in `vite.config.ts`. If the count never appears, check the browser's network tab for `/api/events`: it must stay open with `text/event-stream`. Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "Add the web API client, live snapshot hook, URL state and a first App shell."
```

---

### Task 16: Row components: status squares, age bar and ruler, PR row, stack row

**Files:**
- Create: `web/src/lib/ageScale.ts`, `web/src/components/StatusSquares.tsx`, `web/src/components/AgeBar.tsx`, `web/src/components/ColumnHeader.tsx`, `web/src/components/PrRow.tsx`, `web/src/components/StackRow.tsx`, `web/src/__tests__/PrRow.test.tsx`, `web/src/__tests__/StackRow.test.tsx`

**Interfaces:**
- Consumes: `PrView`, `Unit` (Task 5); `Signal`, `SIGNAL_LABELS` (Task 2); `AGE_DOMAIN_HOURS`, `AGE_TICKS`, `ageLabel` (Task 3); `buildPrViews` (Task 5, in tests).
- Produces:
  - `agePercent(hours: number): number` (3–100)
  - `<StatusSquares signals size? />`, `<AgeBar hours bucket />`, `<ColumnHeader />`
  - `<PrRow view selected indentPx? onSelect(id) />`. Setting `indentPx` also sets `data-node={pr.id}`, the anchor for stack connectors.
  - `<StackRow unit expanded onToggle() onVisualize() />` (`unit` is the stack variant of `Unit`)

- [ ] **Step 1: Write the failing tests**

`web/src/__tests__/PrRow.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrRow } from '../components/PrRow';
import { buildPrViews } from '../../../shared/grouping';
import { emptySnapshot } from '../../../shared/types';
import { makePr } from '../../../test/factories';

const now = Date.parse('2026-11-18T12:00:00Z');
const viewOf = (...prs: ReturnType<typeof makePr>[]) => buildPrViews({ ...emptySnapshot('acme'), prs }, now);

describe('PrRow', () => {
  it('shows repo and number, title, blocker badges, six labelled squares and the age', () => {
    const pr = makePr({ number: 3412, title: 'Recalculate visit windows', mergeState: 'conflicts', createdAt: '2026-11-14T12:00:00Z' });
    render(<PrRow view={viewOf(pr).get(pr.id)!} selected={false} onSelect={() => undefined} />);

    expect(screen.getByText('orders-api #3412')).toBeInTheDocument();
    expect(screen.getByText('Recalculate visit windows')).toBeInTheDocument();
    expect(screen.getByText('Conflicts')).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(6);
    expect(screen.getByRole('img', { name: 'Mergeable: Merge conflicts' })).toHaveTextContent('✕');
    expect(screen.getByText('4d')).toBeInTheDocument();
  });

  it('shows "stacked on" as information, not a blocker', () => {
    const parent = makePr({ number: 3420, headRefName: 'lock' });
    const child = makePr({ number: 3421, baseRefName: 'lock' });
    render(<PrRow view={viewOf(parent, child).get(child.id)!} selected={false} indentPx={46} onSelect={() => undefined} />);
    expect(screen.getByText('stacked on #3420')).toHaveClass('sev-info');
  });

  it('selects on click and marks the selected row', async () => {
    const pr = makePr();
    const onSelect = vi.fn();
    render(<PrRow view={viewOf(pr).get(pr.id)!} selected onSelect={onSelect} />);
    const row = screen.getByRole('button');
    expect(row).toHaveAttribute('aria-current', 'true');
    await userEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(pr.id);
  });
});
```

`web/src/__tests__/StackRow.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StackRow } from '../components/StackRow';
import { buildOverviewLanes } from '../../../shared/grouping';
import { emptySnapshot } from '../../../shared/types';
import { makePr } from '../../../test/factories';

function stackUnit() {
  const bottom = makePr({ number: 4988, headRefName: 'a', mergeState: 'conflicts', nativeStack: { number: 4964, size: 4, position: 3, baseRefName: 'main' } });
  const top = makePr({ number: 4989, headRefName: 'b', nativeStack: { number: 4964, size: 4, position: 4, baseRefName: 'main' } });
  const snapshot = { ...emptySnapshot('acme'), prs: [bottom, top], overviewIds: [bottom.id, top.id] };
  const unit = buildOverviewLanes(snapshot, { groupBy: 'author', filters: { show: { blocked: true, waiting: true, ready: true, draft: true }, q: '', newestFirst: false }, now: Date.now() })[0]!.units[0]!;
  if (unit.kind !== 'stack') throw new Error('expected a stack');
  return unit;
}

describe('StackRow', () => {
  it('summarises the stack with its range, kind, counts and one pip per PR', () => {
    render(<StackRow unit={stackUnit()} expanded={false} onToggle={() => undefined} onVisualize={() => undefined} />);
    expect(screen.getByText('Stack of 2 open PRs · 2 merged or closed')).toBeInTheDocument();
    expect(screen.getByText('orders-api · GitHub stack #4964 · #4988 → #4989')).toBeInTheDocument();
    expect(screen.getByText('1 blocked')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '1 blocked, 0 waiting, 1 ready' }).querySelectorAll('i')).toHaveLength(2);
  });

  it('toggles and opens the visualisation through separate buttons', async () => {
    const onToggle = vi.fn();
    const onVisualize = vi.fn();
    render(<StackRow unit={stackUnit()} expanded={false} onToggle={onToggle} onVisualize={onVisualize} />);
    await userEvent.click(screen.getByRole('button', { name: /Stack of 2 open PRs/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Visualize stack' }));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onVisualize).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /Stack of 2 open PRs/ })).toHaveAttribute('aria-expanded', 'false');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run web/src/__tests__/PrRow.test.tsx web/src/__tests__/StackRow.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`web/src/lib/ageScale.ts`:
```ts
import { scaleLog } from 'd3';
import { AGE_DOMAIN_HOURS } from '../../../shared/age';

const scale = scaleLog().domain(AGE_DOMAIN_HOURS).range([0, 100]).clamp(true);

// A minimum width keeps one-hour-old PRs visible on the bar.
export const agePercent = (hours: number) => Math.max(3, scale(Math.max(1, hours)));
```

`web/src/components/StatusSquares.tsx`:
```tsx
import type { Signal } from '../../../shared/status';

export function StatusSquares({ signals, size = 28 }: { signals: Signal[]; size?: number }) {
  return (
    <span className="sigs" style={size < 28 ? { gap: 3 } : undefined}>
      {signals.map((signal) => (
        <span
          key={signal.key}
          className={`dot k-${signal.color}`}
          role="img"
          aria-label={`${signal.label}: ${signal.detail}`}
          title={`${signal.label}: ${signal.detail}`}
          style={size < 28 ? { width: size, height: size, fontSize: 10 } : undefined}
        >
          {signal.glyph}
        </span>
      ))}
    </span>
  );
}
```

`web/src/components/AgeBar.tsx`:
```tsx
import { ageLabel } from '../../../shared/age';
import type { Bucket } from '../../../shared/status';
import { agePercent } from '../lib/ageScale';

export function AgeBar({ hours, bucket }: { hours: number; bucket: Bucket }) {
  return (
    <span className="age">
      <span className="track"><i className={`fill-${bucket}`} style={{ width: `${agePercent(hours)}%` }} /></span>
      <span className="age-label">{ageLabel(hours)}</span>
    </span>
  );
}
```

`web/src/components/ColumnHeader.tsx`:
```tsx
import { AGE_TICKS } from '../../../shared/age';
import { SIGNAL_LABELS } from '../../../shared/status';
import { agePercent } from '../lib/ageScale';

const SHORT = { ci: 'CI', aiReview: 'Cop', codeAnalysis: 'CS', review: 'Rev', threads: 'Thr', mergeable: 'Mrg' } as const;

export function ColumnHeader() {
  return (
    <div className="cols" aria-hidden="true">
      <span>Pull request</span>
      <span className="sig-heads">
        {(Object.keys(SHORT) as (keyof typeof SHORT)[]).map((key) => <span key={key} title={SIGNAL_LABELS[key]}>{SHORT[key]}</span>)}
      </span>
      <span className="ruler">
        {AGE_TICKS.map((tick) => (
          <span key={tick.label} style={{ left: `${Math.min(97, Math.max(2, agePercent(tick.hours)))}%` }}>{tick.label}</span>
        ))}
      </span>
    </div>
  );
}
```

`web/src/components/PrRow.tsx`:
```tsx
import type { PrView } from '../../../shared/grouping';
import { AgeBar } from './AgeBar';
import { StatusSquares } from './StatusSquares';

interface PrRowProps { view: PrView; selected: boolean; indentPx?: number; onSelect: (id: string) => void }

/** indentPx is set for rows inside an expanded stack; it leaves room for the connector gutter and marks the row as a connector anchor. */
export function PrRow({ view, selected, indentPx, onSelect }: PrRowProps) {
  const { pr } = view;
  const badges = [
    ...(view.stackedOn ? [{ label: `stacked on #${view.stackedOn}`, severity: 'info' }] : []),
    ...view.blockers,
    ...(pr.mergeState === 'unknown' ? [{ label: 'Checking mergeability…', severity: 'grey' }] : []),
  ];
  return (
    <button
      type="button"
      className={`row${selected ? ' sel' : ''}`}
      aria-current={selected || undefined}
      data-node={indentPx !== undefined ? pr.id : undefined}
      onClick={() => onSelect(pr.id)}
    >
      <span className="pr" style={indentPx !== undefined ? { paddingLeft: indentPx } : undefined}>
        <span className="prtext">
          <span className="rn">{pr.repo} #{pr.number}</span>
          <span className="title">{pr.title}</span>
          <span className="badges">
            {badges.map((badge) => <span key={badge.label} className={`badge sev-${badge.severity}`}>{badge.label}</span>)}
          </span>
        </span>
      </span>
      <StatusSquares signals={view.signals} />
      <AgeBar hours={view.ageHours} bucket={view.bucket} />
    </button>
  );
}
```

`web/src/components/StackRow.tsx`:
```tsx
import type { Unit } from '../../../shared/grouping';
import type { Bucket } from '../../../shared/status';
import { AgeBar } from './AgeBar';

type StackUnit = Extract<Unit, { kind: 'stack' }>;
interface StackRowProps { unit: StackUnit; expanded: boolean; onToggle: () => void; onVisualize: () => void }

export function StackRow({ unit, expanded, onToggle, onVisualize }: StackRowProps) {
  const { stack, lead, membersTopDown } = unit;
  const counts: Record<Bucket, number> = { blocked: 0, waiting: 0, ready: 0, draft: 0 };
  membersTopDown.forEach((view) => (counts[view.bucket] += 1));
  const top = membersTopDown[0]!;
  const kind = stack.native ? `GitHub stack #${stack.number}` : 'branch-chained';
  const summary = `${counts.blocked} blocked, ${counts.waiting} waiting, ${counts.ready} ready`;
  return (
    <div className="row stack">
      <span className="pr">
        <button type="button" className="toggle" aria-expanded={expanded} onClick={onToggle}>
          <span aria-hidden="true" style={{ width: 14 }}>{expanded ? '▾' : '▸'}</span>
          <span className="prtext">
            <span className="rn">{stack.repo} · {kind} · #{lead.pr.number} → #{top.pr.number}</span>
            <span className="title">Stack of {membersTopDown.length} open PRs{stack.notOpenCount ? ` · ${stack.notOpenCount} merged or closed` : ''}</span>
            <span className="badges">
              {counts.blocked > 0 && <span className="badge sev-red">{counts.blocked} blocked</span>}
              {counts.waiting > 0 && <span className="badge sev-amber">{counts.waiting} waiting</span>}
              {counts.ready > 0 && <span className="badge sev-green">{counts.ready} ready</span>}
            </span>
          </span>
        </button>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="pips" role="img" aria-label={summary}>
          {[...membersTopDown].reverse().map((view) => <i key={view.pr.id} className={`fill-${view.bucket}`} />)}
        </span>
        <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={onVisualize}>Visualize stack</button>
      </span>
      <AgeBar hours={lead.ageHours} bucket={lead.bucket} />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run web/src/__tests__/PrRow.test.tsx web/src/__tests__/StackRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "Add PR and stack rows with status squares and the log-scale age bar."
```

---

### Task 17: Lanes, toolbar, header, banners and the two list views

**Files:**
- Create: `web/src/lib/stackConnectors.ts`, `web/src/components/StackMembers.tsx`, `web/src/components/Lane.tsx`, `web/src/components/Toolbar.tsx`, `web/src/components/Header.tsx`, `web/src/components/Banners.tsx`, `web/src/views/OverviewView.tsx`, `web/src/views/MineView.tsx`, `web/src/__tests__/stackConnectors.test.ts`, `web/src/__tests__/StackMembers.test.tsx`, `web/src/__tests__/Lane.test.tsx`, `web/src/__tests__/Toolbar.test.tsx`, `web/src/__tests__/Header.test.tsx`
- Modify: `web/src/App.tsx` (second version: real lanes; the drawer, dialog and settings are wired in Task 21)

**Interfaces:**
- Consumes: `LaneModel`, `buildOverviewLanes`, `buildMineLanes`, `PrView` (Task 5); `PrRow`, `StackRow`, `ColumnHeader` (Task 16); `Avatar`, `ThemeToggle` (Task 14); `UrlState`, `Tab` (Task 15); `Snapshot`, `BannerMsg`, `RefreshSetting`, `REFRESH_OPTIONS` (Task 1).
- Produces:
  - `branchColumns(stack: Stack): Map<string, number>`: one gutter column per branch. `'base'` and a straight chain use column 0; each extra child of a fork gets the next free column.
  - `connectorPath(from: Point, to: Point, gutterX: number): string`: an orthogonal SVG path with square corners. `from` is the child and `to` is the PR or base branch it merges into, so the arrowhead shows the merge direction.
  - `GUTTER_X = 26`, `GUTTER_STEP = 12`, `ARM_LENGTH = 24`, `textXFor(maxColumn: number): number`, `type Point = { x: number; y: number }`
  - `<StackMembers stack membersTopDown selectedId onSelect(id) />`: the expanded stack. It renders member rows top-down, a base-branch pill row, and an SVG overlay of Bryntum-style arrows in merge direction: from each PR into the PR it is stacked on, and from the bottom PR into the base pill. Links touching the selected PR use the accent colour.
  - `<Lane lane selectedId onSelect(id) onVisualize(prId) />`
  - `<Toolbar url counts onChange(patch: Partial<UrlState>) />`
  - `<Header snapshot tab now onTab(tab) onRefresh(): Promise<void> onRefreshSetting(setting) onOpenSettings() />`, `relativeTime(ms: number): string`
  - `<Banners banners />`
  - `<OverviewView snapshot url now onSelect(id) onVisualize(prId) onOpenSettings() />` and `<MineView snapshot url now onSelect(id) onVisualize(prId) />`. The selected PR comes from `url.selected`.

- [ ] **Step 1: Write the failing tests**

`web/src/__tests__/Lane.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Lane } from '../components/Lane';
import type { LaneModel } from '../../../shared/grouping';
import { buildPrViews } from '../../../shared/grouping';
import { emptySnapshot } from '../../../shared/types';
import { makePr } from '../../../test/factories';

function laneOf(defaultCollapsed: boolean): LaneModel {
  const pr = makePr({ title: 'Add scheduler lock' });
  const view = buildPrViews({ ...emptySnapshot('acme'), prs: [pr] }, Date.now()).get(pr.id)!;
  return { key: 'author:alex', title: 'Alex Rivera', icon: 'avatar', counts: { blocked: 0, waiting: 0, ready: 1, draft: 0 }, units: [{ kind: 'pr', view }], defaultCollapsed };
}

describe('Lane', () => {
  it('shows the header summary and rows when expanded', () => {
    render(<Lane lane={laneOf(false)} selectedId={null} onSelect={() => undefined} onVisualize={() => undefined} />);
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.getByText('1 open')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '0 blocked · 0 waiting · 1 ready' })).toBeInTheDocument();
    expect(screen.getByText('Add scheduler lock')).toBeInTheDocument();
  });

  it('starts collapsed when the model says so and expands on click', async () => {
    render(<Lane lane={laneOf(true)} selectedId={null} onSelect={() => undefined} onVisualize={() => undefined} />);
    expect(screen.queryByText('Add scheduler lock')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Expand Alex Rivera' }));
    expect(screen.getByText('Add scheduler lock')).toBeInTheDocument();
  });

  it('explains an empty lane', () => {
    render(<Lane lane={{ ...laneOf(false), units: [] }} selectedId={null} onSelect={() => undefined} onVisualize={() => undefined} />);
    expect(screen.getByText('No pull requests match the filters.')).toBeInTheDocument();
  });
});
```

`web/src/__tests__/Toolbar.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from '../components/Toolbar';
import { parseUrlState } from '../state/urlState';

const counts = { blocked: 7, waiting: 7, ready: 4, draft: 2 };

describe('Toolbar', () => {
  it('toggles a status chip and reports the new filter', async () => {
    const onChange = vi.fn();
    render(<Toolbar url={parseUrlState('')} counts={counts} onChange={onChange} />);
    const drafts = screen.getByRole('button', { name: /Drafts/ });
    expect(drafts).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(drafts);
    expect(onChange).toHaveBeenCalledWith({ filters: expect.objectContaining({ show: { blocked: true, waiting: true, ready: true, draft: true } }) });
  });

  it('changes grouping and sort order', async () => {
    const onChange = vi.fn();
    render(<Toolbar url={parseUrlState('')} counts={counts} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ticket' }));
    await userEvent.click(screen.getByRole('button', { name: /Oldest first/ }));
    expect(onChange).toHaveBeenCalledWith({ groupBy: 'ticket' });
    expect(onChange).toHaveBeenCalledWith({ filters: expect.objectContaining({ newestFirst: true }) });
  });

  it('hides Group by on the Mine tab', () => {
    render(<Toolbar url={parseUrlState('?tab=mine')} counts={counts} onChange={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Ticket' })).toBeNull();
  });
});
```

`web/src/__tests__/Header.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header, relativeTime } from '../components/Header';
import { emptySnapshot } from '../../../shared/types';

const snapshot = { ...emptySnapshot('acme'), viewer: { login: 'alex', teams: [] }, fetchedAt: '2026-11-18T11:59:18Z' };
const now = Date.parse('2026-11-18T12:00:00Z');

describe('Header', () => {
  it('shows the viewer, how fresh the data is and the current interval', () => {
    render(<Header snapshot={snapshot} tab="overview" now={now} onTab={() => undefined} onRefresh={async () => undefined} onRefreshSetting={() => undefined} onOpenSettings={() => undefined} />);
    expect(screen.getByText('alex')).toBeInTheDocument();
    expect(screen.getByText('Updated 42s ago')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Auto-refresh interval' })).toHaveValue('3');
  });

  it('changes the interval and refreshes on demand', async () => {
    const onRefresh = vi.fn(async () => undefined);
    const onRefreshSetting = vi.fn();
    render(<Header snapshot={snapshot} tab="overview" now={now} onTab={() => undefined} onRefresh={onRefresh} onRefreshSetting={onRefreshSetting} onOpenSettings={() => undefined} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Auto-refresh interval' }), 'off');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    expect(onRefreshSetting).toHaveBeenCalledWith('off');
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('formats relative times', () => {
    expect(relativeTime(42_000)).toBe('42s ago');
    expect(relativeTime(6 * 60_000)).toBe('6m ago');
    expect(relativeTime(3 * 3_600_000)).toBe('3h ago');
  });
});
```

`web/src/__tests__/stackConnectors.test.ts`:
```ts
import { branchColumns, connectorPath, textXFor } from '../lib/stackConnectors';
import type { Stack } from '../../../shared/stacks';

const stackOf = (members: Stack['members']): Stack => ({ id: 's', repo: 'r', native: false, baseRefName: 'main', members, notOpenCount: 0 });

describe('stack connectors', () => {
  it('keeps a straight chain on one trunk', () => {
    const chain = stackOf([{ id: 'a', parentId: null }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }]);
    expect([...branchColumns(chain)]).toEqual([['base', 0], ['a', 0], ['b', 0], ['c', 0]]);
    expect(textXFor(0)).toBe(62);
  });

  it('gives each extra child of a fork its own column', () => {
    const fork = stackOf([{ id: 'lock', parentId: null }, { id: 'settings', parentId: 'lock' }, { id: 'metrics', parentId: 'lock' }]);
    const columns = branchColumns(fork);
    expect(columns.get('settings')).toBe(0);
    expect(columns.get('metrics')).toBe(1);
  });

  it('routes out of the child, down the gutter with square corners, and into the PR it merges into', () => {
    expect(connectorPath({ x: 62, y: 80 }, { x: 62, y: 200 }, 26)).toBe('M56 80 H26 V200 H58');
  });
});
```

`web/src/__tests__/StackMembers.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { StackMembers } from '../components/StackMembers';
import { buildOverviewLanes } from '../../../shared/grouping';
import { emptySnapshot } from '../../../shared/types';
import { makePr } from '../../../test/factories';

describe('StackMembers', () => {
  it('renders members top-down, the base branch, and one link per member', () => {
    const bottom = makePr({ number: 3420, headRefName: 'lock' });
    const top = makePr({ number: 3421, baseRefName: 'lock' });
    const snapshot = { ...emptySnapshot('acme'), prs: [bottom, top], overviewIds: [bottom.id, top.id] };
    const unit = buildOverviewLanes(snapshot, { groupBy: 'author', filters: { show: { blocked: true, waiting: true, ready: true, draft: true }, q: '', newestFirst: false }, now: Date.now() })[0]!.units[0]!;
    if (unit.kind !== 'stack') throw new Error('expected a stack');

    const { container } = render(<StackMembers stack={unit.stack} membersTopDown={unit.membersTopDown} selectedId={top.id} onSelect={() => undefined} />);

    expect(screen.getAllByRole('button').map((row) => row.getAttribute('data-node'))).toEqual([top.id, bottom.id]);
    expect(screen.getByText('main')).toHaveClass('base-pill');
    expect(container.querySelectorAll('.stack-links path.link')).toHaveLength(2);
    expect(container.querySelectorAll('.stack-links path.link.hot')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run web/src/__tests__/stackConnectors.test.ts web/src/__tests__/StackMembers.test.tsx web/src/__tests__/Lane.test.tsx web/src/__tests__/Toolbar.test.tsx web/src/__tests__/Header.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the components**

`web/src/lib/stackConnectors.ts`:
```ts
import type { Stack } from '../../../shared/stacks';

export type Point = { x: number; y: number };
export const GUTTER_X = 26;
export const GUTTER_STEP = 12;
// The gap after the last gutter is the visible length of each horizontal arm.
export const ARM_LENGTH = 24;
export const textXFor = (maxColumn: number) => GUTTER_X + (maxColumn + 1) * GUTTER_STEP + ARM_LENGTH;

// A 26-deep chain must not push the text 300px right, so columns are per branch, not per depth.
export function branchColumns(stack: Stack): Map<string, number> {
  const columns = new Map<string, number>([['base', 0]]);
  let next = 1;
  const visit = (parentId: string) => {
    stack.members.filter((member) => (member.parentId ?? 'base') === parentId).forEach((child, index) => {
      columns.set(child.id, index === 0 ? columns.get(parentId)! : next++);
      visit(child.id);
    });
  };
  visit('base');
  return columns;
}

export function connectorPath(from: Point, to: Point, gutterX: number): string {
  return `M${from.x - 6} ${from.y} H${gutterX} V${to.y} H${to.x - 4}`;
}
```

`web/src/components/StackMembers.tsx`:
```tsx
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PrView } from '../../../shared/grouping';
import type { Stack } from '../../../shared/stacks';
import { branchColumns, connectorPath, GUTTER_STEP, GUTTER_X, textXFor, type Point } from '../lib/stackConnectors';
import { PrRow } from './PrRow';

interface StackMembersProps { stack: Stack; membersTopDown: PrView[]; selectedId: string | null; onSelect: (id: string) => void }
interface Link { key: string; d: string; hot: boolean }

export function StackMembers({ stack, membersTopDown, selectedId, onSelect }: StackMembersProps) {
  const markerId = useId().replace(/:/g, '');
  const boxRef = useRef<HTMLDivElement>(null);
  const columns = useMemo(() => branchColumns(stack), [stack]);
  const textX = textXFor(Math.max(...columns.values()));
  const [links, setLinks] = useState<Link[]>([]);

  // Anchors depend on rendered layout (badges wrap, fonts load), so links are measured after layout and on resize.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const parentOf = new Map(stack.members.map((member) => [member.id, member.parentId ?? 'base']));
    const measure = () => {
      const frame = box.getBoundingClientRect();
      const anchors = new Map<string, Point>();
      box.querySelectorAll<HTMLElement>('[data-node]').forEach((node) => {
        const anchor = (node.querySelector('.title, .base-pill') ?? node).getBoundingClientRect();
        anchors.set(node.dataset.node!, { x: anchor.left - frame.left, y: anchor.top + anchor.height / 2 - frame.top });
      });
      const next: Link[] = [];
      for (const view of membersTopDown) {
        const parent = parentOf.get(view.pr.id) ?? 'base';
        // Arrows follow the merge direction: from a PR down to the branch it merges into.
        const from = anchors.get(view.pr.id);
        const to = anchors.get(parent);
        if (!from || !to) continue;
        next.push({
          key: view.pr.id,
          d: connectorPath(from, to, GUTTER_X + (columns.get(view.pr.id) ?? 0) * GUTTER_STEP),
          hot: selectedId === view.pr.id || selectedId === parent,
        });
      }
      setLinks(next.sort((a, b) => Number(a.hot) - Number(b.hot)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [stack, membersTopDown, columns, selectedId]);

  return (
    <div className="stack-members" ref={boxRef}>
      {membersTopDown.map((view) => (
        <PrRow key={view.pr.id} view={view} indentPx={textX - 16} selected={selectedId === view.pr.id} onSelect={onSelect} />
      ))}
      <div className="stack-base" data-node="base" style={{ paddingLeft: textX }}>
        <span className="base-pill">{stack.baseRefName}</span>
        {stack.notOpenCount > 0 && <span className="muted small">{stack.notOpenCount} merged or closed below</span>}
      </div>
      <svg className="stack-links" aria-hidden="true">
        <defs>
          {(['idle', 'hot'] as const).map((state) => (
            <marker key={state} id={`${markerId}-${state}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" className={`arrow${state === 'hot' ? ' hot' : ''}`} />
            </marker>
          ))}
        </defs>
        {links.map((link) => (
          <path key={link.key} className={`link${link.hot ? ' hot' : ''}`} d={link.d} markerEnd={`url(#${markerId}-${link.hot ? 'hot' : 'idle'})`} />
        ))}
      </svg>
    </div>
  );
}
```

`web/src/components/Lane.tsx`:
```tsx
import { Fragment, useState } from 'react';
import type { LaneModel } from '../../../shared/grouping';
import type { Bucket } from '../../../shared/status';
import { Avatar } from './Avatar';
import { PrRow } from './PrRow';
import { StackMembers } from './StackMembers';
import { StackRow } from './StackRow';

const BUCKETS: Bucket[] = ['blocked', 'waiting', 'ready', 'draft'];

const ICON_PATHS: Record<'bot' | 'repo' | 'ticket' | 'section', string> = {
  bot: 'M12 3v3M7 8h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3zM9 13h.01M15 13h.01',
  repo: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
  ticket: 'M4 8a2 2 0 0 0 0 4v4h16v-4a2 2 0 0 0 0-4V4H4zM10 4v12',
  section: 'M4 6h16M4 12h16M4 18h10',
};

function LaneIcon({ lane }: { lane: LaneModel }) {
  if (lane.icon === 'avatar' || lane.icon === 'team') return <Avatar name={lane.title} url={lane.avatarUrl} size={30} />;
  return (
    <span className="lane-icon" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICON_PATHS[lane.icon]} /></svg>
    </span>
  );
}

interface LaneProps { lane: LaneModel; selectedId: string | null; onSelect: (id: string) => void; onVisualize: (prId: string) => void }

export function Lane({ lane, selectedId, onSelect, onVisualize }: LaneProps) {
  const [collapsed, setCollapsed] = useState(lane.defaultCollapsed);
  const [openStacks, setOpenStacks] = useState<Set<string>>(new Set());
  const total = BUCKETS.reduce((sum, bucket) => sum + lane.counts[bucket], 0);
  const summary = `${lane.counts.blocked} blocked · ${lane.counts.waiting} waiting · ${lane.counts.ready} ready${lane.counts.draft ? ` · ${lane.counts.draft} draft` : ''}`;
  const toggleStack = (id: string) => setOpenStacks((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <section className="lane" aria-label={lane.title}>
      <div className="lane-head">
        <button type="button" className="icon-btn ghost" aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${lane.title}`} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▸' : '▾'}
        </button>
        <LaneIcon lane={lane} />
        <span className="lane-title">{lane.title}</span>
        <span className="muted" style={{ fontSize: 13 }}>{total} open</span>
        <span className="grow" />
        <span className="muted small">{summary}</span>
        <span className="stackbar" role="img" aria-label={summary}>
          {BUCKETS.map((bucket) => <span key={bucket} className={`fill-${bucket}`} style={{ width: `${total ? (lane.counts[bucket] / total) * 100 : 0}%` }} />)}
        </span>
      </div>
      {!collapsed && lane.units.length === 0 && <div className="empty">No pull requests match the filters.</div>}
      {!collapsed && lane.units.map((unit) => unit.kind === 'pr'
        ? <PrRow key={unit.view.pr.id} view={unit.view} selected={selectedId === unit.view.pr.id} onSelect={onSelect} />
        : (
          <Fragment key={unit.stack.id}>
            <StackRow unit={unit} expanded={openStacks.has(unit.stack.id)} onToggle={() => toggleStack(unit.stack.id)} onVisualize={() => onVisualize(unit.lead.pr.id)} />
            {openStacks.has(unit.stack.id) && (
              <StackMembers stack={unit.stack} membersTopDown={unit.membersTopDown} selectedId={selectedId} onSelect={onSelect} />
            )}
          </Fragment>
        ))}
    </section>
  );
}
```

`web/src/components/Toolbar.tsx`:
```tsx
import type { GroupBy } from '../../../shared/grouping';
import type { Bucket } from '../../../shared/status';
import type { UrlState } from '../state/urlState';

const CHIPS: { bucket: Bucket; label: string }[] = [
  { bucket: 'blocked', label: 'Blocked' }, { bucket: 'waiting', label: 'Waiting' }, { bucket: 'ready', label: 'Ready' }, { bucket: 'draft', label: 'Drafts' },
];
const GROUPS: { value: GroupBy; label: string }[] = [{ value: 'author', label: 'Author' }, { value: 'repo', label: 'Repository' }, { value: 'ticket', label: 'Ticket' }];

interface ToolbarProps { url: UrlState; counts: Record<Bucket, number>; onChange: (patch: Partial<UrlState>) => void }

export function Toolbar({ url, counts, onChange }: ToolbarProps) {
  const { filters } = url;
  return (
    <section className="toolbar" aria-label="Filters">
      {url.tab === 'overview' && (
        <div className="segs" style={{ background: 'var(--surface)' }} role="group" aria-label="Group by">
          <span className="lbl" aria-hidden="true">Group by</span>
          {GROUPS.map((group) => (
            <button key={group.value} type="button" className={`seg${url.groupBy === group.value ? ' on' : ''}`} aria-pressed={url.groupBy === group.value} onClick={() => onChange({ groupBy: group.value })}>
              {group.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} role="group" aria-label="Status filter">
        {CHIPS.map((chip) => (
          <button
            key={chip.bucket}
            type="button"
            className={`chip${filters.show[chip.bucket] ? '' : ' off'}`}
            aria-pressed={filters.show[chip.bucket]}
            onClick={() => onChange({ filters: { ...filters, show: { ...filters.show, [chip.bucket]: !filters.show[chip.bucket] } } })}
          >
            <span className={`d fill-${chip.bucket}`} />{chip.label}<span className="n">{counts[chip.bucket]}</span>
          </button>
        ))}
      </div>
      <label className="search">
        <span className="sr-only">Search pull requests</span>
        <input value={filters.q} placeholder="Search title, branch, repo" onChange={(event) => onChange({ filters: { ...filters, q: event.target.value } })} />
      </label>
      <button type="button" className="chip" onClick={() => onChange({ filters: { ...filters, newestFirst: !filters.newestFirst } })}>
        ⇅ {filters.newestFirst ? 'Newest first' : 'Oldest first'}
      </button>
    </section>
  );
}
```

`web/src/components/Header.tsx`:
```tsx
import { useState } from 'react';
import { REFRESH_OPTIONS, type RefreshSetting, type Snapshot } from '../../../shared/types';
import type { Tab } from '../state/urlState';
import { Avatar } from './Avatar';
import { ThemeToggle } from './ThemeToggle';

export function relativeTime(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

const TABS: { value: Tab; label: string }[] = [{ value: 'overview', label: 'Overview' }, { value: 'mine', label: 'Mine' }, { value: 'stacks', label: 'Stacks' }];

interface HeaderProps {
  snapshot: Snapshot;
  tab: Tab;
  now: number;
  onTab: (tab: Tab) => void;
  onRefresh: () => Promise<void>;
  onRefreshSetting: (setting: RefreshSetting) => void;
  onOpenSettings: () => void;
}

export function Header({ snapshot, tab, now, onTab, onRefresh, onRefreshSetting, onOpenSettings }: HeaderProps) {
  const [refreshing, setRefreshing] = useState(false);
  const { settings, viewer, fetchedAt } = snapshot;
  const updated = fetchedAt ? relativeTime(now - Date.parse(fetchedAt)) : 'never';
  return (
    <header className="top">
      <div className="brand"><b>Pearspective</b><span className="muted" style={{ fontSize: 13 }}>{settings.org}</span></div>
      <nav className="segs" aria-label="Views">
        {TABS.map((item) => (
          <button key={item.value} type="button" className={`seg${tab === item.value ? ' on' : ''}`} aria-pressed={tab === item.value} onClick={() => onTab(item.value)}>{item.label}</button>
        ))}
      </nav>
      <span className="grow" />
      <div className="hdr-right">
        <span>{settings.refresh === 'off' ? `Auto-refresh off · updated ${updated}` : `Updated ${updated}`}</span>
        <label>
          <span className="sr-only">Auto-refresh interval</span>
          <select aria-label="Auto-refresh interval" value={String(settings.refresh)} onChange={(event) => onRefreshSetting(event.target.value === 'off' ? 'off' : (Number(event.target.value) as RefreshSetting))}>
            {REFRESH_OPTIONS.map((option) => <option key={option} value={String(option)}>{option === 'off' ? 'Off' : `Every ${option}m`}</option>)}
          </select>
        </label>
        <button type="button" className="icon-btn" aria-label="Refresh now" disabled={refreshing} onClick={async () => { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } }}>⟳</button>
        <ThemeToggle />
        <button type="button" className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>⚙</button>
        {viewer && <span className="who"><Avatar name={viewer.login} url={viewer.avatarUrl} size={24} /><span>{viewer.login}</span></span>}
      </div>
    </header>
  );
}
```

`web/src/components/Banners.tsx`:
```tsx
import type { BannerMsg } from '../../../shared/types';

const SEVERITY: Record<BannerMsg['kind'], string> = { 'missing-cli': 'sev-red', auth: 'sev-red', 'rate-limit': 'sev-amber', stale: 'sev-amber' };

export function Banners({ banners }: { banners: BannerMsg[] }) {
  if (banners.length === 0) return null;
  return (
    <div role="alert">
      {banners.map((banner) => <div key={banner.kind} className={`banner ${SEVERITY[banner.kind]}`}>{banner.message}</div>)}
    </div>
  );
}
```

`web/src/views/OverviewView.tsx`:
```tsx
import { useMemo } from 'react';
import { buildOverviewLanes } from '../../../shared/grouping';
import type { Snapshot } from '../../../shared/types';
import { ColumnHeader } from '../components/ColumnHeader';
import { Lane } from '../components/Lane';
import type { UrlState } from '../state/urlState';

interface OverviewViewProps {
  snapshot: Snapshot;
  url: UrlState;
  now: number;
  onSelect: (id: string) => void;
  onVisualize: (prId: string) => void;
  onOpenSettings: () => void;
}

export function OverviewView({ snapshot, url, now, onSelect, onVisualize, onOpenSettings }: OverviewViewProps) {
  const lanes = useMemo(() => buildOverviewLanes(snapshot, { groupBy: url.groupBy, filters: url.filters, now }), [snapshot, url.groupBy, url.filters, now]);
  if (snapshot.settings.repos.length === 0) {
    return <p className="empty-state">No repositories selected. <button type="button" className="btn" onClick={onOpenSettings}>Choose repositories</button></p>;
  }
  return (
    <div className="board">
      <ColumnHeader />
      {lanes.map((lane) => <Lane key={`${url.groupBy}:${lane.key}`} lane={lane} selectedId={url.selected} onSelect={onSelect} onVisualize={onVisualize} />)}
      <p className="note">Age axis is log scale: 1 hour to 3 months share one ruler. Bar colour is the PR's bucket; hatched means draft.</p>
    </div>
  );
}
```

`web/src/views/MineView.tsx`:
```tsx
import { useMemo } from 'react';
import { buildMineLanes } from '../../../shared/grouping';
import type { Snapshot } from '../../../shared/types';
import { ColumnHeader } from '../components/ColumnHeader';
import { Lane } from '../components/Lane';
import type { UrlState } from '../state/urlState';

interface MineViewProps { snapshot: Snapshot; url: UrlState; now: number; onSelect: (id: string) => void; onVisualize: (prId: string) => void }

export function MineView({ snapshot, url, now, onSelect, onVisualize }: MineViewProps) {
  const lanes = useMemo(() => buildMineLanes(snapshot, { filters: url.filters, now }), [snapshot, url.filters, now]);
  return (
    <div className="board">
      <ColumnHeader />
      {lanes.map((lane) => <Lane key={lane.key} lane={lane} selectedId={url.selected} onSelect={onSelect} onVisualize={onVisualize} />)}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run web/src/__tests__/stackConnectors.test.ts web/src/__tests__/StackMembers.test.tsx web/src/__tests__/Lane.test.tsx web/src/__tests__/Toolbar.test.tsx web/src/__tests__/Header.test.tsx`
Expected: PASS.

- [ ] **Step 5: Render the real views in App (second version)**

Replace `web/src/App.tsx` with:
```tsx
import { useEffect, useState } from 'react';
import type { DashboardApi } from './api/client';
import { useDashboard } from './api/useDashboard';
import { Banners } from './components/Banners';
import { Header } from './components/Header';
import { Toolbar } from './components/Toolbar';
import { useUrlState } from './state/urlState';
import { MineView } from './views/MineView';
import { OverviewView } from './views/OverviewView';

export function App({ api }: { api: DashboardApi }) {
  const { snapshot, refreshNow, updateSettings } = useDashboard(api);
  const [url, setUrl] = useUrlState();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  if (!snapshot) return <div className="app"><p className="loading">Loading…</p></div>;

  // Stack dialog and settings panel arrive in Tasks 19–21; until then these buttons do nothing.
  const notYetWired = () => undefined;
  const counts = { blocked: 0, waiting: 0, ready: 0, draft: 0 };
  return (
    <div className="app">
      <Header snapshot={snapshot} tab={url.tab} now={now} onTab={(tab) => setUrl({ tab })} onRefresh={refreshNow} onRefreshSetting={(refresh) => void updateSettings({ refresh })} onOpenSettings={notYetWired} />
      <Banners banners={snapshot.banners} />
      <Toolbar url={url} counts={counts} onChange={setUrl} />
      <div className="layout">
        <main className="board-wrap">
          {url.tab === 'mine'
            ? <MineView snapshot={snapshot} url={url} now={now} onSelect={(id) => setUrl({ selected: id })} onVisualize={notYetWired} />
            : <OverviewView snapshot={snapshot} url={url} now={now} onSelect={(id) => setUrl({ selected: id })} onVisualize={notYetWired} onOpenSettings={notYetWired} />}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Check it in a browser against the mockup**

Run `npm run dev` in the background, open `http://127.0.0.1:5173`, and keep `docs/mockup/overview-swimlanes.html` open next to it.

Expected:
- Real lanes grouped by author, with 6 squares per row and age bars on the shared ruler.
- Group by, chips, search and sort all work, and the URL updates.
- The Mine tab shows its three lanes.
- Dark mode looks right.
- Row selection highlights the row. The drawer arrives in Task 18.

The chip counts show 0 until Task 21 computes them. Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "Add lanes, toolbar, header, banners and the Overview and Mine views."
```

---

### Task 18: Detail drawer

**Files:**
- Create: `web/src/components/Drawer.tsx`, `web/src/__tests__/Drawer.test.tsx`

**Interfaces:**
- Consumes: `PrView` (Task 5); `detectStacks`, `stackIndex`, `membersBottomUp` (Task 4); `StatusSquares` (Task 16); `Avatar` (Task 14); `Snapshot`, `ChangeRequest` (Task 1).
- Produces: `<Drawer snapshot views selectedId onSelect(id) onVisualize(prId) />`, where `views: Map<string, PrView>` comes from `buildPrViews`.

- [ ] **Step 1: Write the failing test**

`web/src/__tests__/Drawer.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Drawer } from '../components/Drawer';
import { buildPrViews } from '../../../shared/grouping';
import { emptySnapshot, type ChangeRequest } from '../../../shared/types';
import { makePerson, makePr } from '../../../test/factories';

const copilot = makePerson('copilot-pull-request-reviewer', 'ai-review');

function setup(prs: ChangeRequest[], selectedId: string, ticketUrl: string | null = 'https://jira.example.test/browse/{key}') {
  const snapshot = { ...emptySnapshot('acme'), prs, settings: { ...emptySnapshot('acme').settings, ticketUrl } };
  const views = buildPrViews(snapshot, Date.parse('2026-11-18T12:00:00Z'));
  const onSelect = vi.fn();
  const onVisualize = vi.fn();
  render(<Drawer snapshot={snapshot} views={views} selectedId={selectedId} onSelect={onSelect} onVisualize={onVisualize} />);
  return { onSelect, onVisualize };
}

describe('Drawer', () => {
  it('asks the user to pick a PR when nothing is selected', () => {
    setup([makePr()], 'nothing');
    expect(screen.getByText('Select a pull request to see its details.')).toBeInTheDocument();
  });

  it('shows failing checks with links, reviewers including bots, and unresolved threads', () => {
    const pr = makePr({
      title: 'Use offline mode',
      checks: [{ name: 'e2e-android', state: 'failure', required: true, url: 'https://ci.example.test/run/2' }],
      reviews: [{ author: copilot, state: 'commented', submittedAt: '2026-11-16T10:00:00Z' }],
      reviewRequests: [{ type: 'team', slug: 'core' }],
      threads: [{ resolved: false, author: makePerson('robin'), snippet: 'Can this run twice?', url: 'https://github.example.test/t/2' }],
    });
    setup([pr], pr.id);

    expect(screen.getByRole('heading', { name: 'Use offline mode' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'e2e-android' })).toHaveAttribute('href', 'https://ci.example.test/run/2');
    const reviewers = within(screen.getByRole('region', { name: 'Reviewers' }));
    expect(reviewers.getByText('copilot-pull-request-reviewer')).toBeInTheDocument();
    expect(reviewers.getByText('Commented')).toBeInTheDocument();
    expect(reviewers.getByText('core')).toBeInTheDocument();
    expect(reviewers.getByText('Requested')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Can this run twice\?/ })).toHaveAttribute('href', 'https://github.example.test/t/2');
  });

  it('links the ticket, lists related PRs in other repos, and selects one on click', async () => {
    const backend = makePr({ repo: 'orders-api', headRefName: 'XX-7-api' });
    const frontend = makePr({ repo: 'orders-web', headRefName: 'XX-7-ui', title: 'Show the second day' });
    const { onSelect } = setup([backend, frontend], backend.id);

    expect(screen.getByRole('link', { name: 'XX-7 in Jira ↗' })).toHaveAttribute('href', 'https://jira.example.test/browse/XX-7');
    await userEvent.click(screen.getByRole('button', { name: /Show the second day/ }));
    expect(onSelect).toHaveBeenCalledWith(frontend.id);
  });

  it('shows the key without a link when no issue tracker is configured', () => {
    const pr = makePr({ headRefName: 'XX-7-api' });
    setup([pr], pr.id, null);
    expect(screen.queryByRole('link', { name: /in Jira/ })).toBeNull();
    expect(screen.getByText('XX-7')).toBeInTheDocument();
  });

  it('lists the stack and opens the visualisation', async () => {
    const bottom = makePr({ number: 3420, headRefName: 'lock' });
    const top = makePr({ number: 3421, baseRefName: 'lock' });
    const { onVisualize } = setup([bottom, top], top.id);
    const stack = within(screen.getByRole('region', { name: 'Stack' }));
    expect(stack.getAllByRole('button').map((button) => button.textContent)).toEqual([
      expect.stringContaining('#3421'), expect.stringContaining('#3420'), 'Visualize stack',
    ]);
    await userEvent.click(stack.getByRole('button', { name: 'Visualize stack' }));
    expect(onVisualize).toHaveBeenCalledWith(top.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/src/__tests__/Drawer.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `web/src/components/Drawer.tsx`**

```tsx
import { useMemo, type ReactNode } from 'react';
import { ageLabel } from '../../../shared/age';
import type { PrView } from '../../../shared/grouping';
import { detectStacks, membersBottomUp, stackIndex } from '../../../shared/stacks';
import type { ChangeRequest, Snapshot } from '../../../shared/types';
import { Avatar } from './Avatar';

interface DrawerProps {
  snapshot: Snapshot;
  views: Map<string, PrView>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onVisualize: (prId: string) => void;
}

const REVIEW_LABEL = { approved: 'Approved', changes_requested: 'Changes requested', commented: 'Commented', dismissed: 'Dismissed' } as const;
const REVIEW_SEVERITY = { approved: 'green', changes_requested: 'red', commented: 'grey', dismissed: 'grey' } as const;

interface ReviewerRow { key: string; name: string; avatarUrl?: string; label: string; severity: string }

/** One row per reviewer: their newest review, or "Requested" if they have not reviewed yet. */
function reviewerRows(pr: ChangeRequest): ReviewerRow[] {
  const latest = new Map<string, ChangeRequest['reviews'][number]>();
  for (const review of pr.reviews) {
    if (review.author.kind === 'bot') continue;
    const previous = latest.get(review.author.login);
    if (!previous || previous.submittedAt < review.submittedAt) latest.set(review.author.login, review);
  }
  const rows: ReviewerRow[] = [...latest.values()].map((review) => ({
    key: review.author.login, name: review.author.name ?? review.author.login, avatarUrl: review.author.avatarUrl,
    label: REVIEW_LABEL[review.state], severity: REVIEW_SEVERITY[review.state],
  }));
  for (const request of pr.reviewRequests) {
    if (request.type === 'team') rows.push({ key: `team:${request.slug}`, name: request.slug, avatarUrl: request.avatarUrl, label: 'Requested', severity: 'amber' });
    else if (!latest.has(request.person.login)) rows.push({ key: request.person.login, name: request.person.login, avatarUrl: request.person.avatarUrl, label: 'Requested', severity: 'amber' });
  }
  return rows;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="sec">{title}</span>
      {children}
    </section>
  );
}

export function Drawer({ snapshot, views, selectedId, onSelect, onVisualize }: DrawerProps) {
  const index = useMemo(() => stackIndex(detectStacks(snapshot.prs)), [snapshot.prs]);
  const view = selectedId ? views.get(selectedId) : undefined;
  if (!view) {
    return <aside className="drawer" aria-label="Pull request detail"><p className="muted">Select a pull request to see its details.</p></aside>;
  }
  const { pr } = view;
  const failing = pr.checks.filter((check) => check.state === 'failure');
  const unresolved = pr.threads.filter((thread) => !thread.resolved);
  const reviewers = reviewerRows(pr);
  const related = view.ticket ? [...views.values()].filter((other) => other.ticket === view.ticket && other.pr.id !== pr.id) : [];
  const stackEntry = index.get(pr.id);
  const stackMembers = stackEntry ? membersBottomUp(stackEntry.stack).reverse().map((id) => views.get(id)).filter((member): member is PrView => !!member) : [];
  const ticketHref = view.ticket && snapshot.settings.ticketUrl ? snapshot.settings.ticketUrl.replace('{key}', encodeURIComponent(view.ticket)) : null;
  const mini = (member: PrView) => (
    <button key={member.pr.id} type="button" className={`mini${member.pr.id === pr.id ? ' cur' : ''}`} onClick={() => onSelect(member.pr.id)}>
      <i className={`fill-${member.bucket}`} />
      <span><span className="rn">{member.pr.repo} #{member.pr.number}</span> {member.pr.title}</span>
    </button>
  );

  return (
    <aside className="drawer" aria-label="Pull request detail">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="rn">{pr.repo} #{pr.number} · {pr.headRefName}</span>
        <h2>{pr.title}</h2>
        <span className="muted" style={{ fontSize: 13 }}>{pr.author.name ?? pr.author.login} · opened {ageLabel(view.ageHours)} ago</span>
        <span className="badges">{view.blockers.map((blocker) => <span key={blocker.label} className={`badge sev-${blocker.severity}`}>{blocker.label}</span>)}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {view.signals.map((signal) => (
          <div key={signal.key} className="sline">
            <span className={`dot k-${signal.color}`} aria-hidden="true">{signal.glyph}</span>
            <b>{signal.label}</b>
            <span style={{ color: 'var(--text2)' }}>{signal.detail}</span>
          </div>
        ))}
      </div>

      {failing.length > 0 && (
        <Section title="Failing checks">
          {failing.map((check) => (check.url
            ? <a key={check.name} href={check.url} target="_blank" rel="noopener noreferrer">{check.name}</a>
            : <span key={check.name}>{check.name}</span>))}
        </Section>
      )}

      {reviewers.length > 0 && (
        <Section title="Reviewers">
          {reviewers.map((row) => (
            <div key={row.key} className="sline">
              <Avatar name={row.name} url={row.avatarUrl} size={22} />
              <span className="grow">{row.name}</span>
              <span className={`badge sev-${row.severity}`}>{row.label}</span>
            </div>
          ))}
        </Section>
      )}

      {unresolved.length > 0 && (
        <Section title="Unresolved threads">
          {unresolved.map((thread) => (
            <a key={thread.url} className="snip" href={thread.url} target="_blank" rel="noopener noreferrer">
              <b>{thread.author.login}:</b> {thread.snippet}
            </a>
          ))}
        </Section>
      )}

      {related.length > 0 && <Section title={`Related PRs · ${view.ticket}`}>{related.map(mini)}</Section>}

      {stackMembers.length > 0 && stackEntry && (
        <Section title="Stack">
          {stackMembers.map(mini)}
          <span className="muted small" style={{ paddingLeft: 8 }}>
            ↳ {stackEntry.stack.notOpenCount ? `${stackEntry.stack.notOpenCount} merged or closed · ` : ''}{stackEntry.stack.baseRefName}
          </span>
          <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => onVisualize(pr.id)}>Visualize stack</button>
        </Section>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <a href={pr.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>Open on GitHub ↗</a>
        {view.ticket && (ticketHref
          ? <a href={ticketHref} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>{view.ticket} in Jira ↗</a>
          : <span className="rn">{view.ticket}</span>)}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/src/__tests__/Drawer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "Add the read-only PR detail drawer."
```

---

### Task 19: Stack diagram, stack dialog and the Stacks tab

**Files:**
- Create: `web/src/lib/stackLayout.ts`, `web/src/components/StackDiagram.tsx`, `web/src/components/StackDialog.tsx`, `web/src/views/StacksView.tsx`, `web/src/__tests__/stackLayout.test.ts`, `web/src/__tests__/StackDialog.test.tsx`, `web/src/__tests__/StacksView.test.tsx`

**Interfaces:**
- Consumes: `StackDetail`, `ChangeRequest`, `Snapshot` (Task 1); `Stack`, `detectStacks`, `membersBottomUp` (Task 4); `PrView` (Task 5); `GLYPH`, `signalsOf` via `PrView.signals` (Task 2); `ageLabel` (Task 3); `DashboardApi` (Task 15).
- Produces:
  - `interface DiagramNode { key: string; kind: 'base' | 'merged' | 'open'; number?: number; title?: string; state?: 'merged' | 'closed' | 'open'; parentKey: string | null; behindParent?: number }`
  - `edgeRoute(link: { source; target }): string`: a square-cornered step route with the arrow in merge direction. `link.source` is the parent from d3's hierarchy and `link.target` is the child.
  - `stackNodes(detail: StackDetail): DiagramNode[]`, `nextToMerge(nodes: DiagramNode[]): Set<string>`, `layoutStack(nodes): { placed: { node: DiagramNode; x: number; y: number }[]; links: { source: {x,y,node}; target: {x,y,node} }[] }`, `localStackDetail(stack: Stack, byId: Map<string, ChangeRequest>): StackDetail`, `NODE_WIDTH = 340`, `NODE_HEIGHT = 64`
  - `<StackDiagram detail viewsByNumber selectedNumber? onSelect(number) label />`
  - `<StackDialog api prId views onSelect(id) onClose() />`
  - `<StacksView snapshot views onSelect(id) onVisualize(prId) />`
- Note: jsdom cannot lay out SVG, so these tests mock `StackDiagram`. The real D3 rendering is first exercised in the browser in Task 21 Step 6, items 5 and 8.

- [ ] **Step 1: Write the failing tests**

`web/src/__tests__/stackLayout.test.ts`:
```ts
import { edgeRoute, layoutStack, localStackDetail, nextToMerge, stackNodes } from '../lib/stackLayout';
import { detectStacks } from '../../../shared/stacks';
import type { StackDetail } from '../../../shared/types';
import { makePr } from '../../../test/factories';

const detail: StackDetail = {
  repo: 'field-app', native: true, number: 4964, baseRefName: 'main',
  entries: [
    { number: 4985, title: 'Add storage', state: 'merged', position: 1 },
    { number: 4988, title: 'Offline mode', state: 'open', position: 2, behindParent: 0 },
    { number: 4989, title: 'Orders', state: 'open', position: 3, parentNumber: 4988, behindParent: 3 },
    { number: 4990, title: 'Journal', state: 'open', position: 4, parentNumber: 4988, behindParent: 1 },
  ],
};

describe('stack layout', () => {
  it('chains base, merged entries and open PRs, keeping forks', () => {
    expect(stackNodes(detail).map((node) => [node.key, node.kind, node.parentKey])).toEqual([
      ['base', 'base', null],
      ['n4985', 'merged', 'base'],
      ['n4988', 'open', 'n4985'],
      ['n4989', 'open', 'n4988'],
      ['n4990', 'open', 'n4988'],
    ]);
  });

  it('marks open PRs that sit on the base or a merged entry as next to merge', () => {
    expect([...nextToMerge(stackNodes(detail))]).toEqual(['n4988']);
  });

  it('routes each edge downwards in merge direction with square corners, ending just above the target', () => {
    const base = { node: { key: 'base', kind: 'base' as const, parentKey: null }, x: 0, y: 0 };
    const child = { node: { key: 'n1', kind: 'open' as const, parentKey: 'base' }, x: 190, y: -110 };
    // Child bottom = -110 + 32 = -78; base top = -16; middle = -47; arrow stops 2px above the base.
    expect(edgeRoute({ source: base, target: child })).toBe('M190 -78 V-47 H0 V-18');
  });

  it('places the base at the bottom and children above their parents', () => {
    const { placed, links } = layoutStack(stackNodes(detail));
    const y = (key: string) => placed.find((entry) => entry.node.key === key)!.y;
    expect(y('base')).toBe(0);
    expect(y('n4985')).toBeLessThan(y('base'));
    expect(y('n4989')).toBe(y('n4990'));
    expect(links).toHaveLength(4);
  });

  it('builds a detail from snapshot data alone for the Stacks tab', () => {
    const bottom = makePr({ number: 3420, headRefName: 'lock' });
    const top = makePr({ number: 3421, baseRefName: 'lock' });
    const [stack] = detectStacks([bottom, top]);
    expect(localStackDetail(stack!, new Map([[bottom.id, bottom], [top.id, top]]))).toEqual({
      repo: 'orders-api', native: false, baseRefName: 'main',
      entries: [
        { number: 3420, title: bottom.title, state: 'open' },
        { number: 3421, title: top.title, state: 'open', parentNumber: 3420 },
      ],
    });
  });
});
```

`web/src/__tests__/StackDialog.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StackDialog } from '../components/StackDialog';

vi.mock('../components/StackDiagram', () => ({ StackDiagram: ({ label }: { label: string }) => <div data-testid="diagram">{label}</div> }));

const detail = {
  repo: 'field-app', native: true, number: 4964, baseRefName: 'main',
  entries: [
    { number: 4985, title: 'Add storage', state: 'merged' as const, position: 1 },
    { number: 4988, title: 'Offline mode', state: 'open' as const, position: 2 },
  ],
};

describe('StackDialog', () => {
  it('loads the stack and titles the dialog', async () => {
    render(<StackDialog api={{ stackDetail: async () => detail }} prId="PR_4988" views={new Map()} onSelect={() => undefined} onClose={() => undefined} />);
    expect(await screen.findByRole('dialog', { name: 'field-app · GitHub stack #4964' })).toBeInTheDocument();
    expect(screen.getByText('1 open, 1 merged or closed · onto main')).toBeInTheDocument();
    expect(screen.getByTestId('diagram')).toBeInTheDocument();
  });

  it('closes on Escape and from the close button', async () => {
    const onClose = vi.fn();
    render(<StackDialog api={{ stackDetail: async () => detail }} prId="PR_4988" views={new Map()} onSelect={() => undefined} onClose={onClose} />);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('explains a failure to load', async () => {
    render(<StackDialog api={{ stackDetail: async () => { throw new Error('gh failed'); } }} prId="PR_1" views={new Map()} onSelect={() => undefined} onClose={() => undefined} />);
    expect(await screen.findByText('Could not load the stack: gh failed')).toBeInTheDocument();
  });
});
```

`web/src/__tests__/StacksView.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StacksView } from '../views/StacksView';
import { buildPrViews } from '../../../shared/grouping';
import { emptySnapshot } from '../../../shared/types';
import { makePr } from '../../../test/factories';

vi.mock('../components/StackDiagram', () => ({ StackDiagram: ({ label }: { label: string }) => <div data-testid="diagram">{label}</div> }));

describe('StacksView', () => {
  it('shows one card per stack in the selected repositories', async () => {
    const bottom = makePr({ number: 3420, headRefName: 'lock' });
    const top = makePr({ number: 3421, baseRefName: 'lock' });
    const elsewhere = [makePr({ repo: 'other', headRefName: 'x' }), makePr({ repo: 'other', baseRefName: 'x' })];
    const snapshot = { ...emptySnapshot('acme'), prs: [bottom, top, ...elsewhere], settings: { ...emptySnapshot('acme').settings, repos: ['orders-api'] } };
    const onVisualize = vi.fn();
    render(<StacksView snapshot={snapshot} views={buildPrViews(snapshot, Date.now())} onSelect={() => undefined} onVisualize={onVisualize} />);

    expect(screen.getAllByTestId('diagram')).toHaveLength(1);
    expect(screen.getByText('orders-api')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open large' }));
    expect(onVisualize).toHaveBeenCalledWith(bottom.id);
  });

  it('says so when there are no stacks', () => {
    const snapshot = { ...emptySnapshot('acme'), prs: [makePr()] };
    render(<StacksView snapshot={snapshot} views={buildPrViews(snapshot, Date.now())} onSelect={() => undefined} onVisualize={() => undefined} />);
    expect(screen.getByText('No stacked pull requests in the selected repositories.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run web/src/__tests__/stackLayout.test.ts web/src/__tests__/StackDialog.test.tsx web/src/__tests__/StacksView.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the pure layout**

`web/src/lib/stackLayout.ts`:
```ts
import { stratify, tree } from 'd3';
import { membersBottomUp, type Stack } from '../../../shared/stacks';
import type { ChangeRequest, StackDetail } from '../../../shared/types';

export const NODE_WIDTH = 340;
export const NODE_HEIGHT = 64;

export interface DiagramNode {
  key: string;
  kind: 'base' | 'merged' | 'open';
  number?: number;
  title?: string;
  state?: 'merged' | 'closed' | 'open';
  parentKey: string | null;
  behindParent?: number;
}

export function stackNodes(detail: StackDetail): DiagramNode[] {
  const nodes: DiagramNode[] = [{ key: 'base', kind: 'base', title: detail.baseRefName, parentKey: null }];
  let below = 'base';
  for (const entry of detail.entries.filter((candidate) => candidate.state !== 'open')) {
    nodes.push({ key: `n${entry.number}`, kind: 'merged', number: entry.number, title: entry.title, state: entry.state, parentKey: below });
    below = `n${entry.number}`;
  }
  for (const entry of detail.entries.filter((candidate) => candidate.state === 'open')) {
    nodes.push({
      key: `n${entry.number}`, kind: 'open', number: entry.number, title: entry.title, state: 'open',
      parentKey: entry.parentNumber ? `n${entry.parentNumber}` : below, behindParent: entry.behindParent,
    });
  }
  return nodes;
}

export function nextToMerge(nodes: DiagramNode[]): Set<string> {
  const kindOf = new Map(nodes.map((node) => [node.key, node.kind]));
  return new Set(nodes.filter((node) => node.kind === 'open' && node.parentKey && kindOf.get(node.parentKey) !== 'open').map((node) => node.key));
}

/** Base at y = 0; everything above it has negative y, so the stack grows upwards like the mental model. */
export function layoutStack(nodes: DiagramNode[]) {
  const hierarchy = stratify<DiagramNode>().id((node) => node.key).parentId((node) => node.parentKey)(nodes);
  const root = tree<DiagramNode>().nodeSize([NODE_WIDTH + 40, NODE_HEIGHT + 46])(hierarchy);
  const point = (entry: typeof root) => ({ node: entry.data, x: entry.x, y: entry.y === 0 ? 0 : -entry.y });
  return {
    placed: root.descendants().map(point),
    links: root.links().map((link) => ({ source: point(link.source), target: point(link.target) })),
  };
}

type PlacedPoint = { node: DiagramNode; x: number; y: number };

/**
 * Square-cornered step route in merge direction: from the bottom of the child (link.target)
 * down to half way, across, and down into the top of what it merges into (link.source).
 */
export function edgeRoute(link: { source: PlacedPoint; target: PlacedPoint }): string {
  const childBottom = link.target.y + NODE_HEIGHT / 2;
  const parentTop = link.source.y - (link.source.node.kind === 'base' ? 16 : NODE_HEIGHT / 2);
  const middle = (childBottom + parentTop) / 2;
  // Stop 2px short so the arrowhead tip touches the card edge instead of overlapping it.
  return `M${link.target.x} ${childBottom} V${middle} H${link.source.x} V${parentTop - 2}`;
}

export function localStackDetail(stack: Stack, byId: Map<string, ChangeRequest>): StackDetail {
  const parentOf = new Map(stack.members.map((member) => [member.id, member.parentId]));
  const entries = membersBottomUp(stack).map((id) => {
    const pr = byId.get(id)!;
    const parentId = parentOf.get(id);
    const entry: StackDetail['entries'][number] = { number: pr.number, title: pr.title, state: 'open' };
    if (parentId) entry.parentNumber = byId.get(parentId)!.number;
    return entry;
  });
  const detail: StackDetail = { repo: stack.repo, native: stack.native, baseRefName: stack.baseRefName, entries };
  if (stack.number !== undefined) detail.number = stack.number;
  return detail;
}
```

- [ ] **Step 4: Implement the D3 diagram**

`web/src/components/StackDiagram.tsx`. Every colour is a `var(--…)` set through `.style()`, so the diagram follows the theme without a redraw.
```tsx
import { useEffect, useId, useRef } from 'react';
import { easeCubicOut, select, zoom, zoomIdentity } from 'd3';
import { ageLabel } from '../../../shared/age';
import type { PrView } from '../../../shared/grouping';
import type { StackDetail } from '../../../shared/types';
import { edgeRoute, layoutStack, nextToMerge, NODE_HEIGHT, NODE_WIDTH, stackNodes } from '../lib/stackLayout';

interface StackDiagramProps {
  detail: StackDetail;
  viewsByNumber: Map<number, PrView>;
  selectedNumber?: number;
  onSelect: (number: number) => void;
  label: string;
}

const BUCKET_COLOR = { blocked: 'var(--c-blocked)', waiting: 'var(--c-waiting)', ready: 'var(--c-ready)', draft: 'var(--c-draft)' } as const;
const SIGNAL_COLORS = { green: ['var(--g-bg)', 'var(--g-fg)'], amber: ['var(--a-bg)', 'var(--a-fg)'], red: ['var(--r-bg)', 'var(--r-fg)'], grey: ['var(--n-bg)', 'var(--n-fg)'] } as const;
const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function StackDiagram({ detail, viewsByNumber, selectedNumber, onSelect, label }: StackDiagramProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  // The Stacks tab and the dialog can show diagrams at once, so arrow marker ids must be unique.
  const markerId = useId().replace(/:/g, '');
  // Parents rebuild these on every clock tick and snapshot; redrawing on identity changes would reset zoom and replay the animation.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const viewsRef = useRef(viewsByNumber);
  viewsRef.current = viewsByNumber;
  const detailKey = JSON.stringify(detail);
  const statusKey = [...viewsByNumber.values()]
    .map((view) => `${view.pr.number}:${view.bucket}:${view.signals.map((signal) => signal.color).join('')}`)
    .sort()
    .join('|');

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;
    const viewsByNumber = viewsRef.current;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const step = reduceMotion ? 0 : 45;
    const duration = reduceMotion ? 0 : 450;

    const nodes = stackNodes(detail);
    const nextKeys = nextToMerge(nodes);
    const { placed, links } = layoutStack(nodes);
    const svg = select(svgElement);
    svg.selectAll('*').remove();
    const canvas = svg.append('g');

    const width = svgElement.clientWidth || 900;
    const height = svgElement.clientHeight || 600;
    const minX = Math.min(...placed.map((entry) => entry.x)) - NODE_WIDTH / 2;
    const maxX = Math.max(...placed.map((entry) => entry.x)) + NODE_WIDTH / 2;
    const tallest = Math.max(...placed.map((entry) => -entry.y)) + NODE_HEIGHT + 80;
    // Deep stacks start zoomed out but stay readable; the base is anchored at the bottom.
    const scale = Math.max(0.45, Math.min(1, (height - 40) / tallest, (width - 40) / (maxX - minX)));
    const zoomBehaviour = zoom<SVGSVGElement, unknown>().scaleExtent([0.25, 2]).on('zoom', (event) => canvas.attr('transform', event.transform));
    svg.call(zoomBehaviour);
    svg.call(zoomBehaviour.transform, zoomIdentity.translate(width / 2 - ((minX + maxX) / 2) * scale, height - 50 * scale).scale(scale));

    // Edges follow the merge direction, like the lane connectors: arrows point from a PR into what it merges into.
    const defs = svg.append('defs');
    ([['idle', 'var(--edge)'], ['merged', 'var(--edge-merged)'], ['hot', 'var(--accent)']] as const).forEach(([name, fill]) => {
      defs.append('marker').attr('id', `${markerId}-${name}`).attr('viewBox', '0 0 10 10').attr('refX', 9).attr('refY', 5)
        .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto-start-reverse')
        .append('path').attr('d', 'M0 0 L10 5 L0 10 z').style('fill', fill);
    });
    const isHot = (link: (typeof links)[number]) => [link.source.node, link.target.node].some((node) => node.kind === 'open' && node.number === selectedNumber);
    const edgeKind = (link: (typeof links)[number]) => (isHot(link) ? 'hot' : link.source.node.kind !== 'open' ? 'merged' : 'idle');
    const EDGE_COLOR = { hot: 'var(--accent)', merged: 'var(--edge-merged)', idle: 'var(--edge)' } as const;
    const edges = canvas.append('g').selectAll('g').data([...links].sort((a, b) => Number(isHot(a)) - Number(isHot(b)))).join('g');
    edges.append('path')
      .attr('d', (link) => edgeRoute(link))
      .attr('fill', 'none').attr('stroke-width', (link) => (isHot(link) ? 2.5 : 2)).attr('stroke-linejoin', 'miter')
      .attr('stroke-dasharray', (link) => (link.source.node.kind === 'merged' || link.target.node.kind === 'merged' ? '5 4' : null))
      .attr('marker-end', (link) => `url(#${markerId}-${edgeKind(link)})`)
      .style('stroke', (link) => EDGE_COLOR[edgeKind(link)])
      .style('opacity', 0)
      .transition().delay((_, index) => 150 + index * step).duration(duration / 1.3).style('opacity', 1);
    edges.filter((link) => (link.target.node.behindParent ?? 0) > 0).append('text')
      .attr('x', (link) => link.target.x + 8).attr('y', (link) => link.target.y + NODE_HEIGHT / 2 + 16)
      .attr('font-size', 11).attr('font-weight', 600).style('fill', 'var(--behind)')
      .text((link) => `${link.target.node.behindParent} behind`);

    const group = canvas.append('g').selectAll('g').data(placed).join('g')
      .attr('transform', (entry) => `translate(${entry.x},${entry.y + 24})`).style('opacity', 0);
    group.transition().delay((_, index) => index * step).duration(duration).ease(easeCubicOut)
      .attr('transform', (entry) => `translate(${entry.x},${entry.y})`)
      .style('opacity', (entry) => (entry.node.kind === 'merged' ? 0.6 : 1));

    const base = group.filter((entry) => entry.node.kind === 'base');
    base.append('rect').attr('x', -50).attr('y', -16).attr('width', 100).attr('height', 32).attr('rx', 16).style('fill', 'var(--pill)');
    base.append('text').attr('text-anchor', 'middle').attr('y', 5).attr('font-size', 13).attr('font-weight', 600).attr('font-family', 'var(--mono)')
      .style('fill', 'var(--pill-fg)').text(detail.baseRefName);

    const card = group.filter((entry) => entry.node.kind !== 'base');
    card.append('rect').attr('x', -NODE_WIDTH / 2).attr('y', -NODE_HEIGHT / 2).attr('width', NODE_WIDTH).attr('height', NODE_HEIGHT).attr('rx', 10)
      .attr('stroke-dasharray', (entry) => (entry.node.kind === 'merged' ? '5 4' : null))
      .attr('stroke-width', (entry) => (entry.node.number === selectedNumber ? 2 : 1))
      .style('fill', (entry) => (entry.node.kind === 'merged' ? 'var(--merged-card)' : 'var(--surface)'))
      .style('stroke', (entry) => (entry.node.kind === 'merged' ? 'var(--edge-merged)' : entry.node.number === selectedNumber ? 'var(--accent)' : 'var(--border)'));
    card.append('circle').attr('cx', -NODE_WIDTH / 2 + 16).attr('cy', -NODE_HEIGHT / 2 + 18).attr('r', 6)
      .style('fill', (entry) => {
        const view = entry.node.number ? viewsByNumber.get(entry.node.number) : undefined;
        return entry.node.kind === 'merged' || !view ? 'var(--c-merged)' : BUCKET_COLOR[view.bucket];
      });
    card.append('text').attr('x', -NODE_WIDTH / 2 + 30).attr('y', -NODE_HEIGHT / 2 + 22).attr('font-size', 12).attr('font-family', 'var(--mono)').style('fill', 'var(--muted)')
      .text((entry) => {
        const view = entry.node.number ? viewsByNumber.get(entry.node.number) : undefined;
        return `#${entry.node.number} · ${entry.node.kind === 'merged' ? entry.node.state : view ? ageLabel(view.ageHours) : 'open'}`;
      });
    card.append('text').attr('x', -NODE_WIDTH / 2 + 14).attr('y', -NODE_HEIGHT / 2 + 42).attr('font-size', 13).attr('font-weight', 600).style('fill', 'var(--text)')
      .text((entry) => truncate(entry.node.title ?? '', 30));

    const open = card.filter((entry) => entry.node.kind === 'open').style('cursor', 'pointer')
      .on('click', (_event, entry) => entry.node.number && onSelectRef.current(entry.node.number));
    open.each(function drawSquares(entry) {
      const view = entry.node.number ? viewsByNumber.get(entry.node.number) : undefined;
      if (!view) return;
      const squares = select(this).append('g').attr('transform', `translate(${NODE_WIDTH / 2 - 6 * 19 - 8},${-NODE_HEIGHT / 2 + 10})`);
      view.signals.forEach((signal, index) => {
        squares.append('rect').attr('x', index * 19).attr('width', 16).attr('height', 16).attr('rx', 4).style('fill', SIGNAL_COLORS[signal.color][0])
          .append('title').text(`${signal.label}: ${signal.detail}`);
        squares.append('text').attr('x', index * 19 + 8).attr('y', 12).attr('text-anchor', 'middle').attr('font-size', 10).attr('font-weight', 700)
          .style('fill', SIGNAL_COLORS[signal.color][1]).text(signal.glyph);
      });
    });
    const next = open.filter((entry) => nextKeys.has(entry.node.key));
    next.append('rect').attr('x', NODE_WIDTH / 2 - 104).attr('y', NODE_HEIGHT / 2 - 12).attr('width', 98).attr('height', 22).attr('rx', 11).style('fill', 'var(--accent)');
    next.append('text').attr('x', NODE_WIDTH / 2 - 55).attr('y', NODE_HEIGHT / 2 + 3).attr('text-anchor', 'middle').attr('font-size', 11).attr('font-weight', 700)
      .style('fill', 'var(--accent-fg)').text('Next to merge');

    return () => {
      svg.on('.zoom', null);
      svg.selectAll('*').remove();
    };
    // Redraw only when the stack's content, statuses or selection really change.
  }, [detailKey, statusKey, selectedNumber]);

  return <svg ref={svgRef} className="stack-svg" role="img" aria-label={label} />;
}
```

- [ ] **Step 5: Implement the dialog and the Stacks tab**

`web/src/components/StackDialog.tsx`:
```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PrView } from '../../../shared/grouping';
import type { StackDetail } from '../../../shared/types';
import type { DashboardApi } from '../api/client';
import { StackDiagram } from './StackDiagram';

interface StackDialogProps {
  api: Pick<DashboardApi, 'stackDetail'>;
  prId: string;
  views: Map<string, PrView>;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function StackDialog({ api, prId, views, onSelect, onClose }: StackDialogProps) {
  const [detail, setDetail] = useState<StackDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    api.stackDetail(prId)
      .then((loaded) => { if (active) loaded ? setDetail(loaded) : setError('This PR is not part of a stack any more.'); })
      .catch((caught: Error) => active && setError(`Could not load the stack: ${caught.message}`));
    return () => { active = false; };
  }, [api, prId]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  const repo = views.get(prId)?.pr.repo ?? detail?.repo;
  const viewsByNumber = useMemo(
    () => new Map([...views.values()].filter((view) => view.pr.repo === repo).map((view) => [view.pr.number, view])),
    [views, repo],
  );
  const title = detail ? `${detail.repo} · ${detail.native ? `GitHub stack #${detail.number}` : 'Branch-chained stack'}` : 'Stack';
  const openCount = detail?.entries.filter((entry) => entry.state === 'open').length ?? 0;
  const notOpenCount = (detail?.entries.length ?? 0) - openCount;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="stack-dialog-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3 id="stack-dialog-title">{title}</h3>
          {detail && <span className="muted small">{openCount} open, {notOpenCount} merged or closed · onto {detail.baseRefName}</span>}
          <span className="grow" />
          <span className="muted small">Scroll to zoom, drag to pan</span>
          <button ref={closeRef} type="button" className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <p className="empty-state">{error}</p>}
          {!error && !detail && <p className="empty-state">Loading stack…</p>}
          {detail && (
            <StackDiagram
              detail={detail}
              viewsByNumber={viewsByNumber}
              selectedNumber={views.get(prId)?.pr.number}
              label={`Diagram of ${title}`}
              onSelect={(number) => {
                const target = viewsByNumber.get(number);
                if (target) onSelect(target.pr.id);
              }}
            />
          )}
        </div>
        <div className="legend">
          <span><i className="fill-blocked" />Blocked</span><span><i className="fill-waiting" />Waiting for review</span>
          <span><i className="fill-ready" />Ready</span><span><i style={{ background: 'var(--c-merged)', opacity: 0.6 }} />Merged</span>
          <span>Arrow = merges into · label = commits behind its target</span>
        </div>
      </div>
    </div>
  );
}
```

`web/src/views/StacksView.tsx`:
```tsx
import { useMemo } from 'react';
import type { PrView } from '../../../shared/grouping';
import { detectStacks } from '../../../shared/stacks';
import type { Snapshot } from '../../../shared/types';
import { StackDiagram } from '../components/StackDiagram';
import { localStackDetail } from '../lib/stackLayout';

interface StacksViewProps { snapshot: Snapshot; views: Map<string, PrView>; onSelect: (id: string) => void; onVisualize: (prId: string) => void }

export function StacksView({ snapshot, views, onSelect, onVisualize }: StacksViewProps) {
  const byId = useMemo(() => new Map(snapshot.prs.map((pr) => [pr.id, pr])), [snapshot.prs]);
  const stacks = useMemo(
    () => detectStacks(snapshot.prs).filter((stack) => snapshot.settings.repos.includes(stack.repo)),
    [snapshot.prs, snapshot.settings.repos],
  );
  if (stacks.length === 0) return <p className="empty-state">No stacked pull requests in the selected repositories.</p>;
  return (
    <div className="stacks">
      {stacks.map((stack) => {
        const lead = byId.get(stack.members.find((member) => member.parentId === null)?.id ?? stack.members[0]!.id)!;
        const viewsByNumber = new Map([...views.values()].filter((view) => view.pr.repo === stack.repo).map((view) => [view.pr.number, view]));
        return (
          <section key={stack.id} className="scard" aria-label={`${stack.repo} stack`}>
            <div className="scard-head">
              <b>{stack.repo}</b>
              <span className="muted small">
                {stack.native ? `GitHub stack #${stack.number}` : 'branch-chained'} · {stack.members.length} open
                {stack.notOpenCount ? ` · ${stack.notOpenCount} merged or closed` : ''} · {lead.author.name ?? lead.author.login}
              </span>
              <span className="grow" />
              <button type="button" className="btn" onClick={() => onVisualize(lead.id)}>Open large</button>
            </div>
            <StackDiagram
              detail={localStackDetail(stack, byId)}
              viewsByNumber={viewsByNumber}
              label={`Diagram of the ${stack.repo} stack`}
              onSelect={(number) => {
                const target = viewsByNumber.get(number);
                if (target) onSelect(target.pr.id);
              }}
            />
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run web/src/__tests__/stackLayout.test.ts web/src/__tests__/StackDialog.test.tsx web/src/__tests__/StacksView.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "Add the D3 stack diagram, the stack dialog and the Stacks tab."
```

---

### Task 20: Settings panel (repository picker, cap 10)

**Files:**
- Create: `web/src/components/SettingsPanel.tsx`, `web/src/__tests__/SettingsPanel.test.tsx`

**Interfaces:**
- Consumes: `DashboardApi['searchRepos']` (Task 15); `MAX_REPOS`, `RepoRef` (Task 1).
- Produces: `<SettingsPanel api repos onSave(repos: string[]): Promise<void> onClose() />`

- [ ] **Step 1: Write the failing test**

`web/src/__tests__/SettingsPanel.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPanel } from '../components/SettingsPanel';

const ten = Array.from({ length: 10 }, (_, index) => `repo-${index}`);
const api = { searchRepos: async (q: string) => (q ? [{ name: 'report-service', cloned: false }] : [{ name: 'orders-api', cloned: true }]) };

describe('SettingsPanel', () => {
  it('blocks an eleventh repository until one is removed', async () => {
    render(<SettingsPanel api={api} repos={ten} onSave={async () => undefined} onClose={() => undefined} />);
    const extra = await screen.findByRole('checkbox', { name: /orders-api/ });
    expect(extra).toBeDisabled();
    expect(screen.getByText('10 of 10 selected')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /repo-0/ }));
    expect(extra).toBeEnabled();
  });

  it('searches GitHub and saves the new selection', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<SettingsPanel api={api} repos={['orders-api']} onSave={onSave} onClose={onClose} />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search repositories' }), 'report');
    await userEvent.click(await screen.findByRole('checkbox', { name: /report-service/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(['orders-api', 'report-service']);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the error when saving fails and stays open', async () => {
    const onClose = vi.fn();
    render(<SettingsPanel api={api} repos={['orders-api']} onSave={async () => { throw new Error('repos must be a list of at most 10 names'); }} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('repos must be a list of at most 10 names');
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/src/__tests__/SettingsPanel.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `web/src/components/SettingsPanel.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { MAX_REPOS, type RepoRef } from '../../../shared/types';
import type { DashboardApi } from '../api/client';

interface SettingsPanelProps {
  api: Pick<DashboardApi, 'searchRepos'>;
  repos: string[];
  onSave: (repos: string[]) => Promise<void>;
  onClose: () => void;
}

export function SettingsPanel({ api, repos, onSave, onClose }: SettingsPanelProps) {
  const [selected, setSelected] = useState<string[]>(repos);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RepoRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    // Debounced so typing does not fire one GitHub search per keystroke.
    const timer = setTimeout(() => {
      api.searchRepos(query.trim()).then((found) => active && setResults(found)).catch(() => active && setResults([]));
    }, query ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [api, query]);

  const candidates = [...selected.map((name) => ({ name })), ...results.filter((repo) => !selected.includes(repo.name))];
  const full = selected.length >= MAX_REPOS;
  const toggle = (name: string) => setSelected((current) => (current.includes(name) ? current.filter((repo) => repo !== name) : [...current, name]));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ height: 'min(640px, 90vh)', width: 'min(560px, 94vw)' }} role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3 id="settings-title">Repositories in Overview</h3>
          <span className="muted small">{selected.length} of {MAX_REPOS} selected</span>
          <span className="grow" />
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '12px 18px 0' }}>
          <label className="search" style={{ flex: 'none' }}>
            <span className="sr-only">Search repositories</span>
            <input type="search" aria-label="Search repositories" placeholder="Search the organisation" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
        <div className="settings-list">
          {candidates.map((repo) => {
            const checked = selected.includes(repo.name);
            return (
              <label key={repo.name}>
                <input type="checkbox" checked={checked} disabled={!checked && full} onChange={() => toggle(repo.name)} />
                <span>{repo.name}</span>
                {'cloned' in repo && repo.cloned === false && <span className="muted small">not cloned</span>}
              </label>
            );
          })}
        </div>
        {error && <p role="alert" className="banner sev-red">{error}</p>}
        <div className="modal-head" style={{ borderTop: '1px solid var(--hair)', borderBottom: 0, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn"
            disabled={saving || selected.length === 0}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await onSave(selected);
                onClose();
              } catch (caught) {
                setError((caught as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/src/__tests__/SettingsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "Add the repository settings panel with the ten-repo cap."
```

---

### Task 21: Wire the app, README, and verify end to end

**Files:**
- Create: `web/src/__tests__/App.test.tsx`, `README.md`
- Modify: `web/src/App.tsx` (final version; `web/src/main.tsx` from Task 15 stays as it is)

**Interfaces:**
- Consumes: everything from Tasks 14–20; `buildPrViews` (Task 5).
- Produces: `<App api: DashboardApi />`

- [ ] **Step 1: Write the failing smoke test**

`web/src/__tests__/App.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import type { DashboardApi } from '../api/client';
import { emptySnapshot } from '../../../shared/types';
import { makePerson, makePr } from '../../../test/factories';

vi.mock('../components/StackDiagram', () => ({ StackDiagram: ({ label }: { label: string }) => <div data-testid="diagram">{label}</div> }));

function fakeApi(): DashboardApi {
  const mine = makePr({ title: 'My own change', author: makePerson('alex') });
  const theirs = makePr({ title: 'Their change', author: makePerson('sam'), mergeState: 'conflicts' });
  const snapshot = {
    ...emptySnapshot('acme'),
    viewer: { login: 'alex', teams: [] },
    prs: [mine, theirs],
    overviewIds: [mine.id, theirs.id],
    mine: { authored: [mine.id], requested: [theirs.id], team: [] },
    fetchedAt: new Date().toISOString(),
    settings: { ...emptySnapshot('acme').settings, repos: ['orders-api'] },
  };
  return {
    getSnapshot: async () => snapshot,
    subscribe: () => () => undefined,
    setVisible: async () => undefined,
    refreshNow: async () => snapshot,
    updateSettings: async (patch) => ({ ...snapshot.settings, ...patch }),
    searchRepos: async () => [],
    stackDetail: async () => null,
  };
}

describe('App', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('renders author lanes, selects a PR into the drawer and the URL, and switches to Mine', async () => {
    render(<App api={fakeApi()} />);
    const sam = await screen.findByRole('region', { name: 'sam' });
    await userEvent.click(within(sam).getByRole('button', { name: /Their change/ }));
    expect(screen.getByRole('heading', { name: 'Their change' })).toBeInTheDocument();
    expect(window.location.search).toContain('pr=');

    await userEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(screen.getByRole('region', { name: 'My PRs' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Review requested from me' })).toBeInTheDocument();
  });

  it('opens the settings panel from the header', async () => {
    render(<App api={fakeApi()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog', { name: 'Repositories in Overview' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/src/__tests__/App.test.tsx`
Expected: FAIL. The second-version App has no drawer and no settings panel, so the heading and dialog queries fail.

- [ ] **Step 3: Replace `App.tsx` with the final version**

`web/src/App.tsx`:
```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildPrViews, type PrView } from '../../shared/grouping';
import type { Bucket } from '../../shared/status';
import type { DashboardApi } from './api/client';
import { useDashboard } from './api/useDashboard';
import { Banners } from './components/Banners';
import { Drawer } from './components/Drawer';
import { Header } from './components/Header';
import { SettingsPanel } from './components/SettingsPanel';
import { StackDialog } from './components/StackDialog';
import { Toolbar } from './components/Toolbar';
import { useUrlState } from './state/urlState';
import { MineView } from './views/MineView';
import { OverviewView } from './views/OverviewView';
import { StacksView } from './views/StacksView';

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function bucketCounts(ids: string[], views: Map<string, PrView>): Record<Bucket, number> {
  const counts: Record<Bucket, number> = { blocked: 0, waiting: 0, ready: 0, draft: 0 };
  for (const id of new Set(ids)) {
    const view = views.get(id);
    if (view) counts[view.bucket] += 1;
  }
  return counts;
}

export function App({ api }: { api: DashboardApi }) {
  const { snapshot, refreshNow, updateSettings } = useDashboard(api);
  const [url, setUrl] = useUrlState();
  const now = useNow(15_000);
  const [stackPrId, setStackPrId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const views = useMemo(() => (snapshot ? buildPrViews(snapshot, now) : new Map<string, PrView>()), [snapshot, now]);
  const select = useCallback((id: string) => setUrl({ selected: id }), [setUrl]);
  const closeStack = useCallback(() => setStackPrId(null), []);

  if (!snapshot) return <div className="app"><p className="loading">Loading…</p></div>;

  const ids = url.tab === 'mine' ? [...snapshot.mine.authored, ...snapshot.mine.requested, ...snapshot.mine.team] : snapshot.overviewIds;
  return (
    <div className="app">
      <Header
        snapshot={snapshot}
        tab={url.tab}
        now={now}
        onTab={(tab) => setUrl({ tab })}
        onRefresh={refreshNow}
        onRefreshSetting={(refresh) => void updateSettings({ refresh })}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <Banners banners={snapshot.banners} />
      {url.tab === 'stacks'
        ? <><div className="toolbar"><span className="muted">Every stack in the selected repositories. Scroll to zoom, drag to pan, click a PR to open it.</span></div>
            <StacksView snapshot={snapshot} views={views} onSelect={(id) => setUrl({ selected: id, tab: 'overview' })} onVisualize={setStackPrId} /></>
        : (
          <>
            <Toolbar url={url} counts={bucketCounts(ids, views)} onChange={setUrl} />
            <div className="layout">
              <main className="board-wrap">
                {url.tab === 'overview'
                  ? <OverviewView snapshot={snapshot} url={url} now={now} onSelect={select} onVisualize={setStackPrId} onOpenSettings={() => setSettingsOpen(true)} />
                  : <MineView snapshot={snapshot} url={url} now={now} onSelect={select} onVisualize={setStackPrId} />}
              </main>
              <Drawer snapshot={snapshot} views={views} selectedId={url.selected} onSelect={select} onVisualize={setStackPrId} />
            </div>
          </>
        )}
      {stackPrId && (
        <StackDialog
          api={api}
          prId={stackPrId}
          views={views}
          onClose={closeStack}
          onSelect={(id) => {
            setStackPrId(null);
            setUrl({ selected: id, tab: url.tab === 'stacks' ? 'overview' : url.tab });
          }}
        />
      )}
      {settingsOpen && (
        <SettingsPanel api={api} repos={snapshot.settings.repos} onSave={(repos) => updateSettings({ repos })} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: every test passes; typecheck prints no errors.

- [ ] **Step 5: Write `README.md`**

````markdown
# Pearspective

A local, read-only dashboard of open GitHub pull requests: swimlanes for up to 10 repositories, a Mine view, and stack diagrams.
It talks to GitHub only through your logged-in `gh` CLI and listens on 127.0.0.1 only.

## Requirements

- Node 22 or newer
- GitHub CLI, logged in: `gh auth status` must show an active account with the `repo` and `read:org` scopes

## Setup

```bash
npm install
npm run setup     # pick up to 10 repositories; writes config.json
npm run dev       # API on http://127.0.0.1:4100, UI on http://127.0.0.1:5173
```

To change the repositories later, use ⚙ in the header, or run `npm run setup` again.

## Configuration (`config.json`, gitignored)

- `codeHost.repos`: the Overview repositories (max 10).
- `codeHost.teams`: teams for the "Review requested from my team" section. Detected by setup.
- `reviewerClasses`: which bot logins count as AI review (Copilot) and code analysis (CodeScene). A trailing `*` matches a prefix.
- `refreshIntervalSec`: 0 (off), 180, 300, 600, 900 or 1800. Also editable from the header.
- `issueTracker` (optional): `{ "provider": "jira", "baseUrl": "https://…/jira" }` makes ticket keys clickable.

## How it uses the GitHub API

- **Cheap poll:** while a dashboard tab is visible, one query per refresh lists the open PRs in your repositories.
- **Full details:** fetched only for PRs that changed or still have checks running, 25 per request.
- **Full sweep:** every 15 minutes.
- **Budget:** about 200 of your 5,000 GraphQL points per hour at most. Under 500 remaining, a banner appears and refreshes slow down. Nothing is polled while every tab is hidden.

## Troubleshooting

- **"gh is not logged in"**: run `gh auth login`, or `gh auth switch` if the wrong account is active. The header shows which login is in use.
- **"Last refresh failed …"**: the data shown is from the last good refresh. The banner says why it failed.
- **The server log** prints one line per refresh with the PR count and the API points left.

## Development

```bash
npm test          # Vitest
npm run typecheck
```

- Design: `docs/design.md`
- Visual reference: `docs/mockup/overview-swimlanes.html`
- v2 ideas: `docs/v2-proposal.md`
````

- [ ] **Step 6: Verify end to end against real GitHub**

Run `npm run dev` in the background, then open `http://127.0.0.1:5173` in the browser and check each item. Compare against `docs/mockup/overview-swimlanes.html`.

1. The header shows your login and avatar, "Updated Ns ago", and the interval set to "Every 3m".
2. **Overview:**
   - Lanes are grouped by author and sorted by blocked count.
   - Bots are collapsed at the bottom.
   - Every row has 6 squares with tooltips and an age bar.
3. **Group by Repository and by Ticket both work.** Ticket shows a "No ticket" lane last.
4. **Filters:**
   - The Drafts chip is off by default.
   - Toggling chips and typing in search narrows the rows.
   - Reloading the page keeps the filters (they are in the URL).
5. **Stacks:**
   - The field-app stack shows as one stack row, if that repo is selected.
   - Expanding it lists the members top-down, with "stacked on #N" badges.
   - "Visualize stack" opens the dialog with merged entries, "N behind" labels and "Next to merge".
   - Clicking a node selects that PR.
6. **Mine** shows My PRs, Review requested from me, and the team section (collapsed).
7. **Drawer:** it shows failing check links, reviewers with avatars (including the Copilot and CodeScene bots), unresolved threads, related PRs by ticket, and "Open on GitHub".
8. **Stacks tab:** one diagram per stack.
9. **Theme:**
   - Switch Dark, then Light, then System; everything, including the diagrams, follows.
   - Reload in Dark: there is no white flash.
10. **Polling:**
    - Hide the tab for over 3 minutes. The server log prints no new refresh lines.
    - Show the tab again. A refresh happens if the data is older than the interval.
11. **Settings:** ⚙ allows at most 10 repos, searches the org, and saving updates the Overview.
12. **Errors:** temporarily run `gh auth switch` to an account without org access, or rename `gh` out of `PATH` in a test shell. Restart the server and check that a banner explains the problem. Switch back afterwards.

Fix anything that fails, rerun `npm test`, and only then commit.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Wire the dashboard app together and document setup."
```

---

## After v1: applying the Lovable design

The Lovable design will arrive later. The plan keeps a clean seam for it:

- **Keep as they are:**
  - everything in `shared/` (status, stacks, grouping, view models)
  - `server/`
  - `web/src/api/`, `web/src/state/`, `web/src/lib/`
  - the D3 logic in `StackDiagram.tsx`
- **Replace or restyle:**
  - the presentational components in `web/src/components/` and `web/src/views/`
  - `web/src/styles/app.css`
- **The contract a new design must consume:**
  - `LaneModel` / `Unit` / `PrView` from `shared/grouping.ts`
  - the `DashboardApi` interface
  - the CSS tokens in `tokens.css` (keep the names; Lovable's Tailwind theme can map onto them)
- **Before accepting a replacement component:** the existing component tests describe its behaviour (accessible names, aria-pressed/expanded, the 10-repo cap, Escape closes dialogs). Keep them passing.
- **Note on types:** `lovable-prompt.md` describes GitHub-style uppercase enums (`'CLEAN'`, `'APPROVED'`). When porting Lovable components, map them to the neutral lowercase values in `shared/types.ts`, not the other way round.
