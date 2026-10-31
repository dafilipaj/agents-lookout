---
title: "Changed files"
code: "DIFF"
status: "In Progress"
created: "2026-10-31"
updated: "2026-10-31"
---

# Changed files

## Summary

See how many lines a Session has changed, on its row and in its status line, and which files, with a click on a file opening its Changes in VS Code side by side. The count covers every Checkout the Session works in, so a Session that edits Worktrees it never `cd`s into still shows its work.

## Problem

Today Lookout says nothing about what a Session changed. To know whether it touched three files or thirty, and what it did to them, you open a terminal or VS Code in the right Worktree and run `git status` and `git diff` there. Sessions started in `~/Projects/work` edit Worktrees under `repos/` without ever moving into them, so even their location on the row doesn't say where the work is.

Fleet's web UI gained a diff reviewer (upstream `1df4bc1`, `0f06ad1`, `eac85a0`), but it lives in Fleet's web server, which Lookout doesn't run ([0004](../../decisions/0004-fleet-cli-as-session-layer.md)).

## Requirements

What Fleet answers is checked in the fork's tests against [the contract](../../contracts/fleet-diff.md). Lookout's rules are `(test)` against the fake `fleet`; the flows that span the server and the UI are `(e2e)` in a World with a real repo, the pinned Fleet and a fake `code` that records its arguments ([0007](../../decisions/0007-behaviour-tests-from-spec-requirements.md)); what VS Code shows is `(manual)`.

### DIFF-1 The count

A live Session's Changes, summed over its Checkouts (DIFF-2), as lines added and removed and files changed.

- [ ] DIFF-1.1 A Session whose Changes have added or removed lines shows `+<added> −<removed>` in its row's numbers group, after the Subagent count and before the age (`[sa]2  +120 −30  5m  23%`), so SIDE-9.1's Subagent count stays first. Added lines are green (`diff-added-text`) and removed lines red (`diff-removed-text`), in the row, the status line and the list alike (DS-2.5). With no lines changed (no Changes, only binary files, only renames or mode changes), outside git, or when Fleet can't tell, the row shows nothing: never `+0 −0`. (e2e)
- [x] DIFF-1.2 A count of 1000 or more is shortened as `1.2k` (one decimal below 10k, none from 10k: `12k`); the exact numbers are in the tooltip, with the number of files. (test)
- [ ] DIFF-1.3 The status line (VIEW-5.5) shows the count after the repo, Worktree or branch, followed by the number of files: `+120 −30 · 4 files`, or `· 2 files` alone when no lines changed. It shows whenever at least one file changed, and it's a button that opens the list (DIFF-3). (e2e)
- [x] DIFF-1.4 The row's accessible name reads the count with the other numbers, in the order shown: "120 lines added, 30 removed" (SIDE-2.15). The status line button's name adds the files: "120 lines added, 30 removed in 4 files, show changed files", or "2 files changed, show changed files". (test)
- [x] DIFF-1.5 At 280 px the count is part of the numbers group and is never cut; the left slot truncates first, as SIDE-2.14 says. (manual)
- [x] DIFF-1.6 A View only Session (SIDE-1.5) shows its count like a Controllable one. An ended Session, a "Starting…" row and a past Session (HIST) show none. (test)

### DIFF-2 What counts as Changes

Fleet reports a Session's candidate Checkouts and each one's Changes (the contract, C3 and C4); Lookout decides which candidates count ([0010](../../decisions/0010-single-consumer-rules-stay-with-the-consumer.md)).

