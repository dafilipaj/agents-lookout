---
title: Start Sessions
code: LAUNCH
status: In Progress
created: 2026-10-16
updated: 2026-10-27
---

# Start Sessions

## Summary

Start a Claude Code or Codex Session from Lookout in a few keystrokes: pick a start directory, a Harness and model, and optionally a name and first prompt. The Session runs in its own Session host, so it's Controllable, sends telemetry, and can be opened in iTerm2 later. In a folder Claude Code doesn't trust yet, the Starting view shows its Trust prompt, and you answer it there with a click.

## Problem

Sessions started in Orca can't be controlled from Lookout (SIDE shows them greyed out). For Lookout to be useful, new work has to start in a Session host, and doing that by hand (tmux, `cd`, `claude`) is slower than clicking "+" in Orca.

A start or a resume in a folder Claude Code doesn't trust yet waits at Claude Code's Trust prompt, and Claude Code registers with Fleet only once it's answered. Lookout couldn't show or answer it: after 15 s the start failed with "Fleet hasn't reported it after 15 s. Its Session host is still running.", the prompt in its terminal's last lines, and nowhere to answer it, since the Session host is hidden (Dario's report, 2026-10-27, resuming a past Session from History).

## Requirements

### LAUNCH-1 Open the launcher

- [x] LAUNCH-1.1 N (when focus isn't in a text field), ⌘N in an installed-app window, or the "+" button at the top of the sidebar, opens the launcher with the cursor in the prompt field. (manual)
- [x] LAUNCH-1.2 The launcher starts with the Harness, model and start directory you used last. (test)
- [x] LAUNCH-1.3 Esc closes the launcher; reopening it with N, ⌘N or the "+" button within the same page load restores what you'd typed in a launcher opened that way. A launcher opened from Work (WORK-5.1, WORK-5.2) neither reads nor writes that draft: closing it without a start discards what it held, edits to its prompt included. (e2e)

### LAUNCH-2 Choose where

- [x] LAUNCH-2.1 The start directory is picked from the list in Settings (default: `~/Projects/work`). (test)
- [x] LAUNCH-2.2 Start directories can be added and removed on the Settings page. (manual)

### LAUNCH-3 Choose what

- [x] LAUNCH-3.1 Harness: Claude Code (default) or Codex; a Harness that isn't installed is shown disabled. (test)
- [x] LAUNCH-3.2 Model: the models Fleet lists for the chosen Harness, defaulting to the Harness's own default. (test)
- [x] LAUNCH-3.3 Name and first prompt are optional. The prompt field accepts multiple lines. (test)
- [x] LAUNCH-3.4 Effort, next to the model: the levels Fleet lists for the chosen model, lowest first. It starts on `high` the first time you start a Harness, then on the level you last started that Harness with. A remembered level the chosen model doesn't list falls back to `high`; a model with no `high` falls back to its own default. A model with no levels shows no picker. (test)
- [x] LAUNCH-3.5 Skip permissions, a checkbox: checked the first time for Claude Code, unchecked for Codex, then what you last started that Harness with. For Codex its note says it also turns off Codex's sandbox. (test)

### LAUNCH-4 Start

- [x] LAUNCH-4.1 ⌘Enter or Start creates the Session in its own Session host. Fleet then reports it with backend `tmux`. (test)
- [x] LAUNCH-4.2 Start adds a "Starting…" row at the top of the sidebar and selects it at once. When Fleet reports the Session, it replaces the row and takes over the selection, but only while the "Starting…" row is still selected: if you moved to another Session or view meanwhile, you stay there. (test)
- [x] LAUNCH-4.3 A multi-line first prompt arrives intact, line breaks included. (manual)
- [x] LAUNCH-4.4 If starting fails, the launcher stays open, shows the error, and keeps everything you entered. (test)
- [ ] LAUNCH-4.5 If the Session hasn't appeared after 15 s, not counting the time it waits on its Trust prompt (LAUNCH-6.2), the "Starting…" row turns into an error, and the Session host is left running so you can look. The error and the last lines of its terminal show in the row while it isn't selected; selected, the row stays compact and the starting view shows them (LAUNCH-4.6). (manual)
- [x] LAUNCH-4.6 While a "Starting…" row is selected, the main pane shows the start: its name, Harness, start directory and the time since Start; then, once it failed (LAUNCH-4.5), the error and its terminal's last lines in place of the waiting note. (test)
- [x] LAUNCH-4.7 "Starting…" rows count as rows for ↑/↓, j/k and ⌘1–9 (SIDE-5.1, SIDE-5.2), in the order shown, above the Sessions. A failed one takes no ⌘ number (it stays until dismissed); ↑/↓ and j/k still reach it. ⌘J skips them all, except one waiting at its Trust prompt (LAUNCH-6.14). (test)
- [x] LAUNCH-4.8 A Session starts with the Effort and the Skip permissions choice you picked, for this Session only: it doesn't change the Harness's saved defaults. After its first reply the status line shows that Effort (VIEW-5.5), and a Claude Code Session started with Skip permissions shows Claude Code's bypass mode in its terminal. (manual)

### LAUNCH-5 Telemetry

- [x] LAUNCH-5.1 A Claude Code Session started in a `productiveio/*` repo appears in Grafana under its session ID. (manual)
- [x] LAUNCH-5.2 Lookout adds no `OTEL_*` or `CLAUDE_CODE_*` variables of its own to what it starts ([0002](../../decisions/0002-start-sessions-through-a-login-shell.md)). (test)

### LAUNCH-6 Trust prompt

Claude Code asks whether you trust a folder it hasn't run in before, and registers with Fleet only once you've answered. The Starting view shows that Trust prompt and answers it when you click, for a new start and a resume (HIST-3.1) alike. Lookout never answers it on its own. Claude Code first: a Codex start at Codex's Trust prompt behaves as before until Codex's slice (Known gaps).

- [x] LAUNCH-6.1 While a Claude Code start is "Starting…", Lookout reads its Session host's screen through Fleet. Independently of whether Fleet list polls succeed or are still running, within 3 s of Claude Code drawing its Trust prompt, the start shows it (LAUNCH-6.3) in place of the waiting note. (test)
- [x] LAUNCH-6.2 The 15 s failure (LAUNCH-4.5) doesn't run while the Trust prompt shows, however long it waits. It counts 15 s again from zero once the prompt is answered with "Trust folder" (LAUNCH-6.4) or leaves the screen without Lookout (LAUNCH-6.8). When 15 s are up, the screen is read once more before the start fails, so a prompt drawn late holds it too. (test)
- [x] LAUNCH-6.3 While it shows, the Starting view has, in place of the waiting note, a card headed "Claude Code asks whether you trust this folder": the prompt's text as the terminal shows it, in its words and order (the folder, Claude Code's warning, and the tool permissions the folder pre-approves as the prompt lists them, "… and 2 more" included), then two buttons, "Trust folder" and "Cancel". Claude Code's own answers aren't repeated: the buttons stand for them. The view's header says "Needs you", and the sidebar row shows Needs you's marker and "Asks to trust the folder" in place of "Starting…", selected or not. (test)
- [x] LAUNCH-6.4 "Trust folder" answers Claude Code's "Yes, I trust this folder", and only while Fleet confirms that the screen shows the very prompt on the card, untouched, and nothing else. While it's answered, both buttons are disabled and "Trusting…" shows. Then the start goes on like any other: the waiting note, 15 s counted from the answer (LAUNCH-4.5), and the Session taking over the row once Fleet reports it (LAUNCH-4.2). (test)
- [x] LAUNCH-6.5 "Cancel" answers "No, exit", with the same checks and "Cancelling…" meanwhile. Claude Code exits, its Session host is closed, and the row goes, with the selection and focus moving as when a failed start is dismissed (UX). Nothing is left running. If Claude Code hasn't exited within 5 s, or its Session host can't be closed, the start turns failed (LAUNCH-4.5) with that reason and its terminal's last lines. (test)
- [x] LAUNCH-6.6 When Fleet refuses a click's answer before typing anything, one line in place of the buttons says why in plain words, by Fleet's reason: the prompt changed, it's gone, someone changed its answer in a terminal, something else shows with it, it doesn't fit in the terminal, this version of Claude Code's prompt can't be read, or an answer is already being typed. The next read that can answer the prompt shown brings the buttons back. When a key may have gone out (Fleet can't tell the outcome, a key went out before it stopped, Fleet or the connection to Lookout timed out), the line says it may have been answered and the terminal's last lines show, and that prompt gets no buttons again. The tab keeps that hold across navigation; a connection lost after the server takes the click holds it there too, unless Fleet confirms success. No line names tmux or quotes Fleet's error, and nothing is retried. (test)
- [x] LAUNCH-6.7 When a read shows a Trust prompt that Fleet says can't be answered (it doesn't fit, its wording is unknown, its answer was changed in a terminal, or something else shows with it), the card shows its text when Fleet could read it whole, the line LAUNCH-6.6 would give in place of the buttons, and Dismiss, which removes the row and leaves the Session host running, as for a failed start. The 15 s stay held while it shows; the buttons come back with the first read that can answer it. (test)
- [x] LAUNCH-6.8 A read showing another Trust prompt (another folder, other permissions, other wording: Fleet's id differs) replaces the card's text and buttons. A click carries the id of the prompt it shows, so a prompt that changed between the read and the click is refused, never answered. A prompt that leaves the screen without Lookout's answer (answered in a terminal app, or Claude Code exited) brings the waiting note back, and the 15 s start again (LAUNCH-6.2). (test)
- [x] LAUNCH-6.9 The card is a region named by its heading, and the change from the waiting note is announced once, politely. Focus doesn't move to it on its own, and no key answers it unless focus is on one of its buttons: Tab reaches "Trust folder", then "Cancel", and Enter or Space acts as a click. "Trust folder" is described as answering "Yes, I trust this folder", after which Claude Code runs in the folder with what its settings pre-approve; "Cancel" as answering "No, exit", which ends the start. While either is answered, both keep focus and are `aria-disabled`, and "Trusting…" or "Cancelling…" is announced; LAUNCH-6.6's and 6.7's lines are announced once, as alerts. (test)
- [x] LAUNCH-6.10 Lookout answers a Trust prompt only for a click (or Enter or Space) on "Trust folder" or "Cancel" in a tab showing that prompt. Never on its own: there's no setting for it, and Lookout keeps no list of trusted folders (Claude Code remembers your answer for the folder itself, and then doesn't ask). A reload or another tab shows the same card and buttons; while one tab's answer is being typed, a click in another says so and types nothing. (test)
- [x] LAUNCH-6.11 A resume (HIST-3.1) of a Claude Code Session in a folder it doesn't trust shows the same card and is answered the same way; after Cancel it can be resumed again. A resume Fleet says is already being started, in a Session host it names (the contract's C7: a resume started from the CLI, or by Lookout before a restart), is followed like Lookout's own: its Trust prompt shows on its row, with the same buttons. (test)
- [x] LAUNCH-6.12 When Fleet refuses a Trust prompt's answer, or a read says it can't be answered, the server logs one line: the launch id, the answer (or that it was a read), Fleet's kind and reason code, and whether a key went out. Never Fleet's error text or the prompt's text. (test)
- [ ] LAUNCH-6.13 Seen in the running app, with claude 2.1.311 (the version of the reference captures), in a folder Claude Code doesn't trust whose `.claude/settings.json` pre-approves more tool permissions than its prompt lists: a new start and a resume each show the prompt's text as the terminal does; "Trust folder" starts the Session; "Cancel" leaves no Session host behind. The card reads well in light and dark at 1440×900 and in a 700 px tall window. (manual)
- [x] LAUNCH-6.14 ⌘J reaches a start waiting at its Trust prompt: it is the first Needs you row, above the Sessions, and ⌘J selects it before any Session that Needs you. Once the prompt is answered or gone it is a plain "Starting…" row again and ⌘J skips it. (test)

