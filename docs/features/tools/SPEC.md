---
title: "Tools: the CLIs Lookout runs"
code: "TOOLS"
status: "Ready"
created: "2026-10-23"
updated: "2026-10-30"
---

# Tools: the CLIs Lookout runs

## Summary

See, in one place, every Tool Lookout runs: where it was found, its version, whether it's missing or older than Lookout needs, whether a newer one is out, and the command that fixes it. Lookout shows and explains; it never installs or updates anything.

## Problem

Lookout runs nine CLIs, and a missing or old one shows up only where it bites, each in its own words: the sidebar's "Fleet isn't installed" (SIDE-6.1), History's "tb-session isn't installed", Work's "tb-pr isn't installed", "tb-prod is older than 1.2.0" and "Task links need a newer tb-pr" (WORK-7.1, 7.8, 4.1), the usage strip's "update tb-jev (needs 0.2+ for status)". Nothing says which versions Lookout is running on, and nothing says a newer one exists.

Checked on this Mac on 2026-10-23:

- `fleet` on `PATH` (`~/.cargo/bin/fleet`) is upstream `ilucin/fleet` at 38a461c, with none of the fork's commands (`messages`, `answer`, `keys`, `close`, `model`, `effort`). The live server works only because it runs `LOOKOUT_FLEET_BIN=~/Projects/fleet/target/release/fleet`. Both print `fleet 0.1.0`, so `--version` can't tell them apart.
- `shared/defaults.ts`'s `FLEET_INSTALL_COMMAND`, the command SIDE-6.1 shows, still names `ilucin/fleet --rev 38a461c`, while `README.md` and `e2e/pins.json` name the fork at 10373ec.
- `tb-session` is 0.3.0; 0.3.1 is released. Codex is 0.163.0; 0.164.0 is out, and VIEW's Codex model menu waits for it. Claude Code's own auto-update failed this morning (`~/.claude/.last-update-result.json`: `install_failed`, from 2.1.309).
- Fleet's Claude Code model and Effort tables are hand-kept as of 2.1.306 and 2.1.308 (VIEW, "Levels"), and its screen fixtures were captured on 2.1.308; nothing flags a Claude Code past that.

On 2026-10-29 the Library moved to tb-session 0.4.0's `events`. With 0.3 still installed, it said "install tb-session": `server/library.ts` reads a tb-session that doesn't know `events` as one that isn't there. A Tool that's too old must never read as missing (TOOLS-2.5).

## Requirements

One requirement per capability. Each acceptance criterion says when it holds and how it's verified: `(test)`, `(e2e)` or `(manual)` (writing rule 2 in `docs/README.md`).

### TOOLS-1 Every Tool, in one list

A "Tools" section on the Settings page lists each Tool Lookout runs, with what it's for, where it was found and its version.

- [ ] TOOLS-1.1 `GET /api/tools` answers one row per Tool, in this order: `fleet`, `claude`, `codex`, `tb-session`, `tb-pr`, `tb-prod`, `tb-jev`, `git`, `tmux`. A row is `{ id, purpose, path, version, needs, state, reason, fix, checkedAt }`: `path` and `version` null when unknown; `state` one of `ok`, `missing`, `behind`, `update-available`, `newer-than-known`, `unknown`; `reason` a plain sentence; `fix` a command or null. (test)
- [ ] TOOLS-1.2 Each Tool is looked for exactly where the code that runs it looks: `fleet` by `LOOKOUT_FLEET_BIN`, then `PATH`, then `~/.cargo/bin` (`resolveFleetBin`); `tb-session`, `tb-pr` and `tb-prod` by their `LOOKOUT_*_BIN`, then `PATH`, then `~/.local/bin`; `tb-jev`, `git` and `tmux` by `PATH`, then `~/.local/bin` for tb-jev; `claude` and `codex` by Fleet's `harness list --json`, whose `path` and `version` come from the login-shell lookup Fleet already uses (TOOLS-2.2's fork commit). The row shows the path, with `~` for the home directory, and says when it came from an environment variable. A Tool found nowhere is `missing`. (test)
- [ ] TOOLS-1.3 The version is read with argv only and a 5 s timeout: `<bin> --version` for fleet, tb-session, tb-pr, tb-prod and git, `tmux -V` for tmux, Fleet's `harness list --json` `version` for claude and codex, and `tb-jev status --json`'s `version` for tb-jev, which is never run with `--version` (USAGE). The first line, cut to 60 characters and redacted like a usage reason, is the row's `version`; a read that fails leaves `unknown` with the reason. (test)
- [ ] TOOLS-1.4 The rows are read when the server starts and when the Settings page opens, at most once a minute, never on a timer while nothing shows them; the page says how old they are and has a Refresh button. (test)
- [ ] TOOLS-1.5 In a World whose `PATH` has no `tb-pr`, Settings › Tools shows tb-pr as missing, with what Work needs it for and its install command in a command block (DS-8.2). (e2e)

