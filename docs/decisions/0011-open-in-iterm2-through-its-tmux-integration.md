---
status: Accepted
date: 2026-10-30
---

# 0011. Open in iTerm2 through its tmux integration, with no plain-attach fallback

## Context

- [0001](0001-tmux-as-hidden-session-host.md) says "Open in iTerm2" attaches with `tmux -CC attach -t =<name>`, "with plain `tmux attach` as the fallback", and leaves one thing to verify: whether closing an iTerm2 window in integration mode kills the Session.
- That was verified on 2026-10-16 (iTerm2 3.7.2, tmux 3.6a; the ITERM spec's Verified table). ⌘W asks Hide, Detach or Kill, with Hide the default, so a normal close keeps the Session. A scripted close kills it, and Kill is one click away in the dialog.
- On 2026-10-30 Dario chose `-CC` for its native windows, scrollback and mouse, accepting the Kill risk. A plain attach shows tmux's own mouse handling and scrollback inside iTerm2, which is what made the old tmux dashboard glitchy.

## Decision

- "Open in iTerm2" attaches through iTerm2's tmux integration only: `tmux -CC attach -t =<host>`, through one Fleet command ([0006](0006-run-a-fork-of-fleet.md)). There is no plain `tmux attach` fallback.
- Lookout never closes, hides or detaches an iTerm2 window, tab or client.

## Alternatives rejected

- **Plain `tmux attach`, always or as the fallback:** always safe to close, but it brings tmux's UI back. It was the option the 2026-10-30 answer turned down. No failure seen so far makes `-CC` fail where a plain attach works: both need iTerm2, and the integration worked with the tmux Lookout runs.

## Consequences

- Supersedes 0001's "with plain `tmux attach` as the fallback", and closes 0001's Consequence "To verify before relying on `-CC`" (verified 2026-10-16). The rest of 0001 stands.
- A Kill in iTerm2's ⌘W dialog ends the Session. The button's tooltip warns about it (ITERM-1.4). "Remember my choice" with Kill makes it the default, an iTerm2 setting Lookout can't see.
