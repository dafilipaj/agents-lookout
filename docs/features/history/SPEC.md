---
title: History
code: HIST
status: In Progress
created: 2026-10-16
updated: 2026-10-17
---

# History

## Summary

Search past Sessions of both Harnesses by what was said in them, and click one to resume it. It resumes in its own Session host, so it's Controllable and sends telemetry like any Session Lookout starts. History lives in a right sidebar, so the Session sidebar on the left stays visible.

## Problem

Finding last week's Session means remembering its directory and running `claude --resume`, or `tb-session` (Claude only). Codex history isn't searchable at all. A Session resumed in a plain terminal can't be controlled from Lookout.

## Requirements

### HIST-1 Right sidebar

- [x] HIST-1.1 A right sidebar, opened and closed with a button at the top right or `H` (when focus isn't in a text field), holds History as its only panel: no tab strip until a second panel exists, named "History sidebar" with a "History" heading. Opening it focuses the search box. (manual)
- [x] HIST-1.2 The Session sidebar on the left and the main pane stay visible and usable while it's open. (manual)
- [x] HIST-1.3 Whether it's open, and its width, are remembered across reloads. (test)

### HIST-2 Find past Sessions

- [x] HIST-2.1 With an empty query, past Sessions are listed most recent first, and more load as you scroll. (test)
- [x] HIST-2.2 Typing searches the full text of prompts and replies across all projects. Results show within 1 s, best match first. (test)
- [x] HIST-2.3 Each result shows the title or summary, Harness, repo, branch, when it was last active, and the matching snippet. A result that's live right now is marked as live. (test)
- [x] HIST-2.4 Claude Code and Codex Sessions both appear, once tb-session reads Codex (see Technical approach). (test)
- [x] HIST-2.5 Headless Sessions are hidden by default. A toggle shows them. (test)
- [x] HIST-2.6 Subagent Sessions and Sessions without a single prompt never appear. (test)
- [x] HIST-2.7 ↑/↓ and j/k move through the results without resuming anything; Enter acts like a click. (manual)
- [x] HIST-2.8 Claude Code and Codex filter buttons, each showing its Harness's logo, sit next to the headless toggle. Both are on by default; either can be switched off, but never both at once. The choice is remembered across reloads. (test)

### HIST-3 Click to resume

- [x] HIST-3.1 Clicking a past Session that can be resumed starts it again in its own Session host, in the directory it originally started in. It appears in the Session sidebar as "Starting…", selected at once, then as a live Session that takes over the selection while the "Starting…" row is still selected (as in LAUNCH-4.2). (test)
- [x] HIST-3.2 Clicking a Session that's live right now selects it; a second process is never started. (test)
- [x] HIST-3.3 Clicking a Session that can't be resumed, because its start directory no longer exists, opens it in the main pane read-only: its latest messages, and a note on why it can't be resumed. (test)
- [ ] HIST-3.4 A resumed Session behaves like one LAUNCH started: the 15 s failure (LAUNCH-4.5) and telemetry (LAUNCH-5) apply. (manual)

## Non-goals

- Deleting, renaming, exporting or tagging past Sessions.
- Forking a Session (`--fork-session`), or resuming with a new first prompt (once it's live, use the composer, VIEW-3).
- Recreating a removed Worktree so that a Session can be resumed.
- Semantic or AI search.
- Grouping or a scope switch (Orca's Workspace / Project / All); everything is searched.
- Other tabs in the right sidebar; it's built so PORTS can become one later.
- Other Hosts, and the pi Harness.

## UX

```
┌───────────────┬──────────────────────────────────┬──────────────────────┐
│ / filter  + ⚙ │ header (VIEW)                    │ ⟲ [ search…     ] [×]│
├───────────────┼──────────────────────────────────┼──────────────────────┤
│ Sessions      │ main pane (VIEW)                 │ ☐ Show headless [✳][◎]│
│               │                                  │ ● fix-deal-rates live│
│               │                                  │   work · main · 2h   │
│               │                                  │ ○ kg-hook-review     │
│               │                                  │   Codex · work · 3d  │
│               │                                  │   "…the hook fires…" │
│               │                                  │ ⊘ pr641-review       │
│               │                                  │   folder gone · 9d   │
├───────────────┼──────────────────────────────────┤                      │
│ usage (USAGE) │ composer and status line (VIEW)  │                      │
└───────────────┴──────────────────────────────────┴──────────────────────┘
```

- One grid (SIDE-8): the search field sits in the shell's header row, mirroring the Filter bar on the left, with ⟲ (a history icon) before it and Close (×) after it, so its bottom line continues the Filter bar's and the main header's. The list runs on below the dock line to the bottom.
- No visible "History" title or tab while History is the only panel: the panel keeps its accessible name ("History sidebar") and a visually hidden "History" heading. The tab strip comes back with a second panel (PORTS).
- Closed, the right sidebar is a narrow rail with the History button in its header cell, so the top line runs across it too.
- A past Session opened read-only (HIST-3.3) is laid out like an ended one: a one-line header, its chat, and in the dock row the note on why it can't be resumed with its start directory and branch under it, where a live Session's composer and status line go.

- [✳][◎]: the Claude Code and Codex filter buttons (HIST-2.8), drawn with the same Harness logos as the Session sidebar. A switched-off one is greyed out; the last one on can't be switched off.
- Markers (lucide icons, [0008](../../decisions/0008-lucide-icons-only.md)): a circle with a dot (`CircleDot`) for live (click selects it), an empty circle for resumable (click resumes it), a slashed circle for can't be resumed (click opens it read-only). The mock-up above uses ● ○ ⊘ as shorthand.
- Empty states: "No past Sessions", and "Nothing matches" with the query.
- Errors: tb-session missing shows how to install it, like SIDE-6.1.

## Technical approach

- **Search and list** ([0005](../../decisions/0005-building-blocks-live-outside-lookout.md)):
  - Commands: `tb-session search <query> --all-projects --json` and `tb-session list --all-projects --json`.
  - Results carry `session_id`, `summary`, `first_prompt`, `project_path`, `git_branch`, `created_at`, `modified_at`, `message_count`, `matched_snippet` and `matched_role`.
  - Speed: measured at 0.14 s across all projects on 2026-10-16.
  - Lookout asks for 50 a page and keeps at most 50 rows of any answer, before it reads a row or checks a directory.
- **Gap 1: tb-session reads Claude Code only** (cli-toolbox PR, protected `main`).
  - It needs:
    - a scanner and parser for Codex (`~/.codex/sessions/**/rollout-*.jsonl`);
    - a `harness` field, with a `--harness` filter;
    - a flag for Headless Sessions, with a filter.
  - Built as pluggable Transcript sources, one per Harness vendor. Claude Code is the first source and Codex the second. Another vendor's agent is one new source, with no changes to the index, search or the `--json` shape.
  - HIST can ship before Gap 1 closes: Codex rows appear once the PR merges, with no change in Lookout.
  - Built and reviewed 2026-10-16 (tb-session 0.3.0, branch `feature/tb-session-sources`, PR not yet open). What the 0.3.0 contract means for HIST:
    - Rows carry `harness` and `headless`. `headless` is `true`, `false` or `null`; `null` means unknown, for Sessions indexed by 0.2 whose Transcript is gone. The default view uses `--headless exclude`, which keeps `null` rows.
    - A row whose Transcript was deleted stays in the index with `transcript_missing: true`. It can't be resumed.
    - An empty `project_path` is left out of the JSON.
- **Read-only latest messages (HIST-3.3):** `tb-session show <id> --harness <h> --tail 20 --json`. They're shown with VIEW's chat styles.
  - Always pass `--harness`: the same full id can exist under two Harnesses, and without it `show` returns `ambiguous_session_id`.
  - Errors exit 1 with `{error: "ambiguous_session_id" | "session_not_found", message, candidates?}`.
  - `messages_source` is `"transcript"` or `"index"`. With `"index"` the Transcript is gone and the messages come from the search index; say so in the note under the messages (the dock row, SIDE-8).
  - tb-session 0.2 has no `--tail`: its `show` gives the first 20 messages, with `total_messages`. Lookout calls them the latest only with 0.3; with 0.2 the note says they're the first ones (of how many) and that 0.2 can't show the latest, or that they're all of them when there are no more.
- **Gap 2: resuming in the fork** ([0006](../../decisions/0006-run-a-fork-of-fleet.md)).
  - Command: `fleet spawn --resume <session_id> --harness <h> --dir <project_path> --backend tmux --json`.
  - Fleet already builds the resume commands for `fleet restore` (`claude --resume <id>`, `codex resume <id>`). `spawn` needs to expose them for any `session_id`.
  - It goes through a login shell like every start ([0002](../../decisions/0002-start-sessions-through-a-login-shell.md)).
  - Lookout tracks the "Starting…" row through the same path as LAUNCH.
- **Live check:** a `session_id` present in Fleet's current list is live (HIST-3.2).
  - The tab marks results live from the Session list it already has; on a click the server reads a fresh `fleet list` before resuming, and Fleet's `session_live` is the backstop for a race.
  - Before that, Lookout's own resumes: one of the same Harness and id that's still "Starting…", or failed and not dismissed, is returned as it is and never spawned again, however long it has waited (a resume stuck at Claude Code's trust prompt never registers with Fleet). The check and the new row happen in one synchronous step, so concurrent clicks start one process. A dismissed row no longer blocks a new resume.
  - Fleet's `session_starting` (a resume of that id from elsewhere, not registered yet) is handled like `session_live`: never retried. Lookout keeps its "Starting…" row, tied to the `session_id`, so the tab selects the Session once Fleet reports it.
  - That row has no Session host of its own, so it has no terminal lines to show. If Fleet still hasn't reported it after 15 s, the failure says it's being started elsewhere (waiting at a trust prompt, say) instead. Fleet's contract is unchanged.
- **Resume request:** the browser sends only `{sessionId, harness}` (token and `Origin` checked, as LAUNCH's start). The server reads the Session again with `tb-session show <id> --harness <h> --tail 1 --json`, so the directory comes from tb-session, never from the browser. A session id is ASCII letters, digits and `-` and never starts with `-`.
  - The answer is `started` (with the launch), `live` (the Session to select) or `blocked` (with why). `blocked` covers a Session that became unresumable after it was listed, its start directory deleted say: the tab opens it read-only (HIST-3.3) instead of showing an error.
  - A directory deleted after that check but before the spawn: Fleet answers `dir_missing`, which Lookout keeps as its own kind and answers `blocked: 'folder-gone'`, read-only like the rest.
- **Shared spawn path:** LAUNCH and HIST both run `fleet spawn … --json` and follow the start the same way (the "Starting…" row, the 15 s failure, the cleaned environment). A resume is reported by its Session host or by its `session_id`.
  - Fleet's Session host names (`core::tmux::sanitize_name`) have no length limit of their own; one from a directory basename can be 255 characters plus a `-<n>` suffix. Lookout accepts up to 512.
- **tb-session 0.2** (checked against the real 0.2.0 with cli-toolbox's synthetic fixtures; the fake follows it):
  - Rows without `harness` are Claude Code and without `headless` are `null`; when it refuses `--headless`, `--harness` or `--tail`, the call is made again without them.
  - Its `list` rows have no `first_prompt` (its `search` and `show` rows do), and it lists empty Sessions; it leaves out subagent ones. A `list` row without `first_prompt` is shown when its `message_count` is above 0, so no row needs a `show`. Its title is its `summary`, else "Untitled Session" and the id's first 8 characters.
  - `message_count` also counts assistant-only and empty (tool-result) messages, so with 0.2 a Session without a prompt can still appear in the list, until tb-session 0.3.0 is installed. A click checks it: the resume (HIST-3.1) and the read-only open (HIST-3.3) read its `show`, and one without `first_prompt` answers "This Session has no prompt." (422) instead of resuming or opening.
  - Lookout also drops rows it marks headless, subagent rows and rows without a prompt itself.
- **Harness filter (HIST-2.8):** with one Harness switched off, the server passes tb-session 0.3.0's `--harness <h>` to `list` and `search`; with both on, no flag. tb-session 0.2.0 has no `--harness`: once it refuses the flag (as for `--headless`), the server filters the rows itself, and a row without `harness` counts as Claude Code, so Codex alone shows nothing there. Rows are filtered by Harness on the server either way, so a tb-session that ignores the flag can't leak rows.
  - The choice is kept in this browser (`localStorage`, like HIST-1.3's layout); a stored value with both off, or one that can't be read, is both.
- **Paging:** each page belongs to the query and toggles it answers (headless and Harness). After any of them changes, the list doesn't page until the new first page has arrived, so an older request's next page can never land after it.
  - A page can come back empty, or short, once rows are filtered (the newest 50 all empty Sessions, say), with more to come. A list that shows nothing or doesn't fill the panel can't be scrolled, so it fetches the next page itself, for the same query and toggle only, at most 5 pages in a row. Then a "Load more" button takes over; a click or a scroll starts a new count.
- **Enter:** opens the highlighted result only from the search box or the result list; on Close History or the toggle it's theirs.
- **Binary:** `LOOKOUT_TB_SESSION_BIN`, then `PATH`, then `~/.local/bin`, like Fleet's.
- **Read-only view:** at `/h/<harness>/<session_id>`, so a reload keeps it. "repo" in a result is its start directory's name.
- **Can it be resumed?** Its `project_path` exists and it isn't live.
- **Measured 2026-10-16** (last 300 Sessions, 3 weeks):
  - 150 started in `~/Projects/work`.
  - 37 started in a Worktree, 30 of which are gone.
  - About 60 were headless eval runs.

### Key decisions

- **A right sidebar, like Orca's**: the Session sidebar stays visible at all times, and the right side can hold more panels later (PORTS).
- **Click resumes**: resuming is the point of History. A Session that can't be resumed opens read-only instead, so a click is never a dead end.
- **Keyboard moves don't resume**: browsing with ↑/↓ or j/k mustn't start Sessions; only a click or Enter does.
- **Resume in the original start directory**: Claude Code files a Transcript under the directory a Session started in, and resuming from anywhere else fails.
- **Never two processes on one Session**: a live Session is selected, not resumed again.
- **Search lives in tb-session, not the Fleet fork**: tb-session already has the index, search and `--json`. Only Codex is missing, and that work is shared under productiveio.

## Open questions

None.

## Changelog

- 2026-10-16: Created.
- 2026-10-16: Grilled:
  - History lives in a right sidebar (Orca-style).
  - Search is built on tb-session, with Codex support to add there.
  - A click resumes; a Session that can't be resumed opens read-only with its latest messages.
  - Headless Sessions are behind a toggle.
  - Sessions whose start directory is gone can't be resumed.
  - Ready.
- 2026-10-16: Technical approach updated with the reviewed tb-session 0.3.0 contract (`headless` can be `null`, `messages_source`, pass `--harness` to `show`).
- 2026-10-17: In Progress. Built against tb-session 0.3.0 (0.2 still works) and the Fleet fork's `spawn --resume` contract through a fake `fleet`; LAUNCH moved to `spawn --json` so both share one spawn path. Technical approach notes the live check, the resume request, tb-session 0.2 and the read-only URL. HIST-3.4 waits for the real fork: the 15 s failure and the cleaned environment are tested, telemetry isn't seen yet.
- 2026-10-17: Review round 1. Technical approach: Lookout never spawns a resume it already has under way, and handles Fleet's `session_starting`; a Session that can't be resumed after all opens read-only; tb-session 0.2's `list` rows (no `first_prompt`) and its first-20 preview; at most 50 rows; paging tied to its query; Enter only from the search box or the list; long Session host names.
- 2026-10-17: Review round 2. Technical approach: an empty or short filtered page fetches the next ones itself (at most 5, then "Load more"); with tb-session 0.2 a listed Session without a prompt is refused on a click, not filtered from the list, until 0.3.0 is installed; a `session_starting` resume that times out says it's being started elsewhere; Fleet's `dir_missing` at spawn opens the Session read-only.
- 2026-10-17: Added HIST-2.8, Claude Code and Codex filter buttons next to the headless toggle (tb-session 0.3.0's `--harness`, filtered on the server for 0.2.0). Non-goals no longer rule out filters other than the headless toggle; semantic search stays out.
- 2026-10-17: UX for one grid (SIDE-8): the search field moves into the header row beside Close, with a history icon; the visible title goes, the accessible name and a hidden heading stay; the closed rail and the list's run to the bottom are drawn; a read-only past Session puts its note and where it ran in the dock row.
- 2026-10-17: Review of one grid: HIST-1.1 says History is the sidebar's only panel, without a tab strip, instead of "has a History tab"; the Technical approach puts the index-source note under the messages, in the dock row.
- 2026-10-17: HIST-3.1 amended with LAUNCH-4.2: a resume selects its "Starting…" row at once, and the live Session takes over only while that row is still selected.
- 2026-10-17: HIST-3.1: the resume request carries the tab's launch id, so the "Starting…" row is selected the moment you click (before tb-session and `fleet spawn` answer), and a late answer never pulls you back from where you moved meanwhile (LAUNCH Technical approach).
- 2026-10-17: Result markers are lucide icons (a circle with a dot, an empty circle and a slashed circle) instead of ● ○ ⊘, per [0008](../../decisions/0008-lucide-icons-only.md).