LAUNCH-6.1 to 6.12 and 6.14 are covered by unit tests of the launcher and the Starting view, and route tests against the fake `fleet`, which answers `trust` as [the contract](../../contracts/fleet-trust.md) says. They're retagged `(e2e)` once the Fake Harness for Claude Code draws a Trust prompt and registers only after "Yes" (TEST-1.4). LAUNCH-6 is built once Lookout's Fleet pin has the fork's `trust` commit.

## Non-goals

- Picking, searching or creating Worktrees. You start in the repo, tell the agent what you're working on, and it moves to the right Worktree itself. Picking existing Worktrees may become its own feature later.
- Starting in an iTerm2 tab. Sessions always start in a Session host; ITERM opens them in iTerm2.
- Permission modes other than Skip permissions (Claude Code's `--permission-mode`, Codex's `--sandbox` and `--ask-for-approval`), and other Harness flags.
- Effort or Skip permissions on a resume (HIST-3.1): a resumed Session starts as its Harness restores it.
- Attachments, voice input, prompt templates.
- Starting several Sessions at once.
- Other Hosts, and the pi Harness.
- Answering a Trust prompt for you: no auto-accept, no "always trust" setting, no list of trusted folders in Lookout (LAUNCH-6.10). Claude Code remembers the answer per folder.
- More of the Trust prompt than the terminal shows: the permissions behind "… and 2 more", reading the folder's `.claude/settings.json`, or the "Security guide" as a link.
- Codex's Trust prompt, for now: a Codex start completes while it waits there, as before (Known gaps).
- Other screens a Harness shows before it starts: Claude Code's bypass mode acceptance (Known gaps), login, update prompts.

