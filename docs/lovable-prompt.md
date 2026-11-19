# Lovable prompt

Paste everything below the line into Lovable. Attach `docs/mockup/overview-swimlanes.html`; Lovable's docs list HTML as a supported file type. If the attachment is refused, attach screenshots of the Overview and of the open "Visualize stack" dialog instead. The mockup is the visual reference; this prompt is the spec.

---

The attached `overview-swimlanes.html` is a working, single-file mockup built with vanilla JS, D3 and fake data. Match its **layout, visuals and interactions**, including the stack dialog and the Stacks tab. Do **not** copy its code structure: implement it as the React component structure described below. Where the mockup and this spec disagree, follow the spec.

Build the **frontend only** of a read-only dashboard of open GitHub pull requests for one organisation. Use React + TypeScript + Vite, Tailwind and shadcn/ui, and use **D3 v7** for the two visualisations named below.

**Do not add:**
- a backend, Supabase, authentication or a login page
- any write actions (approve, merge, comment)

All data comes from one typed mock module (`src/data/mock.ts`) behind a `DashboardApi` interface (`src/data/api.ts`), so it can later be replaced by `fetch('/api/…')` calls to a local server.

## Data model (`src/data/types.ts`)

```ts
type Signal = 'green' | 'amber' | 'red' | 'grey';
type MergeState = 'CLEAN' | 'BLOCKED' | 'UNSTABLE' | 'DIRTY' | 'BEHIND' | 'UNKNOWN';
type ReviewDecision = 'APPROVED' | 'REVIEW_REQUIRED' | 'CHANGES_REQUESTED' | null;

interface Check { name: string; state: 'SUCCESS' | 'PENDING' | 'FAILURE'; required: boolean; url: string }
interface Review { login: string; displayName: string; kind: 'human' | 'copilot' | 'codescene' | 'bot'; state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'; avatarUrl?: string }
interface Thread { resolved: boolean; authorKind: 'human' | 'copilot'; author: string; snippet: string; url: string }

interface PullRequest {
  id: string; repo: string; number: number; title: string; url: string;
  author: { login: string; displayName: string; isBot: boolean; avatarUrl?: string };
  headRefName: string; baseRefName: string; headRefOid: string;
  createdAt: string; updatedAt: string; isDraft: boolean;
  mergeState: MergeState; reviewDecision: ReviewDecision;
  checks: Check[]; reviews: Review[]; threads: Thread[];
  copilotRequested: boolean; commentCount: number;
  stack?: { id: string; native: boolean; number?: number; position?: number; parentId?: string; behindParent?: number };
  ticket?: string; // Jira key parsed from title/branch, e.g. "XX-12345"
}
interface StackInfo { id: string; repo: string; native: boolean; number?: number; baseRefName: string; merged: { number: number; title: string }[] }
interface Snapshot { viewer: { login: string; avatarUrl?: string; teams: { slug: string; avatarUrl?: string }[] }; prs: PullRequest[]; stacks: StackInfo[]; fetchedAt: string; stale: boolean; rateLimitRemaining: number }
```

Mock data: about 25 PRs across 5 repos and 5 made-up authors, plus 3 bot PRs (dependabot). Include:
- one **native stack** of 5 open PRs plus 2 merged entries
- one **branch-chained stack that forks**: two PRs on the same parent
- one PR with `mergeState: 'UNKNOWN'`
- two drafts
- one very old PR (about 2 months)
- PRs in different repos that share a Jira key

Use invented names only.

## Status rules (`src/lib/status.ts`, pure functions, with Vitest unit tests)

Six signals per PR. Each has a colour **and** a glyph (✓ green, ! amber, ✕ red, – grey), so colour is never the only cue.

| Signal | Green | Amber | Red | Grey |
|---|---|---|---|---|
| CI | all checks passed | something pending, or only non-required checks failed | a required check failed | no checks |
| Copilot | reviewed, and all its threads resolved | requested but not reviewed, or reviewed with unresolved threads | — | not requested |
| CodeScene | approved | — | changes requested | no review |
| Review (humans only) | `APPROVED` | `REVIEW_REQUIRED` | `CHANGES_REQUESTED` | `null` |
| Threads (human, unresolved) | 0 | > 0 (the glyph is the count) | — | — |
| Mergeable | `CLEAN` | `BLOCKED`, `UNSTABLE` | `DIRTY`, `BEHIND` | `UNKNOWN` (shown as "Checking…", glyph …) |

Copilot, CodeScene and other bots never count as human reviews.

**Blocker badges**, each rendered separately:
- Conflicts
- Behind base
- Required check failed
- Changes requested
- N unresolved threads
- Needs approval (amber)
- Draft