- [x] DIFF-2.1 For a Claude Code Session, an `edited` candidate always counts, and the working directory's candidate counts when the Session edited a file in it or it isn't on its default branch (`on_default_branch: false`). (test)
- [x] DIFF-2.2 For a Codex Session, only the working directory's candidate counts, always, on its default branch too: its rollouts don't say which files it edited (Technical approach, Codex). (test)
- [x] DIFF-2.3 A Checkout's Changes are what Fleet reports from its Branch point: on a feature branch, committed-but-unpushed and uncommitted work; on the default branch, uncommitted work only. Lookout shows them as reported. (test)
- [x] DIFF-2.4 A Checkout without Changes is left out of the list and the count. A candidate Fleet skipped (`gone`, `unsupported`, `busy`, `git_failed`, `timeout`) is left out too, and the rest still count. (test)
- [x] DIFF-2.5 Each changed file has its path in its Checkout, its kind (added, modified, deleted, renamed from an old path, type changed, mode changed, submodule), its lines added and removed, whether it's binary, and whether it's uncommitted (it differs from HEAD). (test)
- [x] DIFF-2.6 Lookout asks Fleet (`fleet --local diff`) for a Session's Changes when its Status changes, every 10 s while it's Busy and every 60 s otherwise; every 3 s while any open tab has its list open (DIFF-3.6). One ask runs at a time across all Sessions, in the order they fell due; an ask is never started for a Session whose last ask is still running. It passes the last answer's fingerprint, and an `unchanged` answer keeps the last one. (test)
- [x] DIFF-2.7 A Checkout with more than 500 changed files lists the first 500 by path and says how many more there are; its count still covers all of them. (test)
- [x] DIFF-2.8 A Session with no session ID yet (a Codex Session before its first prompt) is asked about by its `pid:` target. A Session that leaves Fleet's list drops its answer and its schedule. (test)

### DIFF-3 The list of changed files

