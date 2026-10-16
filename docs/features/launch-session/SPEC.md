---
title: Start Sessions
code: LAUNCH
status: Ready
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

- [ ] LAUNCH-1.1 ⌘N, or the "+" button at the top of the sidebar, opens the launcher with the cursor in the prompt field. (manual)
- [ ] LAUNCH-1.2 The launcher starts with the Harness, model and start directory you used last. (test)
- [ ] LAUNCH-1.3 Esc closes the launcher; reopening it within the same page load restores what you'd typed. (manual)

### LAUNCH-2 Choose where

- [ ] LAUNCH-2.1 The start directory is picked from the list in Settings (default: `~/Projects/work`). (test)
- [ ] LAUNCH-2.2 Start directories can be added and removed on the Settings page. (manual)

### LAUNCH-3 Choose what

- [ ] LAUNCH-3.1 Harness: Claude Code (default) or Codex; a Harness that isn't installed is shown disabled. (test)
- [ ] LAUNCH-3.2 Model: the models Fleet lists for the chosen Harness, defaulting to the Harness's own default. (test)
- [ ] LAUNCH-3.3 Name and first prompt are optional. The prompt field accepts multiple lines. (test)

### LAUNCH-4 Start

- [ ] LAUNCH-4.1 ⌘Enter or Start creates the Session in its own Session host. Fleet then reports it with backend `tmux`. (test)
- [ ] LAUNCH-4.2 A "Starting…" row appears in the sidebar at once, is replaced by the real Session as soon as Fleet reports it, and that Session is selected. (manual)
- [ ] LAUNCH-4.3 A multi-line first prompt arrives intact, line breaks included. (manual)
- [ ] LAUNCH-4.4 If starting fails, the launcher stays open, shows the error, and keeps everything you entered. (test)
- [ ] LAUNCH-4.5 If the Session hasn't appeared after 15 s, the "Starting…" row turns into an error showing the last lines of its terminal, and the Session host is left running so you can look. (manual)

### LAUNCH-5 Telemetry

- [ ] LAUNCH-5.1 A Claude Code Session started in a `productiveio/*` repo appears in Grafana under its session ID. (manual)
- [ ] LAUNCH-5.2 Lookout adds no `OTEL_*` or `CLAUDE_CODE_*` variables of its own to what it starts ([0002](../../decisions/0002-start-sessions-through-a-login-shell.md)). (test)

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

## Technical approach

- **Starting:** the server runs `fleet spawn --local --backend tmux --harness <h> [--model <m>] --dir <d> [--name <n>] [<prompt>]`.
  - Fleet creates a new tmux session, which opens a login shell.
  - It then types `cd '<dir>' && <harness> …` into that shell, so `claude` resolves to the telemetry wrapper ([0001](../../decisions/0001-tmux-as-hidden-session-host.md), [0002](../../decisions/0002-start-sessions-through-a-login-shell.md)).
  - Fleet prints the tmux target, which the server keeps for LAUNCH-4.5.
- **Verified 2026-10-16:** a fresh tmux session's shell is `-zsh`, and `claude` resolves there to the shell function (the wrapper).
- **Harnesses and models:** from `fleet harness list --json`, cached for 10 minutes.
- **Settings:** start directories live in the server's settings file (the same one as SIDE-7). So does the last-used choice for LAUNCH-1.2.

### Key decisions

- **Always the tmux backend, set explicitly**: Fleet's default on macOS is iTerm2, which would break 0001.
- **On a start timeout, read the pane directly** (`tmux capture-pane` on the target Fleet printed): before Fleet reports the Session, there's nothing to `fleet peek`. This is the only place Lookout touches tmux itself.
- **No Worktree handling at launch**: moving into the right Worktree is the agent's job in our workflow.

## Open questions

- [ ] A new directory makes Claude Code ask whether to trust it. Does Fleet's CLI spawn answer that, and does a Session waiting on it show up in `fleet list`? Check while building; LAUNCH-4.5 covers the worst case. *(not blocking)*

## Changelog

- 2026-10-16: Created.
- 2026-10-16: Review answers: no Worktree picking or search (start directories only); creating Worktrees is a non-goal; tmux backend and auto-select confirmed; trust prompt not blocking. Ready.