### TOOLS-2 What Lookout needs

Each row compares the version with what Lookout needs, from one table in `shared/tools.ts`, and says which feature needs it.

- [ ] TOOLS-2.1 The table holds, per Tool, the lowest version each feature works with and why: tb-session 0.3.0 for History (HIST's Harness and Headless filters; 0.2 still lists) and 0.4.0 for the Library (`events`, LIB-2.1), tb-pr 0.3.1 (`column_issues`, WORK-3), tb-prod 1.2.0 (`folder_status`, WORK-7.8), tb-jev 0.2.0 (`status`, USAGE-1.4), Claude Code 2.1.301 (Subagent sidecars, SIDE-9), Codex 0.163.0 (Fleet's `request_user_input` and rollout reading), git and tmux any. A Tool below the highest of its needs is `behind`; its reason names each feature that doesn't work, and its `fix` is the Tool's install command from `shared/defaults.ts`. (test)
- [ ] TOOLS-2.2 Fleet is compared with Lookout's pin (`e2e/pins.json`'s `rev`), not with a version: every build prints `fleet 0.1.0`. The row shows the pin and the running build's revision, from `fleet --version` once it prints one (`fleet 0.1.0 (5e2afd8)`, a fork commit, Key decisions), else from cargo's install record (`.crates2.json` in the binary's install root, as `e2e/world/pins.ts`'s `checkPin` reads it); a build whose revision can't be read is `unknown`, with "revision unknown" and the pinned install command as its fix. A build at another revision is `behind`. (test)
- [ ] TOOLS-2.3 SIDE-6.1's box, this row and `README.md` name the same Fleet install command, at the revision pinned in `e2e/pins.json`, and a test fails when `FLEET_INSTALL_COMMAND`, the pin and the README disagree (`server/fleet-install-command.test.ts` since `bb8cf64`, which names this criterion once it's built). Lookout's minimum versions stay out of `pins.json`: it holds what the Worlds install, the table holds what Lookout needs. (test)
- [ ] TOOLS-2.4 A Tool that's missing or behind marks the Settings button in the sidebar with a dot, with the Tool's name in its tooltip ("tb-pr is missing"); `update-available` and `newer-than-known` don't. (e2e)
- [ ] TOOLS-2.5 A section whose Tool answers as one too old for it (an unknown subcommand or flag) says it's too old, never that it isn't installed: the version installed when known, the version it needs from TOOLS-2.1's table, and the Tool's update command, e.g. the Library with a tb-session that has no `events`: "tb-session 0.3.0 is older than the Library needs (0.4.0)". The same holds for History with tb-session, Work with tb-pr and tb-prod, and the usage strip with tb-jev, whose messages take their needed version from the same table. (test)

### TOOLS-3 A newer one exists

Lookout reads what the Tools' own update checks already recorded. It makes no network call of its own.

- [ ] TOOLS-3.1 tb-session, tb-pr and tb-prod print their latest release in `--version` (`tb-session 0.3.0 (latest: 0.3.1 — upgrade available)`, through `gh api` on cli-toolbox's tags, cached 24 h in `~/Library/Caches/<tool>/version-check.json`). The row's `update-available` comes from that line; `(latest)` and `(install gh to check for updates)` leave the state as it is, the latter with the reason. tb-jev's comes from its cache file alone. (test)
- [ ] TOOLS-3.2 Codex's comes from `~/.codex/version.json` (`latest_version`, `last_checked_at`, `dismissed_version`), written by Codex's own check; a `latest_version` above the installed one is `update-available` with `codex update` as the fix, and the reason says when Codex last checked. (test)
- [ ] TOOLS-3.3 Claude Code keeps no record of the latest version. The row shows what its auto-updater last did, from `~/.claude/.last-update-result.json` (`timestamp`, `outcome`, `version_from`, `version_to`): a failed one reads "auto-update failed <when>" with `claude update` as the fix; a successful one to a version other than the running one says the new version is waiting for a restart. (test)
- [ ] TOOLS-3.4 Lookout never runs an install or update command. A fix is shown in a command block to copy (DS-8.2), and the page says so once. (test)

### TOOLS-4 A Harness newer than Fleet knows

Fleet reads Claude Code's and Codex's screens and Transcripts, and keeps Claude Code's model and Effort tables by hand (VIEW, "Levels"). A Harness past the version those were checked against deserves a look, not an alarm.

- [ ] TOOLS-4.1 The table (TOOLS-2.1) also holds, per Harness, the version Fleet's tables and fixtures were last checked against: Claude Code 2.1.312 (VIEW-10's question-form captures), Codex 0.163.0. A running Harness above it is `newer-than-known`, with the reason "Fleet's model and Effort lists and its prompt reading were checked up to 2.1.312; re-check them" and no fix. The two numbers move with each Fleet pin bump, in the same change. (test)
- [ ] TOOLS-4.2 `newer-than-known` is shown in the info tone (DS-3.3), `missing` and `behind` as errors, `update-available` as a notice; the Harness rows keep working as before. (manual)

