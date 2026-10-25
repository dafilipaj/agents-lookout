---
title: Behaviour tests
code: TEST
status: In Progress
created: 2026-10-17
updated: 2026-10-19
---

# Behaviour tests

## Summary

Every acceptance criterion tagged `(e2e)` gets a Behaviour test. The test drives the built Lookout in Chromium, inside a World: a temporary HOME, a PATH holding only the commands the test declares, a private tmux server, the real Fleet fork and tb-session, and Fake Harnesses in place of Claude Code and Codex. `pnpm req-check` keeps the specs and the tests in step, and both run in a pre-push hook. This implements [0007](../../decisions/0007-behaviour-tests-from-spec-requirements.md).

## Problem

- Each test runs one layer against fakes of Fleet, tb-session and tb-jev. No test runs Lookout with the real Fleet, so drift between Lookout and the fork is caught only by hand, in the running app.
- 32 test files hold about 490 tests, and about 350 of their titles start with a criterion id. Nothing checks that link: a ticked criterion could lose its test, and a test can name an id that no longer exists.
- 36 of the 108 acceptance criteria in the specs are tagged `(manual)`, 30 of them ticked. Many of them, such as SIDE-1.1 "a Session appears within 3 s", are behaviours a World could check on every push.
- A behaviour like "Codex usage when the Codex CLI isn't installed" can't be stated or checked today without uninstalling Codex. Writing it down raised whether Codex should be hidden instead; USAGE-2.2 stands as written ("Codex: not installed" is shown), and hiding an unused Harness is in the Backlog.

## Requirements

### TEST-1 The World

What a Behaviour test runs in. A World is built fresh for each Behaviour test and torn down after it; two Behaviour tests never share one.

- [x] TEST-1.1 When a Behaviour test starts, its World has its own temporary HOME, its own settings file, a private tmux server and a Lookout server on a free port. That port is never 4747 or 4748. Nothing from the user's HOME, tmux server, keychain or settings is visible to Lookout, Fleet, tb-session or the Fake Harnesses. (test)
- [ ] TEST-1.2 PATH holds only what the World declares:
  - **real:** Fleet, tb-session, tmux (through a shim to the private `-L` server), git, ps for discovery (through the shim of TEST-1.10; memory sampling is faked, MEM-2.1), lsof, sh, node, and the plain system tools these need;
  - **fake:** claude, codex, tb-jev, curl, tb-prod and tb-pr, each only when declared; the memory sampler’s `ps` and `sysctl`, always injected with deterministic defaults or a `.memory()` declaration (MEM);
  - **absent:** security, gh, ssh and osascript.

  A command the World doesn't declare can't be found, also not through Fleet's fallback directories (`/opt/homebrew/bin`, `/usr/local/bin`). (test)
- [x] TEST-1.3 Fleet and tb-session are the real binaries at the versions pinned in `e2e/pins.json`. `pnpm e2e:setup` installs them into `.cache/`, never over the user's own binaries. When a binary doesn't match its pin, the run stops before the first test and says which pin it expected and the command that gets it. Until tb-session 0.3.0 is released, its pin is the commit of its 0.3.0 branch. (test)
- [ ] TEST-1.4 Fake Harnesses stand in for Claude Code and Codex. They run in the World's tmux, register and write Transcripts the way the real ones do, and draw the screens Fleet reads. With them, the real Fleet can list, read `messages` from, `send` to, `answer`, `peek` and `close` them, and real tb-session can index their Transcripts. Their Transcript lines come only from fixtures recorded from a named Harness version (TEST-6). (test)
- [ ] TEST-1.5 A Behaviour test declares its World in code, with a builder that starts empty. A World can contain:
  - Harnesses present or absent;
  - live Sessions, each with Harness, Status, working directory and Transcript;
  - git repos and Worktrees;
  - a global git identity: `user.name` and `user.email` in `~/.gitconfig`;
  - past Sessions for History;
  - Claude and Codex usage numbers;
  - Jev's state;
  - tb-prod's Tasks for each assignee email and tb-pr's PR board, or their failures (WORK);
  - Settings.

  Anything the test doesn't declare is absent. `.without('codex')` removes both the Codex CLI and `~/.codex`, so Fleet's `harness list` and `usage` both say "not installed". (test)
- [ ] TEST-1.6 A Behaviour test can change its World while it runs, as a Harness or the user would: a Session turns Busy, asks a question, replies, or exits; a new Session starts outside Lookout; a Codex turn records new limits. It can also change what the fake `tb-prod` or `tb-pr` answers from its next call on, and hold one of their calls in flight until the test releases it. (test)
- [ ] TEST-1.7 Nothing in a World reaches the network or a real account. The fake `curl` answers only Anthropic's usage endpoint, with the numbers (or the 401, 429 or timeout) the World declares, using fake credentials in the World's HOME. Any other request fails the Behaviour test and names the URL. Chromium doesn't reach it either: the World aborts every request its pages make, popups and new tabs included, outside the World's own Lookout origin, and records each one's URL for the test to check. A request outside it that gets past the World, such as the next hop of a redirect, fails the Behaviour test and names the URL. (test)
- [x] TEST-1.8 After each Behaviour test, whether it passed, failed or timed out, its tmux server, Lookout server, Fake Harnesses and temporary directories are gone. A run that leaves any of them behind fails and names what it left. (test)
- [ ] TEST-1.9 A guard test proves the isolation, as the Fleet fork's `tests/isolation.rs` does. It listens on the default tmux socket inside the World's `TMUX_TMPDIR`, runs a scenario that lists, starts and closes a Session, and fails if anything knocked on that socket or read outside the World's HOME. (test)
- [ ] TEST-1.10 Processes outside the World are invisible to it. With Codex declared and a real Codex TUI running on the machine, Fleet lists only the World's Sessions. (test)

### TEST-2 Running Behaviour tests

- [x] TEST-2.1 `pnpm e2e` builds the UI when `dist/web` is older than the sources, then runs every Behaviour test with Playwright in headless Chromium at 1440×900, against the built Lookout (`NODE_ENV=production`). `pnpm e2e <filter>` runs the matching ones. (manual)
- [x] TEST-2.2 A Behaviour test is written as `scenario('<ID>: <what holds>', world, fn)`. Its title starts with the criterion id, as unit test titles already do. (test)
- [ ] TEST-2.3 Behaviour tests run in parallel, each in its own World, and give the same result in any order. (test)
- [ ] TEST-2.4 When a Behaviour test fails, its report holds:
  - the Playwright trace and a screenshot;
  - the Lookout server's log;
  - the argv of every Fleet, tb-session and fake call;
  - the last screen of every tmux pane in its World;
  - the World's declaration, and each answer the test gave the fake `tb-prod` and `tb-pr`, in order (TEST-1.6).

  That's enough to understand the failure without rerunning it. (manual)
- [ ] TEST-2.5 On this Mac the whole Behaviour suite takes at most 3 min, and a World starts in under 3 s. Each run prints both. Over budget, the slowest Behaviour tests get looked at before more are added. (manual)
- [x] TEST-2.6 A Behaviour test that runs past 30 s fails, naming what it was waiting for. (test)
- [ ] TEST-2.7 The first Behaviour tests prove the World end to end, each one testing one of the World's abilities:
  - USAGE-2.2: with Codex absent, the usage strip shows "Codex: not installed";
  - SIDE-6.1: Fleet not installed;
  - SIDE-1.1 and SIDE-1.2: a Session appears and disappears;
  - LAUNCH-4.2 and LAUNCH-4.6: Start selects the "Starting…" row and shows the starting view, and the Session takes over once Fleet reports it from a Fake Harness;
  - VIEW: a message is sent and the reply shows;
  - HIST: a past Session is found and resumed.

  All of them pass. (test)

### TEST-3 Requirement check

