# Backlog

Ideas worth building later that aren't specced yet. When one is picked up, it becomes a requirement in a feature spec (or a new spec), and its entry here is removed. Ideas discussed and decided against are under [Dropped](#dropped), with the reason.

## Live activity text from the terminal (VIEW)

- **What:** while a Session works, show what the Harness itself shows in its spinner line, e.g. Claude Code's `✻ Pondering… (12s · ↓ 1.2k tokens · esc to interrupt)` or Codex's `• Working (12s • esc to interrupt)`: the verb, elapsed time and token count.
- **Why:** the chat's "Working…" row (VIEW-1) only knows that the Session is busy and for how long. The spinner line also shows what it's doing and how much it has produced.
- **How:**
  - Fleet already reads the screen for Codex approvals. It would add an `activity` field (`{text, elapsed_s?, tokens?}` or `null`) to `list`/`peek --json`, parsed from the spinner line, in the fork, so it stays upstreamable.
  - Lookout then shows that text in the "Working…" row and keeps its own timer as the fallback.
- **Costs and risks:**
  - It breaks whenever Claude Code or Codex changes its spinner format, so it needs fixtures per Harness version.
  - It costs one extra screen read per poll for every busy Session.
- **Added:** 2026-10-17, after the first live use of the chat.

## What's loaded into a Session (CTX)

- **What:** per Session, what its Harness has loaded:
  - instruction files (`CLAUDE.md`/`AGENTS.md` chain and `@` imports);
  - memory;
  - hooks, plugins, skills and MCP servers;
  - permission mode and model.
  - For Codex: `config.toml`, its profile, the `AGENTS.md` chain, approval and sandbox mode.
- **Why per Session:** it depends on the Harness, the start directory and the environment (e.g. `CLAUDE_CONFIG_DIR`), so a global settings page would be wrong for most Sessions.
- **How (proposal):** two sources, always labelled:
  - **Resolved:** Lookout or a CLI applies the Harness's loading rules to the Session's directory. This can drift from what the Harness really does.
  - **Observed:** what the Transcript shows actually happened, e.g. hook runs are recorded as attachments.
- **Open:** the most design-heavy idea here; grill it before speccing.
- **Added:** 2026-10-17.

## Hide a Harness you don't use (USAGE)

- **What:** when a Harness isn't installed, leave it out of the usage strip instead of showing "Codex: not installed" (USAGE-2.2). The details could still say it's not installed.
- **Why:** it only matters if Lookout is ever shared with someone who doesn't use Codex: for them the line is noise on every screen. For Dario, who uses both, USAGE-2.2 stays as it is.
- **How (proposal):** a USAGE spec change with a Changelog line first; maybe a Settings toggle per Harness rather than hiding on "not installed" alone, since a leftover `~/.codex` makes Fleet think Codex is installed.
- **Added:** 2026-10-17, from the review of the TEST spec.

## Workflow editor: agents and the order they run in (FLOW)

