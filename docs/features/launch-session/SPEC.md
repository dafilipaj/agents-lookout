---
title: Start Sessions
code: LAUNCH
status: In Progress
created: 2026-10-16
updated: 2026-10-16
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
- [x] LAUNCH-4.2 A "Starting…" row appears in the sidebar at once, is replaced by the real Session as soon as Fleet reports it, and that Session is selected. (manual)
- [x] LAUNCH-4.3 A multi-line first prompt arrives intact, line breaks included. (manual)
- [x] LAUNCH-4.4 If starting fails, the launcher stays open, shows the error, and keeps everything you entered. (test)
- [x] LAUNCH-4.5 If the Session hasn't appeared after 15 s, the "Starting…" row turns into an error showing the last lines of its terminal, and the Session host is left running so you can look. (manual)

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

## Technical approach

- **Starting:** the server runs `fleet --local spawn --backend tmux --harness <h> --dir <d> [--model <m>] [--name <n>] [-- <prompt>]`, as an argv array. The prompt goes after `--`, so one starting with `-` isn't read as a flag.
  - Fleet creates a new tmux session in `<dir>` (`new-session -c <dir>`), which opens a login shell.
  - It then types `<harness> [-n <name>] [<prompt>]` into that shell, so `claude` resolves to the telemetry wrapper ([0001](../../decisions/0001-tmux-as-hidden-session-host.md), [0002](../../decisions/0002-start-sessions-through-a-login-shell.md)).
  - A multi-line prompt is typed as one ANSI-C quoted argument (`$'…\n…'`), so it arrives as one message. If the typed line would be over 900 bytes, Fleet writes the prompt to `~/.claude/fleet-prompts/` and types `"$(cat <file>)"` instead.
  - `fleet spawn` has no `--json`. It prints `spawned tmux session <name>  (attach: …) in <dir>`. The server reads the session name from that line, keeps it for LAUNCH-4.5, and matches the new Session by `tmux_session` in `fleet list --json`.
  - `--name` becomes Claude's `-n` and, sanitized, the tmux session's name. Codex has no `-n`, so for Codex the name only names the Session host. A name that's already taken is an error from Fleet; Lookout rewords it without mentioning tmux (0001).
  - **Environment:** Lookout strips `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_PID`, `CLAUDE_EFFORT` and `OTEL_*` that it inherited (for example when its server runs inside a Claude Code Session) from what it passes to `fleet`, and adds nothing. When no tmux server is running, the one Fleet starts takes its global environment from this cleaned one. Verified 2026-10-16: tmux's global environment, the shell and `claude` carried none of them, and in `~/Projects/work` the wrapper alone added the `OTEL_*` block (with `repo=work`).
- **Verified 2026-10-16:** a fresh tmux session's shell is `-zsh`, and `claude` resolves there to the shell function (the wrapper).
- **Shortcut:** a window-level key handler opens the launcher on N when focus isn't in an input, textarea, select or editable element, and on ⌘N anywhere. A normal Chrome tab keeps ⌘N (new window) for itself, so the page never sees it there; in an installed-app window it does.
- **Harnesses and models:** from `fleet --local harness list --json`, cached for 10 minutes. Each entry is `{ id, label, command, installed, models: [{ id, label }] }`; the first model, id `''`, is the Harness's own default (`--model` is then left out). Model ids are letters, digits and `._[]-/:` only (Fleet's rule). pi is dropped.
- **Start directories:** only one from the Settings list is accepted, so the server never starts anything elsewhere. One that's added must exist; `~` is expanded by the server.
- **Settings:** start directories live in the server's settings file (the same one as SIDE-7). So does the last-used choice for LAUNCH-1.2.

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
