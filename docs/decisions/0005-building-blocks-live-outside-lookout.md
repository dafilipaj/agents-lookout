---
status: Accepted
date: 2026-10-16
---

# 0005. Building blocks live outside Lookout; Lookout only consumes them

## Context

- Colleagues build their own agent UIs (Fleet, YugoTool, Agent Deck, Planner). Whole apps don't transfer between people; shared pieces might.
- Two of Lookout's must-haves have no Building block yet: History across Claude Code and Codex, and Local servers.

## Decision

- Shared pieces go into `productiveio/cli-toolbox` as CLIs with `--json`, via PRs:
  - Codex Transcripts in `tb-session` (History).
  - A new ports CLI: lists Local servers with their Worktree and Session, and kills one together with its child processes (Local servers). YugoTool's `orphans.ts` is a starting point.
- This repo (`dafilipaj/agents-lookout`, private) holds only the app.

## Alternatives rejected

- **Writing the logic inside Lookout's server**: nobody else could reuse it, and agents couldn't use it through skills.
- **Putting the app in `work` or `cli-toolbox`**: `work` is a knowledge repo, and cli-toolbox is Rust with a protected `main`.

## Consequences

- HIST and PORTS depend on cli-toolbox PRs landing first; each spec states that gap.
- Claude sessions working on this repo send no telemetry: the remote isn't `productiveio/*`.
