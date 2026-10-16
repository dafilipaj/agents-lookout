---
title: Local servers
code: PORTS
status: Parked
created: 2026-10-16
updated: 2026-10-16
---

# Local servers

## Summary

See every Local server your Sessions left running (dev servers, Storybook, test servers), which Worktree and Session each belongs to, and stop one with a click: the whole process, not just the listener.

## Problem

Agents start dev servers in Worktrees and leave them running. Ports pile up, a new server lands on a surprising port, and finding and killing the leftovers means `lsof`, `ps` and `kill` by hand. `tb-devctl stop` can itself leave the server orphaned.

## Requirements

### PORTS-1 See Local servers

- [ ] PORTS-1.1 Lists every Local server: port, process name and command, the Worktree (or directory) it runs in, the Session it belongs to if any, and how long it's been up. (test)
- [ ] PORTS-1.2 Servers started by tb-devctl are labelled with their stack and service. (test)
- [ ] PORTS-1.3 System and app listeners (AirPlay, Orca, Caddy, MySQL, …) are hidden by default; see Open questions for the rule. A toggle shows them. (test)
- [ ] PORTS-1.4 The list refreshes on its own every 3 s while it's visible. (manual)
- [ ] PORTS-1.5 Clicking a port opens `http://localhost:<port>` in a new browser tab. (manual)

### PORTS-2 Stop a Local server

- [ ] PORTS-2.1 Stop ends the server and the processes it started (for example `pnpm dev` → node → vite), and the port is free afterwards. (test)
- [ ] PORTS-2.2 Stop never ends a shell, tmux, a Harness process (Claude Code, Codex) or Lookout itself, even when they're ancestors of the server. (test)
- [ ] PORTS-2.3 A process that ignores the polite signal is force-stopped after 3 s. (test)
- [ ] PORTS-2.4 A tb-devctl service is stopped through tb-devctl, so its stack's state stays right. (test)
- [ ] PORTS-2.5 If stopping fails, the row says why and stays. (test)

## Non-goals

- Starting or restarting servers (tb-devctl and the agents do that).
- Logs of a server.
- Ports on other Hosts, UDP, and outgoing connections.
- Stopping system or app listeners that the default view hides; see Open questions.

## UX

To be sketched once placement is answered.

## Technical approach

- **Building block: a new CLI in cli-toolbox, `tb-ports`** ([0005](../../decisions/0005-building-blocks-live-outside-lookout.md)).
  - `tb-ports list --json`: listeners from `lsof -nP -iTCP -sTCP:LISTEN`, each with pid, process group, parent chain, command, cwd (`lsof -a -p <pid> -d cwd`), start time, and the git repo or Worktree its cwd belongs to.
  - `tb-ports stop <port|pid> --json`: ends the server's process tree, never touching protected ancestors (PORTS-2.2): SIGTERM, then SIGKILL after 3 s, then checks the port is free.
  - YugoTool's `runner/orphans.ts` (lsof listeners → cwd → kill) is the reference.
- **tb-devctl:** `tb-devctl ps --json` lists stacks and services with their listener pid and port. Lookout uses it to label rows and to stop those services with `tb-devctl down`.
- **Session link:** a Local server belongs to the Session whose working directory is inside the same Worktree (see the Glossary). Lookout matches them using Fleet's list.
- **Measured 2026-10-16, no stacks up:** five listeners, all system or app (rapportd, ControlCenter, Caddy, MySQL, Orca), so an unfiltered list is mostly noise.

### Key decisions

- (filled in after the grill)

## Open questions

- [ ] Is it a new `tb-ports` CLI, a `tb-devctl` subcommand, or part of the Fleet fork? *(blocking)*
  - Recommended: a new generic `tb-ports` crate. Lookout labels tb-devctl services from `tb-devctl ps --json` and stops them through `tb-devctl down`.
- [ ] Which listeners show by default? *(blocking)*
  - Recommended: only processes whose cwd is inside a git repo, plus tb-devctl services. Everything else goes behind "Show all".
- [ ] Is Stop one click, or confirmed? *(blocking)*
  - Recommended: one click for servers in a repo. Listeners behind "Show all" can't be stopped.
- [ ] Where does it live in the UI? *(blocking)*
  - Recommended: a Servers tab in HIST's right sidebar, grouped by Worktree, plus a "2 servers" chip in VIEW's header.

## Changelog

- 2026-10-16: Created.
- 2026-10-16: Parked: Dario first wants to use SIDE, LAUNCH, VIEW and HIST before adding features. Each open question carries a recommendation; resume from there.
