# Lookout

A personal web UI for watching and controlling local agent Sessions (Claude Code, Codex). How it's designed: [`docs/README.md`](docs/README.md), terms in [`docs/GLOSSARY.md`](docs/GLOSSARY.md), rules in [`AGENTS.md`](AGENTS.md).

## Prerequisites

- **Node 25** and **pnpm 10**. The server runs its TypeScript directly through Node's type stripping, with no build step.
- **Fleet**, the Session layer ([decision 0004](docs/decisions/0004-fleet-cli-as-session-layer.md)), from the fork `dafilipaj/fleet`, branch `lookout` ([decision 0006](docs/decisions/0006-run-a-fork-of-fleet.md)). Install it pinned to the revision Lookout is tested against (the Fleet `rev` in `e2e/pins.json`):

  ```sh
  cargo install --git https://github.com/dafilipaj/fleet --rev 71747ac --locked fleet
  ```

  Lookout looks for `fleet` on `PATH`, then in `~/.cargo/bin`. Set `LOOKOUT_FLEET_BIN` to use another binary.
- **tmux**, the hidden Session host ([decision 0001](docs/decisions/0001-tmux-as-hidden-session-host.md)). Only Sessions in tmux or iTerm2 are Controllable.

## Run

```sh
pnpm install
pnpm dev          # server + Vite with hot reload → http://127.0.0.1:4748
pnpm build        # builds the UI into dist/web
pnpm start        # server serves the built UI → http://127.0.0.1:4747
```

Checks: `pnpm test`, `pnpm typecheck`, `pnpm lint`. Run `pnpm e2e:setup` once per checkout first: `pnpm test` runs the chat against the pinned Fleet it installs into `.cache/`, which Worktrees don't share.

## Port, token and settings

| | Default | Override |
|---|---|---|
| Server port | `4747`, bound to `127.0.0.1` only | `LOOKOUT_PORT` |
| Vite dev port (`pnpm dev`) | `4748` | `LOOKOUT_DEV_PORT` |
| Settings file | `~/.config/lookout/settings.json` | `LOOKOUT_SETTINGS` (or `XDG_CONFIG_HOME`) |
| Mutation token | random on each server start | `LOOKOUT_TOKEN` |

The server can start and kill processes, so it doesn't trust CORS alone ([decision 0003](docs/decisions/0003-browser-first-react-stack.md)):

- It answers only to the `Host` values `127.0.0.1:<port>` and `localhost:<port>`, which blocks DNS rebinding.
- It rejects any request whose `Origin` isn't the app's own, or that the browser marks `Sec-Fetch-Site: cross-site`.
- Requests that change something must also carry the app's `Origin` and the token in `X-Lookout-Token`: saving settings (`PUT /api/settings`), starting or dismissing a Session start (`POST /api/launch`, `DELETE /api/launch/:id`), saying what a tab views (`PUT /api/watch`) and sending a message (`POST /api/sessions/:id/send`). The UI fetches the token from `/api/bootstrap`, which other sites can't read.
- Each route caps its body size (16 KiB, more for a start's prompt and a message) and answers an oversized one with a 413.

In `pnpm dev`, the Vite origin is allowed too (`LOOKOUT_DEV_ORIGINS`, set by `scripts/dev.mjs`).

## How it fits together

- `server/`: a `node:http` server. While a tab is open, it runs `fleet --local list --json` every 2 s, adds repo, Worktree and branch from `git -C <cwd>` (cached per directory for 30 s), and pushes the changes to the UI over server-sent events (`/api/events`). Every external command is run with an argv array, never through a shell.
- Starting a Session (N, the "+" button, or ⌘N in an installed-app window, since a normal Chrome tab keeps ⌘N for itself): the server runs `fleet --local spawn --backend tmux …` in one of the start directories listed in Settings. Before that, it strips the `CLAUDECODE`, `CLAUDE_CODE_*` and `OTEL_*` variables it inherited, plus `CLAUDE_PID` and `CLAUDE_EFFORT`, so only the login shell's `claude` wrapper decides telemetry ([decision 0002](docs/decisions/0002-start-sessions-through-a-login-shell.md)). A start that Fleet hasn't reported after 15 s shows the last lines of its terminal.
- The Session view (main pane):
  - **Terminal preview:** a drawer that opens on its own when a Session Needs you. While some tab has it open, the server runs `fleet --local peek --lines 40` every second and pushes the plain text to that tab. Each tab tells the server what it views over `PUT /api/watch`, and the server stops following a Session once no tab shows it.
  - **Composer:** sends with `fleet --local send --json --require-empty`, so a message is typed only into an empty input box; otherwise it's held and the composer says why (Enter sends, Shift+Enter adds a line, `i` focuses it). It keeps an unsent draft per Session, and refuses control characters.
  - Sessions that aren't Controllable are view only, with no preview or composer. The chat from the Transcript and the answer buttons wait on Fleet's `messages`, `answer` and `keys` commands.
- `shared/`: types, ordering and the settings schema, used by both sides.
- `web/`: React, Vite, Tailwind 4 and shadcn/ui. Dark mode follows the system.
- `server/fixtures/fleet/`: recorded (sanitized) and hand-crafted `fleet list --json` output for tests.
