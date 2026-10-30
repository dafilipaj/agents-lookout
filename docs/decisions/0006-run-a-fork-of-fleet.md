---
status: Accepted
date: 2026-10-16
---

# 0006. Lookout runs a fork of Fleet until Fleet moves to cli-toolbox

## Context

- Lookout needs changes to Fleet's CLI that upstream doesn't have:
  - Structured `spawn` output. 0004 allows only `--json`, but today Lookout parses `spawn`'s text output.
  - A spawned Session must not inherit `CLAUDECODE`, `CLAUDE_CODE_*` or `OTEL_*`. That includes the global environment of a tmux server that is already running.
  - A `--` before the prompt Fleet types.
  - Codex approval prompts reported as `waiting`.
  - For VIEW: a Transcript as chat messages, and keys (Enter, Esc, arrows).
- Fleet is Ivan Lučin's personal repo (`ilucin/fleet`). It is expected to move to `productiveio/cli-toolbox`, where we can open PRs.

## Decision

- Lookout uses the GitHub fork `dafilipaj/fleet`, branch `lookout`, rebased on `ilucin/fleet` `main`.
- Install it pinned: `cargo install --git https://github.com/dafilipaj/fleet --rev <sha> --locked fleet`.
- Each change is one commit that touches only Fleet's CLI, written to stand on its own as a PR:
  - to `ilucin/fleet` now, each one with Dario's OK;
  - to cli-toolbox once Fleet lives there.
- Lookout still uses Fleet only through its CLI and `--json`. 0004 is unchanged apart from where Fleet is installed from.

## Alternatives rejected

- **Copying Fleet's source into this repo**: syncing with upstream and sending changes back would both be manual.
- **Waiting for upstream**: blocks VIEW and leaves LAUNCH's known gaps open.
- **Filling the gaps in Lookout's server**: nobody else could reuse the work ([0005](0005-building-blocks-live-outside-lookout.md)).

## Consequences

- The fork is public, because GitHub forks of public repos always are.
- Rebase `lookout` on upstream regularly, and re-check Lookout's recorded `--json` fixtures after every rebase.
- Once Fleet lives in cli-toolbox, open the remaining commits as PRs there, retire the fork, and supersede this decision.
- The fork keeps every part of upstream, including the ones Lookout never calls (the web app, bots, Slack links, schedules), and never edits them (Dario, 2026-10-30). Trimming them would turn each upstream change to them into a rebase conflict and leave our commits unable to apply upstream. If an upstream part on Lookout's path ever breaks it and can't be turned off, a small fork commit disables it; nothing is deleted. The fork shrinks by sending its own small commits upstream.