## Non-goals

- Installing, updating or removing anything. Lookout shows the command; you run it.
- Network calls of Lookout's own: no GitHub, npm or crates.io lookups. What the Tools' own checks recorded is all Lookout reads (TOOLS-3). So no "newer Fleet fork" check and no latest Claude Code version (Key decisions).
- Rewording the per-section messages (SIDE-6.1, HIST, WORK-7, USAGE) beyond TOOLS-2.5's "too old". They stay, with their own fix commands; Tools is the overview.
- The Tools' own tools: `gh` (tb-pr, tb's update check), `cargo`, `node`. If one is missing, the Tool says so itself.
- Tools on other Hosts, and pi.
- Watching for changes: a Tool updated while Lookout runs shows at the next read (TOOLS-1.4).

## UX

Settings › Tools, under the existing fields:

```
Tools
These are the CLIs Lookout runs. Lookout never installs or updates them; copy a command and run it.
Checked 2 min ago · [Refresh]

 Tool         Found at                                Version          State
 fleet        ~/Projects/fleet/target/release/fleet   0.1.0 @ 5e2afd8  ok · pinned 5e2afd8
              (LOOKOUT_FLEET_BIN)
 claude       ~/.local/bin/claude (Fleet)             2.1.314          newer than Fleet knows (2.1.312): re-check the model and Effort lists
 codex        ~/.nvm/…/bin/codex (Fleet)              0.163.0          0.164.0 is out (Codex checked 1 h ago)
                                                                       ┌──────────────────┐
                                                                       │ codex update     │
                                                                       └──────────────────┘
 tb-session   ~/.local/bin/tb-session                 0.3.0            behind · the Library needs 0.4.0
                                                                       ┌──────────────────────────────────────────────┐
                                                                       │ gh api … install.sh | bash -s -- tb-session  │
                                                                       └──────────────────────────────────────────────┘
 tb-pr        —                                       —                missing · Work reads PRs through it
                                                                       ┌──────────────────────────────────────────────┐
                                                                       │ gh api … install.sh | bash -s -- tb-pr       │
                                                                       └──────────────────────────────────────────────┘
 tb-prod      ~/.local/bin/tb-prod                    1.2.0            ok
 tb-jev       ~/.local/bin/tb-jev                     0.2.0            ok
 git          /usr/bin/git                            2.54.0           ok
 tmux         /opt/homebrew/bin/tmux                  3.6a             ok
```

- `missing` and `behind` rows are error Alerts (DS-4), `update-available` a notice, `newer-than-known` info; `ok` is plain text.
- The sidebar's Settings button carries a dot while any row is `missing` or `behind` (TOOLS-2.4).
- Loading: the rows show with "checking…" in the Version column until the first read lands. Empty: never; every Tool has a row.
- Errors: a version read that failed shows `unknown` with the reason in the State column; the row's path still shows.
- No keyboard shortcuts beyond the page's.

## Technical approach

**Sources.** One module, `server/tools.ts`, with a `ToolsMonitor` like `UsageMonitor`: reads on start and on demand (TOOLS-1.4), single-flight, cancelled on shutdown, published as one `ToolsSnapshot` over `GET /api/tools`. Each Tool is one entry in `shared/tools.ts`: `{ id, purpose, needs, versionArgv, parse }`, next to the install commands in `shared/defaults.ts`.

