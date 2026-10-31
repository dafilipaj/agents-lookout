# Lookout

A local web UI for watching and controlling the agent Sessions (Claude Code, Codex) running on your Mac: every Session at a glance, its chat and terminal, the questions it's waiting on, what it produced, and the Productive Tasks and PRs it's tied to. Use it as it is, or fork it.

Built for Productive's developer setup: the `work` repo, the `cli-toolbox` CLIs and `productiveio/*` repos. Section [Productive assumptions](#productive-assumptions) lists what's wired to that and where to change it in a fork.

How it's designed: [`docs/README.md`](docs/README.md), terms in [`docs/GLOSSARY.md`](docs/GLOSSARY.md), the rules agents follow in [`AGENTS.md`](AGENTS.md), features and their status in [`docs/features/README.md`](docs/features/README.md).

## What it shows

- **Sessions** (sidebar): every live Claude Code and Codex Session, its status, repo, Worktree and branch, with the ones that need you first. `N` starts a new one in a chosen directory.
- **Session view**: the chat as it happens, a composer that types into the Session, the questions it asks as buttons, model and Effort switches, and a terminal preview when it needs you.
- **History**: search past Sessions and resume one with a button.
- **Library**: the reports, Artifacts and Backyard Shares that Sessions produced, each linked to its Session.
- **Tasks and PRs**: your Productive Tasks, your open PRs and Review requests, linked to the Sessions that work on them.
- **Usage**: Claude, Codex and Jev limits at a glance, and what the Sessions cost the Mac in memory.

## Prerequisites

macOS only: it reads memory through `ps` and `sysctl`, and hosts Sessions in tmux or iTerm2.

Required:

- **Node 25** and **pnpm 10** (`corepack enable pnpm`). The server runs its TypeScript directly through Node's type stripping, with no build step.
- **Fleet**, the Session layer ([decision 0004](docs/decisions/0004-fleet-cli-as-session-layer.md)), from the fork `dafilipaj/fleet`, branch `lookout` ([decision 0006](docs/decisions/0006-run-a-fork-of-fleet.md)). Upstream Fleet lacks the commands Lookout's chat, answers and resume need. Install it pinned to the revision Lookout is tested against (the Fleet `rev` in `e2e/pins.json`); needs Rust's `cargo`:

  ```sh
  cargo install --git https://github.com/dafilipaj/fleet --rev 9b6e4bf --locked fleet
  ```

  Lookout looks for `fleet` on `PATH`, then in `~/.cargo/bin`. Set `LOOKOUT_FLEET_BIN` to use another binary.
- **tmux**, the hidden Session host ([decision 0001](docs/decisions/0001-tmux-as-hidden-session-host.md)). Only Sessions in tmux or iTerm2 are Controllable; Sessions you start elsewhere are listed as view only.
- **Claude Code** and/or **Codex**, set up as you run them by hand. Lookout starts a Session by typing `claude` or `codex` into a login shell in tmux ([decision 0002](docs/decisions/0002-start-sessions-through-a-login-shell.md)), so the `claude` wrapper from the `work` repo's `/setup` (telemetry) applies exactly as in your terminal.

Optional, one per panel. A panel whose CLI is missing says so and shows the install command; everything else keeps working. All come from `productiveio/cli-toolbox` (private: `gh auth login` with access to it first) and land in `~/.local/bin`:

| CLI | Unlocks | Install |
|---|---|---|
| `tb-session` 0.4.0+ | History, Library, Session links in Tasks and PRs | `gh api -H "Accept: application/vnd.github.raw" repos/productiveio/cli-toolbox/contents/scripts/install.sh \| bash -s -- tb-session` |
| `tb-pr` | PRs and Review requests | same script with `tb-pr`; needs `gh` signed in |
| `tb-prod` 1.2.0+ | Tasks | built from cli-toolbox `main` (the panel shows the `cargo install` line); then `tb-prod config init` |
| `tb-jev` 0.2+ | Jev status in the usage strip | same script with `tb-jev` |

Override where a CLI is found with `LOOKOUT_TB_SESSION_BIN`, `LOOKOUT_TB_PR_BIN` and `LOOKOUT_TB_PROD_BIN`.

## Run

```sh
pnpm install
pnpm dev          # server + Vite with hot reload → http://127.0.0.1:4748
pnpm build        # builds the UI into dist/web
pnpm start        # server serves the built UI → http://127.0.0.1:4747
```