- [x] TEST-3.1 `pnpm req-check` reads every acceptance criterion in `docs/features/*/SPEC.md`: its id, its tag (`(test)`, `(e2e)` or `(manual)`), whether it's ticked, and whether it's struck through. It reads every test title from the runners' own listings: Vitest's collection of the test files, which loads them without running a test (as `vitest list --no-static-parse` does), and `playwright test --list`. (test)
- [x] TEST-3.2 It fails when a ticked `(test)` criterion has no test of any kind naming its id. (test)
- [x] TEST-3.3 It fails when a ticked `(e2e)` criterion has no Behaviour test naming its id. (test)
- [x] TEST-3.4 It fails when a test names an id that no spec has, or one that is struck through. Only codes in `docs/features/README.md` count as ids, so `UTF-8` isn't one. A requirement id such as `SIDE-5` is valid in a `describe` title. (test)
- [x] TEST-3.5 Everything else is information, never a failure: a `(manual)` criterion that a test names, an unticked criterion that already has tests, and an unticked `(test)` or `(e2e)` criterion without tests. It lists the first two. (test)
- [x] TEST-3.6 It prints, per feature, each criterion with its tag, tick and the tests naming it, followed by the violations. `--feature <CODE>` narrows the output for a review, `--json` prints it machine-readable, and the exit code is 0 or 1. (test)
- [x] TEST-3.7 It finishes within 10 s and starts no World. (manual)

### TEST-4 Before each push

