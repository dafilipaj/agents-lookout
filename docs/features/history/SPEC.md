---
title: History
code: HIST
status: In Progress
created: 2026-10-16
updated: 2026-10-30
---

# History

## Summary

Search past Sessions of both Harnesses by what was said in them, select one to see what it was, and resume it with a button. It resumes in its own Session host, so it's Controllable and sends telemetry like any Session Lookout starts. History lives in a right sidebar, so the Session sidebar on the left stays visible.

## Problem

Finding last week's Session means remembering its directory and running `claude --resume`, or `tb-session` (Claude only). Codex history isn't searchable at all. A Session resumed in a plain terminal can't be controlled from Lookout.

Once History is in Lookout, a stray click on a result resumes a past Session, which starts a Session host, and there's no way to see what a Session was without resuming it (Dario's testing, 2026-10-23).

## Requirements

### HIST-1 Right sidebar

- [x] HIST-1.1 A right sidebar, opened and closed with a button at the top right or `H` (when focus isn't in a text field), holds History as a tab, next to Work (WORK-1). `H` opens it on History, switches to History from another tab, and closes it when History is already showing. It's named "Right sidebar", and its tab strip in the header row stands in for a heading: History's tab names History's panel, with no other "History" heading. Opening it on History focuses the search box. (test)
- [x] HIST-1.2 The Session sidebar on the left and the main pane stay visible and usable while it's open. (manual)
- [x] HIST-1.3 Whether it's open, and its width, are remembered across reloads. (test)

### HIST-2 Find past Sessions

- [x] HIST-2.1 With an empty query, past Sessions are listed most recent first, and more load as you scroll. (test)
- [x] HIST-2.2 Typing searches the full text of prompts and replies across all projects. Results show within 1 s, best match first. (test)
- [x] HIST-2.3 Each result shows the title or summary, Harness, repo, branch, when it was last active, and the matching snippet. A result that's live right now is marked as live. (test)
- [x] HIST-2.4 Claude Code and Codex Sessions both appear, once tb-session reads Codex (see Technical approach). (test)
- [x] HIST-2.5 Headless Sessions are hidden by default. A toggle shows them. (test)
- [x] HIST-2.6 Subagent Sessions and Sessions without a single prompt never appear. (test)
- [x] HIST-2.7 ↑/↓ and j/k move through the results without resuming, opening or selecting any Session, and collapse the expanded result as they leave it. Enter on a selected result that isn't expanded expands it; on an expanded one it runs its button (HIST-3.5). (test)
- [x] HIST-2.8 Claude Code and Codex filter buttons, each showing its Harness's logo, sit next to the headless toggle. Both are on by default; either can be switched off, but never both at once. The choice is remembered across reloads. (test)
- [x] HIST-2.9 An expanded result shows, besides its title, Harness, repo, branch and age: its start directory in full (the home directory as `~`), the date and time it was last active (not its Harness or branch again: its row shows them; no model: tb-session doesn't give one); its first prompt and its last message, each its first three lines, with who said the last one; and whether it can be resumed and, if not, why (BLOCK_REASON's words, HIST-3.3). A live result says it's live. (test)
- [x] HIST-2.10 The first prompt and the last message are read when a result is expanded, not for every result: one `tb-session show` for that Session (Technical approach, Expanded result). While it's read, the result shows "Loading…"; a failed read shows an error line and the buttons still work. With tb-session 0.2, which can't tail, the last message is left out and the first prompt only is shown. (test)
- [x] HIST-2.11 One result is expanded at a time; expanding another collapses the first. Esc, with focus in History's list or search box, collapses the expanded result and leaves it selected. An expanded result grows in the panel and the list scrolls to keep it in view; the main pane keeps showing the current Session. (test)

### HIST-3 Resume from a result

- [x] HIST-3.1 The "Resume" button on an expanded result that can be resumed, or Enter on it, starts the Session again in its own Session host, in the directory it originally started in. It appears in the Session sidebar as "Starting…", selected at once, then as a live Session that takes over the selection while the "Starting…" row is still selected (as in LAUNCH-4.2). (test)
- [x] HIST-3.2 The "Open" button on an expanded result that's live right now, or Enter on it, selects that Session; a second process is never started. (test)
- [x] HIST-3.3 The "Show" button on an expanded result that can't be resumed, because its start directory no longer exists, or Enter on it, opens it in the main pane read-only: its latest messages, and a note on why it can't be resumed. (test)
- [ ] HIST-3.4 A resumed Session behaves like one LAUNCH started: the 15 s failure (LAUNCH-4.5), Claude Code's Trust prompt in the Starting view (LAUNCH-6) and telemetry (LAUNCH-5) apply. (manual)
- [x] HIST-3.5 A click on a result, or Enter on a selected one that isn't expanded, selects and expands it and does nothing else: it never resumes, opens or shows a Session, and starts no process. A Session is resumed, opened or shown only by the expanded result's one button ("Resume", "Open" or "Show", by what the result is) or by Enter on the expanded result. (test)
- [x] HIST-3.6 The button is labelled with its word and has a 20 px icon and a 28 px tall target. While a resume runs, the result stays expanded and says "Resuming…"; a failure shows under the button as an error Alert, as it does now. (manual)

## Non-goals

- Deleting, renaming, exporting or tagging past Sessions. Adding one to a Topic (TOPIC-2.1) is a record in Lookout's own store, not a change to the Session.
- Forking a Session (`--fork-session`), or resuming with a new first prompt (once it's live, use the composer, VIEW-3).
- Recreating a removed Worktree so that a Session can be resumed.
- Semantic or AI search.
- Grouping or a scope switch (Orca's Workspace / Project / All); everything is searched.
- Other tabs in the right sidebar: Work is WORK's (WORK-1), and PORTS can become one later.
- Other Hosts, and the pi Harness.

## UX

```
┌───────────────┬──────────────────────────────────┬──────────────────────┐
│ / filter  + ⚙ │ header (VIEW)                    │ [History] [Work]  [×]│
├───────────────┼──────────────────────────────────┼──────────────────────┤
│ Sessions      │ main pane (VIEW)                 │ [ search…          ] │
│               │                                  │ ☐ Show headless [✳][◎]│
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

- An expanded result (HIST-2.9, HIST-2.11) grows in place; the rest of the list moves down:

```
│ ○ kg-hook-review                       │  ← selected, expanded
│   ◎ Codex · work · main · 3d           │
│   ~/Projects/work                      │
│   Oct 20, 16:12 · can resume           │
│   First   "Why does the hook skip the  │
│            merge commit? Look at…"     │
│   Last    Codex: "The hook only runs…" │
│   [↺ Resume]                           │
│ ⊘ pr641-review                         │
```

  - A live result says "live" and its button is "Open"; one that can't be resumed says why ("The directory it started in no longer exists.") and its button is "Show" (read-only). No model is shown: tb-session gives none (Key decisions). The button is a word beside a 20 px icon in a 28 px tall target; `↺` stands for lucide's `History`.
  - Selecting is the click or Enter, and does nothing more (HIST-3.5); ↑/↓ and j/k move without expanding (HIST-2.7); Esc collapses (HIST-2.11).
- One grid (SIDE-8): the tab strip (History, Work, each with its icon) sits in the shell's header row, mirroring the Filter bar on the left, with Close (×) after it, so its bottom line continues the Filter bar's and the main header's. History's search field is the first thing below it (WORK-1.8). The list runs on below the dock line to the bottom.
- The sidebar is named "Right sidebar". Its tab strip is its heading: History's tab names History's panel, and there's no other "History" title or heading.
- `H` opens the sidebar on History, switches to History when Work is showing, and closes the sidebar when History is showing; `W` does the same for Work (WORK-1.1).
- Closed, the right sidebar is a narrow rail with a button per tab: History in its header cell, so the top line runs across it too, and Work under it.
- A past Session opened read-only (HIST-3.3) is laid out like an ended one: a one-line header, its chat, and in the dock row the note on why it can't be resumed with its start directory and branch under it, where a live Session's composer and status line go.

- [✳][◎]: the Claude Code and Codex filter buttons (HIST-2.8), drawn with the same Harness logos as the Session sidebar, monochrome like every list's (DS-3.1). A switched-off one is greyed out; the last one on can't be switched off.
- Search hits in a snippet are marked with the design system's `highlight` token (DS-3.4), a neutral tint, not Needs you's amber: a match isn't something to act on.
- Markers, the design system's Session marker (DS-5.1, DS-5.2; lucide icons and the Status shapes, [0008](../../decisions/0008-lucide-icons-only.md)): a live result shows its Session's Status marker (SIDE-3.2), from the Session sidebar's list and following its Status, with the "live" chip beside the title (click selects it); a resumable one lucide's `History` in `muted-foreground`; one that can't be resumed a slashed circle, `CircleSlash`. A click on the row only expands it (HIST-3.5): "Resume", "Open" or "Show" do the rest. The marker is hidden from screen readers: the row's words say it (DS-5.5). The mock-up above uses ● ○ ⊘ as shorthand.
- Loading, empty and errors are the design system's: "Loading…" and "Loading more…" a `Loading` (DS-6.3), "No past Sessions" and "Nothing matches" an `EmptyState` (DS-8.1), a result that couldn't be opened, a search that failed ("Couldn't search History", with its reason) and tb-session missing error Alerts, the last with its command in a `CommandBlock` (DS-4, DS-8.2). The Harness toggles are `sm` icon buttons (DS-7).
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
  - Built and reviewed 2026-10-16 (tb-session 0.3.0, branch `feature/tb-session-sources`), released 2026-10-20 as `tb-session-v0.3.0`, which also indexes Pi Sessions (`harness: "pi"`). What the 0.3.0 contract means for HIST:
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
  - Before that, Lookout's own resumes: one of the same Harness and id that's still "Starting…", or failed and not dismissed, is returned as it is and never spawned again, however long it has waited (a resume waiting at Claude Code's Trust prompt hasn't registered with Fleet; its row shows the prompt and answers it, LAUNCH-6). The check and the new row happen in one synchronous step, so concurrent clicks start one process. A dismissed or cancelled row no longer blocks a new resume.
  - Fleet's `session_starting` (a resume of that id from elsewhere, not registered yet) is handled like `session_live`: never retried. Lookout keeps its "Starting…" row, tied to the `session_id`, so the tab selects the Session once Fleet reports it.
  - With the fork's `trust` commit, `session_starting` names the Session host the other resume runs in, when it's a tmux pane that still exists ([contract C7](../../contracts/fleet-trust.md)). Lookout then follows that Session host as its own: it reads its Trust prompt and offers the same buttons (LAUNCH-6.11), and a failure after 15 s shows its terminal's last lines. That covers a resume started from Fleet's CLI, or by Lookout before a restart.
  - With no Session host named (an iTerm resume, or its pane gone), the row has no terminal lines to show, and if Fleet still hasn't reported it after 15 s, the failure says it's being started in another terminal app (waiting at its Trust prompt, say), and to answer it there. That terminal is one you can see, unlike a Session host.
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
- **Enter:** acts on the highlighted result only from the search box or the result list; on Close History or the toggle it's theirs. On a result that isn't expanded it expands it; on an expanded one it runs the button (HIST-3.5).
- **Expanded result** (HIST-2.9, HIST-2.10). What a result already has: `title`, `harness`, `projectPath`, `repo`, `branch`, `lastActiveAt`, `blocked`, `headless`, `snippet`, and whether it's live from the Session list. What it hasn't:
  - **first prompt:** tb-session's `search` and `show` rows carry `first_prompt`, and 0.3's `list` rows do; `toRow` reads it but keeps it only inside `title`, cut to one line of 300 characters (`MAX_TITLE`). The change keeps it as `firstPrompt` on `HistoryItem`, the first three lines (not collapsed to one line), at most 600 characters. A 0.2 `list` row has none, so the expanded read fills it from `show`.
  - **last message:** the Session's last prompt or reply, from `show <id> --tail 1 --json` through `GET /api/history/<harness>/<id>/peek` (`History.peek`), which answers `{ firstPrompt, last: { role, text }, tailed }`; HIST-3.3's read-only route reads 20 whole messages, more than an expand needs. tb-session's previews hold only non-empty prompts and replies, so the one message is the last of either. It's cut to three lines. It's read when the result is expanded, never for the whole page of 50: 50 `show` calls on every search is the cost to avoid. Measured 2026-10-23: `show <id> --tail 1 --json` took 0.12 s on a very long Session (tb-session 0.3.0, cached), so it's read on expand, cached per id, with "Loading…" meanwhile.
  - **model:** none. `tb-session show --json` returns `session_id`, `harness`, `headless`, `transcript_missing`, `summary`, `first_prompt`, `git_branch`, `project_path`, `message_count`, `created_at`, `modified_at`, `is_sidechain`, `messages`, `messages_source` and `total_messages` (checked 2026-10-23), so the expanded result shows no model, and the Harness only on its row.
  - **can it be resumed:** `blocked` and `BLOCK_REASON` (`shared/history.ts`), no new read.
  - Results are kept per Session id for as long as the list shows it, so collapsing and expanding again reads nothing; a new search clears them.
- **Binary:** `LOOKOUT_TB_SESSION_BIN`, then `PATH`, then `~/.local/bin`, like Fleet's.
- **Read-only view:** at `/h/<harness>/<session_id>`, so a reload keeps it. "repo" in a result is its start directory's name.
- **Can it be resumed?** Its `project_path` exists and it isn't live.
- **Measured 2026-10-16** (last 300 Sessions, 3 weeks):
  - 150 started in `~/Projects/work`.
  - 37 started in a Worktree, 30 of which are gone.
  - About 60 were headless eval runs.

### Key decisions

- **A right sidebar, like Orca's**: the Session sidebar stays visible at all times, and the right side can hold more panels later (PORTS).
- **A click selects and expands; a button resumes** (replaces "Click resumes", Dario, 2026-10-23): a stray click resumed a past Session, which starts a Session host, and nothing showed what a Session was before it did. Resuming is still the point of History, so it's one labelled button, or Enter on the expanded result: two steps, never one by accident. A Session that can't be resumed gets "Show" (read-only) there, so the button is never a dead end.
- **Keyboard moves don't resume or expand**: browsing with ↑/↓ or j/k mustn't start Sessions or open details; only a click or Enter expands, and only the button or a second Enter acts.
- **Details are read on expand, not per result**: a first prompt and a last message need a `show` each, and a page of 50 results would make 50.
- **Resume in the original start directory**: Claude Code files a Transcript under the directory a Session started in, and resuming from anywhere else fails.
- **Never two processes on one Session**: a live Session is selected, not resumed again.
- **Search lives in tb-session, not the Fleet fork**: tb-session already has the index, search and `--json`. Only Codex is missing, and that work is shared under productiveio.
- **"Last message" is the last entry of either role, labelled "You" or the Harness (HIST-2.9)**: `show --tail` returns both and `toEntry` keeps both; "what it was about" is often your last prompt when a Session ended mid-work.
- **The expanded result shows no model (HIST-2.9)**: checked 2026-10-23: `tb-session show --json` returns `session_id`, `harness`, `headless`, `transcript_missing`, `summary`, `first_prompt`, `git_branch`, `project_path`, `message_count`, `created_at`, `modified_at`, `is_sidechain`, `messages`, `messages_source` and `total_messages`: no model. The model isn't read from a Transcript in Lookout (0005); a cli-toolbox change would be the fix, later.
- **`show` is read on expand, cached per id, "Loading…" meanwhile (HIST-2.10)**: `tb-session show <id> --tail 1 --json` took 0.12 s on a very long Session (tb-session 0.3.0, cached), so no first-prompt-only fallback.
- **A live result's "Open" also expands its details, as any other result (HIST-2.9, 3.2)**: the live marker and the "live" chip already say it.
- **One button on a result, no chips (HIST-3.5)**: Dario's table lists "Resume", "Open" or "Show" only, and a result has no Links (WORK's Linking is Work's).
- **The 20 px icon is WORK's one new button size, with DS-7.1 and DS-7.4 amended (HIST-3.6)**: see WORK's Key decisions.

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
- 2026-10-19: HIST-3.4 checked live on 4747 with the fork's Fleet: a Claude Code Session started and ended through Lookout in `~/Projects/work`, then resumed from History, showed "Starting…" and went live under the same session ID within 2 s; its resumed process sent telemetry to Grafana (Loki `claude-code-telemetry`, `repo=work`, `terminal.type=tmux`), including the prompt sent after the resume. The 15 s failure is the shared spawn path (LAUNCH-4.5), tested. Done.
- 2026-10-19: Work (WORK-1) is the right sidebar's second panel, so the tab strip HIST-1.1 waited for is there: History and Work in the header row, History's search field below it, and the sidebar named "Right sidebar". Its open state and width (HIST-1.3) are kept with the active tab, read from HIST's old key the first time. Closed, the rail has a button for each tab.
- 2026-10-19: HIST-1.1 and the UX reworded to what the right sidebar does now: History is one of its tabs; `H` opens it on History, switches to History from Work, and closes it when History is showing; the tab strip stands in for the "History" heading, and the sidebar is named "Right sidebar". The mock-up shows the tab strip, with the search field below it. With focus on the tab strip, j/k and ↑/↓ move through History's results, never the Session sidebar's, and ←/→ move between the tabs (WORK-1.7).
- 2026-10-19: HIST-1.1 retagged `(test)`: switching from Work, the sidebar's name and the missing "History" heading are tested under its ID, next to the button, `H` and the search box's focus.
- 2026-10-20: tb-session 0.3.0 is released and installed. It also indexes Pi Sessions; their rows are left out, as before (pi is a non-goal). Behaviour tests use the release (TEST spec).
- 2026-10-22: Design system, colour by meaning (DS-3): the Harness logos in the filter and the results are monochrome (DS-3.1), and a search hit is marked with the `highlight` token instead of Needs you's amber (DS-3.4).
- 2026-10-22: Design system (DS-3.6): a live result's marker is `muted-foreground` instead of Busy's blue, until DS-5.2 draws the Session's real Status there.
- 2026-10-22: Design system (DS-5.2): a live result's marker is its Session's Status marker, from the Session sidebar's list and following its Status, a resumable one lucide's `History` and a blocked one `CircleSlash`, all through the Session marker; this replaces the 2026-10-22 `muted-foreground` stand-in (DS-3.6) and the 2026-10-17 circles. Loading, empty states and errors are the design system's Loading, EmptyState, Alert and CommandBlock (DS-4, DS-6.3, DS-8).
- 2026-10-22: Design system review fixes, round 1 (DS-4.2): a failed search is an error box, as the open error is, not a neutral empty state; the Harness toggles are icon buttons (DS-7.2). The words stay.
- 2026-10-23: Select, then act, from Dario's testing: a stray click on a result resumed a past Session, and nothing showed what a Session was first. A click, or Enter, now selects and expands the result; the button "Resume", "Open" or "Show", or Enter on the expanded result, acts. Added HIST-2.9 to HIST-2.11 (details, where they're read, one open at a time), HIST-3.5 (a click never acts) and HIST-3.6 (the button's look). Amended and unticked HIST-2.7, HIST-3.1, HIST-3.2 and HIST-3.3, whose meaning changed; HIST-2.7 retagged `(test)`. HIST-3 is "Resume from a result". Key decision "Click resumes" replaced by "A click selects and expands; a button resumes", with the reason. Status Done to In Progress. Technical approach: Expanded result. Open questions: 6. Not grilled. WORK's matching change: WORK-1.12 to WORK-1.15.
- 2026-10-23: Dario answered the six open questions, all as recommended; folded in as Key decisions with their reasons. Checked live: `tb-session show --json` has no model field, so HIST-2.9 says the expanded result shows the Harness and no model; `show --tail 1 --json` took 0.12 s on a very long Session, so it's read on expand, cached per id, "Loading…" meanwhile. The 20 px icon: DS-7.1 and DS-7.4 amended (see DS). Open questions: none.
- 2026-10-23: Select, then act built (HIST-2.7, 2.9 to 2.11, 3.1 to 3.3, 3.5), ticked on component and server tests. Technical approach, Expanded result: the last message is read by its own route, `GET /api/history/<harness>/<id>/peek`, with `show --tail 1` as the Key decision measured, not by the read-only view's route, which reads 20 whole messages; the spec named both. Settled in building: the server sends `projectDisplay`, the start directory with the home directory as `~`, since the browser doesn't know it, and keeps `firstPrompt` (three lines, 600 characters) on each result; the button is `RowAction` (DS-7.1's labelled size), a mouse target, as an option holds nothing focusable; Esc in the search box collapses an expanded result before it clears the query; a held Enter runs the button once. HIST-3.6 (manual) is left for Dario: checked in a World's built Lookout, light and dark, at 1440×900 and with a 280 px sidebar, the button measured 28 px tall with a 20 px icon, and a failed resume (Codex not installed in the World) showed its error Alert under the button; "Resuming…" passed too fast to see there, and is covered by a component test only.
- 2026-10-23: Select, then act review fixes: HIST-2.9 drops "its Harness" from what the expanded result adds, since the row above already shows the Harness and branch; the start directory line is the directory alone and the next "Oct 20, 16:12 · can resume". The sketch and the Key decision on the model follow. Settled in fixing, no criterion changed: a new query, the headless toggle or a Harness toggle collapses the expanded result, and Enter waits while their search hasn't answered, so it never resumes a result of the old one (HIST-2.11, HIST-3.5); a click that expands a result holds its button back for 400 ms, and the button ignores the second click of a double click (HIST-3.5).
- 2026-10-23: HIST-3.6 ticked: Dario checked it in the running app, from Dario's testing. He asked for more space between the buttons and the content around them, which DS-7.4 now states.
- 2026-10-27: From Dario's report (a resume in a folder Claude Code didn't trust failed after 15 s, its Trust prompt in the terminal's last lines, with nowhere to answer it): HIST-3.4 amended to include the Trust prompt in the Starting view (LAUNCH-6) and unticked until it's seen live. Technical approach: a resume waiting at its Trust prompt is answered from its row; a `session_starting` resume whose Session host Fleet names is followed as Lookout's own (fork contract C7); "answer it there" is said only of another terminal app, never of a Session host.
- 2026-10-30: From TOOLS-2.5: a tb-session that refuses a subcommand or flag History needs, after the 0.2 fallback (`legacy`), says "tb-session 0.1.0 is older than History needs (0.3.0)", the version from the Tools table, with the update command, instead of "tb-session failed"; only a tb-session that isn't there says it isn't installed.
- 2026-10-30: Non-goals: tagging past Sessions stays out, and a Topic membership (TOPIC-2.1, "Add to Topic" on an expanded result) isn't one: it's a row in Lookout's own store, and the Session is untouched.
