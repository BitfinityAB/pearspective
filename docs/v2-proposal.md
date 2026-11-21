# Pearspective — v2 proposal

Ideas deliberately left out of v1 (see `design.md`). None of these is decided; each one lists the questions to settle first.

## 1. Desktop notifications

Use browser notifications, triggered by the change detection the poller already does (`updatedAt` / `headRefOid` / check state per PR).

Candidate events:
- CI on one of my PRs went red, or went green
- my PR got approved, or got changes requested
- I or my team was requested as a reviewer
- my PR became mergeable
- my PR got a new conflict

To decide:
- Which events are worth an interruption? Each event type needs its own on/off toggle.
- Bundle events, so a burst becomes one notification?
- Should anything notify while the tab is closed? That would conflict with v1's rule of polling only while a tab is visible.

## 2. Raise the repo cap

v1 caps the selection at 10 repos. That is for readability, not cost: the measured budget is about 200 of 5,000 points/hour for 10 repos.

To decide:
- Benchmark refresh time and API points at 15 and 20 repos.
- Does the swimlane UI need collapsed-by-default lanes at that scale?

## 3. Where it lives

Decided: a public repository (`BitfinityAB/pearspective`), still run locally by each user with their own `gh` login. A hosted multi-user version would need a GitHub App or a service token instead of the personal `gh` token, so it would be a separate design.

## 4. Jira: a CLI plus ticket/PR status mismatches

**Problem:** Jira statuses drift from what is happening in GitHub. Examples:
- A PR is open, but its ticket is still *In progress*.
- The PR was merged, but the ticket is still *Ready for review*.
- The ticket is *In review*, but it has no open PR.

Today these drifts are found by hand.

### 4a. A `jira` command-line tool, in the spirit of `gh`

- **Read commands first:** `jira issue view XX-12345`, `jira issue list --jql …`, `jira sprint current`, plus `--json` output so the dashboard server can shell out to it, the same way it uses `gh`.
- **Target:** the self-hosted Jira Server / Data Center (`jira.example.com`), authenticated with a personal access token stored in the OS keychain, as `gh` does.
- **Build or adopt?** Look at existing open-source CLIs (for example `jira-cli`, which supports Server/DC) before building one. A thin wrapper that adds `--json` and our status mapping may be enough.
- **Write commands later, behind explicit confirmation:** transitions and comments. For example, `jira issue move XX-12345 "In review"`.

### 4b. Show Jira on the dashboard

- The server already extracts the Jira key from the PR title or branch (v1, Group by Ticket). v2 would add the ticket's **status, assignee and type** for those keys, fetched in batches (one JQL `key in (…)` query per refresh) and cached.
- **Overview:** a seventh signal square, **Jira**, which is green when the status matches the PR's state and red on a mismatch. It also adds a "Ticket status mismatch" blocker-style badge (informational, not a merge blocker).
- **Group by Ticket lanes:** the lane header shows the ticket's status pill next to the key, so you can see the ticket's status beside all of its PRs across repos.
- **A new "Tickets" view or filter:** only mismatches, grouped by ticket. Each one shows the expected status vs the actual status, and links to the ticket and to its PRs.
- **The drawer** shows the ticket summary, its status, the expected status and why.

### 4c. Mismatch rules

These come from a configurable mapping, because each Jira workflow names its statuses differently:

| PR state (all PRs for the ticket) | Expected ticket status | Mismatch example |
|---|---|---|
| no PR yet | To do / In progress | *In review* with no PR |
| any PR open as draft | In progress | *To do* |
| any PR open, ready for review | In review | *In progress* |
| all PRs merged | Ready for test / Done | *Ready for review*, *In progress* |
| all PRs closed unmerged | (flag for a human) | anything other than *Won't do* |

A ticket can have several PRs (backend + frontend + deployment), so the rule looks at **all** PRs that share its key. The least-finished PR decides the expected status.

To decide:
- The real workflow statuses per project. Read them from Jira's workflow API, or keep a hand-written mapping in `config.json`?
- PRs merged to `release/*` vs `main`: does a release-branch merge count as "merged" for status purposes?
- Tickets with no PR whose status implies one: should they be included? That needs a JQL scan of the board's active sprint, not just keys found in PRs.
- Should a mismatch only be flagged after some delay (for example, merged more than 1 hour ago), so normal lag isn't flagged?
- Should the dashboard ever **fix** a status (one click to transition), or stay strictly read-only?

## 5. Themes

v1 has one look with a light and a dark mode. v2 would add selectable themes, starting with a **Terminal** theme based on a Lovable design exploration. Terminal is **dark only**:

- **Palette:** near-black background with a green tint, one neon-green accent for the active tab, the selected row's left edge and links, and the same red, amber and green status colours, slightly more saturated.
- **Type:** a monospace font (JetBrains Mono) everywhere, with uppercase, letter-spaced labels for tabs, chips, column headers, section headings and badges.
- **Shape:** small corner radii, flat filled badges, thin borders, and no shadows.
- **Layout:** unchanged. A theme changes how things look, never what is shown or where.

The pear-green brand colour suits the Terminal accent, so the logo needs no variant.

How it could work:
- **Two independent settings.** *Theme* (Default, Terminal, …) and *mode* (system, light, dark). A theme supplies a dark palette, a light palette, or both. A dark-only theme forces dark.
- **Everything visual becomes a token.** `tokens.css` already holds the colours. Fonts, radii, label case and letter spacing still sit in `app.css` and would move to tokens, so a theme is just a block of overrides under `:root[data-style="terminal"]`.
- **The D3 stack diagrams** already take their colours from the tokens. Their corner radii and font sizes are set in code (`StackDiagram.tsx`) and would need to read tokens too.
- **The picker** goes in the settings panel and labels dark-only themes, e.g. "Terminal (dark only)". While such a theme is active, the header's mode toggle is disabled, with a tooltip saying why. The header keeps only the mode toggle.

