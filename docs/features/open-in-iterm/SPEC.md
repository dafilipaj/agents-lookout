---
title: Open in iTerm2
code: ITERM
status: Draft
created: 2026-10-16
updated: 2026-10-30
---

# Open in iTerm2

## Summary

Open the selected Session in iTerm2 with one click, attached to the same running process, so you can work in a real terminal and come back to Lookout without restarting anything. A Session that already runs in an iTerm2 tab is brought to the front there instead.

## Problem

Some things need the real terminal: prompts VIEW has no buttons for, long output, scrolling back. Today that means finding the tmux session by hand.

The Terminal preview (VIEW-2) can't be typed into, which Dario's testing reported as a bug ("Show terminal can't be typed into"). It is read-only on purpose: a live terminal inside Lookout is a Non-goal ([0001](../../decisions/0001-tmux-as-hidden-session-host.md)). Opening the Session in iTerm2 is the interactive route, so this spec is also the answer to that report (PLAN, Later).

## Requirements

Criteria marked with an Open question follow its recommendation until it's answered. iTerm2 is a GUI app a World can't hold (TEST Non-goals: no `osascript`, and Fleet's `FLEET_PATH_ONLY` refuses the iTerm backend), so Lookout's side is `(test)` against the fake `fleet`, and what happens in iTerm2 is `(manual)`.

### ITERM-1 The button and the shortcut

"Open in iTerm2" sits with the Session's actions in the header (VIEW-5.1), for the Sessions Lookout can show in iTerm2.

- [ ] ITERM-1.1 The header shows "Open in iTerm2" for a live, Controllable Session that runs in an iTerm2 tab (backend `iterm`) or alone in its Session host (backend `tmux` and `ownHost`, as VIEW-5.6 decides it), in any Status. It sits after Stop or Esc and before End Session; Copy session ID stays last (VIEW-5.10). (test)
- [ ] ITERM-1.2 No button for a Session that isn't Controllable (View only), has ended (VIEW-5.3), or shares its Session host with another listed Session (Open question 1); nor on a "Starting…" row's view (LAUNCH-4.6) or a past Session (HIST-3.3). (test)
- [ ] ITERM-1.3 `O`, when focus isn't in a text field and no modal is open, does what the button does for the selected Session; with no button, it does nothing. Inside the Work and Library panels `O` keeps its own meaning there (WORK, LIB), and the page's handler stands down for it (Open question 4). (test)
- [ ] ITERM-1.4 The button's tooltip names the key and what happens. For a Session host: "Open in iTerm2 (O). To close its window and keep the Session running, choose Hide or Detach; Kill ends the Session." For an iTerm2 tab: "Show its iTerm2 tab (O)". The button is named "Open in iTerm2" for both and declares the key (`aria-keyshortcuts="O"`). (test)
- [ ] ITERM-1.5 The header stays one line at any width (VIEW-5.1): the button never shrinks, and its words go below 26rem, as the other buttons' do, leaving the icon with its name and tooltip. (manual)
- [ ] ITERM-1.6 While the Terminal preview is open (VIEW-2.1) for a Session with the button, its Terminal row says, muted, "Read-only · O opens it in iTerm2". For a Session without the button the row is as before. (test)

### ITERM-2 Open a Session host in iTerm2

- [ ] ITERM-2.1 For a Session alone in its Session host that no iTerm2 window shows yet, a click attaches iTerm2 to the same running Session through iTerm2's tmux integration (`tmux -CC attach`): iTerm2 comes to the front with the Session's terminal in a native window, with iTerm2's own scrollback and mouse. Nothing restarts: the same Harness process (pid) and Transcript go on. (manual)
- [ ] ITERM-2.2 With iTerm2 installed but not running, a click launches it and opens the Session in it; with iTerm2 running and no window open, it opens one. (manual)
- [ ] ITERM-2.3 The Session host is attached by its exact name, never a prefix: with Session hosts `fix` and `fix-2`, opening the Session in `fix` shows that one. (manual)
- [ ] ITERM-2.4 Each click is for the process it was made on (pid and start time, from the row the button belongs to). Before asking Fleet, the server reads a fresh `fleet list`: the Session must still be running, the same process, Controllable and eligible as ITERM-1.1 says. Otherwise it refuses, asking Fleet nothing, with ITERM-4.3's words. A row without a start time is refused: "Lookout can't confirm it's the same Session, so it won't open it." (test)
- [ ] ITERM-2.5 One open per Session process at a time, from any tab. While one runs, the button reads "Opening…" and is disabled (`aria-disabled`, keeping focus), `O` does nothing for that Session, and a click from another tab gets "Lookout is already opening it in iTerm2." (test)

### ITERM-3 Already showing somewhere

- [ ] ITERM-3.1 A Session in an iTerm2 tab (backend `iterm`) is brought to the front there: iTerm2 comes forward with that tab's window, tab and pane selected. Nothing is attached and no tab opens. (manual)
- [ ] ITERM-3.2 A Session host that an iTerm2 window already shows (one Lookout opened and you haven't closed, or an iTerm2 tab where it's attached) has that window brought to the front, and no second iTerm2 window is attached to it. If iTerm2's tmux integration is attached to it but Fleet can't find the window, nothing new is attached (ITERM-4.4's `already_attached`). (Open question 2) (manual)
- [ ] ITERM-3.3 A Session host attached only in another app (Terminal, Ghostty, an editor's terminal) is attached in iTerm2 as well, as ITERM-2.1 says; the other terminal stays attached, and both show the same Session (Open question 3). (manual)
- [ ] ITERM-3.4 What happened is announced once, politely, while the button keeps its name: "Opened in iTerm2" for a new window, "Shown in iTerm2" for one brought to the front. Nothing else in the view changes. (test)

### ITERM-4 When it can't open

- [ ] ITERM-4.1 Without iTerm2 installed, the note says "iTerm2 isn't installed, so Lookout can't open the Session there." Fleet checks this before any AppleScript, so macOS never asks where iTerm2 is. (test)
- [ ] ITERM-4.2 A failure shows beside the title, where Stop's error does (VIEW-4.4): one line, cut to fit, its whole text in the bubble on hover or focus, announced once as an alert. It stays until the next click or `O` for that Session, or until another Session is selected. Nothing is retried, and the note never names tmux or quotes Fleet's error. (test)
- [ ] ITERM-4.3 When the server's check finds the Session changed since the click: ended: "This Session is no longer running."; restarted: "This Session was restarted since you clicked, so nothing was opened."; no longer Controllable: "This Session runs in another app, so Lookout can't open it in iTerm2."; now sharing its Session host: "This Session shares its Session host with other Sessions, so Lookout won't open it in iTerm2. Open it in a terminal yourself." (Open question 1). The same words when Fleet finds the same (`target_not_found`, `target_changed`, `backend_unsupported`). (test)
- [ ] ITERM-4.4 When the attach fails, by Fleet's answer: iTerm2 couldn't be driven or typing into its new tab failed (`backend_failed`): "Couldn't open it in iTerm2.", adding, when Fleet says a tab was left open, "A new iTerm2 tab may be left behind; closing it doesn't affect the Session."; iTerm2 opened but no attach showed up in time (`outcome_uncertain`), or Fleet or the connection to Lookout timed out: "iTerm2 may have opened it, but Lookout can't tell. Look in iTerm2 before trying again."; iTerm2's tmux integration already attached but its window not found (`already_attached`, ITERM-3.2): "It's already open in iTerm2, but Lookout can't find its window. Look in iTerm2's Window menu."; Fleet not installed: "Couldn't open it: Fleet isn't installed."; a Fleet without the command: "This Fleet can't open Sessions in iTerm2 yet. Update the Fleet fork."; anything else: "Couldn't open it in iTerm2." Lookout never closes a tab Fleet left behind (ITERM-7.4). (test)

### ITERM-5 The macOS Automation permission

macOS asks once before an app may control iTerm2 through AppleScript. Which app it names depends on how Lookout's server was started (Open question 6).

- [ ] ITERM-5.1 When "Opening…" has lasted 3 s, a muted note beside it says "If macOS asks to allow control of iTerm2, allow it." It goes with "Opening…". (test)
- [ ] ITERM-5.2 Lookout waits up to 60 s for Fleet, so the prompt can be answered; past that, ITERM-4.4's "can't tell" line. (test)
- [ ] ITERM-5.3 When macOS refuses the control (now, or an earlier "Don't Allow"; Fleet's `not_permitted`), the note says "macOS doesn't let Lookout control iTerm2. Allow it in System Settings › Privacy & Security › Automation, then try again." (test)
- [ ] ITERM-5.4 Seen on a Mac where the server's app was never allowed to control iTerm2: the first click brings macOS's prompt; Allow opens the Session; Don't Allow gives ITERM-5.3's note, and the Session keeps running. (manual)

### ITERM-6 Afterwards

- [ ] ITERM-6.1 Lookout's view of the Session doesn't change once it's open in iTerm2: the same sidebar row, still Controllable, with the chat, composer, Terminal preview, answer buttons, Stop and Esc, rename, model and Effort menus and End Session as before. (manual)
- [ ] ITERM-6.2 A prompt typed in the iTerm2 window shows in Lookout's chat as any prompt does (VIEW-1), and a message sent from the composer shows in the iTerm2 window. (manual)
- [ ] ITERM-6.3 Lookout shows no marker that a Session is open in iTerm2, in the sidebar or the header (Open question 5). The button stays, and the next click brings that window forward (ITERM-3.2). (test)
- [ ] ITERM-6.4 An iTerm2 window opened from Lookout stays attached and usable while Lookout's server stops and restarts, and Lookout lists the Session again once it's back. (manual)

### ITERM-7 Closing the iTerm2 window

- [ ] ITERM-7.1 Closing the window with ⌘W and Hide (iTerm2's default) on the Session's only window: the Session keeps running, Lookout's view of it doesn't change, and the next Open in iTerm2 attaches it again (ITERM-2.1). (manual)
- [ ] ITERM-7.2 ⌘W and "Detach tmux Session": the same as Hide. (manual)
- [ ] ITERM-7.3 ⌘W and Kill: the Session host and its Harness process end, and Lookout shows the Session ended (VIEW-5.3), its chat readable, resumable from History (HIST-3.1). Lookout neither asks nor warns at that moment: the risk is accepted (Key decisions), and ITERM-1.4's tooltip is the warning. (manual)
- [ ] ITERM-7.4 Lookout never closes, hides or detaches an iTerm2 window, tab or attached terminal: ITERM's only Fleet call is `open`, and nothing in Lookout sends iTerm2 a close or detaches a client. End Session (VIEW-5.6) still ends a Session that's open in iTerm2; its window closes because the Session host is gone, which is ending the Session, not closing a window. (test)

## Non-goals

- Other terminals (Ghostty, Terminal.app, WezTerm).
- Opening Sessions that aren't Controllable.
- A live terminal inside Lookout, or typing into the Terminal preview: it stays read-only ([0001](../../decisions/0001-tmux-as-hidden-session-host.md)); this feature is the interactive route.
- Closing, hiding or detaching iTerm2 windows from Lookout, or a "Close in iTerm2" action (Key decisions).
- A confirmation or warning before iTerm2's Kill, and anything about iTerm2's own settings: its "Remember my choice" in the ⌘W dialog, whether tmux windows open as windows or tabs, burying the tab that runs the attach.
- A plain `tmux attach` fallback (Open question 7).
- Sessions in a shared Session host, "Starting…" rows and failed starts (LAUNCH-4.5 leaves their Session host running), and past Sessions (Open question 1).
- Opening in iTerm2 from the sidebar's rows, History, Work or the Library.
- A marker for Sessions open in iTerm2 (Open question 5).
- Starting a new Session in iTerm2: Sessions always start in a Session host (LAUNCH Non-goals).
- Restoring the Session host's size after the iTerm2 window closes (Known gaps).
- Other Hosts.

## UX

```
┌───────────────┬────────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar (SIDE)│ fix-deal-rates · Claude Code   Idle · 2m              [Open in iTerm2] [End Session] [Copy]    │
├───────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│               │ …chat…                                                                                         │
│               ├─ Terminal ────────────────────────────────────────────── Read-only · O opens it in iTerm2 ─ ▾ ─┤
│               │ ❯                                                                                              │
```

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ fix-deal-rates · Claude Code   Idle · 2m  If macOS asks to a…  [Opening…] [End Session] [Copy] │
│ fix-deal-rates · Claude Code   Idle · 2m  iTerm2 isn't…  [Open in iTerm2] [End Session] [Copy] │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- The button: an outline button like End Session (`xs`, 28 px tall, `meta` text), with lucide's `SquareArrowOutUpRight` at 14 px and "Open in iTerm2". Below 26rem it's the icon alone (ITERM-1.5).
- While Fleet works: "Opening…", disabled, keeping focus. From 3 s, ITERM-5.1's note sits beside the title, muted, where Stop's error goes (VIEW-4.4); it is not an error and isn't announced as one.
- Afterwards: iTerm2 is in front, and Lookout's window is behind it as you left it. Nothing in Lookout changes but the polite status (ITERM-3.4).
- A failure: the note beside the title, in the error colour, as Stop's error (ITERM-4.2). A new click clears it.
- Keyboard: `O`, as `N`, `H`, `W`, `L` and `i` work: not in a text field, not with a modal open, not with ⌘, Ctrl or Alt, and once per press (a held key's repeats open nothing more).
- Words: the UI says "iTerm2", "Session host" and "terminal", never tmux (0001). The tooltip's "Hide", "Detach" and "Kill" are iTerm2's own button names in its ⌘W dialog.

## Technical approach

### What the code knows today

- **Three kinds of Session, from `fleet list --json`** (`server/fleet.ts`, `server/normalize.ts`). Fleet reads each Harness process's environment (`core/discovery.rs`, `backend_from_env`): `TMUX` set means backend `tmux` with the pane id as its handle and `tmux_session` set; else `ITERM_SESSION_ID` means backend `iterm` with the iTerm2 session's GUID as its handle and no `tmux_session`; else `unknown`. `tmux` and `iterm` are Controllable; `unknown` is View only. A Session in plain tmux inside an iTerm2 tab is `tmux`, since `TMUX` wins, and a Session viewed through `tmux -CC` stays `tmux`: opening it in iTerm2 changes nothing in its row.
- **Where Lookout's Session hosts live.** LAUNCH starts every Session with `fleet --local spawn --backend tmux`, and Fleet runs `tmux -u new-session -d -s <name> -x 200 -y 50` with no `-L` or `-S`. So Lookout's Session hosts are on the default tmux server (socket `default` under `$TMUX_TMPDIR` or `/tmp/tmux-<uid>/`, or the server `$TMUX` names when the caller runs inside tmux; Lookout's `cleanEnv` keeps `TMUX`), the same server as tmux sessions you start yourself, such as `work`. A Lookout-started Session is alone in its Session host, so it's `ownHost`; one you started in your own tmux is `ownHost` too when no other listed Session shares that tmux session. Lookout can't tell who started a Session host and doesn't need to: ITERM-1.1 goes by `ownHost`, as End Session does. A World uses its own `TMUX_TMPDIR` and socket.
- **What the UI says today.** The sidebar doesn't tell `tmux` from `iterm`: both are in the Controllable group; `unknown` rows are under "View only", whose tooltip says they run in another app. In the view, a `tmux` Session gets everything; an `iterm` one gets the composer, Terminal preview and answers (Fleet drives iTerm2 through AppleScript), but no End Session (VIEW-5.6), and its model and Effort stay plain text with "Lookout can't switch the model of a Session in an iTerm tab. Use /model in its terminal." (VIEW-6.2, VIEW-7.2; the server's `model-switch.ts` refuses it too). A View only Session's dock says "View only: this Session runs in another app". `SessionView.tsx` leaves a placeholder in the header's actions for this button.
- **Attached terminals don't stop Lookout.** Of the Fleet commands Lookout runs, only `answer` and `trust` check for an attached client (`human_attached`), and Lookout passes `--allow-attached` to both. `send` holds a message while the input box has text, which covers text typed in the iTerm2 window (VIEW-3.7).

### Fleet: a fork commit ([0006](../../decisions/0006-run-a-fork-of-fleet.md))

Fleet has no CLI command that opens or focuses a Session in iTerm2:

- `core::backend::focus` brings an `iterm` Session's tab to the front through AppleScript (activate, then select its window, tab and session); for `tmux` it only selects the pane inside tmux. Only the TUI (`fleet watch`) calls it.
- `core::backend::iterm_run` opens an iTerm2 tab (a window when none is open) and types a line into its login shell. `spawn --backend iterm` uses it, and so does Fleet.app's `fleet://attach` link, which types `fleet -H <host> enter -- <session>`: a plain `tmux attach` (`core::tmux::attach`), not `-CC`.
- `fleet enter` attaches the calling terminal itself, which a server can't use.

So the fork gains one command that does both, for anyone's UI ([0005](../../decisions/0005-building-blocks-live-outside-lookout.md)). Its contract goes in `docs/contracts/fleet-open.md` before it's built, as `fleet-trust.md` did for `trust`. Proposed:

- **Command:** `fleet --local open <target> --json --expect-pid <n> --expect-start <proc_start>`. Exact targets only (`id:<session_id>` or `pid:<n>`), and the process checks `close` makes (`target_changed`).
- **An `iterm` Session:** `focus`, as today. `{ok: true, how: "focused"}`.
- **A `tmux` Session:**
  1. Ask tmux who is attached to its Session host: `list-clients -t =<host> -F '#{client_control_mode}\t#{client_tty}\t#{client_pid}'`.
  2. A plain client whose tty is an iTerm2 session's (iTerm2's AppleScript gives each session's `tty`): select that session's window, tab and pane, activate iTerm2. A control-mode client (iTerm2's tmux integration): bring forward the iTerm2 window showing the Session's pane, if Fleet can find it (Open question 2), else fail with `already_attached`. Found: `{ok: true, how: "focused"}`.
  3. Otherwise (no client, or clients only in other apps, Open question 3): open an iTerm2 tab, a window when none is open, running `tmux -S <socket> -CC attach -t =<host>`, where `<socket>` is the server's `#{socket_path}`, so the new tab reaches the server Fleet listed whatever its own `TMUX_TMPDIR`, and `=` makes the name exact (ITERM-2.3). Then wait up to 10 s for a new control-mode client on that host: `{ok: true, how: "attached", handle: <the new tab's iTerm2 session id>}`; none: `outcome_uncertain`, with the `handle`.
  - How the attach runs is the fork commit's to settle and verify: typed into the tab's login shell with `exec`, as `iterm_run` does for `spawn`, or given to iTerm2 as the new session's `command` with tmux's absolute path, which skips the shell (and a profile that starts a program of its own) and leaves no shell behind after a detach.
- **Before any AppleScript:** iTerm2 must be installed (looked up by its bundle id, `com.googlecode.iterm2`), else `iterm_missing`, so `tell application "iTerm2"` never asks where it is. `FLEET_PATH_ONLY` refuses it, as every iTerm2 action.
- **Failures:** exit 1 with `{ok: false, kind, error}`: `usage`, the target kinds, `target_changed`, `backend_unsupported` (backend `unknown`), `iterm_missing`, `not_permitted` (AppleScript's -1743, "Not authorized to send Apple events"), `already_attached`, `backend_failed` (AppleScript or the typing failed; `handle` when a tab was left), `outcome_uncertain`, `io`.
- **Never** closes, hides or detaches a window, tab or client, and never kills anything: a scripted close of a `-CC` window kills the Session (Verified, below).

### Lookout

- **Request:** `POST /api/sessions/<id>/iterm` with `{pid, procStart}` (at most 1 KB), a mutation (Origin and token), checked as `POST /api/sessions/<id>/end` checks its body (VIEW-5.6's Technical approach), and the target built from a fresh `fleet list` row the same way, a pid id that got its session id meanwhile included. Eligibility (ITERM-1.1) is checked on that row before argv is built. Then `fleet --local open <target> --json --expect-pid <n> --expect-start <t>`, with LAUNCH's cleaned environment and 60 s (ITERM-5.2).
- **One at a time (ITERM-2.5):** a guard per Session process, as the model switch's (`switches.begin`), released when Fleet answers or times out. A request while one runs is 409 with ITERM-2.5's words.
- **Answers:** `how` becomes the tab's polite status (ITERM-3.4); the kinds become ITERM-4 and ITERM-5's lines, in `server/iterm.ts`, as `closer.ts` words `close`'s. A Fleet without `open` says so in clap's words (`unrecognized subcommand`). Nothing is refreshed afterwards: nothing in the list changes.
- **In the tab:** the button in `Header` where the placeholder is; the `O` handler beside `i`'s (VIEW-3.6), standing down for `defaultPrevented`, so the Work and Library panels' own `O` wins inside them. The pending state and the note live per Session process in App, as Stop's do. ITERM-5.1's note is a timer started with the request.
- **Testing:** the fake `fleet` (`server/fixtures/fleet/messages/fake-fleet.mjs`) answers `open` with each `how` and kind, with a delay for ITERM-5.1 and 5.2. Route tests check eligibility, the process binding, the guard, the argv and that no other Fleet command runs (ITERM-7.4); component tests check the button, the shortcut and the lines. The `(manual)` criteria are checked against a real iTerm2 with throwaway Sessions.

### Verified 2026-10-16 (iTerm2 3.7.2, tmux 3.6a, throwaway session on its own socket)

| How it's opened | How it's closed | Result |
|---|---|---|
| `tmux -CC attach` (iTerm2's tmux integration: native window, scrollback and mouse) | AppleScript `close` | **Session killed**: no prompt; the tmux window was killed, and with it the session |
| `tmux -CC attach` | ⌘W | Dialog: **Hide** (default) / Detach tmux Session / Kill / Cancel, with "Remember my choice" |
| `tmux -CC attach` | ⌘W → Hide (on the session's only window) | Session survives; iTerm2 detached its client and closed its windows |
| plain `tmux attach` in an ordinary window | AppleScript `close` | Session survives; the client detached, no prompt |

- With `-CC`, a normal ⌘W is safe (Hide or Detach), but Kill is one click away, and any scripted close kills the Session.
- A plain `tmux attach` is always safe to close, but it shows tmux itself inside iTerm2: tmux's own mouse handling and scrollback, which is what made the old dashboard glitchy.
- Not covered by that test, so checked by ITERM-7.2 and 6.4: "Detach tmux Session", and Lookout's server stopping while the window is open. Not covered at all: quitting iTerm2 (⌘Q) with the window open (Known gaps).

### Key decisions

- **iTerm2's tmux integration (`tmux -CC attach`), not a plain attach** (Dario, 2026-10-30): native windows, scrollback and mouse. The risk is accepted: Kill is one click away in the ⌘W dialog.
- **Lookout never closes iTerm2 windows itself**: it follows from `-CC`, since any scripted close kills the Session.
- **One Fleet command decides between bringing forward and attaching**: Lookout runs no `osascript` and no tmux for this ([0001](../../decisions/0001-tmux-as-hidden-session-host.md), [0004](../../decisions/0004-fleet-cli-as-session-layer.md)), and a missing Fleet capability is a fork commit ([0006](../../decisions/0006-run-a-fork-of-fleet.md)).
- **A Session already in an iTerm2 tab is brought to the front there, not attached again**: it has no Session host to attach; its tab is where it runs.
- **Bound to the process clicked on**, as End Session is (VIEW-5.6): a Session restarted between the click and Fleet's answer is never the one opened.

### Known gaps

- **The Session host keeps iTerm2's size.** Fleet starts Session hosts at 200×50 so tall prompts fit (VIEW-4.6). Attaching resizes the Session's window to iTerm2's, and tmux keeps that size after the window closes. A smaller iTerm2 window can then leave a tall question or prompt "doesn't fit" in Lookout (VIEW-4.6's line), until the Session is opened in a bigger window. Not fixed here (Non-goals).
- **"Remember my choice" with Kill** makes every later ⌘W on a `-CC` window kill its Session without asking. It's iTerm2's setting; ITERM-1.4's tooltip is all Lookout says.
- **Quitting iTerm2 with the window open** wasn't tested. If it kills rather than detaches, it's the scripted close's risk again, and Lookout can't prevent it.
- **A Session host with more windows:** an `ownHost` Session host that also holds a plain shell window (your `work`, say) opens with every window it has, since `-CC` attaches the whole Session host. Whether Kill there ends only the Session's window or the whole Session host wasn't tested; Lookout's own Session hosts have one window.

## Open questions

- [ ] **1. Who gets the button besides Sessions alone in their Session host and Sessions in iTerm2 tabs?**
  - Recommended: no one else in this slice: not a Session that shares its Session host with other listed Sessions, not a "Starting…" row or failed start, not a past Session. The criteria follow this (ITERM-1.2, 4.3).
  - Evidence: `-CC` attaches the whole Session host, so a shared one opens every window it has, and Detach in the ⌘W dialog detaches them all. End Session draws the same line for the same reason (VIEW-5.6, `ownHost`). A failed start's or Trust prompt's Session host isn't a Session Fleet lists yet, so `open` would need a Session-host target like `trust`'s (`<tmux_session> --pane <handle>`, [contract](../../contracts/fleet-trust.md) C1), which is a second fork change. LAUNCH's Known gaps name ITERM as the way to reach a start left waiting after a restart, which argues for a later slice.
- [ ] **2. How does Fleet find the iTerm2 window that already shows a Session host through iTerm2's tmux integration?** *(blocking for ITERM-3.2)*
  - Recommended: verify it first, on a throwaway socket as on 2026-10-16. If iTerm2's AppleScript can name the tmux pane a session shows (iTerm2 keeps it in session variables such as `tmuxWindowPane`), Fleet selects that window. If it can't, Fleet attaches nothing and answers `already_attached`, and Lookout says where to look (ITERM-3.2). Never a second `-CC` client from the same iTerm2.
  - Evidence: tmux's `list-clients` tells a control-mode client (`client_control_mode`) and its tty; the tty is that of the iTerm2 tab that ran the attach, which iTerm2 may bury, not of the window showing the Session. Whether AppleScript exposes the pane is not verified, nor what iTerm2 does when a second `-CC` client attaches to a Session host it already shows.
- [ ] **3. A Session host attached only in another terminal app: attach iTerm2 as well, or say where it is?**
  - Recommended: attach as well (ITERM-3.3). You asked for it in iTerm2, tmux takes several clients, and Lookout can't bring another app's window forward.
  - Evidence: of the Fleet commands Lookout runs, only `answer` and `trust` mind an attached client, and Lookout passes `--allow-attached` to both. With several clients the window takes the size of the latest one used (tmux's default `window-size latest`), so the other terminal may show it cut or padded until it's used again. Kill in iTerm2's dialog would end the Session for both.
- [ ] **4. Is `O` the shortcut?**
  - Recommended: `O`, page-wide, as `N`, `H`, `W`, `L` and `i` are; Work's and Library's own `O` win while focus is in those panels (ITERM-1.3).
  - Evidence: there `O` already means open elsewhere (Work: the row in the browser; Library: the Output). Taken page-wide: `N`, `H`, `W`, `L`, `i`, `j`, `k`, `/`, `[`, `]`. A single letter, like the others, avoids the question of which ⌘ keys a normal Chrome tab keeps for itself (it keeps ⌘N, LAUNCH-1.1). `T`, for terminal, is free if `O` reads as the panels' key.
- [ ] **5. Should Lookout show that a Session is open in iTerm2?**
  - Recommended: not in this slice (ITERM-6.3). The button already brings that window forward, which is what a marker would lead you to do.
  - Evidence: `fleet list --json` doesn't say whether a client is attached. Fleet's pane query could add `#{session_attached}` at no extra tmux call, but it counts any client, iTerm2's or not, so a marker would need ITERM-3.2's lookup on every poll to say "in iTerm2".
- [ ] **6. Which app does macOS name in the Automation prompt, and has it already been answered?**
  - Recommended: write no app name (ITERM-5.1, 5.3) and settle it in ITERM-5.4's check.
  - Evidence: macOS asks for the app responsible for the `osascript` Fleet runs: the terminal app Lookout's server was started from (perhaps no prompt at all when that's iTerm2 itself, unverified), or `node` once the server starts from launchd ([0003](../../decisions/0003-browser-first-react-stack.md)). Fleet already drives iTerm2 for `iterm` Sessions (the Terminal preview, sending, answers, the tab title in `list`), so on a Mac where Lookout has shown one, the prompt may have come and gone already, possibly during a poll rather than a click.
- [ ] **7. Does 0001's "plain `tmux attach` as the fallback" still stand?** *(blocking)*
  - Recommended: no fallback, recorded in a new decision that supersedes 0001's "Open in iTerm2" line and closes its Consequence ("to verify before relying on `-CC`"), carrying the Verified table and both Key decisions above. This spec can't drop the fallback on its own: 0001 is Accepted.
  - Evidence: the 2026-10-30 answer chose `-CC` for its native window, and the fallback is the plain attach that answer turned down. Nothing seen so far makes `-CC` fail where a plain attach works: the attach runs in iTerm2, which is required, and iTerm2 3.7.2 worked with tmux 3.6a.

## Changelog

- 2026-10-16: Created with the `-CC` close-behaviour test results. Not grilled yet; parked behind using what's built.
- 2026-10-30: Blocking question answered by Dario: `-CC`, accepting that Kill is one click away in the close dialog. Lookout never closing iTerm2 windows itself follows from it (Key decisions). Requirements are still to be written.
- 2026-10-30: Requirements written: the button and `O` (ITERM-1), opening a Session host (ITERM-2), a Session already showing in an iTerm2 tab or window, or in another app (ITERM-3), failures (ITERM-4), the Automation permission (ITERM-5), afterwards (ITERM-6), and closing the window with Hide, Detach or Kill, with Lookout never closing one (ITERM-7). Technical approach: what the code knows of `tmux` and `iterm` Sessions, the default tmux server Lookout's Session hosts are on, and a fork commit for Fleet's `open`, since Fleet's CLI can neither open nor focus a Session in iTerm2. Non-goals, Key decisions and Known gaps follow. The Problem names the "Show terminal can't be typed into" report this answers. Not grilled; seven open questions, each with a recommendation the criteria follow; 2 and 7 block. Still Draft.
