---
status: Accepted
date: 2026-10-16
---

# 0004. Fleet's CLI is the session layer, consumed through `--json` only

## Context

- Ivan Lučin's Fleet (`ilucin/fleet`) already finds Claude Code, Codex and pi Sessions, reports their Status, starts Sessions in tmux, and restores them after a reboot.
- Fleet started as a copy of `tb-fleet` from cli-toolbox and does everything `tb-fleet` does and more; its docs tell people to switch.
- Fleet's `--json` output is documented as add-only. Its HTTP API and UI are Ivan's own and change fast ("will probably look completely different in a month").

## Decision

Lookout uses Fleet as a Building block by calling its CLI with `--json` (`list`, `spawn`, `send`, `peek`, `restore`, …). It doesn't use Fleet's HTTP server, web UI or Rust library.

## Alternatives rejected

- **Rebuilding Session discovery and Status**: the hard, quirk-heavy part is already solved.
- **Fleet's HTTP API**: personal and fast-changing.
- **`tb-fleet`**: effectively abandoned (one commit) and Claude-only.

## Consequences

- Lookout depends on a personal repo. Talk to Ivan about moving Fleet's core into cli-toolbox and retiring `tb-fleet`.
- Pin the Fleet version Lookout is tested against, and check `--json` output on upgrades.