## UX

```
┌ New Session ───────────────────────────────────────────┐
│ Directory  [ ~/Projects/work                        ▾] │
│ Harness    (•) Claude Code   ( ) Codex                 │
│ Model      [ Default                 ▾]  Effort [high▾] │
│            [x] Skip permissions                        │
│ Name       [ optional                                ] │
│ Prompt     ┌─────────────────────────────────────────┐ │
│            │                                         │ │
│            └─────────────────────────────────────────┘ │
│                                   Esc  Cancel  ⌘↵ Start│
└────────────────────────────────────────────────────────┘
```

- Opening: N, ⌘N in an installed-app window, or "+". The "+" button's tooltip and the empty main pane show the shortcut.
- Effort sits on the model's line and lists the levels by their words (`low` … `max`, and `ultra` where Codex lists it). Changing the model keeps the level when the new model lists it, else applies LAUNCH-3.4's fallback.
- Skip permissions sits under the model's line. Its tooltip names what it passes: "Starts Claude Code with --dangerously-skip-permissions: no permission prompts." For Codex a muted note sits beside it: "Also turns off Codex's sandbox", and the tooltip names `--dangerously-bypass-approvals-and-sandbox`.
- A launcher opened from Work (WORK-5.1, WORK-5.2) has both, with the same starting values.

```
┌───────────────┬──────────────────────────────────────────────────────┐
│ / filter  + ⚙ │ ◌ fix-rates · Claude Code                 Starting…  │
├───────────────┼──────────────────────────────────────────────────────┤
│ ◌ fix-rates   │ Directory  ~/Projects/work                           │
│   Starting…   │ Started    4s ago                                    │
│ ◆ kg-hook-…   │ Waiting for Fleet to report the Session…             │
└───────────────┴──────────────────────────────────────────────────────┘
```

- Starting view (LAUNCH-4.6): a header like a Session's (spinner, name, Harness, "Starting…"), then the start directory (wrapped, never cut) and the time since Start. Once failed: "Didn't start" in the header, then the error and the terminal's last lines in full, scrollable. Each fact shows once. It has no dock: its content runs to the bottom (SIDE-8).
- A failed row, while selected, is compact: its name, "Didn't start · folder · age" and Dismiss; the view carries the error and the lines. Unselected, it shows them itself (LAUNCH-4.5): the error is the design system's inline error (DS-4), wrapped, never cut, and not announced again (`quiet`: the starting view said it while selected). Dismiss is a 24 px icon button (DS-7).
- A failed start is dismissed from its sidebar row. Dismissing the selected one selects the next start below it (else the one above); with no other start left, nothing is selected (the empty main pane). Focus then goes to the Dismiss button of the start that took its place, if it failed too, else to the main pane.
- The "Starting…" rows are a plain list, not options: a failed row holds a Dismiss button, which an option can't. The selected row has `aria-current`.

```
┌───────────────┬──────────────────────────────────────────────────────────┐
│ / filter  + ⚙ │ ◆ new-repo · Claude Code                      Needs you  │
├───────────────┼──────────────────────────────────────────────────────────┤
│ ◆ new-repo    │ Directory  ~/Projects/new-repo                           │
│   Asks to     │ Started    6s ago                                        │
│   trust the … │                                                          │
│ ◆ kg-hook-…   │ Claude Code asks whether you trust this folder           │
│               │ ┌──────────────────────────────────────────────────────┐ │
│               │ │ …                                                    │ │
│               │ │ ⚠ This folder pre-approves 10 tool permissions in    │ │
│               │ │ .claude/settings.json: Bash(…), Bash(…), … and 2 more│ │
│               │ │ These will apply without asking. Only proceed if you │ │
│               │ │ trust this configuration.                            │ │
│               │ │ Security guide                                       │ │
│               │ └──────────────────────────────────────────────────────┘ │
│               │ [ Trust folder ]  [ Cancel ]                             │
│               │ Claude Code remembers your answer for this folder.       │
└───────────────┴──────────────────────────────────────────────────────────┘
```

