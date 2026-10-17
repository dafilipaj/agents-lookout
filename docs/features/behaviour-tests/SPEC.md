---
title: Behaviour tests
code: TEST
status: In Progress
created: 2026-10-17
updated: 2026-10-17
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

- [ ] TEST-1.1 When a Behaviour test starts, its World has its own temporary HOME, its own settings file, a private tmux server and a Lookout server on a free port. That port is never 4747 or 4748. Nothing from the user's HOME, tmux server, keychain or settings is visible to Lookout, Fleet, tb-session or the Fake Harnesses. (test)
- [ ] TEST-1.2 PATH holds only what the World declares:
  - **real:** Fleet, tb-session, tmux (through a shim to the private `-L` server), git, ps (through the shim of TEST-1.10), lsof, sh, node, and the plain system tools these need;
  - **fake:** claude, codex, tb-jev and curl, each only when declared;
  - **absent:** security, gh, ssh and osascript.

  A command the World doesn't declare can't be found, also not through Fleet's fallback directories (`/opt/homebrew/bin`, `/usr/local/bin`). (test)
- [ ] TEST-1.3 Fleet and tb-session are the real binaries at the versions pinned in `e2e/pins.json`. `pnpm e2e:setup` installs them into `.cache/`, never over the user's own binaries. When a binary doesn't match its pin, the run stops before the first test and says which pin it expected and the command that gets it. Until tb-session 0.3.0 is released, its pin is the commit of its 0.3.0 branch. (test)
- [ ] TEST-1.4 Fake Harnesses stand in for Claude Code and Codex. They run in the World's tmux, register and write Transcripts the way the real ones do, and draw the screens Fleet reads. With them, the real Fleet can list, read `messages` from, `send` to, `answer`, `peek` and `close` them, and real tb-session can index their Transcripts. Their Transcript lines come only from fixtures recorded from a named Harness version (TEST-6). (test)
- [ ] TEST-1.5 A Behaviour test declares its World in code, with a builder that starts empty. A World can contain:
  - Harnesses present or absent;
  - live Sessions, each with Harness, Status, working directory and Transcript;
  - git repos and Worktrees;
  - past Sessions for History;
  - Claude and Codex usage numbers;
  - Jev's state;
  - Settings.

  Anything the test doesn't declare is absent. `.without('codex')` removes both the Codex CLI and `~/.codex`, so Fleet's `harness list` and `usage` both say "not installed". (test)
- [ ] TEST-1.6 A Behaviour test can change its World while it runs, as a Harness or the user would: a Session turns Busy, asks a question, replies, or exits; a new Session starts outside Lookout; a Codex turn records new limits. (test)
- [ ] TEST-1.7 Nothing in a World reaches the network or a real account. The fake `curl` answers only Anthropic's usage endpoint, with the numbers (or the 401, 429 or timeout) the World declares, using fake credentials in the World's HOME. Any other request fails the Behaviour test and names the URL. (test)
- [ ] TEST-1.8 After each Behaviour test, whether it passed, failed or timed out, its tmux server, Lookout server, Fake Harnesses and temporary directories are gone. A run that leaves any of them behind fails and names what it left. (test)
- [ ] TEST-1.9 A guard test proves the isolation, as the Fleet fork's `tests/isolation.rs` does. It listens on the default tmux socket inside the World's `TMUX_TMPDIR`, runs a scenario that lists, starts and closes a Session, and fails if anything knocked on that socket or read outside the World's HOME. (test)
- [ ] TEST-1.10 Processes outside the World are invisible to it. With Codex declared and a real Codex TUI running on the machine, Fleet lists only the World's Sessions. (test)

### TEST-2 Running Behaviour tests

- [ ] TEST-2.1 `pnpm e2e` builds the UI when `dist/web` is older than the sources, then runs every Behaviour test with Playwright in headless Chromium at 1440×900, against the built Lookout (`NODE_ENV=production`). `pnpm e2e <filter>` runs the matching ones. (manual)
- [ ] TEST-2.2 A Behaviour test is written as `scenario('<ID>: <what holds>', world, fn)`. Its title starts with the criterion id, as unit test titles already do. (test)
- [ ] TEST-2.3 Behaviour tests run in parallel, each in its own World, and give the same result in any order. (test)
- [ ] TEST-2.4 When a Behaviour test fails, its report holds:
  - the Playwright trace and a screenshot;
  - the Lookout server's log;
  - the argv of every Fleet, tb-session and fake call;
  - the last screen of every tmux pane in its World;
  - the World's declaration.

  That's enough to understand the failure without rerunning it. (manual)
