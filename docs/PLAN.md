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

12. **The design system** (DS, [spec](features/design-system/SPEC.md), In Progress; [0009](decisions/0009-one-design-system-guarded-by-tests.md), Accepted). From the design review of 2026-10-22 and Dario's answers to it: one type scale (11, 12, 13, 14 and 15 px; nothing smaller, no half pixels), colour tokens by meaning (Status colours only for a Status, amber only to act on, a neutral info tone for staleness, a highlight for search hits), and shared components in `components/ui/` (Alert, Session marker, Loading, icon button, empty state, chip, key, command), each guarded by a test as 0008's icons are. It also takes the review's small ones: the Session list reachable by Tab, a Busy pulse only for 10 s after the change, and a terminal preview height that's remembered and fits a short window. All three slices are built: slice 1 (DS-1 to DS-3: the scale, the tokens, colour by meaning and their guard), slice 2 (DS-4 to DS-8: Alert, Session marker, Loading with "No Sessions running", icon button, empty state, command, chip and key, each guarded, with DS-3.6 closed by History's and Work's Status markers) and slice 3 (DS-9 to DS-11: the Session list takes keyboard focus, Busy pulses only for 10 s after the change, the terminal preview's height is kept per Session and resized from a handle). Every `(test)` criterion is ticked; the `(manual)` ones (DS-1.3, 3.7, 4.4, 7.4, 9.3, 11.4) wait for a look in the browser, and then DS is Done. Build it before the items below, which then use its pieces.
13. **Sidebar rows show what varies** (SIDE-2.1 and UX, amend; the design review's suggestion 1). Almost every row reads `work · main`, while the numbers that change (age, context, the Subagent count) are the smallest text at the row's edge. Proposal: show `repo · branch` only when it isn't the Start directory's default (a Worktree, another branch), and give a Busy row's second line to what it's doing; keep the full location in the tooltip and the status line (VIEW-5.5). The Key decision "Worktree first, branch as fallback" still holds: Worktrees still show. The muted Harness logo is DS's (DS-3.1), not this item's.
2. **Select, then act: Work rows and History results** (WORK-2.4 and UX, HIST-3.1 and its Key decision "Click resumes", amend; one spec for both, with the design review's suggestion 8). From Dario's testing: a click on a Work row selects or resumes its Session, which happens by accident, and there's no way to see a Task's details first. History has the same risk, worse: a stray click resumes a past Session, which starts a Session host. The open-in-browser buttons are too small. Proposal:
   - a click or Enter only selects and expands the row: project, status, due date, the start of the description, Linked PRs with CI, Linked Sessions;
   - every action is a labelled button: "Open Session", "Resume", "Start Session", "Open in Fantastic";
   - in History, a click selects a result and shows a Resume button; Enter or the button resumes (HIST-2.7 already keeps keyboard moves from resuming);
   - Linked Sessions show as a chip like a Session sidebar row: Harness icon, name, Status colour, or "2 Sessions", built on DS's Session marker (DS-5), which already replaces the `CircleDot` that didn't read as a Session;
   - buttons grow from about 14 px to 20 px icons with a 28 px target.
3. **Gap 1: `task_ids` in tb-pr** (cli-toolbox, WORK Dependencies). No tb-pr has them yet (0.3.1 is the latest release), so no PR is Linked to a Task and Work says "Task links need a newer tb-pr". It also unblocks WORK-3.3.
4. **TOOLS: the CLIs Lookout runs and their updates** (Backlog TOOLS, becomes a spec). Checked 2026-10-21: claude 2.1.306, codex 0.163.0, tb-pr 0.3.1, tb-prod 1.2.0 and tb-session 0.3.0 were all the latest. The "newer tb-pr" note above is the kind of thing TOOLS should explain.
5. **Launcher: effort and skipping permissions** (LAUNCH, amend its Non-goals). An effort picker next to the model, default high, and a "Skip permissions" checkbox, checked by default. Fleet's `spawn` needs to pass them on (a commit in the fork, 0006):
   - Claude Code: `--effort low|medium|high|xhigh|max` and `--dangerously-skip-permissions`;
   - Codex: `-c model_reasoning_effort=<level>` and `--dangerously-bypass-approvals-and-sandbox`, which also turns off Codex's sandbox.
7. **A Codex question shows neither in the chat nor as Esc** (bug, needs a repro). Fleet marks a Codex `request_user_input` as waiting (`harness.rs:1030`), so the Session should Need you and VIEW-4.5's Esc should show.
8. **Running Subagents under their Session** (SIDE-9 and VIEW-8, specced and grilled 2026-10-22). From Dario's earlier testing: a Session's row should show how many Subagents it has running, and the main pane too. Today a Subagent shows only once it's finished, as a result row (VIEW-1.3). Specced: the row shows the running count with a Subagent icon, before the age; the status line shows `2 subagents` in Busy's blue while any run, then `3 subagents done` in Idle's grey until your next prompt (the current Turn), then nothing; not a Status, so an Idle Session stays Idle. Source: a `subagents: {running, finished}` field in the Fleet fork's `list --json`, read like `effort`, from Claude Code 2.1.301's `subagents/*.meta.json` sidecars (running = no `finished`, written after the Session's process started) and Codex child rollouts in a turn, with the Turn's start from the Transcript tail Fleet already reads. Two fork commits, Claude Code first; about 2–3 days in all. The SIDE spec's Technical approach has the Known gaps and the eight live checks still owed. The two Fleet problems found on the way are items 10 and 11.
10. **Fleet can pair a Codex Session with a child agent's rollout** (bug in the fork, proposed 2026-10-22 from item 8's research; needs a live repro). Fleet's `assign` (`core/harness.rs:883-926`) pairs a Codex process with no id on its command line to the newest rollout in its cwd created after it started, and `transcript_ref` (`:744`) doesn't look at `session_meta.source`. A child agent's rollout (`source.subagent.thread_spawn`, from `spawn_agent`) has the parent's cwd and is newer, so an interactive Codex Session that spawns agents may get a child's id: its chat (VIEW-1) would show the child's thread and item 8's count would be 0. Fix in the fork ([0006](decisions/0006-run-a-fork-of-fleet.md)): skip rollouts whose `source` names a parent thread when pairing. Most multi-agent rollouts seen were headless `exec` runs, which Fleet doesn't list, so first check a Codex TUI Session that runs `spawn_agent`.
11. **Subagent results taken mid-turn never show in the chat** (VIEW-1.3, bug in the fork, proposed 2026-10-22 from item 8's research). A task notification Claude Code takes while a turn runs arrives as an attachment (`queued_command` with `commandMode: "task-notification"`), and `core/transcript.rs:768-790` keeps only `commandMode: "prompt"`, so those never become `system` entries: about 40% of the notifications in the research's sample, so some VIEW-1.3 rows and their Marks (VIEW-1.11) are missing. A fixture at `transcript.rs:1934` holds one, so check whether that was deliberate before changing it. Fix in the fork (0006): emit the attachment form as a `system` entry like the `user` form, matched the same way.

## Later, or waiting on something

- **Fake Harnesses (TEST-1.4):** WORK-1.11, WORK-5.1 and WORK-5.2 stay unticked until a World can start a Session; VIEW-4's, VIEW-6.5's and VIEW-7.5's `(e2e)` retags wait on them too.
- **WORK-4.9 under real load:** an urgent Link search can still wait on tb-session's index lock. It's covered by a unit-level model only (third review of WORK-4 and WORK-5, 2026-10-21).
- **Fleet fork Known gaps (VIEW Technical approach):** a per-prompt occurrence token in `answer --list`, and `keys --unless-prompt` for the Esc and Stop races.
- **ITERM:** Draft, with one blocking question (`-CC` or a plain attach). It's also the answer to "Show terminal can't be typed into" (Dario's earlier testing): the preview is read-only on purpose, and a live terminal in the app is a Non-goal ([0001](decisions/0001-tmux-as-hidden-session-host.md)). Opening the Session in iTerm2 is the interactive route.
- **Code diffs in the chat** (research). From Dario's earlier testing: an Edit or Write shows only as a tool-call line, not as what it changed. Find out whether it's worth it and how: the Transcript's `Edit` input has `old_string` and `new_string`, and its result has a structured patch. Decide whether diffs are collapsed by default, inline or in a side panel, and what Codex's `apply_patch` gives.
- **A Codex model menu:** waits for Codex 0.164 (Backlog).

## Open questions

Asked on 2026-10-21; answers go into the item they belong to. Item 8's nine questions were answered on 2026-10-22 and are in the SIDE spec's Key decisions.

1. Item 2: does a row expand in place (recommended: the Session in the main pane stays visible), or show its details in the main pane, or in a hover card?
2. Item 5: is "Skip permissions" checked by default for both Harnesses, or only for Claude Code, given that Codex's flag also turns off its sandbox? Claude Code Sessions already start in `auto` mode (`~/.claude/settings.json`), and hooks run in both.
3. Item 5: does the launcher remember the last effort and permission choice per Harness, as it remembers the model (LAUNCH-1.2; recommended), or reset to high and checked every time?
5. Item 7: which Codex Session showed it?
