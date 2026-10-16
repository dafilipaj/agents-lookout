# Lookout

A personal web UI for watching and controlling local agent Sessions (Claude Code, Codex). How it's designed: [`docs/README.md`](docs/README.md), terms in [`docs/GLOSSARY.md`](docs/GLOSSARY.md), rules in [`AGENTS.md`](AGENTS.md).

## Prerequisites

- **Node 25** and **pnpm 10**. The server runs its TypeScript directly through Node's type stripping, with no build step.
- **Fleet**, the Session layer ([decision 0004](docs/decisions/0004-fleet-cli-as-session-layer.md)). Install it pinned to the revision Lookout is tested against:

  ```sh
  cargo install --git https://github.com/ilucin/fleet --rev 38a461c --locked fleet
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

Checks: `pnpm test`, `pnpm typecheck`, `pnpm lint`.

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
- Requests that change something (`PUT /api/settings` today) must also carry the app's `Origin` and the token in `X-Lookout-Token`. The UI fetches the token from `/api/bootstrap`, which other sites can't read.

In `pnpm dev`, the Vite origin is allowed too (`LOOKOUT_DEV_ORIGINS`, set by `scripts/dev.mjs`).

## How it fits together

- `server/`: a `node:http` server. While a tab is open, it runs `fleet --local list --json` every 2 s, adds repo, Worktree and branch from `git -C <cwd>` (cached per directory for 30 s), and pushes the changes to the UI over server-sent events (`/api/events`). Every external command is run with an argv array, never through a shell.
- Starting a Session (⌘N or "+"): the server runs `fleet --local spawn --backend tmux …` in one of the start directories listed in Settings. Before that, it strips the `CLAUDECODE`, `CLAUDE_CODE_*` and `OTEL_*` variables it inherited, plus `CLAUDE_PID` and `CLAUDE_EFFORT`, so only the login shell's `claude` wrapper decides telemetry ([decision 0002](docs/decisions/0002-start-sessions-through-a-login-shell.md)). A start that Fleet hasn't reported after 15 s shows the last lines of its terminal.
- `shared/`: types, ordering and the settings schema, used by both sides.
- `web/`: React, Vite, Tailwind 4 and shadcn/ui. Dark mode follows the system.
- `server/fixtures/fleet/`: recorded (sanitized) and hand-crafted `fleet list --json` output for tests.
