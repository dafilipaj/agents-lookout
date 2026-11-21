---
title: "Evidence: what backs a Session's work when it stops, read from its Transcript and its Checkouts"
code: "EVID"
status: "In Progress"
created: "2026-11-18"
updated: "2026-11-19"
---

# Evidence

## Summary

When a Session stops with Changes, Idle or Done, see what backs its work without asking it: the Test runs it ran and how each ended, whether its Changes changed after its last Test run, and how many test files are among them. Lookout reads them from the Session's Transcript and its Checkouts, and sums them up in a verdict in the status line. A Session whose work rests on a test that failed, a result nobody can read, or no test at all shows a mark on its sidebar row.

## Problem

- A Done Session's row shows the Done chip and the Session's note (SIDE-2.17), and its chat ends with the same note in the Done card (VIEW-5.17). The note is the Session's own summary. Addy Osmani names this "Summary substitution", where "the agent's work summary substitutes for review" ([Agentic Autonomy Levels](https://addyosmani.com/blog/agentic-autonomy-levels/)), and says "Models reliably skew positive when they grade their own work" ([Long-running Agents](https://addyosmani.com/blog/long-running-agents/)). His rule: "Every agent-completed task should terminate in concrete evidence: a test that runs, a screenshot, a log, a runtime trace, a reviewer signoff" ([Cognitive Surrender](https://addyosmani.com/blog/cognitive-surrender/)). In Steve Yegge's factory the maker never grades itself ([The Shape of Things to Come, Part 1](https://yegge.ai/essays/the-shape-of-things-to-come/)).
- A Session that stops without reporting Done has no note at all, and an Idle row looks the same whether its work was tested or not.
- Nothing in Lookout says whether a test ran after a Session's last change, or how it ended. To know, Dario scrolls the chat or asks the Session, which answers with another summary.
- A probe of his Transcripts of the 14 days to 2026-11-18 (Technical approach, "Measured") found 417 `fleet done` reports from 151 Sessions. 45% changed no code. Of the 207 that did, 99 (48%) had no passing test run after the last code change: 68 changed code after it, 25 ran no test, 6 never passed.
- A Test run's exit code doesn't say how it ended. Sessions pipe a test command's output into `tail` or `grep`, so the shell's exit code is theirs. Of 370 test runs whose own summary line said tests failed, every one exited 0.

## Requirements

Slice 1 is EVID-1 to EVID-5: live Claude Code Sessions, three facts, no model. It shows nothing until tb-session answers command rows (Gap 1, tb-session 0.5.0).

### EVID-1 Which Sessions, and when Lookout reads

Lookout reads a Session's commands through tb-session ([contract](../../contracts/tb-session-events-command.md)) and its Changes through DIFF.

