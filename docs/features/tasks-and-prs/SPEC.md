---
title: "Tasks and PRs"
code: "WORK"
status: "Ready"
created: "2026-10-19"
updated: "2026-10-19"
---

# Tasks and PRs

## Summary

A Work tab next to History lists your open Tasks from Productive and your open PRs and Review requests from GitHub. Each one is Linked to the others and to the Sessions that worked on it: the Session inferred to have opened a PR, and any Session started on a PR or Task. One click selects or resumes the Session behind a Task or PR, opens the item in the browser, or opens the launcher pre-filled to work on a Task or review a PR. Lookout only reads from Productive and GitHub. It never writes to them. This spec covers the Backlog entries TASKS and PRS, which share the same Links.

## Problem

- **Too many places to look:**
  - What you owe lives in Productive.
  - What's in flight lives in GitHub, and `tb-pr` shows it in its own terminal UI.
  - Which Session did the work lives only in Transcripts.
- **Picking up work is slow:** going back to a task means finding its PR, then the Session that opened it (`tb-session search`), then resuming it. That happens several times a day.
- **Starting is manual too:** starting a Session on a task or a review means copying a URL into the launcher by hand.
- **Measured 2026-10-19:**
  - 9 open Tasks in 2 projects.
  - 13 open PRs of your own, 11 of them drafts.
  - 0 Review requests waiting, but 33 PRs reviewed in the last 30 days.

## Requirements

Built in this order: WORK-3 (PRs) first, then WORK-2 (Tasks), then WORK-4 (Links). The rest comes with whichever needs it first. Criteria tagged `(e2e)` need the World fakes listed under Dependencies.

### WORK-1 Work tab

The right sidebar gets a second tab, Work, next to History.

- [ ] WORK-1.1 With focus not in a text field, `W` opens the right sidebar on Work, or closes it if Work is already showing. `H` does the same for History (HIST-1.1). Both stand down while a modal is open, as `H` does today. (test)
- [ ] WORK-1.2 Which tab is open is remembered across reloads, along with whether the sidebar is open and its width (HIST-1.3). (test)
- [ ] WORK-1.3 Work has two sections, Tasks and PRs. Each shows its count and how old its data is ("updated 2m ago"). (test)
- [ ] WORK-1.4 With Work open, the Session sidebar and the main pane stay fully visible beside it, neither covered nor pushed out of the grid (HIST-1.2). (manual)
- [ ] WORK-1.5 A filter at the top of Work has three options: All (the default), Tasks, and PRs and review requests. Tasks shows only the Tasks section; PRs and review requests shows only the PRs section, with both its groups. The choice is remembered across reloads. (test)
- [ ] WORK-1.6 Switching the filter shows the chosen section's latest data at once, and the switch starts no read: a hidden section is still read on schedule (WORK-8). (e2e)
- [ ] WORK-1.7 With focus in Work, ↑/↓ and j/k move through the rows of the visible sections without acting, and Enter acts like a click on the row (HIST-2.7). (test)
- [ ] WORK-1.8 The tab strip (History, Work) sits in the header row where History's search field is today, lined up with the rest of the grid (SIDE-8), with History's search field and Work's filter below it. (manual)
- [ ] WORK-1.9 The keyboard selection stays on the same item while that item is visible. When a filter change or a read removes it, the selection moves to the first visible row, or to none when Work is empty. (test)
- [ ] WORK-1.10 With Work open, clicking a Session row in the Session sidebar selects it and shows it in the main pane, and the composer takes typed text, `W`, `H`, `O`, `j` and `k` included, without moving Work's selection or switching the tab. (test)
- [ ] WORK-1.11 With Work open, a message sent from the composer reaches the selected Session and its reply shows, as with Work closed. (e2e)

### WORK-2 Tasks

- [ ] WORK-2.1 Tasks lists every Task assigned to the Productive email in Settings, in all projects: any status that isn't closed, in an active project, task list and folder, milestones included. Most recently active first, up to 100. (test)
- [ ] WORK-2.2 Each Task shows its title, project, status and, when set, its due date. A milestone is marked as one. (test)
- [ ] WORK-2.3 A Task with a Linked PR shows the PR's number, state and CI state (WORK-3.2). (test)
- [ ] WORK-2.4 A Task with Linked Sessions shows a Session marker: a live one if any Session is live, otherwise a past one. Clicking the marker, or the row, selects the live Linked Session with the latest activity when any is live; otherwise it resumes the past Linked Session with the latest activity, as History does (HIST-3). Activity is tb-session's `modified_at`; a tie goes to the later-created Session. (e2e)
- [ ] WORK-2.5 Settings has a "Productive email" field. While it's empty, it shows the address from `git config --global user.email` as a suggestion, which is saved only when you save it. Its Behaviour test declares that address with `.gitIdentity()` (TEST-1.5). (e2e)
- [ ] WORK-2.6 Until a Productive email is saved, Tasks shows "Set your Productive email in Settings", with a link to Settings, and runs no query. PRs works as usual. (e2e)
- [ ] WORK-2.7 The Productive email is saved trimmed, otherwise as typed. A value with whitespace inside, without exactly one `@` with text on both sides, or longer than 254 characters is refused with "Enter an email such as name@example.com", and the saved value stays. Saving an empty field clears it, and Tasks goes back to WORK-2.6. (test)
- [ ] WORK-2.8 Saving a different Productive email drops the Tasks list kept for the previous one. While a tab has Work open, it reads Tasks for the new email at once, or as soon as a Tasks read still running for another email ends, whose result is then discarded (WORK-8.3). With Work closed in every tab, that read waits until Work next opens (WORK-8.1). Until the new email's read ends, Tasks shows "Loading", never the previous address's list, and if that read fails, its reason without a list (WORK-7.3). Its Behaviour test declares Tasks per email (TEST-1.5) and holds the previous email's read in flight (TEST-1.6). (e2e)

### WORK-3 PRs

- [ ] WORK-3.1 PRs has two groups, Mine (your open PRs) and Review requests, both in `productiveio/*` repos only, and each sorted most urgent first as `tb-pr`'s own table sorts them: by rotting bucket, critical first, then oldest first, with remaining ties by repo and then number. (test)
- [ ] WORK-3.2 Each PR shows its repo, number, title and age, plus its CI state: passing, failing, running, or "no CI". A PR in Mine also has a state chip: draft, ready or approved. (test)
- [ ] WORK-3.3 "No CI" never looks like passing. A Review request shows "no CI" while `tb-pr` gives it no CI state, and its real CI state once `tb-pr` does (Gap 1). (test)
- [ ] WORK-3.4 A PR shows its Linked Task (title) and its Linked Sessions, and the Session marker and row click behave as in WORK-2.4. (e2e)

### WORK-4 Links

Lookout joins ids that the Building blocks give it. It never extracts a task id from a branch name or a PR body itself.

