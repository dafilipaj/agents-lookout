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

## My Productive tasks, with their Sessions and PRs (TASKS)

- **What:** tasks assigned to me, each marked when a Session has worked on it, and with its PR when one exists.
- **How (proposal):**
  - The tasks come from `tb-prod query … --json`.
  - The link from task to Session to PR goes through the task id:
    - branch names (`feature/<task id>-…`), from the `git_branch` that tb-session already has;
    - the PR body's task link, or the `PR: <url>` TODO that `/p-dev:open-pr` adds to the task.
  - Natural action: start a Session on a task (LAUNCH with the task URL as the first prompt).
- **Shares** the task, Session and PR linking with PRS, so build them together or one right after the other.
- **Added:** 2026-10-17.

## My GitHub PRs and review requests (PRS)

- **What:** my open PRs and the reviews requested from me, each with its CI state and the Sessions linked to it.
- **How (proposal):** `tb-pr list --json` already gathers these across the org, with a cache.
- **Later:** one-click actions that start a Session with a prompt, e.g. a review request runs `/p-codex:dual-review <PR>` in a new Session. The Session itself still asks before posting anything to GitHub.
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
- **Open:** the most design-heavy of these four; grill it before speccing.
- **Added:** 2026-10-17.
