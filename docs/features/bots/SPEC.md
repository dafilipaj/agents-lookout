---
title: "Bots: Sessions that start on a schedule and report to the Inbox"
code: "BOT"
status: "In Progress"
created: "2026-11-26"
updated: "2026-11-26"
---

# Bots

## Summary

A Bot is a saved start with a schedule: at its times, or when you press Run now, Lookout starts a Session with the Bot's prompt, follows it until it has finished, ends it, and its Report arrives in the Inbox (INBOX). Bots are made, switched and watched in a tab of the right sidebar, in every place. Lookout ships none: what each Bot asks is yours to design, and usually one line that calls a skill ([0017](../../decisions/0017-one-app-for-both-roles.md)).

## Problem

A report on what the team did last week, or on which tests went flaky overnight, is the same prompt every time, and today it runs only when Dario remembers to start the Session, wait for it and find what it wrote. The start is the launcher's and the result is in the Library; what's missing is the schedule, something that follows the run, and a place where its result arrives.

## Requirements

### BOT-1 The Bots tab

- [x] BOT-1.1 The right sidebar has a seventh tab, Bots, after Topics, with lucide's `Bot` icon. With focus not in a text field and no dialog open, `B` opens the sidebar on Bots, switches to it from another tab, and closes the sidebar when Bots is showing, as the other tabs' keys do (WORK-1.1). The closed rail has a Bots button under Topics. Which tab is open is remembered with the others' (WORK-1.2). (test)
- [x] BOT-1.2 The tab lists every Bot as a row of one listbox: Bots that are on first, by their next time, soonest first, then those with no time, then Bots that are off, each group by name. A row shows the Bot's name, its schedule in words (BOT-3.1), and one fact about its runs: "running", "waiting on you" in Needs you's amber, "next Mon 07:30", or for a Bot with no time ahead its last run's age ("ran 2d ago", "failed 2d ago" with a warning triangle). A Bot that is off shows an "Off" chip and is dimmed. (test)
- [x] BOT-1.3 Above the list is "New Bot", a Secondary button with a plus. With no Bot the list is an empty state: "No Bots yet", "A Bot starts a Session on a schedule, and its Report arrives in the Inbox.", with New Bot as its action. (test)
- [x] BOT-1.4 ↑/↓ and j/k move through the rows; Enter on a selected row expands it, and on an expanded one runs its first button; Esc collapses it; `X` turns the selected Bot off or on. One row is expanded at a time (WORK-1.12, WORK-1.13). (test)
- [x] BOT-1.5 An expanded row is built as DS-21 says: its state (on or off, its schedule, its next time), its prompt's first three lines with the whole prompt in the tooltip, where and with what it starts (Start directory, Harness, model, Effort, "skips permissions"), and its newest five runs as a count that lists them in place, three at first and the rest behind "Show all" (DS-21.2), each a line with its state and when it started. A run's line opens its Report in the Inbox (INBOX-2.1), or its Session while it's running or waiting on you; before Fleet reports the Session (it's starting, or waits at its Trust prompt), its start. Its actions come last: **Run now** first, and under More: Edit, Turn off or Turn on, and Delete in the danger role. (test)
- [ ] BOT-1.6 Seen at a 280 px and a 360 px right sidebar, light and dark: seven tabs fit the strip, with the open tab's name whole at 360 px and its icon alone under 352 px, where a cut name would read worse; a row's two lines don't wrap, and an expanded row's actions sit on one line. (manual)

### BOT-2 Make, change and delete a Bot