- [ ] WORK-4.1 A PR is Linked to every Task whose id is in its `task_ids` from `tb-pr` (Gap 1), with that entry's source, "branch" or "PR body". A `tb-pr` without `task_ids` gives no PR → Task Links, and Work says once, in the PRs section, that Task links need a newer `tb-pr`. (test)
- [ ] WORK-4.2 A PR's opener is inferred, from the Sessions that tb-session finds for the PR's full URL: those whose first prompt doesn't contain the URL (WORK-4.7), and whose life spans the PR's creation, created no later than the PR's `created_at` and last active no earlier than it (5 minutes' slack each way). The earliest-created of them is the opener. There's at most one, and a search that was cut off (WORK-4.8) names none. A Session with the same URL but a longer PR number never counts. (test)
- [ ] WORK-4.3 A Session is "started on" a PR when its first prompt contains the PR's full URL, and "started on" a Task when its first prompt contains the Task's URL in any of the forms under Linking, both as WORK-4.7 matches them. A PR or Task can have any number of these. (test)
- [ ] WORK-4.4 A Task is Linked to every Session Linked to one of its PRs, and to the Sessions started on it. (test)
- [ ] WORK-4.5 Hovering a Link says why it exists: "branch", "PR body", "probably opened this PR (the earliest Session that mentions it)", "started on this PR", "started on this Task" or "through PR #<n>". A PR whose search was cut off adds "Links may be incomplete". (test)
- [ ] WORK-4.6 Apart from the opener inference (WORK-4.2), nothing Links a Session: not a later mention of a PR URL or a Task id, not a Session's branch. Those wait for Gap 2. (test)
- [ ] WORK-4.7 A URL is in a first prompt only as a whole URL: it is followed by the end of the text or by a character that is not an ASCII letter, digit, `_` or `-`, and it's compared ignoring ASCII case. So `…/pull/12` is not in `…/pull/123`, and `…/tasks/123` is not in `…/tasks/123abc`, while `…/pull/12)`, `…/pull/12.`, `…/pull/12/files` and `…/pull/12#issuecomment-1` all contain `…/pull/12`. (test)
- [ ] WORK-4.8 Each tb-session search asks for up to 200 Sessions (`--limit 200`), not tb-session's default of the 10 most relevant. When a search returns 200, that item's Links may be incomplete: it gets no opener, and its hover says so (WORK-4.5). (test)
- [ ] WORK-4.9 The Link searches run after every read of Tasks or PRs, and again within 10 s after Fleet's list gains a Session while a tab has Work open. A Session started on a Task or PR that hasn't changed, for example from "Start Session", is Linked without waiting for the item to change. (e2e)

### WORK-5 Actions

- [ ] WORK-5.1 "Start Session" on a Task opens the launcher (LAUNCH-1) with the prompt set to the Task's URL (WORK-6.2) and nothing else. Nothing starts until you press Start, and you can edit the prompt first. (e2e)
- [ ] WORK-5.2 "Review" on a Review request opens the launcher with the prompt `/p-codex:dual-review <PR URL>`, under the same rules as WORK-5.1. (e2e)
- [ ] WORK-5.3 Lookout runs only read commands against Productive and GitHub: `tb-prod query`, `tb-pr list --json` and `tb-pr refresh`. Any other subcommand is refused by the server. (test)

### WORK-6 Open in the browser

- [ ] WORK-6.1 Every Task, PR and Review request row has an "Open in browser" button whose tooltip names it and its shortcut, `O`. (test)
- [ ] WORK-6.2 A Task opens in Fantastic Productive at `https://app.fantastic.productive.io/109-productive/tasks/<task id>`, in a new browser tab. Never the old app at `app.productive.io`. Its Behaviour test checks the URL the new tab asks for, without loading it: the World aborts that request (TEST-1.7). (e2e)
- [ ] WORK-6.3 A PR or Review request opens its GitHub URL, as `tb-pr` gives it, in a new browser tab, checked as in WORK-6.2. (e2e)
- [ ] WORK-6.4 `O`, with focus in Work and not in a text field, and with no modifier, opens the selected row's item exactly as its button does, checked as in WORK-6.2. It doesn't move the selection, select a Session or open the launcher. It stands down while a modal is open. (e2e)

### WORK-7 When a source can't be read

- [ ] WORK-7.1 If `tb-prod` or `tb-pr` isn't installed, its section says so and how to install it (like SIDE-6.1). The other section works as usual. (e2e)
- [ ] WORK-7.2 If it isn't signed in (WORK-7.6), its section shows the command that fixes that: `tb-prod config init` for tb-prod, `gh auth login` for tb-pr. (e2e)
- [ ] WORK-7.3 When a read fails, the section keeps showing the last list it had, marks it old and gives the reason. For Tasks, that's only a list read for the saved email (WORK-2.8). It never presents stale data as current (as in USAGE-2.2). Its Behaviour test turns the fake's answer into a failure after a good read (TEST-1.6), then presses Refresh. (e2e)
- [ ] WORK-7.4 If tb-session can't be read, Tasks and PRs still show, without Session markers, and a note says why. (e2e)
- [ ] WORK-7.5 Lookout keeps, per `tb-pr` column, when it last read that column without a `column_issues` entry. A PR group with an issue in any of its columns (Mine has three, Review requests one) is marked possibly out of date, even though `tb-pr` succeeded and its `fetched_at` is fresh. The mark lists each affected column, in Mine by its state chip, with its reason and its own time: "draft: search returned empty, last confirmed 40m ago", or "not confirmed yet". Columns with the same reason and time share one entry. (test)
- [ ] WORK-7.6 "Not signed in" is recognized, with recorded outputs as tests, from:
  - tb-prod: exit 1 with "No config found" on stderr; a JSON error with `code` `config_error`; or a JSON `api_error` whose `details.status` is 401 (a revoked or expired token);
  - tb-pr: "`gh auth token`" in its error on stderr (gh not signed in, or not installed); "GitHub API error (401)" on stderr; or `column_issues` saying "api error 401" for every PR column.

  A tb-prod `api_error` with status 403 is not "not signed in": it's a failed read whose reason says Productive denied access. Any other failure is a failed read (WORK-7.3). (test)
- [ ] WORK-7.7 A failing `tb-prod`, `tb-pr` or `tb-session` whose output holds token-like text (a `ghp_` or `github_pat_` token, an `Authorization:` header, `token=…`) leaves none of it in the server's log, the `work` event or any API response. Its reason is redacted and cut to one line before it's stored, sent or logged, and its raw stdout and stderr are never logged. (test)

### WORK-8 Refresh

- [ ] WORK-8.1 While any tab has Work open, the server reads Tasks and PRs every 5 minutes, counted from the end of the last read of either kind. Opening Work triggers a read when the data is more than 5 minutes old, and a Tasks read when Tasks hasn't been read for the saved email yet. With Work closed everywhere, nothing is read, not even for a newly saved email (WORK-2.8). (test)
- [ ] WORK-8.2 A Refresh button forces a fresh read: `tb-pr refresh`, then `tb-pr list --json` only if the refresh succeeded, and a Productive read. Once the server accepts a forced read, Refresh is disabled in every tab for 60 s, whether the read succeeds or fails, and its hover says when it's back. (e2e)
- [ ] WORK-8.3 Server-wide, at most one read per source runs at a time. A reason to read (the schedule, Work opening in a tab, a saved Productive email, Refresh) that arrives during a read joins it only when it asks for the same thing: Tasks for the same email, or PRs both forced or both not. Otherwise it waits until that read ends; waiting reasons that ask for the same thing run as one read. A forced read asked for during the 60 s cooldown is refused by the server, not queued. (test)
- [ ] WORK-8.4 When `tb-pr` reports a rate limit ("rate limited" on stderr, or as a `column_issues` reason), the server starts no GitHub read, scheduled or forced, for 5 minutes, or until the reset time `tb-pr` reports when that's later (at most an hour), and Refresh says when it's back. (test)
- [ ] WORK-8.5 When two tabs open Work at the same moment in a fresh World, `tb-pr` runs once and `tb-prod` once per page of Tasks (once for 20 Tasks or fewer). (e2e)