- Trust prompt (LAUNCH-6.3): the card sits where the waiting note was, under the start's directory and age. Its heading is a `text-body` semibold line; the prompt's text is a monospace block in the style of the failed start's terminal lines, but wrapped, never cut, and scrolling past 14 lines; a blank line in the prompt stays one blank line. "…" in the sketch stands for the prompt's lines above its warning (the folder, Claude Code's question), which this spec doesn't fix: they're the terminal's. Under it, "Trust folder" (Primary) and "Cancel" (outline), side by side, with DS-7.4's space around them, then a muted note: "Claude Code remembers your answer for this folder." Neither button is focused when the card appears.
- The header's state pill reads "Needs you" in Needs you's colours, and the marker before the name is Needs you's, as the row's is. The row's second line is "Asks to trust the folder", in place of "Starting…" (wrapped like a failed row's, never cut).
- While answering: the clicked button reads "Trusting…" or "Cancelling…", both are disabled (`aria-disabled`, keeping focus), and a polite status says the same.
- After Cancel: the row goes as when a failed start is dismissed: the next start below it is selected (else the one above); with no other start left, nothing is (the empty main pane). Focus goes to the Dismiss button of the start that took its place if it failed, else to the main pane. A start cancelled in another tab shows "This start is no longer listed" here, as one dismissed there does.
- Lines in place of the buttons (LAUNCH-6.6, 6.7), in the Needs you text colour, as VIEW-4.6's lines are:
  - the prompt changed: "The prompt changed before Lookout answered, so nothing was typed." (the next read shows the new one);
  - gone: "The prompt is gone, so nothing was typed.";
  - changed in a terminal: "Its answer was changed in a terminal, so Lookout won't answer it.";
  - something else on screen: "Something else shows in the terminal with this prompt, so Lookout won't answer it.";
  - doesn't fit: "This prompt doesn't fit in the terminal (80×24), so Lookout can't read it whole." (without the size when Fleet gives none);
  - unknown wording: "Lookout can't read this version of Claude Code's prompt.";
  - an answer already going: "An answer to this prompt is being typed right now." (also "Another tab is answering…" from Lookout's own guard);
  - a key may have gone out: "It may have been answered, but Lookout can't tell." followed by the terminal's last lines, as a failed start shows them.
  - While a line of LAUNCH-6.7's shows, the row holds Dismiss (DS-7's 24 px icon button), as a failed row does, since nothing else ends the start then. The row's second line stays "Asks to trust the folder"; the line itself shows only in the view.

## Technical approach

- **Starting:** the server runs `fleet --local spawn --json --backend tmux --harness <h> --dir <d> [--model <m>] [--effort <level>] [--skip-permissions] [--name <n>] [-- <prompt>]`, as an argv array. The prompt goes after `--`, so one starting with `-` isn't read as a flag.
  - Fleet creates a new tmux session in `<dir>` (`new-session -c <dir>`), which opens a login shell.
  - It then types `<harness> [-n <name>] [<prompt>]` into that shell, so `claude` resolves to the telemetry wrapper ([0001](../../decisions/0001-tmux-as-hidden-session-host.md), [0002](../../decisions/0002-start-sessions-through-a-login-shell.md)).
  - A multi-line prompt is typed as one ANSI-C quoted argument (`$'…\n…'`), so it arrives as one message. If the typed line would be over 900 bytes, Fleet writes the prompt to `~/.claude/fleet-prompts/` and types `"$(cat <file>)"` instead.
  - `fleet spawn --json` (the Fleet fork, decision 0006) prints one object: `tmux_session` on success, `{ok: false, kind, error}` with exit 1 on failure. The server keeps `tmux_session` for LAUNCH-4.5 and matches the new Session by it in `fleet list --json`; `name_taken` becomes the name field's error, without naming tmux. HIST's resume uses the same path.
  - `--name` becomes Claude's `-n` and, sanitized, the tmux session's name. Codex has no `-n`, so for Codex the name only names the Session host. A name that's already taken is an error from Fleet; Lookout rewords it without mentioning tmux (0001).
  - **Environment:** Lookout strips `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_PID`, `CLAUDE_EFFORT` and `OTEL_*` that it inherited (for example when its server runs inside a Claude Code Session) from what it passes to `fleet`, and adds nothing. When no tmux server is running, the one Fleet starts takes its global environment from this cleaned one. Verified 2026-10-16: tmux's global environment, the shell and `claude` carried none of them, and in `~/Projects/work` the wrapper alone added the `OTEL_*` block (with `repo=work`).
