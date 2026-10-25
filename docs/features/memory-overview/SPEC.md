---
title: "Memory overview"
code: "MEM"
status: "In Progress"
created: "2026-10-24"
updated: "2026-10-25"
---

# Memory overview

## Summary

See what the Sessions cost this Mac without opening Activity Monitor: one line at the bottom of the Session sidebar, under the usage strip, with the memory of everything Lookout watches and the Mac's load (`▌ 2.4 GB · load 3.3`, with the Pressure word instead when it isn't normal), and a click opens a breakdown: Lookout itself, one row per Session (its Process tree: the Harness, MCP servers, test runners), and the rest of the Mac, each with its biggest executables, a 30-minute trend and a badge on what is growing. A Session whose tree grew 30 MB or more in 10 minutes gets a small mark on its row in the list, so the one that is eating the Mac shows up where you already look. Lookout's server samples `ps` and `sysctl` and does the sums; the tab only renders.

## Problem

On 2026-10-23 Chrome froze at a load average of 33 (a pre-push e2e run in one Session plus other agents working), and nothing on screen said which Session was the cause: the sidebar shows what a Session is doing, not what it costs. Finding out means Activity Monitor or `ps`, where a Session is a dozen processes named `node`, `claude`, `vitest` and `Chrome Helper`, with no Session name on any of them. A Claude Code process alone is 400–460 MB of RSS on this Mac (two were running while this was written, 456 and 408 MB), a test run adds hundreds more for minutes, and an MCP server that leaks grows quietly for hours.

## Requirements