- **What:** define agents and workflows in Lookout, then run a workflow on a piece of work and watch it go.
  - An agent: its role, Harness, model, instructions and what it may do.
  - A workflow: the steps that run agents, in sequence or in parallel, with human gates, review-and-fix loops with a cap, and a rule for when it's done.
  - The steps are configurable. The reference is "The Factory" (https://claude.ai/artifact/43aXTVN2MmPjKCRP7cBPvT?sk=Xpye2QR9x0YwrWgu4c-d7Q):
    - Plan: triage into numbered criteria, an optional spec and spec review, then a gate.
    - Build: a coder in a worktree, with tests that fail before and pass after.
    - Review: two reviewers in parallel, then a judge, then at most 3 fix rounds.
    - Test, in the running app with evidence.
    - Ship: a gate, then a draft PR, then PR events.
    - Watch: deploy checkpoints.
    - Retro: daily, proposing changes to the factory itself.
  - The Factory's job types (work, slim, research, pr-review…) are recipes of steps.
- **Why:** today this runs by hand in one Claude Code Session: narrow agents build, Codex or Opus reviews in up to 3 rounds, and Dario approves each commit and merge. Lookout shows the Sessions but can't define, start or follow such a sequence.
- **Status:** a large feature. It needs a thorough grilling and a full spec before anything is built. Many details are open, among them:
  - **Agents:** what an agent is (Harness, model, prompt, permissions, tools), and where definitions live (files in a repo, Lookout's settings, or both).
  - **Running:** what drives a run (a lead Session, Lookout's server or Fleet), and what happens when Lookout restarts or a Session dies mid-run.
  - **Steps:** their kinds (agent, parallel group, gate, capped loop, routing on a verdict), and how results pass between them (files, a verdict line, criteria rows).
  - **Safety:** which step may commit, push, open a PR or post, enforced outside the agents rather than by their prompts.
  - **Editing:** a visual editor, a recipe file with a preview, or both.
  - **Following a run:** its steps, verdicts and evidence, and how runs show next to Sessions, History and WORK's Tasks and PRs.
  - **Costs and limits:** usage limits (USAGE), falling back to another model when one runs out, and stopping a run.
  - **Inputs:** a Productive Task, a PR, or a typed brief.
- **Builds on:**
  - LAUNCH, to start Sessions;
  - VIEW-4's answering and the send guard;
  - WORK's Tasks and PRs;
  - the Fake Harnesses (TEST-1.4), to test runs without real agents.
- **Added:** 2026-10-19, from Dario.
- **Direction (2026-10-30, Dario):** the engine is a CLI, Lookout is its viewer. From reading Stjepan's public snapshot of his factory, [`d4be4st/glados`](https://github.com/d4be4st/glados) (a `factory` CLI: job recipes in YAML, a step ledger, gates with the human's words stored verbatim, Claude Code hooks that block commit, push, PR edits and merge until the gate is approved, a Postgres event log, a scheduler with pollers, a dash on :4281):
  - **Not the factory itself.** It's an orchestrator, a policy engine and a process in one, in Node, tied to Postgres, herdr, a `workspaces` CLI, the Cursor CLI, two machines and Claude Code's hooks. It doesn't fit cli-toolbox's bar (one responsibility, fetch and verify facts, the agent decides) and it's Claude-only, against the agent-agnostic harness decision.
  - **What to build instead: a thin, agent-agnostic record keeper in cli-toolbox, `tb-flow`.** Workflow definitions are YAML files in a repo (`workflows/*.yaml`; a schema collapsed from his `elements.yaml` and `types/*.yaml`: `steps[]` with `id`, `runs` as lead, `agent:<name>` or human, `requires`, `optional`, `evidence: required`; `gates[]`; a `done` rule) that the CLI only validates and renders: `check`, `list`, `show <name> --json`. Runs are the CRUD surface, in local SQLite like tb-session: `run new <workflow> --brief`, `step <id> start|done|failed --note --evidence <file>`, `gate open|decide --words`, `show --json`, `events`. Enforcement is one exit code, `gate check <name>`, for git hooks, CI and the PR gate hook, so any Harness can drive a run without Claude hooks.
  - **CRUD over definitions is the wrong surface:** a definition lives in git and is edited and reviewed there; the CLI adds `check` and `show`, not `create` and `delete`. The value is in runs and in gates that something outside the agent refuses to let past.
  - **A standard needs a second consumer.** Three vocabularies exist already (his `elements.yaml` and `types/*.yaml`, `p-dev:loop`'s roster, Claude Code's Workflow scripts). The YAML and the run commands go in a one-page spec grilled with Stjepan first; the test of the standard is whether his scheduler, pollers and soak can sit on top of `tb-flow`.
  - **Lookout's part:** runs and open gates from `tb-flow show --json` and `events`, shown beside Sessions, History and WORK's Tasks and PRs, the same way Lookout reads the other tb CLIs. No run engine in Lookout's server. This answers "Running" and "Safety" above; "Agents" and "Editing" stay open.
  - **Also worth borrowing on their own:** his evidence-table validator (a coder report is refused unless its evidence covers every criterion; pairs with the PR testing-proof rule) and a soak watcher as a `tb-bug` command (watch a release or PR for N hours and report new errors). His dash overlaps Lookout; raise with Stjepan before either side builds more.

## Needs you while you look elsewhere: a toast and a count (SIDE)

- **What:**
  - an in-app toast at the top of the main pane when a Session starts to Need you while another is selected: "<title> needs you · ⌘J", gone on its own after a few seconds, or at once on ⌘J;
  - a count of the Sessions that Need you in the Filter bar, e.g. a small amber `2` beside `+`, with ⌘J in its tooltip.
- **Why:** inside the app the only cue is the amber rows themselves. With many rows and the list scrolled, a Needs you row below the fold is invisible, and hover-freeze (SIDE-3.4) can keep it there while the pointer rests on the sidebar. The tab-title count (SIDE-3.3) helps only when the tab is in the background. From the design review of 2026-10-22 (suggestion 6), the main loop's "notice while elsewhere" step.
- **How (proposal):**
  - a SIDE UX addition: the Non-goal is OS notifications, not in-app ones, so nothing is contradicted;
  - the count needs no read of its own: the Session list is always fresh, unlike the Dropped count on the Work button;
  - the toast is a polite live region that announces the Session once, never a ticking timer;
  - built from the design system's pieces (DS): a Status chip for the count, Needs you's tokens for the toast.
- **Costs and risks:** a toast that shows while you're typing an answer elsewhere is a distraction; it should never take focus, and maybe not show while the composer has focus.
- **Added:** 2026-10-22, from the design review; Dario: not now.

## Narrow widths: collapse columns instead of crushing them (SIDE, VIEW)

- **What:** below about 1000 px the layout stops working rather than degrading. At 560 px with History open the main pane is 0 px wide. At 900 px the header's title and every status-line part are cut to one or two letters.
- **Why:** half of a 13-inch screen is a real width, and WCAG 1.4.10 asks for reflow. Dario uses Lookout full screen, so not now.
- **How (proposal, from the design review of 2026-10-22, suggestion 2):**
  - Keep SIDE-8's one grid, whose reason (lines that line up by construction) still holds, but change which columns it holds by width:
    - below about 1024 px, the right sidebar becomes an overlay over the main pane;
    - below about 768 px, the Session sidebar collapses to a 40 px rail of Status markers, titles in tooltips, with `/` or a click expanding it;
    - the main pane never gets narrower than 20rem.
  - The right sidebar's width is tied to the window: never more than 40% of it (today a fixed 280–720 px, `lib/right-sidebar.ts`).
  - Header: below 32rem, End Session and Copy session ID fold into one "…" menu and the title keeps at least 8rem; Stop and the Esc button stay whole. Changes VIEW UX's "the buttons always whole; the title gives way".
  - Status line: drop whole parts by priority (repo first, then branch, then Effort; keep the model and context usage), with the dropped ones in its tooltip, instead of cutting every part short. Changes VIEW-5.5's "parts that don't fit are truncated".
  - Small ones: "Jump to latest" gets room under the chat's last line instead of covering it; Work's filter labels fit at 300 px.
- **Costs and risks:** two breakpoints in the shell's grid, an overlay that needs focus handling and Esc, and the dock row's resting height (SIDE-8.1) checked at each width. Screenshots at 520, 560 and 900 px are in the review.
- **Added:** 2026-10-22, from the design review; Dario: agreed, postponed.

## Keep the Mac awake while Sessions run (new spec)

- **What:** a header button with three states: Off, Awake (no idle sleep), and Lid closed (keeps running with the lid shut, only on power). It covers one Session or all of them, and turns itself off when the Sessions it covers stop working. A covered Session's row shows a small cup.
- **Why:** long agent runs stop when the Mac sleeps.
- **How:** follows Matej's recipe for his Electron app ([Recipe: caffeinate button](https://claude.ai/artifact/PpJ1wTcY9JBKiuZ5wHFNCA)). The state lives in the server, so it outlives the browser tab:
  - **Awake:** the server spawns `caffeinate -i -w <server pid>`, so it also ends with the server. This replaces Electron's `powerSaveBlocker`.
  - **Lid closed:** drives Amphetamine over AppleScript (`start new session …`, `enable closed display mode`, `end session`). The fallback is `caffeinate -s` with an external display.
  - Lookout only ends an Amphetamine session it started, and keeps an `owned` flag so it can clean up after a crash.
  - On battery it steps down to Awake.
  - "Stopped" uses the Busy state Lookout already has.
- **Open:**
  - check by hand that `enable closed display mode` really keeps the Mac running with the lid shut;
  - the one-time setup on each Mac: Amphetamine's Power Protect helper and the Automation permission.
- **Added:** 2026-10-23.

## Notes on a question with previews (VIEW)

- **What:** a Notes field for a question whose options have previews (VIEW-10), sent as the terminal's `n`, the note, then Enter. Claude Code records it with the pick (`toolUseResult.annotations[question].notes`), and the agent reads it with the answer.
- **Why:** it's the only free text such a question takes in the terminal; VIEW-10 answers it with options alone.
- **How:** a Fleet commit after the [contract](contracts/fleet-question-previews.md)'s (C6): `--answers` takes `notes` for a question with previews; one capture first, of notes in a form with several questions (in a one-question form, Enter in the notes field submits the whole answer).
- **Added:** 2026-10-28, split out of VIEW-10 by Dario.

## A catalogue of agents (new)

- **What:** one place listing the custom agents a Session can spawn: Claude Code's from `~/.claude/agents/`, a project's `.claude/agents/` and installed plugins, with each one's description, model, effort, tools and where it's defined; Codex's equivalents once it has them. Per agent, how often it ran lately and what it cost, from the Transcripts' Subagent sidecars (`subagents/*.meta.json` name the agent type).
- **Why:** frequent prompts are moving into agents (e.g. a reviewer pinned to Opus at high effort, an Output Index agent on Sonnet), and today you can't see which exist, which a project overrides, or which are expensive without opening files and Transcripts by hand.
- **How:** read the agent files' frontmatter directly (no Harness call needed); usage and cost from the same Transcript reads LIB and the token analysis use. Open questions: a sidebar tab or a Settings page; whether picking one starts a Session with it (LAUNCH) or only shows it; whether to show plugin agents a project disables.
- **Added:** 2026-10-30, by Dario.

## Open a Subagent's own log (VIEW)

- **What:** from a row of the Subagents list (VIEW-8.6), its own messages and tool calls, as the chat shows a Session's.
- **Why:** the list says what a Subagent is doing now; why it did something, or what it found before its result, is only in its own log.
- **How:** Claude Code's `subagents/agent-<id>.jsonl` beside the Transcript, Codex's child rollout; the chat's reader (VIEW-1) over a sidechain, opened from the list. Left out of VIEW-8's list (its Non-goals) on 2026-11-02.
- **Added:** 2026-11-02, by Dario, from the VIEW-8 list's grill.

## A Session's brief as a Topic's notes (TOPIC)

- **What:** a generated summary per Session (what it's doing, what it produced: PRs, files, branch, artifacts; its todos) that a Topic can show and keep as notes.
- **Why:** a Topic of several Sessions is only as readable as its members' titles; the brief says what each did.
- **How:** Fleet's `brief` has the format and the file (`~/.local/state/fleet/briefs/<session_id>.md`), but the CLI only reads and edits it: writing one is a `claude -p` call in Fleet's web server, which Lookout doesn't run. Either Lookout writes it (its own `claude -p`, keeping Fleet's format) or a fork commit adds generation to the CLI. Decide in a TOPIC slice after slice 1.
- **Added:** 2026-10-30, by Dario, from the Fleet review.

## Continue a Session's work in a new one (LAUNCH)

- **What:** "New session from here": a new Session in the same folder whose first prompt hands over this one's work (what it did, its PRs and branch, what's next), for when a Session's context is full or the work branches.
- **Why:** Dario noticed the need; today it's a copy-paste of a summary into the Launch form.
- **How:** Fleet's `spawn --from <target>` takes its first prompt from the Session's brief (`brief --prompt`), so it needs the brief above to exist first; `handoff` does the same with a brief you write. Also "start a Session on this Task" from Work, with the Task's link and title as context, as Fleet's `task spawn` does.
- **Added:** 2026-10-30, by Dario, from the Fleet review.

## A member Session's details outlive its Transcript (TOPIC)

- **What:** when Lookout reads a member Session through `tb-session show` (TOPIC-11.3), it keeps what it read in the member's snapshot: tb-session's summary, the branch, the first prompt and the last assistant message, bounded as TOPIC-11.3 bounds them. A Summary written after the Transcript is gone sends that instead of the bare snapshot.
- **Why:** Claude Code deletes Transcripts after `cleanupPeriodDays` (60 on Dario's Mac), and `tb-session index --prune` then removes the Session. The member stays (TOPIC-4.2), but its snapshot is only the Harness, title and start directory from the day it was added, so a Summary regenerated after that knows little more than the title. Stored summaries and the activity log are kept; what the Session was about isn't.
- **How:** no new reads: the Summary's reads already fetch it, so the store updates `members.snapshot` (or a new column) after each successful read. Open: whether a Session that's never been in a Summary should be read once on its own before it ages out, and how long a snapshot may grow.
- **Added:** 2026-11-02, by Dario, after asking what happens to a Topic's members when their Sessions are deleted from disk.

## Active and Quiet Topics as a filter (TOPIC)

- **What:** a filter in the Topics tab and the graph: Active (a live member Session, or activity in the last 7 days) or Quiet (the rest). The graph can dim Quiet nodes while it shows all.
- **Why:** of 34 Topics on 2026-11-03, 29 had recorded no activity since slice 7, and the tab and graph draw them the same as the live ones.
- **Decided:** a filter, not a split of the list (Dario, 2026-11-03). Not decided yet: whether a Topic Quiet for 3 weeks offers Archive with the outcome dialog (TOPIC-1.6).
- **Added:** 2026-11-03, by Dario, from the Topics review (`output/lookout-2026-11-03/topics-improvements.md`).

## Decide: `/` and `@` autocomplete in the composer (VIEW)

- **What:** typing `/` in the composer offers the Session's slash commands and skills, and `@` offers files from its folder, as the Harnesses' own prompts do.
- **Why it's here:** Fleet upstream has it (from its November guide). It wasn't taken in the 2026-11-03 sync because the Session view spec lists it as a Non-goal ("Slash-command autocomplete, `@` file mentions and voice in the composer").
- **Decide:** lift the Non-goal or keep it. Lifting it is a VIEW spec change. A slash-command draft already sits in another worktree (VIEW Open question 1) and has to be renumbered off VIEW-3.7–3.14, which are taken.
- **Added:** 2026-11-03, by Dario, from the Fleet upstream sync.

## Decide: review comments sent to the Session as a prompt (DIFF)

- **What:** comment on lines of a Session's Changes and send the comments to the Session as one prompt, as Fleet web's reviewer does.
- **Why it's here:** deferred in the 2026-11-03 sync. It needs a diff view inside Lookout, and the changed-files spec hands diffs to VS Code (DIFF-4) and lists "comments on lines sent to the Session" as a Non-goal.
- **Decide:** keep VS Code as the viewer, or build a diff view in Lookout so comments can come back as a prompt. A middle way: comments collected in VS Code (a file of notes) and sent from Lookout, without a viewer of its own.
- **Added:** 2026-11-03, by Dario, from the Fleet upstream sync.

## Decide: Fleet answers Codex's "Trust this folder?" itself (LAUNCH)

- **What:** since the 2026-11-03 rebase, a tmux `fleet spawn` of Codex answers "Trust this folder?" with "Trust and continue" on its own (upstream `a5f42fd`). That clashes with LAUNCH-6.10's rule that a trust prompt is never answered automatically, and leaves the planned Codex card with nothing to show.
- **Recommendation:** keep the auto-answer, because the start directory comes from Settings or the Launch form, so it was picked explicitly. Then the rule becomes "Claude Code's is answered from the Starting view; Codex's is answered by Fleet", and the Codex card is dropped.
- **Decide:** in [LAUNCH Open question 1](features/launch-session/SPEC.md#open-questions); the answer goes into Key decisions and LAUNCH-6.10.
- **Added:** 2026-11-03, by Dario, from the Fleet upstream sync.

## Ask the Session about a clause of a spec (PLAIN)

- **What:** in the Spec view, select a clause and choose "Ask the Session about this", which quotes it in that Session's composer.
- **Why it's here:** a Non-goal of PLAIN's first version (grill, 2026-11-04): reading and Viewed come first. It fits with "review comments sent to the Session as a prompt" (DIFF) above.
- **Added:** 2026-11-04, by Dario, from PLAIN's grill.

## A lead with receipts on the Changes card (PLAIN)

- **What:** three fixed lines at the top of a Module's Changes card, written in PLAIN-11's run: what you can do now, who gets it, and what differs from before (from the spec's notes and its base text only). Every line names the `§` it comes from, and hovering it marks those clauses; PLAIN-11.8's quote check runs on every line, and a line naming no `§` isn't shown. Drawn as direction C (https://claude.ai/artifact/UfsaNAvgpJAio5atZJUUuj).
- **Why it's here:** optional. Dario dropped a plain-words summary on 2026-11-09 as one more text to check (PLAIN's Non-goals); the receipts are meant to make checking it one hover. He chose to try PLAIN-13's proof shots and storyboard first and decide on this after.
- **Added:** 2026-11-09, by Dario.

## A `/design` route: every piece in both modes (DS)

- **What:** one page inside Lookout that shows each piece of the design system (buttons by role, Alerts, markers, rows, popovers, Loading and empty states) in light and dark mode side by side, from the real components.
- **Why:** drift becomes visible there: Usage's and Memory's popovers side by side would have shown the difference before the clarity pass did. 0009 rejected Storybook for the cost of a separate package; a route is one page in the app.
- **Why not now:** it shows drift but doesn't stop it; the guide and the guards do ([0015](decisions/0015-design-guidelines-by-task.md)).
- **Added:** 2026-11-06, from the clarity pass (idea 6, optional, later).

## Words on the right sidebar's tabs (WORK)

- **What:** the right sidebar's tabs show a word each (Work, History, Library, Topics, Servers) instead of an icon, with the open one's word as today. Their counts say what they count.
- **Why:** a briefcase, a book, layers and a server stack have to be learned, and the "1" on Topics doesn't say what it counts. Apart from a handful of universal icons, people need a text label, and a tooltip doesn't fix that (NN/g, icon usability). Five short words fit in 360 px if the icons go. They're the one exception to the design guide's principle 8 today.
- **Why not now:** seen in the clarity pass of 2026-11-06, but not one of its ten ideas.
- **Added:** 2026-11-06, from the clarity pass's grill (0015).

## Marks that crowd on the chat rail (VIEW)

- **What:** on a long Session's rail, Marks close together overlap (four in about 30 px at the top, seen 2026-11-06). Marks closer than about 10 px could be nudged apart, keeping their order, with each still scrolling to its own entry.
- **Why not now:** small, and separate from their colours (VIEW-1.21).
- **Added:** 2026-11-06, from the clarity pass (idea 7).

## Dropped

Discussed and decided against. Each keeps why, so it isn't proposed again without something new.

### A picture of the old app beside a spec (PLAIN)

- **What:** beside a changed spec, a screenshot of the old (Ember) app's view, for a port: taken by Lookout, or by a Session that opens the old app in a test org and saves it.
- **Why dropped:** Lookout can't take one by itself: the old app needs a login, and Ember's acceptance tests name no `§` and run in QUnit after a build of minutes; no port doc holds an Ember screenshot. The port check in words (PLAIN-12) checks a port against the port doc's record of the old app instead.
- **Added:** Dario, 2026-11-09, while speccing Plan item 38. **Dropped:** 2026-11-09, by Dario.

### Code diffs in the chat (VIEW)

- **What:** an Edit or Write shown in the chat as what it changed (the Transcript's `old_string` and `new_string`, or its structured patch; Codex's `apply_patch`), not only as its tool-call line.
- **Why dropped:** Dario finds the chat as it is enough; a Session's changed files are already listed and open in VS Code (DIFF).
- **Added:** from Dario's earlier testing, as research under the Plan's Later. **Dropped:** 2026-11-09, by Dario.

### Suggest a name for a Session (VIEW-5.12)

- **What:** a "Suggest" action by the header's rename that fills in a name from what the Session is working on, through Fleet's `name <target>` (a model call).
- **Why dropped:** the Harnesses already name their Sessions: Claude Code writes its own title into the Transcript (`ai-title`) and Codex names its threads (31 named in `session_index.jsonl` on 2026-11-06). SIDE-10 makes that title the Session name, so a suggestion would cost a model call for a name most Sessions already have.
- **Added:** 2026-10-30, by Dario, from the Fleet review. **Dropped:** 2026-11-06, by Dario, in SIDE-10's grill.

### A count of waiting Review requests on the Work button (WORK)

- **What:** a red badge on the Work button with the number of Review requests waiting, so they're seen without opening Work.
- **Why dropped:** tricky to build right. WORK-8.1 reads PRs only while a tab has Work open, so a badge with Work closed needs reads of its own, and a count kept from the last read can be wrong.
- **Dropped:** 2026-10-22, by Dario.

### Progress of a long-running command (VIEW)

- **What:** while a Session waits on a test suite or a script, show how far it is, e.g. tests passed and left.
- **Why dropped:** researched, and it can't be done properly. A Bash call's output reaches the Transcript only when it ends, and the terminal screen shows no progress that could be read reliably across tools. The Backlog's "Live activity text" covers what can be read: the Harness's own spinner line.
- **Dropped:** 2026-10-22, by Dario.

### The Session's Task and PR in its header (VIEW, WORK)

- **What:** chips in the main pane's header for the Session's Linked PR and Task, from Work's Links plus a new Link from the Session's branch to an open PR with that head branch, each opening the PR on GitHub or the Task in Fantastic.
- **Why dropped:** drafted and found too clunky. Keeping the chips current needs Work's reads to run whenever a tab shows a Session, not only while Work is open, and the branch Link would rarely fire: 12 of 345 Sessions in 14 days ran on an open PR's branch, all headless Codex runs. The draft (VIEW-5.17–5.24, WORK-4.11–4.14) is kept outside the repo, in Dario's `output/lookout-2026-10-27/header-links-dropped.patch`.
- **Dropped:** 2026-10-27, by Dario.

### A Codex question shows neither in the chat nor as Esc (VIEW)

- **What:** a Codex `request_user_input` question didn't show in the chat or as VIEW-4.5's Esc, though Fleet marks it as waiting (`harness.rs:1030`).
- **Why dropped:** no repro; Dario couldn't find the Session it happened in. If it shows again, Dario saves the Session id and it comes back as a bug.
- **Dropped:** 2026-10-30, by Dario.

### A send held as "already holds text" with nothing typed (VIEW)

- **What:** Fleet's `send --require-empty` answered `send_held`, reason `text` (VIEW-3.7), with nothing typed in the terminal (Claude Code, reported 2026-10-27).
- **Why dropped:** no repro: 11 live sends on Claude Code 2.1.311 went through (captures in Dario's `output/lookout-2026-10-27/repro6/`), and Dario couldn't find the Session. If it shows again, Dario saves the Session id; then capture its screen with `capture-pane -e` and run Fleet's `input::read` on it (`crates/fleet/src/core/input.rs`).
- **Dropped:** 2026-10-30, by Dario.
