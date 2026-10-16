---
title: Session sidebar
code: SIDE
status: In Progress
created: 2026-10-16
updated: 2026-10-16
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
- [x] SIDE-1.5 Sessions that aren't Controllable (e.g. Claude Desktop, IDE terminals) are shown greyed out, so you know they exist. (test)

### SIDE-2 One row per Session

- [x] SIDE-2.1 Each row shows the title, Harness, Status, repo name, where the Session works (SIDE-2.2), and time since the last status change. (test)
- [x] SIDE-2.2 When the working directory is a linked Worktree, the row shows the Worktree's name with a worktree icon; otherwise it shows the git branch with a branch icon. The two icons are clearly different. (test)
- [x] SIDE-2.3 A Needs you row also shows what it's waiting for, on one line. (test)
- [x] SIDE-2.4 Context usage shows as a percentage when Fleet reports it, and not at all when it doesn't. (test)
- [x] SIDE-2.5 Rows fit a 280 px sidebar without horizontal scrolling; long text is truncated, with the full text on hover. (manual)

### SIDE-3 Status at a glance

- [x] SIDE-3.1 Rows are ordered Needs you → Busy → Idle → Unknown; within each Status, the most recent status change comes first. (test)
- [x] SIDE-3.2 Each Status has its own marker. Needs you is the most prominent, and is recognizable without colour. (manual)
- [x] SIDE-3.3 The browser tab title shows how many Sessions need you, e.g. "(2) Lookout", and no count when none do. (test)
- [x] SIDE-3.4 Status markers and row text update live, also while the pointer is over the sidebar. Only reordering waits: rows don't move while the pointer is over the sidebar, and pending moves apply once it leaves. (manual)
- [x] SIDE-3.5 A Session Idle for longer than the idle threshold (default 4 h, SIDE-7) is dimmed. It returns to normal as soon as its Status changes. (test)

### SIDE-4 Switch Sessions

- [x] SIDE-4.1 Clicking a row selects that Session and shows it in the main pane (what the main pane contains is the VIEW spec). (manual)
- [x] SIDE-4.2 The selected Session is in the URL, so reload and back/forward keep it. (test)
- [x] SIDE-4.3 If the selected Session ends, it stays selected and the main pane says it ended, until you select another. (manual)

### SIDE-5 Keyboard

- [x] SIDE-5.1 ↑/↓ and j/k move the selection. (manual)
- [x] SIDE-5.2 ⌘1–⌘9 select the first to ninth row. (manual)
- [x] SIDE-5.3 ⌘J selects the next Session that needs you. (manual)
- [x] SIDE-5.4 `/` focuses a filter box; typing filters rows by title, repo, Worktree or branch; Esc clears it. (test)

### SIDE-6 When Fleet fails

- [x] SIDE-6.1 If `fleet` isn't installed, the sidebar says how to install it instead of showing an empty list. (test)
- [x] SIDE-6.2 If a `fleet list` call fails or times out, the last list stays visible, dimmed, with a banner saying how long it's been stale. It recovers on its own. (test)

### SIDE-7 Settings

- [x] SIDE-7.1 A Settings page, reachable from the sidebar, lets you change the idle threshold in hours. (manual)
- [x] SIDE-7.2 The server stores settings in a file, so they survive restarts and are the same in every browser tab. A changed value applies without reloading. (test)

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
│ / filter                  ⚙  │                                   │
│ ◆ fix-deal-rates      Claude │   selected Session (VIEW spec)    │
│   work · [wt] crm-rates · 2m │                                   │
│   permission: Bash(rspec …)  │                                   │
│ ● kg-hook-review       Codex │                                   │
│   work · [br] main · 12s 41% │                                   │
│ ○ spec-lookout        Claude │                                   │
│   agents-lookout · [br] main │                                   │
│ ○ desktop-chat   (greyed out)│                                   │
└──────────────────────────────┴───────────────────────────────────┘
```

- Markers: ◆ Needs you, ● Busy, ○ Idle, ? Unknown.
- `[wt]` and `[br]` stand for the worktree and branch icons (e.g. lucide `FolderGit2` and `GitBranch`).
- ⚙ opens Settings.
- Empty state: "No live Sessions", with a hint to start one in iTerm2.
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
- **Sessions that aren't Controllable are shown greyed out**, not hidden: awareness without promising control.
- **The server polls Fleet and pushes to the UI**: one Fleet call serves every open tab.
- **The main pane is its own spec (VIEW)**: keeps this one small enough to finish.

## Open questions

None.

## Changelog

- 2026-10-16: Created.
- 2026-10-16: Answers from review: order by Status; Worktree name with branch as fallback; Sessions that aren't Controllable greyed out; Status updates live while reordering waits; idle dimming after 4 h, set in a new Settings page (SIDE-7).
- 2026-10-16: Measured `fleet list` (0.1 s); no open questions left.
- 2026-10-16: Ready.
- 2026-10-16: In Progress. Technical approach checked against real Fleet output: the status mapping, `updated_at` meaning per Harness (server tracks status changes itself), pi rows dropped, and two Fleet gaps (Codex approvals read as Busy; Codex ids change after the first prompt).
