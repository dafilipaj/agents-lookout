# Contract: Fleet's revision in `fleet --version`, and each Harness's path and version in `fleet harness list`

What the Fleet fork (`dafilipaj/fleet`, branch `lookout`, [0006](../decisions/0006-run-a-fork-of-fleet.md)) adds so Settings › Tools ([TOOLS](../features/tools/SPEC.md)) can judge Fleet by the revision it was built from (TOOLS-2.2) and say where Claude Code and Codex are and which version each is (TOOLS-1.2, TOOLS-1.3). It's built in the fork as one commit and verified there, in Fleet's own tests; Lookout's fake `fleet` (`server/fixtures/fleet/messages/fake-fleet.mjs`) follows this file, and `pnpm req-check` never looks here (the criteria are TOOLS-1.2, 1.3 and 2.2). Points are numbered F1 to F4 so the commit's tests can cite them. Every field is add-only: a later Fleet may add, never rename or drop.

Written 2026-10-30, while the commit is built in parallel, against the fork at `5e2afd8` (Lookout's pin in `e2e/pins.json`), which prints plain `fleet 0.1.0` and lists Harnesses without `path` or `version`. Lookout's side is built against this file and the fake; the pin moves to the commit once it is reviewed and pushed, and with it TOOLS-4.1's numbers if its fixtures moved. Built and pushed as fork commit `2b23eda`, Lookout's pin since 2026-10-30.

## Why

- Every build of Fleet prints `fleet 0.1.0`: the fork and upstream (`ilucin/fleet` at 38a461c, still on `PATH` on Dario's Mac on 2026-10-23) alike, so `--version` can't say which one runs. Cargo's install record (`.crates2.json`) says it only for a `cargo install`; a `cargo build` in a checkout, which the live server runs (`LOOKOUT_FLEET_BIN`), leaves none.
- Fleet finds `claude` and `codex` through a login shell (`check_launcher`), which Lookout's server, started without one, can't repeat; and Fleet's `_probe` already runs `claude --version` there (`cli/hosts.rs`, `gather_probe`). So where each Harness is, and its version, are facts about the Harness that Fleet already holds ([0005](../decisions/0005-building-blocks-live-outside-lookout.md)). What Lookout needs of them stays in Lookout (TOOLS-2.1's table).

## F1. `fleet --version` names the revision

```
$ fleet --version
fleet 0.1.0 (5e2afd8)
```

- The crate's version, then the short revision of the commit it was built from, 7 lowercase hex characters, in parentheses: what `git rev-parse --short=7 HEAD` gives at build time (a `build.rs`).
- Built where git can't answer (a source tarball, no `.git`), it prints plain `fleet 0.1.0`, as today.
- One line on stdout, exit 0, nothing on stderr. The rest of clap's `--version` behaviour stays.
- Lookout reads it with `/^fleet (\S+)(?: \(([0-9a-f]{7,40})\))?$/` and compares the revision with the pin's `rev` by its first 7 characters (TOOLS-2.2). Without a revision it falls back to cargo's `.crates2.json` in the binary's install root (`<root>/bin/fleet` → `<root>/.crates2.json`, the source's `#<sha>`), as `e2e/world/pins.ts`'s `checkPin` reads it (`server/cargo-record.ts`); without either, the row is `unknown`, "revision unknown".

## F2. `fleet harness list --json` gives each Harness's path and version

Each element gains two fields, beside `id`, `label`, `command`, `installed` and `models`:

```json
[
  { "id": "claude", "label": "Claude Code", "command": "claude", "installed": true,
    "path": "/Users/me/.local/bin/claude", "version": "2.1.314 (Claude Code)", "models": [ … ] },
  { "id": "codex", "label": "Codex", "command": "codex", "installed": true,
    "path": "/Users/me/.nvm/versions/node/v24.22.1/bin/codex", "version": "codex-cli 0.164.0", "models": [ … ] }
]
```

- `path`: the absolute path the login-shell lookup resolved the launcher to, or `null` when it found none (`installed: false`) or the launcher isn't a file (a shell function or alias that can't be resolved to one).
- `version`: the first line of `<path> --version`, as the Harness prints it (today `2.1.314 (Claude Code)` and `codex-cli 0.164.0`), or `null` when it can't be read (no `path`, the run fails or prints nothing). Fleet doesn't parse it.
- Both come from where Fleet already resolves the launcher (its login-shell lookup); pi gets the same two fields, and Lookout drops pi.

## F3. A Fleet without them

- A Fleet older than `2b23eda` has neither. Lookout treats a missing field as `null`: a Harness Fleet lists as installed without a `version` is `unknown`, with "found by Fleet; version unreadable" (TOOLS-1.2), and its path is blank when `path` is missing. A `fleet --version` without a revision falls back as F1 says.
- `path` must be absolute; anything else Lookout reads as `null`. `version` is cut and redacted like any line a Tool prints (TOOLS-1.3).

## F4. Tests in the fork

- F1: the `build.rs` output with a git checkout (the short revision) and without one (plain), and `--version` printing each.
- F2: through the fake login shell `harness list`'s tests already use: an installed launcher with a version, one whose `--version` fails (`version: null`), and one that isn't installed (`path: null`, `version: null`).