- **Effort and Skip permissions (LAUNCH-3.4, 3.5, 4.8):** passed through Fleet, never typed by Lookout (0004).
  - **Fleet, a commit in the fork ([0006](../../decisions/0006-run-a-fork-of-fleet.md)):** `spawn` gains `--effort <level>` and `--skip-permissions`, and puts them in the command it types, before `--` and the prompt:
    - Claude Code: `--effort <level>` and `--dangerously-skip-permissions` (claude 2.1.309's `--help`: "Effort level for the current session", so the saved default stays as it was);
    - Codex: `-c model_reasoning_effort=<level>` and `--dangerously-bypass-approvals-and-sandbox` (codex 0.163; `-c` overrides `~/.codex/config.toml` for this run only).
    - The level follows `fleet effort`'s rule: lowercase letters, at most 16; anything else, or either flag with pi, `--resume` or `--from`, is a `usage` failure (`{ok: false, kind: "usage"}`, exit 1), before anything starts, also for a spawn on another host. `handoff`, `stack spawn`, `prs` and `jobs` don't have the flags, so their argument parser rejects them as unknown (exit 2, no JSON), as for any flag they lack. Fleet doesn't check the level against its `harness list`; Lookout does.
  - **Lookout's server:** `POST /api/launch` takes `effort` (a string, or absent) and `skipPermissions` (a boolean, default false). `effort` must be one of the `efforts` the cached `harness list` gives for the chosen model (an entry matched by id, `''` the default one), else 400 before argv is built; a model with no levels takes none. `--skip-permissions` goes in only when `skipPermissions` is true.
  - **Remembered per Harness (LAUNCH-3.4, 3.5):** `lastLaunch` gains `byHarness: {claude?: {effort, skipPermissions}, codex?: {…}}`, written after a successful start for that start's Harness only, so a Codex start leaves Claude Code's choice alone. `effort` is a level or null (the model had none). Missing entries mean first time: `high`, and checked for Claude Code only. Old settings files without `byHarness` parse as first time.
  - **Status line (LAUNCH-4.8):** Fleet reads a Claude Code Session's Effort from its Transcript's turns (`core/context.rs`), so it shows after the first reply, as for any Session; a Codex Session's from its rollout's `turn_context`.
- **Verified 2026-10-16:** a fresh tmux session's shell is `-zsh`, and `claude` resolves there to the shell function (the wrapper).
- **Shortcut:** a window-level key handler opens the launcher on N when focus isn't in an input, textarea, select or editable element, and on ⌘N anywhere. A normal Chrome tab keeps ⌘N (new window) for itself, so the page never sees it there; in an installed-app window it does.
- **Harnesses and models:** from `fleet --local harness list --json`, cached for 10 minutes. Each entry is `{ id, label, command, installed, models: [{ id, label }] }`; the first model, id `''`, is the Harness's own default (`--model` is then left out). Model ids are letters, digits and `._[]-/:` only (Fleet's rule). pi is dropped.
- **Start directories:** only one from the Settings list is accepted, so the server never starts anything elsewhere. One that's added must exist; `~` is expanded by the server.
- **Settings:** start directories live in the server's settings file (the same one as SIDE-7). So does the last-used choice for LAUNCH-1.2.
- **Selecting a start (LAUNCH-4.2, 4.6):** a selected "Starting…" row is in the URL, `/l/<launch id>`, like a Session (SIDE-4.2).
  - The tab picks the launch id (a UUID) and sends it as `launchId` with `POST /api/launch` (and HIST's resume). So the moment you press Start, it shows that row itself and selects it, before `fleet spawn` returns. The server uses that id, and refuses a malformed one (400) or one it already has (409); without one it makes one up.
  - The tab's own row stands until the server's `launches` list names it. Once the server has listed it, its list is the truth: a late answer never brings back a start dismissed meanwhile.
  - An answer moves the selection only while the URL still shows that start: a failed start goes back (replaced) to where Start was pressed; a resume that finds the Session live, or can't resume it, or has one under way already, replaces the URL with that. Anywhere you moved to meanwhile stays.
  - When a `started` mapping names the launch and the URL still shows it, the tab replaces the URL with the Session's, before paint, so Back doesn't return to a start that's gone; any other selection is left alone.
  - The snapshot's `started` (kept 60 s) lets a tab that reconnects or reloads take over too. It follows the Session's process (pid and Harness), so a Codex Session that got its session id meanwhile is named by its new id.
  - A launch id the tab doesn't know (dismissed in another tab, a reload long after, or Lookout restarted: launches live in the server's memory) shows "This start is no longer listed".
