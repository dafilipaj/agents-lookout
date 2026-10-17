---
title: Session sidebar
code: SIDE
status: In Progress
created: 2026-10-16
updated: 2026-10-17
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

### SIDE-3 Status at a glance

- [x] SIDE-3.1 Controllable Sessions come first, then the "View only" section. Within each, rows are ordered Needs you → Busy → Idle → Unknown, and within each Status the most recent status change comes first. (test)
- [x] SIDE-3.2 Each Status has its own marker. Needs you is the most prominent, and is recognizable without colour. (manual)
- [x] SIDE-3.3 The browser tab title shows how many Sessions need you, e.g. "(2) Lookout", and no count when none do. (test)
- [x] SIDE-3.4 Status markers and row text update live, also while the pointer is over the sidebar. Only reordering waits: rows don't move while the pointer is over the sidebar, and pending moves apply once it leaves. (manual)
- [x] SIDE-3.5 A Session Idle for longer than the idle threshold (default 4 h, SIDE-7) is dimmed. It returns to normal as soon as its Status changes. (test)

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

The app shell: the Session sidebar, the main pane and the right sidebar (HIST) are columns of one grid, so their horizontal lines line up.

- [x] SIDE-8.1 The three column headers (the Filter bar, the main pane's header, History's search bar) share one height, and their bottom borders read as one continuous line. The line above the usage panel (USAGE-1) continues as the line above the composer, or above the "View only" or "This Session ended" banner; the Terminal row stays above it and the status line below it. At rest the dock row has one height in every main-pane view: that of a live Session's empty one-line composer with the status line under it, or the usage panel's if that is taller. An empty composer is one line high whatever its placeholder, a long Session title included. The banners and the past-Session note fit inside it, hovered or focused too, so switching views (live, View only, ended, past, Starting, Settings, nothing selected) moves neither the dock line nor the usage panel's content. When a cell on either side grows past it (a multi-line message in the composer, more usage rows), the whole row grows with it, so the lines stay aligned; back at one line, the composer returns the row to its resting height. The dock row grows to at most 40% of the window's height, so the content row (the Session list, the chat) keeps the rest; a dock cell taller than that scrolls. The header line holds in every main-pane view (a Session, a past Session, a start under way, Settings, nothing selected), with History open or closed; the dock line wherever the view has a dock, and on the sidebar's side in every view. (manual)

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

## UX

```
┌──────────────────────────────┬───────────────────────────────────┐
│ / filter                + ⚙  │ header (VIEW)                     │
├──────────────────────────────┼───────────────────────────────────┤
│ ◆ fix-deal-rates        [cl] │   selected Session (VIEW spec)    │
│   work · [wt] crm-rates · 2m │                                   │
│   permission: Bash(rspec …)  │                                   │
│ ● kg-hook-review        [ox] │                                   │
│   work · [br] main · 12s 41% │                                   │
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

- `[cl]` and `[ox]` are the Harness marks: Claude's and OpenAI's (for Codex), each with its name as the accessible label.
- "View only" holds the Sessions that aren't Controllable, in the same Status order. Keyboard navigation, ⌘1–9, ⌘J and the filter run across both sections, and hover-freeze (SIDE-3.4) applies to both.
- "Starting…" rows (LAUNCH-4) sit above both sections and are rows like any other for ↑/↓, j/k and ⌘1–9 (LAUNCH-4.7): the first of them is ⌘1, and a failed one takes no number. ⌘J skips them (they never Need you), and the filter leaves them in place. Selecting one shows the start in the main pane (LAUNCH-4.6).

- Markers: ◆ Needs you, ● Busy, ○ Idle, ? Unknown.
- `[wt]` and `[br]` stand for the worktree and branch icons (e.g. lucide `FolderGit2` and `GitBranch`).
- ⚙ opens Settings.
- Empty state: "No live Sessions", with a hint to start one (N, or `claude` / `codex` in iTerm2). With only view-only Sessions, the same hint sits above the "View only" header.
- Error states: see SIDE-6.

## Technical approach

- **Polling:** the server calls `fleet list --json` every 2 s, compares the result with the previous one, and pushes changes to the UI over server-sent events. The UI never calls Fleet itself ([0003](../../decisions/0003-browser-first-react-stack.md), [0004](../../decisions/0004-fleet-cli-as-session-layer.md)).
- **Fields used from Fleet** (`fleet --local list --json`, checked against Fleet 38a461c's `docs/architecture.md` and real output on 2026-10-16):
  - `display_title`, `harness`, `context.pct`, `cwd`, `model`.
  - `status`: `waiting` → Needs you, `busy` → Busy, `idle` → Idle, anything else → Unknown.
  - `waiting_for`, shown only on Needs you rows. For a Claude question it's the generic `input needed`.
  - `backend`: `tmux` or `iterm` means Controllable.
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
- **Settings:** stored by the server in `~/.config/lookout/settings.json`, not in browser storage. A change is pushed to every open tab over the same event stream.
- **Session identity:** `session_id` when present, otherwise `<harness>:<pid>`. Fleet's `session_id` is Claude's UUID, so Codex rows may not have one.
- **Prerequisite:** Fleet installed and pinned with `cargo install --git https://github.com/ilucin/fleet --rev 38a461c --locked fleet`.
- **Measured 2026-10-16:** `fleet list --json` takes 0.09–0.13 s with 3 live Sessions, so a 2 s poll is cheap. All 3 ran in Orca and came back with backend `unknown`, i.e. not Controllable.

### Key decisions

- **Order by Status, not by repo**: the sidebar's job is "who needs me", not "where is it".
- **Worktree first, branch as fallback**: work happens in Worktrees, so their name identifies the task better than a branch.
- **Sessions that aren't Controllable get their own "View only" section**, not hidden: awareness without promising control, and the ones you can act on stay on top. An eye icon on the row was tried and read as the opposite.
- **The server polls Fleet and pushes to the UI**: one Fleet call serves every open tab.
- **The main pane is its own spec (VIEW)**: keeps this one small enough to finish.
- **One grid with subgrid columns (SIDE-8)**: lines that line up because they're the same grid line can't drift when one side's content changes; matched heights would.

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