- [x] BOT-2.1 New Bot and Edit open one dialog with: Name (required, at most 64 characters), Prompt (required, several lines, at most 20,000 characters), the launcher's Harness, Model, Effort, Skip permissions and Start directory, by the launcher's rules (LAUNCH-2.1, LAUNCH-3.1 to 3.5), and Schedule (BOT-3). A new Bot starts with the Harness, model and Start directory the launcher would (LAUNCH-1.2), "Only by hand", and on. Save is Primary and ⌘Enter; Esc and Cancel close it without saving. (test)
- [x] BOT-2.2 The server checks a saved Bot as it checks a start (a Harness it knows, a Start directory from Settings, a model and Effort that Harness lists) and its schedule (BOT-3.1); what it refuses is said beside its field and the dialog keeps everything typed (LAUNCH-4.4). Changes to one Bot are checked one at a time, each against the Bot as the change before left it, so two tabs can't save a Harness and a model that were never checked together. (test)
- [x] BOT-2.3 Bots are kept by the server in `~/.lookout/bots.json`, so they are the same in every tab and survive a restart; a change reaches every open tab without a reload. A file that can't be read leaves the tab saying so, with its path, and Lookout running; it is never overwritten while it can't be read, also when it stops being readable while Lookout runs (edited by hand, say): the next change is refused and the tab says so, until the file is put right. A file changed by hand that still reads is Lookout's to write over: edit it only while Lookout is stopped. (test)
- [x] BOT-2.4 Delete asks first, in a dialog that names the Bot and says its Reports stay in the Inbox; its confirm is the red fill (DS-18.1). A Bot with a run going can't be deleted: the dialog says to wait for it or end its Session. (test)
- [x] BOT-2.5 Turning a Bot off stops its scheduled runs and nothing else: a run that's going goes on, and Run now still works. Turning it on, or changing its schedule, never runs a time that already passed (BOT-3.4). (test)
- [x] BOT-2.6 One Lookout server runs the Bots. The first to start takes the store's lock (`bots.lock` beside `bots.json`, holding its process id); a lock whose process is gone, or that was given up, is taken over at the next look. A lock is whole from the moment it exists, and a stale one is replaced by one server at a time, so two servers that find the same stale lock never both run the Bots. A lock written before this Mac last started is stale whatever process has its number now. A server that can't write the lock runs no Bots, and its tab says why in an error `Alert`. A second server on the same store starts no run, follows none and saves nothing: it shows the Bots and Reports as the owner last wrote them, read again when the file changes, the Bots tab says "Another Lookout on this Mac runs the Bots. Here they can't be changed.", and every change, Run now and a Report's read and archived marks included, is refused with those words. A server started for development (`pnpm dev`, whatever `NODE_ENV` its shell had) never takes the default store's lock, free or not, so a look at a change beside the installed Lookout can't end up running its Bots. `LOOKOUT_BOTS` names another store file, with its own lock, for a server that should run its own; naming the default file there changes nothing. (test)

### BOT-3 The schedule

- [x] BOT-3.1 A schedule is "Only by hand", or one or more days of the week and one time of day in this Mac's time zone, to the minute. It reads in words wherever it shows: "Every day at 07:30", "Weekdays at 07:30", "Mondays at 07:30", "Mon, Wed at 07:30", "Only by hand". (test)
- [x] BOT-3.2 The server looks every 30 seconds for Bots that are due, with or without a browser tab open, and starts a due Bot's run within a minute of its time. (test)
- [x] BOT-3.3 A time that passed while the server wasn't running or the Mac slept is run once, on the first look after: one late run however many times were missed, and its Report says how late it started. (test)
- [x] BOT-3.4 Only times after the Bot was made, last turned on or last had its schedule changed are ever run, and only times after its last scheduled run's. A run is kept in the store before Fleet is asked to start it: one the store can't keep isn't started (Run now says so; a scheduled time stays due for the next look), so no time is run twice after a restart. (test)
- [x] BOT-3.5 A time that comes while the Bot's own run is still going is skipped, not queued, also when that run is over by the server's next look: the next time stands, and the Bot's expanded row says "Skipped 1 time while it was running" until its next run starts. (test)
- [x] BOT-3.6 A row's "next" is the next time its schedule gives after now, said as a day and a time ("next Mon 07:30", "next today 07:30"); a Bot that is off, or only by hand, has none. (test)

### BOT-4 A run

