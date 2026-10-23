---
title: Session sidebar
code: SIDE
status: In Progress
created: 2026-10-16
updated: 2026-10-22
---

# Session sidebar

## Summary

A sidebar listing every live Session on this Host with its Status, so you see at a glance which ones need you and can switch to any of them with one click or key. It's Lookout's home screen; the other features hang off it.

## Problem

With many agents running across iTerm2 tabs and tmux panes, finding the one that's waiting for you means hunting through terminals, and Claude's own notifications are easy to miss. The old tmux dashboard tried to solve this, but its mouse handling and pane switching were glitchy.

## Requirements

### SIDE-1 List live Sessions

The sidebar lists every live Session on this Host that Fleet finds, whichever terminal it runs in.

- [x] SIDE-1.1 A Session started anywhere (Lookout, an iTerm2 tab, a tmux pane) appears within 3 s of Fleet reporting it. (manual)
- [x] SIDE-1.2 A Session whose process exits disappears within 3 s. (manual)
- [x] SIDE-1.3 Claude Code and Codex Sessions both appear. (manual)
- [x] SIDE-1.4 Given a recorded `fleet list --json` output, the server produces the expected rows. (test)
- [x] SIDE-1.5 Sessions that aren't Controllable (e.g. Claude Desktop, IDE terminals) are shown in their own "View only" section below the others, so you know they exist. The section's header shows only when it has Sessions. (test)

### SIDE-2 One row per Session

- [x] SIDE-2.1 Each row shows the title, Harness, Status, repo name, where the Session works (SIDE-2.2), and time since the last status change. (test)
- [x] SIDE-2.2 When the working directory is a linked Worktree, the row shows the Worktree's name with a worktree icon; otherwise it shows the git branch with a branch icon. The two icons are clearly different. (test)
- [x] SIDE-2.3 A Needs you row also shows what it's waiting for, on one line. (test)
- [x] SIDE-2.4 Context usage shows as a percentage when Fleet reports it, and not at all when it doesn't. (test)
- [x] SIDE-2.5 Rows fit a 280 px sidebar without horizontal scrolling; long text is truncated, with the full text on hover. (manual)
- [x] SIDE-2.6 A Session Fleet reports as Idle with a background shell command still running (Claude Code's `shell`, from 2.1.308) is Idle everywhere a Status counts: its marker, strip, order (SIDE-3.1), age and dimming (SIDE-3.5). Its row shows a terminal icon in Idle's grey among the numbers at the row's end, before the age, with the tooltip "A background shell command is still running"; the row's accessible name adds "background shell running" before the age. Any other Idle row looks as before. (test)

### SIDE-3 Status at a glance

- [x] SIDE-3.1 Controllable Sessions come first, then the "View only" section. Within each, rows are ordered Needs you → Busy → Idle → Unknown, and within each Status the most recent status change comes first. (test)
- [x] SIDE-3.2 Each Status has its own marker. Needs you is the most prominent, and is recognizable without colour. (manual)
- [x] SIDE-3.3 The browser tab title shows how many Sessions need you, e.g. "(2) Lookout", and no count when none do. (test)
- [x] SIDE-3.4 Status markers and row text update live, also while the pointer is over the sidebar. Only reordering waits: rows don't move while the pointer is over the sidebar, and pending moves apply once it leaves. (manual)
- [x] SIDE-3.5 A Session Idle for longer than the idle threshold (default 4 h, SIDE-7) is dimmed. It returns to normal as soon as its Status changes. (test)
- [x] SIDE-3.6 Each row has a strip down its left edge in its Status's colour: amber for Needs you, blue for Busy, grey for Idle, and grey dashed for Unknown, like its marker's dashed ring. A View only row's strip is fainter, as its marker is. (test)
- [x] SIDE-3.7 A Needs you row's background is tinted with the Needs you colour, Controllable or View only, so the rows that want action stand out. No other Status tints its row. (test)
- [x] SIDE-3.8 The Status markers in the sidebar are a size up from the header's (18 px for Needs you, the others in proportion), and a row's second and third lines stay aligned with its title, "Starting…" rows included. (manual)
- [x] SIDE-3.9 On every Status, a tinted Needs you row included, the selected row and the row under the pointer are each clearly visible and tell apart from each other, in light and dark mode. The keyboard moves the selection (SIDE-5), so a row selected from the keyboard looks like one selected by click. (manual)
- [x] SIDE-3.10 The strip and the tint are decoration, hidden from screen readers: a row's accessible name stays what it was (its marker's Status, title, Harness, repo, where it works, age and context). (test)
- [x] SIDE-3.11 Every text on a row keeps a contrast of 4.5:1 or more against the row's background at rest, under the pointer and selected, in light and dark mode. A dimmed long-Idle row (SIDE-3.5) and a stale list (SIDE-6.2) are faint on purpose and don't count. (test)

### SIDE-4 Switch Sessions

- [x] SIDE-4.1 Clicking a row selects that Session and shows it in the main pane (what the main pane contains is the VIEW spec). (manual)
- [x] SIDE-4.2 The selected Session is in the URL, so reload and back/forward keep it. (test)
- [x] SIDE-4.3 If the selected Session ends, it stays selected and the main pane says it ended, until you select another. (manual)

### SIDE-5 Keyboard

- [x] SIDE-5.1 ↑/↓ and j/k move the selection. ↑/↓ pressed inside the chat scroll the chat instead (VIEW-1.11). (manual)
- [x] SIDE-5.2 ⌘1–⌘9 select the first to ninth row. (manual)
- [x] SIDE-5.3 ⌘J selects the next Session that needs you. (manual)
- [x] SIDE-5.4 `/` focuses a filter box; typing filters rows by title, repo, Worktree or branch; Esc clears it. (test)

### SIDE-6 When Fleet fails

- [x] SIDE-6.1 If `fleet` isn't installed, the sidebar says how to install it instead of showing an empty list. (test)
- [x] SIDE-6.2 If a `fleet list` call fails or times out, the last list stays visible, dimmed, with a banner saying how long it's been stale. It recovers on its own. (test)

