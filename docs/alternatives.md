# Alternatives research (2026-11-18)

**Question:** does an existing tool make building `pearspective` unnecessary?

**Answer:** no single tool covers it. Build thin: reuse what exists and build only what is missing.

## Comparison

| Tool | Category | Covers | Hosting / cost | Gaps |
|---|---|---|---|---|
| github.com/pulls dashboard (GA Jul 2026) | GitHub | Mine-style inbox (review requested, needs fixes, ready to merge), team-review filter, saved views | Free, built in | No swimlanes or grouping, no per-signal grid, no Jira, no stack view |
| GitHub native stacked PRs (preview Jul 2026) | GitHub | `stack`/`stackEntry` in GraphQL; a stack map in the merge box | Free, preview | Per PR only, no tree view; same-repo stacks only |
| GitHub Projects | GitHub | Manual grouping by custom fields | Free | No live CI or review signals |
| gh-dash | Terminal, OSS | Mine and filter sections; CI and review status | Free, MIT, own token | No swimlanes, stacks or Jira; terminal only |
| Gitify / GitBar | Menubar | Notifications | Free / paid | Notifications only |
| Mergeable | Self-hosted OSS | Query-defined sections, "needs your action" highlighting, Enterprise hosts | Free, MIT, runs in the browser with own token | No stacks or Jira |
| DashGit | Self-hosted OSS | Multi-repo, CI and review status | Free, MIT | No stacks or Jira |
| Ampel | Self-hosted OSS | Merge-readiness traffic light, multi-provider | Free, MIT, Docker | Self-described MVP |
| Graphite | Stacks + SaaS | Inbox, stack view, merge queue | SaaS GitHub App, ~$20–40/user/mo; being acquired by Cursor | Org code goes to a third party; no Jira; no separate Copilot or CodeScene signals |
| Aviator `av`, ghstack, spr, git-town | Stack tooling | Create and update stacks; `av tree` in the terminal | OSS (+ SaaS) | No dashboard |
| LinearB / Swarmia / Jellyfish / Haystack | Engineering-insight SaaS | Work-in-progress PR lists, Jira linking, metrics | ~$10–60/contributor/mo | For managers; needs an org app install; no stacks |

## Closest matches

1. **GitHub's PR dashboard plus native stacks.** It covers most of the **Mine** view. It is missing the org-wide swimlanes, the six-signal grid, the age axis, a stack tree and Jira.
2. **Graphite.** It has the best inbox and stack UI. But it is SaaS with access to org code, it costs per seat, it has no Jira, and its ownership is changing.
3. **Mergeable / gh-dash.** They are local, free and use your own token, and they cover Mine-style sections. They have no stacks, no Jira and no signal grid.

## Jira side

- **CLI:** `ankitpokhrel/jira-cli` supports Server/DC. **Wrap it** rather than building a `gh`-like CLI. Its newer search changes target Cloud, so test it against our DC version first.
- **Auto-transitions on DC:**
  - Built-in DVCS connector with workflow triggers on "PR created/merged", plus Automation for Jira (built into DC 9.0+).
  - Paid alternative: Git Integration for Jira (GitKraken).
  - GitHub for Jira is Cloud-only.
  - The DVCS connector reportedly doesn't support `*.ghe.com` tenants (JSWSERVER-26384).
  - Transitions that aren't valid fail silently.
- **Effect on v2 mismatch detection:** if the triggers can be enabled, mismatches mostly disappear. A mismatch **report** is still useful when a trigger fails silently, or when workflows differ per project.

## Already verified here

- `PullRequest.stack{number size baseRefName entries}` and `stackEntry{position}` exist and are populated in `acme` (field-app stack 4964, size 26). The research agent had listed this as unverified.

## Not verified

- whether the github.com stack map marks the next PR to merge
- official prices for Graphite and the analytics tools (all figures are from third parties)
- whether Ampel and DashGit are still maintained
- whether the DVCS connector works with our GitHub host

## Sources

- https://github.blog/changelog/2026-07-09-new-pull-requests-dashboard-is-now-generally-available
- https://docs.github.com/en/pull-requests/get-started/about-stacked-prs
- https://docs.github.com/en/pull-requests/reference/stacked-pull-requests-rest-and-graphql-apis
- https://github.com/dlvhdr/gh-dash/releases
- https://selfhostyourself.com/services/mergeable
- https://github.com/javiertuya/dashgit
- https://rywalker.com/research/graphite
- https://github.com/ankitpokhrel/jira-cli/releases
- https://jira.atlassian.com/browse/JSWSERVER-26384
- https://confluence.atlassian.com/spaces/ADMINJIRASERVER112/pages/1688897258/Configuring+workflow+triggers
- https://marketplace.atlassian.com/apps/4984/git-integration-for-jira
