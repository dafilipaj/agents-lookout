# Plan

What's being worked on next, in order. Each item points at where its truth lives: a spec's Requirement, a Backlog entry, or a bug described here.

- **Status lives in the specs**, not here: a criterion is done when it's ticked in its `SPEC.md`. This file only says what comes next and why.
- **Bugs and small fixes** don't need a spec (AGENTS.md), so this is where they're tracked until they're fixed.
- **Raw feedback** is captured first in Dario's notes, then triaged into an item here, a spec change or a Backlog entry.
- **When an item is done,** remove it. Git history keeps it.
- **When an item is dropped,** move it to the Backlog's "Dropped" section with the reason, so it isn't proposed again.

Updated: 2026-10-22.

## Now

6. **Rename a running Session** (VIEW-5.12–5.15, built 2026-10-22). Left: tick VIEW-5.15 once a rename from the header has been seen reaching the Session in the running app. Researched: Claude Code has `/rename` (since 2.0.64) and Codex 0.163 has `/rename <name>`; neither asks for a confirmation. Fleet already has `fleet rename <id> <title> --json` (`crates/fleet/src/cli/commands.rs:472`), which types the command, renames the tmux host to match when it's the Session's own and confirms from the registry. Decided with Dario:
   - the header title is edited in place: a pencil on hover or focus, click or Enter to edit, Enter or leaving the field saves, Esc cancels, at most 64 characters;
   - only for a live, Controllable, Idle Session with a session ID, Claude Code and Codex alike; no rename in the sidebar and no shortcut;
   - Lookout calls `fleet rename --require-empty` and reads the new name from the next `fleet list`, not from the Transcript;
   - a Fleet fork commit adds `--require-empty` to `rename`, since it would otherwise type into a box Fleet can't read; Lookout's pin moves once it's pushed.
   - Follow-up in cli-toolbox: tb-session shows a renamed Claude Code Session under its first reply, not its name.
   - Check live: how soon the name reaches `fleet list`, a Codex Session before its first prompt, whether Codex's own title overwrites the name, and names with unusual characters.

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
7. **A Codex question shows neither in the chat nor as Esc** (bug, needs a repro). Fleet marks a Codex `request_user_input` as waiting (`harness.rs:1030`), so the Session should Need you and VIEW-4.5's Esc should show.
8. **Running Subagents under their Session** (SIDE, new Requirement; maybe VIEW too). From Dario's earlier testing: a Session's row should show how many Subagents it has running, and maybe the main pane too. Today a Subagent shows only once it's finished, as a result row (VIEW-1.3). Researched 2026-10-22, feasible:
   - Claude Code (2.1.301 and later) writes a `subagents/agent-<id>.meta.json` beside the Transcript when a Subagent starts and adds `finished: true` when it ends, for foreground, background and nested ones. Running = no `finished`, written after the Session's process started (so a crashed or resumed Session's leftovers don't count). The file is undocumented.
   - Codex does have Subagents: a child rollout names its parent thread, and it's running while its last turn event is `task_started`.
   - Home: a `subagents` count in Fleet's `list --json`, like `effort` (a fork commit); Lookout's server reads no Transcripts. About 2–3 days in all.
   - "Launches minus finish notifications" is unreliable: it misses nested Subagents and revived ones.
   - Found on the way: Fleet's Codex pairing (`harness.rs:883`) may pick a child rollout, and Fleet drops task notifications Claude takes mid-turn, so some VIEW-1.3 result rows go missing.
   - Check live: a stopped or revived Subagent, a Session exiting or killed mid-run, foreground mode, Codex pairing.
9. **Switch the Effort from the status line** (VIEW, amend VIEW-6's Non-goals). From Dario's earlier testing, as a second step after VIEW-5.11: the Effort becomes a menu of the levels, like VIEW-6's model menu. VIEW-6 rules out effort today. Build it after VIEW-6 and item 5, since they share the menu and the levels. Claude Code's `/effort <level>` asks for VIEW-4.9's confirmation while the prompt cache is warm.

## Later, or waiting on something

- **VIEW-6, switch the model from the status line:** specced, nothing built yet. It switches the model from the status line instead of typing `/model`.
- **Fake Harnesses (TEST-1.4):** WORK-1.11, WORK-5.1 and WORK-5.2 stay unticked until a World can start a Session; VIEW-4's and VIEW-6.5's `(e2e)` retags wait on them too.
- **WORK-4.9 under real load:** an urgent Link search can still wait on tb-session's index lock. It's covered by a unit-level model only (third review of WORK-4 and WORK-5, 2026-10-21).
- **Fleet fork Known gaps (VIEW Technical approach):** a per-prompt occurrence token in `answer --list`, and `keys --unless-prompt` for the Esc and Stop races.
- **ITERM:** Draft, with one blocking question (`-CC` or a plain attach). It's also the answer to "Show terminal can't be typed into" (Dario's earlier testing): the preview is read-only on purpose, and a live terminal in the app is a Non-goal ([0001](decisions/0001-tmux-as-hidden-session-host.md)). Opening the Session in iTerm2 is the interactive route.
- **Code diffs in the chat** (research). From Dario's earlier testing: an Edit or Write shows only as a tool-call line, not as what it changed. Find out whether it's worth it and how: the Transcript's `Edit` input has `old_string` and `new_string`, and its result has a structured patch. Decide whether diffs are collapsed by default, inline or in a side panel, and what Codex's `apply_patch` gives.
- **A Codex model menu:** waits for Codex 0.164 (Backlog).

## Open questions

Asked on 2026-10-21; answers go into the item they belong to.

1. Item 2: does a row expand in place (recommended: the Session in the main pane stays visible), or show its details in the main pane, or in a hover card?
2. Item 5: is "Skip permissions" checked by default for both Harnesses, or only for Claude Code, given that Codex's flag also turns off its sandbox? Claude Code Sessions already start in `auto` mode (`~/.claude/settings.json`), and hooks run in both.
3. Item 5: does the launcher remember the last effort and permission choice per Harness, as it remembers the model (LAUNCH-1.2; recommended), or reset to high and checked every time?
5. Item 7: which Codex Session showed it?
