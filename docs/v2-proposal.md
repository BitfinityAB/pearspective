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

Should it stay a local folder, become a personal repo, or become a `acme` repo? A hosted multi-user version would need a GitHub App or a service token instead of the personal `gh` token, so it would be a separate design.

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
- The real workflow statuses per project (PB and others). Read them from Jira's workflow API, or keep a hand-written mapping in `config.json`?
- PRs merged to `release/*` vs `main`: does a release-branch merge count as "merged" for status purposes?
- Tickets with no PR whose status implies one: should they be included? That needs a JQL scan of the board's active sprint, not just keys found in PRs.
- Should a mismatch only be flagged after some delay (for example, merged more than 1 hour ago), so normal lag isn't flagged?
- Should the dashboard ever **fix** a status (one click to transition), or stay strictly read-only?
