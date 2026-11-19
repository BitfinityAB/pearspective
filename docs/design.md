# Pearspective — Design

Status: agreed 2026-11-18. Implementation plan: `docs/superpowers/plans/2026-11-18-pearspective-v1.md`; its "Decisions made while planning" section lists where it refines this document.

## Purpose

A local, single-user dashboard of open pull requests in `acme`.

- **Mine** answers "what needs me right now?"
- **Overview** answers "how is the team's PR flow, where is it stuck, and how old is it?"

Read-only: the dashboard never approves, merges, comments or re-runs anything.

## Scope

- Open PRs only. Drafts are shown, visually de-emphasised and folded away by default.
- Overview covers up to **10 selected repos** (one constant; raise after benchmarking).
- Mine covers the **whole org**.
- Out of v1: notifications, merged/closed history, write actions, multi-user hosting. See `v2-proposal.md`.

## Architecture

```
browser (Vite + React + D3)  ──HTTP/SSE──▶  Node server (Express, TS)  ──spawn──▶  gh api graphql
                                             in-memory cache + poller
                                             config.json
```

- TypeScript throughout. One `npm run dev` starts server and client.
- Server binds to `127.0.0.1` only. No auth of its own.
- Uses the **active** `gh` account (`gh api` inherits it); the login is shown in the header so an account switch is obvious.
- The browser only ever reads the server's cache; it never talks to GitHub.

## Providers

GitHub (and later Jira) sit behind interfaces. Then someone can write a GitLab, Azure DevOps, Bitbucket, Trello, Asana or Notion implementation and choose it in config, without touching the poller, the status rules or the UI.

```
              ┌────────────────────────┐        ┌───────────────────────────┐
 poller ────▶ │ CodeHostProvider       │        │ IssueTrackerProvider      │ (v2)
 status rules │  github (v1, gh CLI)   │        │  jira (v2), trello, asana │
 UI (via API) │  gitlab, azure-devops… │        │  notion…                  │
              └──────────┬─────────────┘        └────────────┬──────────────┘
                         ▼                                   ▼
                 neutral domain model: ChangeRequest, Check, Review, Thread, Stack, Ticket
```

### Rules

- **The domain model is neutral.** The poller, the status rules (`status.ts`), grouping and the HTTP API only ever see neutral types (`ChangeRequest`, `Check`, `Review`, `Thread`, `Stack`, `Ticket`, `Viewer`). Provider vocabulary such as GraphQL fields, `mergeStateStatus`, GitLab "merge requests" or Azure "policies" never leaks past the provider.
- **Providers map their native states onto neutral enums.** For example: GitHub `DIRTY` and GitLab `has_conflicts` both become `conflicts`, and a required GitHub check and an Azure "required policy" both become `Check.required = true`.
- **Missing features are declared, not faked.** Each provider declares `capabilities`, and the UI hides or greys out what a provider can't supply. For example, a provider without native stacks falls back to the generic branch-chain detection.
- **Reviewer classes are config, not code.** v1 hard-codes `copilot-pull-request-reviewer` as the Copilot reviewer and `codescene-*` as CodeScene. Instead, `config.json` maps reviewer logins (or patterns) to a class (`ai-review`, `code-analysis`, `bot`), and the status strip gets its non-human signals from these classes. On another host, other bots can fill the same signals.
- **Each provider is a module** under `server/providers/<kind>/<name>/` with its own tests and fixtures. A registry chooses providers from config, and every implementation must pass a shared **contract test** suite (fixtures in, neutral model out).

### Interfaces (sketch)

```ts
interface CodeHostProvider {
  readonly id: string;                       // "github"
  readonly capabilities: {
    nativeStacks: boolean; requiredChecks: boolean; mergeability: boolean;
    draft: boolean; reviewThreads: boolean; teamReviewRequests: boolean;
  };
  checkAuth(): Promise<{ ok: boolean; viewer?: Viewer; error?: string }>;
  rateLimit(): Promise<{ remaining: number; resetAt: string } | null>;
  listRepos(query?: string): Promise<RepoRef[]>;                         // for settings and setup
  rankReposByActivity(days: number): Promise<RepoRef[]>;                 // for setup pre-selection
  pollLean(repos: RepoRef[]): Promise<ChangeRequestStub[]>;              // id, updatedAt, headSha, base/head refs, draft, stack ids
  fetchFull(ids: string[]): Promise<ChangeRequest[]>;                    // provider batches internally (GitHub: 25/page)
  searchMine(kind: 'authored' | 'review-requested' | 'team-review-requested'): Promise<ChangeRequestStub[]>;
  compareRefs?(repo: RepoRef, base: string, head: string): Promise<{ behindBy: number }>; // stack dialog "N behind"
}

interface IssueTrackerProvider {                                         // v2
  readonly id: string;                       // "jira"
  readonly keyPattern: RegExp;               // how keys look in branch/title, e.g. /[A-Z][A-Z0-9]+-\d+/
  checkAuth(): Promise<{ ok: boolean; error?: string }>;
  getTickets(keys: string[]): Promise<Ticket[]>;                         // batched, e.g. one JQL `key in (…)`
  ticketUrl(key: string): string;
  workflow(projectKey: string): Promise<WorkflowStatus[]>;               // feeds the PR-state → expected-status mapping
}
```

