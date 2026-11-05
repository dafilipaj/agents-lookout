---
title: Local servers
code: PORTS
status: In Progress
created: 2026-10-16
updated: 2026-11-02
---

# Local servers

## Summary

See whether a Session's Local servers are running without asking it: a chip on the Session's status line names its servers and opens one with a click, and a Servers tab in the right sidebar lists every Local server, grouped by the Session it belongs to. Slice 1 is seeing and opening; Stop (the whole process, not just the listener) is slice 2.

## Problem

Agents start dev servers, in Worktrees and through tb-devctl, and leave them running. To know whether one is up, Dario asks the Session or searches its messages (2026-11-02). Ports pile up, a new server lands on a surprising port, and finding and killing the leftovers means `lsof`, `ps` and `kill` by hand; `tb-devctl stop` can itself leave the server orphaned.

## Requirements

### PORTS-1 Read Local servers

- [x] PORTS-1.1 Lookout's server reads the Local servers: one `lsof -nP -iTCP -sTCP:LISTEN -FpcRn` (pid, command, parent pid, address), one `lsof -nP -a -d cwd -Fpn -p <the listeners' pids>` (each one's working directory), one `ps -axo pid=,ppid=,pgid=,etime=` (the process tree, process groups and how long each has run) and `tb-devctl ps --json`, each through the server's runner with a 2 s timeout. A listener on several addresses (`*:3306`, `[::]:3306`) or several ports is one Local server with all its ports, lowest first. The listener query exiting 1 with no output is no listener, an empty list; any other failure of it (another exit, a timeout, ENOENT) is a failed read, which keeps the last list and says so (PORTS-3.5). The other three failing only leave out what they add: a server with no known working directory has none (shown as "unknown directory"), one with no `ps` line no start time and no tree, and without tb-devctl no labels or owners. (e2e)
- [x] PORTS-1.2 Reads run on a `setTimeout` chain: every 5 s while any tab is connected, none while none is, one at a time, shared by every tab; the result goes to every tab as a `ports` event on `/api/events`, and in the snapshot, only when something changed. (e2e)
- [x] PORTS-1.3 A Local server belongs to a Session by the first of these that names one: (1) a tb-devctl service whose `listener_pid` is its pid (else whose `pgid` is its process group, by `ps`), not `dead`, whose `owner` is `<harness>:<user>:<session id>` naming a Session in Fleet's list by Harness and session id; a service row naming no listener, or a Session Fleet doesn't list, labels the server but names no Session; (2) its pid is in a Session's Process tree, by `ppid`, as MEM-2.1 builds it; (3) its working directory is inside the working directory of exactly one Session in Fleet's list, the deepest one when they nest; two Sessions with the same deepest one name neither. A server none of them names belongs to no Session. (test)
- [x] PORTS-1.4 A Local server is shown by default when it belongs to a Session, is a tb-devctl service, or its working directory is inside a git checkout in the home folder (a `.git` file or folder above it, at or below `~`: Homebrew's `/opt/homebrew` is a checkout too); the rest (AirPlay, Caddy, MySQL, Orca, VS Code's helpers) are shown only with "Show all" (PORTS-3.3). Lookout's own server is shown, as "Lookout", belonging to no Session. (test)
- [x] PORTS-1.5 Each Local server carries: its ports; its name, the tb-devctl `stack/service` when it is one, else the process's command name (`node`, `ruby`, `vite`); its working directory, shown from the repo's folder (`api-worktrees/test-pr-24926`) and in full in its tooltip; its start time: now minus `etime` at the first read that sees its pid with that command, kept while both stay the same, so unchanged reads stay unchanged (none without a `ps` line); the Session it belongs to and by which rule (PORTS-1.3); and its URL: tb-devctl's `url` for a service that has one, else `http://localhost:<lowest port>`. (test)

### PORTS-2 A Session's servers on its status line