- **Trust prompt (LAUNCH-6):** read and answered through the fork's `fleet trust` ([contract](../../contracts/fleet-trust.md), [0006](../../decisions/0006-run-a-fork-of-fleet.md)), never by Lookout typing into tmux (0001, 0004).
  - **Why Fleet needs a commit:** `peek`, `keys`, `send` and `answer` find their target among the Sessions Fleet lists (`core/discovery.rs`, `resolve_target`), and Claude Code isn't listed until its Trust prompt is answered. `spawn` never answers it; Fleet's web spawner does (`web/lib/spawn.mjs`, `acceptTrustPrompt`), always with "Yes", in a server Lookout doesn't use. So `trust` names the Session host instead: `fleet --local trust <tmux_session> --pane <handle> --json` with `--list`, or `--accept` / `--decline --close` and `--prompt <id>`. It types only on a Trust prompt that is alone on the screen (blank rows under its footer, the cursor on it, not in copy mode) and untouched, checks every key before the next, and gives a reason code (`detail`) that never quotes the screen (contract C2 to C6).
  - **Following a start:** `parseSpawnAnswer` keeps `handle` (the pane id) beside `tmux_session`. While a Claude Code launch is `starting` or at its Trust prompt and has a Session host, the server reads `trust --list` (5 s timeout) once `spawn` has answered, then on its own 2 s schedule, independently of Fleet list polls, one read at a time per launch. Fleet monitor results still call `observe` to complete reported starts; failed or slow list polls do not delay Trust prompt reads. A Codex launch, one without a Session host, and one that failed, was reported or was dismissed is never read. A read is one tmux call in Fleet, which returns the screen with the pane's cursor position, height, mode and current command.
  - **State:** `LaunchView.state` gains `'trust'`, and the view gains `trust: { id, lines, answerable, detail, answering, message } | null`. `lines` go to the tab as Fleet read them (at most 60 of 2,000 characters, control characters removed), not redacted: they're what you're asked to judge, as a failed start's terminal lines are. They're never logged.
  - **The 15 s (LAUNCH-6.2):** a read with a Trust prompt moves a `starting` launch to `trust` and clears its timer; a read without one moves it back to `starting` with a new 15 s timer, as does an accept Fleet answered. When the timer fires, `timedOut` waits out a read already in flight, then captures a fresh screen with `trust --list` if still starting; a Trust prompt there moves the launch to `trust` instead of failing it. A read that fails with `target_not_found`, `target_changed` or `host_unsupported` counts as one without a prompt (the Session host is gone or isn't the one `spawn` made); a read Lookout can't use (a timeout, malformed output, `backend_failed`) changes nothing.
  - **Answering:** `POST /api/launches/<id>/trust` with `{answer: "accept" | "decline", prompt: "<id>"}`, token and `Origin` checked as for `POST /api/launch`, at most 1 KB. It's 409 when the launch isn't at its Trust prompt, when `prompt` isn't the id of the server's latest read, while another answer to it runs (one at a time, from any tab: "Another tab is answering…"), and for a prompt marked uncertain. Otherwise the server runs `fleet --local trust <s> --pane <h> --accept|--decline --prompt <id> --allow-attached --json`, `--close` always with `--decline`, with a 15 s timeout. `--allow-attached` for the reason VIEW's answers pass it: you're the only one who could be typing.
  - **Outcomes:** an accept answered goes back to `starting` (above). A decline answered with `closed: true` removes the launch as `dismiss` does; with `closed: false` the launch fails with "Cancelled, but Claude Code didn't exit, so its Session host is still running." or "…, but its Session host couldn't be closed." (`close_detail`), and its terminal's last lines. A refusal with `typed: false` keeps `trust`, with `message` from its kind and `detail` (the words are in UX: `no_prompt`, `shell` and the target kinds read as gone, `different_prompt` as changed, `touched`, `not_alone`, `clipped`, `layout_unsupported` and `busy` as their own lines), until the next read that can answer the prompt shown; that read restores the buttons (LAUNCH-6.6). With `typed: true`, `prompt_changed`, `outcome_uncertain`, a timeout or anything unexpected, that prompt's id is marked uncertain: reads that show it again give no buttons, and the terminal's last lines are read as on a failure. A lost HTTP connection marks the clicked id uncertain on the server too; if Fleet subsequently confirms success, that known outcome still applies. Otherwise the terminal's last lines accompany the outcome when the tab reconnects. The tab also holds that id uncertain across navigation if its request fails or times out (20 s); an answer request is never replayed, including a token refresh. Nothing is retried.
  - **The log (LAUNCH-6.12):** one line per refusal or unanswerable read, e.g. `lookout: trust refused: launch=<id> answer=accept kind=prompt_not_on_screen detail=different_prompt typed=false`, through a new `log` option on the launcher (default `console.warn`), as `AnswererOptions.log` does for VIEW-4.8. Each value is checked first as VIEW-4.8's are (`kind` and `detail` from the contract's fixed code sets, else `other`; absent, `none`); never Fleet's `error`, `lines` or `screen`. A read logs only when its `detail` differs from that launch's last read.
  - **A Fleet without `trust`:** `--list` fails with `error: unrecognized subcommand 'trust'` (contract C1). The launcher logs it once, stops reading Trust prompts until the server restarts, and starts behave as before LAUNCH-6: the 15 s failure, with the prompt in the terminal's last lines.
  - **Resumes (LAUNCH-6.11):** a resume follows the same path, by its `tmux_session` and `handle`. Fleet's `session_starting` gains `starting: { tmux_session, handle }` (contract C7); with it, the launch is still marked `elsewhere` but takes that Session host as its own, so its Trust prompt is read and answered, and its terminal's lines show on a failure. Without it (an iTerm resume, or the pane gone), the 15 s failure says "It's being started in another terminal app (waiting at its Trust prompt, say); answer it there."
  - **In the tab:** the card is part of `StartingView`; the row's look is `LaunchItem`'s. An HTTP answer is shown immediately until the snapshot/event stream catches up, without replacing a newer different prompt. A start that leaves `launches` right after this tab's own Cancel moves the selection as Dismiss does, choosing among the starts still present when Cancel completes; one that leaves for another tab's Cancel shows "This start is no longer listed", as for Dismiss.
  - **Codex:** a Codex Session at Codex's Trust prompt is listed (Idle, no session id), so its start completes as before; `trust` reads only Claude Code's prompt until the contract's C10 (Known gaps).

### Key decisions

- **Always the tmux backend, set explicitly**: Fleet's default on macOS is iTerm2, which would break 0001.
- **On a start timeout, read the pane directly** (`tmux capture-pane` on the target Fleet printed): before Fleet reports the Session, there's nothing to `fleet peek`. This is the only place Lookout touches tmux itself.
- **No Worktree handling at launch**: moving into the right Worktree is the agent's job in our workflow.
- **Effort starts at `high`, not the model's own default** (Dario, 2026-10-23): high is the level wanted for most work; the model's default (`medium` for the 5.5 models) is a fallback only for a model with no `high`.
- **Skip permissions is unchecked for Codex at first** (Dario, 2026-10-23): Codex's only matching flag also turns off its sandbox, so that takes a deliberate tick. Claude Code's skips the prompts only, and hooks still run in both.
- **Both remembered per Harness**, as the model is (LAUNCH-1.2): a pick for Codex never changes what Claude Code opens with.
- **Effort and Skip permissions together, in one fork commit**: both are flags `spawn` puts in the typed command, so one commit and one pin move serve both.
- **The Trust prompt is caught while Starting, not after the 15 s** (Dario, 2026-10-27): a start at its Trust prompt waits on you, not on Fleet, so failing it after 15 s told you the wrong thing, and left nowhere to answer.
- **Never answered for you** (Dario, 2026-10-27): trusting a folder applies whatever its settings pre-approve, so it's your click every time; Claude Code remembers the answer per folder, so Lookout needs no memory of it.
- **The card shows the prompt's own text, not a summary**: the pre-approved permissions are the reason to look, and only the terminal's words say exactly what Claude Code will apply.
- **One `fleet trust` verb, not a Session-less target for `answer`**: a target form every verb accepts would let `send` and `keys` type into a pane where nothing has registered; `trust` presses keys only on a Trust prompt (contract, "Why a new command").
- **Fleet types; Lookout's one direct tmux read stays the failed start's lines**: reading the Trust prompt with `capture-pane` in Lookout would be a second exception to 0001 and 0004, and answering it there would be typing into tmux.
- **Every answer carries the prompt's id**: what you clicked is what gets answered, or nothing is; a different folder or permission list has another id.
- **Cancel declines, then closes the Session host** (Dario, 2026-10-27): nothing is left running in a host you can't see, and Fleet's resume stamp goes stale with the pane, so a resume can be tried again.
- **⌘J reaches a start waiting at its Trust prompt** (Dario, 2026-10-27): it shows Needs you's marker and waits on you, so skipping it would hide the one thing that needs you; the other "Starting…" rows never Need you and stay skipped (LAUNCH-6.14).
- **Codex gets the same card in a second slice, after Claude Code's ships** (Dario, 2026-10-27): the card and the take-over hold are the same work for both Harnesses, but the fork must record Codex's screens first (contract C10). Until then a Codex start at its Trust prompt completes as Idle and can't be answered from Lookout.
- **Tagged `(test)` until the Fake Harness draws a Trust prompt**, as VIEW-4's answers are: a Behaviour test would need TEST-1.4 first, and the route and component tests against the contract's fake check the same behaviour now.