### SIDE-7 Settings

- [x] SIDE-7.1 A Settings page, reachable from the sidebar, lets you change the idle threshold in hours. (manual)
- [x] SIDE-7.2 The server stores settings in a file, so they survive restarts and are the same in every browser tab. A changed value applies without reloading. (test)

### SIDE-8 One grid

The app shell: the Session sidebar, the main pane and the right sidebar (HIST, WORK) are columns of one grid, so their horizontal lines line up.

- [x] SIDE-8.1 The three column headers (the Filter bar, the main pane's header, the right sidebar's tab strip, or its rail's History button when closed) share one height, and their bottom borders read as one continuous line. The line above the usage panel (USAGE-1) continues as the line above the composer, or above the "View only" or "This Session ended" banner; the Terminal row stays above it and the status line below it. At rest the dock row has one height in every main-pane view: that of a live Session's empty one-line composer with the status line under it, or the usage panel's if that is taller. An empty composer is one line high whatever its placeholder, a long Session title included. The banners and the past-Session note fit inside it, hovered or focused too, so switching views (live, View only, ended, past, Starting, Settings, nothing selected) moves neither the dock line nor the usage panel's content. When a cell on either side grows past it (a multi-line message in the composer, more usage rows), the whole row grows with it, so the lines stay aligned; back at one line, the composer returns the row to its resting height. The dock row grows to at most 40% of the window's height, so the content row (the Session list, the chat) keeps the rest; a dock cell taller than that scrolls. The header line holds in every main-pane view (a Session, a past Session, a start under way, Settings, nothing selected), with the right sidebar open on either tab or closed; the dock line wherever the view has a dock, and on the sidebar's side in every view. (manual)

### SIDE-9 Running Subagents

A row shows how many Subagents its Session has running right now, so a Session whose main thread is Idle while its Subagents still work doesn't read as finished. The count is Fleet's, from `list --json` (Technical approach, "Running Subagents"), and Lookout reads no Transcript for it. A Subagent counts from when it starts until it ends, in the foreground or the background, nested ones (started by a Subagent) included, each once at any depth, for Claude Code and Codex Sessions alike; for Codex, a child agent counts while it's in a turn of its own. One started in an earlier Turn counts while it still runs. One that ended counts no more, however it ended: finished, failed, stopped or killed. A background shell command isn't a Subagent (Glossary). Fleet can't tell (null) for a Claude Code older than 2.1.301, a Codex Session before its first prompt, or a Session whose Transcript it can't find; a Fleet without the field can't tell either. The row shows only the ones running; how many finished in the current Turn is the status line's (VIEW-8).

- [x] SIDE-9.1 When Fleet reports one or more Subagents running, the row shows the count with a Subagent icon on its second line, first among the numbers at the row's end: before the age and the context usage (`work · [br] main  [sa]2  5m  23%`). With none running, or when Fleet can't tell, nothing shows and the row is as it was: never a "0", and never the ones done in the Turn, however many there are. (test)
- [x] SIDE-9.2 The count follows Fleet's list: a change reaches the row with the next poll, and changes nothing else: not the Status, the marker, the strip or the age, and the row doesn't move (SIDE-3.1). (test)
- [x] SIDE-9.3 A View only row (SIDE-1.5) shows it like a Controllable one. A row of a Session Fleet no longer lists goes as before (SIDE-1.2), so no count outlives its Session. A `subagents` value whose `running` isn't a count (missing, null, not a whole number) reads as "can't tell". (test)
- [ ] SIDE-9.4 Seen live: a Subagent started in a Session shows on its row within 3 s (SIDE-1.1's bound), also while the pointer is over the sidebar (SIDE-3.4), and goes within 3 s of ending; one stopped from the Session (`/tasks`, or its own Stop) goes the same way; a Session that exits or is killed mid-run takes its row and count with it. (manual)
- [x] SIDE-9.5 At 280 px the count is never cut: the Worktree or branch truncates first (SIDE-2.5). It sits clear of the marker, the strip and the Harness mark, its icon the size of the context ring, and the row's lines stay aligned (SIDE-3.8). (manual)
- [x] SIDE-9.6 The row's accessible name (SIDE-3.10) adds "2 Subagents running" ("1 Subagent running") before the age, in the order the row shows them, only when the count shows; the icon itself is hidden from screen readers, and the count's tooltip says the same. Its text keeps 4.5:1 on every row state, in SIDE-3.11's test. (test)

## Non-goals

- Grouping by repo. Almost every Session runs in `work` today; revisit if that changes.
- Other Hosts. Fleet supports them; Lookout is this Mac only for now.
- Starting Sessions (LAUNCH), and renaming or closing them.
- Controlling Sessions that aren't Controllable. They're shown, nothing more.
- Dormant and recently closed Sessions (HIST).
- OS notifications. The tab-title count is the only alert here.
- Boards, stacks, AI-generated names or briefs (Fleet extras).
- The pi Harness.
- Pinning or drag-to-reorder.
- Running Subagents (SIDE-9): their names, types or descriptions on the row, or a list of them; stopping or steering one; counting background shell commands (Claude Code's `run_in_background` Bash) or Agent-team teammates, which aren't Subagents; a Status of its own for "Idle with Subagents running" (Key decisions); the ones done in the Turn on the row (the status line has them, VIEW-8); a "quiet" mark for a Subagent that hasn't written for a while (Key decisions; a Known gap); the count for a pi Session.

## UX

```
┌──────────────────────────────┬───────────────────────────────────┐
│ / filter                + ⚙  │ header (VIEW)                     │
├──────────────────────────────┼───────────────────────────────────┤
│ ◆ fix-deal-rates        [cl] │   selected Session (VIEW spec)    │
│   work · [wt] crm-rates · 2m │                                   │
│   permission: Bash(rspec …)  │                                   │
│ ● kg-hook-review        [ox] │                                   │
│   work · [br] m… [sa]2 5m 41%│                                   │
│ ○ spec-lookout          [cl] │                                   │
│   agents-lookout · [br] main │                                   │
│ VIEW ONLY 2                  │                                   │
│ ◆ desktop-chat          [cl] │                                   │
│ ● orca-review           [cl] │                                   │
├──────────────────────────────┼───────────────────────────────────┤
│ usage panel (USAGE)          │ composer, or the ended / View     │
│ Jev                          │ only banner; then the status line │
└──────────────────────────────┴───────────────────────────────────┘
```

- **One grid (SIDE-8):** the app shell is one CSS grid with three rows, header / content / dock, and every column (this sidebar, the main pane, History) is a subgrid over all three. The header's bottom line and the dock's top line are the grid's row edges, so they line up by construction, not by matched pixel sizes; the tallest cell in a row sets its height. The dock row is `fit-content(40dvh)`: it grows with its tallest cell up to 40% of the window, then its cells scroll, so a main pane that wraps at narrow widths can't squeeze the Session list (the composer hint stays on one line, its full text in a tooltip; a banner's or the past-Session note's title stays on one line and its detail on two, even with focus). When the clamp cuts that text short, hovering it, or Tab to it, shows the full text in an overlay that opens upward over the chat, styled like the chat rail's tooltip; text that fits opens nothing. A mouse click doesn't hold the overlay open, keyboard focus does, and Esc or a click on the overlay closes it. The overlay is absolutely positioned against the view, outside the dock cell's scroll box, so it never grows the dock or moves the usage panel, and it stays inside the main pane at any width and height, never over History; a click on it goes no further than the overlay. Screen readers read the full text in the note itself, and the overlay, which repeats it, is hidden from them. The sidebar's dock cell holds, under the usage panel, an invisible empty composer with a status line, drawn by the composer's own parts, so the row never shrinks when a view has a shorter dock or none, and its resting height follows the composer through any style or root font size change; each cell's content sits at its top. An empty composer doesn't size to its placeholder: it is one line, the placeholder cut short with an ellipsis, and it grows with the text once you type. A main-pane view without a dock (nothing selected, Settings, a start under way) runs its content down through the dock row, so the line there is the sidebar's only: an empty band under Settings would be a footer with nothing in it. History's list runs down the same way.

- `[cl]` and `[ox]` are the Harness marks: Claude's and OpenAI's (for Codex), each with its name as the accessible label. They're monochrome, in the row's quieter colour (DS-3.1): in a list the Status carries the colour, and the brand colour is kept for the main pane's header and the launcher.
- Context usage (SIDE-2.4): the number and its ring take the status line's colours (VIEW-5.5, DS-3.5): the row's quieter colour up to 40%, `warning-text` above 40%, `destructive-text` above 60%, each 4.5:1 or more on every row state (SIDE-3.11).
- "View only" holds the Sessions that aren't Controllable, in the same Status order. Keyboard navigation, ⌘1–9, ⌘J and the filter run across both sections, and hover-freeze (SIDE-3.4) applies to both.
- "Starting…" rows (LAUNCH-4) sit above both sections and are rows like any other for ↑/↓, j/k and ⌘1–9 (LAUNCH-4.7): the first of them is ⌘1, and a failed one takes no number. ⌘J skips them (they never Need you), and the filter leaves them in place. Selecting one shows the start in the main pane (LAUNCH-4.6).

- Markers: ◆ Needs you, ● Busy, ○ Idle, ? Unknown. In the sidebar they're a size up from the header's (SIDE-3.8): an 18 px box, the diamond filling it, the dot and ring at 13 px, Unknown's ring at 15 px. Busy's dot pulses only for 10 s after the Session became Busy, by the Status's age, so a reload doesn't start it again, then holds steady; with reduced motion it never pulses (DS-10.1).
- Keyboard focus (DS-9): the Session list is a listbox Tab reaches after the Filter bar's buttons and any Starting row's Dismiss. It names the selected Session as its active option (none while a Starting row or nothing is selected, or while the filter hides the selected Session), and with focus on it the SIDE-5 keys work as anywhere outside a text field. Keyboard focus draws a ring around the list; a click on a row focuses the list without one, and the selected row keeps its own ring (SIDE-3.9).
- Status strip (SIDE-3.6): a 3 px rounded bar at the row's left edge, 4 px short of its top and bottom, in the Status's colour (Unknown's dashed). A View only row's is at 60%, like its marker; a dimmed long-Idle row (SIDE-3.5) dims it with the rest of the row. "Starting…" rows (LAUNCH-4) have no Status, so no strip; their icon sits in a box the marker's size, so every title starts at the same x.
- Row states (SIDE-3.7, 3.9): a Needs you row is tinted at rest, more under the pointer, and most when selected, with an amber ring. Other rows are plain at rest, light grey under the pointer, and grey with a thin ring when selected. The ring is what tells the selected row from the one under the pointer. On a Needs you row the quieter text (the second line, a View only title) is the foreground at 70% instead of the muted grey, so it keeps 4.5:1 on every step of the tint (SIDE-3.11).
- `[wt]` and `[br]` stand for the worktree and branch icons (e.g. lucide `FolderGit2` and `GitBranch`).
- `[sa]2` is the Subagent count (SIDE-9): lucide's `Bot` at the context ring's size, then the number of Subagents running, first in the second line's numbers group, before the age and the context usage; the group never shrinks, so the Worktree or branch truncates first (the sketch's `m…`). The text is the row's quieter colour (the foreground at 70% on a Needs you row, SIDE-3.11), `tabular-nums` like its neighbours; the tooltip reads "2 Subagents running" ("1 Subagent running"). Nothing is drawn for none or "can't tell", so a row without Subagents looks as it does today, and the ones done in the Turn never show here (VIEW-8's status line has them). It isn't a Status: the marker and the strip stay the main thread's, an Idle Session with two Subagents running is an Idle row with `[sa]2`.
- Background shell (SIDE-2.6): lucide's `SquareTerminal` at the context ring's size, in Idle's text shade (`idle-text`), in the numbers group after the Subagent count and before the age; its tooltip "A background shell command is still running". No number and no word: it's on or off. It isn't a Status: the row stays an Idle row, marker and strip included.
- ⚙ opens Settings.
- Empty state: "No live Sessions", with a hint to start one (N, or `claude` / `codex` in iTerm2). With only view-only Sessions, the same hint sits above the "View only" header.
- Error states: see SIDE-6. The banners for a stale Fleet list (SIDE-6.2) and a lost server are in the design system's info tone (DS-3.3), grey, not amber: staleness doesn't need you. "Fleet isn't installed" (SIDE-6.1) is an error box with its command in a command block (DS-4, DS-8.2). New Session and Settings are 24 px icon buttons, 4 px apart (DS-7), and the empty states are the design system's EmptyState (DS-8.1).

## Technical approach

- **Polling:** the server calls `fleet list --json` every 2 s, compares the result with the previous one, and pushes changes to the UI over server-sent events. The UI never calls Fleet itself ([0003](../../decisions/0003-browser-first-react-stack.md), [0004](../../decisions/0004-fleet-cli-as-session-layer.md)).
- **Fields used from Fleet** (`fleet --local list --json`, checked against Fleet 38a461c's `docs/architecture.md` and real output on 2026-10-16):
  - `display_title`, `harness`, `context.pct`, `cwd`, `model`.
  - `status`: `waiting` → Needs you, `busy` → Busy, `idle` and `shell` → Idle, anything else → Unknown. `shell` (Claude Code 2.1.308's registry, passed through by Fleet) is Idle with a background shell command (a `run_in_background` Bash) still running; the server keeps that as the row's `backgroundShell` (SIDE-2.6), and moving between `idle` and `shell` isn't a Status change, so the age keeps counting.
  - `waiting_for`, shown only on Needs you rows. For a Claude question it's the generic `input needed`.
  - `backend`: `tmux` or `iterm` means Controllable.
  - `subagents` (the fork, SIDE-9 and VIEW-8; see "Running Subagents" below): `{running: <n>, finished: <m>}` or null.
  - `updated_at` isn't a status-change time for every Harness. For Claude it is (the registry's status change); for Codex it's the Transcript's last write, or the process start (which jitters by up to a second between calls). So the server tracks status changes itself: it keeps the time until the Status changes, then takes Fleet's `updated_at` if it falls after the previous change, otherwise the time it saw the change.
  - Rows with Harness `pi` are dropped (Non-goal).
- **Known Fleet gaps (38a461c):**
  - A Codex approval prompt (Codex 0.162) is reported as `busy`, not `waiting`, so it doesn't show as Needs you.
  - A Codex Session has no `session_id` before its first prompt; its id changes from `codex:<pid>` to the session id then. The UI keeps it selected by following the same pid.
- **Repo, Worktree and branch:** Fleet doesn't report these, so the server reads them with `git -C <cwd>`, cached per directory and refreshed every 30 s.
  - It's a linked Worktree when `--git-dir` and `--git-common-dir` differ.
  - The Worktree's name is the basename of `--show-toplevel`.
  - The repo name comes from the common git dir's parent (for a bare repo, the common dir's own name minus `.git`).
  - Outside git, the row shows the working directory's name instead.
- **Status colours (SIDE-3.6, 3.7):** the theme's Status tokens in `web/src/index.css` (`--needs-you`, `--busy`, `--idle`, each with a light and a dark value). `STATUS_STRIP_CLASS` in `web/src/lib/sessions.ts` gives each Status's strip, and `STATUS_TAG_CLASS` beside it the header's tag (VIEW-5.9), so a Status has one colour wherever it shows. The Needs you tint and its pointer and selected steps are the Needs you colour at 12%, 20% and 26%, which reads in both modes. `ROW_TONE` beside them holds each row state's background and quieter text, and a test computes every text's contrast on every state from the tokens, compositing as the browser does (SIDE-3.11). The lowest ratios: 5.4:1 for the quieter text on a selected Needs you row in dark mode, 4.7:1 for what it waits for on a selected one in light mode, 4.6:1 for the muted grey on a selected plain row in light mode. The muted grey alone fell to 4.1:1 (light) and 3.6:1 (dark) on the selected tint.
- **Settings:** stored by the server in `~/.config/lookout/settings.json`, not in browser storage. A change is pushed to every open tab over the same event stream.
- **Session identity:** `session_id` when present, otherwise `<harness>:<pid>`. Fleet's `session_id` is Claude's UUID, so Codex rows may not have one.
- **Prerequisite:** Fleet installed and pinned with `cargo install --git https://github.com/ilucin/fleet --rev 38a461c --locked fleet`.
- **Measured 2026-10-16:** `fleet list --json` takes 0.09–0.13 s with 3 live Sessions, so a 2 s poll is cheap. All 3 ran in Orca and came back with backend `unknown`, i.e. not Controllable.

- **Running Subagents (SIDE-9, VIEW-8).** From a new field in the Fleet fork's `list --json`, read as VIEW-5.11 reads `effort`: Lookout's server never opens a Transcript or a Subagent's files, and nothing new is polled. Researched 2026-10-22 from Fleet's source, the Claude Code docs and a structure-only scan of real Transcripts (88 Claude Code Sessions on 2.1.300–2.1.308 with 673 Subagent sidecars; 524 Codex rollouts on 0.153–0.163). The Turn's start was checked the same day against record types only, in 87 Claude Code Transcripts and 295 sidecars written in the six days before, and 416 Codex rollouts from the 30 days before. What wasn't seen live is listed under "Still to check live".
  - **Contract (agreed 2026-10-22, [0006](../../decisions/0006-run-a-fork-of-fleet.md)):** every row carries `subagents`: `{running: <n>, finished: <m>}`, or `null` when Fleet can't tell.
    - `running`: every Subagent running now, whichever Turn started it.
    - `finished`: the Subagents that started and ended in the current Turn (Glossary). One started in an earlier Turn is never in it: while it runs it's in `running`, and once it ends it's in neither. `finished` alone is `null` when Fleet can't find the Turn's start.
    - Both are whole numbers. `{running: 0, finished: 0}` means none and `null` unknown; Lookout shows nothing for either, but they stay apart so a fixture can say which it means, and the object leaves room for more later (`items` for a per-Subagent list) without a second field.
  - **Fleet's part, two fork commits, Claude Code first, each standing on its own as a PR (0006), touching `list` only:**
    - **Claude Code, running.** In `claude_session` (`core/discovery.rs:346-372`), which already has the Session's registry entry (`~/.claude/sessions/<pid>.json`: `version`, `startedAt`, `sessionId`, `cwd`) and locates its Transcript (`context::locate_transcript`, `core/context.rs:97`) to read `context`, `model` and `effort`. Beside the Transcript, `<sessionId>/subagents/` holds one `agent-<id>.meta.json` per Subagent, next to its `agent-<id>.jsonl`. The sidecar is undocumented (the docs name only the `.jsonl`), observed on 2.1.300–2.1.308: written when the Subagent starts, with `agentType`, `description`, `spawnDepth`, `toolUseId`, `requestShape` (`foreground` or `background`), `parentAgentId` on a nested one and `isFork` on a fork; rewritten with `finished: true` when it ends, from 2.1.301 on, however it ended (completed, failed, `TaskStop`'s killed, the 5 nested ones in the sample included). **Running = a meta without `finished: true` whose mtime is at or after the registry's `startedAt`.** Rules: a registry `version` below 2.1.301, or none, gives `null`, since there every meta lacks `finished` and the count would be every Subagent ever started; no Transcript located gives `null`; no `subagents/` folder gives `{running: 0, finished: 0}`; a meta that doesn't parse (being written, say) is skipped this call. Nested Subagents sit in the same flat folder and count like the rest, so the count is flat across depths. Each file is parsed once per (path, size, mtime), cached as `core/context.rs` caches the Transcript tail, so a poll costs one readdir and a stat per file: the longest-lived Session in the sample had 210 metas, well under a millisecond of stats. A running Subagent's `.jsonl` is never read: its mtime says nothing (a Subagent waiting on a long tool writes nothing, and still runs).
    - **Claude Code, the Turn's start.** The `timestamp` of the last main-thread prompt of yours in the Transcript (verified against the record types in the sample):
      - It is a `user` entry, not `isSidechain`, whose `origin.kind` is `human`: typed, an accepted suggestion, a prompt that waited in the queue, or a slash command that sends a prompt, such as a skill. It's also a prompt Claude Code took mid-turn: an `attachment` of type `queued_command` with `commandMode: "prompt"` and `origin.kind: "human"`, which Fleet's `messages` already shows as your prompt (`core/transcript.rs:768-790`). A Headless Session's prompt has no `origin` and `turnOrigin: "sdk"` (12 seen), and counts too.
      - It is not a tool result (`toolUseResult`, `tool_result` content); a task notification (`origin.kind: "task-notification"`, as a `user` entry or a `queued_command` attachment with `commandMode: "task-notification"`); a meta record (`isMeta`: another Session's message, `origin.kind: "peer"`, an auto-continuation, a command's caveat); a slash command Claude Code handles itself (`/effort`, `/model`: its `<command-name>` and `<local-command-stdout>` entries carry no `origin`); a compaction's summary (`isCompactSummary`); the interrupt marker; or a `last-prompt` record (bookkeeping, without a timestamp).
      - It's found in the tail Fleet already reads for `context`, `model` and `effort` (and VIEW-6's proposed `model_at`) in `core/context.rs`: the same reverse pass over the same buffer looks for it too, and the read widens along the same 256 KiB → 2 MiB → 8 MiB steps until it has both. In the sample the last prompt sat within 256 KiB of the end in about half of the Transcripts, beyond 2 MiB in 4 of 73 and beyond 8 MiB in none (6 MiB at most). None within 8 MiB gives `finished: null`. A Session with no finished meta written since its process started skips the search: `finished` is 0.
    - **Claude Code, finished.** A meta with `finished: true` whose Subagent started at or after the Turn's start. The meta holds no start time, and Claude Code replaces the file when it rewrites it (its birth time equals its mtime, the end, in all 270 finished ones), so the start is the first `timestamp` in the Subagent's `agent-<id>.jsonl`, one line read per Subagent. Only metas whose mtime (the end) is at or after the Turn's start are candidates, so a poll reads the first line of the Subagents that ended in this Turn and no others. Checked against the launching `tool_use` for 594 depth-1 Subagents: the first entry is never before the launch; it comes 0.1 s after it at the median, 26 s at the 95th percentile and 144 s at most. The 10 forks' came within 10 s, so a fork doesn't carry its parent's older entries.
    - **Codex, running.** A child agent (`spawn_agent`) has a rollout of its own in the day folders, with `session_meta.source` = `{subagent: {thread_spawn: {parent_thread_id, depth, …}}}` and the parent's cwd; each of its turns runs `task_started` → `task_complete` or `turn_aborted`, and `followup_task` starts another. `harness::transcripts()` already reads the first lines of every day-folder file written since the oldest process started. **Running = a rollout whose `parent_thread_id` is the Session's thread id (or a descendant's, following parents up, at any `depth`) and whose last turn event is `task_started`**, the rule `codex_state` (`core/harness.rs:10-11`) already uses for the Session's own Busy. A child open between turns doesn't count. A Codex Session with no session id yet (before its first prompt) gives `null`. Fleet's Codex pairing can today pick a child's rollout for the Session itself (Plan item 10); that fix comes before or with this commit, or an interactive Codex Session that spawns agents shows the child's chat and a count of 0.
    - **Codex, the Turn's start and finished.** The Turn's start is the parent's last `task_started` (its `started_at`), which `codex_state` already finds in the tail it reads for the Session's Status and Effort (`core/harness.rs:1071-1077`). In the sample every turn of a parent that ran `spawn_agent` began with a user message (92 of 92), and newer Codex records why a turn started (`turn_attribution.turn_trigger`, seen as `user` and `exec`). A parent turn that a child's message starts, if the TUI does that, isn't your prompt, so Fleet takes only a turn triggered by `user` or `exec`, or any turn on a Codex that doesn't record the trigger. **Finished = the child rollouts of the Session not in a turn now whose last turn started at or after the Turn's start**, each child once however many turns it ran. Newer Codex also tags a child's turn with the `root_turn_id` of the top-level turn behind it (all 547 child turns seen with it name a turn that exists), a tighter link the fork may use instead of comparing times.
    - **pi:** `null`.
    - **Fixtures in the fork:** a `subagents/` folder with a running, a finished, a stopped and a nested meta and one older than `startedAt`, under registry entries at 2.1.300 and 2.1.301; for the Turn, a Transcript whose last prompt is typed, one taken mid-turn, and one followed by task notifications, a local `/effort`, a peer message and tool results, with a Subagent that ended before the prompt, one that started before it and still runs, and one that started and ended after it; a Codex parent rollout with one child in a turn, one that ended in the current turn and one that ended in the turn before. The sidecar's shape is pinned by them per Claude Code version, since nothing documents it.
    - **Cost:** nothing in `list`'s hot path beyond the stats, the widened tail for a Session with finished Subagents, and one line per Subagent that ended in the Turn; measured once built, as `fleet list` was.
  - **Lookout's part:**
    - `server/fleet.ts`: `subagents?: {running: number; finished: number | null} | null` on the raw row. `server/normalize.ts`: `subagents(value)` keeps an object whose `running` is a whole number from 0 to 1,000 (more isn't a count of anything), else null (missing, null, not an object, `running` not a number, negative, fractional or beyond), so an older Fleet shows nothing, as it does for `effort`. Its `finished` passes the same check, and anything else, `null` included, reads as 0, since a "done" Lookout can't count shows nothing either. The row (`shared/types.ts`) gets `subagents: {running: number; finished: number} | null`.
    - **Live updates:** the row changed, so the 2 s poll's diff pushes it over the existing event stream to every tab; the server's status-change tracking (`updated_at`, above) looks only at the Status, so the age doesn't reset and the row keeps its place. Fleet reads the sidecars on every `list`, and Claude Code writes the meta before the launch's `tool_result`, so a start or an end reaches the row within one poll plus Fleet's call. Your next prompt clears `finished` once it's in the Transcript, at the next poll.
    - **UI:** `SessionItem`'s numbers group shows `running` only (`data-field="subagents"`), the icon lucide's `Bot` ([0008](../../decisions/0008-lucide-icons-only.md)); the status line shows both (VIEW-8). The count joins the row's accessible name before the age (SIDE-9.6) and `ROW_TONE`'s contrast test (SIDE-3.11).
    - **Tests:** `normalize` cases, `finished` included (SIDE-9.3); `SessionItem` renders the chip for 1 and 2 running and nothing for 0 and null, nor for `{running: 0, finished: 3}` (SIDE-9.1), with the name (SIDE-9.6); the recorded `fleet list --json` fixture (SIDE-1.4) gains a row with the field; the server's diff and `statusSince` with a count that changes alone, and `order` with counts (SIDE-9.2); a View only row (SIDE-9.3).
    - **Pin:** `e2e/pins.json` moves once the Claude Code commit is on the fork's `lookout` branch; until then the fake `fleet` reports the field and the real one shows nothing.
  - **Stale, crashed, resumed:** a Session that's gone isn't listed (SIDE-1.2), so a count never outlives its Session. A `kill -9` or a crash leaves metas without `finished` forever, but they predate the next process's `startedAt`, so a resumed Session starts from 0 (and from `null` until its Transcript is found). A revived Subagent (`SendMessage` to one that ended runs it again under the same id) rewrites its meta, so it counts again in the process that revived it. "Launches minus finish notifications" from the main Transcript was rejected: it misses nested Subagents (they report to the Subagent that started them), goes wrong on revives, needs both notification forms matched by two ids, and reads a Transcript that can be 100 MB.
  - **Known gaps:**
    - A Subagent that dies inside a still-live process without its meta being finalized counts until that process ends. Not seen in the sample. A "quiet" mark in Fleet (no write to the Subagent's `.jsonl` for N minutes) would soften it, at a stat per running Subagent per poll and a threshold to tune; it's out for now (Key decisions), a Backlog idea if the case shows up live.
    - Whether `finished` is removed while a revived Subagent runs is unverified (`revivedAt` was seen once). If it stays, a revive is invisible to the count until it ends; the fallback is the main Transcript's `SendMessage` result (`resumedAgentId` / `revivedAgentId`), a bigger read. A revived run's start reads as its first run's (the `.jsonl`'s first entry), so one revived and finished in this Turn isn't in `finished`; `revivedAt`, if it's the revive's time, would fix that.
    - A Subagent launched just before your prompt, whose `.jsonl` gets its first entry after it, counts as done in the new Turn once it ends (that first entry came up to 144 s after the launch in the sample). The launching `tool_use`'s own timestamp is exact for a depth-1 Subagent, but means reading the main Transcript further back.
    - A Turn whose prompt lies more than 8 MiB from the Transcript's end gives `finished: null`, so no "done" shows for it (not seen in the sample).
    - A foreground Subagent (headless `-p` runs, fork mode off, or `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`) writes the same sidecar by the sample's shape, but none was watched live. Interactive Sessions on 2.1.302 and later start every Subagent in the background (fork mode), so this matters mostly for Headless Sessions.
    - A Codex child counts only in a turn (Key decisions), so an agent waiting for a `followup_task` reads as none, which is what Fleet means by Idle for the Session itself.
    - No interactive Codex Session in the sample ran `spawn_agent` (its rollouts are 397 `exec` and 15 `vscode` ones, none from the TUI), so the TUI's turn triggers are unseen.
  - **Still to check live** (none of these were run; they need a real Session each):
    1. `TaskStop` and `x` in `/tasks` set `finished: true` promptly (one stopped sample says yes).
    2. A revive through `SendMessage`: is `finished` removed, or `revivedAt` set, while the revived run goes, and is `revivedAt` the revive's time?
    3. `/exit` or a double Ctrl+C while a background Subagent runs: is it killed, and is its meta finalized? After `claude --resume`, does anything resume on its own?
    4. `kill -9` mid-run leaves a meta without `finished`, and the `startedAt` guard hides it after a resume.
    5. A foreground Subagent writes its meta at the start without `finished`.
    6. A Codex TUI Session that runs `spawn_agent`: does Fleet's pairing pick a child rollout (Plan item 10), and does the child's `task_started` → `task_complete` track a running child as it goes?
    7. The Turn in Claude Code: a prompt from the composer, one typed in the terminal and one queued while Busy each clear `finished` once Claude Code takes them, and so does a skill's slash command; a local `/effort`, a peer message and a task notification arriving while Idle don't.
    8. The Turn in a Codex TUI Session: the `turn_trigger` your prompt gets, and whether a child's report starts a turn in the parent.

### Key decisions

- **Order by Status, not by repo**: the sidebar's job is "who needs me", not "where is it".
- **Worktree first, branch as fallback**: work happens in Worktrees, so their name identifies the task better than a branch.
- **Sessions that aren't Controllable get their own "View only" section**, not hidden: awareness without promising control, and the ones you can act on stay on top. An eye icon on the row was tried and read as the opposite.
- **The server polls Fleet and pushes to the UI**: one Fleet call serves every open tab.
- **The main pane is its own spec (VIEW)**: keeps this one small enough to finish.
- **A strip on every row, a tint only on Needs you (SIDE-3.6, 3.7)**: the strip makes every Status readable down the list's edge; tinting only the rows that want action keeps them standing out.
- **One grid with subgrid columns (SIDE-8)**: lines that line up because they're the same grid line can't drift when one side's content changes; matched heights would.
- **The Subagent count comes from Fleet's `list`, not from Lookout reading sidecars (SIDE-9)**: only Fleet has the registry (`startedAt`, `version`) and the Codex pairing the count needs, and 0004 and 0005 keep Transcript reading out of Lookout.
- **An Idle Session with Subagents running stays Idle (SIDE-9)**: Status is Fleet's word for the main thread, and it drives the order (SIDE-3.1), Stop (VIEW-4.4), the rename guard (VIEW-5.12) and the chat's activity row (VIEW-1.10), so redefining it would change all of them; the count says why an Idle Session isn't done, as Claude Code's own tasks row does under an idle prompt.
- **Nothing for none and nothing for "can't tell" (SIDE-9)**: a "0" on every row is noise, and a "?" would ask the reader to care about Harness versions.
- **"Running" means started and not ended, nested ones included (SIDE-9)**: a Subagent waiting quietly on a long tool still works for the Session; a nested one works for it too; one that ended is Claude Code's row for 30 s, not ours.
- **One flat count across depths (SIDE-9)**: a nested Subagent works for the Session like the rest (5 of 256 finished ones in the sample were nested), and "how many agents work for this Session" is the question the row answers.
- **A Codex child counts only while it's in a turn (SIDE-9)**: an agent stays open after its turn ends (all 324 children in the sample did), "in a turn" is what `codex_state` already means by Busy, and counting open agents would count agents doing nothing.
- **The row shows only the running count, first in its numbers group, before the age (SIDE-9.1)**: the list answers "who is still working", so the ones done in the Turn are the selected Session's detail (VIEW-8); the count qualifies the Status, so it reads before the age and the context; and the numbers group never shrinks, so the count is never cut, while a third line would make Idle rows taller.
- **View only rows show it too (SIDE-9.3)**: Fleet reads it for every Session it lists, reading controls nothing, and SIDE-1.5 shows those rows for awareness.
- **No "quiet" mark for a Subagent that stopped writing (Known gaps)**: the one case it covers wasn't seen in 673 sidecars, the `startedAt` guard covers a crashed Session, and it would cost a stat per running Subagent per poll and a threshold to tune.
- **`subagents` is an object, `{running, finished}`, not a bare number (Technical approach)**: it keeps none apart from "can't tell" for fixtures, carries VIEW-8's "done" without a second field, and leaves room for `items` later; the cost is one more key for `normalize.ts` to check.
- **A background shell is a mark on an Idle row, not a Status (SIDE-2.6)**: Claude Code waits for you while it runs, so you can send, rename and switch the model as on any Idle Session; a Status of its own would drop all that and sort it apart from the other Idle rows. It isn't a Subagent, so it doesn't join SIDE-9's count.
- **Two fork commits, Claude Code first (Technical approach)**: Codex's part may wait on the pairing fix (Plan item 10), and Lookout's pin can move after the first, so Claude Code Sessions get the count without waiting.

## Open questions

None.

## Changelog

- 2026-10-16: Created.
- 2026-10-16: Answers from review: order by Status; Worktree name with branch as fallback; Sessions that aren't Controllable greyed out; Status updates live while reordering waits; idle dimming after 4 h, set in a new Settings page (SIDE-7).
- 2026-10-16: Measured `fleet list` (0.1 s); no open questions left.
- 2026-10-16: Ready.
- 2026-10-16: In Progress. Technical approach checked against real Fleet output: the status mapping, `updated_at` meaning per Harness (server tracks status changes itself), pi rows dropped, and two Fleet gaps (Codex approvals read as Busy; Codex ids change after the first prompt).
- 2026-10-16: view-only Sessions get their own section; the eye icon was read as the opposite
- 2026-10-17: Added SIDE-8, one grid for the app shell: the three column headers share one height and one bottom line, and the usage panel's top line is the composer's (or the ended / View only banner's). UX shows the header and dock rows.
- 2026-10-17: Review of SIDE-8: SIDE-8.1 caps the dock row at 40% of the window's height and says the dock line holds only in views with a dock; its tag is `(manual)`.
- 2026-10-17: SIDE-8.1 no longer names a two-line header among the cells that grow a row: the Session header is one line (VIEW-5.1). UX: "Starting…" rows can be selected and count for ↑/↓, j/k and ⌘1–9 (LAUNCH-4.7).
- 2026-10-17: UX: a failed "Starting…" row takes no ⌘ number (LAUNCH-4.7).
- 2026-10-17: SIDE-8.1: the dock row has one resting height in every view (the empty composer with the status line), so the dock line and the usage panel no longer move when switching views (they jumped about 20 px going to Settings). The past-Session note's title stays on one line and its detail on two, like the banners. Hovered or focused (Tab), a banner or the note stays clamped and shows its full text in an overlay above the dock line, so it doesn't grow the dock either. The resting height comes from an invisible empty composer in the sidebar's dock, not a number, and an empty composer no longer sizes to a long placeholder.
- 2026-10-19: Done: every acceptance criterion is ticked.
- 2026-10-19: SIDE-8.1: the right sidebar's header cell is now its tab strip (History, Work; WORK-1.8), not History's search bar, and the header line holds with either tab open.
- 2026-10-20: Changed from Dario's testing: the Statuses didn't stand out in the sidebar, and the markers were small. Added SIDE-3.6–3.10: a strip in its Status's colour on every row, the Needs you tint (already there) made a requirement, markers a size up, the selected row and the one under the pointer visible on every Status (on a Needs you row the pointer changed nothing, and elsewhere selected and hovered rows looked alike), and accessible names unchanged.
- 2026-10-20: Review: on a Needs you row under the pointer or selected, the muted second line and View only titles fell below 4.5:1 (down to 3.6:1 in dark mode). Added SIDE-3.11; that text is the foreground at 70% on the tint, and a test checks every row text's contrast in both modes.
- 2026-10-22: From Dario's earlier testing (Plan item 8): a Session whose Subagents still work looked finished, since a Subagent shows only once it ends (VIEW-1.3). Added SIDE-9: a row shows how many Subagents its Session has running, from a new `subagents` field in the Fleet fork's `list --json`, read like VIEW-5.11's `effort`; nothing for none or when Fleet can't tell; not a Status. Technical approach: the contract, how Fleet derives it per Harness (Claude Code 2.1.301's `subagents/*.meta.json` sidecars with the registry's `startedAt` as the staleness guard; Codex child rollouts in a turn), the server's cleaning, Known gaps and the live checks still owed. Nine open questions with recommendations, for one grilling. Status back to In Progress until SIDE-9 is built. Glossary: Subagent amended (a background shell command isn't one). The two Fleet problems the research found are Plan items 10 and 11, not part of this.
- 2026-10-22: Grilled with Dario; all nine SIDE-9 questions answered and folded in, as Key decisions with their reasons: an Idle Session with Subagents running stays Idle; the main pane shows them on the status line only (VIEW-8); a Codex child counts only in a turn; the count is flat across depths; View only rows show it; no "quiet" mark; two fork commits, Claude Code first. Changed: the count sits first in the numbers group, before the age (SIDE-9.1, 9.6, UX), and the row never shows the ones done; the field is `{running, finished}`, `finished` being the Subagents that started and ended in the current Turn (new in the Glossary), for VIEW-8's "done". Technical approach: how Fleet finds the Turn's start per Harness (Claude Code's last main-thread prompt of yours, in the tail it already reads; Codex's last turn start) and derives `finished`, checked against real Transcripts' record types; new Known gaps and two more live checks. VIEW-7 renumbered to VIEW-8 (VIEW-7 is the Effort menu).
- 2026-10-22: From Dario's testing: Claude Code 2.1.308 added a `shell` status (Idle, with a background shell command still running), which Fleet passes through, and those Sessions showed as Unknown, losing everything an Idle row gets. Added SIDE-2.6: `shell` is Idle, and the row marks the running shell with a terminal icon in Idle's grey (UX, Technical approach, Key decisions).
- 2026-10-22: Design system, colour by meaning (DS-3): the Harness mark is monochrome, in the row's quieter colour (DS-3.1); the context number and ring take the status line's warning and danger colours above 40% and 60% (DS-3.5); the stale-list and lost-server banners are in the info tone, not amber (DS-3.3). SIDE-6.2's wording stays.
- 2026-10-22: Design system (DS-4, DS-7, DS-8): "Fleet isn't installed" (SIDE-6.1) is an error Alert with a command block, New Session and Settings are `sm` icon buttons 4 px apart (Settings gains a "Settings" tooltip), and the empty states are EmptyStates. SIDE-6.1's and SIDE-6.2's wording stays.
- 2026-10-22: Design system (DS-9, DS-10): the Session list is focusable, a listbox naming the selected Session as its active option, with a ring for keyboard focus only; Busy's dot pulses only for 10 s after the Session became Busy (UX, "Markers" and "Keyboard focus"). SIDE-5's keys are unchanged.
- 2026-10-22: Design system review fix: the "Keyboard focus" bullet now says the listbox names no option when nothing is selected or the filter hides the selected Session, as built (DS-9.1).
- 2026-10-23: Built Lookout's half of SIDE-9 against the agreed Fleet contract: normalized counts, the row's running count and accessible name, count-only poll diffs and stable order/age, recorded and fake Fleet fixtures, and contrast checks. SIDE-9.1–9.3 and 9.6 verified by automated tests. Fleet's pin stays unchanged until the fork is ready; SIDE-9.4's live check remains open. SIDE-9.5 checked in headless Chromium against the fake Fleet, light and dark, at 280 and 420 px with 1 and 3 running: the branch truncates first, the count stays whole and clear of the marker and ring. No requirement or UX changed.