## Non-goals

- **Writing to Productive or GitHub**, in any form: changing a task's status, assigning it, adding a TODO, commenting, approving, merging, re-running CI. Any posting is done by the Session the action starts, and that Session asks for your approval first.
- **One-click starts:** every action goes through the launcher, and you press Start.
- **Other people's work:** Productive tasks assigned to someone else or that you only follow, and review requests sent to a team you're in. `tb-pr` deliberately counts only direct requests.
- **Parsing in Lookout:** Lookout doesn't read task ids out of branches or PR bodies, and doesn't call `gh` itself (0005).
- **Closed tasks and merged or closed pull requests.**
- **Creating Tasks or PRs from Lookout.**
- **Starting a Session in a Worktree:** the agent makes or picks the Worktree itself (LAUNCH Non-goals).
- **Other Productive organizations:** the Task URL uses organization `109-productive`, as `tb-pr` does.
- **Opening Tasks in the old app** (`app.productive.io`).
- **Time tracking, estimates and bookings.**
- **Notifications** when CI fails or a review request arrives.

### Later

Planned, but not in v1:

- **Productive tasks where you're only a TODO assignee.** Review TODOs (`PR: <url>`) are assigned to the reviewer on someone else's task; Review requests already cover those reviews.
- **tb-prod resolving "me"** (Gap 3). Then the Productive email setting goes away.
- **`PR:` TODOs as a PR → Task source.** One `tb-prod` call per Task (9 took 2 s), and the branch already finds every PR such a TODO names.
- **Every Session involved in a piece of work** (Gap 2): Sessions that planned, implemented or reviewed it without its URL in their text or first prompt, work done in Subagents, Sessions that discussed a PR later, and the true opener.
- **Repos outside `productiveio/*`:** a `tb-pr` that takes several owners (`github.owners`), if personal PRs start piling up.
- **Waiting-on-author:** PRs you reviewed that are back with their author.
- **A weaker look for less certain Links.** Every Link explains itself on hover (WORK-4.5).

## UX

```
┌───────────────┬──────────────────────────────────┬─────────────────────────┐
│ / filter  + ⚙ │ header (VIEW)                    │ [History] [Work]   ⟳ [×]│
├───────────────┼──────────────────────────────────┼─────────────────────────┤
│ Sessions      │ main pane (VIEW)                 │ (All)(Tasks)(PRs)       │
│               │                                  │ Tasks · 9 · updated 2m  │
│               │                                  │ ● Fix rounding in rates │
│               │                                  │   Acme · In progress    │
│               │                                  │   #812 draft ✓  [▶] [↗] │
│               │                                  │ ○ Write migration notes │
│               │                                  │   Acme · Not started    │
│               │                                  │                 [▶] [↗] │
│               │                                  │ PRs · 13 · updated 2m   │
│               │                                  │ Mine                    │
│               │                                  │ ● api #812 draft ✓ 2d   │
│               │                                  │   → Fix rounding in …[↗]│
│               │                                  │   web #77 ready ✗ 6d [↗]│
│               │                                  │ Review requests         │
│               │                                  │   web #90 · no CI[▶] [↗]│
├───────────────┼──────────────────────────────────┤                         │
│ usage (USAGE) │ composer and status line (VIEW)  │                         │
└───────────────┴──────────────────────────────────┴─────────────────────────┘
```

- **One grid (SIDE-8):** the tab strip sits in the header row, where History's search field is today. History keeps its search field below the tab strip once there are two tabs. Work's filter sits in the same place.
- **Filter (WORK-1.5):** a three-option segmented control, "All", "Tasks", "PRs and review requests". The mock-up shortens the last one.
- **Markers and buttons** (lucide icons, [0008](../../decisions/0008-lucide-icons-only.md)):
  - a circle with a dot (`CircleDot`): a Linked Session is live;
  - an empty circle (`Circle`): only past Linked Sessions;
  - nothing: no Linked Session.
  - The mock-up uses ● ○ as shorthand, and ✓ ✗ for the CI icons (`CircleCheck`, `CircleX`; `LoaderCircle` while running; `CircleDashed` for "no CI").
  - [▶] is the action button (`Play`): "Start Session" on a Task, "Review" on a Review request. A PR in Mine has none.
  - [↗] is "Open in browser" (`ExternalLink`), on every row. Its tooltip: "Open in Fantastic (O)" on a Task, "Open on GitHub (O)" on a PR.
  - ⟳ is Refresh (`RefreshCw`). While it's cooling down or GitHub is rate limited, it's disabled, and its hover says why and when it's back (WORK-8.2, WORK-8.4).
- **Row clicks (WORK-2.4):**
  - The row selects its live Linked Session with the latest activity, or, with none live, resumes the past one with the latest activity.
  - A row without a Linked Session does nothing; its buttons do.
  - ↑/↓ and j/k move through the rows without acting; Enter acts like a click (HIST-2.7); `O` opens the row in the browser (WORK-6.4).
- **Shortcuts** (none with a modifier, all ignored in a text field or while a modal is open): `W` Work, `H` History, `O` open the selected row in the browser. They join `N` (LAUNCH-1.1), `i` (VIEW-3.6), j/k (SIDE-5.1) and `[`/`]` (VIEW-1.11), and clash with none of them.
- **Empty states:** "No open tasks" and "No open PRs or review requests". Tasks without an email: "Set your Productive email in Settings" (WORK-2.6).
- **Errors** (WORK-7): shown inside the section, or the PR group, they belong to, not in place of the panel. Mine's "possibly out of date" mark names each affected column by its state chip (WORK-7.5).

## Technical approach

### Sources ([0005](../../decisions/0005-building-blocks-live-outside-lookout.md))