- [ ] DIFF-3.1 The status line's count (DIFF-1.3) opens a popover listing the changed files, sorted by path. Each row shows the file's name, its folder in the quieter colour, its `+ −` (or "binary"), its kind when it isn't modified (added, deleted, `old → new`, type changed, mode changed, submodule) and an "uncommitted" mark for uncommitted files. (e2e)
- [x] DIFF-3.2 With more than one Checkout, the files are grouped under a heading per Checkout with that Checkout's own `+ −`. The heading is the repo's name (its common directory's repo, as `server/git.ts` names it for rows) and, for a linked Worktree, the Worktree's folder name, else the branch; a detached HEAD shows its short commit. The working directory's Checkout comes first, then Fleet's order. With one Checkout there's no heading. (test)
- [x] DIFF-3.3 While it's open the list updates in place and keeps its scroll position. When the focused file leaves the list, focus moves to the next file, else the previous one. When no Changes are left, the list says "No changes" until closed; the status line's count is then gone, so Esc returns focus to the composer, or to the Session view's chat without a composer. (test)
- [x] DIFF-3.4 It's keyboard reachable: Up and Down move between files, Enter opens one (DIFF-4), Esc closes the popover and returns focus to the count. It's built from the design system's popover and list pieces. (test)
- [x] DIFF-3.5 It fits the Session view at any width without sideways scrolling: long paths truncate at the folder first, keeping the file name, with the full path in the tooltip. (manual)
- [x] DIFF-3.6 Opening the list tells the server over the tab's event stream that it watches that Session's Changes; closing it, switching Session, or the stream closing ends the watch. The 3 s cadence holds while at least one watch is open. An answer that arrives after its Session left Fleet's list is dropped. (test)

### DIFF-4 Open a file's Changes in VS Code

- [ ] DIFF-4.1 Clicking a modified, type-changed, mode-changed or renamed file runs `code --diff <base copy> <file>`: on the left the file as it was at the Branch point (from its old path for a rename), on the right the file in its Checkout, which can be edited there. (e2e)
- [x] DIFF-4.2 An added file opens against an empty base copy with the same name. A deleted file opens its base copy alone (`code <base copy>`). A binary file that exists opens alone (`code <file>`). A deleted binary file and a submodule have no action, and their tooltip says why. (test)
- [x] DIFF-4.3 Base copies are written under `~/.lookout/diffs/` (mode `0700`), each in a new folder made with `mkdtemp`, under the file's own name so VS Code picks its language, as a new file (never through an existing path or link) with mode `0444`. Copies older than a day are deleted when Lookout starts and once a day after. (test)
- [x] DIFF-4.4 Lookout's server opens only a file its latest answer for that Session lists, by Checkout root and path, and only when the answer is at most 2 minutes old. The file's real path (symlinks resolved) must be inside the Checkout's real root; otherwise, or when the root is gone, the request is refused with the reason and runs nothing. Every command runs from an argument list, never through a shell. The request passes the checks every mutating request does: our `Host` and `Origin`, the token, and the fetch-site check (`server/security.ts`, [0003](../../decisions/0003-browser-first-react-stack.md)). (test)
- [x] DIFF-4.5 VS Code is found as `code` on the PATH, else as `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`. Without either, a click shows "VS Code not found" on the file's row for 5 s and nothing else happens. (test)
- [x] DIFF-4.6 When the base copy can't be made (git fails) or `code` exits with an error, the file's row shows the reason for 5 s. (test)
- [ ] DIFF-4.7 The diff opens in VS Code side by side, the base on the left, and VS Code comes to the front. (manual)

### DIFF-5 When Fleet can't tell

- [x] DIFF-5.1 A Fleet without `diff` (clap's `unrecognized subcommand 'diff'`) shows no counts anywhere and no error; Lookout stops asking until it restarts. (test)
- [x] DIFF-5.2 When an ask fails or takes longer than 60 s (it's then killed), the last count stays until the next answer, for at most 2 minutes; then it's hidden until an ask succeeds. (test)

## Non-goals

- A diff viewer inside Lookout, or comments on lines sent to the Session (Fleet web's reviewer). VS Code is the viewer.
- Telling one Session's Changes from another's in a Checkout they share, or from Changes made before the Session started: a Checkout's Changes are git's, whoever made them (Key decisions).
- Per-edit diffs in the chat (PLAN, Later: "Code diffs in the chat").
- Another base than the Branch point (a PR's base branch, HEAD, a commit you pick).
- Staging, committing, discarding or reverting from Lookout.
- Ended and past Sessions: Fleet lists only live ones.
- Other editors (Cursor, Zed, JetBrains), and listing VS Code in the TOOLS spec.
- For Codex, any Checkout but the working directory's, until its rollouts are researched.
- Diffing inside a submodule, and Checkouts in the middle of a merge or with a sparse index (skipped as `unsupported`).
- Other Hosts.

## UX

```
Sidebar row (280 px)
┌──────────────────────────────────────────────┐
│ ● Fix rate rounding                   Claude │
│   api · fix/rates   [sa]2  +120 −30  5m  23% │
└──────────────────────────────────────────────┘

Status line, with the list open
  api · fix/rates   [+120 −30 · 4 files]   Opus 5.5   23%
  ┌──────────────────────────────────────────────────────┐
  │ api · fix-rates                            +96 −30   │
  │   rates.rb       app/models/               +40 −12   │
  │   rates_spec.rb  spec/models/              +56 −18   │
  │ frontend · fix-rates                       +24 −0    │
  │   rate.ts        app/utils/   added +24  uncommitted │
  │   logo.png       public/      binary                 │
  └──────────────────────────────────────────────────────┘
```

- Hover on the row's count: "120 lines added, 30 removed in 4 files".
- A click on a file row opens VS Code; the popover stays open, so the next file is one click away.
- Error on a row ("VS Code not found", a git error, "outside its Checkout") replaces its `+ −` for 5 s in the danger colour.

## Technical approach

### What exists

- Fleet upstream's web server diffs a Session's Checkouts (`web/lib/diff.mjs`) and finds them from the files its Transcript touched (`web/lib/touched.mjs`). Neither is reachable from the CLI, and the touched index reads Claude Code Transcripts only.
- Lookout's server already runs `git` (a Tool) for each row's location through a 30 s cache (`server/git.ts`, which also names a Checkout's repo from its common directory), and opens `.md` files in VS Code through `vscode://file/…` links (VIEW-1.17). A `vscode://` link can open a file at a line, but not a diff.
- The tab's event stream already owns watches that end with it (`server/app.ts`: the monitor, memory and usage watches; the Memory overview's `setOpen`). DIFF-3.6 is one more.

### Fleet: a fork command ([0006](../../decisions/0006-run-a-fork-of-fleet.md))

`fleet --local diff <target> --json [--since <fingerprint>]`, specified in [contracts/fleet-diff.md](../../contracts/fleet-diff.md) and built in the fork before Lookout's side; Lookout's pin moves to it (`README.md`, `shared/defaults.ts`, `e2e/pins.json`). It reports facts: every candidate Checkout with why it's a candidate and whether it's on its default branch, and each one's Changes from a consistent snapshot (a throwaway copy of the index, `add -A`, `write-tree`, with repository-configured commands turned off). Which candidates count is Lookout's rule (DIFF-2.1, 2.2).

### Codex

Codex 0.16x's rollouts don't name the files a patch changed: in 30 days of this Mac's rollouts (2026-10-01 to 10-31) there is no `patch_apply_end` event, and `apply_patch` runs inside Codex's `exec` tool, whose input is JavaScript. So for now a Codex Session's only candidate is its working directory's Checkout (DIFF-2.2); finding its other Checkouts needs research into `exec`'s recorded calls first.

### Lookout

- `server/changes.ts`: the schedule (DIFF-2.6), one ask at a time with a 60 s limit, the last answer per Session with its time (the allowlist for DIFF-4.4), Lookout's counting rule (DIFF-2.1, 2.2) and the count on the row's state (`SessionRow.changes`, set by the monitor as `memoryGrowthBytes` is), sent with the other row fields. A list that closes puts its Session back on its own interval, counted from its last ask.
- `PUT /api/changes/watch` with `{clientId, sessionId | null}`: the tab's event stream owns its open list (DIFF-3.6), as it owns Memory's breakdown; the list as it is now, and each changed one after it, goes to the watching tab as a `changes` event on that stream, never in the PUT's answer, so an older list can't land after a newer one. A tab sends its watches one at a time, the latest only, and tries a failed one again while it's still the latest. `POST /api/sessions/:id/changes/open` with `{root, path}`: checks it (DIFF-4.4), writes the base copy with `git -C <root> show <base.sha>:<old_path or path>` (nothing for an added file), then runs `code`. Both through the runner with argument lists.
- The fake `fleet` gains `diff` answering from fixtures; a fake `code` on the test PATH records its arguments; a World's `.repo()` makes the real Checkouts for the `(e2e)` criteria.

### Other specs

- SIDE: the row's numbers gain the count after the Subagent count (DIFF-1.1); SIDE-9.1 is unchanged. Changelog line in SIDE.
- VIEW: the status line gains the count (DIFF-1.3); VIEW-5.5 names it and points here. Changelog line in VIEW.
- DS: new DS-2.5, the `diff-added-text` and `diff-removed-text` tokens, their contrast and their guard row; DS goes back to In Progress until it's built.

### Key decisions

- **Fleet reports facts, Lookout counts**: which Checkouts a Session works in comes from its Transcripts, Fleet's to read ([0004](../../decisions/0004-fleet-cli-as-session-layer.md), [0005](../../decisions/0005-building-blocks-live-outside-lookout.md)); which of them to show is a consumer's rule ([0010](../../decisions/0010-single-consumer-rules-stay-with-the-consumer.md)).
- **The Branch point, not HEAD**: a Session's work is its branch, committed or not; diffing against HEAD would empty the count at every commit. On the default branch it is HEAD, so `main` ahead of `origin` doesn't count as the Session's work.
- **The working directory's Checkout counts only when edited or off its default branch** (Claude Code): `~/Projects/work` on `main` often has stray changes from scripts, which would show on every Session started there; a Session in a feature Worktree owns it, even when its changes came from a command Fleet can't read.
- **A Codex Session's working directory always counts** (Dario, 2026-10-31): there's no way to tell its edits apart, and showing stray changes beats showing nothing.
- **Git's Changes, not the Session's**: attributing lines to Sessions would need every edit replayed from Transcripts, and shell commands (`sed -i`, codemods, `git mv`) would still escape it.
- **`code --diff` with a base copy, not a `vscode://` link**: links can't open a diff; VS Code's Git view would compare with HEAD, not the Branch point.
- **Numbers, no hunks**: the count and the list need `--numstat` only; VS Code renders the diff.
- **Polling by Status, one ask at a time**: a snapshot hashes every dirty file; with 10 to 20 live Sessions, asking every 2 s would keep git busy for nothing. An unchanged fingerprint saves the diff, not the snapshot.
- **The row's count after the Subagent count** (Dario chose a row count, 2026-10-31): SIDE-9.1 stays as built and ticked.

### Known gaps

- A Checkout shared by two Sessions shows the same Changes on both rows.
- Edits made through a shell command other than `>` or `tee` (`sed -i`, a generator) in a Checkout that's on its default branch and was never otherwise edited aren't found.
- Git clean filters (Git LFS) run on the snapshot's `add` (contract C7).

## Open questions

None.

## Changelog

- 2026-10-31: Created (Dario, 2026-10-31: changed-lines count and the list of changed files, a file opening its changes in VS Code).
- 2026-10-31: Codex review (Astra high), 18 findings, all applied: Lookout applies the counting rule, Fleet reports candidates ([0010](../../decisions/0010-single-consumer-rules-stay-with-the-consumer.md)); Codex Sessions count their working directory only (DIFF-2.2, Dario); the row shows the count, after the Subagent count (Dario); the open route checks real paths, answer age and every mutating-request check; base copies in private folders; the list's watch over the event stream (DIFF-3.6); one ask at a time with a 60 s limit; focus when files leave; Checkout headings; type, mode and submodule changes; `(e2e)` for the flows; SIDE, VIEW and DS amendments listed.
- 2026-10-31: Ready (Dario: "proceed with implementation", without a grill; the Codex review stood in for it). The numbers' colours made explicit: green for added, red for removed (Dario).
- 2026-10-31: Built. Fleet fork `9ecdbb7`, amended to `9b6e4bf` after the review below (`fleet diff`, contract C1–C9, its tests); Lookout's `server/changes.ts`, the watch and open routes, the row's count, the status line's button and list (`ChangesButton`, `ChangesCount`), DS-2.5's tokens. The list is watched with `PUT /api/changes/watch` instead of a `GET` (Technical approach). Ticked: every `(test)` criterion (unit, route and component tests), DIFF-1.5 and 3.5 seen live at 4747 (the sidebar's count uncut; the list over four Checkouts, 1,044 files, no sideways scroll). Left: DIFF-1.1, 1.3, 3.1 and 4.1 (`(e2e)`: their Behaviour tests need the pin moved to the pushed fork commit; unit tests cover them meanwhile) and DIFF-4.7 (Dario's look at VS Code).
- 2026-10-31: Codex implementation review (Sol high), 16 findings, 15 applied (the 16th is the pin move, already left). Fleet: the fingerprint covers each candidate's `why`; the temp index is written whole (`core.splitIndex=false`), so a split index leaves no new shared file; merge-base takes the snapshot's HEAD; Checkouts are found on the real path; pruning only takes free locks; reading Transcripts counts toward the 50 s; more C9 tests. Lookout: the real path is checked again just before `code` runs; base copies keep their bytes (not only UTF-8); a Status change during an ask asks again at once; the watch's list comes over the event stream, watches go one at a time; focus after a file leaves goes to the next file still listed, and to the chat in a View-only Session; long names and errors are cut.
- 2026-10-31: Fork `9b6e4bf` pushed; the pins (`README.md`, `shared/defaults.ts`, `e2e/pins.json`) moved to it. DIFF-1.1, 1.3, 3.1 and 4.1 stay open: a Behaviour test World can't hold a live Session or a git repo until TEST-1.4 (Fake Harnesses) and TEST-1.5 (`world().repo()`) are built; unit, route and component tests cover them meanwhile. No requirement changed.