**Bucket for each PR:**
- **Draft** if it is a draft.
- Otherwise **Blocked** if it has any red blocker.
- Otherwise **Waiting for review** if review is required, CI is pending or mergeability is unknown.
- Otherwise **Ready**.

**Stacks:**
- A stacked PR whose parent is open gets a blue informational badge "stacked on #N". This is **not** a blocker.
- A stack is placed in the bucket of the PR closest to the base branch.

## Layout and visual style

Neutral and calm, close to GitHub Primer:
- Inter for UI text, JetBrains Mono for repo/#number and ages.
- **Light and dark themes**, chosen with a three-way header control: System (default, follows `prefers-color-scheme` live), Light and Dark.
  - Save the choice in `localStorage` and apply it as `data-theme` on `<html>` before first paint, so there is no white flash.
  - Define every colour as a CSS variable in both themes. D3 code must use `.style('fill', 'var(--…)')`, not hex values, so the diagrams switch theme without a redraw.
  - Dark status colours: blocked `#f85149`, waiting `#d29922`, ready `#3fb950`, draft `#6e7681`. Badges use translucent tints with light text.
  - Contrast must be at least 4.5:1 in both themes.
- Colour is reserved for status: blocked red `#cf222e`, waiting amber `#d4a72c`, ready green `#2da44e`, draft hatched grey. Badges use soft tinted backgrounds with dark text.
- Avoid gradients, emoji and coloured left-border cards.
- Desktop first, but it must not break at phone width: wide content scrolls inside its own container.

### Header (on every view)

- **Left:** app name and org name, then a segmented control with **Overview · Mine · Stacks**.
- **Right, Grafana-style refresh:**
  - "Updated 42s ago", which becomes "Auto-refresh paused" when off.
  - A select with Off / 3m / 5m / 10m / 15m / 30m (3m is the minimum).
  - A ⟳ refresh-now icon button.
  - The System / Light / Dark theme control (icon segmented control: monitor, sun, moon).
  - A pill with the signed-in GitHub login.
- **Banner area** under the header, used for: `gh` not logged in, rate limit low (< 500 remaining), or data stale because the last fetch failed. Mock a way to toggle these.

### Overview: swimlane rows (the core screen)