- **Tasks: `tb-prod query tasks`**, which always prints JSON:API (`data`, `included`, `meta`). It has no `--json` flag.
  - Filter, as a FilterGroup:
    - `assignee.email eq <email>`
    - `project.status eq 1`
    - `task_list_status eq 1`
    - `folder_status eq 1`
    - `workflow_status_category_id not_eq 3`
  - This is the "open tasks" scope that tb-prod's schema suggests in its `tasks` query hints (`schema.json`), plus the assignee. The hint names the category by its parameter, `workflow_status_category`, which tb-prod's filter check rejects; the filter key it accepts is `workflow_status_category_id`. Every key above is checked against the schema (`filter.rs`, `field_by_filter`); an unknown one, such as `board_status`, fails the whole query with `invalid_filter`. Also `--include project,workflow_status --sort=-last_activity_at`.
  - Fields used:
    - `id`, `attributes.title`, `due_date`, `last_activity_at`, `type_id` (3 is a milestone);
    - `relationships.project` → `included` project `name`;
    - `relationships.workflow_status` → `included` status `name` and `category_id` (1 not started, 2 started).
  - Pages hold 20 rows, with `meta.hasNextPage`. Lookout follows up to 5 pages (100 Tasks), one request each.
  - Measured 2026-10-19: 0.3 s per call (three runs), no cache. 9 open Tasks in 2 projects: 8 started, 1 not started, 1 milestone, none with a due date. Including closed ones there are 129, so no further filter is worth building yet.
  - **Who "me" is:** `tb-prod config init` finds your `person_id` (unless it's given `--org`) and stores it in its config, but no query uses it: there's no "me" in a filter, and `tb-prod prime` prints "Unknown" both when `person_id` isn't set and when the person isn't in its cache yet. The `assignee.email` filter works without it. The email lives in the server's settings file (SIDE-7); the suggestion comes from `git config --global user.email`, read once by the server.
  - **Auth:** a `[productive]` section in toolbox's `secrets.toml` or tb-prod's own config, which `PRODUCTIVE_API_TOKEN`, `PRODUCTIVE_ORG_ID` and `PRODUCTIVE_PERSON_ID` override. Without config it exits 1 with "Config error: No config found. Run `tb-prod config init …`" on stderr. An API error exits 1 with `{code: "api_error", error: "API error (<status>)", details: {status, body}}` on stdout; a revoked or expired token is one with status 401. A 403 means missing permission, which is how tb-prod itself reads it (its cache sync skips a type that answers 403, `generic_cache.rs`), so Lookout doesn't take it as signed out (WORK-7.6). Lookout never reads or passes tokens.
- **Task URLs (WORK-6.2, WORK-5.1):** `https://app.fantastic.productive.io/109-productive/tasks/<task id>`.
  - The open button and the Start Session prompt both use it, never `app.productive.io`: Fantastic is the main app from now on, and Dario wants to get used to it (2026-10-19). A Session reads the task id from it as from the old form.
  - The host is Fantastic's production deploy (`.semaphore/deploy/production.yml` and `apps/web/src/lib/release-stage.ts` in `fantastic-productive`).
  - Every route there sits under `/$workspace`. Only the segment's leading organization id is load-bearing (`/109`, `/109-productive` and `/109-anything` all open organization 109; `lib/workspace.ts`), so the id is required and the slug is for people.
  - `tasks/$id` is one of the router's canonical paths (`CANONICAL_PATHS` and `goRoute` in `router.tsx`): it redirects to the task's own home with its panel open. It mirrors the old app's path, so anything that reads `/tasks/<id>` still finds the id.
  - Fantastic's PR template uses another form, `…/109-productive/home?task=<id>`, which opens the panel over Home. Lookout doesn't build it, but Gap 1 reads it.
- **PRs: `tb-pr list --json`.**
  - It prints `{user, fetched_at, columns: {draft_mine, review_mine, ready_to_merge_mine, waiting_on_me, waiting_on_author, notifications}}`, plus `column_issues` when a column had a problem.
  - Each PR has:
    - `number`, `repo`, `title`, `url`, `author`, `state` (draft, ready, approved), `created_at`, `age_days`, `size`, `rotting`, `comments_count`, `base_branch`;
    - optionally `head_branch`, `check_state` (success, failure, pending), `productive_task_id`, `changes_requested_by` and `has_new_commits_since_my_review`;
    - after Gap 1, `task_ids`.
  - Mine is `draft_mine`, `review_mine` and `ready_to_merge_mine`; the column sets the state chip, as it sets each PR's `state`: `draft_mine` → draft, `review_mine` → ready, `ready_to_merge_mine` → approved (tb-pr's own short label for that column is "ready"; Lookout's chips don't use those labels). Review requests are `waiting_on_me`, built from `user-review-requested:@me`, so team requests are left out. The other columns aren't shown (Later).
  - **Order:** `list --json` prints each column in GitHub's search order; only the text table sorts (`flatten` in `commands/list.rs`). Lookout sorts each group the table's way (WORK-3.1): rotting bucket descending (critical, rotting, stale, warming, fresh), then `age_days` descending, then repo and number.
  - **Cache:** tb-pr's own, at `~/.cache/tb-pr/`. A read within 5 minutes of the last fetch is served from it: measured 0.01 s. Otherwise `list` fetches (3.6 s cold) and saves.
    - When a search fails or comes back empty, `merge_with_previous` puts the previous fetch's column back (the previous fetch is read with a 1-hour TTL), adds a `column_issues` entry such as "search returned empty" or "rate limited", and saves the result with a fresh `fetched_at`. A put-back column is saved again on every fetch, so it can be any age, not at most an hour. A column that really became empty, such as your last Review request being done, keeps coming back the same way. Hence WORK-7.5: a column with an issue is never current, and Lookout tracks per column, not per group, when it last saw it without one.
    - `tb-pr refresh` clears the whole cache, fetches, saves and prints a text summary, not JSON. So Refresh runs `tb-pr refresh` and then `tb-pr list --json`, which reads what refresh just saved. When refresh fails, its cache is already gone, and a `list --json` would start a second cold fetch, so Lookout doesn't run it.
  - **Requests per fetch** (`fetch_board_state` in `core/github.rs`):
    - GitHub search: 4 searches (draft, own non-draft, Review requests, reviewed by you), each 1 request per 100 results, at most 10. Today every search has under 100 results, so a fetch costs 4 search requests. GitHub allows 30 search requests a minute, shared with every other `gh` and tb-pr use on the account.
    - GitHub core: 1 for your login, 1 per 50 unread notifications (at least 1), 1 PR detail per distinct PR, 1 review list per own non-draft PR and per reviewed-by-you hit, 1 commit per reviewed-by-you hit, and 1 check-runs call per own PR. Gap 1 adds 1 check-runs call per Review request. On 2026-10-19 (11 drafts, 2 own non-draft, 0 Review requests, 0 unread notifications, and R reviewed-by-you hits, open PRs by others that you've reviewed: at least 1, since waiting-on-author kept 1) that's 1 + 1 + (13 + R) + (2 + R) + R + 13 = 30 + 3R, out of 5,000 an hour.
    - Rate limits: when GitHub's rate limit refuses the login lookup or a PR's details, reviews or commit, the whole fetch fails with "Error: GitHub API error (403): rate limited — resets at HH:MM:SS UTC …" on stderr (`send_get`), the reset as a UTC time of day without a date. A refused search or notifications page only becomes a `column_issues` reason, which `summarize_fetch_error` cuts to "rate limited", dropping the time. A 429 without GitHub's reset header has no time either.
  - **Scope:** one GitHub org (config `github.org`, default `productiveio`). GitHub's `org:` qualifier doesn't match user-owned repos. All 13 open PRs are in `productiveio`; in the last 30 days 52 PRs were opened there and 6 in personal repos, all already merged.
  - **Auth:** `gh auth token`. Errors print to stderr as "Error: …": without `gh`, "failed to run `gh auth token` …"; signed out, "`gh auth token` failed — run `gh auth login`"; a revoked token, "GitHub API error (401): …", or, with `username_override` set, "api error 401" in every column's `column_issues` and exit 0.
  - **CI:** `check_state` is a roll-up of GitHub check-runs on the head commit, set today only on your own PRs: on 2026-10-19, 9 of 13 (all passing), missing on the ready-to-merge one. Commit statuses aren't read, so a repo that reports CI only that way shows "no CI".
- **Sessions: `tb-session search <query> --all-projects --limit 200 --json`**, one search per PR URL and per Task id.
  - Each result row has `session_id`, `first_prompt`, `created_at`, `modified_at`, `git_branch`, `project_path` and `matched_snippet`. A row is live when Fleet's list has its `session_id` (HIST's live check).
  - Without `--limit`, tb-session returns its configured default, 10 Sessions, ranked by FTS5 relevance (BM25), so neither "earliest" nor "every" would hold. With `--limit 200` Lookout gets every match it has seen in practice (at most 9 for one PR), sorts by `created_at` itself, and treats a full 200 as cut off (WORK-4.8).
  - The query is quoted per word, so a full URL is an FTS5 phrase of whole tokens (`https`, `github`, `com`, owner, repo, `pull`, number): `/pull/12` never matches `/pull/123`. It is a token match, not a literal one: the same tokens with other punctuation between them match too. That's accepted for finding candidates; first prompts, which Lookout has in full except for some older Sessions (Known gaps), are matched literally (WORK-4.7).
  - tb-session indexes the plain text blocks of a parent Transcript: prompts and replies, not tool calls, tool results or Subagent Transcripts. Sidechains and Sessions without a first prompt are left out.
  - Measured: 13 searches took about 1 s in total. When they run: WORK-4.9. Its 10 s for a new Session fits: Lookout reads Fleet's list every 2 s, and each search first re-indexes the Transcripts that changed (`ensure_fresh`), so a new Session's first prompt is found once its Transcript has it.