- [x] BOT-4.1 A run starts a Session as the launcher does (LAUNCH-4.1), with the Bot's Harness, model, Effort, Skip permissions, Start directory and prompt, named after the Bot and the day ("Team week · Nov 23"). A second run on one day under the same name, the same Bot's or another Bot's with that name, adds its time ("Team week · Nov 23 14:05"), so its Session's name is its own while an earlier run's Session is still live. It changes nothing the launcher remembers (LAUNCH-1.2), and no tab's selection moves: its "Starting…" row and then its Session show in Sessions like any other (LAUNCH-4.2). (test)
- [x] BOT-4.2 Run now starts a run at once, on or off, unless one of that Bot's runs is going: then the button is disabled and says "It's running". (test)
- [x] BOT-4.3 A run is *starting* until Fleet reports its Session, then *running*; it is *waiting on you* while its Session Needs you or its start waits at a Trust prompt (LAUNCH-6), and *running* again after (*starting* again after a Trust prompt, until Fleet reports the Session). (test)
- [x] BOT-4.4 A run has *finished* when its Session is Done and has come to rest (no longer At work), or is still At work 2 minutes after it said Done (by Fleet's own mark, so a restart of Lookout doesn't start them again); or has been Idle and not At work for 2 minutes without a break; or ended while it was Idle or Done. (test)
- [x] BOT-4.5 A run has *failed* when its start failed (the launcher's reason, LAUNCH-4.4 and 4.5: Fleet missing, the Start directory gone from Settings, the Harness not installed, no Session after 15 s) or was cancelled (its "Starting…" row dismissed, its Trust prompt declined), or when its Session ended while it was Busy or Needed you ("Its Session ended before it finished"). A run that was starting when the server stopped has failed too ("Lookout restarted while it was starting"). Nothing retries a failed run. (test)
- [x] BOT-4.6 When a run has finished and its Session is still live, Lookout ends that Session the way End Session does (VIEW-5.6), unless you opened it in Lookout after the run started (SIDE-13.1's record): then it's yours. A Session that Needs you or is At work is never ended: both, and whether you opened it, are asked once more of a fresh read of Fleet's list right before the end. A server that stopped, or gave the Bots up, while a run's reply and Outputs were read ends nothing: the run is the next server's to finish. The Session is the process the run started: one resumed since under another process, with the same Session id, isn't the run's; the run ends as its own process did, and the resumed Session is neither read for the Report nor ended. If the end fails, the run has still finished, the Session stays, and the server logs one line without the Session's name. A Report whose Session wasn't ended says "Its Session is still open". (test)
- [x] BOT-4.7 The server follows a run with no browser tab open, reading Fleet's list while any run is starting, running or waiting on you (AWAKE-2.1's watch), and picks a running or waiting run up again after a restart, from its Session's id. (test)
- [x] BOT-4.8 A run that finished, failed or began waiting on you arrives in the Inbox as a Report (INBOX-1.1). The server keeps the newest 500 runs and drops older ones; their Sessions stay in History and their Outputs in the Library. (test)

## Non-goals

- Bots that ship with Lookout, or a gallery of them: each is designed by Dario, one at a time ([0017](../../decisions/0017-one-app-for-both-roles.md)).
- A Bot per person or Goal, and what People needs of Bots: with People's spec.
- Running in the cloud, or as a Headless Session ([0013](../../decisions/0013-one-shot-claude-runs-for-lookouts-own-text.md)).
- Waking the Mac for a run, or holding it awake for one: Keep awake does that for any Session At work, when it's on (AWAKE).
- Several times a day, an interval, or a cron expression: one time on chosen days until a Bot needs more.
- Retrying a failed run, running Bots one after another, or passing one Bot's Report to another.
- Answering a run's prompt or its Trust prompt for you: a run that Needs you waits, as any Session does.
- The `/` list of commands and skills in the dialog's prompt (LAUNCH-8): later, if typing a skill's name by hand gets in the way.
- A Bot as a file you edit, or exporting and sharing Bots.
- Secrets or environment variables per Bot: a run has the login shell's environment, as every Session has ([0002](../../decisions/0002-start-sessions-through-a-login-shell.md)).

## UX

```
│ [History][Work][Library][Topics][Bots]… │
├─────────────────────────────────────────┤
│ [+ New Bot]                             │
│ Team week                       running │
│   Mondays at 07:30                      │
│ Flaky tests                             │
│   Every day at 02:00 · next today 02:00 │
│ Goals check                       Off   │
│   Only by hand · ran 6d ago             │
```

An expanded row:

```
│ Team week                               │
│   On · Mondays at 07:30 · next Mon 07:30│
│   /team-week for last week, as a page   │
│   ~/people · Claude Code · Default · high│
│   5 runs ▾                              │
│     ✓ finished · Mon 07:30              │
│     ! failed · Nov 16 07:30             │
│   [▶ Run now] [… More]                  │
```

- A row copies Setup's and Work's (GUIDE, "A list row"): `data-slot="row"`, the name in `body` medium on the first line with its one chip or fact at the right, the schedule and the rest in `meta` `muted-foreground` on the second.
- "waiting on you" is in `needs-you-text` with its words; "failed" has lucide's `TriangleAlert` in `destructive-text` and its word. Everything else is quiet.
- Run now is the Soft button (the row's Enter action); its icon is lucide's `Play`. Turn off and Turn on share Setup's switch icons and `X`.
- The dialog copies the launcher's: the same fields, drawn from the same pieces (`LaunchFields.tsx`, their rules in `lib/launch-fields.ts`), after Name, then Prompt and Schedule: a `Segmented` of "Only by hand" and "On a schedule", and for a schedule seven day toggles (Mon to Sun) and a time field. The `form` button size (DS-18.3).
- **Errors.** A `bots.json` that can't be read: an error `Alert` at the panel's top with the path. A second server (BOT-2.6): an info `Alert` there, and the tab's buttons disabled. A save the server refuses: beside its field. A run that failed: in its Report (INBOX-2.6) and among its Bot's runs; a Run now or a switch the server refuses: an inline `Alert` at the panel's top until the next try.
- **Shortcuts:** `B` the tab; in it ↑/↓, j/k, Enter, Esc and `X`.

## Technical approach

- **Store.** `server/bots.ts`, `BotStore`: `~/.lookout/bots.json`, `{ version: 1, bots: Bot[], runs: BotRun[] }`, written whole to a temporary file and renamed, mode 0600. Types in `shared/bots.ts`. A Bot: `id`, `name`, `prompt`, `harness`, `model`, `effort`, `skipPermissions`, `directory`, `schedule` (`{ days, time }` or null), `on`, `since` (BOT-3.4's floor), `skipped`. A run: `id`, `botId`, `botName`, `dueAt` (null for Run now), `startedAt`, `lateMs`, `state`, `launchId`, `sessionId`, `harness`, `lastStatus`, `idleSince`, `endedAt`, `failure`, `session` (`ended`, `yours`, `left` or null), and the Inbox's fields (INBOX).
- **Scheduler.** `server/bots.ts`, `Bots`: a 30 s timer that runs with no tab connected. `dueTime(schedule, after, now)` in `shared/bots.ts` gives the latest scheduled time in `(after, now]`, built from local calendar fields, so a daylight-saving change moves nothing; `nextTime(schedule, now)` gives BOT-3.6's. A Bot's `after` is the later of `since` and its last scheduled run's `dueAt`.
- **Starting.** `Launcher.start` with `remember: false` (BOT-4.1) and the run's own launch id; the launcher's `onChange` gives the Session id when Fleet reports it, and a launch that failed or waits at its Trust prompt.
- **Following.** `Bots.observe(rows)` from the monitor's `onList`, as Topics' and Handoffs' followers; while a run is in flight `Bots` holds `monitor.watch()`. At work is `isAtWork` (`shared/awake.ts`); "you opened it" is the row's `viewedAt` after the run's `startedAt`.
- **Ending.** `endSession` (`server/closer.ts`) with the row's pid and process start, so a replacement is never closed (VIEW-5.6).
- **Routes.** `POST /api/bots` (make), `PUT /api/bots/<id>` (change, on and off), `DELETE /api/bots/<id>`, `POST /api/bots/<id>/run`. The whole set goes to every tab as a `bots` event and in the snapshot.
- **Fleet.** Nothing new in the fork: `spawn`, `list` and `close` as LAUNCH and VIEW use them ([0004](../../decisions/0004-fleet-cli-as-session-layer.md), [0006](../../decisions/0006-run-a-fork-of-fleet.md)).
- **Tests.** The server's against the fake `fleet` and a clock, as `launcher.test.ts`'s; a World can't start a Session yet (TEST-1.4), so no criterion here is `(e2e)`.

### Key decisions

- **A run is a Session, started as the launcher starts one** ([0017](../../decisions/0017-one-app-for-both-roles.md), [0002](../../decisions/0002-start-sessions-through-a-login-shell.md)): it has your tools and skills, it can Need you, and everything Lookout shows of a Session works for it.
- **Lookout ends a finished run's Session** (Dario, 2026-11-26): the Report is what you read, the Session is one press from Resume, and a daily Bot would otherwise leave a live Session a day. Never one you opened, never one that Needs you or is At work.
- **Idle for 2 minutes counts as finished**: a Session that doesn't run `fleet done` still ends its run. Two minutes outlasts the gap between a Subagent's result and the reply to it; a Session that stopped to ask in plain words is resumed from its Report.
- **Done counts once the Session is at rest**: `fleet done` is nearly always seen while the Session still writes its last message, and a reply read then would be cut short.
- **A missed time runs once, late** (Dario, 2026-11-26): the Monday report is there when the laptop opens at 09:00. One run however many were missed, so a week off doesn't start seven.
- **A form, kept by Lookout** (Dario, 2026-11-26): a Bot's record is small, and the thinking goes into the skill its prompt calls, which also runs by hand in any Session.
- **Days and one time, not cron**: it covers daily, weekdays and weekly, and reads in words.
- **A time that comes during a run is skipped**: two runs of one Bot at once would write over each other.
- **One server owns the store**: a dev server beside the installed Lookout is how this repo looks at a change, and two schedulers on one store would start every run twice.

## Open questions

None blocking.

## Changelog

- 2026-11-26: Created from Dario's pivot (Plan item 67), grilled the same day in seven questions with INBOX, every one as recommended: a run is a Session on this Mac; a Bot is made in a form and kept by Lookout; Lookout ends a finished run's Session; one item per run in the Inbox; a missed time runs once when Lookout is back; no Bot is built with it.
- 2026-11-26: Amended while building, from what the code met. BOT-4.4: a Done Session's run finishes once it's at rest, since `fleet done` runs before the last message is whole. BOT-4.1: a second run on one day adds its time to its name, since Fleet refuses a name a live Session host has, and a run you opened stays live. BOT-2.6 added: one server runs a store's Bots, and a development server never the default store's (a `pnpm dev` beside the installed Lookout is how this repo looks at a change). BOT-4.3 and 4.5 name the states around a Trust prompt and a cancelled start. BOT-1.5: the runs list in place as DS-21.2's links do, three and then "Show all".
- 2026-11-26: From the review (Codex), before the first commit. BOT-2.6: a stale lock was replaced by a plain rename, so two servers that found it at once both ran the Bots until their next look; now a lock is linked into place whole and a takeover is serialised by a gate file beside it. A lock from before the Mac's last start counts as stale, since its process id may belong to something else after a restart, which would have left the Bots read-only until the file was deleted by hand. BOT-4.6: a run followed its Session by id alone, so a Session resumed under a new process was taken for the run's and could be ended; the run now keeps to the process it started, and the end reads Fleet's list once more and refuses a Session that went back to work.
- 2026-11-26: From the same review, the rest. BOT-3.5: a time that came during a run that was over by the next look was run late; it's skipped. BOT-3.4: a run is saved before Fleet is asked, and isn't started when it can't be, since a start the store didn't hold would be made again after a restart. BOT-2.6: a lock that can't be written no longer makes the server the owner; `pnpm dev` is a development server whatever `NODE_ENV` it inherited, and `LOOKOUT_BOTS` naming the default file gives it nothing; a server that stopped while a run was being finished ends nothing. BOT-4.6: whether you opened the Session is asked of the fresh list too. BOT-2.3: a file broken by hand while Lookout runs is no longer written over. BOT-2.2: changes to one Bot are checked in turn. BOT-4.1: two Bots with one name no longer ask Fleet for the same Session name. BOT-4.4: the 2 minutes count from Fleet's Done mark. BOT-1.5, BOT-4.3: a run with no Session yet names its start, so its line and its Report open where a Trust prompt is answered. Not taken: keeping more than the newest 500 runs in a different order (a run going is never the one dropped, by design).
- 2026-11-26: Built: `shared/bots.ts`, `server/bots.ts` with its routes and its wiring, the tab (`BotsPanel.tsx`, `BotDialog.tsx`, `lib/bots.ts`) and the launcher's fields shared with the dialog (`LaunchFields.tsx`, `lib/launch-fields.ts`). In Progress.
- 2026-11-27: BOT-1.6: the open tab hides its name by the sidebar's width as the tab strip is given it, not by a container query on the column, which broke the header line (SIDE-8.3). A tab that shows its icon alone is the same 28 px square open or not, with its count on the icon's corner.
