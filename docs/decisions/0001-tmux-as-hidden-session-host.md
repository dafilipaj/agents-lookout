---
status: Accepted
date: 2026-10-16
---

# 0001. Sessions run in tmux, and Lookout never shows tmux

## Context

- The earlier tmux dashboard failed partly because mouse handling and switching tmux panes were glitchy.
- A Session must be openable in iTerm2 at any moment, without restarting it.
- Claude Code OTel telemetry must keep working (see 0002).
- Sessions must survive Lookout restarting or crashing.

## Decision

- Every Session Lookout starts runs in its own tmux session (one Session per tmux session).
- Lookout's UI never shows tmux. Inside the app, a Session is a chat view built from its Transcript, a message composer, and a plain-text preview of the terminal.
- "Open in iTerm2" attaches a second view to the same running process: `tmux -CC attach -t =<name>` (iTerm2's tmux integration renders native tabs, scrollback and mouse), with plain `tmux attach` as the fallback.

## Alternatives rejected

- **Own terminal daemon (node-pty) with xterm.js in the app**: what most public apps do, but opening a Session in iTerm2 would need a custom attach tool.
- **Headless agents (Agent SDK, `claude -p`)**: there's no terminal to open in iTerm2, and no OTel (see 0002).

## Consequences

- To verify before relying on `-CC`: whether closing an iTerm2 tab in integration mode kills the tmux window (and so the Session) instead of detaching. Verified 2026-10-16; the plain-attach fallback is dropped by [0011](0011-open-in-iterm2-through-its-tmux-integration.md).
- A live terminal inside the app is deferred. If added later, it attaches xterm.js to the same tmux session, which brings tmux's mouse behaviour back into that view.