To decide:
- Store the theme per browser in `localStorage`, like the mode today, or in `config.json`, like pins?
- Contrast: neon green on near-black must still meet WCAG AA for text, and the status squares must stay distinguishable for colour-blind users (they already carry ✓ ! ✕ glyphs).
- Should users be able to add their own themes, for example a CSS file of token overrides next to `config.json`?
- The Lovable screenshot used real names, so keep it out of the repo and recreate the theme in `docs/mockup/` with the mockup's made-up data.

## 6. Local database (SQLite)

**Problem:** on a cold start (server just started) the page is empty and says "Loading pull requests… the first load can take a minute", because everything lives in memory and the first full refresh (about 36 s for ~280 PRs) has to finish first.

**Idea:** keep the latest state in a local SQLite database and serve it straight away on start, marked as old, while the first refresh runs:
- On start, the server builds a snapshot from the database and publishes it with `stale: true` and its original `fetchedAt`.
- The header shows "Showing data from <timestamp>, updating…" until the first refresh of this run completes, then the normal "Updated …" text.
- After each successful refresh (and ticket sync) the server writes the changes. A failed refresh never overwrites good data.
- The poller's caches (full PR details, tickets, learned status categories, not-a-ticket keys) are warmed from the same database, so the first refresh only fetches what changed instead of everything.
- Stored data does not expire: whatever was last fetched is shown, with its timestamp.

Decided:
- **A proper relational schema, not a JSON blob**, so other programs and backends can read and write the same database, and the schema can later move to another engine (for example PostgreSQL). It follows the provider-neutral model in `shared/types.ts`, not GitHub's or Jira's field names.
- **SQLite now; history and trends are v3.** v2 stores the current state only. The schema should make it easy for v3 to add history tables next to it.
- **The location is configurable:** a new `databasePath` setting in `config.json`, defaulting to `pearspective.db` in the Pearspective folder (gitignored). Pointing it outside the repo folder (for example the OS's app-data directory) keeps your org's PR and ticket data out of the checkout.
- **One database file for all orgs and repo selections.** Changing the org or the repositories in `config.json` reuses the same file; rows carry their org (an `org` column next to `repo`), and the snapshot shown on start is filtered to the current selection.
- **PRs that drop out are deleted, for now.** When a PR leaves the selection (its repository was deselected, it is no longer in a Mine search, or it was closed longer ago than `closedLookbackDays`), its row and its checks, reviews, threads and review requests are removed. Keeping them for history is a v3 decision.
- **Write only what changed.** The poller already knows which PRs it re-fetched; only those rows (and their checks, reviews, threads and review requests) are upserted, PRs that dropped out are deleted, and tickets are written when the ticket sync returns them.
- **Access through an ORM: Drizzle ORM** on better-sqlite3. The schema is defined in TypeScript, migrations come from `drizzle-kit`, and Drizzle also supports PostgreSQL, so a later move is a driver and schema-type change rather than a rewrite. (Kysely was considered: it is a type-safe query builder, not an ORM. Prisma was considered: heavier, with its own query engine and code generation.)

Schema sketch (v2, current state only):

| Table | Holds |
|---|---|
| `schema_version` | One row with the schema version; migrations run in order on start. |
| `meta` | Key/value: `fetched_at`, `org`, `host`, last successful ticket sync. |
| `people` | `login` (key), `name`, `kind` (human / ai-review / code-analysis / bot), `avatar_url`. |
| `change_requests` | One row per PR: `id` (key), `provider`, `org`, `repo`, `number`, `title`, `url`, `author_login`, `created_at`, `updated_at`, `closed_at`, `state` (open / merged / closed), `head_sha`, `head_ref`, `base_ref`, `is_draft`, `merge_state`, `review_decision`, `comment_count`, native stack number/size/position/base. Open and recently closed PRs share this table. |
| `checks` | `change_request_id`, `name`, `state`, `required`, `url`. |
| `reviews` | `change_request_id`, `author_login`, `state`, `submitted_at`. |
| `review_threads` | `change_request_id`, `resolved`, `author_login`, `snippet`, `url`. |
| `review_requests` | `change_request_id`, `type` (person / team), `login` or `team_slug`. |
| `views` | Which PRs are in Overview and in each Mine section (`change_request_id`, `view`), so the board can be rebuilt exactly. |
| `tickets` | `key` (key), `summary`, `type`, `status_name`, `assignee_login`, `mine` (true / false / unknown), `url`, `fetched_at`. |
| `status_categories` | `status_name` → `category` (todo / inProgress / done), learned from the tracker. |
| `not_tickets` | Keys the tracker said do not exist. |

Portability rules: ISO-8601 text for timestamps, `0`/`1` integers for booleans, text enums with `CHECK` constraints, no SQLite-only features, so the same DDL works on PostgreSQL with type names swapped. Mismatch verdicts are not stored; they are recomputed from the tables, as today.

Library: Node's built-in `node:sqlite` is unflagged since Node 22.13 but still not stable ("Stability 1.2 – Release candidate" in the current docs). Stable options today:
- **better-sqlite3**: the widely used, actively maintained driver, synchronous (a good fit for a single local server), with prebuilt binaries for the major platforms. **Recommended.**
- **@libsql/client** (Turso's SQLite fork): maintained, async, supports a local `file:` database. A reasonable alternative, but it adds a fork of SQLite.
- node-sqlite3 is archived (July 2026) and should not be used.

All database access goes through one storage module (for example `server/storage/`) built on Drizzle, so the rest of the server never sees SQL or the driver.