**Toolbar:**
- Group by: **Author** (default) / **Repository** / **Ticket**.
- Status filter chips **Blocked · Waiting · Ready · Drafts**, each with a coloured dot and a count. Drafts are off by default. Unselected chips are dashed and muted.
- A search box (title, branch, repo, #number).
- An **Oldest first / Newest first** toggle.
- Keep grouping, filters, sort and search in the URL query string.

**Column header row**, aligned with every PR row via one CSS grid (`minmax(0,1fr) 216px 300px`):
- "Pull request"
- six short signal labels (CI, Cop, CS, Rev, Thr, Mrg) with tooltips
- a **D3 log-scale age ruler** from 1h to 3 months, with ticks at 1h, 6h, 1d, 3d, 1w, 2w, 1mo, 3mo

**Lane** = one group, as a card:
- **Header:** collapse chevron, avatar (or initials), name, "N open", a text summary ("3 blocked · 2 waiting · 2 ready · 1 draft") and a thin **stacked bar** of those counts.
- **Lane order:** most blocked first. "Bots" and "No ticket" go last, and Bots is collapsed by default.
- **Row order within a lane:** Blocked → Waiting → Ready (→ Drafts), then by age according to the sort toggle.

**PR row:**
- **Left column:** `repo #number` (mono, muted), title (one line, ellipsis) and blocker badges.
- **Middle column:** six 28×24 status squares, each with a tooltip of the detail ("Required check failed: e2e-android").
- **Right column:** an **age bar** on the shared log scale, coloured by the PR's bucket and hatched for drafts, with the age label ("4d", "9w") at its end.
- Clicking the row selects it, which highlights it with an inset accent bar and fills the drawer.
- Rows are focusable and Enter selects.

**Stack row:**
- A tinted row that replaces the stack's PRs in a lane.
- Shows: chevron, stack icon, `repo · GitHub stack #4964` or `repo · branch-chained`, "Stack of N open PRs · M merged", and badges with counts of blocked / waiting / ready.
- The middle column shows a strip of small coloured pips, one per PR, plus a **Visualize stack** button.
- Expanding it lists the member PRs from top to bottom, with a dark `main` pill row underneath. Members are joined by dependency arrows like a Gantt or scheduler:
  - **Shape:** an SVG overlay draws orthogonal routes with square corners (no curves). Arrows show the merge direction. Each leaves a PR's title, runs down a gutter on the left, and ends in a small filled arrowhead at the title of the PR it merges into. The bottom PR's arrow ends at the `main` pill.
  - **Gutter columns:** a straight chain shares one trunk. Each extra child of a fork gets its own column, 12px further right.
  - **Style:** 1.5px lines in `--edge`. Arrows touching the selected PR are drawn 2px in `--accent`, on top.
  - **Measuring:** measure anchor positions after layout, and again on resize.

### Detail drawer (right side; stacks below the content on narrow screens)

For the selected PR:
- `repo #number · branch`, title, author and age, then the bucket badge plus the blocker badges.
- The six signals, each on its own line as square + name + plain-language detail. CI lists each failing check, linked to its run.
- Reviewers, with avatar and state badge.
- Unresolved threads, with snippet and link.
- **Related PRs**: other PRs with the same Jira key, from any repo.
- **Stack**: the members as small clickable rows, from top to the base branch, with "↳ M merged · main", and a **Visualize stack** button.
- Links: **Open on GitHub ↗** and **XX-12345 in Jira ↗**.

### Mine

The same lanes and rows, with three fixed lanes:
1. **My PRs**
2. **Review requested from me**
3. **Review requested from my team**: collapsed by default, and excluding PRs already in lane 2

No Group-by control.

### Stacks tab

A responsive grid of cards, one per stack. Each card header shows the repo, native or branch-chained, the open and merged counts, the author and an **Open large** button. The body contains the same D3 stack diagram as the dialog, at a smaller scale.

### "Visualize stack" dialog (D3; make this one delightful)

A large modal (about 1000×820, at most 94vw × 90vh) titled `repo · GitHub stack #N`, with a subtitle "5 open, 2 merged · onto main". It contains an SVG diagram:
- **Layout:** `d3.stratify` + `d3.tree` laid out **vertically**, with the base branch as a dark pill (`main`) at the **bottom** and the top of the stack at the top. A fork renders as branches.
- **Open PR nodes:** 340×64 rounded cards with a status-coloured dot, `#4988 · 2w`, the truncated title and the six mini status squares (16px, with tooltips). The selected PR gets an accent outline.
- **Merged entries:** faded, dashed cards labelled "merged", sitting between the base branch and the lowest open PR.
- **Edges:** arrows in **merge direction**, the same rule as the lane connectors. Each runs from a PR card down into the card of the PR it merges into, or into the `main` pill.
  - Use square-cornered step routes (down, across, down) with a small filled arrowhead, not curves.
  - Dashed when a merged entry is involved, and accent-coloured for the selected PR.
  - Label an edge "N behind" in orange under the child when `behindParent > 0`.
  - Legend text: "Arrow = merges into · label = commits behind its target".
- **Next to merge:** a blue pill on every open PR whose parent is the base branch or a merged entry.
- **Motion:** nodes rise 24px and fade in, staggered from the bottom up (about 45ms apart), and edges fade in after them. Respect `prefers-reduced-motion`.
- **Zoom and pan:** `d3.zoom` (0.25–2×). The initial transform fits the stack and anchors the base at the bottom, with a minimum scale of 0.45 for deep stacks (the mock has 5; real ones reach 26).
- Clicking an open node closes the dialog and selects that PR in the drawer.
- A legend at the bottom: Blocked, Waiting for review, Ready, Merged, and "Edge label = commits behind the PR below".

## Avatars

Use a shared `Avatar` component:
- It takes `avatarUrl?`, a name and a size.
- It renders the image round, with initials on a deterministic tinted background as the fallback (while loading, on error or with no URL).
- Use `alt=""` when the name is shown next to it; otherwise use the name as `alt`.

Where avatars appear:
- signed-in user pill in the header
- author lane headers
- team lane header in Mine
- reviewers in the drawer, including the Copilot and CodeScene bot avatars

Repository, ticket and Bots lanes use an icon instead. In the mock data, give most people an `avatarUrl` (for example `https://i.pravatar.cc/64?u=<name>`), and leave one person without one to show the fallback.

## Accessibility

- Real `<button>`s and links.
- `aria-pressed` on the filter chips and `aria-expanded` on collapsibles.
- `role="img"` with an `aria-label` on the stacked bars, pip strips and SVG diagrams.
- Visible focus rings.
- Text contrast at least 4.5:1, including the muted 11–12px labels.

## Structure

- `components/`: `Header`, `Toolbar`, `Lane`, `PrRow`, `StackRow`, `StatusSquares`, `AgeBar`, `AgeRuler`, `Drawer`, `StackDiagram` (shared by the dialog and the Stacks tab), `StackDialog`, `Banner`.
- `lib/`:
  - `status.ts`: signals, blockers, bucket
  - `grouping.ts`: group, sort, filter, stack collapsing
  - `scale.ts`: the shared log age scale, `d3.scaleLog().domain([1, 2160]).clamp(true)`
- `data/`:
  - `types.ts`
  - `api.ts`: the `DashboardApi` interface, with `getSnapshot()`, `refreshNow()` and `setInterval(minutes | 'off')`
  - `mock.ts`
