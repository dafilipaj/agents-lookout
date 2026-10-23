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

## Library: everything Sessions produced, searchable (LIB)

- **Specced:** [LIB](features/library/SPEC.md), Ready, grilled 2026-10-23. Its three open points are answered there: claude.ai has no Artifact list but the Transcripts (Technical approach, Source); existence is Lookout's per-page stat (LIB-2.9); scratchpad files are in while they exist and hidden once gone (Key decisions). The tb-session command it needs is a [contract](contracts/tb-session-outputs.md). Slices 2 and 3 are under its Later.
- **Added:** 2026-10-17.

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

## Switch a Codex Session's model and Effort (VIEW-6, VIEW-7) once Codex 0.164 ships

- **What:** the status line's model menu (VIEW-6) and Effort menu (VIEW-7) for Codex Sessions too, not only Claude Code ones. Picked up once Codex 0.164 is released as stable and installed here.
- **Why:** VIEW-6 and VIEW-7 leave Codex out because the installed Codex, 0.163, only opens a picker on `/model` (the model, then its reasoning effort), which Fleet would have to drive by keys. Codex 0.164 adds `/model [model] --reasoning <level> --speed <tier>` with everything inline (openai/codex #54378, merged 2026-10-15; in the 0.164 alphas), so Codex's model and Effort can be switched the way Claude Code's are.
- **How (proposal):**
  - VIEW-6.1, 6.2, 7.1 and 7.2 change wording: the menus are for Controllable Claude Code and Codex Sessions, listing the models and levels Fleet gives for the Session's Harness (Codex's levels already come from `models_cache.json`'s `supported_reasoning_levels` through `harness list`, `ultra` included where a model has it), and only a Session that isn't Controllable or has ended keeps plain text. The Technical approach's Codex Known gaps go.
  - `fleet model` and `fleet effort` in the fork take Codex: they type `/model <slug>` and `/model --reasoning <level>`, answer no confirmation (Codex asks none), and succeed once the rollout has a `thread_settings_applied` event with the new model or `reasoning_effort`, written after the command began.
  - Fleet's `list` reads that event for a Codex Session's `model` and `effort`, so the status line shows the new value at once and Lookout keeps no `pendingModel` or `pendingEffort` for Codex.
- **Costs and risks:**
  - Codex's inline `/model` applies to this session only and leaves saved defaults alone, while Claude Code's `/model` and `/effort` (below `max`) also become the default for new Sessions (VIEW-6.4, VIEW-7.4). Each menu's note has to say which applies to the Session's Harness.
  - `thread_settings_applied` is written only once the rollout file exists, i.e. after the first prompt, so a switch before it has nothing to succeed on.
  - Codex accepts `/model` mid-turn (from the next turn), but VIEW-6.3 and VIEW-7.3 keep the menus to Idle Sessions for both Harnesses.
- **Added:** 2026-10-19, from VIEW-6, where Codex is a Known gap. Effort added 2026-10-22, from VIEW-7.

## The CLIs Lookout uses, and which can be updated (TOOLS)

- **What:** one place, e.g. a "Tools" section in Settings, listing every CLI Lookout runs (fleet, tb-session, tb-pr, tb-prod, tb-jev, claude, codex): where it was found, its installed version, the latest release, and the command that updates it.
- **Why:** today nothing shows which versions Lookout runs on, or that a newer one exists. Several features depend on a minimum version (tb-pr 0.3.1's `column_issues`, tb-session 0.3.0's Codex support, Fleet's pin), and Fleet's screen reading is only as good as the Harness versions its fixtures were captured from.
- **How (proposal):**
  - Show-only: Lookout copies the update command, never runs it.
  - The latest release is checked at most once a day, through tools that are already signed in (`gh` for cli-toolbox releases) or public registries for Claude Code and Codex.
  - Fleet is compared with Lookout's pin (`e2e/pins.json`), not a public release; tb-prod shows as retired.
  - A Claude Code or Codex newer than the version Fleet's screen fixtures were captured from is flagged, since prompt answering, the send guard and `fleet model` read their screens.
- **Costs and risks:**
  - tb-jev's version can't come from `tb-jev --version`, which must not be run; it needs another source.
  - Checking for releases is a network call Lookout doesn't make today.
- **Added:** 2026-10-19, from Dario's testing.

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

## Dropped

Discussed and decided against. Each keeps why, so it isn't proposed again without something new.

### A count of waiting Review requests on the Work button (WORK)

- **What:** a red badge on the Work button with the number of Review requests waiting, so they're seen without opening Work.
- **Why dropped:** tricky to build right. WORK-8.1 reads PRs only while a tab has Work open, so a badge with Work closed needs reads of its own, and a count kept from the last read can be wrong.
- **Dropped:** 2026-10-22, by Dario.

### Progress of a long-running command (VIEW)

- **What:** while a Session waits on a test suite or a script, show how far it is, e.g. tests passed and left.
- **Why dropped:** researched, and it can't be done properly. A Bash call's output reaches the Transcript only when it ends, and the terminal screen shows no progress that could be read reliably across tools. The Backlog's "Live activity text" covers what can be read: the Harness's own spinner line.
- **Dropped:** 2026-10-22, by Dario.
