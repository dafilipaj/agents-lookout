---
title: "Keep the Mac awake"
code: "AWAKE"
status: "In Progress"
created: "2026-11-16"
updated: "2026-11-16"
---

# Keep the Mac awake

## Summary

One switch, in the bottom-right corner, keeps the Mac from sleeping while Sessions are At work: Awake stops idle sleep, and Lid closed also keeps it running with the lid shut, on the charger, through the Amphetamine app. It turns itself off once no Session has been At work for 5 minutes, the display still sleeps and locks as usual, and it lives in Lookout's server, so it doesn't need a browser tab open.

## Problem

A Session stops when the Mac sleeps: its Harness freezes mid-Turn and its API stream breaks. Since 2026-11-09, `pmset -g log` shows the Mac went to sleep 32 times on its own: 15 from idling (14 of them on the charger) and 17 from closing the lid (all on battery). In 8 of the idle sleeps and 7 of the lid closes, a Session had written to its Transcript in the 5 minutes before. Claude Code holds `caffeinate -i -t 300` while a Turn runs, so idle sleep mostly lands when no Turn is running. But no Harness stops it while a Session waits on a background job, and nothing stops a closed lid. Codex's own blocker, `prevent_idle_sleep`, is an experimental feature and off on this Mac. Dario: "I noticed that I sometimes need it."

## Requirements

A Session is **At work** when it's Busy, or when it has a Subagent or a background shell command still running (SIDE-9, SIDE-2.6), whatever its Status. Needs you, Idle and Done alone are not At work.

### AWAKE-1 The switch and what it runs

The server holds the choice and the processes behind it.

- [x] AWAKE-1.1 The server holds one mode, `off`, `awake` or `lid`. It sends the mode to every tab in the snapshot and as an `awake` event whenever the mode or what it shows changes (AWAKE-2.3, 3.4, 4.2). `POST /api/awake` with `{mode}` sets it; it is a mutation, so it needs the token and Origin. Each snapshot carries a `rev`, one more on each change, and a tab keeps the newest, whether a pick's answer or its event arrives first. (test)
- [x] AWAKE-1.2 While the mode is `awake` or `lid`, the server runs one `caffeinate -i -w <its own pid>`, found on PATH (which holds `/usr/bin` for a server started from a terminal or by launchd; `pmset` and `osascript` are found the same way). It never passes `-d`, so the display sleeps and locks as usual. Going `off` ends it. If it exits while the mode is on and the server didn't end it, the server starts it again. A second exit within 5 s turns the mode `off`, with the note "caffeinate stopped: <its first stderr line>". (test)
- [x] AWAKE-1.3 The mode and whether Lookout owns an Amphetamine session (AWAKE-3.3) are saved in `~/.lookout/keep-awake.json` (mode 0600, written whole to a new file and renamed) on every change. On start, the server reads them back and turns the saved mode on again; the 5-minute clock (AWAKE-2.2) starts then. A pick made while it restores waits for it, and stands. A file it can't read counts as `off`. (test)
- [x] AWAKE-1.4 On SIGINT or SIGTERM the server cancels an Amphetamine call still running, then ends its `caffeinate` and an Amphetamine session it owns (AWAKE-3.3), one call at a time, before it exits. It keeps the saved mode for its next start. (test)

### AWAKE-2 It turns itself off

Keep-awake covers every Session, and it ends once none has been At work for a while.

- [x] AWAKE-2.1 The count of Sessions At work is taken from Fleet's list every time the list changes. While the mode is on, the server reads Fleet's list itself, as a connected tab makes it do, so the count stays right with no tab open. (test)
- [x] AWAKE-2.2 While the mode is on and no Session is At work, the server turns the mode `off` 5 minutes after the later of two moments: the last time a Session was At work, and the moment the mode was turned on or restored. The note says "Turned off: no Session at work for 5 min". A Session At work before then stops the clock. (test)
- [x] AWAKE-2.3 The snapshot carries how many Sessions are At work and, while none is, when the mode will turn off (`offAt`), so the corner can count down (AWAKE-4.2). (test)

### AWAKE-3 Lid closed, through Amphetamine

On the charger, Lid closed keeps the Mac running with the lid shut, through the Amphetamine app's AppleScript. On battery it steps down to Awake.

