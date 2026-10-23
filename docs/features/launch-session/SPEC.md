---
title: Start Sessions
code: LAUNCH
status: Done
created: 2026-10-16
updated: 2026-10-23
---

# Start Sessions

## Summary

Start a Claude Code or Codex Session from Lookout in a few keystrokes: pick a start directory, a Harness and model, and optionally a name and first prompt. The Session runs in its own Session host, so it's Controllable, sends telemetry, and can be opened in iTerm2 later.

## Problem

Sessions started in Orca can't be controlled from Lookout (SIDE shows them greyed out). For Lookout to be useful, new work has to start in a Session host, and doing that by hand (tmux, `cd`, `claude`) is slower than clicking "+" in Orca.

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
- [x] LAUNCH-4.5 If the Session hasn't appeared after 15 s, the "Starting…" row turns into an error, and the Session host is left running so you can look. The error and the last lines of its terminal show in the row while it isn't selected; selected, the row stays compact and the starting view shows them (LAUNCH-4.6). (manual)
- [x] LAUNCH-4.6 While a "Starting…" row is selected, the main pane shows the start: its name, Harness, start directory and the time since Start; then, once it failed (LAUNCH-4.5), the error and its terminal's last lines in place of the waiting note. (test)
- [x] LAUNCH-4.7 "Starting…" rows count as rows for ↑/↓, j/k and ⌘1–9 (SIDE-5.1, SIDE-5.2), in the order shown, above the Sessions. A failed one takes no ⌘ number (it stays until dismissed); ↑/↓ and j/k still reach it. ⌘J skips them all. (test)
- [x] LAUNCH-4.8 A Session starts with the Effort and the Skip permissions choice you picked, for this Session only: it doesn't change the Harness's saved defaults. After its first reply the status line shows that Effort (VIEW-5.5), and a Claude Code Session started with Skip permissions shows Claude Code's bypass mode in its terminal. (manual)

### LAUNCH-5 Telemetry

- [x] LAUNCH-5.1 A Claude Code Session started in a `productiveio/*` repo appears in Grafana under its session ID. (manual)
- [x] LAUNCH-5.2 Lookout adds no `OTEL_*` or `CLAUDE_CODE_*` variables of its own to what it starts ([0002](../../decisions/0002-start-sessions-through-a-login-shell.md)). (test)

## Non-goals

- Picking, searching or creating Worktrees. You start in the repo, tell the agent what you're working on, and it moves to the right Worktree itself. Picking existing Worktrees may become its own feature later.
- Starting in an iTerm2 tab. Sessions always start in a Session host; ITERM opens them in iTerm2.
- Permission modes other than Skip permissions (Claude Code's `--permission-mode`, Codex's `--sandbox` and `--ask-for-approval`), and other Harness flags.
- Effort or Skip permissions on a resume (HIST-3.1): a resumed Session starts as its Harness restores it.
- Attachments, voice input, prompt templates.
- Starting several Sessions at once.
- Other Hosts, and the pi Harness.

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

### Key decisions

- **Always the tmux backend, set explicitly**: Fleet's default on macOS is iTerm2, which would break 0001.
- **On a start timeout, read the pane directly** (`tmux capture-pane` on the target Fleet printed): before Fleet reports the Session, there's nothing to `fleet peek`. This is the only place Lookout touches tmux itself.
- **No Worktree handling at launch**: moving into the right Worktree is the agent's job in our workflow.
- **Effort starts at `high`, not the model's own default** (Dario, 2026-10-23): high is the level wanted for most work; the model's default (`medium` for the 5.5 models) is a fallback only for a model with no `high`.
- **Skip permissions is unchecked for Codex at first** (Dario, 2026-10-23): Codex's only matching flag also turns off its sandbox, so that takes a deliberate tick. Claude Code's skips the prompts only, and hooks still run in both.
- **Both remembered per Harness**, as the model is (LAUNCH-1.2): a pick for Codex never changes what Claude Code opens with.
- **Effort and Skip permissions together, in one fork commit**: both are flags `spawn` puts in the typed command, so one commit and one pin move serve both.

### Known gaps

- Claude Code asks once to accept bypass mode ("Bypass Permissions mode … Yes, I accept") unless `skipDangerousModePermissionPrompt` is set in `~/.claude/settings.json` (it is on this Mac). Where it isn't, a Session started with Skip permissions waits on that screen; whether `fleet list` shows it before the answer is unchecked, so it may time out as LAUNCH-4.5 says, showing the prompt in its terminal lines.
- Codex's Effort shows in the status line only once Fleet reads it from the rollout; whether `-c model_reasoning_effort` shows there before the first turn is checked in LAUNCH-4.8's live check.

## Open questions

None.

Resolved while building (2026-10-16): `fleet spawn` (the CLI) never answers a trust prompt; only Fleet's web spawner does.
- **Claude Code:** a Session waiting on "Quick safety check… Yes, I trust this folder" isn't in `fleet list` at all, because Claude registers only after trust. So LAUNCH-4.5 catches it, and its error shows that prompt. On this Mac, `~/.claude.json` trusts `/` but has `hasTrustDialogAccepted: false` for the home directory, so new directories under `~` ask and `/private/tmp/…` doesn't.
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