### Known gaps

- Codex's Trust prompt (second slice, Dario, 2026-10-27): the same card for a Codex start, once the fork's second commit reads Codex's prompt (contract C10) and Lookout holds a Codex start's take-over (LAUNCH-4.2) while its Session host shows it. Until then a Codex start at its Trust prompt completes as Idle, and its prompt shows only in the terminal preview with nowhere to answer it from Lookout.
- Claude Code asks once to accept bypass mode ("Bypass Permissions mode … Yes, I accept") unless `skipDangerousModePermissionPrompt` is set in `~/.claude/settings.json` (it is on this Mac). Where it isn't, a Session started with Skip permissions waits on that screen; whether `fleet list` shows it before the answer is unchecked, so it may time out as LAUNCH-4.5 says, showing the prompt in its terminal lines. LAUNCH-6 doesn't cover it: `fleet trust` reads only the Trust prompt.
- Codex's Effort shows in the status line only once Fleet reads it from the rollout; whether `-c model_reasoning_effort` shows there before the first turn is checked in LAUNCH-4.8's live check.
- A new start waiting at its Trust prompt when Lookout's server restarts is no longer listed (launches live in the server's memory). Its Session host waits there, unseen, with Claude Code running, until it's opened in a terminal app (ITERM) or closed with Fleet. A resume of the same Session finds it again (LAUNCH-6.11, contract C7); a new start has nothing to find it by.
- VIEW's approval race applies to the Trust prompt too: a terminal client attached to the Session host could change the screen between Fleet's last check and its Enter. Fleet checks the screen before every key, so only that last gap is open, and nobody attaches to a hidden Session host but by hand.
- The Trust prompt's wording is Claude Code's and changes between versions (the 2026-10-16 "Quick safety check" screen and the 2026-10-27 report's pre-approved permissions differ). A wording Fleet doesn't know is `layout_unsupported` (LAUNCH-6.7) until the fork reads it. The contract follows real screens from Claude Code 2.1.311 (heading "Accessing workspace:", "No, exit" preselected); after a decline or Esc its dialog text stays on screen above the shell, which Fleet doesn't take for a prompt.
- Why Dario's resume (2026-10-27) showed the Trust prompt although `/` is trusted in `~/.claude.json` is not known. That the folder's `.claude/settings.json` pre-approving permissions made it ask is a guess, unproven. LAUNCH-6.13's live check needs a real way to bring the prompt up: the captures used a separate `CLAUDE_CONFIG_DIR`, launched by hand, not Lookout's start.

## Open questions

None.

Resolved while building (2026-10-16): `fleet spawn` (the CLI) never answers a trust prompt; only Fleet's web spawner does.
- **Claude Code:** a Session waiting on "Quick safety check… Yes, I trust this folder" isn't in `fleet list` at all, because Claude registers only after trust. So LAUNCH-4.5 catches it, and its error shows that prompt. On this Mac, `~/.claude.json` trusts `/` but has `hasTrustDialogAccepted: false` for the home directory, so new directories under `~` ask and `/private/tmp/…` doesn't. Replaced by LAUNCH-6 (2026-10-27): the Starting view shows the prompt and answers it when you click.
- **Codex:** a Session waiting on its trust prompt (or on its "Update available" prompt) *is* in `fleet list`, as Idle, with no session id. So its start succeeds and the Session shows as Idle, not Needs you.

## Changelog

- 2026-10-16: Created.
- 2026-10-16: Review answers: no Worktree picking or search (start directories only); creating Worktrees is a non-goal; tmux backend and auto-select confirmed; trust prompt not blocking. Ready.
- 2026-10-16: In Progress. Technical approach checked against Fleet 38a461c: `spawn` prints text, not the tmux target; the command typed has no `cd`; multi-line prompts; harness list shape; Lookout strips inherited `OTEL_*`/`CLAUDE_CODE_*` from what it starts (LAUNCH-5.2). Open question on the trust prompt answered with what was seen.
- 2026-10-16: N added because Chrome keeps ⌘N in a normal tab.
- 2026-10-16: LAUNCH-5.1 verified in Grafana (Loki `claude-code-telemetry`): a Session started through Lookout in `~/Projects/work` sent its events with `repo=work` and `terminal.type=tmux`.
- 2026-10-17: `fleet spawn` is read through `--json` (the fork has it now), shared with HIST's resume.
- 2026-10-17: LAUNCH-4.2 amended: Start selects the "Starting…" row at once, and the real Session takes over the selection only while that row is still selected, so you're never pulled away from a Session you moved to. Added LAUNCH-4.6, a starting view in the main pane (name, Harness, directory, time since Start; the error and terminal lines once failed), and LAUNCH-4.7, "Starting…" rows in keyboard navigation. Technical approach: the `/l/<id>` URL and the take-over. HIST's resume does the same (HIST-3.1).
- 2026-10-17: Review of selecting a start: the tab picks the launch id, so Start selects its row the moment you press it, and a late answer never moves you once you've moved on (LAUNCH-4.2 now holds as written). LAUNCH-4.5: the failed row stays compact while selected. LAUNCH-4.6: the error and lines replace the waiting note. LAUNCH-4.7: a failed start takes no ⌘ number. UX: what follows dismissing the selected start, and where focus goes; the starting view shows each fact once. Technical approach: `launchId`, answers that respect where you are, `started` following an id change.
- 2026-10-19: Done: every acceptance criterion is ticked.
- 2026-10-21: Changed from Dario's testing: LAUNCH-1.3's draft belongs to the launcher opened with N, ⌘N or "+". A launcher opened from Work no longer shares it, so a Task's URL or a Review prompt left behind by Esc no longer shows up in the next launcher you open. A start from Work that is answered after Esc closed its launcher leaves the N-opened draft alone too. LAUNCH-1.3 is retagged `(e2e)` (a World can check it) and ticked again on a Behaviour test that passes.
- 2026-10-22: Design system (DS-4, DS-7): a failed row's error is an inline error Alert, wrapping in full, and `quiet`, so a screen reader isn't told twice (the starting view announces it while selected); Dismiss is a 24 px icon button. LAUNCH-4.5's wording stays.
- 2026-10-23: In Progress again for Plan item 5: Effort (LAUNCH-3.4) and Skip permissions (LAUNCH-3.5) in the launcher, passed through the fork's `spawn` (LAUNCH-4.8). Dario's answers: both together; Effort starts at `high`; both remembered per Harness; Codex too; Skip permissions checked at first for Claude Code only. The Non-goal on Harness flags narrows to the rest of them.
- 2026-10-23: Built against the Fleet fork's `spawn --effort` / `--skip-permissions` (`lookout` `914f769`, now Lookout's pin and the README's). LAUNCH-4.8 seen live through a preview on that Fleet, claude 2.1.309 and codex 0.163, in a private tmux server: Claude Code on Haiku 5.5 at `low` with Skip permissions ran `claude --model claude-haiku-5-5 -n … --effort low --dangerously-skip-permissions -- …`, its terminal showed `low` and "bypass permissions on", and the status line read `low` after the reply; the next launcher opened on `low` for Claude Code, and on `high`, unchecked, with the sandbox note, for Codex; Codex at `low` ran `codex -c model_reasoning_effort=low -- …` and its status line read `low`. `~/.claude/settings.json` was byte-identical before and after, and `~/.codex/config.toml` kept `high`. Review fix: Codex's note is the checkbox's accessible description. Done: every criterion is ticked.
- 2026-10-27: In Progress again for Plan item 13, from Dario's report: resuming a past Session (HIST-3) in a folder Claude Code didn't trust failed after 15 s with "Fleet hasn't reported it after 15 s. Its Session host is still running.", and the terminal's last lines showed the Trust prompt, which Lookout gave no way to answer. Dario's choices: the Starting view detects the prompt while Starting, shows its text with the permissions the folder pre-approves, and offers two buttons; new starts and resumes alike; Claude Code first; never answered automatically. Added LAUNCH-6 (6.1 to 6.13). LAUNCH-4.5 amended (the 15 s don't count while the Trust prompt waits) and unticked. Technical approach: the fork's new `fleet trust` ([contract](../../contracts/fleet-trust.md)), since no Fleet verb can name a Session before it registers; `session_starting` names its Session host (C7). Non-goals, Key decisions and Known gaps follow; the 2026-10-16 note on the trust prompt is replaced for Claude Code. Not grilled; three open questions, each with a recommendation the criteria follow.
- 2026-10-27: Dario answered the three open questions, all as recommended; folded in as Key decisions with their reasons. Cancel closes the Session host (LAUNCH-6.5 as written). ⌘J reaches a start waiting at its Trust prompt: added LAUNCH-6.14, amended and unticked LAUNCH-4.7, and amended SIDE's "Starting…" row line. Codex gets the same card in a second slice (Known gaps); until then a Codex start at its Trust prompt completes as Idle. Open questions: none. Not grilled.
- 2026-10-27: The `fleet trust` contract amended after real captures of Claude Code 2.1.311 (C2, C3, C4, C8, C9): the heading "Accessing workspace:", "No, exit" preselected, the footer and the wrapped permissions warning; the `id` hashes the dialog's paragraphs so it holds at any width; blank rows under the footer; the dialog's text stays after Esc, so a cursor on the shell isn't a prompt; Fleet reads cursor, height, mode and current command with the capture; an `--accept` ending at the shell is `outcome_uncertain`. Known gaps: why the resume asked is unknown.

- 2026-10-27: Building LAUNCH-6: a refusal before typing clears on the next answerable read, including the same prompt id, as LAUNCH-6.6 requires; aligned the Technical approach.

- 2026-10-27: LAUNCH-6.6 implementation detail: an answer request has a 20 s browser timeout and is never replayed, including on a token refresh; a connection lost after the server takes the click holds that id uncertain server-side too, unless Fleet confirms the outcome. Terminal lines arrive with the server outcome on reconnect.

- 2026-10-27: Built LAUNCH-6.1–6.12 and 6.14: Fleet-only Trust prompt reads and answers, held/reset launch timeout, guarded Trust folder and Cancel, uncertain-answer holds and code-only logging, external resume following, accessible Starting card and Needs you/⌘J navigation. Fleet pin moved from `570ce97` to `bcec75c` (Claude Code 2.1.311 trust screens). Named launcher, route, client and UI tests pass; LAUNCH-4.7 ticked. LAUNCH-6.13, LAUNCH-4.5 and HIST-3.4 remain manual and unticked. Settled while building: a refusal before typing clears on the next answerable read; browser answers time out at 20 s, never replay, and uncertain ids survive navigation and a lost accepted connection until Fleet confirms success. Code-only logs accept the contract's fixed sets; new codes read as `other`.

- 2026-10-27: Review regressions verified: the deadline takes a fresh screen after any older read; an HTTP outcome stays visible until SSE catches up and never replaces a newer prompt; Cancel chooses a remaining neighbor if the original one finished during the wait. An external resume naming its host after the deadline still gets terminal lines.

- 2026-10-27: Review round 1 fixes: Trust prompt reads validate Fleet reason fields without coercion and background read failures cannot reject the polling task; an independent 2 s schedule keeps LAUNCH-6.1 within its bound when Fleet list polls fail or stall; LAUNCH-6.9 keeps one polite status region mounted from waiting through trust and answering. Regression tests cover the malformed payload, startup/monitor failure sequence and live-region identity.
