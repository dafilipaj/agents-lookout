---
title: Test queue
code: RES
status: In Progress
created: 2026-11-06
updated: 2026-11-06
---

# Test queue

## Summary

See what `res`, a machine-wide queue for heavy jobs, is running and who waits for it, without asking a Session or running `res status`: the Memory line counts the jobs waiting, its details list what runs and what waits under the Session each belongs to, and a waiting Session's row and status line say "Queued" with the tool and for how long. Read-only, and absent where `res` isn't installed.

## Problem

The laptop froze when several Sessions ran full test suites at once (Dario, 2026-11-04; a load average of 33 on 2026-10-23, MEM's Problem). A colleague's `res` fixes the cause: `res run -- <cmd>` waits until the job's estimated cores and memory fit what the machine has free, by priority then first come, and a PreToolUse hook, `res-guard`, refuses a heavy command run outside it. It's installed on this Mac since 2026-11-06 (`~/.local/share/res`, PLAN item 37). The side effect: a Session can now sit for minutes on a queued `vitest` while its row says Busy, and nothing in Lookout says it's waiting for the machine rather than working.

## Requirements

### RES-1 Read the queue

- [x] RES-1.1 Lookout's server runs `res status --json` (the binary from `LOOKOUT_RES_BIN`, then PATH, then `~/.local/bin`, as tb-devctl's, PORTS-1.1) with a 3 s timeout, every 5 s while any tab is connected, none while none is, one at a time, shared by every tab. It reads each entry's pid, kind (`run` or `standing`), state (`holding` or `waiting`), priority, class (`vitest@agents-lookout`), tool, its lease (`cores`, `mb`) or, waiting, what it needs (`req`), and its times (`since`, `waitingSince`, `queuedAt`). The result goes to every tab as a `res` event on `/api/events`, and in the snapshot, only when something changed. (test)
- [x] RES-1.2 `res` not found (ENOENT) means no queue: the snapshot is `null` and nothing of RES shows anywhere. Any other failure (a timeout, another exit, output that isn't its JSON) keeps the last list with the reason and the time of the last good read; the next good read clears it. (test)
- [x] RES-1.3 Waiting jobs are in `res`'s own queue order: priority (live 2, check 1, bg 0) raised one level per 5 min waited, then the earliest `queuedAt`. (test)
- [x] RES-1.4 A job belongs to a Session when its `session` names exactly one Session in Fleet's list: the tmux session the Session's pane lives in (what `res` records when `$TMUX` is set), else the Session's id (`$CLAUDE_CODE_SESSION_ID`, what it records outside tmux). A tmux session shared by several listed Sessions names none of them. (test)

### RES-2 The queue in the Memory line

- [x] RES-2.1 While at least one job waits, the Memory line (MEM-1) shows at its right end the lucide `Hourglass` and the number waiting, and its accessible description adds "N waiting in res". With none waiting it shows nothing more. (test)
- [x] RES-2.2 The Memory details (MEM-3) end with a "res queue" section, one line per job: "running" or its place ("#1 waits"), its tool and its Session's title (a click selects the Session, as the list's rows do) or "No Session", then its lease (running) or what it needs (waiting) in memory, and for how long it has run or waited; its priority, cores and class are in the line's tooltip. With nothing in either, the section says "Nothing running or waiting." A failed read (RES-1.2) adds "Couldn't read res: <reason>. Showing the list from <time>." Waiting jobs also show in MEM-3.9's Worth a look, and a Queued Session's row there carries its mark (MEM-3.5). (test)
- [x] RES-2.3 Without `res` (RES-1.2) the Memory line and details are as before: no count, no Queue section. (test)

### RES-3 A waiting Session says so

- [ ] RES-3.1 A Session with a job waiting in `res` (RES-1.4) shows, at the start of its sidebar row's second line after the memory mark and before the Subagent count (DS-22.3), the `Hourglass` and how long it has waited (`3m`), with the tooltip "Queued in res: vitest, waiting 3m, #2 in the queue". Its Status, marker and strip don't change. With several of its jobs waiting, the one waiting longest. (test)
- [x] RES-3.2 Its status line (VIEW-5.5) shows the same as a part before the Local servers chip (PORTS-2.1): the `Hourglass` and "Queued: vitest · 3m", with the same tooltip. (test)
- [x] RES-3.3 The mark goes within one read (5 s) of the job being admitted or ending. (test)
- [ ] RES-3.4 The row's mark and the Memory line's count read well at 280 px, light and dark, beside a Subagent count and Changes. (manual)

## Non-goals

- Running, holding, releasing or reprioritising jobs from Lookout: `res` and the Sessions do that.
- `res report` and the metrics history.
- The machine's budget numbers (free cores, reserve) beyond what the Memory details already show.
- A Queued Status: a queued Session stays Busy, as it is (SIDE-2's Statuses are the Harness's).

## UX

```
Memory line, 2 waiting
│ ▍ 9.4 GB · load 3.1                     ⧖ 2 │

Memory details, Queue section
│ QUEUE                                          │
│ Running                                        │
│   vitest@agents-lookout   lookout RES          │
│   check · 3 cores · 2.6 GB · 1m                │
│ Waiting                                        │
│   #1 vitest@fantastic-productive  rates fix    │
│   check · needs 3 cores · 2.6 GB · 2m          │

Sidebar row, waiting
│ ● rates fix                                    │
│   fantastic · fix/rates        ⧖ 2m  🤖 1  12m │

Status line
│ fantastic · fix/rates · ⧖ Queued: vitest · 2m · opus · 41% │
```

## Technical approach

- `shared/res.ts`: the snapshot type, `parseResStatus` (the JSON to jobs, skipping an entry it can't read), `queueOrder` (RES-1.3) and `attributeJobs` (RES-1.4, from `{id, tmuxSession}` per Session), pure and tested.
- `server/res.ts`: `ResMonitor`, PORTS' monitor reduced to one read (RES-1.1, 1.2). `SessionMonitor` gains `fleetRows()`, the last `fleet list` rows, for the tmux session names, which `SessionRow` doesn't carry.
- RES-3 rides on the Session's row, as memory growth does (MEM-2): the monitor's `queued(row)` option sets `row.queued` (`{tool, since, position}` or null), and a RES change refreshes the rows, so the row and the status line read it without a prop of their own.
- The client keeps the snapshot in the store (`res`), and passes it to the Memory line.

### Key decisions

- **In the Memory line, not a dock line of its own:** the dock row's height is the composer's (SIDE-8.1), so a third line would grow it; the queue is about the same machine load Memory shows.
- **Matched by tmux session or Session id, not by process tree:** that's what `res` records, and it already names the Session; a job a Subagent queued is its Session's too.
- **No colour of its own:** the mark is in the row's quiet text; the Hourglass says what it is. Revisit after Dario's look (RES-3.4).

## Open questions

None.

## Changelog

- 2026-11-06: Draft and In Progress, from PLAN item 37 (Dario: "proceed with implementation"), with `res` installed and its source read. In the Memory line instead of a dock line (SIDE-8.1), matched by tmux session or Session id.
- 2026-11-06: RES-2.2 follows MEM's verdict-first breakdown: the Queue section moves to the end as compact lines, the details in each line's tooltip.
- 2026-11-06: RES-3.1 amended and unticked for DS-22 (Plan item 50): the queued mark leads the row's second line with the other marks, ahead of the location, where it sat among the numbers.
