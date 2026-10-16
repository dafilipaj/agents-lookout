---
title: History
code: HIST
status: Ready
created: 2026-10-16
updated: 2026-10-16
---

# History

## Summary

Search past Sessions of both Harnesses by what was said in them, and click one to resume it. It resumes in its own Session host, so it's Controllable and sends telemetry like any Session Lookout starts. History lives in a right sidebar, so the Session sidebar on the left stays visible.

## Problem

Finding last week's Session means remembering its directory and running `claude --resume`, or `tb-session` (Claude only). Codex history isn't searchable at all. A Session resumed in a plain terminal can't be controlled from Lookout.

## Requirements

### HIST-1 Right sidebar

- [ ] HIST-1.1 A right sidebar, opened and closed with a button at the top right or `H` (when focus isn't in a text field), has a History tab. Opening it focuses the search box. (manual)
- [ ] HIST-1.2 The Session sidebar on the left and the main pane stay visible and usable while it's open. (manual)
- [ ] HIST-1.3 Whether it's open, and its width, are remembered across reloads. (test)

### HIST-2 Find past Sessions

- [ ] HIST-2.1 With an empty query, past Sessions are listed most recent first, and more load as you scroll. (test)
- [ ] HIST-2.2 Typing searches the full text of prompts and replies across all projects. Results show within 1 s, best match first. (test)
- [ ] HIST-2.3 Each result shows the title or summary, Harness, repo, branch, when it was last active, and the matching snippet. A result that's live right now is marked as live. (test)
- [ ] HIST-2.4 Claude Code and Codex Sessions both appear, once tb-session reads Codex (see Technical approach). (test)
- [ ] HIST-2.5 Headless Sessions are hidden by default. A toggle shows them. (test)
- [ ] HIST-2.6 Subagent Sessions and Sessions without a single prompt never appear. (test)
- [ ] HIST-2.7 ↑/↓ and j/k move through the results without resuming anything; Enter acts like a click. (manual)

### HIST-3 Click to resume

- [ ] HIST-3.1 Clicking a past Session that can be resumed starts it again in its own Session host, in the directory it originally started in. It appears in the Session sidebar as "Starting…", then as a live Session, and is selected (as in LAUNCH-4.2). (test)
- [ ] HIST-3.2 Clicking a Session that's live right now selects it; a second process is never started. (test)
- [ ] HIST-3.3 Clicking a Session that can't be resumed, because its start directory no longer exists, opens it in the main pane read-only: its latest messages, and a note on why it can't be resumed. (test)
- [ ] HIST-3.4 A resumed Session behaves like one LAUNCH started: the 15 s failure (LAUNCH-4.5) and telemetry (LAUNCH-5) apply. (manual)

## Non-goals

- Deleting, renaming, exporting or tagging past Sessions.
- Forking a Session (`--fork-session`), or resuming with a new first prompt (once it's live, use the composer, VIEW-3).
- Recreating a removed Worktree so that a Session can be resumed.
- Semantic or AI search; filters other than the headless toggle.
- Grouping or a scope switch (Orca's Workspace / Project / All); everything is searched.
- Other tabs in the right sidebar; it's built so PORTS can become one later.
- Other Hosts, and the pi Harness.

## UX

```
┌───────────────┬──────────────────────────────────┬──────────────────────┐
│ Sessions      │ main pane (VIEW)                 │ History          [×] │
│ (SIDE)        │                                  │ [ search…          ] │
│               │                                  │ ☐ Show headless      │
│               │                                  │ ● fix-deal-rates live│
│               │                                  │   work · main · 2h   │
│               │                                  │ ○ kg-hook-review     │
│               │                                  │   Codex · work · 3d  │
│               │                                  │   "…the hook fires…" │
│               │                                  │ ⊘ pr641-review       │
│               │                                  │   folder gone · 9d   │
└───────────────┴──────────────────────────────────┴──────────────────────┘
```

- Markers: ● live (click selects it), ○ resumable (click resumes it), ⊘ can't be resumed (click opens it read-only).
- Empty states: "No past Sessions", and "Nothing matches" with the query.
- Errors: tb-session missing shows how to install it, like SIDE-6.1.

## Technical approach

- **Search and list** ([0005](../../decisions/0005-building-blocks-live-outside-lookout.md)):
  - Commands: `tb-session search <query> --all-projects --json` and `tb-session list --all-projects --json`.
  - Results carry `session_id`, `summary`, `first_prompt`, `project_path`, `git_branch`, `created_at`, `modified_at`, `message_count`, `matched_snippet` and `matched_role`.
  - Speed: measured at 0.14 s across all projects on 2026-10-16.
- **Gap 1: tb-session reads Claude Code only** (cli-toolbox PR, protected `main`).
  - It needs:
    - a scanner and parser for Codex (`~/.codex/sessions/**/rollout-*.jsonl`);
    - a `harness` field, with a `--harness` filter;
    - a flag for Headless Sessions, with a filter.
  - Built as pluggable Transcript sources, one per Harness vendor. Claude Code is the first source and Codex the second. Another vendor's agent is one new source, with no changes to the index, search or the `--json` shape.
  - HIST can ship before Gap 1 closes: Codex rows appear once the PR merges, with no change in Lookout.
- **Read-only latest messages (HIST-3.3):** `tb-session show <id> --json` returns the last 20 messages with role, content and timestamp. They're shown with VIEW's chat styles.
- **Gap 2: resuming in the fork** ([0006](../../decisions/0006-run-a-fork-of-fleet.md)).
  - Command: `fleet spawn --resume <session_id> --harness <h> --dir <project_path> --backend tmux --json`.
  - Fleet already builds the resume commands for `fleet restore` (`claude --resume <id>`, `codex resume <id>`). `spawn` needs to expose them for any `session_id`.
  - It goes through a login shell like every start ([0002](../../decisions/0002-start-sessions-through-a-login-shell.md)).
  - Lookout tracks the "Starting…" row through the same path as LAUNCH.
- **Live check:** a `session_id` present in Fleet's current list is live (HIST-3.2).
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
