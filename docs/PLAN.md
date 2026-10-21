# Plan

What's being worked on next, in order. Each item points at where its truth lives: a spec's Requirement, a Backlog entry, or a bug described here.

- **Status lives in the specs**, not here: a criterion is done when it's ticked in its `SPEC.md`. This file only says what comes next and why.
- **Bugs and small fixes** don't need a spec (AGENTS.md), so this is where they're tracked until they're fixed.
- **Raw feedback** is captured first in Dario's notes, then triaged into an item here, a spec change or a Backlog entry.
- **When an item is done,** remove it. Git history keeps it.

Updated: 2026-10-21.

## Now

1. **Tick VIEW-4.9 once seen in the running app.** Send `/effort high` or `/model opus` from the composer while the prompt cache is warm: Claude Code's "Change effort level?" or "Switch model?" confirmation should show as buttons, and "Yes" should apply it. Its Fleet change is in the pin (8b670be).

## Next: specs first

2. **Work rows: select, don't act** (WORK-2.4 and UX, amend). From Dario's testing: a click on a row selects or resumes its Session, which happens by accident, and there's no way to see a Task's details first. The open-in-browser buttons are too small, and the Session marker (`CircleDot`) doesn't read as a Session. Proposal:
   - a click or Enter only selects and expands the row: project, status, due date, the start of the description, Linked PRs with CI, Linked Sessions;
   - every action is a labelled button: "Open Session", "Resume", "Start Session", "Open in Fantastic";
   - Linked Sessions show as a chip like a Session sidebar row: Harness icon, name, Status colour, or "2 Sessions";
   - buttons grow from about 14 px to 20 px icons with a 28 px target.
3. **Gap 1: `task_ids` in tb-pr** (cli-toolbox, WORK Dependencies). No tb-pr has them yet (0.3.1 is the latest release), so no PR is Linked to a Task and Work says "Task links need a newer tb-pr". It also unblocks WORK-3.3.
4. **TOOLS: the CLIs Lookout runs and their updates** (Backlog TOOLS, becomes a spec). Checked 2026-10-21: claude 2.1.306, codex 0.163.0, tb-pr 0.3.1, tb-prod 1.2.0 and tb-session 0.3.0 were all the latest. The "newer tb-pr" note above is the kind of thing TOOLS should explain.
5. **Launcher: effort and skipping permissions** (LAUNCH, amend its Non-goals). An effort picker next to the model, default high, and a "Skip permissions" checkbox, checked by default. Fleet's `spawn` needs to pass them on (a commit in the fork, 0006):
   - Claude Code: `--effort low|medium|high|xhigh|max` and `--dangerously-skip-permissions`;
   - Codex: `-c model_reasoning_effort=<level>` and `--dangerously-bypass-approvals-and-sandbox`, which also turns off Codex's sandbox.
6. **Rename a running Session** (SIDE or VIEW, new Requirement). First check what Claude Code offers for renaming a running session. Codex has no Session name (LAUNCH: `--name` only names the Session host).
7. **A Codex question shows neither in the chat nor as Esc** (bug, needs a repro). Fleet marks a Codex `request_user_input` as waiting (`harness.rs:1030`), so the Session should Need you and VIEW-4.5's Esc should show.

## Later, or waiting on something

- **VIEW-6, switch the model from the status line:** specced, nothing built yet. It switches the model from the status line instead of typing `/model`.
- **Fake Harnesses (TEST-1.4):** WORK-1.11, WORK-5.1 and WORK-5.2 stay unticked until a World can start a Session; VIEW-4's and VIEW-6.5's `(e2e)` retags wait on them too.
- **WORK-4.9 under real load:** an urgent Link search can still wait on tb-session's index lock. It's covered by a unit-level model only (third review of WORK-4 and WORK-5, 2026-10-21).
- **Fleet fork Known gaps (VIEW Technical approach):** a per-prompt occurrence token in `answer --list`, and `keys --unless-prompt` for the Esc and Stop races.
- **ITERM:** Draft, with one blocking question (`-CC` or a plain attach).
- **A Codex model menu:** waits for Codex 0.164 (Backlog).

## Open questions

Asked on 2026-10-21; answers go into the item they belong to.

1. Item 2: does a row expand in place (recommended: the Session in the main pane stays visible), or show its details in the main pane, or in a hover card?
2. Item 5: is "Skip permissions" checked by default for both Harnesses, or only for Claude Code, given that Codex's flag also turns off its sandbox? Claude Code Sessions already start in `auto` mode (`~/.claude/settings.json`), and hooks run in both.
3. Item 5: does the launcher remember the last effort and permission choice per Harness, as it remembers the model (LAUNCH-1.2; recommended), or reset to high and checked every time?
4. Item 6: is a Codex Session's name a label in Lookout only, or is Codex left out?
5. Item 7: which Codex Session showed it?