Building blocks: Fleet for the Session roots (`list --json` already carries each Session's `pid`, [0004](../../decisions/0004-fleet-cli-as-session-layer.md)); `ps` and `sysctl` from macOS, run by Lookout's server, which is the one place that sees every process (Technical approach). Nothing new in the Fleet fork.

### MEM-1 The memory line

One line in the Session sidebar's dock cell, under the usage strip (USAGE-1.1), always visible, the memory of everything Lookout watches and the Pressure.

- [x] MEM-1.1 Under the usage strip, on one `caption` line, a button shows the glyph (a 3 × 12 px rounded bar in CSS, drawn like the row's Status strip, SIDE-3.6: never a character), the total memory of Lookout's and the Sessions' Process trees (MEM-2.2) and the load (MEM-5.3; the Pressure word instead when it isn't normal), `▌ 2.4 GB · load 3.3`; its accessible name is "Memory details" and its tooltip says the total, the Mac's RAM, the Pressure and when it was sampled. A total of 1 GB or more reads with one decimal (`2.4 GB`), under 1 GB in whole megabytes (`812 MB`). Before the first sample it shows the design system's Loading, "Reading memory…" (DS-6.3). (test)
- [x] MEM-1.2 The line follows the samples: a new total shows within one sample of the change (30 s in the background, MEM-2.3), and never moves the dock line: the line's height is the same whatever it says, and at rest the dock row keeps SIDE-8.1's one height (UX, Fit). (e2e)
- [x] MEM-1.3 The glyph's colour is a level, from the design system's tokens (DS-2, "Colour by meaning"): `muted-foreground` while the watched total is under a third of the Mac's RAM and the Pressure is normal; `warning` from a third, or at Pressure `warn`; `destructive` from two thirds, or at Pressure `critical`, whatever the total. The change is a 0.7 s colour transition, none with reduced motion (DS-10.1). The level is in the tooltip and the screen-reader description too ("memory warning", "memory critical"), so it is never colour alone. (test)
- [x] MEM-1.4 Screen readers get the line as the button's description, the way the usage strip's lines are its (USAGE-1.1): "Memory: 2.4 GB watched of 24 GB, pressure normal, sampled 12 s ago", with the level when there is one and "2 Sessions growing" when any row carries MEM-4's mark. (test)
- [x] MEM-1.5 Seen at 280 px, light and dark, with Claude, Codex and Jev all showing in the usage strip: the line fits on one line with its glyph, total and Pressure word, under Jev's line and above the dock cell's bottom; its text keeps 4.5:1 on the sidebar; and the dock line and the composer's line stay one line (SIDE-8.1) in every main-pane view. (manual)

### MEM-2 Sampling

Lookout's server samples the whole machine at once and sums each Process tree, so every number in the breakdown comes from one `ps` and the parts add up to the total.

- [x] MEM-2.1 One sample is one `ps -axo pid=,ppid=,rss=,comm=` (RSS in KB, read as bytes) and one `sysctl -n hw.memsize kern.memorystatus_vm_pressure_level` (the Mac's RAM in bytes, then the Pressure level: 1 normal, 2 warn, 4 critical; any other value reads as normal), both run through the server's runner with a 2 s timeout, resolved on PATH with `/bin` and `/usr/sbin` as the fallbacks a launchd PATH lacks (as `resolveFleetBin` does). From the `ps` lines the server builds the parent → children map and a tree's total is the RSS of its root and every descendant, by `ppid`, as the lines say at that instant. Lines that don't parse are skipped, never the sample. (test)
- [x] MEM-2.2 The owners, from the same sample: **Lookout** is the server's own pid and its tree (the `fleet`, `tb-session`, `git` and `tb-pr` calls in flight, and the Vite dev server when the server starts it); a **Session** is each row Fleet lists (`fleet list --json`'s `pid`, View only rows included) and its tree; **other** is every other process's RSS, as one number. A process is counted once: a Session's tree is cut out of any tree that contains it, and a Session whose pid is inside another Session's tree keeps its own tree (the outer Session loses it). The watched total (MEM-1.1) is Lookout plus the Sessions; the Mac's RAM is `hw.memsize`. (test)
- [x] MEM-2.3 Samples run on a `setTimeout` chain, never an interval: the next one is due 30 s after the last one started, 5 s while any tab says the breakdown is open (MEM-3.1), and at once when a tab opens it (at most one immediate sample every 2 s). One sample runs at a time, shared by every tab; none runs while no tab is connected; on shutdown the server cancels the one in flight, kills its process group and waits for it, as the usage poller does (USAGE Technical approach). (e2e)
- [x] MEM-2.4 The trend is a ring of 60 points of the watched total, one point per 30 s, 30 minutes in all: a sample adds a point only when the last point is 30 s or more old, so the 5 s cadence doesn't fill the ring; until it holds 2 points the breakdown says "collecting"; a restart starts it empty. (test)
- [x] MEM-2.5 Growth is per row (Lookout and each Session): the server keeps each row's totals for 10 minutes and a row is growing when its latest total is 30 MB or more above its oldest kept total (a row seen for less than 10 minutes compares with its oldest sample); the amount is the difference. A row Fleet no longer lists, or a Lookout restart, drops that history: no row is ever growing on another row's past. (test)
- [x] MEM-2.6 A failed, refused or timed-out `ps` skips that sample: the last snapshot stays, marked old with its age ("sampled 1m ago" in the info tone, DS-3.3), and the next sample is due on the normal cadence. A failed `sysctl` makes that sample's Pressure normal and keeps the last RAM size read, or `os.totalmem()` before any; the `ps` part still counts. Nothing from either command's output reaches the tab or the log but numbers, executable names and the first line of an error, redacted as WORK-7.7 redacts. (test)
- [x] MEM-2.7 Every tab gets the latest snapshot in the `snapshot` event and a `memory` event after each sample that changed something (a total, a row, the Pressure, a growth, a point); a snapshot an unchanged sample produced is sent to no one. (test)

### MEM-3 The breakdown

A click on the memory line opens a popover, as the usage strip's does (USAGE-2.1): a click, not a hover, since its rows are clickable and the 5 s cadence is tied to it being open.

- [x] MEM-3.1 A click on the line, or Enter or Space with focus on it, opens the breakdown as a popover beside the line (`side="right" align="end"`, as the usage details); Esc, a click outside, or a second click closes it. While it is open the tab tells the server (`PUT /api/memory/watch {clientId, open}`, as `PUT /api/work/watch` does, WORK-8.1), the server samples at once and then every 5 s (MEM-2.3), and the tab tells it when it closes; a tab whose event stream ends counts as closed. Only one of the two dock popovers is open at a time: opening one closes the other. (e2e)
- [x] MEM-3.2 The header shows the watched total large (`title`, `tabular-nums`), then "of 24 GB on this Mac · pressure normal" in `meta`; the Pressure word reads in `warning-text` at `warn` and `destructive-text` at `critical`, each with the design system's level icon beside it (USAGE-1.2's triangle and octagon), and plain `muted-foreground` when normal. How old the sample is sits at the header's end ("sampled 3 s ago", "old · 1m" in the info tone after a skipped sample, MEM-2.6). (test)
- [x] MEM-3.3 Under the header a sparkline of the trend (MEM-2.4), 30 minutes wide, with a label: "last 30 min" and the change from its first point to its last with lucide's `TrendingUp` or `TrendingDown` ("+180 MB", "−40 MB"); its vertical span is at least 50 MB, so a flat line doesn't look like a cliff; with fewer than 2 points it reads "collecting…" and draws nothing. (test)
- [x] MEM-3.4 Then a split bar, the sum of every process's RSS as 100%, in three parts, Lookout, Sessions and other, each at least 2% wide when it isn't zero, with a legend of the three names and their sizes; the parts are told apart by texture and the legend, not colour alone (`foreground/55`, `foreground/30` and the track, DS-3.2's palette). (test)
- [x] MEM-3.5 Then two sections, Lookout and Sessions (other has no rows: it is one number in the legend). A row shows its name (the Session's title, with its Harness mark monochrome, DS-3.1; "Lookout" for the server), a faint detail in `caption` with its biggest executables, the top 3 of 1 MB or more by their `comm` basename, each with a count when there are several and its MB (`claude 312 · node ×2 96 · vitest 214`), a growth badge when MEM-2.5 says it grows (`Chip`, `warning` tone: `TrendingUp` and "+180 MB in 10 min"), a bar relative to the section's largest row (the usage details' solid bar, DS-3.2), and its size at the end in `tabular-nums`. Rows sort by size, largest first, and don't move while the pointer is over the popover (SIDE-3.4's rule). A Session Fleet lists whose tree the sample doesn't hold (its pid exited between the two reads) shows "gone" in its detail, 0 B, for that sample. (test)
- [x] MEM-3.6 A Session row is a button: a click, or Enter on it, selects that Session in the sidebar and closes the popover, nothing else (no start, resume or send); its accessible name is "Open <title>, 612 MB, growing +180 MB" in the order shown. The Lookout row is plain text. The rows are reachable with Tab and ↑/↓ inside the popover; focus returns to the memory line when it closes. (test)
- [x] MEM-3.7 Empty and loading states are the design system's: before the first sample, "Reading memory…" (DS-6.3) in the popover too; with no Session listed, the Sessions section says "No live Sessions" in `meta` `muted-foreground` and keeps the Lookout row; after a skipped sample the header's age reads old (MEM-3.2) and the rows stay as they were. (test)
- [x] MEM-3.8 Seen at 280 px, light and dark, with four Sessions, one growing, the Pressure forced to `warn`: the header, sparkline, split bar and rows fit the popover's 22 rem without a horizontal scroll, long Session titles truncate before the size, the badge never wraps, and the popover never covers the Session list's selected row. (manual)

### MEM-4 Growth on the Session row

- [x] MEM-4.1 When MEM-2.5 says a Session's tree grew 30 MB or more in 10 minutes, its row shows lucide's `TrendingUp` in `warning-text`, the size of the context ring, in the second line's numbers group before the Subagent count (SIDE-9.1's place); its tooltip reads "Memory +180 MB in 10 min", the row's accessible name adds "memory growing, +180 MB in 10 min" before the Subagent count (SIDE-3.10's order), and its colour keeps 4.5:1 on every row state (SIDE-3.11's test). Nothing shows otherwise: never a "0", never a mark for shrinking. (test)
- [x] MEM-4.2 The mark follows the samples through the `memory` event: it shows within one sample of the growth (MEM-2.3), goes within one of the 10-minute window no longer holding it, goes with its row when Fleet stops listing the Session, and changes nothing else on the row: not the Status, the marker, the strip, the age or the order (SIDE-3.1, SIDE-3.4). (test)
- [ ] MEM-4.3 At 280 px the mark is never cut: it joins the numbers group, which never shrinks (SIDE-2.14, SIDE-9.5), and sits clear of the Subagent count and the age, the row's lines still aligned (SIDE-3.8). (manual)

### MEM-5 CPU and load

The incident that motivates this feature was load, not memory (decided 2026-10-24, Key decisions).

- [x] MEM-5.1 The sample's `ps` has one more column, `%cpu=`, and a tree's CPU is the sum of its processes'; a row whose tree is at 10% or more shows it after its size in the breakdown (`cpu 140%`), with the Mac's core count as the scale in its tooltip ("140% of 1200%"). (test)
- [x] MEM-5.2 The breakdown's header carries the 1-minute load average from `os.loadavg()` with the core count from `os.cpus().length` ("load 3.3 · 12 cores"), in `warning-text` with the triangle from one load per core, in `destructive-text` with the octagon from two per core; the memory line's glyph takes the worse of the memory level (MEM-1.3) and this one. (test)
- [x] MEM-5.3 The memory line reads `▌ 2.4 GB · load 3.3`, the load rounded to one decimal, and shows the Pressure word instead only when it isn't normal (`▌ 2.4 GB · pressure warn`), since "pressure normal" says nothing on a normal day and the load is the number that was 33. (test)

## Non-goals

- Killing, pausing or renicing any process from Lookout; the breakdown is a map, and the Session's own Stop (VIEW-4.4) or End Session (VIEW-5.6) are the actions.
- The browser tab's own memory: Lookout's server can't see it (a Chrome renderer isn't in any tree the server owns), and it says so in the breakdown's other legend ("this tab is in other"). Measuring it from inside the tab (`performance.measureUserAgentSpecificMemory()`) needs cross-origin isolation headers (Key decisions).
- More than the top 3 executables per row, a per-process list, or a tree view; Activity Monitor has them.
- Swap, compressed memory, wired memory, `vm_stat`'s page counts, GPU memory: RSS and the Pressure level are what one `ps` and one `sysctl` give; the sum of RSS over-counts shared pages (Known gaps) and that is accepted.
- History beyond 30 minutes, or across restarts; a chart per row (the trend is of the watched total only).
- Notifications, sounds or a toast when memory or load is high (the toast idea is the Backlog's "Needs you while you look elsewhere").
- Attributing memory to a Subagent within a Session (they run in the Harness's process), or to a tmux pane that holds no Session.
- Headless Sessions (`claude -p`, Agent SDK runs): Fleet doesn't list them, so they are in other.
- Other Hosts; Linux (`ps` differs, no `memorystatus`).
- A memory column in History or Work.

## UX

```
┌──────────────────────────────┬───────────────────────────────────┐
│ ◆ fix-deal-rates        [cl] │                                   │
│   [wt] crm-rates     ↗ [sa]2 │  ← MEM-4: the growth mark, before │
│ ● kg-hook-review        [ox] │    the Subagent count              │
│ …                            │                                   │
├──────────────────────────────┼───────────────────────────────────┤
│ ✳ ███░░░░░░░░░░░░░░░  6% 4h52│ composer                          │
│   weekly 66% · updated now   │                                   │
│ ⊛ █░░░░░░░░░░░░░░░░░  0%     │                                   │
│   weekly 39% · as of last…   │                                   │
│ Jev ✓ ready                  │                                   │
│ ▌ 2.4 GB · load 3.3          │  ← MEM-1, one caption line        │
└──────────────────────────────┴───────────────────────────────────┘
```

- `▌` stands for the glyph: a 3 × 12 px rounded bar drawn in CSS like the Status strip (SIDE-3.6), in the level's token (MEM-1.3), with `transition-colors duration-700` and no glow; Lookout's design system has no glows, and a glow on an amber bar would be the brightest thing in the sidebar (DS-3.7). `↗` stands for lucide's `TrendingUp` ([0008](../../decisions/0008-lucide-icons-only.md)); the usage strip's marks are as in USAGE's mock-up.
- **Fit:** measured on 2026-10-24 in the running app at 1512 × 707, sidebar 280 px, Claude and Codex each with a 5-hour window and Jev ready: the dock cell is 121 px (a 1 px top border and DockRest's 120: the empty composer frame 92, the status bar 28); the usage trigger is 102 px (8 px padding, Claude 30, a 4 px gap, Codex 30, a 4 px gap, Jev 18, 8 px padding), which leaves 18 px, and a `caption` line with the strip's 4 px gap needs 20. So an own line under Jev's overshoots the resting dock by 2 px unless the padding around it gives 4 px back: the strip's bottom padding becomes the gap above the line (`pb-1`) and the line's own bottom padding is 4 px (8 + 86 + 4 + 16 + 4 = 118 ≤ 120). The Jev line itself has about 180 px free to its right. The line is a sibling of the usage strip's button in the dock cell, under it, never inside it (a button can't hold a button).
- The line: the glyph, then the total in `font-medium tabular-nums`, then ` · ` and the Pressure word (or the load, MEM-5.3) in `muted-foreground`, `text-caption leading-4`, `px-2.5`, hover and focus as the usage strip's trigger (`hover:bg-sidebar-accent/50`).
- **The breakdown** (MEM-3), a popover of 22 rem like the usage details, `side="right" align="end"`:

```
┌────────────────────────────────────────────────┐
│ 2.4 GB                          sampled 3 s ago│  ← title size; age at the end
│ of 24 GB on this Mac · pressure normal         │  ← meta; load 3.3 · 12 cores with MEM-5
│ ▁▂▂▃▃▃▄▄▅▅▆▆▇▇  last 30 min · ↗ +180 MB        │  ← sparkline, ≥ 50 MB span
│ ███▒▒▒▒▒▒▒▒░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  ← Lookout · Sessions · other
│ Lookout 96 MB · Sessions 2.3 GB · other 9.1 GB │     (this tab is in other)
├────────────────────────────────────────────────┤
│ LOOKOUT                                        │
│ Lookout                                  96 MB │
│   node 51 · fleet 12 · tb-session 9            │
├────────────────────────────────────────────────┤
│ SESSIONS                                       │
│ ✳ fix-deal-rates  [↗ +180 MB in 10 min] 612 MB │  ← a button: selects the Session
│   ████████████████████████████████             │  ← bar relative to the largest row
│   claude 312 · node ×2 96 · vitest 214         │
│ ⊛ kg-hook-review                        498 MB │
│   ████████████████████████                     │
│   codex 410 · node 88                          │
│ ✳ spec-lookout                          402 MB │
│   ████████████████████                         │
│   claude 402                                   │
└────────────────────────────────────────────────┘
```

  - Section headers in `caption` medium `muted-foreground`, as the usage details' provider headers; rows in `body`, the detail in `caption` `muted-foreground`, the bar the usage details' solid one (`h-1.5`, `foreground/55`); the growth badge a `Chip` in the `warning` tone, `TrendingUp` then the amount; sizes `tabular-nums`, right-aligned on one column so they line up.
  - A Session row is a `button` the width of the row, with the row's hover (`hover:bg-accent`), `aria-label` as MEM-3.6; the Lookout row is a `div`. Keyboard: Tab reaches the first Session row, ↑/↓ move between rows, Enter opens, Esc closes and returns focus to the memory line (Radix's Popover does the focus part, as for the usage details).
  - Colour by meaning (DS-2): the only amber in the breakdown is a growth badge, the Pressure word at `warn` and the load at one per core; red is `critical`, two per core, or a watched total past two thirds of RAM; the bars and the split bar are neutral. Staleness is the info tone (DS-3.3).
- **States:** "Reading memory…" (DS-6.3) in the line and the popover before the first sample; "collecting…" in the sparkline's place until 2 points; "old · 1m" in the header after a skipped sample; "No live Sessions" in the Sessions section when Fleet lists none; a Session row at 0 B says "gone" (its pid exited between Fleet's read and `ps`).
- **Shortcuts:** none new. The line is in the Tab order after the usage strip's trigger; Enter and Space open it.

## Technical approach

Adapted from Matej's recipe for his Electron app ([Recipe: memory usage overview](https://claude.ai/artifact/RKopD7r3zdkgQqGjMjgudk)); Lookout's Node server does what his main process does, and the tab what his renderer does.

### Sampling (MEM-2.1, MEM-2.2)

- **One `ps` per sample:** `ps -axo pid=,ppid=,rss=,comm=` (`%cpu=` added for MEM-5), through `server/exec.ts`'s runner with the cleaned environment and a 2 s timeout. Measured on this Mac on 2026-10-24: 0.02 s for 721 processes. `comm` is the executable's path (`/Applications/Google Chrome.app/…/Google Chrome Helper (Renderer)`) or its bare name when the process was started by name (`claude`, `node`); the detail shows the basename. RSS is in KB; it is read into bytes once and never re-read from text.
- **The tree:** a `Map<ppid, pid[]>` from the lines, and `treeTotal(root)` walks it iteratively (no recursion: a tree can be hundreds deep after a fork bomb, and a cycle from a reused pid must not hang the sampler, so a pid is visited once). The Session roots are the `pid`s of the rows the server already holds from `fleet list --json` (every 2 s, SIDE-1.1), View only rows included: on 2026-10-24 Fleet listed this Session as `pid 22989, backend unknown, tmux_session null` and a tmux one as `pid 59164, tmux_session work-2`; both have a `pid`. Lookout's root is `process.pid`. Sessions Lookout starts run under the tmux server (`/opt/homebrew/bin/tmux`, a child of launchd), never under Lookout's server, so the two never nest in practice; the cut-out rule in MEM-2.2 is there so that a Session can't be counted twice if one day they do (a Session started from a shell under a Session, for instance).
- **Pressure and RAM:** `sysctl -n hw.memsize kern.memorystatus_vm_pressure_level` prints two lines (checked: `25769803776` then `1`); one call, one fake in a World (Dependencies). `os.totalmem()` is only the fallback before the first successful read. Pressure 1, 2 and 4 are the documented levels; anything else reads as normal.
- **Accuracy:** RSS counts shared pages in every process that maps them, so a tree's total and the sum over the Mac both over-count (the Chrome helpers on this Mac sum past what Activity Monitor calls "memory used"). It is the same error in every number here, which is what makes the parts comparable, and it is written in the Known gaps rather than corrected: a per-page accounting is `vmmap`'s job.

### Cadence, the watch route and events (MEM-2.3, MEM-2.7, MEM-3.1)

- `server/memory.ts` holds the sampler: a `setTimeout` chain with the next sample due an interval after the last one *started* (the usage poller's rule, so the cadence doesn't drift), 30 s with no breakdown open and 5 s with one; one sample in flight at most; `watch()` from the app's event-stream handling keeps it running only while a tab is connected, and `close()` aborts, kills the process group and awaits, as `server/usage.ts` does.
- `PUT /api/memory/watch {clientId, open}` mirrors `PUT /api/work/watch` (WORK-8.1): a mutation, so the token and Origin apply; an unknown `clientId` is 404, a non-boolean `open` 400; the set of open tabs decides the cadence, and a stream that ends removes its tab. The tab calls it from the popover's `onOpenChange`, as the usage strip calls `refreshJev` today.
- The snapshot (`shared/memory.ts`):

```ts
interface MemorySnapshot {
  sampledAt: number;            // ms since the epoch; the tab shows the age from it
  old: boolean;                 // the last sample was skipped (MEM-2.6)
  ramBytes: number;             // hw.memsize
  pressure: 'normal' | 'warn' | 'critical';
  watchedBytes: number;         // lookout + sessions
  totalBytes: number;           // every process's RSS summed (the split bar's 100%)
  lookout: MemoryRow;
  sessions: MemoryRow[];        // keyed by SessionRow.id, sorted by bytes desc
  otherBytes: number;
  trend: { at: number; bytes: number }[];   // ≤ 60 points, oldest first
  load?: { one: number; cores: number };     // MEM-5
}
interface MemoryRow {
  id: string;                   // 'lookout' or the SessionRow id
  bytes: number;
  top: { name: string; count: number; bytes: number }[];  // ≤ 3, ≥ 1 MB, by bytes desc
  growthBytes: number | null;   // ≥ 30 MB → growing (MEM-2.5); null when not
  cpuPct?: number;              // MEM-5
}
```

- `ServerEvent` gains `memory: MemorySnapshot | null` in `snapshot` and a `{ type: 'memory'; memory }` event; a sample is compared to the last snapshot by value (the trend's point count included) and sent only on a change. A `SessionRow` gains `memoryGrowthBytes: number | null` so the sidebar row (MEM-4) reads the mark from the row it already has, written by the server when it merges the sample into its rows; the breakdown reads the snapshot.

### Trend and growth (MEM-2.4, MEM-2.5)

- The ring is in the sampler, 60 entries, a point only when the last one is ≥ 30 s old, so the 5 s cadence adds nothing extra and 30 minutes stays 30 minutes. The sparkline's span is `max(50 MB, max − min)` around the points, so a flat 2.40–2.41 GB draws flat.
- Growth history is a per-row list of `{at, bytes}` trimmed to 10 minutes; `growthBytes = latest − oldest` when that is ≥ 30 MB, else null. A row that vanishes drops its list; a new row starts a new one, so a Session resumed under a new pid starts from zero. The pure functions live in `shared/memory.ts` (parse, tree, owners, top executables, growth, level, formatting) with unit tests per criterion; only `server/memory.ts` runs `ps` and `sysctl`.

### Colour and the design system (MEM-1.3)

- Matej's glyph blends five hand-picked colours (`#CDB8F5` → `#A07EEA` → `#6B4FB0` → `#A33A50` → `#FF4D6A`) in OKLab with `color-mix`, stops every 1/12 of RAM, red from a third, bright red forced at critical Pressure, a 0.8 s transition and a soft glow. In Lookout a raw colour fails DS-2.3's guard test, purple means nothing in the design system (DS-2's families), and amber means "act on it, now or soon" and red "critical". So the glyph is the design system's levels: `muted-foreground`, `warning`, `destructive` at a third and two thirds of RAM or by Pressure, the transition kept and the glow dropped. The thresholds are the recipe's (red from a third of RAM is where its scale turned red; two thirds is one more step) and are one constant each in `shared/memory.ts`. Q3 holds the alternative, a `memory` token family with the five stops, should Dario want the gradient.
- The guard test's allowlist (`web/src/test/design-system.test.ts`) gains the memory files for `warning`, `warning-text`, `destructive` and `destructive-text`, each with its why, as `lib/usage.ts` has today.

### Client

- `web/src/components/MemoryLine.tsx` (the line and its popover, as `UsageStrip.tsx` holds both) and `web/src/lib/memory.ts` (formatting and level classes); the sidebar's dock cell renders it under `UsageStrip`, both stacked over `DockRest` as today (`Sidebar.tsx`, SIDE-8.1). `SessionItem.tsx` adds the mark to its numbers group before the Subagent count.
- The sparkline is an inline SVG, `currentColor` strokes, `aria-hidden`, its reading in text beside it (MEM-3.3); the split bar three `span`s in one track.
- Selecting a Session from a row goes through the sidebar's `onSelect` (`push`), the same path as a click on the row.

### Dependencies

- **Fleet:** nothing new; `pid` has been in `list --json` from the start ([0004](../../decisions/0004-fleet-cli-as-session-layer.md), [0006](../../decisions/0006-run-a-fork-of-fleet.md)).
- **Dock layout fixture:** `.usage({ claude, codex, jev })` declares session and weekly percentages for both providers and Jev readiness. Only `fleet --local usage --json` is intercepted by the Fleet wrapper; all other Fleet calls stay real. A strict `tb-jev status --json` fake supplies Jev. The dock test selects a declared Session and compares its resting composer against the dock with all three usage lines populated.
- **World needs (TEST-1.5):** a `.memory({ processes, pressure, ramBytes })` declaration: the World's `ps` answers the sampler's exact argv (`-axo pid=,ppid=,rss=,comm=`, with `%cpu=` for MEM-5) from an answer file the test can rewrite mid-test (as `tb-prod`'s, TEST-1.6), with the declared rows plus the World's own Lookout server and its children (so the Lookout row is real), and passes every other call to the shim's behaviour (`e2e/shims/ps`, which Fleet's discovery needs, TEST-1.10); a `sysctl` shim passing unrelated calls through to the system command, while calls naming either memory key always reach a strict fake: it answers only `-n hw.memsize kern.memorystatus_vm_pressure_level` with the declared values and refuses malformed memory calls (TEST-1.5). A Session row in a World needs a Fake Harness with a known pid (TEST-1.4), still unbuilt.
- **Tags:** the World memory fakes exist: MEM-1.2, MEM-2.3 and MEM-3.1 are `(e2e)`. MEM-3.6 and MEM-4.2 turn `(e2e)` mechanically when Fake Harnesses with known pids exist (TEST-1.4); until then they remain `(test)`. MEM-2.1, 2.2 and 2.5 stay `(test)` on the pure module with a sanitized `ps` fixture using the Mac readings recorded above (TEST-6.2: no user name or home path in a `comm`).
- **Design system:** `Chip` gains a `warning` tone (a `warning/40` border and `warning-text`, built as the `ok` tone is) in the same change (DS-8.3, [0009](../../decisions/0009-one-design-system-guarded-by-tests.md)); the usage details' solid bar and level icons and `Loading` exist; `TrendingUp` and `TrendingDown` come from lucide ([0008](../../decisions/0008-lucide-icons-only.md)).

### Known gaps

- **Shared pages count in every process that maps them**, so every sum here is above what Activity Monitor calls memory used; the ratio is right, the absolute isn't. Accepted (Non-goals).
- **The browser tab** that shows Lookout is a Chrome renderer in other; the server can't tell it from the rest (Key decisions).
- **A process that leaves its tree** (a dev server started with `nohup`/`setsid`, or Claude Code's background shell once the Session ends) reparents to launchd and falls into other; a Local server (PORTS) would be the way to name it.
- **Memory in flight between the two reads:** Fleet's list (every 2 s) and `ps` are two instants, so a Session that exited in between shows 0 B and "gone" for one sample, and one that just started shows nothing until the next list.
- **`comm` of an app bundle** is its full path; the detail shows the basename, so two different helpers with one basename (`Google Chrome Helper (Renderer)` from two Chrome versions) merge into one entry with a count.
- **The first 10 minutes after a start** compare with the oldest sample, so a Session that starts a test run in its first minute is "growing" at once; that is the mark doing its job, but it also means every Session that runs tests will wear the mark for up to 10 minutes after the run ends (its total is still 30 MB above the pre-run sample until that sample ages out). Kept as the recipe has it (Key decisions).

### Key decisions

- **At the bottom of the left sidebar, in the dock row with the usage strip** (Dario, 2026-10-24): always visible, which is the point, beside the other "what the Mac has left" number; the right sidebar is closable, its panels run past the dock line, and it is for Work and History, not the Mac.
- **A click opens a popover, as the usage strip's, not a hover** (Dario, 2026-10-24): the breakdown has clickable rows, and the 5 s cadence is tied to "open", which a hover can't mean.
- **A Session row in the list gets a small amber `TrendingUp` when its tree grew 30 MB or more in 10 minutes** (Dario, 2026-10-24): the list is where you look, and 30 MB in 10 minutes is the recipe's threshold; amber is "soon" (DS-2), which growth is.
- **The server samples; the tab renders** ([0003](../../decisions/0003-browser-first-react-stack.md)): only the server sees every process, and one `ps` for every tab is cheaper than one per tab.
- **One `ps` for every number**: parts that come from one listing add up; two listings (a tree walk per Session, say) would disagree by whatever moved between them.
- **RAM from `sysctl hw.memsize`, in the same call as the Pressure, `os.totalmem()` only as the fallback**: one command, one fake in a World, and a World can then declare the Mac's RAM without an environment variable.
- **The watched total is Lookout plus the Sessions, not the Mac's used memory**: the line answers "what do my Sessions cost", and the split bar answers "of how much" with other as one number; the Mac's own accounting (`vm_stat`) isn't comparable with RSS sums and isn't read.
- **Other is one number, no rows** (Dario, 2026-10-24, agreed): what the Sessions cost is the question; a row per tmux pane would show tmux (0001), and a row per app is Activity Monitor.
- **An own line under the usage strip, not a shared line** (Dario, 2026-10-24, agreed): the dock is 120 px and the usage trigger 102 with Claude, Codex and Jev, so 18 px are free of the 20 a `caption` line with the strip's gap needs; the strip's bottom padding becomes the gap (`pb-1`) and the line has 4 px under it (8 + 86 + 4 + 16 + 4 = 118 ≤ 120), so SIDE-8.1's resting height holds in every view. The line is a sibling button of the usage trigger, since sharing Jev's line saves nothing the padding doesn't and a button can't nest a button. A third provider would push the dock past the composer by one line, as SIDE-8.1 allows.
- **CPU and load beside memory, as MEM-5** (Dario, 2026-10-24, agreed): the incident was load (33 on 12 cores), and Pressure was probably normal throughout. `%cpu` is one more `ps` column at no cost (measured: 97.5% for a busy process after one second, 0.1% asleep), the load is `os.loadavg()`; the glyph takes the worse of memory and load, and the line reads `▌ 2.4 GB · load 3.3` with the Pressure word only when it isn't normal. Thresholds (one and two loads per core) are a guess until seen.
- **The tab's own memory is not in slice 1** (Dario, 2026-10-24, agreed): `performance.measureUserAgentSpecificMemory()` needs cross-origin isolation (COOP `same-origin`, COEP `require-corp`), which changes what the page can embed and open (the Library's route opens pages in new tabs, LIB-3.3; a popup loses `window.opener`). The legend says "this tab is in other"; try the headers as a Later item once LIB's route is built, so both are tested together.
- **The growth rule is the recipe's: oldest sample in 10 minutes** (Dario, 2026-10-24, agreed): a Session that just ran tests wears the mark for up to 10 minutes, which is useful during the incident this is for. Look again after the first week; a stricter rule (latest total above every total of the last 10 minutes minus 30 MB) is a one-line change in `shared/memory.ts`.
- **The glyph is a CSS bar, the mark a lucide icon**: 0008 keeps Unicode symbols out of the UI, and the Status strip is already a CSS bar of the same shape.
- **The glyph's colour is the design system's three levels, not the recipe's purple-to-red gradient** (Dario, 2026-10-24, agreed): raw colours fail DS-2.3, and the design system already says what amber and red mean.
- **A Session's tree wins over any tree containing it**: counted once, and a Session is the thing to name.
- **A trend of the watched total only, not per row**: 60 points × N rows is a chart nobody asked for; the growth badge is the per-row trend that matters.
- **`setTimeout` chain with the interval counted from the sample's start**: the usage poller's rule; an interval would pile up samples behind a slow `ps`.
- **A skipped sample keeps the last snapshot, marked old**: the usage strip's high-water rule; a blank line on a hiccup is worse than an old number with its age.
- **Nothing from `ps` but numbers and executable names reaches the tab**: a command line can hold a token (`--api-key …`), and `comm` can't, which is one reason the sample reads `comm=`, not `command=`.
- **The e2e list is written now**: the retag is a mechanical step when the fakes land, and it tells the World what to fake (LIB's rule).

## Open questions

None.

## Changelog

- 2026-10-24: Created from the Backlog entry "Memory overview: what the Sessions cost the Mac" and Matej's recipe, with Dario's three decisions (the left sidebar's dock row, a click popover, the amber mark on a growing Session's row) as Key decisions, and six open questions with recommendations for the grill: fit under the usage strip (measured in the running app, 18 px free of 20 needed, solved by padding), CPU and load beside memory (MEM-5, recommended), the glyph's colour against the design system (levels recommended over the gradient), what "other" is, the tab's own memory, and the growth mark after a test run. Not grilled.
- 2026-10-24: Grilled (`/p-dev:grill-me`, six questions): Dario agreed to all six recommendations as written (own line under the usage strip, CPU and load as MEM-5, the design system's levels, other as one number, tab memory out of slice 1, the recipe's growth rule); folded into Key decisions, Open questions removed. One mismatch fixed: the Summary, MEM-1.1 and the mockup showed `pressure normal`, now the load per MEM-5.3. Status Draft to Ready.
- 2026-10-24: Built the sampler, dock line, breakdown and Session growth marks; status Ready to In Progress, pending verification. Added the World memory declaration and exact-argv `ps`/`sysctl` fakes with replaceable answers; MEM-1.2, MEM-2.3 and MEM-3.1 now have Behaviour tests and are retagged `(e2e)`. MEM-3.6 and MEM-4.2 remain `(test)` until Fake Harnesses exist (TEST-1.4), as the Dependencies section requires. Manual criteria remain for Dario.
- 2026-10-24: All 20 `(test)` criteria pass and are ticked. The three Behaviour criteria remain unticked: e2e global setup cannot read its own process start time in this sandbox, before any World starts. The three `(manual)` criteria remain unticked for Dario; status stays In Progress. The accounting fixture uses sanitized names and RSS values recorded in this spec with synthetic pids and tree edges, rather than a fresh host process capture.
- 2026-10-24: Fixed the World sysctl override breaking login-shell startup (`sysctl -n kern.boottime`, TEST-1.2). Like the ps shim, the sysctl shim passes unrelated calls through; either memory key always selects the strict fake, so malformed sampler calls cannot reach the real command.
- 2026-10-25: Review round 1: expire trend points by timestamp on recording, snapshot reads and failed samples, and filter the rendered trend and delta by the app clock (MEM-2.4, MEM-3.3); count current Session-row growth marks for the announcement (MEM-1.4); repeatedly apply the split-bar minimum while redistributing (MEM-3.4). Behaviour tests now check release after closing the breakdown, disconnecting its stream and closing the last tab; API tests verify the exact 30-second boundary and zero reads without tabs (MEM-2.3). The dock test now declares Claude, Codex and Jev usage and checks SIDE-8.1’s resting composer height and alignment (MEM-1.2).
