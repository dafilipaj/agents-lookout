---
status: Accepted
date: 2026-10-16
---

# 0002. Sessions start through a login shell, never by running `claude` directly

## Context

Productive's Claude Code telemetry isn't a Claude setting. `work/scripts/load-otel.sh`, sourced from `~/.zprofile`, defines a `claude` shell function that adds the `OTEL_*` variables only when the launch directory's `origin` remote is `productiveio/*`. Only login shells have that function:

```
zsh -lc  → claude: function   (telemetry on)
zsh -ic  → claude: command    (none)
zsh -c   → claude: command    (none)
```

That's why Claude Desktop, the SDK and IDE extensions send no telemetry: they run the binary directly.

## Decision

Lookout's server never runs `claude` (or another Harness) itself. It creates the Session host with `tmux new-session -d -s <name> -c <dir>` (tmux's default command is a login shell), waits for the profile to load, and types the Harness command into it with `send-keys`. This is what Fleet's spawn already does.

## Alternatives rejected

- **Exporting the `OTEL_*` variables in Lookout's own environment**: bypasses the repo check and would send telemetry for personal work.

## Consequences

- Verify once that a Session Lookout starts appears in Grafana.
- Telemetry still only covers `productiveio/*` repos, by design.