- [ ] TEST-2.5 On this Mac the whole Behaviour suite takes at most 3 min, and a World starts in under 3 s. Each run prints both. Over budget, the slowest Behaviour tests get looked at before more are added. (manual)
- [ ] TEST-2.6 A Behaviour test that runs past 30 s fails, naming what it was waiting for. (test)
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
- Any network call or real account in a World: Anthropic's usage endpoint, Typesafe, GitHub.
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
  - `LOOKOUT_PORT` must be 1–65535, and the Host allow-list is built from it, so port 0 can't be used: the World picks a free port.
  - Settings come from `LOOKOUT_SETTINGS` and the token from `LOOKOUT_TOKEN`. `NODE_ENV=production` serves `dist/web`.
- **How Fleet finds things** (the fork's `core/tools.rs`, `core/harness.rs`, `core/usage*.rs`, `core/discovery.rs`):
  - **Binaries:** `find_binary` looks on PATH, then always in `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.cargo/bin` and `~/bin`. A Harness counts as installed in `harness list` when its launcher's first word resolves that way, or when the launcher is an absolute path to an executable.
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
  - tb-session 0.2.0 is installed; HIST is built against 0.3.0, which is unreleased (cli-toolbox branch `feature/tb-session-sources`).
  - Playwright's Chromium 1243 is cached, but Playwright isn't a dependency yet.
  - The repo has no CI and no hooks.

### Layout

```
e2e/
  playwright.config.ts   headless Chromium, 1440×900, 30 s timeout, workers ≈ half the cores
  world/                 the World builder (TypeScript): env, PATH, shims, Fleet config, Lookout server, teardown
  fakes/                 claude.mjs, codex.mjs, tb-jev.mjs, curl.mjs
  shims/                 tmux, ps
  fixtures/              transcripts/{claude,codex}/<version>/*.jsonl, usage/*.json, history/*.json
  scenarios/<feature>/*.e2e.ts
  record/                the recorder behind pnpm e2e:record (TEST-6)
  pins.json              Fleet fork revision, tb-session revision
  .report/               failed tests' reports (git-ignored)
scripts/req-check.mjs
.githooks/pre-push
.cache/                  pinned Fleet and tb-session (git-ignored)
```

`e2e/` sits outside Vitest's globs (`server/**/*.test.ts`, `web/src/**`), and apart from `server/fixtures/`, whose fake Fleet and tb-session a World doesn't use.

### A World, built for each Behaviour test

1. **Directories:**
   - a temporary root with `home/`, `bin/`, `logs/` and `work/`;
   - `TMUX_TMPDIR` under `/tmp/lw-XXXX`;
   - `home/Projects/work`, which is the default Start directory.
2. **`bin/`:**
   - **Real tools:** symlinks to git, lsof, sh, node and the plain system tools they need (`bash`, `env`, `hostname`, `sleep`, `cat`; the final list is fixed while building). Fleet and tb-session are reached through `LOOKOUT_FLEET_BIN` and `LOOKOUT_TB_SESSION_BIN`, from `.cache/`.
   - **tmux shim:** `exec <real tmux> -L lookout-world-<rand> -f /dev/null "$@"`. Lookout and Fleet both reach the private server through it.
   - **ps shim:** passes every call through to `/bin/ps`, except that a machine-wide listing (`-ax`, `-e`) keeps only processes whose tty belongs to a pane of the World's tmux server, and their descendants. This keeps the user's own Codex TUIs out of Fleet's discovery (TEST-1.10).
   - **Fakes:** the declared ones among claude, codex, tb-jev and curl.
   - **Kept out:** `security`, `gh`, `ssh` and `osascript`.
3. **Fleet config** (`FLEET_CONFIG`) sets each declared Harness's launcher to an absolute path in `bin/`. An absent Harness gets a path that doesn't exist. Fleet's fallback directories then can't find a real `claude` or `codex`.
4. **Environment for the Lookout server and everything it starts:**
   - `HOME`, `PATH=<world>/bin` and `SHELL=/bin/sh`;
   - `LOOKOUT_PORT` (free, never 4747 or 4748), `LOOKOUT_TOKEN`, `LOOKOUT_SETTINGS`, `LOOKOUT_FLEET_BIN` and `LOOKOUT_TB_SESSION_BIN` (the pinned binaries), and `NODE_ENV=production`;
   - `FLEET_CONFIG`, `FLEET_TMUX`, `TMUX_TMPDIR`, `FLEET_SNAPSHOT`, `FLEET_LOCK_DIR`, `FLEET_MUX=0` and `NO_COLOR=1`;
   - Fleet's `UNSET` list removed.
5. **Fixtures:** the declared Sessions, Transcripts, repos, usage and History are written into `home/` and `work/`. A declared Claude usage also writes fake credentials to `home/.claude/.credentials.json`. Live Sessions are started as Fake Harnesses in the private tmux server, and the World waits until Fleet lists them.
6. **Start:** the World starts `node server/main.ts` in its own process group, waits for `/api/bootstrap`, records how long the start took (TEST-2.5), and hands Playwright the URL.
7. **Teardown:**
   - kill the Lookout server's process group and `tmux kill-server` on the private socket;
   - check that no process of the World is left (TEST-1.8);
   - keep `logs/` on failure, then remove the root.

Inside a pane, `sh -l` reads `/etc/profile`, whose `path_helper` adds the system directories back to PATH. That's harmless: the Fake Harnesses are typed as absolute paths, and Fleet and Lookout run outside the panes with the World's PATH.

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

### Fake `curl` and `tb-jev`

- **`curl`** parses Fleet's arguments, checks the bearer token against the World's fake credentials, and answers `GET https://api.anthropic.com/api/oauth/usage` with the declared numbers, status (401, 429) or delay. Anything else exits non-zero and is logged as a violation, which fails the Behaviour test (TEST-1.7). Fleet's own parsing, caching and back-off stay real.
- **`tb-jev`** answers `status --json` with the 0.2.0 contract (USAGE), per `.jev('ready' | 'not-set-up')`. Anything else is a violation.

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

- `world()` starts empty: no Harnesses, no Sessions, no History, Jev absent.
- `.with(harness, opts)` makes a Harness present: the CLI fake on PATH, its home directory, its launcher in the Fleet config, and optionally usage numbers.
- `.without(harness)` makes it absent on every axis Fleet checks: no CLI, no home directory, and a launcher that doesn't exist.
- `.session({ harness, status, cwd, transcript })`, `.repo(name, { worktrees })`, `.history([...])`, `.jev('ready' | 'not-set-up')` and `.settings({...})` declare the rest. Helpers for common Worlds are built on top of the empty builder, never instead of it.
- `({ world })` inside the test gives the controls of TEST-1.6: `world.session(id).ask(...)`, `.say(...)`, `.exit()`, and `world.startOutside(...)`.
- Behaviour tests find elements by role and accessible name, never by an icon: icons are lucide SVGs without text ([0008](../../decisions/0008-lucide-icons-only.md)).

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
  - Playwright's titles will come from `playwright test --list --reporter=json` once `e2e/` exists. Until then there's no Playwright config, so req-check reads no Behaviour tests and says so.
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

- `e2e/pins.json` holds `{ fleet: { repo, rev }, tbSession: { repo, rev } }`: the fork `dafilipaj/fleet` at a commit on branch `lookout`, and cli-toolbox at the `feature/tb-session-sources` commit until 0.3.0 is released, then at its release tag.
- `pnpm e2e:setup` runs `cargo install --git <repo> --rev <rev> --locked --root .cache/<name>-<rev>` for each, and installs Playwright's Chromium. It never touches `~/.cargo/bin`, `~/.local/bin` or anything else outside the repo, apart from Playwright's browser cache.
- The World checks `--version` (and, for Fleet, the revision it was built from) before the first test (TEST-1.3).
- Bumping a pin is a one-line change, reviewed like code.

### Before each push

- `.githooks/pre-push` runs `pnpm req-check`, `pnpm test` and `pnpm e2e` (TEST-4.1). A `prepare` script (`scripts/setup-hooks.mjs`) sets `git config --local core.hooksPath .githooks` on `pnpm install`, and does nothing without git or when the package isn't the top of its own checkout. It runs git without the variables it may inherit from another repo's hook (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`, `GIT_CONFIG*`, `GIT_CEILING_DIRECTORIES`), so the checkout it finds is the package's own and it doesn't change another repo's hooks (TEST-4.2).
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
- **Real Fleet, tb-session, tmux, git, ps, lsof, sh and node; fake claude, codex, tb-jev and curl; no security, gh, ssh or osascript**: the real tools are the ones whose drift matters, tb-jev is a leaf Lookout only maps, and the absent ones would reach the keychain, the network or iTerm2.
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
- **A tmux shim on PATH, not only `FLEET_TMUX`**: Lookout itself runs `tmux capture-pane` from PATH, so both must reach the private server.
- **Launchers as absolute paths in the World's Fleet config**: Fleet always searches `/opt/homebrew/bin` and `/usr/local/bin`, so "not on PATH" alone doesn't make a Harness absent.
- **A free port, never 4747 or 4748**: a World must never collide with the Lookout the user is running.
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