### Linking

All Links are found on the server by matching ids and URLs Lookout already knows. Extracting ids from free text belongs in the Building blocks (Gaps 1 and 2).

| Link | Rule | Evidence (2026-10-19) | In v1 |
|---|---|---|---|
| PR → Task | Head branch `<prefix>/<id>-…` (tb-pr, Gap 1) | 16 of 72 PRs you opened since 2026-08-19. All 6 open PRs that a Task's `PR:` TODO names follow it, and agree with the TODO. | Yes |
| PR → Task | Task URL in the PR body (tb-pr, Gap 1) | 26 of 72: 6 as `app.productive.io/…/tasks/task/<id>`, 5 as `…/tasks/<id>`, 15 as Fantastic's `…/home?task=<id>`. tb-pr reads none of the 13 open PRs correctly today. | Yes |
| PR → Task | `PR: <url>` TODO on the Task | On 6 of 9 open Tasks, all also found by branch. One `tb-prod` call per Task. | Later |
| Session opened PR (inferred) | Earliest-created Session whose indexed text has the PR's full URL, among those whose first prompt doesn't and whose life spans the PR's creation | See below: right for 12 of 12 PRs where the opener could be checked. | Yes |
| Session started on PR | First prompt contains the PR's full URL | Every other Session the URL search found (13, across 3 PRs) had the URL in its first prompt. | Yes |
| Session started on Task | First prompt contains the Task's URL | 0 today, because Sessions aren't started from a Task URL yet. WORK-5.1 makes one by construction. | Yes |
| Session → Task through text | Task id or URL anywhere in indexed text | 6 of 9 open Tasks have one such Session, and all 6 are the opener of the Task's PR, so this adds nothing. Bare ids also match unrelated numbers. | No |
| Session → PR by number | `tb-session --pr <n>` | Hits PRs with the same number in other repos: 10 and 9 for two of them. | No |
| Session → Task by branch | Session's `git_branch` | 0 of the last 300 indexed Sessions. tb-session keeps the first branch only, Sessions start on `main` in `~/Projects/work`, and the work happens in Worktrees, often in Subagents. | No |

- **How "opened" was checked (WORK-4.2):**
  - Ground truth came from the raw Transcripts, parents and Subagents: the Session whose `gh pr create` tool call returned the PR's URL, with a Subagent's call credited to its parent Session.
  - Of the 13 open PRs, 12 have exactly one such Session, 6 of them through a Subagent. In all 6, the parent's own text repeats the URL, so tb-session finds it.
  - For all 12, the earliest-created Session the URL search finds is that Session (the earliest first mention gives the same answer). 10 PRs have only that one Session.
  - The 13th has no readable `gh pr create` result. The earliest Session the search finds did run `gh pr create`, and the other 8 all have the URL in their first prompt, so the rule picks the likely opener, unverified.
  - Measured with a scratch tb-session index of 1,675 Sessions, built under a temporary HOME, never the real cache.
  - The life-span condition was added after the measurement. It drops Sessions whose recorded life doesn't span the PR's creation. Those times can be stale, so it can drop the true opener too (Known gaps).