- [x] PORTS-2.1 While a Session has Local servers (PORTS-1.3), its status line (VIEW-5.5) shows a chip after the Changes (DIFF-1.3): the `Server` icon and, for one server, `:<port> <name>` (`:4301 test-pr-24926/api`), for more, `N servers`. A Session with none shows no chip. (test)
- [x] PORTS-2.2 The chip's tooltip lists each server on its own line: port, name, working directory and "up 2h 10m". With one server a click, Enter or Space opens its URL in a new browser tab; with more, it opens the Servers tab (PORTS-3) scrolled to the Session's group. Its accessible name says what a click does ("Open :4301 test-pr-24926/api in the browser", "Show 3 servers"). (test)
- [x] PORTS-2.3 The chip follows the reads: a server that starts or stops shows within one read (5 s) of it. Like the line's other parts it is cut short when the line is too narrow (VIEW-5.5). A chip that goes while it has focus hands focus to where the status line's other parts do (VIEW-8.10's `focusFallback`). (e2e)

### PORTS-3 The Servers tab

- [x] PORTS-3.1 The right sidebar has a fifth tab, Servers, after Topics: the lucide `Server` icon, `P` to open it (SIDE-7.4's "H W L T" becomes "H W L T P"), and a count of the shown servers in its tooltip. With five tabs the strip shows the open tab's icon and name and the others' icons alone, each name in its tab's tooltip and accessible name, so no name is cut short at the sidebar's default width. An icon-only tab's count sits on the icon's corner, as on the rail. (test)
- [x] PORTS-3.2 It lists the shown Local servers grouped by Session, each group headed by the Session's title and Status marker (a click selects the Session), the Sessions in the sidebar's order; then "Not in a Session", grouped by repo (the checkout's common git directory, so a repo's Worktrees are one group, headed by the repo's folder), then "Elsewhere" for the shown servers with no checkout or no known working directory (tb-devctl services, Lookout). Each row: the port as a link to its URL (opens a new browser tab; a server with several ports lists them, the first is the link), the name, the working directory and how long it has been up. j/k and ↑/↓ from the tab strip move through the rows (`PanelNav`, WORK-1.7) and Enter opens the selected one's URL. The port and the name keep their width; the directory gives way first, cut from its start (an rtl box around an ltr span), so a Worktree's name keeps its end. (test)
- [x] PORTS-3.3 A "Show all" switch at the top adds, under "Other listeners", the ones PORTS-1.4 hides, dimmed, with their command and ports. Its state is remembered with the sidebar's layout (`lib/right-sidebar.ts`). (test)
- [x] PORTS-3.4 With no shown server the tab says "No Local servers running." and, when "Show all" is off and others exist, "N other listeners hidden". Before the first read it shows the design system's Loading, "Reading ports…" (DS-6.3); a first read that fails shows "Couldn't read the ports: <reason>." in its place, and the next good read replaces it. (test)
- [x] PORTS-3.5 When the last listener query failed after a good one, the tab keeps the last list with an Alert, "Couldn't read the ports: <reason>. Showing the list from <time>."; the chips keep it too. The next good read removes the Alert. (e2e)
- [x] PORTS-3.6 It reads well from 280 px to the sidebar's widest, light and dark, with 12 servers over 4 Sessions. (manual)

### PORTS-4 Stop a Local server (slice 2)

- [ ] PORTS-4.1 Stop ends the server and the processes it started (for example `pnpm dev` → node → vite), and the port is free afterwards. (test)
- [ ] PORTS-4.2 Stop never ends a shell, tmux, a Harness process (Claude Code, Codex) or Lookout itself, even when they're ancestors of the server. (test)
- [ ] PORTS-4.3 A process that ignores the polite signal is force-stopped after 3 s. (test)
- [ ] PORTS-4.4 A tb-devctl service is stopped through `tb-devctl down`, so its stack's state stays right. (test)
- [ ] PORTS-4.5 If stopping fails, the row says why and stays. (test)
- [ ] PORTS-4.6 Each server row in the Servers tab has a Stop button, and every Stop asks first: an in-app dialog, as End Session's (VIEW-5.6, never `window.confirm`), names the server (port, name, and its Session or directory) and what stops with it (the processes it started; for a tb-devctl service, `tb-devctl down` of that service). Buttons: Cancel and Stop (destructive); Stop reads "Stopping…" while it works, and a failure shows in the dialog (PORTS-4.5). (test)

## Non-goals

- Starting or restarting servers (tb-devctl and the agents do that).
- Logs of a server (`tb-devctl logs` has them for its services).
- Ports on other Hosts, UDP, and outgoing connections.
- Stopping a listener "Show all" adds (slice 2 too).
- A tb-devctl stack's services that aren't listening (`state: dead`): tb-devctl's own `ps` shows those.

## UX

The status line gains one part, after the Changes; the right sidebar one tab, after Topics.

```
Status line, one server
│ agents-lookout · main · +120 −14 · ⌸ :4301 test-pr-24926/api · opus · 41% │

Status line, more
│ work · main · ⌸ 3 servers · sonnet · 12%                                      │

Servers tab (P)
┌ Servers ─────────────────────────── [ ] Show all ┐
│ ● api-rates-port                                  │
│   :4301   test-pr-24926/api    api-worktrees/…   2h │
│   :4300   test-pr-24926/redis  api-worktrees/…   2h │
│ ● fantastic deal panel                            │
│   :5173   node                   fantastic        14m │
│ Not in a Session                                  │
│   :4747   Lookout                agents-lookout    3h │
└───────────────────────────────────────────────────┘
```

- The chip is `text-meta`, `muted-foreground`, as the status line's other parts; no colour: a running server is information, not a state to act on (DS-12).
- Rows are the design system's list rows: port in `tabular-nums`, name in `body`, the directory and age in `meta`.
- Slice 2: a Stop icon button (DS-7, lucide's `Square`, named "Stop <port> <name>") at the end of each row, opening the confirmation (PORTS-4.6).

## Technical approach

- **Reader: Lookout's server, `server/ports.ts`.** The reads in PORTS-1.1, measured on this Mac on 2026-11-02 at 0.03 s for each `lsof` with 13 listeners. Not a Building block of its own (see Key decisions): `ps` and `lsof` are the OS, as MEM's sampler reads `ps`. tb-devctl is read as the Building block it is, for its labels, owners and URLs.
- **Parsing.** `lsof -F` output is one field per line, `p` starting a process; `n` is the address (`*:3306`, `127.0.0.1:4747`, `[::1]:5173`), the port after the last `:`. `etime` is `[[dd-]hh:]mm:ss`. Lines that don't parse are skipped, never the read, as MEM-2.1. The pure parts (parsing, the tree, PORTS-1.3's rules, PORTS-1.4's filter) live in `shared/ports.ts`, unit-tested on captured output.
- **The tree.** PORTS-1.3's rule 2 builds the same `ppid` map as MEM (`shared/memory.ts`), from its own `ps` (MEM samples every 30 s, too slow for a server started a moment ago); the Session roots are Fleet's row `pid`s. A server started detached (`setsid`, a double fork) has launchd as its parent, so rule 2 misses it and rule 3 (the working directory) is what finds it.
- **The working directory rule.** Most Sessions run in `~/Projects/work` on `main` (seen 2026-11-02 over 2,240 Sessions), so a server in `~/Projects/work/repos/api-worktrees/x` is inside every one of them: rule 3 names none then, and the server shows under "Not in a Session", grouped by its checkout. Rules 1 and 2 are what tie such a server to its Session.
- **Schedule.** As MEM-2.3: a `setTimeout` chain, cancelled on shutdown with its process group killed and waited for. The `ports` event carries start times, not ages, so the tab renders ages itself and an unchanged read sends nothing.
- **Browser.** `web/src/lib/ports.ts` keeps the event; `PortsChip` in the status line, `ServersPanel` as the fifth `RightTab` (`lib/right-sidebar.ts`, `RIGHT_TABS`).
- **Slice 2, Stop.** `POST /api/ports/stop {pid}` with the token and Origin (0003): for a tb-devctl service `tb-devctl down <stack> <service>`; else SIGTERM to the server's own process group when its leader isn't protected (PORTS-4.2), else to the server and its descendants, SIGKILL after 3 s, then one `lsof` to check the ports are free. YugoTool's `runner/orphans.ts` is the reference.
- **World needs (TEST-1.5):** `.ports({ listeners, cwds, processes, devctl, fail })` answering the exact `lsof` argvs and `ps -axo pid=,ppid=,pgid=,etime=` from an answer file the test can rewrite mid-test (as `.memory()`'s), with `fail` making a named query exit non-zero or time out. Every World gets `lsof` and `tb-devctl` shims: one without `.ports()` answers no listeners and no stacks, so no World ever reads the Mac's real ports; the `ps` shim answers the new argv from the same file (empty without a declaration).
- **Amends:** VIEW-5.5 (the status line's new part), SIDE-7.4 (`P`), the Glossary's Local server (belongs to a Session by PORTS-1.3, not by its Worktree alone), decision 0005 (a Consequences note: PORTS reads the OS's listeners in Lookout's server, as MEM reads `ps`; a ports CLI waits for an agent needing one).

### Key decisions

- **On the Session first, then a list** (Dario, 2026-11-02): the question asked is "is this Session's server running?", so the answer is on the Session's status line; the Servers tab is the overview, and where Stop will live.
- **Lookout's server reads `lsof` and `ps` itself, not a `tb-ports` CLI** (Dario, 2026-11-02): 0005 keeps Building blocks outside Lookout, but reading the OS's listeners is a read like MEM's `ps`, with no state or logic another tool needs today. A `tb-ports` CLI waits for an agent wanting the same.
- **Seeing first, Stop in slice 2** (Dario, 2026-11-02): seeing answers the question; Stop is the risky half (PORTS-4.2) and gets its own slice and review.
- **Shown: a Session's, a tb-devctl service, or in a git checkout** (Dario, 2026-11-02): on 2026-11-02 twelve of thirteen listeners were the Mac's or apps', so an unfiltered list is mostly noise; "Show all" has the rest.
- **Every Stop is confirmed** (Dario, 2026-11-04: "If I click stop button I want confirmation window"): a dialog before every Stop, a Session's server and a tb-devctl service alike. The recommendation (one click except for tb-devctl) wasn't taken.
- **tb-devctl's `owner` first**: it names the Session that started the stack outright, so it beats the tree and the working directory.

## Open questions

- [ ] Slice 2: Stop names a server by pid, command and start time, and the server checks all three again before signalling, so a reused pid is never signalled; every process it signals, not only the group's leader, is checked against PORTS-4.2 (as the Session actions' process identity does, VIEW-5.6). From Codex's spec review.

## Changelog

- 2026-10-16: Created.
- 2026-10-16: Parked: Dario first wants to use SIDE, LAUNCH, VIEW and HIST before adding features. Each open question carries a recommendation; resume from there.
- 2026-11-02: Resumed by Dario ("I quite often have to ask a session if its local server is running") and grilled: a chip on the Session's status line and a Servers tab; Lookout's server reads `lsof` and `ps`, as MEM does, with tb-devctl's `ps --json` for labels and owners; seeing and opening in slice 1, Stop in slice 2; shown are a Session's servers, tb-devctl services and servers in a git checkout. PORTS-1 to 3 rewritten from these, the old PORTS-2 (Stop) moved to PORTS-4. Ready.
- 2026-11-02: Fixed from a Codex review (Sol xhigh, 9 findings, all taken as recommended): `lsof`'s exit 1 is an empty list; the other reads only drop their fields; start times kept per pid and command; tb-devctl joined by `listener_pid` then `pgid`; a first failed read shows its reason; "Not in a Session" grouped by repo, then "Elsewhere"; keyboard and focus for the tab and the chip; the chip is cut short like the line's other parts rather than dropped (the DS Non-goals keep dropping whole parts for Narrow widths); the World shims; decision 0005 noted; Stop's process identity is a slice 2 question.
- 2026-11-02: Building slice 1: `ps` also reads `pgid` (PORTS-1.3's join needs the process group), and the working-directory `lsof` adds `-nP`, since Fleet runs the same argv without it and a World answers only Lookout's from its fake. A tb-devctl service is named `stack/service`, not `stack › service`: decision 0008 keeps symbol glyphs out of UI text.
- 2026-11-02: Seen running on Dario's Mac: MySQL showed by default, as `/opt/homebrew` is a git checkout, so PORTS-1.4 counts only checkouts at or below `~`; and five tabs cut every name short at the default width, so PORTS-3.1 shows the other tabs as icons alone.
- 2026-11-02: Slice 1 built (`shared/ports.ts`, `server/ports.ts`, `PortsChip`, `ServersPanel`, the World's `.ports()` with `lsof`, `ps` and `tb-devctl` shims) and reviewed by Codex (Sol high, 2 rounds: 5 fixes taken, the checkout-in-`~` finding rejected as the amendment above); PORTS-1 to 3.5 ticked, 3.6 waits for an eye. In Progress.
- 2026-11-02: Design pass on the running app (Dario's walk-through): PORTS-3.2's row keeps the port and name whole and cuts the directory from its start; PORTS-3.1's icon-only tabs wear their count on the icon's corner.
- 2026-11-04: Dario asked for slice 2 ("I lack buttons to be able to stop servers from the Servers tab") and answered its first Open question: every Stop is confirmed in a dialog. PORTS-4.6 added, the UX gains the row's Stop button, a Key decision replaces the Open question.
- 2026-11-05: PORTS-3.6 ticked: Dario checked and confirmed it.