`ChangeRequest` is the neutral form of the `PullRequest` shape in `lovable-prompt.md`, plus a `provider` field. The frontend keeps the friendlier "PR" wording in the UI.

### Config

```json
{
  "codeHost":     { "provider": "github", "org": "acme", "repos": ["…"] },
  "issueTracker": { "provider": "jira", "baseUrl": "https://jira.example.com" },
  "reviewerClasses": {
    "ai-review":     ["copilot-pull-request-reviewer"],
    "code-analysis": ["codescene-access", "codescene-delta-analysis"]
  }
}
```

v1 ships only `github`. `issueTracker` is optional, so the Jira features simply switch off when it is missing. The section is shown in its v2 form so that the v1 config shape doesn't need to change later.

## Configuration

`config.json` (gitignored):

```json
{
  "codeHost": {
    "provider": "github",
    "org": "acme",
    "repos": ["orders-api", "orders-web", "..."],
    "excludeRepos": [],
    "teams": ["platform-team"]
  },
  "reviewerClasses": {
    "ai-review":     ["copilot-pull-request-reviewer"],
    "code-analysis": ["codescene-access", "codescene-delta-analysis"]
  },
  "refreshIntervalSec": 180
}
```

Provider-specific keys live under `codeHost` / `issueTracker`; see [Providers](#providers).

### `npm run setup`

One cross-platform Node script:

1. Asks for a folder (default: the parent folder of the checkout) and scans it (depth 2) for git clones whose `origin` is in the org.
2. Ranks candidates by **PRs you authored or reviewed in the last 90 days** (`gh search prs --owner <org> --author @me` / `--reviewed-by @me`). GitHub's `contributionsCollection` is not usable: for this account it returns only public contributions.
3. Skips repos with zero open PRs when pre-selecting; pre-selects the top 10.
4. Interactive checklist; refuses more than 10.
5. Writes `config.json`; detects the viewer's teams in the org.

### Settings panel

Same selection in the UI (cap 10), built from the setup scan plus a GitHub repo search, so repos that are not cloned (e.g. `report-service`) can be added. Writes the same `config.json`.

## Data fetching

Measured on 2026-11-18: 10 most active repos ≈ 196 open PRs (30 drafts). GraphQL budget is 5,000 points/hour.

Constraints found:

- The full field set fails above ~25 PRs per page (`first:100` → resource limit, `first:50` → 502).
- A search with 10 `repo:` qualifiers works (370 chars, no error).
- CI completing does **not** reliably bump `updatedAt`.

Strategy:

| Step | When | Query | Cost |
|---|---|---|---|
| Lean poll | every tick | one request, aliased `repository{pullRequests(states:OPEN, first:50, orderBy:UPDATED_AT)}` per repo: `number, updatedAt, headRefOid, baseRefName, headRefName, isDraft` | ~1 |
| Enrich | after lean poll | full fields, 25 per request (by node id), only for PRs that are new, changed `updatedAt`/`headRefOid`, have pending checks, or have `mergeable: UNKNOWN` | ~1 per 25 |
| Full sweep | every 15 min | enrich everything | ~8 |
| Mine | every tick | three searches: `author:@me`, `user-review-requested:@me` (excludes team requests), `team-review-requested:<org>/<team>`, org-wide, `is:open is:pr` | ~3 + enrich |

Worst case ≈ 200 points/hour.

Full field set per PR: `mergeable, mergeStateStatus, reviewDecision, isDraft, createdAt, updatedAt, author{login __typename avatarUrl(size:64)}, baseRefName, headRefName, statusCheckRollup` (from last commit, with contexts incl. `isRequired(pullRequestNumber:)`), `reviews(last:10){author{login __typename avatarUrl(size:64)} state submittedAt}`, `reviewThreads(first:20){isResolved comments(first:1){author{login} body}}`, `reviewRequests(first:5){requestedReviewer{... on User{login} ... on Team{slug} ... on Bot{login}}}`, `comments{totalCount}`.

### Polling

- The server polls only while at least one dashboard tab is open **and visible** (client heartbeat over SSE; `visibilitychange` pauses it).
- Grafana-style control: Off · 3m · 5m · 10m · 15m · 30m (3m minimum), a ⟳ refresh-now button, "last updated 42s ago". The interval is saved to config.
- `mergeable: UNKNOWN` is shown as "checking…" and re-enriched next tick.

### Errors

A banner, never silent failure, when:

- `gh` is missing or logged out
- rate limit is under 500 remaining (the poller also backs off)
- a fetch fails (the last good data stays, marked **stale**)

## Status model

All status derivation is pure functions over the raw GraphQL data (unit-tested).

### Reviewer classes

These are the GitHub defaults. The mapping comes from `reviewerClasses` in config, not from code.

| Class | Logins | Counts as human review |
|---|---|---|
| Copilot | `copilot-pull-request-reviewer` (Bot) | no |
| CodeScene | `codescene-access`, `codescene-delta-analysis` (Bot) | no |
| Other bots | any `__typename: Bot` | no, ignored |
| Human | `__typename: User` | yes |

### Status strip (six signals)

| Signal | Green | Amber | Red | Grey |
|---|---|---|---|---|
| CI | all passed | pending, or only non-required failed | a required check failed | no checks |
| Copilot | reviewed, all its threads resolved | requested and not reviewed yet, or unresolved threads | — | not requested |
| CodeScene | approved | — | changes requested | no review |
| Human review | `APPROVED` | `REVIEW_REQUIRED` | `CHANGES_REQUESTED` | no review required (`null`) |
| Threads | 0 unresolved (human) | >0 unresolved | — | — |
| Mergeable | `CLEAN` | `BLOCKED` / `UNSTABLE` | `DIRTY` (conflicts) / `BEHIND` | `UNKNOWN` ("checking…") |

The tooltip on each icon shows the raw detail. Human review also shows ✓n ✗n counts.

### Blockers

A PR is **Blocked** if any of these is true. Each one renders as its own badge:

- conflicts
- a required check failed
- changes requested
- approvals missing
- unresolved threads
- behind the base branch (when up-to-date is required)
- draft

Otherwise it is **Waiting for review** (no approval decision yet) or **Ready** (mergeable).

## Views

### Overview

- Group by **author** (default) or **repo**. Bot authors go in one "Bots" group, collapsed by default.
- Sort within a group: Blocked → Waiting → Ready, oldest first, with an asc/desc toggle. Groups are sorted by blocked count.
- Group header shows a stacked bar of ready / blocked / waiting counts (D3).
- Every PR shows the status strip and its **age** on a shared log-scale time axis (D3). Drafts are hatched.
- Filter bar: status chips (Blocked · Waiting · Ready · Drafts) and a text search across title, branch and repo.
- Grouping, sort and filters are stored in the URL.
- Layout is **swimlane rows**, chosen over a Trello-style board on 2026-11-18: rows keep age and status comparable down a shared column. Mockup: `docs/mockup/overview-swimlanes.html`, a self-contained page with fake data; open it in a browser.
- Group by **Ticket** is a third option. It groups by the Jira key (`[A-Z]+-\d+`) in the title or branch, across repos. PRs without a key go in a "No ticket" lane.

### Mine

Kept on 2026-11-18, even though GitHub's own dashboard (github.com/pulls) covers a similar inbox (see `alternatives.md`). Mine shows the same six-signal rows, stacks and Jira links as Overview, which GitHub's dashboard doesn't.

Three sections, org-wide, using the same PR row/card component as Overview:

1. **My PRs**
2. **Review requested from me**
3. **Review requested from my team** (`platform-team`), collapsed, excluding PRs already in section 2

### Avatars

Verified 2026-11-18: GraphQL returns `avatarUrl(size:)` for `viewer`, `User`, `Bot` (Copilot, CodeScene) and `Team`, at a query cost of 1. The URLs (`avatars.githubusercontent.com`) load **without a token**, so the browser can use them directly.

- **Where avatars appear:**
  - **header:** the signed-in user (`viewer`, fetched once at start-up with `checkAuth()`)
  - **author lanes:** the author's avatar
  - **the Mine "my team" lane:** the team's avatar
  - **the drawer's reviewers:** each reviewer, Copilot and CodeScene included, with their own app avatars
  - **the Bots lane:** a generic bot icon
  - **repository lanes:** a repo icon
  - **ticket lanes:** a ticket icon
- **Size:** request `size:64`, shown at 22–32px, so it stays sharp on 2× screens. The URLs travel in the snapshot, with no extra endpoint.
- **Fallback:** coloured initials. They are shown while an image loads, when it fails (offline, blocked) and for a provider without avatars (`CodeHostProvider` returns `avatarUrl?` as optional).
- No proxying or caching on the server in v1. The browser caches by URL, and the `v=` parameter changes when an avatar changes.

### Theme (light / dark)

- **Choosing the theme:** a three-way control in the header, **System** (default), **Light** and **Dark**.
  - System follows `prefers-color-scheme` live.
  - The choice is saved in `localStorage`. The theme is per browser, not part of the server config.
  - It is applied as `data-theme` on `<html>` before first paint, so a dark-mode user never sees a white flash.
- **Colours are tokens:** every colour is a CSS custom property defined in light and dark sets. No hex values in components or D3 code.
  - D3 sets colours with `.style('fill', 'var(--…)')`, not hard-coded attributes, so the SVG diagrams switch theme without a redraw.
- **Status colours in dark mode** are brighter, so they stay readable on a dark background:
  - blocked `#f85149`
  - waiting `#d29922`
  - ready `#3fb950`
  - draft `#6e7681`
  - Badges use translucent tints with light text.
  - The glyph (✓ ! ✕ –) and the lightness difference keep them distinguishable without hue.
- **Contrast:** text, including the 11–12px muted labels, must meet 4.5:1 in **both** themes. Check both themes in the component tests' visual review.

### PR detail drawer

Opens on click and is read-only. Shows:

- failing checks, each linked to its run
- each reviewer and their state
- unresolved threads, with a snippet and link
- **Related PRs**: other open PRs with the same Jira key, in any repo
- **Stack**: the chain this PR belongs to
- "Open on GitHub", plus a link to the Jira ticket. There are no Jira API calls.

### Stacked PRs

Detection uses two sources:

1. **Native stacks.** GitHub's GraphQL schema has `PullRequest.stack` (`number`, `size`, `baseRefName`, `entries`) and `PullRequest.stackEntry.position`, where 1 is closest to the base branch. These are populated only for stacks created with GitHub's stack feature. Example (2026-11-18): field-app #4988 is in stack 4964, size 26, position 15. Native stacks also count merged entries, so orders-api's stack 2640 has size 4, but its open PRs are positions 3–4.
2. **Branch-chained stacks.** These are stacks built by hand, where `stack` is null. A PR counts as stacked when its `baseRefName` is the `headRefName` of another open PR in the same repo. Examples: orders-api #2380, orders-web #1345.

When both sources apply, the native stack wins. Both need only fields the lean poll already fetches; add `stack{number size} stackEntry{position}` to it.

Display:

- **In a lane**, a stack is one collapsible row: "Stack of N PRs · #first → #last", with a status pip per PR. It is placed by the status of the PR closest to the base branch. Expanding it shows the member rows from top to bottom, with the base branch as a pill row underneath. Rows are joined by dependency arrows in the style of the Bryntum scheduler in orders-web:
  - Arrows show the **merge direction**. Each one leaves a PR, runs down a gutter on the left, and ends in an arrowhead at the PR it merges into. The bottom PR's arrow ends at the base-branch pill. The route is orthogonal, with square corners.
  - A straight chain shares one trunk. Each extra child of a fork gets its own gutter column, so a 26-deep stack doesn't drift right.
  - Arrows touching the selected PR are drawn in the accent colour.
- **A stacked PR whose parent is still open** gets an informational "stacked on #N" badge. This is not a blocker. Its own signals count as normal.
- **A "Visualize stack" button** on the stack row and in the drawer opens a modal dialog with a D3 diagram of that stack:
  - It is a vertical node-link tree, with the base branch (`main`) as a pill at the bottom and the top of the stack at the top. A fork renders as branches (`d3.stratify` + `d3.tree`).
  - **Open PR nodes** are cards with a status-coloured dot, `#number · age`, the title and the six mini status squares. The selected PR is outlined.
  - **Merged entries** (native stacks only) are faded, dashed nodes between the base branch and the lowest open PR. They are never shown in the lanes.
  - **Edges** are arrows in **merge direction**, the same rule as the lane connectors. Each one runs from a PR's card down into the card of the PR it merges into, or into the base pill. They use square-cornered step routes. Arrows into merged entries are dashed, and the selected PR's arrows use the accent colour. An edge carries an "N behind" label when the branch is behind its target. N comes from `compare` between the two branches, fetched only when the dialog opens.
  - A **"Next to merge"** pill marks each open PR whose parent is the base branch or a merged entry.
  - Nodes and edges animate in from the bottom up, staggered.
  - `d3.zoom` handles pan and zoom. The initial fit shows the base, with a minimum scale of 0.45 for deep stacks.
  - Clicking an open PR node closes the dialog and selects that PR in the drawer.
- **A Stacks tab** shows a D3 tree of every stack in the selected repos. Nodes are coloured by status, forks show as branches, and clicking a node opens the drawer.

## Tests

- Vitest unit tests for status derivation and blocker rules, against saved, anonymized GraphQL fixtures.
- A couple of component tests for the PR row/card.
- No E2E in v1.

## Docs

- `README.md`: install, `npm run setup`, `npm run dev`, troubleshooting `gh` auth.
- `docs/v2-proposal.md`: desktop notifications, raising the repo cap after benchmarking, hosting/repo decision.
