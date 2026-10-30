---
title: Open in iTerm2
code: ITERM
status: Draft
created: 2026-10-16
updated: 2026-10-30
---

# Open in iTerm2

## Summary

Open the selected Session in iTerm2 with one click, attached to the same running process, so you can work in a real terminal and come back to Lookout without restarting anything.

## Problem

Some things need the real terminal: prompts VIEW has no buttons for, long output, scrolling back. Today that means finding the tmux session by hand.

## Requirements

To be written after the grill. The verified facts below shape them.

## Non-goals

- Other terminals (Ghostty, Terminal.app, WezTerm).
- Opening Sessions that aren't Controllable.

## Technical approach

### Verified 2026-10-16 (iTerm2 3.7.2, tmux 3.6a, throwaway session on its own socket)

| How it's opened | How it's closed | Result |
|---|---|---|
| `tmux -CC attach` (iTerm2's tmux integration: native window, scrollback and mouse) | AppleScript `close` | **Session killed**: no prompt; the tmux window was killed, and with it the session |
| `tmux -CC attach` | ⌘W | Dialog: **Hide** (default) / Detach tmux Session / Kill / Cancel, with "Remember my choice" |
| `tmux -CC attach` | ⌘W → Hide (on the session's only window) | Session survives; iTerm2 detached its client and closed its windows |
| plain `tmux attach` in an ordinary window | AppleScript `close` | Session survives; the client detached, no prompt |

- With `-CC`, a normal ⌘W is safe (Hide or Detach), but Kill is one click away, and any scripted close kills the Session.
- A plain `tmux attach` is always safe to close, but it shows tmux itself inside iTerm2: tmux's own mouse handling and scrollback, which is what made the old dashboard glitchy.

### Key decisions

- **iTerm2's tmux integration (`tmux -CC attach`), not a plain attach** (Dario, 2026-10-30): native windows, scrollback and mouse. The risk is accepted: Kill is one click away in the ⌘W dialog.
- **Lookout never closes iTerm2 windows itself**: it follows from `-CC`, since any scripted close kills the Session.

## Open questions

None.

## Changelog

- 2026-10-16: Created with the `-CC` close-behaviour test results. Not grilled yet; parked behind using what's built.
- 2026-10-30: Blocking question answered by Dario: `-CC`, accepting that Kill is one click away in the close dialog. Lookout never closing iTerm2 windows itself follows from it (Key decisions). Requirements are still to be written.
