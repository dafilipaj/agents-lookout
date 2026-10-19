---
title: Start Sessions
code: LAUNCH
status: Done
created: 2026-10-16
updated: 2026-10-17
---

# Start Sessions

## Summary

Start a Claude Code or Codex Session from Lookout in a few keystrokes: pick a start directory, a Harness and model, and optionally a name and first prompt. The Session runs in its own Session host, so it's Controllable, sends telemetry, and can be opened in iTerm2 later.

## Problem

Sessions started in Orca can't be controlled from Lookout (SIDE shows them greyed out). For Lookout to be useful, new work has to start in a Session host, and doing that by hand (tmux, `cd`, `claude`) is slower than clicking "+" in Orca.

## Requirements

### LAUNCH-1 Open the launcher

- [x] LAUNCH-1.1 N (when focus isn't in a text field), ⌘N in an installed-app window, or the "+" button at the top of the sidebar, opens the launcher with the cursor in the prompt field. (manual)
- [x] LAUNCH-1.2 The launcher starts with the Harness, model and start directory you used last. (test)
- [x] LAUNCH-1.3 Esc closes the launcher; reopening it within the same page load restores what you'd typed. (manual)

### LAUNCH-2 Choose where

- [x] LAUNCH-2.1 The start directory is picked from the list in Settings (default: `~/Projects/work`). (test)
- [x] LAUNCH-2.2 Start directories can be added and removed on the Settings page. (manual)

### LAUNCH-3 Choose what

- [x] LAUNCH-3.1 Harness: Claude Code (default) or Codex; a Harness that isn't installed is shown disabled. (test)
- [x] LAUNCH-3.2 Model: the models Fleet lists for the chosen Harness, defaulting to the Harness's own default. (test)
- [x] LAUNCH-3.3 Name and first prompt are optional. The prompt field accepts multiple lines. (test)

### LAUNCH-4 Start

- [x] LAUNCH-4.1 ⌘Enter or Start creates the Session in its own Session host. Fleet then reports it with backend `tmux`. (test)
- [x] LAUNCH-4.2 Start adds a "Starting…" row at the top of the sidebar and selects it at once. When Fleet reports the Session, it replaces the row and takes over the selection, but only while the "Starting…" row is still selected: if you moved to another Session or view meanwhile, you stay there. (test)
- [x] LAUNCH-4.3 A multi-line first prompt arrives intact, line breaks included. (manual)
- [x] LAUNCH-4.4 If starting fails, the launcher stays open, shows the error, and keeps everything you entered. (test)
- [x] LAUNCH-4.5 If the Session hasn't appeared after 15 s, the "Starting…" row turns into an error, and the Session host is left running so you can look. The error and the last lines of its terminal show in the row while it isn't selected; selected, the row stays compact and the starting view shows them (LAUNCH-4.6). (manual)
- [x] LAUNCH-4.6 While a "Starting…" row is selected, the main pane shows the start: its name, Harness, start directory and the time since Start; then, once it failed (LAUNCH-4.5), the error and its terminal's last lines in place of the waiting note. (test)
- [x] LAUNCH-4.7 "Starting…" rows count as rows for ↑/↓, j/k and ⌘1–9 (SIDE-5.1, SIDE-5.2), in the order shown, above the Sessions. A failed one takes no ⌘ number (it stays until dismissed); ↑/↓ and j/k still reach it. ⌘J skips them all. (test)

### LAUNCH-5 Telemetry

- [x] LAUNCH-5.1 A Claude Code Session started in a `productiveio/*` repo appears in Grafana under its session ID. (manual)
- [x] LAUNCH-5.2 Lookout adds no `OTEL_*` or `CLAUDE_CODE_*` variables of its own to what it starts ([0002](../../decisions/0002-start-sessions-through-a-login-shell.md)). (test)

## Non-goals

- Picking, searching or creating Worktrees. You start in the repo, tell the agent what you're working on, and it moves to the right Worktree itself. Picking existing Worktrees may become its own feature later.
- Starting in an iTerm2 tab. Sessions always start in a Session host; ITERM opens them in iTerm2.
- Permission modes, effort and other Harness flags.
- Attachments, voice input, prompt templates.
- Starting several Sessions at once.
- Other Hosts, and the pi Harness.

## UX

```
┌ New Session ───────────────────────────────────────────┐
│ Directory  [ ~/Projects/work                        ▾] │
│ Harness    (•) Claude Code   ( ) Codex                 │
│ Model      [ Default                                ▾] │
│ Name       [ optional                                ] │
│ Prompt     ┌─────────────────────────────────────────┐ │
│            │                                         │ │
│            └─────────────────────────────────────────┘ │
│                                   Esc  Cancel  ⌘↵ Start│
└────────────────────────────────────────────────────────┘
```

- Opening: N, ⌘N in an installed-app window, or "+". The "+" button's tooltip and the empty main pane show the shortcut.

```
┌───────────────┬──────────────────────────────────────────────────────┐
│ / filter  + ⚙ │ ◌ fix-rates · Claude Code                 Starting…  │
├───────────────┼──────────────────────────────────────────────────────┤
│ ◌ fix-rates   │ Directory  ~/Projects/work                           │
│   Starting…   │ Started    4s ago                                    │
│ ◆ kg-hook-…   │ Waiting for Fleet to report the Session…             │
└───────────────┴──────────────────────────────────────────────────────┘
```

- Starting view (LAUNCH-4.6): a header like a Session's (spinner, name, Harness, "Starting…"), then the start directory (wrapped, never cut) and the time since Start. Once failed: "Didn't start" in the header, then the error and the terminal's last lines in full, scrollable. Each fact shows once. It has no dock: its content runs to the bottom (SIDE-8).
- A failed row, while selected, is compact: its name, "Didn't start · folder · age" and Dismiss; the view carries the error and the lines. Unselected, it shows them itself (LAUNCH-4.5).
- A failed start is dismissed from its sidebar row. Dismissing the selected one selects the next start below it (else the one above); with no other start left, nothing is selected (the empty main pane). Focus then goes to the Dismiss button of the start that took its place, if it failed too, else to the main pane.
- The "Starting…" rows are a plain list, not options: a failed row holds a Dismiss button, which an option can't. The selected row has `aria-current`.

## Technical approach

- **Starting:** the server runs `fleet --local spawn --json --backend tmux --harness <h> --dir <d> [--model <m>] [--name <n>] [-- <prompt>]`, as an argv array. The prompt goes after `--`, so one starting with `-` isn't read as a flag.
  - Fleet creates a new tmux session in `<dir>` (`new-session -c <dir>`), which opens a login shell.
  - It then types `<harness> [-n <name>] [<prompt>]` into that shell, so `claude` resolves to the telemetry wrapper ([0001](../../decisions/0001-tmux-as-hidden-session-host.md), [0002](../../decisions/0002-start-sessions-through-a-login-shell.md)).
  - A multi-line prompt is typed as one ANSI-C quoted argument (`$'…\n…'`), so it arrives as one message. If the typed line would be over 900 bytes, Fleet writes the prompt to `~/.claude/fleet-prompts/` and types `"$(cat <file>)"` instead.
  - `fleet spawn --json` (the Fleet fork, decision 0006) prints one object: `tmux_session` on success, `{ok: false, kind, error}` with exit 1 on failure. The server keeps `tmux_session` for LAUNCH-4.5 and matches the new Session by it in `fleet list --json`; `name_taken` becomes the name field's error, without naming tmux. HIST's resume uses the same path.
  - `--name` becomes Claude's `-n` and, sanitized, the tmux session's name. Codex has no `-n`, so for Codex the name only names the Session host. A name that's already taken is an error from Fleet; Lookout rewords it without mentioning tmux (0001).
  - **Environment:** Lookout strips `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_PID`, `CLAUDE_EFFORT` and `OTEL_*` that it inherited (for example when its server runs inside a Claude Code Session) from what it passes to `fleet`, and adds nothing. When no tmux server is running, the one Fleet starts takes its global environment from this cleaned one. Verified 2026-10-16: tmux's global environment, the shell and `claude` carried none of them, and in `~/Projects/work` the wrapper alone added the `OTEL_*` block (with `repo=work`).
- **Verified 2026-10-16:** a fresh tmux session's shell is `-zsh`, and `claude` resolves there to the shell function (the wrapper).
- **Shortcut:** a window-level key handler opens the launcher on N when focus isn't in an input, textarea, select or editable element, and on ⌘N anywhere. A normal Chrome tab keeps ⌘N (new window) for itself, so the page never sees it there; in an installed-app window it does.
- **Harnesses and models:** from `fleet --local harness list --json`, cached for 10 minutes. Each entry is `{ id, label, command, installed, models: [{ id, label }] }`; the first model, id `''`, is the Harness's own default (`--model` is then left out). Model ids are letters, digits and `._[]-/:` only (Fleet's rule). pi is dropped.
- **Start directories:** only one from the Settings list is accepted, so the server never starts anything elsewhere. One that's added must exist; `~` is expanded by the server.
- **Settings:** start directories live in the server's settings file (the same one as SIDE-7). So does the last-used choice for LAUNCH-1.2.
- **Selecting a start (LAUNCH-4.2, 4.6):** a selected "Starting…" row is in the URL, `/l/<launch id>`, like a Session (SIDE-4.2).
  - The tab picks the launch id (a UUID) and sends it as `launchId` with `POST /api/launch` (and HIST's resume). So the moment you press Start, it shows that row itself and selects it, before `fleet spawn` returns. The server uses that id, and refuses a malformed one (400) or one it already has (409); without one it makes one up.
  - The tab's own row stands until the server's `launches` list names it. Once the server has listed it, its list is the truth: a late answer never brings back a start dismissed meanwhile.
  - An answer moves the selection only while the URL still shows that start: a failed start goes back (replaced) to where Start was pressed; a resume that finds the Session live, or can't resume it, or has one under way already, replaces the URL with that. Anywhere you moved to meanwhile stays.
  - When a `started` mapping names the launch and the URL still shows it, the tab replaces the URL with the Session's, before paint, so Back doesn't return to a start that's gone; any other selection is left alone.
  - The snapshot's `started` (kept 60 s) lets a tab that reconnects or reloads take over too. It follows the Session's process (pid and Harness), so a Codex Session that got its session id meanwhile is named by its new id.
  - A launch id the tab doesn't know (dismissed in another tab, a reload long after, or Lookout restarted: launches live in the server's memory) shows "This start is no longer listed".

