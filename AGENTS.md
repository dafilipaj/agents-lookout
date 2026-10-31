# Lookout

A personal UI for watching and controlling agent Sessions (Claude Code, Codex) at a glance, built on Building blocks: Fleet, `tb-session`, and a ports CLI.

## Specs come first

How specs work: `docs/README.md`. Terms: `docs/GLOSSARY.md`. What's next, in order: `docs/PLAN.md`.

- Don't build a user-visible feature unless its spec (`docs/features/<slug>/SPEC.md`) is `Ready` or `In Progress`. Fixes and refactors don't need a spec.
- Build only what the requirements say. Anything under Non-goals is out, even if it looks easy.
- If the code has to differ from the spec, update the spec first (requirement plus a Changelog line), then the code.
- Name tests after the acceptance criterion they cover: `SIDE-1.2: …`.
- Each criterion is tagged `(test)` (an automated test at any layer), `(e2e)` (a Behaviour test, for a behaviour that spans the server and the UI and that a World can check) or `(manual)` (only an eye can judge it: layout, alignment, colour).
- For an `(e2e)` criterion, write the Behaviour test from the criterion first, then the code.
- Tick an acceptance criterion only after verifying it: test passing, or seen in the running app.
- `pnpm req-check` checks the criteria against the tests; a reviewer checks the mapping with `pnpm req-check --feature <CODE>`. It runs in the pre-push hook with `pnpm test`, and with `pnpm e2e` once that exists.
- Use Glossary terms with their defined meaning. Add a new concept to the Glossary in the same change.
- Decisions that span features live in `docs/decisions/`. Don't contradict an `Accepted` one; propose a new decision that supersedes it.

## Constraints from accepted decisions

- Sessions run in their own tmux session, and the UI never shows tmux ([0001](docs/decisions/0001-tmux-as-hidden-session-host.md)).
- Never start a Session by running `claude` or another Harness directly: start a login shell in tmux and type the command into it ([0002](docs/decisions/0002-start-sessions-through-a-login-shell.md)). The one exception is a one-shot `claude -p` with no tools, no session and no settings, started by you ([0013](docs/decisions/0013-one-shot-claude-runs-for-lookouts-own-text.md)).
- The local server binds `127.0.0.1` and checks `Origin` or a token ([0003](docs/decisions/0003-browser-first-react-stack.md)).
- Use Fleet only through its CLI's `--json` output ([0004](docs/decisions/0004-fleet-cli-as-session-layer.md)).
- Fleet comes from the fork `dafilipaj/fleet`, branch `lookout`. A missing Fleet capability is a commit there, not a workaround in Lookout ([0006](docs/decisions/0006-run-a-fork-of-fleet.md)).
- Reusable logic belongs in a Building block in cli-toolbox, not in this repo ([0005](docs/decisions/0005-building-blocks-live-outside-lookout.md)).
- UI icons come only from `lucide-react`, sized and stroked like their neighbours and coloured with theme tokens; never emoji or Unicode symbols. Exceptions: `HarnessIcon`, `StatusMarker`, the chat rail's Marks, keyboard glyphs in shortcut hints, Work's `TaskStatusDot` and a person's `Avatar` ([0008](docs/decisions/0008-lucide-icons-only.md), [0012](docs/decisions/0012-task-status-dots-and-author-avatars.md)).
- UI sizes and colours come from the design system: the five type steps and colour tokens by meaning, from `index.css`, with no raw colours or Tailwind sizes. New UI reuses `components/ui/`, and a missing piece is added to the system in the same change ([0009](docs/decisions/0009-one-design-system-guarded-by-tests.md)).
