# Lookout

A personal UI for watching and controlling agent Sessions (Claude Code, Codex) at a glance, built on Building blocks: Fleet, `tb-session`, and a ports CLI.

## Specs come first

How specs work: `docs/README.md`. Terms: `docs/GLOSSARY.md`.

- Don't build a user-visible feature unless its spec (`docs/features/<slug>/SPEC.md`) is `Ready` or `In Progress`. Fixes and refactors don't need a spec.
- Build only what the requirements say. Anything under Non-goals is out, even if it looks easy.
- If the code has to differ from the spec, update the spec first (requirement plus a Changelog line), then the code.
- Name tests after the acceptance criterion they cover: `SIDE-1.2: …`.
- Tick an acceptance criterion only after verifying it: test passing, or seen in the running app.
- Use Glossary terms with their defined meaning. Add a new concept to the Glossary in the same change.
- Decisions that span features live in `docs/decisions/`. Don't contradict an `Accepted` one; propose a new decision that supersedes it.

## Constraints from accepted decisions

- Sessions run in their own tmux session, and the UI never shows tmux ([0001](docs/decisions/0001-tmux-as-hidden-session-host.md)).
- Never run `claude` or another Harness directly: start a login shell in tmux and type the command into it ([0002](docs/decisions/0002-start-sessions-through-a-login-shell.md)).
- The local server binds `127.0.0.1` and checks `Origin` or a token ([0003](docs/decisions/0003-browser-first-react-stack.md)).
- Use Fleet only through its CLI's `--json` output ([0004](docs/decisions/0004-fleet-cli-as-session-layer.md)).
- Fleet comes from the fork `dafilipaj/fleet`, branch `lookout`. A missing Fleet capability is a commit there, not a workaround in Lookout ([0006](docs/decisions/0006-run-a-fork-of-fleet.md)).
- Reusable logic belongs in a Building block in cli-toolbox, not in this repo ([0005](docs/decisions/0005-building-blocks-live-outside-lookout.md)).
- UI icons come only from `lucide-react`, sized and stroked like their neighbours and coloured with theme tokens; never emoji or Unicode symbols. Exceptions: `HarnessIcon`, `StatusMarker`, the chat rail's Marks, and keyboard glyphs in shortcut hints ([0008](docs/decisions/0008-lucide-icons-only.md)).