### Key decisions

- **Always the tmux backend, set explicitly**: Fleet's default on macOS is iTerm2, which would break 0001.
- **On a start timeout, read the pane directly** (`tmux capture-pane` on the target Fleet printed): before Fleet reports the Session, there's nothing to `fleet peek`. This is the only place Lookout touches tmux itself.
- **No Worktree handling at launch**: moving into the right Worktree is the agent's job in our workflow.

## Open questions

None.

Resolved while building (2026-10-16): `fleet spawn` (the CLI) never answers a trust prompt; only Fleet's web spawner does.
- **Claude Code:** a Session waiting on "Quick safety check… Yes, I trust this folder" isn't in `fleet list` at all, because Claude registers only after trust. So LAUNCH-4.5 catches it, and its error shows that prompt. On this Mac, `~/.claude.json` trusts `/` but has `hasTrustDialogAccepted: false` for the home directory, so new directories under `~` ask and `/private/tmp/…` doesn't.
- **Codex:** a Session waiting on its trust prompt (or on its "Update available" prompt) *is* in `fleet list`, as Idle, with no session id. So its start succeeds and the Session shows as Idle, not Needs you.

## Changelog

- 2026-10-16: Created.
- 2026-10-16: Review answers: no Worktree picking or search (start directories only); creating Worktrees is a non-goal; tmux backend and auto-select confirmed; trust prompt not blocking. Ready.
- 2026-10-16: In Progress. Technical approach checked against Fleet 38a461c: `spawn` prints text, not the tmux target; the command typed has no `cd`; multi-line prompts; harness list shape; Lookout strips inherited `OTEL_*`/`CLAUDE_CODE_*` from what it starts (LAUNCH-5.2). Open question on the trust prompt answered with what was seen.
- 2026-10-16: N added because Chrome keeps ⌘N in a normal tab.
- 2026-10-16: LAUNCH-5.1 verified in Grafana (Loki `claude-code-telemetry`): a Session started through Lookout in `~/Projects/work` sent its events with `repo=work` and `terminal.type=tmux`.
- 2026-10-17: `fleet spawn` is read through `--json` (the fork has it now), shared with HIST's resume.
- 2026-10-17: LAUNCH-4.2 amended: Start selects the "Starting…" row at once, and the real Session takes over the selection only while that row is still selected, so you're never pulled away from a Session you moved to. Added LAUNCH-4.6, a starting view in the main pane (name, Harness, directory, time since Start; the error and terminal lines once failed), and LAUNCH-4.7, "Starting…" rows in keyboard navigation. Technical approach: the `/l/<id>` URL and the take-over. HIST's resume does the same (HIST-3.1).
- 2026-10-17: Review of selecting a start: the tab picks the launch id, so Start selects its row the moment you press it, and a late answer never moves you once you've moved on (LAUNCH-4.2 now holds as written). LAUNCH-4.5: the failed row stays compact while selected. LAUNCH-4.6: the error and lines replace the waiting note. LAUNCH-4.7: a failed start takes no ⌘ number. UX: what follows dismissing the selected start, and where focus goes; the starting view shows each fact once. Technical approach: `launchId`, answers that respect where you are, `started` following an id change.
- 2026-10-19: Done: every acceptance criterion is ticked.