- [x] EVID-1.1 A live Claude Code Session is **in scope** while its Status is Idle, or it's Done (SIDE-2.17), and it has Changes (DIFF). A Session in scope has Evidence. A Busy Session, one that Needs you, one with no Changes, an ended or past Session and a Codex Session (slice 4) have none, and show nothing of it. (test)
- [x] EVID-1.2 The server reads a Session's commands with `tb-session events --all-projects --session <its session id> --kind command --limit 1000 --json`, page after page until it has the answer's `total_results` rows (E5), its Subagents' commands included. (test)
- [x] EVID-1.3 It reads when the Session enters scope (its Status becomes Idle, it's marked Done, or an Idle Session gains Changes), when its Done time changes (a new `fleet done`), when its background shell command ends (SIDE-2.6), when one of its Subagents finishes (SIDE-9), and once for each Session in scope when the server starts. One read per Session runs at a time; any trigger that arrives during it starts one more read after it. (test)
- [x] EVID-1.4 A page of the read has the Library's time limits: 60 s on the first read after the tb-session binary changed, while its index may upgrade, and 20 s otherwise. A page that takes longer is killed, and the read fails. (test)
- [x] EVID-1.5 Between reads, the server works the verdict out again, without a new read, whenever its answer of the Session's Changes changes. (test)
- [x] EVID-1.6 Lookout keeps a Session's last read in memory only, and drops it when the Session ends. (test)
- [x] EVID-1.7 With a tb-session that refuses `--kind command` as a usage error, no Session has Evidence, and Settings › Tools shows tb-session as too old, naming Evidence among what needs the newer one (TOOLS-2). (test)
- [x] EVID-1.8 A read that fails for any other reason keeps the Session's last Evidence, and its popover's verdict shows it as old, with the reason, as Memory's does (MEM-3). A Session that never had a read that worked has none. (test)

### EVID-2 Test runs

Which commands run tests, and how each ended, are Lookout's rules ([0010](../../decisions/0010-single-consumer-rules-stay-with-the-consumer.md)). The tables are in Technical approach.

- [x] EVID-2.1 A Test run is a command row that ran (its `ended` isn't `refused`) and either whose `output_tail` holds a test runner's summary line, or whose command names a test runner once its wrappers are stripped. A command a hook or a permission refused is never one. A Subagent's runs count as the Session's. A forked Session's copied commands come back once, under its own id, and count as its own. (test)
- [x] EVID-2.2 A command whose every part only reads files (`cat`, `tail`, `head`, `grep`, `less` or `sed -n` with a file argument) isn't a Test run, even when its output holds a summary line: it shows an earlier run's output, not a run that ended then. (test)
- [x] EVID-2.3 A Test run ends with the first of these that holds: **failed** when one of its summary lines says a test failed; **running**, **timed out** or **interrupted** when its `ended` is `running`, `timed_out` or `interrupted`; **passed** when a summary line says at least one passed; **no tests** when a summary line says none ran; else what its exit code says (EVID-2.4); else **unknown**. Its counts are the passed and failed numbers of its summary lines, summed; a run without one has no counts. (test)
- [x] EVID-2.4 The exit code decides only when it's an integer, the command's last part runs the test runner (nothing follows it after `;`, `&&`, `||` or a new line), and that part pipes its output into nothing, or the command sets `pipefail`. A runner inside `sh -c '…'` is judged by the same rule on the quoted command. 0 is passed, anything else failed. An `errored` row, or one whose exit code is null, ends unknown. (test)
- [x] EVID-2.5 A Test run's end is its row's `timestamp`: for a background run, when its notification was recorded. (test)
- [x] EVID-2.6 The runners, their summary lines, the wrappers and the commands that only read files are constants in one file, not settings. (test)

### EVID-3 The verdict

- [x] EVID-3.1 With each read and each change of its Changes, Lookout reads the modification time of each changed file DIFF lists for the Session. The **last change** is the latest of those times, whoever made it. A deleted file, a submodule, or a file whose `stat` fails or takes over 2 s, has none. When DIFF lists only the first 500 of a Checkout's files (DIFF-2.7), only those are read. (test)
- [x] EVID-3.2 A Test run **ended after** the last change when its end is at or after it; with no last change (every changed file deleted), every Test run did. A file is **changed since** a Test run when its modification time is later than the run's end. (test)
- [x] EVID-3.3 The verdict is the first row of this table that holds. The **deciding run** is the latest Test run that ended after the last change and didn't end unknown; with none, the latest that ended after it. A run that ended unknown adds nothing when a readable one ended after the last change too. Test runs count wherever they ran, in any of the Session's Checkouts or none. (test)

  | When | Verdict | Short, for the status line | Tone |
  |---|---|---|---|
  | It has no Test run | No test run | No test run | warning |
  | A Test run is running | A test run is still running | Tests running | quiet |
  | No Test run ended after its last change | Changed after its last test run | Changed since tests | warning |
  | The deciding run passed | Tests passed after its last change | Tests passed | ok |
  | The deciding run failed | Its last test run failed | Tests failed | warning |
  | The deciding run timed out | Its last test run timed out | Tests timed out | warning |
  | The deciding run was interrupted | Its last test run was stopped | Tests stopped | warning |
  | The deciding run ran no tests | Its last test run ran no tests | No tests ran | warning |
  | The deciding run ended unknown | No readable test result after its last change | Result unread | warning |

- [x] EVID-3.4 When a run that ended unknown is later than a deciding run that failed, timed out, was interrupted or ran no tests, the verdict says "its last readable test run": "Its last readable test run failed". (test)

### EVID-4 Test files among the Changes

- [x] EVID-4.1 A changed file is a **test file** when its path matches `*.test.*` or `*.spec.*`, or has a `tests`, `__tests__`, `e2e`, `fixtures` or `mocks` folder, in any language, a deleted file's old path included. These are ARCH-1.3's patterns. The rule is Lookout's, in one place; ARCH's grill decides whether its scanner uses it. (test)
- [x] EVID-4.2 Lookout counts the Session's test files, how many were added and how many deleted, and sums their `+ −` from DIFF. When DIFF left some of a Checkout's files out (DIFF-2.7), the counts are of the listed files and say "at least". (test)

### EVID-5 Where Evidence shows

- [ ] EVID-5.1 The status line (VIEW-5.5) shows a Session's Evidence as a part right after its Changes count (DIFF-1.3): the verdict's icon and its short words, in its tone ("Changed since tests"). It's a button that opens the Evidence popover. It truncates as the line's other parts do, and its tooltip says the whole verdict. (e2e)
- [x] EVID-5.2 The Evidence popover is a details popover as the design guide builds one (Memory's anatomy): the design system's `Verdict` with the verdict in words, its dot at the warning level for a warning verdict and at the normal level for the others, and when Lookout last read it; under it three `Tiles`, Last pass, Changed since and Test files (EVID-5.3, EVID-5.4); then a "Changed since the last pass" section (EVID-5.10) and a "Test runs" section (EVID-5.11). When DIFF left some files out (DIFF-2.7), a line under the verdict says "Read from 500 of 1,240 changed files". (test)
- [x] EVID-5.3 The **Last pass** tile shows the end of the latest Test run that passed as a clock time ("14:26") and under it that run's count ("2,180 tests passed"), or "by its exit code" when its summary gave none; with no Test run that passed, "None" at the warning level and under it "12 test runs", or "No test run". The **Changed since** tile shows how many changed files have a modification time later than that run's end ("3 files"), at the warning level when there's one or more and "None" otherwise, and under it the last change as a clock time ("last at 14:31"); with no Test run that passed, it counts every changed file that has a modification time. (test)
- [x] EVID-5.4 The **Test files** tile shows "4 of 11" and under it "1 added · 1 deleted · +64 −8", leaving out a part that's 0; with no test file, "None" and under it "of 11 changed files"; "at least 4" when DIFF left files out. It's a button, a `Tile` that DS-19.1 gains in the same change, with a chevron at its value's end: a press closes the Evidence popover and opens the list of changed files (DIFF-3), which keeps its own focus rules (DIFF-3.4). (test)
- [x] EVID-5.5 A Done Session's Done card (VIEW-5.17) shows one line under the note: the verdict's icon and its words in its tone, then, in the muted colour, the first two tiles in words ("last pass 14:26, 3 files changed since", "last pass 14:30", "no run passed", or nothing more with no Test run), cut to one line with the whole in its tooltip, and an "Evidence" button at its end that opens the Evidence popover. The card never grows past that line. The Done chip and its tooltip (SIDE-2.17) don't change. (test)
- [ ] EVID-5.6 A Session whose verdict's tone is warning shows a mark on its sidebar row: lucide `FlaskConicalOff` in `warning-text`, leading the second line after DS-22.3's other marks, its tooltip the verdict. The row's accessible name (SIDE-2.15) says the verdict where the mark is. An ok or quiet verdict, and a Session without Evidence, have no mark. (e2e)
- [x] EVID-5.7 In the status line's part and the Done card, a verdict's icon is lucide `CircleCheck` in `ok` for ok, `TriangleAlert` in `warning-text` for warning, and `Info` in the muted colour for quiet. Never a colour alone (design guide, principle 4). The popover's verdict has `Verdict`'s dot instead (EVID-5.2). (test)
- [x] EVID-5.8 The part and the Done card's Evidence button are buttons that Tab reaches and Enter opens. In the popover, Tab moves between its buttons: the Test files tile, each changed file and each "N more"; the other tiles and the runs are text and don't take focus. Esc closes the popover and returns focus to whichever opened it. When the Session's Evidence goes while the popover is open (it went Busy, or lost its Changes), the popover closes and focus goes to the composer, or to the chat without one, as DIFF-3.3 does. (test)
- [ ] EVID-5.9 The part, the popover, the Done card's line and the row's mark look right in light and dark mode, at 280 px for the row and at any width of the Session view, without sideways scrolling, and match canvas D (UX). (manual)
- [x] EVID-5.10 The "Changed since the last pass" section lists the files the Changed since tile counts, latest change first, 10 at most and then "N more", which opens DIFF-3's list as the Test files tile does. Each row shows its path, cut at the folder first with the whole in its tooltip (as DIFF-3.5), its modification time as a clock time and its `+ −`; a press opens it as DIFF-4 does, a `.plain` Module in the Spec view (PLAIN-3.1). With no Test run that passed, or no file changed since, the section is left out. (test)
- [x] EVID-5.11 The "Test runs" section's label has a note at its right: the number of Test runs, then how many failed, timed out, were stopped, ran no tests or are unread, each left out at 0 ("12 · 2 failed · 1 unread"). Under it, the runs, newest first, 20 at most and then "8 more", which shows the rest in place, one line each: its end as a clock time, its outcome in a word (passed, failed, timed out, stopped, no tests, running, unread), its count when its summary gave one ("2,180 tests", "2 of 2,180" for a failure), and its command, cut, the whole in its tooltip (up to 20,000 characters), after "Subagent ·" when a Subagent ran it. (test)

## Planned slices

Specced after slice 1 ships, in this order:

2. **A review by another model:** whether the work went through one, from Skill calls (`p-codex:review`, `p-codex:dual-review`, `p-codex:run`) and `codex exec` commands. Which Skills count is a list per setup. In Osmani's and Yegge's terms, the maker doesn't grade itself. Drawn on a canvas of directions once slice 1 runs, before it's specced (Dario, 2026-11-19).

Then, in no order yet:

3. **One place for what a Session made:** its Outputs (LIB) and its Linked PR's CI state (WORK-2.3) in the Evidence popover.
4. **Codex Sessions:** the same three facts from Codex's `CommandExecution` and `FileChange` records (contract K10). Codex here is mostly a reviewer: 2 of 265 Codex Sessions in the probe edited files.

## Non-goals

- Running tests, or asking the Session to run them.
- Judging the tests: whether a run covered the changed code, whether the tests are good, coverage numbers, reading test code.
- A model's verdict, or any model call. The rules give the same answer every time.
- Changing Done or Status. Done stays the Session's own word (SIDE-2.18); the Done chip and its tooltip stay as they are.
- Typecheck, lint and build runs as Evidence. A clean `tsc` prints nothing, so a piped one can't be read.
- Telling which Checkout or repo a Test run ran in. A run in one repo counts for the Session's Changes in another.
- Evidence for a Busy Session or one that Needs you (PLAN item 56 covers a Busy Session going wrong), a past Session (HIST) or an ended one.
- A notification, a sound, or a message to the Session.
- CI logs, and why a PR's CI failed.
- A review by another model, Outputs and CI in the popover, and Codex Sessions (slices 2 to 4).

## UX

Drawn on a canvas of four directions on 2026-11-19 (https://claude.ai/artifact/PKVD4kDjoYfvdtbUu6g641); Dario chose D, which takes A's status line part and run list and B's three tiles, and keeps the Done card to one line with an Evidence button. The sketch below follows D. The command and the numbers are invented.

```
The status line, under the composer
shop · fix/rates · +120 −30 · 11 files · [warn] Changed since tests · opus · 23%

The Evidence popover, from that part or from the Done card's Evidence button
┌────────────────────────────────────────────────────────┐
│ [dot] Changed after its last test run           3s ago │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ │
│ │ Last pass    │ │ Changed since│ │ Test files       │ │
│ │ 14:26        │ │ [warn] 3 files│ │ 4 of 11       [>] │ │
│ │ 2,180 tests  │ │ last at 14:31│ │ 1 added · +64 −8 │ │
│ └──────────────┘ └──────────────┘ └──────────────────┘ │
│ CHANGED SINCE THE LAST PASS                            │
│   src/invoice/format.ts                 14:31   +3 −3  │
│   src/invoice/round.ts                  14:30   +6 −2  │
│   src/invoice/totals.ts                 14:29  +18 −9  │
│ TEST RUNS                      12 · 2 failed · 1 unread │
│   14:26  passed  2,180 tests  pnpm exec vitest run     │
│   14:24  failed  2 of 2,180   pnpm test 2>&1 | tail -5 │
│   14:11  unread  Subagent · pnpm test 2>&1 | grep FAIL │
│   13:58  passed  412 tests    pnpm vitest run src/inv… │
│   8 more                                               │
└────────────────────────────────────────────────────────┘

The Done card, at the end of the chat
┌────────────────────────────────────────────────────────┐
│ [ok] Done · 14:32                        [End Session] │
│      Rounding in the invoice totals is fixed.          │  the note: the Session's words
│      ──────────────────────────────────────────────    │
│      [warn] Changed after its last test run · last     │  the verdict and two facts: Lookout's
│      pass 14:26, 3 files changed since   [Evidence ^]  │  one line, cut, in the app
└────────────────────────────────────────────────────────┘

The sidebar row
● Fix rounding in totals                     Done
  [flask-off] [br] fix/rates   +120 −30  5m  23%
```

- `[ok]`, `[warn]` and `[flask-off]` stand for lucide `CircleCheck`, `TriangleAlert` and `FlaskConicalOff` ([0008](../../decisions/0008-lucide-icons-only.md)); `[dot]` is the `Verdict`'s dot, amber here; `[>]` and `[^]` are `ChevronRight` and `ChevronUp`.
- The popover takes Memory's anatomy (`ui/details.tsx`): `Verdict`, `Tiles` and `SectionLabel`. It adds one piece to it, a `Tile` that's a button (EVID-5.4).
- An ok verdict leaves the row quiet; the status line still says "Tests passed".

## Technical approach

### What exists

- **Done** comes from Fleet's `done` (`{ at, note }`, SIDE-2.17); a Subagent can't set it (SIDE-2.18). The Done card is `DoneCard` in `web/src/components/SessionView.tsx` (VIEW-5.17).
- **DIFF** answers a Session's Checkouts, their changed files with each one's kind and `+ −`, and a fingerprint per Checkout (`server/changes.ts`).
- **The Library** already reads `tb-session events` (`server/library.ts`) and follows its contract's rules for paging and fork copies (E5, E6).
- **ARCH-1.3** writes which files are tests, as marks its scanner returns. EVID needs the same patterns on DIFF's paths, any language, so it keeps them as Lookout's rule (EVID-4.1).
- **`fleet messages --json`** gives a tool call's text and time but not its result.

### Measured

From a probe on 2026-11-18 of Dario's Transcripts of the 14 days before: 243 Claude Code Sessions with their Subagents and 265 Codex Sessions. Raw output and the scripts stay in Dario's `output/lookout-2026-11-18-done-evidence/`, never in this repo.

- **Claude Code records it.** A `Bash` call's command, its result with `is_error`, "Exit code N" on a non-zero exit, `backgroundTaskId`, `timedOutAfterMs` and `interrupted`. A background command's end comes later in a task notification with its exit code. 393 refusals by a hook (mostly `res-guard`) and a few by permission are `is_error` too, and never ran.
- **The exit code misleads.** Of 1,341 test runs found by their command, 1,043 printed a runner's summary line: 666 passed, 370 failed, 7 ran no tests. All 370 failed runs exited 0, because the output was piped. 298 (22%) have no summary line, mostly because a `grep` kept only some lines.
- **Commands hide their runner.** About 700 more commands printed a Vitest summary while their command named no runner a pattern found (`env -u NODE_ENV pnpm -s vitest`, `sh -c '…'`, loops, reading a background run's saved output).
- **The summary is at the end.** The last 4,000 characters of the output give the same outcome as the whole output for 99.6% of runs with a summary line.
- **Codex** records each command with its `exit_code`; 25 test runs in 14 days, 2 Sessions that edited files, 1 `fleet done`.
- **Review by another model** shows as `p-codex:review` (17), `p-codex:dual-review` (12) and `p-codex:run` (8) Skill calls, and `codex exec` in Bash (slice 2).

### Sources

| What | From | Read |
|---|---|---|
| Status and Done | `fleet list --json` (as today) | `status`, `done.at` |
| Commands | `tb-session events --all-projects --session <id> --kind command --limit 1000 --json`, then `--page 2` and on | each row's `command`, `ended`, `exit_code`, `output_tail`, `timestamp`, `subagent` (contract K2) |
| Changes | DIFF's answer (as today) | each Checkout's changed files, kinds, `+ −` and fingerprint |
| Modification times | `fs.stat` of each changed file that exists | `mtime` |

### Lookout's rules (EVID-2.6)

Test runners, by their summary lines:

| Runner | Its command, after wrappers | Its summary line | When none ran |
|---|---|---|---|
| Vitest | `vitest` | `Tests  2 failed \| 2180 passed (2182)` | `No test files found` |
| Jest | `jest` | `Tests: 1 failed, 5 passed, 6 total` | `No tests found` |
| Playwright | `playwright test` | `  3 passed (12.1s)`, `  1 failed` | `No tests found` |
| cargo | `cargo test`, `cargo nextest` | `test result: ok. 4 passed; 0 failed; …` | every line `0 passed; 0 failed` |
| pytest | `pytest`, `python -m pytest` | `=== 1 failed, 10 passed in 1.20s ===` | `no tests ran` |
| a package script | `pnpm`, `npm`, `yarn` or `bun` with `test…` or `e2e…`, `run` optional | the runner's own line | the runner's own line |

- Wrappers stripped before a command is matched: `res run … --`, `env` with its flags and assignments (`env -S '…'`'s value is the command), `VAR=value`, `timeout N`, `time`, `npx`, `bunx`, `pnpm exec`, `pnpm -s`, `pnpm --filter X`, `pnpm`, `yarn` or `bun` before a runner's name (`pnpm vitest run`), a shell word that starts a part (`do`, `then`, `else`, `command`, `exec`), and `sh -c '…'`'s (or `bash -lc`'s) quoted command. A command is split at `&&`, `||`, `;`, `&` and new lines, quotes kept whole, and each part is matched.
- Counting: pytest's errors count as failed, Playwright's flaky as passed; a duration in a summary line may be in ms, s, m or h.
- The exit code (EVID-2.4): `pipefail` counts from a `set -o pipefail` (or `-eo`, `-euo`) until a `set +o pipefail`; a runner negated with `!` never decides, wherever the `!` is in its part (`time ! pnpm test`); a redirection to a file (`>`, `>>`, `2>&1`, `pytest>/tmp/log`) isn't a pipe.
- Summary lines are matched in the `output_tail` only, anywhere in it, each counted once. A line that counts only skipped tests is a no-tests line.
- Commands that only read files (EVID-2.2): `cat`, `tail`, `head`, `grep`, `less` and `sed -n` with a file argument, each part of the command one of them. A `cd` or `sleep` part doesn't stop a command from only reading (`sleep 30; tail -40 /tmp/out.log`), and `sh -c '…'` only reads when its quoted command does, before or after a pipe.
- A usage error (EVID-1.7) is clap's exit 2 for an unknown subcommand or flag (TOOLS-2.5), or for an unknown `--kind` value, which is how tb-session 0.4 refuses `command`.
- The tests for these rules use invented fixtures of each runner's lines, and of each case of EVID-2.3 and EVID-2.4: a passing summary on a run still running or timed out, a failed summary on a run that exited 0, `pnpm test >/dev/null; true`, a runner inside `sh -c`.

### Gaps (cli-toolbox)

1. **`events --kind command`:** one row per shell command, with how it ended and its output's tail. Its contract: [`tb-session-events-command.md`](../../contracts/tb-session-events-command.md). One cli-toolbox PR, after this spec is Ready.
2. **The version:** TOOLS learns the tb-session that has it (EVID-1.7).

### Outside Lookout

When slice 1 is built, a line in Dario's `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` asks Sessions to keep a test runner's summary line when they filter its output (`grep -E "FAIL|Tests |Test Files"`, not `grep FAIL`), so fewer runs end unknown. Lookout never relies on it.

### Lookout's side

- `server/evidence.ts`: the reads (EVID-1), a background shell or a Subagent ending when Fleet's count of them drops (`background.shells`, carried as the row's `backgroundShells`; Subagents running, which an earlier Turn's Subagent leaves too), the rules (EVID-2 to EVID-4) and an `evidence` event per Session to the tabs over the event stream, sent when it changes; the Session list's snapshot carries each Session's verdict for the row's mark.
- `web`: the status line's part and the Evidence popover, the verdict in `DoneCard`, and the mark in `SessionItem.tsx`.

### Other specs, when built

- VIEW-5.5: the status line gains the Evidence part after the Changes count, before RES-3.2's Queued part.
- VIEW-5.17: the Done card gains the Evidence line and its button (EVID-5.5).
- DS-19.1: `Tile` gains a button form, with a chevron and a hover, for the Test files tile (EVID-5.4).
- DS-22.3: a new exception, the Evidence mark, last in its order; DS-22.4's component test covers it.
- SIDE-2.15: the row's accessible name reads the verdict where the mark is.
- DIFF: Evidence reads its answer and its fingerprint; the Test files tile and the changed files' "N more" open DIFF-3's list, and a changed file opens as DIFF-4 does.
- ARCH-1.3: EVID-4.1 puts its patterns in Lookout as a path rule; ARCH's grill decides whether its scanner uses it. ARCH-4.7's mark stays a separate part; ARCH's grill decides whether it joins the Evidence popover.
- TOOLS: the tb-session version with the command kind.
- TEST: a World whose fake Harness writes `Bash` calls and results, and a tb-session that answers command rows.
- PLAN item 56 ("A Busy Session that is quietly going wrong") reads the same commands for its "the same command failed three times".

### Key decisions

Grilled with Dario on 2026-11-18.

- **Read, never told:** Evidence comes from the Transcript and the Checkouts. The Session's note stays its own line.
- **Idle and Done Sessions with Changes, not only Done:** a Session that stops without `fleet done` has worked too, and without Changes there's nothing to back.
- **In the status line, with a popover:** every selected Session has a status line, Idle ones included, and a details popover is how Lookout explains a reading. The Done card repeats the verdict where a Done Session is read.
- **Tiles on top, a one-line Done card (canvas D, 2026-11-19):** the three tiles say at a glance when tests last passed, what changed since and how many test files changed, and the files changed since the last pass are what wasn't tested. The Done card keeps one line however many runs there are, and its Evidence button opens the same popover as the status line. Dario chose D over the first popover (A), a timeline of edits and runs (B), which added a piece for little more, and an Evidence card in the chat (C), which grew the card every time.
- **A row mark only when it isn't backed:** an exception leads a quiet row (DS-22.3); a backed row stays quiet.
- **The Done chip doesn't change:** Done is the Session's word, and the mark carries the verdict.
- **The output decides a Test run's outcome, not the exit code:** Sessions pipe test output, and every one of the 370 failed runs measured exited 0.
- **A Test run is found by its output first, its command second:** about 700 commands ran a runner that no command pattern found, and their output named it.
- **An unreadable result warns when it's all there is:** with only unreadable runs after the last change, the verdict warns, since evidence you can't read isn't evidence. An unreadable run after a readable one adds nothing, and the verdict says "last readable". A line in your `CLAUDE.md` makes them rarer.
- **A log read isn't a run:** printing a saved output shows an earlier run at a later time, which could make a change look tested.
- **What a run's state says comes before its partial summary:** a run still running, timed out or stopped has printed only part of its suites; only a failure among them is final.
- **Read whole, in pages, with the Library's limits:** a Session can hold thousands of commands, and the runner's output cap is 16 MiB.
- **The last change from the files' modification times:** it catches every writer, a script, a formatter, a rebase or you, and DIFF already lists the files. The Transcript's edits miss a file a script wrote.
- **The whole Session, every Checkout:** a run counts wherever it ran. Telling Checkouts apart needs the run's directory out of the command, and that waits until a false "Tests passed" shows up in practice.
- **Tests only:** typecheck and lint are out until a later slice wants them.
- **A Subagent's runs count:** they're in the Session's Transcripts, and the work is the Session's.
- **tb-session, not Fleet:** it indexes a whole Session with its Subagents, keeps results, and already serves the Library. Fleet's messages read one live chat page.
- **Claude Code first, a review by another model next:** the work and the Done reports are Claude Code's, and Codex here mostly reviews, so whether it reviewed matters more than its own Evidence.
- **No model:** a rule gives the same verdict every time and costs nothing.
- **Separate from ARCH-4 for now:** ARCH is a Draft, and its grill decides whether its mark joins this popover.

## Open questions

None.

## Changelog

- 2026-11-18: Created as a Draft from PLAN item 55 and a probe, the same day, of 14 days of Dario's Claude Code and Codex Transcripts. Contract for the tb-session read written.
- 2026-11-18: Grilled with Dario (eleven questions). Evidence covers Idle Sessions with Changes as well as Done ones, lives in the status line with a popover and on the Done card, and marks a row only when it isn't backed. An unreadable result warns. Modification times give the last change. Runs count Session-wide. Typecheck and lint are out. tb-session is the Building block. A review by another model is slice 2.
- 2026-11-18: Codex review (gpt-6.1-sol, xhigh): 18 findings, curated with Dario, none rejected. Applied: the read takes `--all-projects` and pages with the Library's limits; reads on entering scope, a background shell's end and a Subagent's end; edge cases of the last change (at or after, deletions only, a failed `stat`, DIFF's 500-file cap); the order of a run's state, its summary and its exit code, with the exit code only for the command's last part; log reads aren't runs; no-tests lines per runner; "last readable" wording; the test-file rule owned here; focus with two openers; the popover's `Verdict` unchanged. The contract gained an ordered K4 with `errored`, null rules, JSON examples and its upgrade (K11). Requirements renumbered (EVID-1.3 to 1.8, 2.2 to 2.6, 3.4, 4.2), as a Draft allows.
- 2026-11-18: Ready (Dario), after the grill and the Codex review's fixes.
- 2026-11-19: Dario chose canvas D of four (UX). The popover gains three `Tiles`, Last pass, Changed since and Test files (EVID-5.2 to 5.4), and a list of the files changed since the last pass (EVID-5.10); the runs move to EVID-5.11, one line each, their counts in the label's note. The Done card shows one line and an Evidence button (EVID-5.5). Focus and the manual check follow (EVID-5.8, 5.9). Slice 2 gets a canvas once slice 1 runs. Still Ready.
- 2026-11-21: Slice 1 built: `server/test-runs.ts` (the rules, EVID-2.6), `server/evidence.ts` (reads, triggers, the verdict), `shared/evidence.ts`, `web/src/components/Evidence.tsx` (the status line's part, the popover, the Done card's line), the row's mark in `SessionItem`, `Tile`'s button form, and tb-session 0.5.0 in TOOLS' table; tb-session's `--kind command` as a draft cli-toolbox PR (the contract amended for what real Transcripts record: K4 row 6's refusal texts, K5's queued notifications and `stopped`). Decided in building, now in Technical approach: a pass without a count says "by its exit code"; the runs' "N more" shows the rest in place; a `.plain` file opens in the Spec view; more wrappers (`pnpm vitest`, `env -S`, shell words), `cd` and `sleep` don't stop a log read being one, `!` and `set +o pipefail` keep the exit code out; a shell or Subagent ending is read from Fleet's counts dropping, as a fingerprint-only change of the Changes is. Two Codex reviews (gpt-6.1-sol, xhigh): 11 findings, then 6, all fixed. Ticked: every `(test)` criterion. Left: EVID-5.1 and 5.6, `(e2e)`, whose Behaviour tests wait for a World that hosts a live Session (TEST-1.4; component tests cover them meanwhile), and EVID-5.9, Dario's look.