- [x] AWAKE-3.1 Lid closed is available only when three things hold. The Mac is on the charger: `pmset -g batt`, read every 10 s while any tab is connected or the mode is `lid`, says `'AC Power'`. Amphetamine is installed, at `/Applications/Amphetamine.app` or `~/Applications/Amphetamine.app` (`LOOKOUT_AMPHETAMINE_APP` overrides both). Its Power Protect helper is at `~/Library/Application Scripts/com.if.Amphetamine/powerProtect.scpt`. Otherwise the snapshot says why: "Needs the charger", "Needs Amphetamine, from the Mac App Store", or "Needs Amphetamine's Power Protect helper, from Amphetamine's settings". `POST /api/awake` with `lid` while it's unavailable answers 409 with that reason. (test)
- [x] AWAKE-3.2 Choosing Lid closed first asks Amphetamine `session is active`. If a session is running that Lookout doesn't own, the server answers 409 `amphetamine-busy`. The corner then asks "Amphetamine already has a session running. Replace it with Lookout's?": Replace sends the choice again with `replace: true`, and Keep sets `awake`. Otherwise the server saves that it owns a session, then starts one with `start new session with options {duration:0, interval:0, displaySleepAllowed:true}`, then `enable closed display mode`, and saves that it owns it. `caffeinate` (AWAKE-1.2) keeps running beside it. (test)
- [x] AWAKE-3.3 Lookout ends an Amphetamine session (`end session`) only when it owns one: when the mode leaves `lid`, when it steps down (AWAKE-3.4), and when the server stops (AWAKE-1.4). It never ends one it didn't start. On start, an owned session left from a server that didn't stop cleanly is ended first, then the saved mode is restored. While Lid closed holds its session, the server asks `session is active` every 10 s. If its session was ended outside Lookout (Amphetamine's own menu), it no longer owns one and runs as Awake, with the note "Lid closed ended: Amphetamine's session was ended outside Lookout". (test)
- [x] AWAKE-3.4 While the mode is `lid` and the Mac goes on battery, the server ends its Amphetamine session and runs as Awake, with the note "Lid closed paused: on battery". When the charger is back, it starts its session again, but without asking. If a session it doesn't own is running by then, it stays Awake with the note "Lid closed paused: Amphetamine has a session of its own". (test)
- [x] AWAKE-3.5 Any failed Amphetamine call leaves the server running as Awake, with the note "Lid closed failed: <reason>". If macOS refused the Apple event (error -1743), the reason is "macOS doesn't let Lookout control Amphetamine. Allow it in System Settings, under Privacy & Security, then Automation". Lid closed's line in the menu shows that reason until a call succeeds, and Lid closed stays enabled, so picking it again tries again once access is allowed. Every call has a 60 s timeout, which leaves time to answer macOS's permission prompt on the first. (test)
- [ ] AWAKE-3.6 Checked once by hand on Dario's Mac, on the charger and with no external display: with Lid closed on and the lid shut for 5 minutes, a Busy Session keeps writing its Transcript, and `pmset -g log` shows no Clamshell Sleep. The AppleScript terms from Matej's recipe are checked against Amphetamine's dictionary at the same time. (manual)

### AWAKE-4 The corner

The switch sits in the bottom-right corner of the window, at the height of the Memory line, whether the right sidebar is open or closed.

- [x] AWAKE-4.1 With the right sidebar closed, the rail ends in a 28 px line whose top border lines up with the Memory line's. It holds an `IconButton` (`sm`) with lucide's `Coffee`. The button is pressed (`aria-pressed`, `sidebar-accent`) and in `foreground` while the mode is on, and in `muted-foreground` while off. Its name and tooltip say the state in words (AWAKE-4.2). (test)
- [x] AWAKE-4.2 With the right sidebar open, a 28 px footer line sits under its panels, drawn like the Memory line, with `Coffee` and the state in words:
  - "Sleeps as usual" when off;
  - "Awake · 2 at work" when on, with the number of Sessions At work;
  - "Awake · off in 4m" while none is At work, counting down;
  - "Lid closed · 2 at work" when Lid closed;
  - "Awake · lid closed paused" when stepped down (AWAKE-3.4), with the note in the tooltip.

  The panels lose those 28 px. (test)
- [x] AWAKE-4.3 Either one opens the same menu, from `ui/dropdown-menu.tsx`. It has three radio items, each with a line under it:
  - Off: "The Mac sleeps as usual";
  - Awake: "No idle sleep while Sessions are at work";
  - Lid closed: "Also with the lid shut, on the charger".

  The current mode is checked. Lid closed is disabled while unavailable, its line showing the reason instead (AWAKE-3.1). After a refused Apple event, its line shows that reason but the item stays enabled (AWAKE-3.5). The last note and its time (AWAKE-1.2, 2.2, 3.4, 3.5) sit under the items, after a separator. Arrows and Enter pick an item, and Esc closes the menu. (test)
- [x] AWAKE-4.4 Picking an item sends it, and the corner shows the server's answer, not the pick. A refusal shows its reason in the menu as an inline `Alert`; `amphetamine-busy` opens the dialog of AWAKE-3.2 instead. (test)
- [x] AWAKE-4.5 In a World with a fake `caffeinate` and `pmset`, picking Awake in the corner starts `caffeinate -i -w <the server's pid>`, and the corner reads "Awake · off in 5m" (or "4m", by the time it's read). Picking Off ends it, and the corner reads "Sleeps as usual". Without Amphetamine, Lid closed is disabled and says "Needs Amphetamine, from the Mac App Store". (e2e)
- [ ] AWAKE-4.6 The rail's line and the footer line sit level with the Memory line, at 280 px and at 360 px, in light and dark. Pressed reads clearly as on. (manual)

## Non-goals

- Lid closed on battery: Dario chose the charger only, so a Mac in a bag never stays awake.
- Keeping the display on, or the screen unlocked.
- Covering only some Sessions: no per-Session switch and no mark on Session rows.
- `sudo pmset disablesleep` or anything else that needs root.
- Showing, ending or changing anything else that keeps the Mac awake: Claude Code's own `caffeinate`, other apps', an Amphetamine session Lookout didn't start (beyond replacing it on your Yes), or Codex's `prevent_idle_sleep`.
- OS notifications: notes stay in Lookout (SIDE's Non-goal).
- A keyboard shortcut, or a duration to pick.
- Waking a sleeping Mac, or scheduling wakes.

## UX

```
Right sidebar closed: the rail             Right sidebar open (360 px)
┌────┐                                     ┌──────────────────────────────────┐
│ ⧉  │ History                             │ [▤ History] ▣ ▥ ◎ ▦            ✕ │
│ ▣  │                                     │  …panel…                         │
│ ▥  │                                     │                                  │
│ ◎  │                                     │                                  │
│ ▦  │                                     ├──────────────────────────────────┤
├────┤ ← level with the Memory line        │ ☕ Awake · 2 at work             │
│ ☕ │   (pressed while on)                └──────────────────────────────────┘
└────┘

Menu
┌──────────────────────────────────────────┐
│ ○ Off                                    │
│   The Mac sleeps as usual                │
│ ● Awake                                  │
│   No idle sleep while Sessions are at work│
│ ○ Lid closed                 (disabled)  │
│   Needs the charger                      │
├──────────────────────────────────────────┤
│ Turned off: no Session at work for 5 min │
│ · 3m ago                                 │
└──────────────────────────────────────────┘
```

(☕ is lucide's `Coffee` in the app.)

- The rail's button and the footer line open the same menu. Neither has a key of its own.
- Choosing Lid closed while Amphetamine runs a session of its own opens a dialog: "Amphetamine already has a session running. Replace it with Lookout's?", with Replace (Secondary) and Keep it (Quiet, focused). Keep sets Awake.

One-time setup for Lid closed, on each Mac. The disabled item's line says which part is missing:
1. Install Amphetamine from the Mac App Store, and its Power Protect helper (Amphetamine › Settings).
2. In Amphetamine's settings, dismiss the closed-display warning once with "Do Not Show This Message Again".
3. Allow Automation access when macOS asks, on the first Lid closed.

## Technical approach

- **`shared/awake.ts`** holds the snapshot and the rules, all pure and tested:
  - `AwakeSnapshot`: `{mode, holding: 'off' | 'awake' | 'lid', atWork, offAt, lid: {available, reason}, note: {text, at} | null}`;
  - `atWork(rows)` (AWAKE-2.1);
  - `offAt(...)` (AWAKE-2.2);
  - `cornerText(snapshot, now)` (AWAKE-4.2).
- **`server/awake.ts`** holds `KeepAwake`. It is built from a `spawn` for `caffeinate`, the `Runner` for `pmset` and `osascript`, `sessions()`, the file's path, the server's pid and `now`.
  - Its methods: `snapshot()`, `set(mode, {replace})`, `sessionsChanged()`, `watch()` (the 10 s power read while a tab is connected) and `close()`.
  - Amphetamine's commands are in one place, `amphetamine(script)`, each run as `osascript -e 'tell application "Amphetamine" to …'`.
  - Changes go through one promise queue, since the AppleScript calls must not interleave (the recipe's rule).
- **The server's wiring:**
  - `server/main.ts` calls `sessionsChanged()` from the Session monitor's change hook, and awaits `close()` in `shutdown` before exiting.
  - `server/app.ts` adds `POST /api/awake`, the snapshot's `awake` and the `awake` event.
- **The client:**
  - The store keeps `awake`.
  - `components/KeepAwake.tsx` draws the rail's button and the footer line around one menu and the dialog. `RightRail` and `RightSidebar` place them.
  - `lib/client.ts` gains `setAwake`.
- **Behaviour test:** the World gains fakes for `caffeinate` (it logs its argv and waits until it's ended) and `pmset` (it answers AC power), and its server's `LOOKOUT_AMPHETAMINE_APP` points to a path that doesn't exist.
- **`ui/footer-line.tsx`** (DS-23) draws the rail's line and the footer line, as it draws the Memory line.
- **A known limit of AWAKE-3.3:** Amphetamine says whether a session runs, not whose. A session you start in Amphetamine within 10 s of ending Lookout's still reads as Lookout's, and Lookout ends it with its own.
- **Matej's recipe** is the source of the states and Amphetamine's commands: https://claude.ai/artifact/PpJ1wTcY9JBKiuZ5wHFNCA. Lookout's server stands in for his Electron main process: `caffeinate -i -w` replaces `powerSaveBlocker`, and polling `pmset` replaces `powerMonitor`.

### Key decisions

- **Every Session, one switch:** what matters is whether anything still works, not which Session. A per-Session scope adds a switch and row marks for little.
- **At work includes running Subagents and background shell commands:** that is exactly when Claude Code holds no `caffeinate` of its own and the Mac idles into sleep.
- **5 minutes with nothing At work, and Needs you doesn't count:** the 5 minutes cover the gap between a background job ending and the Session's next Turn. A Session waiting for you can wait asleep.
- **Lid closed only on the charger, through Amphetamine:** Dario's choice. With no external display, macOS sleeps on a closed lid whatever `caffeinate` asserts, and the alternative, `pmset disablesleep`, needs root and turns off sleep everywhere.
- **The display may sleep:** an unattended Mac locks as usual. Sessions run behind the lock.
- **The bottom-right corner, not the Session sidebar's header:** a fourth header icon would cut the filter from about 160 px to 128 px (Dario). The corner mirrors the Memory line, the other line about the Mac.
- **Amphetamine calls wait up to 60 s:** the first call opens macOS's Automation prompt, and `osascript` waits while it's open. A refused one stays retryable, since access can be allowed later.
- **In the server, saved across restarts:** it outlives the browser tab. `caffeinate -w` ends with the server, so a crash leaves nothing holding the Mac awake except an owned Amphetamine session, which the next start ends.

## Open questions

None.

## Changelog

- 2026-11-16: Created from the Backlog's "Keep the Mac awake while Sessions run" and Matej's recipe, after reading `pmset -g log`: 15 idle and 17 lid-closed sleeps since 2026-11-09. Grilled with Dario the same day, seven questions:
  - it covers idle sleep, and a closed lid only on the charger;
  - Lid closed goes through Amphetamine;
  - one switch covers every Session;
  - it turns off after 5 minutes with nothing At work;
  - the display may sleep;
  - it sits in the bottom-right corner, not the sidebar's header, which would narrow the filter;
  - the rest as recommended.

  Ready.
- 2026-11-16: Before the code, AWAKE-3.5 and AWAKE-4.3 were amended so that a refused Apple event keeps Lid closed enabled, with the reason on its line. Without that, there would be no way to try again once access is allowed. Amphetamine calls wait 60 s, which leaves time for macOS's permission prompt. Two reasons were reworded without `›`, since the icon guard (0008) refuses the symbol.
- 2026-11-16: Built and In Progress:
  - `shared/awake.ts`, `server/awake.ts`, `POST /api/awake` and the `awake` event;
  - `components/KeepAwake.tsx` in the rail and the right sidebar;
  - the World's fake `pmset` and `caffeinate`.

  AWAKE-1.2 now finds `caffeinate`, `pmset` and `osascript` on PATH alone, so a World never runs the real ones. AWAKE-1.1 to 4.5 are ticked. AWAKE-3.6 and AWAKE-4.6 wait for Dario.
- 2026-11-16: An independent Opus 5.5 review (xhigh) found eight issues, all fixed:
  - **HIGH:** who was At work was known only while a tab was open, because Fleet's list is read only while something watches it. The server now holds a watch while the mode is on (AWAKE-2.1).
  - **MEDIUM:** stopping during a slow Amphetamine call could leave a session Lookout no longer knew it owned. Calls are now cancelled on stop, and ownership is saved before the session is asked for (AWAKE-1.4, AWAKE-3.2).
  - **LOW:**
    - A pick made during start-up was overwritten by the restore (AWAKE-1.3).
    - A refusal lingered after a call succeeded (AWAKE-3.5).
    - A session ended outside Lookout stayed counted as its own (AWAKE-3.3).
    - A pick's answer could replace a newer event; snapshots now carry `rev` (AWAKE-1.1).
    - The arrows and Enter, and the panels giving up 28 px, weren't tested (AWAKE-4.2, AWAKE-4.3).
    - The footer line was copied by hand, and is now `ui/footer-line.tsx` (DS-23).