First run: open **Settings** (the sidebar's gear, or `/settings`) and check the start directories (default `~/Projects/work`), the Productive email Tasks are read for (suggested from `git config --global user.email`) and the idle threshold. Then press `N` to start a Session, or run `claude` in a tmux window and watch it appear.

Checks: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm req-check`. Run `pnpm e2e:setup` once per checkout first: `pnpm test` runs the chat against the pinned Fleet it installs into `.cache/`, which Worktrees don't share. If your shell exports `NODE_ENV=production`, run the tests with `NODE_ENV=test`, or every React test fails inside `act`.

## Port, token and settings

| | Default | Override |
|---|---|---|
| Server port | `4747`, bound to `127.0.0.1` only | `LOOKOUT_PORT` |
| Vite dev port (`pnpm dev`) | `4748` | `LOOKOUT_DEV_PORT` |
| Settings file | `~/.config/lookout/settings.json` | `LOOKOUT_SETTINGS` (or `XDG_CONFIG_HOME`) |
| Attachments dropped on the composer | `~/.lookout/attachments/` | |
| Mutation token | random on each server start | `LOOKOUT_TOKEN` |
| Review request avatars (WORK-3.9) | fetched from GitHub, kept in `~/.lookout/avatars/` | `LOOKOUT_AVATARS=off` fetches none (initials only) |

The server can start and kill processes, so it doesn't trust CORS alone ([decision 0003](docs/decisions/0003-browser-first-react-stack.md)):

- It answers only to the `Host` values `127.0.0.1:<port>` and `localhost:<port>`, which blocks DNS rebinding.
- It rejects any request whose `Origin` isn't the app's own, or that the browser marks `Sec-Fetch-Site: cross-site`.
- Requests that change something must also carry the app's `Origin` and the token in `X-Lookout-Token`: saving settings (`PUT /api/settings`), starting or dismissing a Session start (`POST /api/launch`, `DELETE /api/launch/:id`), saying what a tab views (`PUT /api/watch`) and sending a message (`POST /api/sessions/:id/send`). The UI fetches the token from `/api/bootstrap`, which other sites can't read.
- Each route caps its body size (16 KiB, more for a start's prompt and a message) and answers an oversized one with a 413.
- The CLIs' output is redacted before it reaches a log, an event or a response: anything token-shaped (`ghp_…`, `github_pat_…`, `Authorization:` headers, `token=…`) is cut.

In `pnpm dev`, the Vite origin is allowed too (`LOOKOUT_DEV_ORIGINS`, set by `scripts/dev.mjs`).

## Productive assumptions

Nothing here is a secret; it's the shape of Productive's setup. A fork for another company changes these:

| What | Where |
|---|---|
| Tasks open in Fantastic Productive, organization `109` | `TASK_URL_BASE` in `shared/work.ts`; the Task-link patterns in `server/work-links.ts` |
| PRs are listed only from `productiveio/*` | `server/work.ts` (`inProductiveio`) and `shared/work.ts` |
| Install commands for Fleet, `tb-session`, `tb-pr` and `tb-prod` | `shared/defaults.ts`; the Fleet one must match the pin in `e2e/pins.json` (a test checks) |
| Default start directory `~/Projects/work` | `shared/settings.ts` |
| Telemetry for Sessions Lookout starts | not Lookout's: the `claude` wrapper in your login shell decides ([decision 0002](docs/decisions/0002-start-sessions-through-a-login-shell.md)) |

## How it fits together

- `server/`: a `node:http` server. While a tab is open, it runs `fleet --local list --json` every 2 s, adds repo, Worktree and branch from `git -C <cwd>` (cached per directory for 30 s), and pushes the changes to the UI over server-sent events (`/api/events`). Every external command is run with an argv array, never through a shell.
- Starting a Session (N, the "+" button, or ⌘N in an installed-app window, since a normal Chrome tab keeps ⌘N for itself): the server runs `fleet --local spawn --backend tmux …` in one of the start directories listed in Settings. Before that, it strips the `CLAUDECODE`, `CLAUDE_CODE_*` and `OTEL_*` variables it inherited, plus `CLAUDE_PID` and `CLAUDE_EFFORT`, so only the login shell's `claude` wrapper decides telemetry ([decision 0002](docs/decisions/0002-start-sessions-through-a-login-shell.md)). A start that Fleet hasn't reported after 15 s shows the last lines of its terminal.
- The Session view (main pane):
  - **Terminal preview:** a drawer that opens on its own when a Session Needs you. While some tab has it open, the server runs `fleet --local peek --lines 40` every second and pushes the plain text to that tab. Each tab tells the server what it views over `PUT /api/watch`, and the server stops following a Session once no tab shows it.
  - **Composer:** sends with `fleet --local send --json --require-empty`, so a message is typed only into an empty input box; otherwise it's held and the composer says why (Enter sends, Shift+Enter adds a line, `i` focuses it). It keeps an unsent draft per Session, and refuses control characters.
  - Sessions that aren't Controllable are view only, with no preview or composer. The chat from the Transcript and the answer buttons use the fork's `messages`, `answer` and `keys` commands.
- `shared/`: types, ordering and the settings schema, used by both sides.
- `web/`: React, Vite, Tailwind 4 and shadcn/ui. Dark mode follows the system.
- `server/fixtures/`: recorded (sanitized) and hand-crafted CLI output for tests.

## Developing and forking

- **Specs come first.** A user-visible feature is built from its spec in `docs/features/<slug>/SPEC.md`; fixes and refactors don't need one. The rules, and the decisions every change has to respect, are in [`AGENTS.md`](AGENTS.md), which Claude Code and Codex read on their own.
- **The pre-push hook** (`.githooks/pre-push`, wired by `pnpm install`) runs `pnpm req-check`, `pnpm test` and `pnpm e2e` before every push. The Behaviour tests need `pnpm e2e:setup`, which builds the pinned Fleet and `tb-session` into `.cache/` (Rust's `cargo`, and `gh` signed in with access to `cli-toolbox`) and installs Playwright's Chromium. `git push --no-verify` is the only way past it.
- **Pins.** `e2e/pins.json` names the Fleet fork revision and the `tb-session` revision the tests run against. Bump both there; a unit test keeps the in-app Fleet install command and this README on the same revision.
- **A missing Fleet capability** is a commit in the fork `dafilipaj/fleet` (branch `lookout`), not a workaround here ([decision 0006](docs/decisions/0006-run-a-fork-of-fleet.md)). Reusable logic goes to `cli-toolbox` as a CLI with `--json` ([decision 0005](docs/decisions/0005-building-blocks-live-outside-lookout.md)).
- **The docs name one person.** Lookout started as a one-person project, so `docs/PLAN.md`, `docs/BACKLOG.md` and the specs record decisions as "agreed with Dario". Read them as the decision log, not as instructions to ask him.
