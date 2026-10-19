# Backlog

Ideas worth building later that aren't specced yet. When one is picked up, it becomes a requirement in a feature spec (or a new spec), and its entry here is removed.

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

- **What:**
  - One place for what Sessions created: local files (Markdown, HTML, `output/`), Artifacts published on claude.ai and Backyard Shares.
  - Searchable, and each item links back to the Session that made it, so a click can open or resume it.
- **How (proposal):**
  - Don't scan the disk; mine the Transcripts.
    - Every `Write`, Artifact publish and `tb-backyard share upload` call is in them, together with its path or URL.
    - Indexing those gives the Session link for free and covers Codex too.
  - It belongs in tb-session (decision 0005): an outputs table next to its search index, `tb-session outputs --json`. Lookout then only renders it.
  - Backyard's own list (`tb-backyard share list --json`) can confirm that a share still exists.
- **Open:**
  - Is there an API that lists claude.ai Artifacts? If not, only the publish calls in Transcripts tell us about them.
  - Local files move or get deleted, so each item needs an existence check.
  - Scratchpad files under `/private/tmp` are gone after a reboot.
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

## Switch a Codex Session's model (VIEW-6) once Codex 0.164 ships

- **What:** the status line's model menu (VIEW-6) for Codex Sessions too, not only Claude Code ones. Picked up once Codex 0.164 is released as stable and installed here.
- **Why:** VIEW-6 leaves Codex out because the installed Codex, 0.163, only opens a picker on `/model`, which Fleet would have to drive by keys. Codex 0.164 adds `/model <slug>` with the model inline (openai/codex #54378), so Codex can be switched the way Claude Code is.
- **How (proposal):**
  - VIEW-6.1 and 6.2 change wording: the menu is for Controllable Claude Code and Codex Sessions, listing the models Fleet gives for the Session's Harness, and only a Session that isn't Controllable or has ended keeps a plain model name. The Technical approach's Codex Known gap goes.
  - `fleet model` in the fork takes Codex: it types `/model <slug>`, answers no confirmation (Codex asks none), and succeeds once the rollout has a `thread_settings_applied` event with the new model, written after the command began.
  - Fleet's `list` reads that event for a Codex Session's `model`, so the status line shows the new model at once and Lookout keeps no `pendingModel` for Codex.
- **Costs and risks:**
  - Codex's inline `/model` applies to this session only, while Claude Code's also becomes the default for new Sessions (VIEW-6.4). The menu's note has to say which applies to the Session's Harness.
  - `thread_settings_applied` is written only once the rollout file exists, i.e. after the first prompt, so a switch before it has nothing to succeed on.
  - Codex accepts `/model` mid-turn (from the next turn), but VIEW-6.3 keeps the menu to Idle Sessions for both Harnesses.
- **Added:** 2026-10-19, from VIEW-6, where Codex is a Known gap.

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
