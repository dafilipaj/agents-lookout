---
status: Accepted
date: 2026-10-31
---

# 0013. Lookout may run `claude -p` itself for a one-shot text run that isn't a Session

Narrows [0002](0002-start-sessions-through-a-login-shell.md): its rule now covers Sessions only.

## Context

- 0002 says Lookout's server never runs `claude` itself: a Session starts in tmux through a login shell, so Productive's telemetry function wraps it.
- A Topic summary (TOPIC-11) is text in, text out: no tools, nothing to watch, nothing to resume. Dario chose `claude -p` run by Lookout with Sonnet over starting a Lookout Session for it (2026-10-31): a Session would show in the Session list and in History for every summary.
- Brief generation (Plan item 23) has the same shape and lists Lookout's own `claude -p` as an option.

## Decision

Lookout may run `claude -p` itself, outside tmux, for a run that is all of these:

- **One-shot**: one prompt on stdin, one answer, no session saved (`--no-session-persistence`).
- **Without tools**: `--tools ""`, `--strict-mcp-config` with no `--mcp-config`, `--disable-slash-commands`. `--allowedTools` alone isn't enough: it leaves the rest of the tools reachable.
- **Isolated**: `--setting-sources ""`, run from an empty directory Lookout owns, so no `CLAUDE.md`, skill, hook or settings file applies.
- **Bounded**: a timeout and `--max-budget-usd`, run in its own process group through `server/exec.ts`, argv only.
- **Started by you**: a button press, never a poll.

The binary is the one Fleet's `harness list` finds (TOOLS-1.2). Sessions still start as 0002 says.

## Alternatives rejected

- **A Lookout Session on a cheap model**: no new code path, but every summary is a Session in the list and in History, and its answer has to be read back out of a Transcript.
- **A Building block now**: right once a second app needs it (0005); today Lookout is the one consumer (0010). Not inside `tb-session` even then: it's a fast tool that reads files the same way every time, and a model call would bring it seconds of latency, a cost, a login, the network, different answers per run and Claude Code's flag changes, for every caller (Dario, 2026-10-31).
- **Through a login shell (`zsh -lc`)**: the telemetry function only acts in `productiveio/*` repos, and a run from Lookout's own directory is in none, so it would add a shell and the profile's load time for nothing.

## Consequences

- **When a second app needs a summary** (Fleet, a colleague's UI, brief generation in Plan item 23), it moves to a new CLI in cli-toolbox that reads `tb-session show --json` and runs `claude -p` as this decision says, printing `--json`; Lookout then calls that CLI. To keep the move small, a feature using this decision keeps the run (the flags, the call, checking the answer) apart from building its input from Lookout's data.

- No telemetry for these runs, as for any run outside a `productiveio/*` repo.
- They count against your Claude usage like Sessions do; each feature shows its run's cost.
- A Claude Code that drops or renames one of the flags breaks the run with a clear error rather than running with tools; the spec using it names the version it was checked on.