- [ ] TEST-4.1 A pre-push hook, versioned in the repo as `.githooks/pre-push`, runs `pnpm req-check`, `pnpm test` and `pnpm e2e` in that order, and stops the push at the first failure. (manual)
- [x] TEST-4.2 `pnpm install` sets `core.hooksPath` to `.githooks`, so a fresh clone or Worktree has the hook without a manual step. (manual)
- [ ] TEST-4.3 A missing prerequisite (tmux, a pinned binary, Playwright's Chromium) fails the hook with the command that fixes it; it's never skipped silently. The only way to skip the hook is `git push --no-verify`. (manual)

### TEST-5 Working with Behaviour tests

- [x] TEST-5.1 `docs/README.md` (writing rule 2, Working with Claude) and `AGENTS.md` describe the three criterion tags, when a criterion is `(e2e)`, and the order of work: write the Behaviour test from the criterion first, then the code. The reviewer checks the criterion-to-test mapping with `pnpm req-check --feature <CODE>`. (manual)

### TEST-6 Recording Transcripts

How the Fake Harnesses' Transcripts stay true to the real ones.

- [ ] TEST-6.1 `pnpm e2e:record <claude|codex>` runs the installed real Harness once through a short fixed script (a reply, a tool call, a permission question), and writes its Transcript as fixtures named with the Harness version, for example `e2e/fixtures/transcripts/claude/2.1.170/`. It shows how the new fixtures differ from the previous ones. (manual)
- [ ] TEST-6.2 Recorded fixtures are sanitized before they're written: no home path, user name, email, host name, token or real Session id remains. A fixture that still holds one fails `pnpm test`. (test)
- [ ] TEST-6.3 `pnpm e2e:record` is the only command that runs a real Harness. It never runs in the pre-push hook or in `pnpm e2e`. (test)

## Non-goals

- Running a real Claude Code or Codex anywhere but `pnpm e2e:record`, which is run by hand. They cost money, are slow and don't answer the same way twice.
- Any network call or real account in a World: Anthropic's usage endpoint, Typesafe, GitHub, Productive.
- CI. The pre-push hook is the only gate; revisit if anyone else starts pushing.
- Writing Behaviour tests for every existing criterion now, or retagging every `(manual)` criterion now. They come gradually, when each feature is next worked on, as [0007](../../decisions/0007-behaviour-tests-from-spec-requirements.md) says.
- Replacing the Vitest unit and component tests. Edge cases stay there.
- Changing USAGE: hiding a Harness you don't use is a Backlog idea, not part of this feature.
- Declaring Codex's CLI and `~/.codex` separately in a World.
- A Fleet option that limits process discovery to one tmux server. It comes only if the `ps` shim gets complicated.
- Sharing a World between Behaviour tests.
- The iTerm2 backend (ITERM). It needs a GUI app and `osascript`, which a World can't isolate.
- Browsers other than Chromium, and viewports other than 1440×900. SIDE-2.5 (280 px) and other layout criteria stay `(manual)`.
- Screenshot comparison and visual regression.
- Testing Fleet or tb-session themselves. Their own suites do that; a World checks how Lookout uses them.
- Gherkin `.feature` files (rejected in 0007).
- Performance and load testing.
- Linux. Lookout and the World target this Mac.

## UX

For a developer and an agent, not for the app's user.

```
$ pnpm req-check --feature USAGE
USAGE  Usage at a glance (In Progress)
  ✓ USAGE-1.1 (test)    ticked   UsageStrip.test.tsx ×3
  ✓ USAGE-1.3 (manual)  ticked   usage.test.ts ×1 (info: manual, tested anyway)
  ✗ USAGE-2.2 (e2e)     ticked   no Behaviour test
1 violation. See docs/features/behaviour-tests/SPEC.md (TEST-3).

$ pnpm e2e usage
  ✓ USAGE-2.2: Codex usage says "not installed" when Codex is not installed (4.1 s)
  1 passed (6.3 s) · World start 1.4 s (max 1.4 s)
```

A failed Behaviour test leaves its report in `e2e/.report/` (git-ignored), with the trace and the World's logs (TEST-2.4). `pnpm e2e --report` opens it.

## Technical approach

### What the codebase says (2026-10-17, `main` 6b2b77c; Fleet fork `lookout` ce2bbe1)

- **How Lookout finds its tools:**
  - Fleet: `LOOKOUT_FLEET_BIN`, then PATH, then `$CARGO_HOME/bin` or `~/.cargo/bin` (`server/fleet.ts`).
  - tb-session: `LOOKOUT_TB_SESSION_BIN`, then PATH, then `~/.local/bin` (`server/history.ts`).
  - tb-jev: PATH, then `~/.local/bin`, with no override (`server/usage.ts`).
  - `git -C` (`server/git.ts`) and `tmux capture-pane` for a stuck start (`server/launcher.ts`) come from PATH.
  - `LOOKOUT_PORT` may be 0–65535, written in digits only; anything else, an empty value included, stops the server at startup. With 0 the OS picks a free port; the server prints the port it bound (`Lookout server on http://127.0.0.1:<port>`) and builds the Host and Origin allow-lists from it. A World uses 0 (changed for TEST-1.1: picking a free port first and passing it races with every other process).
  - Settings come from `LOOKOUT_SETTINGS` and the token from `LOOKOUT_TOKEN`. `NODE_ENV=production` serves `dist/web`.
- **How Fleet finds things** (the fork's `core/tools.rs`, `core/harness.rs`, `core/usage*.rs`, `core/discovery.rs`):
  - **Binaries:** `find_binary` looks on PATH, then always in `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.cargo/bin` and `~/bin`. A Harness counts as installed in `harness list` when its launcher's first word resolves that way, or when the launcher is an absolute path to an executable. pi's model list runs `pi --list-models --offline` when pi resolves.
  - **PATH-only mode** (from `ad63005`, the World's pin since 2026-10-19): with `FLEET_PATH_ONLY=1` Fleet finds binaries on PATH alone, with no fallback directories, no hard-coded install locations (`~/.claude/local`, Tailscale.app) and no login-shell probe of a launcher. It refuses, as a usage error, `web serve` and the service installs, any other host, the iTerm backend, a local `exec` or `ssh`, and a PATH that is unset, empty or holds a relative or empty entry. Panes it opens get its PATH and `FLEET_PATH_ONLY=1` through `tmux -e`, and run the tmux server's `default-shell`. Explicit binaries (the overrides below) still win.
  - **Binary overrides,** read before the fallback directories: `FLEET_TMUX` (or config `tmux`), `FLEET_CMD` (Claude Code's launcher), `FLEET_GH` (or config `gh`), `FLEET_NODE` (or config `web.node`), `FLEET_BIN` (or config `fleetBin`), and config `harnesses.<codex|pi>.command`. `tools::claude()`, used by naming and by `check_launcher` for a bare `claude`, has none.
  - **Launchers:** Claude Code's comes from `FLEET_CMD`, then config `claude`; Codex's from config `harnesses.codex.command`.
  - **Codex usage:** `not_installed` means `$CODEX_HOME` (default `~/.codex`) isn't a directory. It says nothing about the CLI, which is why `.without('codex')` removes both.
  - **Claude usage:**
    - Credentials come from `security find-generic-password -s "Claude Code-credentials"`, else from `~/.claude/.credentials.json`.
    - Fleet then runs `curl` against `https://api.anthropic.com/api/oauth/usage`.
    - The result is cached in `~/.claude/fleet-usage.json` for 60 s, and Fleet backs off after a failure.
  - **Claude Sessions** come from the registry `~/.claude/sessions/<pid>.json`. Its `procStart` must match `ps -o lstart` in UTC.
  - **Codex Sessions:**
    - Fleet finds them with a machine-wide `ps -axww`, keeping the processes whose `argv[0]` basename is `codex`, and only when `$CODEX_HOME` exists. In a World with Codex, the user's own Codex TUIs would be listed too (TEST-1.10).
    - Their working directory comes from `lsof`, and each is paired with a rollout in `$CODEX_HOME/sessions/`.
  - **Starting a Session:** `spawn` types the launcher into `$SHELL -l`, or into tmux's `default-command`.
  - **iTerm2** is read through `osascript`.
- **Fleet's own end-to-end tests already build a small World** (`crates/fleet/tests/common/mod.rs`):
  - The environment:
    - a temporary `HOME`;
    - `FLEET_TMUX` pointing to a wrapper that runs `tmux -L fleet-test-<rand>`;
    - a `TMUX_TMPDIR` under `/tmp`, because a socket path is limited to about 104 bytes;
    - `FLEET_CONFIG`, `FLEET_SNAPSHOT` and `FLEET_LOCK_DIR` in the temporary directory, and `FLEET_MUX=0`;
    - an `UNSET` list of overrides cleared: `TMUX`, `TMUX_PANE`, `XDG_*`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `FLEET_*`.
  - Fake agents are shell scripts in panes that write a registry entry with their real `procStart`.
  - `tests/usage.rs` puts a fake `security` on PATH, and `tests/isolation.rs` sets a trap on the default socket.
- **Lookout's current fakes:**
  - `server/fixtures/fleet/messages/fake-fleet.mjs` and `server/fixtures/tb-session/fake-tb-session.mjs` replace the binaries in four server tests, and log each call's argv.
  - Web tests use a stub client (`web/src/test/helpers.tsx`).
  - No test starts a real Fleet, tmux or browser.
- **Spec criteria today** (108, TEST's own left out):
  - `(test)`: 62 ticked, 10 open (8 in Parked PORTS, 2 in VIEW). Every ticked one already has a test naming it.
  - `(manual)`: 30 ticked, 6 open. 23 of them are named by unit tests anyway.
  - No `(e2e)` criterion exists yet.
  - A naive id regex would flag `UTF-8`, and the requirement ids `SIDE-5`, `HIST-1` to `HIST-3` used in `describe` titles.
- **On this Mac:**
  - tmux 3.6a is in `/opt/homebrew/bin`, and `codex` is in nvm's bin, not in a fallback directory.
  - tb-session 0.3.0 is installed, the release HIST is built against (tag `tb-session-v0.3.0`, 2026-10-20).
  - Playwright's Chromium 1243 is cached, but Playwright isn't a dependency yet.
  - The repo has no CI and no hooks.

### Layout

```
e2e/
  playwright.config.ts   headless Chromium, 1440×900, 30 s budget per test, workers ≈ half the cores
  run.ts                 pnpm e2e: waits for another run in the same checkout, builds a stale UI, then runs Playwright
  setup.ts               pnpm e2e:setup: installs the pins into .cache/, and Playwright's Chromium
  global-setup.ts        stops the run before the first test when a pin, tmux or the UI is missing
  world/                 the World builder (TypeScript): env, PATH, shims, Fleet config, Lookout server, teardown
  selftest/              runs that the World's own tests start, interrupt or time out (never run alone)
  fakes/                 claude, codex, tb-jev, curl, tb-prod.ts, tb-pr.ts: scripts node runs; control.ts: how a test steers them; tb-prod-filter.ts: tb-prod's filter check
  shims/                 tmux, ps, `logged` (Fleet's and tb-session's argv into the calls log) and `fake` (a fake's)
  fixtures/              transcripts/{claude,codex}/<version>/*.jsonl, usage/*.json, history/*.json
  scenarios/<feature>/*.e2e.ts
  record/                the recorder behind pnpm e2e:record (TEST-6)
  pins.json              Fleet fork revision, tb-session revision
  .report/               the HTML report with failed tests' reports (git-ignored)
  .results/              Playwright's traces, screenshots and attachments (git-ignored)
scripts/req-check.mjs
.githooks/pre-push
.cache/                  pinned Fleet and tb-session; e2e/runs/: each run's index of Worlds; e2e/run.lock (git-ignored)
```

`e2e/` sits outside Vitest's globs (`server/**/*.test.ts`, `web/src/**`), and apart from `server/fixtures/`, whose fake Fleet and tb-session a World doesn't use.

### A World, built for each Behaviour test

1. **Directories:**
   - a temporary root `$TMPDIR/lookout-world-<id>` with `home/`, `bin/`, `logs/` and `work/`;
   - `TMUX_TMPDIR` at `/tmp/lw-<id>`;
   - `home/Projects/work`, which is the default Start directory.
2. **`bin/`:**
   - **Real tools:** symlinks to git, lsof, sh, node and the plain system tools they need: `bash`, `env`, `hostname`, `sleep`, `cat`, `date`, `echo`, `uname` and `id` (`REAL_TOOLS` in `e2e/world/runtime.ts`).
   - **Fleet and tb-session:** a `logged` wrapper each, which appends its argv to `logs/calls.log` (TEST-2.4) and runs the pinned binary from `.cache/` under the wrapper's own path. The wrapper sets `FLEET_PATH_ONLY=1` itself, so a caller that drops it still gets a PATH-only Fleet. `LOOKOUT_FLEET_BIN` and `LOOKOUT_TB_SESSION_BIN` point at the wrappers; `.without('fleet')` leaves out both the wrapper and the variable.
   - **tmux shim:** `exec <real tmux> -L lookout-world-<rand> -f /dev/null "$@"`. Lookout and Fleet both reach the private server through it.
   - **ps shim:** passes every call through to `/bin/ps`, except that a machine-wide listing (`-ax`, `-e`) keeps only processes whose tty belongs to a pane of the World's tmux server, and their descendants. This keeps the user's own Codex TUIs out of Fleet's discovery (TEST-1.10).
   - **sysctl shim:** memory-key reads always reach MEM’s strict fake; unrelated calls, including login-shell startup’s `sysctl -n kern.boottime`, pass through to `/usr/sbin/sysctl` with their arguments, output and exit status preserved.
   - **Fakes:** the declared ones among claude, codex, tb-jev, curl, tb-prod and tb-pr. `.usage({ claude, codex, jev })` supplies dock-layout readings through a strict `tb-jev status --json` fake and a Fleet-wrapper answer for only `--local usage --json`; every other Fleet call stays real.
   - **Kept out:** `security`, `gh`, `ssh` and `osascript`.
3. **Fleet config** (`FLEET_CONFIG`) only turns naming, grouping and stacks off, since each would run `claude -p`. Every Fleet the World runs has `FLEET_PATH_ONLY=1` (step 4, and the `logged` wrapper sets it itself), so the launchers stay Fleet's defaults (`claude`, `codex`, `pi`), as do `tmux` and `gh`: each is found on the World's PATH or not at all. A Harness is installed exactly when the World puts its fake in `bin/`; no per-binary override is needed to keep Fleet out of `/opt/homebrew/bin` or `/usr/local/bin`.
4. **Environment for the Lookout server and everything it starts:**
   - `LOOKOUT_WORLD_ID=<token>`: the World's id and random bytes, a value only that World has. Every process the World starts inherits it and passes it on; it is what makes a process the World's (step 7);
   - `HOME`, `PATH=<world>/bin` and `SHELL=/bin/sh`;
   - `LOOKOUT_PORT=0`, `LOOKOUT_TOKEN`, `LOOKOUT_SETTINGS`, `LOOKOUT_FLEET_BIN` and `LOOKOUT_TB_SESSION_BIN` (the pinned binaries), and `NODE_ENV=production`;
   - `FLEET_CONFIG`, `TMUX_TMPDIR`, `FLEET_SNAPSHOT`, `FLEET_LOCK_DIR`, `FLEET_MUX=0` and `NO_COLOR=1`;
   - `FLEET_PATH_ONLY=1`, and none of Fleet's binary overrides (`FLEET_TMUX`, `FLEET_CMD`, `FLEET_GH`, `FLEET_NODE`, `FLEET_BIN`): Fleet finds the tmux shim, the wrapper and the fakes on PATH;
   - Fleet's `UNSET` list removed.
   - `~/.profile` sets PATH back to `bin/`: a login shell (a tmux pane, a spawned pane's `$SHELL -l`) reads it after `/etc/profile`.
5. **Fixtures:** the declared Sessions, Transcripts, repos, usage and History are written into `home/` and `work/`. A declared Claude usage also writes fake credentials to `home/.claude/.credentials.json`, and a declared git identity writes `home/.gitconfig`. Live Sessions are started as Fake Harnesses in the private tmux server, and the World waits until Fleet lists them.
6. **Start:**
   - before anything of it exists, the World is written into its run's index, `.cache/e2e/runs/<run>/worlds/<id>.json` (its token, root, `TMUX_TMPDIR` and the test's title), so an interrupted run can still be swept. The entry, then the root, then `TMUX_TMPDIR` are each created exclusively; an id whose entry or directory already exists is someone else's, so what was made for it is removed again and the World takes another id. Each directory is added to the entry's `owns` as soon as it is made: teardown and sweeps remove only those, and `kill-server` goes only to a socket in a `TMUX_TMPDIR` the World made;
   - every process the World starts gets a process group of its own, so that a timeout can end a command and whatever it started while the World still holds it;
   - the private tmux server starts empty, with `exit-empty off`, from the World's environment (so a pane gets the World's PATH and `FLEET_PATH_ONLY`) and with `default-shell` set to the World's `SHELL`: every pane, whoever opens it, runs that shell, never the account's login shell. It daemonizes, the one World process allowed to; the World keeps the pid it reports;
   - a trap listens on the default socket in `TMUX_TMPDIR` for the whole test (TEST-1.9);
   - the World starts `node server/main.ts --lookout-world-<id>` with `LOOKOUT_PORT=0`, with `HOME` as its working directory, reads the port from the line the server prints, refuses 4747 and 4748, and checks that `/api/bootstrap` answers with the World's own token before Chromium opens. It records how long the start took (TEST-2.5) and hands Playwright the URL;
   - the test's browser context routes every request: the World's Lookout origin passes, and anything else is aborted and its URL recorded (TEST-1.7). A context route covers popups and new tabs, so a link that opens GitHub or Fantastic shows its URL without loading it. WebSockets, which a route doesn't see, are refused the same way. A route sees only a redirect's first URL, and a page's own route goes before it, so the context also watches every request the browser issues: one outside the origin that the route didn't abort fails the Behaviour test (TEST-1.7). Service workers, whose requests aren't routed, are blocked. Should a request get past all that, Chromium has no way out: everything but loopback goes to a proxy nothing listens on (`127.0.0.1:9`), and no host but `127.0.0.1` and `localhost` resolves. WebRTC's UDP uses neither, which Lookout doesn't use;
   - the start can be cancelled (SIGINT or SIGTERM in the worker): whatever was started is torn down, and the worker waits for that teardown before it exits. Playwright never tears down a fixture that hadn't reached `use()`.
7. **Teardown:**
   - on failure, read the failure report first (TEST-2.4): the declaration, each fake's answers as the test set them, the server log, the calls log and every pane's last screen, attached to the Playwright report. A test is failing too when a fake refused a call or a request got past the browser guard;
   - the calls the fakes refused are read once every process of the World is gone and before its directories go, so a call Lookout made while it stopped still fails the test (TEST-1.5). When there are any and no report was read, the report is read then, before the directories go, with no panes left to show (TEST-2.4);
   - a process is the World's when its environment carries the World's token, as `ps -E` shows the environment a process started with; or when its parent is the World's, since macOS hides the environment of its own binaries (`/bin/sh`, `/bin/sleep`, `/usr/bin/git`, `/bin/ps`, `/usr/sbin/lsof`) from `ps -E` though they inherit it like any other; or when it was seen as the World's before and still has the same pid and start time. `ps -E` prints arguments and environment on one line, so the environment is what follows the arguments `ps` prints without `-E`; a token in the arguments doesn't count. Nothing else makes a process the World's: not a process group, not a recorded pid, not a command line;
   - a process the World started and lost sight of before it ever saw it is out of reach: an Apple binary whose parent exited at once, such as `sh -c 'sleep 60 &'`. Fake Harnesses, Fleet, tb-session, tmux and the Lookout server are not Apple binaries and always carry the token;
   - known gap (TEST-1.8): the processes a World has seen are remembered only by the teardown that saw them, never in the index, and every sweep starts without them: the worker's exit sweep after a teardown that ran out of time, and the next run's sweep after an interrupted one. So an Apple binary that lost its parent after it was seen is missed there, and its directories go without it being named. Also, a run killed between creating a World's directory and recording it in `owns` (or an entry from before `owns`) leaves that directory behind, logged but not removed;
   - signals go to one pid at a time, after its start time is read again; only a child the World spawned and still holds (the Lookout server, a command still running) is signalled as a whole group;
   - SIGTERM to the Lookout server's group, `tmux -S <socket> kill-server`, then SIGTERM to the rest; one still running after 3 s gets SIGKILL and is named, and the test fails (TEST-1.8);
   - a World process that daemonized away from the World (handed to launchd as the leader of its own group, as a `setsid` helper is), other than the tmux server, is named and killed with the rest. A process with no token, like a developer's `tail -f` of the World's log, is never touched;
   - the root, `TMUX_TMPDIR` and the index entry go once none of the World's processes is left; while one still runs after SIGKILL, they stay, it is named, and global teardown sweeps them again;
   - `lookout-world-<id>` in paths and on the Lookout server's command line is for diagnostics only.
8. **Guard:** before and after each Behaviour test, no World process has daemonized away from the World, and none of the World's processes is a real `claude`, `codex` or `pi` (by `argv[0]`, or the script a `node` or `bun` runs past its own options) other than a Fake Harness from its `bin/`. Either fails the test.
9. **Interrupted runs:** if the worker exits before a World is torn down (a teardown that ran out of time, a start nobody cancelled), it sweeps the World synchronously on exit and names what it found under the test's title, so global teardown fails the run on it. Global setup sweeps the Worlds of runs whose Playwright runner (pid and start time) is gone, and leaves runs that are still going alone. Global teardown sweeps what its own run left and fails the run naming it, also for a test that was expected to fail. A sweep finds a World's processes by its token, as teardown does, and removes only directories that are the World's own: `lookout-world-<id>` in the temporary directory, and `/tmp/lw-<id>`, each only when the entry's `owns` names it. Before it reads or removes anything, global setup checks the whole way from the repo to `.cache/e2e/runs` is plain directories of the repo's (no symlink, nothing resolving outside it) and stops the run otherwise; a run directory or its `worlds/` that is a symlink is neither followed nor removed.
   - e2e/scenarios/test/selftest.e2e.ts runs Playwright on e2e/selftest/ the way `pnpm e2e` does, and proves each of the three: a SIGINT while a World starts leaves nothing and names nothing (the fixture's handler); a test whose teardown runs out of time has what it left killed and named under its title (the exit sweep); a run killed with SIGKILL while a World starts is swept by the next run's global setup.

Inside a pane, `sh -l` reads `/etc/profile`, whose `path_helper` puts `/usr/bin`, `/usr/local/bin` and `/opt/homebrew/bin` back on PATH, and with them `security`, `ssh`, `osascript`, `curl` and `gh`. That isn't harmless: Fake Harnesses run there, and so does a `fleet` typed into a pane. The World's `~/.profile` sets PATH back to `bin/`, and Behaviour tests check it in a pane the World opens and in one Fleet opens (TEST-1.2).

### Fake Harnesses

- **Language and process name:** Node scripts, started so that `ps` shows `argv[0]` as `claude` or `codex` (a small `exec -a` wrapper). Fleet classifies processes by that basename.
- **Fake `claude`:**
  - It writes `~/.claude/sessions/<pid>.json` with `pid`, `sessionId`, `cwd`, `status`, `waitingFor`, `kind: interactive`, `entrypoint: cli` and its own `procStart`.
  - It appends Claude Code's JSONL to `~/.claude/projects/<cwd slug>/<id>.jsonl`.
  - It reads the lines typed into its pane, takes its replies from a script the World declares, and draws a prompt and Claude Code's permission layout, as the fork's `tests/answer.rs` fake does.
  - It honours `--resume <id>`, and exits and removes its registry entry on `/exit`.
- **Fake `codex`:**
  - It writes `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`: `session_meta`, then `task_started`, `task_complete` and `*_approval_request` events.
  - Its `token_count` events carry `rate_limits`, which is how Codex usage reaches Fleet.
  - It honours `resume <id>`.
- **The Transcript lines** are replayed and extended from the recorded fixtures of one named Harness version (TEST-6), never from hand-made shapes. A World names the version it uses, defaulting to the newest recorded one.
- **Driving them:** a Behaviour test steers a Fake Harness through a control file the fake watches: `busy`, `ask`, `say`, `exit`, `limits`. This gives TEST-1.6.

### Fake `curl`, `tb-jev`, `tb-prod` and `tb-pr`

- **`curl`** parses Fleet's arguments, checks the bearer token against the World's fake credentials, and answers `GET https://api.anthropic.com/api/oauth/usage` with the declared numbers, status (401, 429) or delay. Anything else exits non-zero and is logged as a violation, which fails the Behaviour test (TEST-1.7). Fleet's own parsing, caching and back-off stay real.
- **`tb-jev`** answers `status --json` with the 0.2.0 contract (USAGE), per `.jev('ready' | 'not-set-up')`. Anything else is a violation.
- **`tb-prod`** answers `query tasks` with the Tasks declared for the email in its filter, as JSON:API pages, or with a declared failure, and **`tb-pr`** answers `list --json` with the declared board and `refresh` with a declared exit code, or with a declared failure. The shapes and failures are WORK's (its Dependencies). Any other subcommand is a violation. The real ones would reach Productive and GitHub with your own accounts.
- **What the fake `tb-prod` refuses:** it answers only WORK's filter, the five conditions of WORK's Sources, since its answer means "the open Tasks assigned to this email" and nothing else; a filter WORK changes has to change in the fake too, checked against tb-prod. It answers only WORK's sort, `-last_activity_at`, the most recently active Tasks first: a query without `--sort` is refused, since tb-prod's `tasks` has no default sort and Productive's own order is one the fake can't tell, and so is any other sort, ascending included. An include other than `project` and `workflow_status` is refused too. Each refusal is a violation, and where tb-prod refuses the call itself, the fake prints what tb-prod prints: clap's usage error with exit 2 (a value starting with `-` passed as a word of its own, such as `--sort -last_activity_at`, an unknown option, a repeated one), or `invalid_json` or `invalid_filter`, exit 1, with JSON on stdout, worded as `validate_condition` words it (an unknown field such as `board_status`, an operator its type doesn't take, a number for a value). It checks against a slice of tb-prod's schema (`e2e/fakes/tb-prod-filter.ts`), which only decides how a filter is refused, never what is answered. Without a config, tb-prod stops before it reads the filter, and so does the fake, still recording the violation.
- **What the fake `tb-pr` prints:** a board as tb-pr 0.3.1 prints it. A `column_issues` entry may carry `restored_from`, when tb-pr put back an earlier fetch's list (at most an hour old), and `refresh`'s summary then gives that list's age ("wait-me (rate limited, showing the list from 40m ago)"). The World refuses a board 0.3.1 never prints: a flagged column with PRs but no `restored_from` (unless its search came back incomplete), `restored_from` on an empty column, two entries for a column, a column with a list of its own next to "search returned empty", or `review_mine` and `ready_to_merge_mine` flagged differently, since one search feeds both (only "search returned empty" may be on one of them alone). Its times (`fetched_at`, `created_at`, `restored_from`, a rate limit's reset) are RFC 3339 in UTC, as tb-pr prints them, and a Task's `lastActivityAt` is RFC 3339.
- **Changing their answers (TEST-1.6):** `tb-prod` and `tb-pr` read their answer from a file the World writes, when a call starts. A test rewrites it to change what the next call gets, and can hold the next call in flight until it releases it.

### Declaring a World

```ts
import { scenario, world, expect } from '../world';

scenario(
  'USAGE-2.2: Codex usage says "not installed" when Codex is not installed',
  world().with('claude', { usage: { session: 42, weekly_all: 10 } }).without('codex'),
  async ({ page }) => {
    await expect(page.getByRole('button', { name: /usage/i })).toContainText(/Codex.*not installed/);
  },
);
```

- `world()` starts empty: no Harnesses, no Sessions, no History, Jev, tb-prod and tb-pr absent.
- `.with(harness, opts)` makes a Harness present: the CLI fake on PATH, its home directory, its launcher in the Fleet config, and optionally usage numbers.
- `.without(harness)` makes it absent on every axis Fleet checks: no CLI, no home directory, and a launcher that doesn't exist.
- `.session({ harness, status, cwd, transcript })`, `.repo(name, { worktrees })`, `.history([...])`, `.jev('ready' | 'not-set-up')`, `.gitIdentity({ name, email })`, `.tbProd({...})`, `.tbPr({...})` and `.settings({...})` declare the rest. Helpers for common Worlds are built on top of the empty builder, never instead of it.
- `({ world })` inside the test gives the controls of TEST-1.6: `world.session(id).ask(...)`, `.say(...)`, `.exit()`, `world.startOutside(...)`, and `world.tbProd` and `world.tbPr` with `.answer(...)`, `.hold()`, `.held()` (waits until the held call is in flight), `.release()`, `.hanging()` (waits until a call has read a declared timeout and will never answer) and `.calls()` (each call's argv). `world.browserRequests()` lists the URLs the World aborted (TEST-1.7).
- Behaviour tests find elements by role and accessible name, never by an icon: icons are lucide SVGs without text ([0008](../../decisions/0008-lucide-icons-only.md)).
- `world.step(what, fn)` and `world.waitUntil(what, check)` name a wait. A Behaviour test past its 30 s budget fails with "ran past 30 s, waiting for <what>" (TEST-2.6), also when the time went in a synchronous stretch no timer can interrupt: the elapsed time is checked again when the test ends. A scenario may shorten its budget (`{ budgetMs }`), never lengthen it. Playwright's own timeout sits 15 s above, to cover starting and tearing down the World.
- The `world` fixture itself checks the title (TEST-2.2) and keeps the budget (TEST-2.6): a plain `test()` that uses a World is held to both, as a `scenario()` is. Past the budget, the wait in progress fails naming itself; `scenario()` also races its whole body, so a wait on the page outside `world.step` fails at the budget too.
- `pnpm e2e <words>` runs the Behaviour tests whose file or title matches any of the words, ignoring case (`side-6.1` finds `SIDE-6.1: …`). Playwright's options pass through with their values (`--workers 1`, `--repeat-each 5`); `--only-changed` takes the next word as its ref when git knows it as a commit.
- Two runs in one checkout would clobber each other's `dist/web`, `e2e/.results` and `e2e/.report`, so `pnpm e2e` holds a lock (`.cache/e2e/run.lock`, naming its pid and start time): a second run waits for the first and says so, and fails naming it after 15 min. A lock whose run is gone is taken over.
  - Known gap: taking over a stale lock isn't atomic. Two runs that find the same stale lock can interleave between reading it and removing it, so one removes the lock the other just took, and both run.

### Which criteria are `(e2e)`

- A criterion is `(e2e)` when its behaviour spans the server and the UI and a World can check it: SIDE-1.1 and SIDE-1.2 (a Session appears or disappears within 3 s), LAUNCH-4.5 (a start that never registers fails after 15 s, with the terminal's last lines), USAGE-1.3 (refreshes).
- What only an eye can judge stays `(manual)`: SIDE-2.5 (fits 280 px), SIDE-3.2 (recognizable without colour), SIDE-8.1 (one grid's lines line up).
- Existing `(manual)` criteria are retagged when their feature is next worked on, not all at once. Retagging a ticked one unticks it until its Behaviour test passes.
- A criterion already covered by component tests, such as LAUNCH-4.6 and LAUNCH-4.7, stays `(test)`. A Behaviour test may name it too (TEST-2.7).

### req-check

- **Sources:**
  - each `SPEC.md` is read with a Markdown parser (`mdast-util-from-markdown` with GFM), not line by line: requirements are top-level `### <CODE>-n` headings, criteria are the GFM task-list items (`- [ ]`, `- [x]`) of top-level lists under them, and `~~…~~` around the start means struck through. Code, fenced, indented or inline, is never a heading, a criterion or a tag;
  - codes come from the table in `docs/features/README.md`; each `SPEC.md` names its own in its frontmatter, read with a YAML parser (`yaml`), and one without a `code:` fails rather than being skipped;
  - test titles come from the runners' listings, not from a regex over source. A title from Playwright is a Behaviour test; one from Vitest isn't;
  - Vitest's titles are read by `scripts/vitest-titles.mjs` through Vitest's Node API, collecting with `staticParse: false`: Vitest imports each test file and runs its `describe` callbacks, but no hook and no test body. Its default static parse would count a test inside `if (false)` and leave `it.each` titles unexpanded. `vitest list --json` holds the same tests but joins the titles with ` > `, so a title containing ` > ` would split. Collecting this way expands `it.each`, template titles and nested `describe`;
  - so a test file does no work at import or in a `describe` callback: setup that starts a server, makes a temporary directory or writes a file goes in a hook. Collecting today's test files starts no server, writes nothing to the repo (only Vitest's caches under `node_modules/`) and uses no network;
  - Playwright's titles come from `playwright test --list --reporter=json` with `e2e/playwright.config.ts`; without a Playwright config req-check reads no Behaviour tests and says so. A test belongs to the file of its top-level suite, so a `scenario()` belongs to its scenario file, not to `e2e/world/index.ts`, which declares it. A test that won't run (`test.skip`, `test.fixme`: expected to be skipped, or every result skipped) names nothing, like Vitest's skipped tests.
- **Which tests count:** an id counts when it starts a test title or a `describe` title (the existing convention). An id elsewhere in a title is listed as a mention only.
- **Rules:**
  1. A ticked `(test)` criterion with no test naming it fails (TEST-3.2).
  2. A ticked `(e2e)` criterion with no Behaviour test naming it fails (TEST-3.3).
  3. A test naming an unknown or struck-through id fails (TEST-3.4).
  4. A `(manual)` criterion named by a test, and an unticked criterion with tests, are info only (TEST-3.5).
  5. An unticked `(test)` or `(e2e)` criterion without tests is fine: it's still being built.
  6. Titles come only from the runners' listings.
  7. A task-list item that starts with a criterion id but isn't a criterion fails with its `file:line` and why: nested in another item, inside a blockquote, outside a requirement, or after a `~~` that never closes. A ticked criterion without a tag fails too; a criterion's tag comes from its own paragraphs, never from a nested item or code (TEST-3.1).

  On today's tree these rules pass, so req-check can land at once.

### Recording Transcripts

- `pnpm e2e:record <harness>` runs outside any World: it uses the installed Harness and your own login, in a scratch directory, and costs one short conversation.
- It reads the Harness's version (`claude --version`, `codex --version`), copies the Transcript, sanitizes it (home paths to `/home/world`, Session ids to stable fakes, user names, emails, host names and token-like text removed) and writes it under that version.
- A guard test in `pnpm test` scans every fixture for what sanitizing removes (TEST-6.2).
- When a new version's fixtures break a Behaviour test, the Fake Harness or Lookout is fixed before the World's default moves to that version.

### Pins

- `e2e/pins.json` holds `{ fleet: { repo, rev }, tbSession: { repo, rev } }`: the fork `dafilipaj/fleet` at a commit on branch `lookout`, and cli-toolbox at tb-session's release tag (`tb-session-v0.3.0` since 2026-10-20; before that, the `feature/tb-session-sources` commit).
- `pnpm e2e:setup` runs `cargo install --git <repo> --rev <rev> --locked --root .cache/<package>-<rev7>` for each, and installs Playwright's Chromium. It never touches `~/.cargo/bin`, `~/.local/bin` or anything else outside the repo, apart from cargo's download cache and Playwright's browser cache. Git fetches go through the git CLI (`CARGO_NET_GIT_FETCH_WITH_CLI`), since cli-toolbox is private.
- Before it checks or installs anything, `pnpm e2e:setup` refuses a `.cache`, install root, `bin/` or binary that is a symlink or resolves outside the repo: `cargo install --root` follows links, so one pointing at `~/.cargo` would install over the user's own binaries. The World checks the same before it uses a pin.
- A pin's `rev` is the full commit. The World checks the revision cargo recorded for the install (`.crates2.json` in the install root), and `--version` against the pin's `version` when it names one, before the first test and again when a World starts (TEST-1.3). `--version` runs with a scratch `HOME` inside `.cache/` as its working directory and a `PATH` holding nothing: tb-session's `--version` looks for a newer release with `gh` and caches it under `~/Library/Caches`.
- `@playwright/test` is pinned to 1.63.0, whose Chromium 1243 this Mac already caches.
- Bumping a pin is a one-line change, reviewed like code.
- `pnpm test` needs the pinned Fleet too (VIEW-1.7 runs the chat against it), so `pnpm e2e:setup` comes first, once per checkout: `.cache/` isn't shared between Worktrees.

### Before each push

- `.githooks/pre-push` runs `pnpm req-check`, `pnpm test` and `pnpm e2e` (TEST-4.1), at half their usual parallelism: Vitest on at most half the cores (`--maxWorkers=50%`), and a quarter of them as Playwright workers (`--workers=25%`, 3 on 12 cores, against half by default). The same tests run; a push takes longer, and leaves the machine usable. A `prepare` script (`scripts/setup-hooks.mjs`) sets `git config --local core.hooksPath .githooks` on `pnpm install`, and does nothing without git or when the package isn't the top of its own checkout. It runs git without the variables it may inherit from another repo's hook (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`, `GIT_CONFIG*`, `GIT_CEILING_DIRECTORIES`), so the checkout it finds is the package's own and it doesn't change another repo's hooks (TEST-4.2).
- No CI: a World needs macOS, tmux, a Rust build of the fork and Chromium, and the repo has one pusher.

### Decisions this follows

- [0001](../../decisions/0001-tmux-as-hidden-session-host.md): Sessions run in tmux; here, in a private tmux server.
- [0002](../../decisions/0002-start-sessions-through-a-login-shell.md): Sessions start in a login shell; here, the World's `SHELL`.
- [0003](../../decisions/0003-browser-first-react-stack.md): Chrome; here, Playwright's Chromium.
- [0004](../../decisions/0004-fleet-cli-as-session-layer.md): Fleet only through its CLI's `--json` output.
- [0006](../../decisions/0006-run-a-fork-of-fleet.md): the fork, pinned.
- [0007](../../decisions/0007-behaviour-tests-from-spec-requirements.md): this feature.
- [0008](../../decisions/0008-lucide-icons-only.md): icons carry no text, so Behaviour tests use roles and accessible names.

### Key decisions

- **Fake Harnesses by default, a real one only in `pnpm e2e:record`**: the hook stays free, fast and repeatable, and format drift is caught when you choose to record.
- **Real Fleet, tb-session, tmux, git, ps, lsof, sh and node; fake claude, codex, tb-jev, curl, tb-prod and tb-pr; no security, gh, ssh or osascript**: the real tools are the ones whose drift matters, tb-jev, tb-prod and tb-pr are leaves Lookout only maps (the real tb-prod and tb-pr would reach Productive and GitHub), and the absent ones would reach the keychain, the network or iTerm2.
- **USAGE-2.2 unchanged**: "Codex: not installed" is shown; hiding an unused Harness only matters if Lookout is shared, so it's in the Backlog.
- **`.without('codex')` removes the CLI and `~/.codex`**: Fleet's usage checks only the home directory, its `harness list` only the CLI.
- **A new tag `(e2e)`**: whether a criterion needs a Behaviour test becomes checkable instead of a reviewer's call.
- **A `ps` shim, not a Fleet option**: it's test tooling and needs no fork change; a Fleet option comes only if the shim gets complicated.
- **req-check fails only on missing tests for ticked `(test)` and `(e2e)` criteria and on unknown or struck ids**: it passes on today's tree, and failing on `(manual)` ids would break 23 tests for no gain.
- **Titles from the runners' listings**: a regex over test source misses `it.each` and template titles, and misreads `UTF-8`.
- **Budget: suite ≤ 3 min, a Behaviour test ≤ 30 s, a World start < 3 s**: a written budget stops the hook from becoming something you `--no-verify` past.
- **A versioned pre-push hook, no CI**: what 0007 decided, at no cost; CI would need macOS runners and a Rust build for one pusher.
- **Headless Chromium at 1440×900 only**: the only browser Lookout targets.
- **A top-level `e2e/`**: one place for one layer, out of Vitest's globs.
- **An empty-start World builder**: every precondition is visible in the test.
- **Recorded, sanitized Transcripts from a named Harness version**: hand-made shapes would test Fleet against what we think the format is.
- **Pins in `e2e/pins.json`, installed into `.cache/`**: reproducible runs that never replace the user's own Fleet or tb-session.
- **A fake `curl` with fake credentials**: Fleet's real usage parsing, cache and back-off run, including 401, 429 and timeouts, with no network.
- **One World per Behaviour test**: a reset can't clear the Lookout server's memory (the usage high-water mark, launches).
- **A tmux shim on PATH**: Lookout itself runs `tmux capture-pane` from PATH, and a PATH-only Fleet finds tmux there too, so both reach the private server through it.
- **`FLEET_PATH_ONLY=1` for every Fleet the World runs, not per-binary overrides**: without it Fleet always searches `/opt/homebrew/bin` and `/usr/local/bin`, so "not on PATH" alone didn't make a command absent, and `tools::claude()` had no override at all. The switch makes PATH the whole answer, and refuses what reaches past it (other hosts, iTerm, a local exec or ssh, the web server). Its Behaviour test only looks names up (`harness list --no-models`), so a failed switch fails the test without running a real `gh`, `ssh`, `security` or `osascript`.
- **A port the OS picks, never 4747 or 4748**: a World must never collide with the Lookout the user is running, and a port picked ahead of time can be taken before the server binds it. The server reports the port it bound, and the World checks the token it answers with.
- **A World's processes by the environment they inherit, not by process group or command line**: a token only the World hands out, read with `ps -E`, and through the parent where macOS hides an Apple binary's environment. Process ids get reused within minutes on this Mac, so a recorded pid or process group can turn into another program's; a command line holding the World's id can be anyone's (a `tail -f` of its log), and an orphan's holds nothing.
- **A registry on disk, swept by the next run**: Playwright skips the teardown of a fixture still starting when a run is interrupted.
- **`TMUX_TMPDIR` under `/tmp`**: a socket path over about 104 bytes fails, and temporary directories under `/private/var/folders` or a scratchpad are too long.
- **The Fake Harness's `argv[0]` is the Harness name**: Fleet finds Codex Sessions only by that basename.

## Open questions

None.

## Changelog

- 2026-10-17: Created from [0007](../../decisions/0007-behaviour-tests-from-spec-requirements.md) after reading Lookout's tests and fakes, the spec criteria, and the Fleet fork's isolated test setup.
- 2026-10-17: Ready: decisions from review with Dario. Fake Harnesses plus `pnpm e2e:record` (TEST-6); real, fake and absent tools fixed (TEST-1.2); `(e2e)` tag and req-check rules (TEST-3); `ps` shim (TEST-1.10); fake `curl` (TEST-1.7); pins in `.cache/` (TEST-1.3); budget (TEST-2.5, TEST-2.6); pre-push hook, no CI; Chromium 1440×900; one World per Behaviour test. USAGE-2.2 stays; hiding an unused Harness went to the Backlog. Facts refreshed against `main` 6b2b77c (SIDE-8, 0008, LAUNCH-4.6 and 4.7).
- 2026-10-17: In Progress: TEST-3 (`pnpm req-check`), TEST-4 (`.githooks/pre-push`; `prepare` sets `core.hooksPath`) and TEST-5 built. Until the Behaviour tests land, the hook runs `pnpm e2e` only when that script exists and says so when it doesn't, and req-check reads no Behaviour tests without a Playwright config and says so. TEST-4.1 and TEST-4.3 stay open until they're seen with `pnpm e2e` on a real push.
- 2026-10-17: Review fixes. TEST-3.1 reads Vitest's titles through its Node API (`scripts/vitest-titles.mjs`) instead of `vitest list --json`, whose ` > `-joined names can't be split safely; req-check ignores fenced code, reads CRLF specs and commented frontmatter, and fails on a spec without a code. `prepare` runs `scripts/setup-hooks.mjs`, which does nothing inside another repo's checkout.
- 2026-10-17: Second review fixes. req-check reads each spec with a Markdown parser and its frontmatter with a YAML parser, replacing the line-by-line reading that unclosed or look-alike fences and quoted `#` broke. TEST-3.1 says which Vitest collection counts: loading the test files without running them, so `it.each` titles expand and a test that is never registered doesn't count; test files keep setup out of import and `describe` callbacks. `setup-hooks` ignores the git variables it inherits, such as `GIT_DIR` from another repo's hook, and writes with `--local`. Playwright titles will come from `playwright test --list --reporter=json` once `e2e/` exists.
- 2026-10-17: Third review fixes. req-check fails on a task-list item that starts with a criterion id but isn't a criterion (nested, in a blockquote, outside a requirement, or after an unclosed `~~`), naming its `file:line`, and on a ticked criterion without a tag; a tag in a nested item no longer counts. The spec template quotes its frontmatter values, so a title with `: `, a backtick or `@` is valid YAML.
- 2026-10-17: In Progress: the World's core, the runner, the pins and the first smoke tests (SIDE-6.1, an empty World, the isolation guard). Ticked TEST-1.1, 1.3, 1.8, 2.1, 2.2 and 2.6. Fleet and tb-session run through argv-logging wrappers; Fleet's naming, grouping and stacks are off in a World; leftovers are found by the World's id in command lines. TEST-1.2 stays open: Fleet's fallback directories still find `/opt/homebrew/bin/gh` on this Mac, and the fakes don't exist yet. TEST-1.9's guard doesn't yet start and close a Session through Lookout (it needs a Fake Harness).
- 2026-10-17: After review: a World owns its processes by identity (a recorded process group per child, start times, ancestry), never by command line, and is written to an on-disk registry before it starts anything, so interrupted runs are swept by the next run. The Lookout server accepts `LOOKOUT_PORT=0` and prints the port it bound; the World checks the token it answers with. Every binary override Fleet reads points inside the World, and its `~/.profile` undoes `path_helper` in login shells. Budgets also catch synchronous overruns and can only be shortened; `pnpm e2e` passes option values through. TEST-1.1, 1.3, 1.8, 2.1 and 2.6 re-ticked after verifying them again. TEST-1.2 stays open until the Fleet fork has a strict "PATH only, no fallback directories" switch (`tools::claude()` has no override).
- 2026-10-17: Fixes from the World's second review. A World's processes are the ones carrying its `LOOKOUT_WORLD_ID` token in their environment, or descending from one, never the members of a recorded process group: pids are reused within minutes, so a group whose leader had exited could be someone else's. Signals go to single pids after their start time is read again; a group is signalled only through a child the World still holds. A process that daemonized away from the World is named and killed, and the World's directories go only after its processes. The worker's exit sweep names what it found under the test's title, and a worker waits for a cancelled start's teardown; runs of `e2e/selftest/` prove the SIGINT handler, the exit sweep and global setup's sweep each. The `world` fixture checks titles and keeps the budget, so a plain `test()` can't skip them. Sweeps remove only a World's own directories. `LOOKOUT_PORT` takes digits only. A pin's `--version` runs with a scratch HOME and an empty PATH. A second `pnpm e2e` in a checkout waits for the first. req-check ignores skipped Behaviour tests and files a `scenario()` under its scenario file. TEST-1.8 and 2.6 re-ticked after verifying them again.
- 2026-10-19: Fleet re-pinned to `ad63005`, which adds `FLEET_PATH_ONLY`. Every Fleet a World runs has it: the Lookout server's environment, the `logged` wrapper (which sets it itself) and panes, which get it with PATH through `tmux -e` and run the World's `SHELL`, now set as the private tmux server's `default-shell`. The per-binary overrides that kept Fleet out of its fallback directories are gone (`FLEET_TMUX`, `FLEET_CMD`, `FLEET_GH`, `FLEET_NODE`, `FLEET_BIN`, and the config's launchers, `tmux`, `gh`, `fleetBin` and `web.node`); the Fleet config only turns naming, grouping and stacks off. A Behaviour test shows Fleet doesn't find `gh` although it is in `/opt/homebrew/bin`, nor `ssh`, `security` or `osascript`, through the wrapper and from a pane Fleet opens, by looking the names up without running them. The pre-push hook asks `node e2e/setup.ts --check`, the pin check the World runs, instead of looking for `.cache/*-<full rev>` (setup installs into `.cache/<package>-<rev7>`, so the hook always failed); `scripts/pre-push.test.mjs` covers it. TEST-1.2 stays open: the fake `claude`, `codex`, `tb-jev` and `curl` don't exist yet (TEST-1.4, TEST-1.7), and the `ps` shim still passes every call through to `/bin/ps` (TEST-1.10).
- 2026-10-19: Fixes from the World's third review. Global setup refuses to sweep when a symlink sits anywhere between the repo and `.cache/e2e/runs`, and never follows a symlinked run or `worlds/`. A World creates its index entry, root and `TMUX_TMPDIR` exclusively, takes another id when one is already there, records what it made in the entry (`owns`), and removes or `kill-server`s only that. Tests cover a stranger reusing a World's former process group or a recorded pid with another start time. Two known gaps stay, written down under Teardown and the run lock: seen identities aren't kept by any sweep (after a teardown that ran out of time or an interrupted run), and two runs can race to take over a stale lock.
- 2026-10-19: A World may provide fake `tb-prod` and `tb-pr`, next to claude, codex, tb-jev and curl, for WORK's Behaviour tests (TEST-1.2, TEST-1.5, `.tbProd()` and `.tbPr()`); Productive joins the Non-goals' list of what a World never reaches. TEST-1.2 stays open.
- 2026-10-19: For WORK's Behaviour tests, after its third review. A World aborts every browser request outside its own Lookout origin, popups and new tabs included, and records its URL (TEST-1.7), so a link to GitHub or Fantastic is checked without loading it. `.gitIdentity()` writes a global git identity, and tb-prod's Tasks are declared per assignee email (TEST-1.5). A test can change what the fake `tb-prod` or `tb-pr` answers mid-test, or hold a call in flight (TEST-1.6). None of it is built yet; TEST-1.5, 1.6 and 1.7 stay open.
- 2026-10-19: Built the World's side of WORK's Behaviour tests. A World declared with `.tbProd()` or `.tbPr()` has the fake on PATH (`e2e/fakes/tb-prod.ts`, `tb-pr.ts`, run by node through the `fake` wrapper, which logs each argv): `tb-prod` answers `query tasks` with the Tasks declared for its filter's `assignee.email`, as JSON:API pages of 20, `tb-pr` answers `list --json` with the declared board (with or without `task_ids`) and `refresh` with the declared exit code, or each fails as declared (WORK's Dependencies). Any other call is a violation that fails the Behaviour test. `world.tbProd` and `world.tbPr` change the answer from the next call on, or hold one call in flight until released; `.held()` and `.calls()` were added for tests to wait on and check. `.gitIdentity()` writes `~/.gitconfig`. A World's browser context aborts and lists every request outside its Lookout origin, popups, new tabs and WebSockets included, with Chromium resolving no other host as a backstop. TEST-1.2, 1.5, 1.6 and 1.7 stay open: the Fake Harnesses, the fake `curl` and `tb-jev`, repos, History, usage and Jev aren't built yet.
- 2026-10-19: Fixes from the review of the World's side of WORK. The fake `tb-prod` answers only WORK's exact filter, sorted by `±last_activity_at`, and refuses the rest as a violation; where tb-prod itself refuses, it prints tb-prod's own error: clap's (exit 2) for a value starting with `-` as a word of its own, `invalid_json` or `invalid_filter` (exit 1, JSON on stdout) for a filter tb-prod's schema rejects, checked against a slice of it (`tb-prod-filter.ts`). The fake `tb-pr` follows tb-pr 0.3.1: `column_issues[].restored_from` is declared, printed and summed up in `refresh` as tb-pr does, and a board 0.3.1 never prints is refused. Service workers are blocked, Chromium sends everything but loopback to a dead proxy, and a request outside the World that gets past its route, such as a redirect's next hop, fails the Behaviour test (TEST-1.7). Refused calls are read after the World's processes are gone, and a failing test's report holds each fake's answers in order (TEST-2.4). TEST-1.5, 1.6 and 1.7 stay open.
- 2026-10-19: Fixes from the second review of the World's side of WORK. The fake `tb-prod` refuses a query without `--sort` and an ascending one: it answers only WORK's `-last_activity_at`. A call a fake refuses while the World stops gets its report, read in `stop()` before the World's directories go (TEST-2.4). The World takes only RFC 3339 times, in UTC for tb-pr's, and refuses `review_mine` and `ready_to_merge_mine` flagged with different reasons. A Behaviour test shows a page can't register a service worker (TEST-1.7).
- 2026-10-19: Fixes from the third review of the World's side of WORK. A report collected before the World stops keeps its panes, and its files (the server log, the calls log, the fakes' answers) are read again once the World's processes are gone, so a call refused while it stopped is in it (TEST-2.4). `world.tbProd.hanging()` and `world.tbPr.hanging()` wait until a call has read a declared timeout, so a test measures the fake's silence from then, not from a slow start. The World refuses a day its month doesn't have, February 29 outside a leap year included, in RFC 3339 times and a Task's `dueDate`.
- 2026-10-19: For WORK's PRs (slice B). A Behaviour test (TEST-1.5) reads the fake `tb-pr`'s boards and declared failures with WORK's own parser (`parseTbPrList`, `classifyTbPrFailure` in `server/work.ts`), and checks that every PR has tb-pr 0.3.1's fields in their order, so the fake and WORK's reading of tb-pr can't drift apart unnoticed; a change to that parser can now fail TEST's self-tests too. `.settings()` also takes `lastLaunch`, for WORK-5.2. The fakes' tests use invented repos, people and emails.
- 2026-10-20: tb-session 0.3.0 is released (`tb-session-v0.3.0`), so `e2e/pins.json` moves from the `feature/tb-session-sources` commit to the release commit `33a26f3`, the one Dario has installed.
- 2026-10-23: The pre-push hook runs at half the usual parallelism, from Dario's testing: a push that ran 6 Worlds and Vitest on every core at once, while other agents were working, pushed the load average to 33 and froze Chrome, and today's pre-push failures were all timing tests that lost to the load and passed alone. `pnpm test` and `pnpm e2e` run by hand keep their full speed. Technical approach, Before each push.

- 2026-10-24: MEM adds `.memory({ processes, pressure, ramBytes })` and replaceable sampler answers. The World always fakes memory sampling, including when empty; the `ps` shim retains discovery calls, and undeclared `sysctl` argv is a violation. Declared readings include the real server and sampler pids with deterministic RSS.
- 2026-10-24: TEST-1.2 regression fix: the sysctl override is a shim, preserving unrelated system reads used by login shells. Only memory-key calls reach the strict fake, including malformed sampler calls, which remain violations. A shell-wrapper unit test uses a stand-in system command to verify pass-through without reading host memory.
- 2026-10-25: MEM dock regression coverage adds a `.usage()` declaration for populated Claude/Codex windows and Jev readiness. The CLI fixtures go through Lookout’s real usage parser and Jev probe. Memory release Behaviour checks span a full fast interval; fake-clock API tests additionally check 30 seconds exactly, within TEST-2.6’s unchanged 30-second Behaviour budget.