- **Why "opened" is only inferred:** 12 of 12 says the rule works for PRs opened the usual way. It doesn't cover these cases, so the hover says "probably" (WORK-4.5):
  - **The URL pasted into an older Session:** a Session started before the PR, still in use (or resumed) when the PR was created, that mentions the URL in a later message is picked over the real opener when it's older. This is the one case where a later mention Links a Session (WORK-4.6). The life-span condition limits it to Sessions active around the PR's creation.
  - **A Subagent's PR whose parent never repeats the URL:** the real opener is invisible to tb-session, so a later Session that mentions the URL can be picked, or none.
  - **A PR opened outside an indexed Session** (in a terminal, on GitHub, or by a Harness tb-session doesn't read): the earliest Session that mentions it and spans its creation is picked, or none.
  - Gap 2 fixes all three with the `gh pr create` result itself.
- **Task Links follow from PR Links (WORK-4.4):** a Task is Linked to whatever is Linked to its PRs, plus Sessions started on it. Measured: 6 of 9 open Tasks have a PR with a Linked opener.
- **Task URL forms** that count in a first prompt (WORK-4.3), for organization 109, digits only, each matched as in WORK-4.7:
  - `https://app.productive.io/<org>/tasks/<id>` and `…/tasks/task/<id>`;
  - `https://app.fantastic.productive.io/<org>/tasks/<id>` and `…/<anything>?task=<id>`.

### Gaps (cli-toolbox PRs, protected `main`)

- **Gap 1, tb-pr (needed for WORK-4.1, and for WORK-3.3 to show CI):** one PR.
  - **The bug:** `extract_task_id` (`crates/tb-pr/src/core/productive.rs`) matches `https://app\.productive\.io/{org_slug}/tasks/(\w+)`. It reads `/tasks/task/<id>` as the id `task`, takes `123abc` as an id, misses the Fantastic host, and doesn't read the branch.
  - **New field** on `Pr` (`core/model.rs`): `task_ids: Vec<TaskRef>`, where `TaskRef { id: String, source: "branch" | "body" }`.
    - Always serialized, `[]` when there are none, so its presence tells Lookout the `tb-pr` is new enough.
    - One entry per (id, source) pair, branch first, then the body's in order of first appearance. The same id can appear twice, once per source.
    - `id` is ASCII digits only.
  - **Patterns,** for Rust's `regex` crate, which has no lookahead or lookbehind. `[0-9]` instead of `\d`, which also matches non-ASCII digits there. An id ends with an explicit terminator, a character that can't continue an id, or the end of the text; `captures_iter` consumes that character, which no following URL needs.
    - **Branch,** on `head_branch`: `^[a-z]+/([0-9]{5,})(?:-|$)`, as in `feature/12345678-short-name`.
    - **Body,** where `{org}` is `regex::escape` of the leading digits of `productive_org_slug` (`109`):
      - task path, old app or Fantastic: `https://app\.(?:fantastic\.)?productive\.io/{org}(?:-[A-Za-z0-9-]*)?/tasks/(?:task/)?([0-9]+)(?:[^A-Za-z0-9_-]|$)`;
      - Fantastic query, in two steps, since a single pattern can't say "the first `task` parameter" without lookaround (a lazy one skips an invalid first value and takes a later one):
        1. `https://app\.fantastic\.productive\.io/{org}(?:-[A-Za-z0-9-]*)?/[^\s?#),|<>"'\[\]]*\?([^\s#),|<>"'\[\]]*)` captures the URL's query, up to whitespace, one of `#),|<>"'[]`, or the end of the text. The path before the `?` stops at the same characters, so neither runs on into a URL written right after it (`…?task=111,https://…`);
        2. the code splits that query on `&` and takes the first parameter named exactly `task` (its text before the first `=`, or all of it without one). Only that parameter counts: the URL gives an id when its value, after the `=`, matches `^([0-9]+)(?:[^A-Za-z0-9_-]|$)`, and none otherwise, even when a later `task=` is valid.
    - **Order and duplicates:** the two body patterns' matches are taken in the order they start in the body. A URL that both match (`…/tasks/12345?task=678`) counts once, with the path's id. The same id from either pattern gives one body entry.
    - URLs for another organization don't count: after `/{org}` comes `-` or `/`, so `/1090-…` doesn't match `109`.
  - **`productive_task_id`** keeps its name: the first body id, now from the fixed patterns, so digits only. Its old tests expect alphanumeric ids (`abc123xyz`, `one`, `zzz`); they're rewritten with digit ids, and `abc123xyz` now gives none. The TUI and `show` keep using it.
  - **Cache:** the board is cached under a new key, `board:state:v2` (`BOARD_KEY` in `core/cache.rs`), so a board saved by an older tb-pr, which has no `task_ids`, is neither served nor put back by `merge_with_previous`. Without the new key, serde's default would read it as `task_ids: []` for up to an hour and longer through put-back columns, telling Lookout "new enough, no Links".
  - **CI for Review requests:** pass `r_wait_me` to `collect_commit_keys_for` for the check-runs fetch, and assign `pr.check_state` in the `waiting_on_me` map, as the draft map does. Fetching alone isn't enough: `build_pr` sets `check_state` to `None` and today only the own-PR paths assign it. Update the `check_state` doc comment on `Pr`. That's one more check-runs call per Review request.
  - **Tests** the PR must have:
    - Body, giving `12345`: `https://app.productive.io/109-productive/tasks/12345`; `…/tasks/task/12345` (never `task`); `https://app.fantastic.productive.io/109-productive/tasks/12345`; `…/109-productive/home?task=12345`; `…/home?view=board&task=12345#comments`; `https://app.productive.io/109/tasks/12345`.
    - Terminators, each giving `12345`: `(…/tasks/12345)`, `…/tasks/12345.`, `…/tasks/12345,`, `…/tasks/12345/`, `…/tasks/12345?x=1`, `…/tasks/12345#c`, `…/home?task=12345&x=1`, `(…/home?task=12345)`, `…/home?task=12345.`, followed by a newline, and at the very end of the body.
    - Body, giving nothing: `…/tasks/123abc`, `…/tasks/12345_x`, `…/tasks/12345-x`, `…/tasks/task`, `…/tasks/`, `…/home?task=123abc`, `…/home?subtask=12345`, `…/home?mytask=12345`, `https://app.productive.io/42-other/tasks/12345`, `…/1090-x/tasks/12345`, `https://app.fantastic.productive.io/1090-x/home?task=12345`, `https://app.productive.io.example.com/109/tasks/12345`, and `…/tasks/١٢٣٤٥` (Arabic-Indic digits).
    - First `task` parameter: `?task=12&task=34` gives `12`; `?subtask=1&task=12345` gives `12345`; `?task=123abc&task=456`, `?task=&task=456` and `?task&task=456` give nothing.
    - Several: two Task URLs give both ids in order; the same id twice in the body gives one entry.
    - Adjacent, with only a comma between them: `https://app.fantastic.productive.io/109-productive/home?task=111,https://app.fantastic.productive.io/109-productive/home?task=222` and `https://app.fantastic.productive.io/109-productive/tasks/111,https://app.fantastic.productive.io/109-productive/home?task=222` each give `111`, then `222`.
    - Across both body patterns: `…/home?task=222` before `…/tasks/111` gives `222`, then `111`; `…/tasks/111` before `…/home?task=222` gives `111`, then `222`; `…/tasks/12345` and `…/home?task=12345` in one body give one entry; `…/tasks/12345?task=678` gives `12345` only.
    - Branch: `feature/12345678-short-name` and `fix/12345678` give `12345678`; `feature/1234-x`, `feature/12345678abc`, `feature/x-12345678`, `Feature/12345678-x` and `main` give nothing.
    - Combined: branch and body with the same id give two entries, branch first; neither gives `task_ids: []` in `list --json`.
    - CI: a `waiting_on_me` PR whose head commit has check-runs has `check_state` in the serialized `list --json` output.
    - Cache: a board saved under the old key isn't used by `list` or by `merge_with_previous`.
- **Gap 2, tb-session (Later):** a refs index of the PR URLs, Productive task URLs and branch names seen anywhere in a Transcript (tool calls and results, and Subagent Transcripts), credited to the parent Session, with `tb-session refs --json`. It would replace the per-item searches, mark the true opener from the `gh pr create` result, and find every Session involved in the work. The Library idea (LIB in the Backlog) wants the same mining.
- **Gap 3, tb-prod (Later):** a way to say "me" in a query, so Lookout doesn't need an email setting: `--assignee me`, or a filter value that resolves to the configured `person_id`.

### Lookout's side

- **One `WorkMonitor` on the server,** shaped like `UsageMonitor`:
  - one read per source in flight at a time, server-wide; it polls only while a tab watches;
  - a scheduled, opening or forced read runs `tb-prod` and `tb-pr` in parallel, a saved email reads Tasks only, and each then runs the Link searches (WORK-4.9);
  - results go out as a `work` event on the existing event stream, only when something changed, and the snapshot carries the latest;
  - it keeps, per `tb-pr` column (`draft_mine`, `review_mine`, `ready_to_merge_mine`, `waiting_on_me`), when it last read that column without a `column_issues` entry, in memory, so a restart starts at "not confirmed yet". A group shows its own columns' times (WORK-7.5).
  - Timeouts: tb-prod 10 s per page, tb-pr 20 s (a cold fetch is several seconds), tb-session 20 s.
- **Reads, cooldown and coalescing (WORK-8):**
  - Every reason to read (the 5-minute schedule, Work opening in a tab, a saved email, Refresh in any tab) goes through `WorkMonitor`, which runs one read per source at a time. A saved email is a reason only while a tab has Work open; otherwise its read comes when Work next opens (WORK-2.8, WORK-8.1).
  - A reason joins the read in flight only when it asks for the same thing, that is, when it would run the same commands:
    - Tasks: the same email. tb-prod has no cache, so a forced Tasks read is the same `tb-prod query` and joins one running for that email.
    - PRs: both forced or both not. A forced read runs `tb-pr refresh` first, so it never joins a plain `list --json` read, which tb-pr may serve from its cache. A plain read that arrives during a forced one waits for it, and then costs only a `list --json` served from the cache the refresh just saved. When the refresh failed, it had already cleared that cache (`commands/refresh.rs`), so the waiting plain read fetches.
  - Any other reason waits until the read in flight ends. Waiting reasons run in the order they arrived, those asking for the same thing as one read; for Tasks, only the newest saved email waits.
  - Saving a different email drops the kept Tasks list at once, so a failed read for the new email shows its reason without a list (WORK-7.3). When a Tasks read ends, its result is used only if its email is still the saved one. Otherwise it's discarded, and Tasks stays "Loading" until the saved email's read ends (WORK-2.8).
  - The schedule counts 5 minutes from the end of the last read, scheduled or forced, so a Refresh never has a scheduled read right behind it. A scheduled `tb-pr list --json` lands just past tb-pr's own 5-minute cache, so it fetches about once per 5 minutes.
  - A forced read starts a 60 s server-wide cooldown when the server accepts it, whether it runs at once or waits, and whatever its result. During it the server refuses another forced read, and every tab gets the time it's back in the snapshot.
  - A rate limit from tb-pr stops GitHub reads, scheduled and forced (WORK-8.4):
    - with a reset time on stderr (Sources), Lookout takes the moment with that UTC time of day nearest to now, and waits until it, but at least 5 minutes and at most an hour, GitHub's core window;
    - without one, it waits 5 minutes. That outlasts GitHub's 1-minute search window, where a `column_issues` "rate limited" mostly comes from, but not an hourly core limit: if one still holds then, the next GitHub read hits it again and starts a new wait, with the reset time when tb-pr prints one.
  - Budget: GitHub fetches from Lookout are at most two a minute: a Refresh's, plus a plain read's that fetched just before it or waited behind a Refresh that failed. Otherwise one per 5 minutes. At today's volumes, a fetch is 4 search requests and 30 + 3R core ones (Sources), so at most 8 of the 30 search requests a minute. Core requests are 12 × (30 + 3R) = 360 + 36R an hour on the schedule. Pressing Refresh every minute for a whole hour would be 60 × (30 + 3R) = 1,800 + 180R, which passes the 5,000 an hour once R reaches 18, before any other `gh` or tb-pr use on the account; GitHub then refuses, and the rate-limit wait above holds every GitHub read until its reset. A Productive read is 1 to 5 requests, under the same cooldown.
- **Binaries:** `LOOKOUT_TB_PROD_BIN` and `LOOKOUT_TB_PR_BIN`, then `PATH`, then `~/.local/bin`, like tb-session. Each runs through `server/exec.ts` with the cleaned environment.
- **Read-only by construction (WORK-5.3):** the server builds argv only from an allowlist (`tb-prod query`, `tb-pr list --json`, `tb-pr refresh`). There's no endpoint that takes a subcommand from the browser.
- **Errors (WORK-7):**
  - `WorkMonitor` catches every failure of its commands and turns it into a reason before anything else sees it: ANSI escapes stripped, redacted with `server/sanitize.ts`, one line, bounded (as USAGE does).
  - It never rethrows a `RunError` and never logs one. `server/app.ts` logs uncaught request errors whole (`console.error('lookout: request failed', err)`), and a `RunError` carries the command's stdout and stderr. So the Refresh endpoint answers with the sanitized reason only.
  - "Not signed in" is recognized as in WORK-7.6. Its tests use recorded outputs of each case, plus one with a fake token on stdout and on stderr (WORK-7.7).
- **Settings:** `productiveEmail: string | null` in `shared/settings.ts`, default `null`, written by the client, parsed as WORK-2.7. The parser rejects unknown keys, so the field has to be added there. The `git config` suggestion isn't stored; the server sends it with the settings as `productiveEmailSuggestion`, or `null` when git has none.
- **Actions (WORK-5)** use the launcher's existing pre-fill (`setDraft` + `openLauncher` in `App.tsx`).
  - The start directory is the launcher's last one, `~/Projects/work` by default.
  - Prompts, both editable before Start:
    - Task: the Task's URL (WORK-6.2), nothing else.
    - Review request: `/p-codex:dual-review <PR URL>`.
- **Open in browser (WORK-6):** a plain link with `target="_blank"` and `rel="noopener noreferrer"`; the `O` key clicks the selected row's link. The server builds the Task URL from the id; the PR URL is `tb-pr`'s `url`, accepted only when it starts with `https://github.com/`.
- **Right sidebar:** today it's History only, with History-specific layout state (`web/src/lib/history.ts`). It needs a generic container with an active-tab field, which HIST's Non-goals already allowed for. Work's filter is stored next to the active tab.

### Dependencies

- **Gap 1** (tb-pr) for WORK-4.1 and the CI half of WORK-3.3.
- **World fakes** (TEST) for the `(e2e)` criteria:
  - **fake `tb-prod` and `tb-pr`**, which a World may provide next to `claude`, `codex`, `tb-jev` and `curl` (TEST-1.2 and TEST-1.5, since 2026-10-19), for every `(e2e)` criterion here but WORK-1.11 and WORK-2.5. WORK-7.1 declares them absent. They aren't built yet, and must be before WORK's first `(e2e)` criterion is ticked:
    - **fake `tb-prod`**: answers `query tasks` with the Tasks declared for the email in its filter, as JSON:API pages, or with a declared failure (no config, an `api_error` with status 401 or 403, a timeout). It logs each argv and fails the test on any other subcommand.
    - **fake `tb-pr`**: answers `list --json` with the declared board (columns, `column_issues`, with or without `task_ids`) and `refresh` with a declared exit code, or with a declared failure (`gh auth token`, 401, rate limited with or without a reset time, a timeout). It logs each argv and fails the test on any other subcommand.
    - Like `tb-jev`, they are leaves Lookout only maps, and they never touch the network or a real account (TEST Non-goals).
    - A test can change their answer mid-test or hold a call in flight (TEST-1.6), for WORK-2.8 and WORK-7.3.
  - **Fake Harnesses** (TEST-1.4) for the criteria that select, resume or start a Session: WORK-1.11, WORK-2.4, WORK-3.4 and WORK-4.9.
  - **A git identity** in the World's `~/.gitconfig` (`.gitIdentity()`, TEST-1.5), for WORK-2.5.
  - **Browser requests outside the World's Lookout origin aborted and recorded** (TEST-1.7), for WORK-6.2 to 6.4: a new tab's URL is checked without loading GitHub or Fantastic.
  - None of these is built yet.

### Known gaps

- **The opener is inferred** and can be wrong, in the three cases under Linking. The hover says "probably", and Gap 2 fixes it.
- **Put-back PR columns:** a `tb-pr` column that really became empty keeps being restored from the old cache, flagged "search returned empty". Lookout shows it as possibly out of date (WORK-7.5) but can't tell it from a GitHub outage. A small tb-pr fix for this is planned, separate from Gap 1.
- **Stale Session times can hide the opener:** tb-session takes a Claude Code Session's `created_at` and `modified_at` from Claude Code's `sessions-index.json` when that has them, before the Transcript's own times (`index/builder.rs`). When that index lags the Transcript, for example after the Session was resumed, the true opener's last activity can look older than the PR, and the life-span condition (WORK-4.2) drops it. The PR then gets another Session as its opener, or none. The hover's "probably" covers it, and Gap 2 fixes it with the `gh pr create` result.
- **Cut first prompts in older Sessions:** tb-session prefers the `firstPrompt` in Claude Code's `sessions-index.json` to the Transcript's own (`index/builder.rs`), and Claude Code cut that at 200 characters plus "…" (33 of the 210 entries on this Mac). "…" ends a URL under WORK-4.7, so a URL cut inside its number reads as a shorter one, and one past the cut isn't seen: such a Session can be "started on" the wrong PR or Task, miss the one it was started on, or count as an opener candidate (WORK-4.2). Those index files haven't been written since 2026-03, so only Sessions from before then are affected.
- **Token matching in tb-session:** a Session that has the PR's URL tokens with other punctuation between them counts as mentioning it. That's rare, and harmless for "started on", which checks the first prompt literally.

### Key decisions

- **Work is a right-sidebar tab next to History, on `W`**: the Sessions stay visible on the left, so a click on a Task or PR selects its Session there; a section on the left would crowd the list used most, and a page would hide the Session you're in.
- **All open Tasks assigned to you, all projects, milestones included**: 9 Tasks is short enough that project filters aren't worth building; tasks where you're only a TODO assignee wait, since Review requests already cover those reviews.
- **"Me" is an email in Settings**: no tb-prod query can say "me" even when `person_id` is configured, and the email filter works today without a cli-toolbox change; the setting goes once tb-prod can say "me" (Gap 3).
- **Gap 1 before Links, no stopgap in Lookout**: parsing belongs in tb-pr (0005), and tb-pr's regex is wrong today anyway, so a Lookout copy would only hide the bug.
- **v1 Links a PR to the Session that opened it and to Sessions started on it**: both were right in every case checked (12 of 12 openers; 13 of 13 other Sessions found had the URL in their first prompt), while everything else involved needs Gap 2.
- **The opener is labelled "probably"**: the rule can't see a pasted URL's context or a Subagent's PR, and a confident wrong Link costs more than an honest guess.
- **Refresh every 5 minutes while Work is open, Refresh at most once a minute, server-wide**: it matches tb-pr's cache TTL; a per-tab limit would let several tabs spend GitHub's 30 search requests a minute.
- **Actions open the launcher, and you press Start**: anything that writes is done by a Session you start yourself, and its skills ask before posting.
- **Review starts `/p-codex:dual-review <PR URL>`**: two independent reviewers is the review you want by default; you can edit it in the launcher.
- **A Task's prompt is just its URL, with no extra wording**: the Session reads the Task itself, and you add anything else in the launcher.
- **Tasks open in Fantastic, at `/<org>/tasks/<id>`**: Fantastic is the app you use; its canonical task path lands on the task's own home and mirrors the old app's path, so the same URL works as the Session prompt.
- **`O` opens in the browser**: it's free, next to `i` and the other unmodified keys, and "o for open" is what GitHub and Gmail use; Enter stays "act on the row" as in History.
- **Each section shows its own setup problem and fix**: hiding a section would make "no tasks" and "not set up" look the same.
- **`productiveio/*` only**: all 13 open PRs are there, tb-pr searches one org, and personal repos never link to Productive tasks.
- **Two PR groups, Mine with a state chip, and Review requests**: waiting-on-author is useful but rarely urgent.
- **"No CI" on Review requests until Gap 1**: calling `gh` from Lookout would put GitHub logic in Lookout, against 0005.
- **One feature, WORK, built PRs → Tasks → Links, with a filter**: the panel, the poller and the Links are shared, and one code keeps the criteria in one place; the filter lets you look at one half at a time.
- **Links by id, no fuzzy matching on titles**: a wrong Link costs more than a missing one.

## Changelog

- 2026-10-19: Created from Backlog entries TASKS and PRS, with data measured from tb-prod, tb-pr, tb-session, Fleet and recent Transcripts. Draft with 12 open questions.
- 2026-10-19: Grilled with Dario; all 12 questions answered and folded in. Added WORK-1.5 to WORK-1.7 (filter, keys), WORK-2.5 and WORK-2.6 (Productive email), WORK-6 (open in the browser: Tasks in Fantastic, PRs on GitHub, `O`). Links rewritten: tb-pr's `task_ids` (Gap 1, now specified) for PR → Task, and "opened" and "started on" for Sessions, measured against the Transcripts; text mentions and the 3-Task cap dropped. Review prompt is `/p-codex:dual-review`; a Task's prompt is its URL. Old WORK-6 and WORK-7 renumbered to WORK-7 and WORK-8. Corrected the PR-body count to 26 of 72 (Fantastic's `home?task=` form was missed). Added the Later list. Ready.
- 2026-10-19: First review, checked against tb-prod, tb-pr, tb-session and Lookout's source. Tasks filter `board_status` (rejected by tb-prod's schema) replaced with `folder_status`. Gap 1 patterns rewritten for Rust's `regex` (no lookaround, ASCII digits, explicit terminators), with its test list, a new cache key and the `waiting_on_me` `check_state` assignment. The opener is labelled inferred, limited to Sessions alive at the PR's creation, with its failure cases under Linking and Known gaps. tb-session searches use `--limit 200` and also run when a Session starts (WORK-4.8, WORK-4.9), and first prompts are matched as whole URLs (WORK-4.7). tb-pr's put-back columns are marked (WORK-7.5). "Not signed in" covers expired tokens (WORK-7.6). Errors are redacted before logging (WORK-7.7). Reads are coalesced, with a server-wide cooldown and a rate-limit back-off sized against tb-pr's requests per fetch (WORK-8.2 to WORK-8.5). Added the email setting's rules (WORK-2.7, WORK-2.8), the sort, Session choice and selection rules (WORK-3.1, WORK-2.4, WORK-1.9), and the tab strip's layout as its own criterion (WORK-1.8). Retagged WORK-1.1 `(test)`, and WORK-1.6, 2.5, 2.6, 6.2 to 6.4 and 7.1 to 7.4 `(e2e)`, which need World fakes for tb-prod and tb-pr (Dependencies). Corrected the facts about tb-prod's `person_id`, the cache's age limit, `list --json` order and `refresh` output.
- 2026-10-19: Second review, checked against tb-pr, tb-prod and tb-session's source. A read joins one in flight only when it asks for the same thing: a new email's read waits for the old one, whose result is discarded, and a forced Refresh never joins a plain PR read (WORK-2.8, WORK-8.2, WORK-8.3). The GitHub budget is recounted with R and the measured 11 drafts and 2 non-drafts: 30 + 3R core requests per fetch, so an hour of Refresh every minute passes 5,000 once R reaches 18; a rate limit waits for tb-pr's reset time when it prints one, else 5 minutes (WORK-8.4). Gap 1 takes the first `task` query parameter in code after the regex, with tests for an invalid first value and for path and query URLs mixed or repeated. Staleness is kept per `tb-pr` column, and Mine's mark lists each affected column (WORK-7.5). A Productive 403 is a failed read, not "not signed in" (WORK-7.6). WORK-1.4 now covers layout only; WORK-1.10 `(test)` and WORK-1.11 `(e2e)` cover using the Session sidebar and the composer with Work open. The opener's life-span condition no longer claims it can't drop a true opener, and stale Session times are a Known gap. Fake `tb-prod` and `tb-pr` are TEST's now (TEST-1.2), and Dependencies says which `(e2e)` criteria need them and which need Fake Harnesses. The put-back column gets a planned tb-pr fix of its own.
- 2026-10-19: Third review, checked against the World's code and tb-pr, tb-prod and tb-session's source. WORK-6.2 to 6.4's Behaviour tests check the new tab's URL without loading it, since a World now aborts and records every browser request outside its Lookout origin (TEST-1.7). WORK-2.5, 2.8 and 7.3 name the World features they use: `.gitIdentity()` and Tasks per email (TEST-1.5), and a fake's answer changed or held in flight mid-test (TEST-1.6). Saving a different email drops the kept Tasks list, and with Work closed in every tab its read waits until Work opens (WORK-2.8, WORK-7.3, WORK-8.1). A new Session's Link searches run within 10 s, not 30 s (WORK-4.9). `tb-prod` runs once per page (WORK-8.5). Gap 1's query capture, and the path before it, also stop at `,|<>"'[]`, with tests for adjacent URLs and for another organization's query URL. The budget says at most two GitHub fetches a minute. Mine's chips are mapped from the columns; Non-goals and Later say "tasks" for what isn't a Task; cut first prompts in older Sessions are a Known gap.