- **Finding.** The resolvers that exist already: `resolveFleetBin` (`server/fleet.ts`), `resolveTbSessionBin` (`server/history.ts`), `resolveWorkBin` (`server/work.ts`), `resolveJevBin` (`server/usage.ts`). `git` and `tmux` get the same shape (`PATH`, then Homebrew's `/opt/homebrew/bin` and `/usr/local/bin` for tmux, as the World finds it). `claude` and `codex` come from the cached `harness list` (LAUNCH, 10 minutes): `installed`, `command`, and the new `path` and `version`. Fleet resolves the launcher through a login shell (`check_launcher`), which the server, started without one, can't repeat, so Fleet also reads the version there (its `_probe` already runs `claude --version`, `cli/hosts.rs` `gather_probe`). A Fleet without those fields gives `unknown` with "found by Fleet; version unreadable".
- **Versions.** `fleet --version` → `fleet 0.1.0`; `tb-* --version` → `tb-pr 0.3.1 (latest)` or `(latest: X — upgrade available)` or `(install gh to check for updates)` (cli-toolbox `crates/toolbox-core/src/version_check.rs`); `claude --version` → `2.1.309 (Claude Code)`; `codex --version` → `codex-cli 0.163.0`; `git --version` → `git version 2.54.0 (Apple Git-157)`; `tmux -V` → `tmux 3.6a`; tb-jev from `status --json` (USAGE's contract; the monitor reads `UsageMonitor`'s last Jev read rather than running it again). Each version is parsed by one regex per Tool; the rest of the line is kept as text. Every run uses LAUNCH's cleaned environment, argv only, 5 s.
- **Fleet's revision.** One fork commit ([0006](../../decisions/0006-run-a-fork-of-fleet.md)): a `build.rs` puts `git rev-parse --short HEAD` into `fleet --version` (`fleet 0.1.0 (5e2afd8)`), falling back to plain `fleet 0.1.0` when built outside a git checkout, and `harness list --json` gains `path` and `version` per Harness. Lookout's pin moves to that commit. Without a revision in `--version`, cargo's install record is the fallback: `.crates2.json` in the install root of a `cargo install` (`~/.cargo` for `~/.cargo/bin/fleet`, `.cache/fleet-<rev>` for the pinned one), with the package's source `git+…?rev=<sha>#<sha>`; `checkPin` in `e2e/world/pins.ts` reads it that way, and the server reuses that reader.
- **Latest versions.** Only files and the Tools' own output: tb's `--version` line and `~/Library/Caches/<tool>/version-check.json` (`latest_version`, `checked_at`; `dirs::cache_dir()` on macOS), `~/.codex/version.json`, `~/.claude/.last-update-result.json`. Each is parsed with its fields allowlisted and strings bounded; an unreadable file is ignored, never an error. Note that `tb-* --version` itself calls `gh api` every time (`print_version` fetches fresh), so a tb read costs one GitHub call; that's why TOOLS-1.4 reads rarely and only on demand.
- **Comparing.** Semver triples for tb-*, Codex and git; Claude Code's `2.1.309` is a triple too; tmux's `3.6a` is major.minor with a patch letter, which is kept as text and never compared (tmux has no minimum). "Newer than known" (TOOLS-4) and "behind" (TOOLS-2) are the same comparison against two numbers of the table. A pre-release or unparsable version is `unknown`.
- **Nothing secret reaches the UI:** paths are tildified; reasons and version lines go through `sanitizeLine` like usage reasons; no file's contents beyond the allowlisted fields.
- **UI.** `SettingsPage` gets a Tools section (SIDE-7's page), rows as a list of `Alert`s and plain rows (DS-4), fixes in `CommandBlock` (DS-8.2), a `Refresh` button that asks `POST /api/tools/refresh` (a mutation: Origin and token). The sidebar's Settings `IconButton` takes a `dot` from the same snapshot (TOOLS-2.4), delivered on `/api/events` like usage.
- **Tests.** `(test)`: the resolvers, each parser against recorded `--version` lines (fixtures in `server/fixtures/tools/`), the comparisons, the file readers against fixture files, the snapshot's shape. `(e2e)`: a World declares its `PATH`, so "no tb-pr" is a World without it (TEST), and the Settings page and the sidebar dot are checked there; the pinned Fleet in `.cache/` has a `.crates2.json`, so TOOLS-2.2's `ok` can be seen in a World too.

Decisions that apply: [0004](../../decisions/0004-fleet-cli-as-session-layer.md) (Fleet through `--json`), [0005](../../decisions/0005-building-blocks-live-outside-lookout.md) (what Harness facts Fleet should give), [0006](../../decisions/0006-run-a-fork-of-fleet.md) (the pin), [0009](../../decisions/0009-one-design-system-guarded-by-tests.md) (Alerts and command blocks).

### Key decisions

- **Settings, not a status panel or the usage strip**: a Tool changes a few times a month and is looked at when something's wrong; the strip is for numbers that move by the hour, and a panel would be one more place to keep aligned (SIDE-8).
- **Show and copy, never run**: an install writes to `~/.cargo/bin` or `~/.local/bin`, may need a sign-in (`gh`, `tb-prod config init`) and a terminal to answer in; the per-section messages already work this way (WORK-7.1) and nobody has asked for more.
- **No network calls of Lookout's own**: tb-* check through `gh`, Codex checks itself and writes `version.json`, cargo records the pin; reading those costs nothing and can't fail noisily. Claude Code is the one Tool with no local record, so its row says what its updater last did instead (TOOLS-3.3).
- **Fleet is judged by revision against the pin, never by version**: the fork and upstream both say 0.1.0, and the pin is what Lookout's tests ran against ([0006](../../decisions/0006-run-a-fork-of-fleet.md)).
- **The needs table lives in Lookout, not Fleet**: these are Lookout's requirements on its Tools; Fleet's `harness list` stays facts about the Harness ([0005](../../decisions/0005-building-blocks-live-outside-lookout.md)).
- **A Harness newer than Fleet's tables is information, not a problem**: Fleet keeps working on it (VIEW's Known gaps: a level a model lacks is clamped, one wrong row), so the row asks for a re-check and marks nothing red.
- **tb-jev is never run with `--version`**: USAGE's rule stands (it runs only `status --json`); its cache file is enough.
- **The per-section messages stay**: they're where the problem bites and already carry the fix; Tools is the overview, so neither has to link to the other. They change only to say "too old" instead of "not installed" (TOOLS-2.5).

Answered by Dario on 2026-10-30, all as recommended:

- **Fleet's revision comes from a fork commit**: `fleet --version` prints the revision it was built from, and `harness list --json` gives Claude Code's and Codex's path and version from where Fleet finds them (TOOLS-2.2, TOOLS-1.2).
- **Lookout runs `tb-* --version`**, on start and on demand at most once a minute, never on a timer, though each run costs one `gh api` call (TOOLS-1.4).
- **No latest Claude Code version**: the row shows what its auto-updater last did (TOOLS-3.3). Its updater worked on 2026-10-30 (2.1.312 to 2.1.314); revisit if it keeps failing.
- **A dot on the Settings button for `missing` and `behind` only** (TOOLS-2.4).
- **Minimum versions stay out of `e2e/pins.json`**; a test keeps the Fleet install command, the pin and the README together (TOOLS-2.3).
- **A Tool that's too old says so where it bites**, never "not installed" (TOOLS-2.5).

## Known gaps

- A Fleet built with uncommitted changes prints the revision it started from, so it reads as that revision.
- Until the pin moves to the fork commit, the live server's `cargo build` of Fleet prints no revision and leaves no cargo record, so its row reads `unknown`.
- tb-prod's latest release (1.1.1) is older than the build from `main` Work needs (1.2.0); its `--version` says `(latest)`, which the row shows as `ok`. Right by accident: no release is newer.
- `~/.claude/.last-update-result.json` and `~/.codex/version.json` are undocumented files; a shape change makes the row go quiet, not wrong.
- A version is read at most once a minute, so a Tool updated in a terminal shows after Refresh or the next open.

## Open questions

None. The five draft questions and a sixth were answered on 2026-10-30 (Key decisions).

## Changelog

- 2026-10-23: Created from the Backlog entry and Plan item 4, after checking each Tool's `--version` and `--help`, cli-toolbox's `version_check.rs`, Fleet's `harness list` and `_probe`, cargo's install records and the Codex and Claude Code update files on this Mac.
- 2026-10-30: Ready. Dario answered all five open questions as recommended, and a sixth, from the Library saying "install tb-session" when 0.3 was installed: TOOLS-2.5, a section says its Tool is too old rather than missing. TOOLS-2.1 needs per feature (tb-session 0.4.0 for the Library); TOOLS-2.2 and 1.2 from the Fleet fork commit (revision in `--version`, Harness path and version in `harness list`); TOOLS-2.3 reworded, since `bb8cf64` already tests the install command against the pin and the README; TOOLS-4.1 checked against Claude Code 2.1.312. The UX mock-up and Known gaps follow.
