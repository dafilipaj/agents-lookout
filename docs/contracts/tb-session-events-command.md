# Contract: `tb-session events --kind command`

What Lookout's Evidence ([EVID](../features/done-evidence/SPEC.md)) needs from tb-session: a new kind of row in `events`, one per shell command a Session ran, with how it ended and the end of its output. It exists: tb-session 0.6.0, cli-toolbox `18924a3` on `main` (PR #130; 0.5.0 was that branch's version and was never released), and is verified there, in tb-session's own tests; Lookout's fake tb-session follows this file, and `pnpm req-check` never looks here (the criteria are EVID-1 to EVID-5). Points are numbered K1 to K11 so the PR's tests can cite them. It extends [`tb-session-events.md`](tb-session-events.md) (E1 to E11), whose rules hold for this kind unless a point here says otherwise. Every field and flag is add-only.

Written 2026-11-18 from a probe of Dario's Transcripts of the 14 days before (243 Claude Code Sessions with their Subagents, 265 Codex Sessions). The record shapes below are what those Transcripts hold, not a Harness's documentation. Reviewed the same day by Codex (gpt-6.1-sol, xhigh), whose fixes are in K1, K2, K4, K5, K10 and K11. Amended 2026-11-21 from building it (tb-session 0.5.0) against all 3,129 of Dario's Transcripts: K4 row 6's refusal texts, row 8's `returnCodeInterpretation`, and K5's notifications, which newer Claude Code records as a queued attachment. Amended 2026-11-24 from cli-toolbox#130's review: `<tool_use_error>Blocked` moves from K4 row 5 to row 6, row 8 gives null for a code Claude Code explained away, and K5 ends a background command on a `TaskStop` and on a notification recorded in another Transcript of its Session. Amended again the same day from the PR's second review (Claude Opus 5.5, xhigh): a result recorded without a `toolUseResult` (K4 rows 1 and 8), a task's final `task_status` (K5), and which notifications count (K5).

## Why `events`, not Fleet

- `fleet messages --json` gives a `tool_call` entry's `tool`, `summary`, `text` and `ts`, but not its result, so it can't say whether a command failed. Fleet reads one live Session for its chat; Evidence needs a Session's whole run, its Subagents included.
- `events` already indexes one row per recorded action, parent and Subagent Transcripts alike, with `tool_use_id`, filters in SQL and a refresh of changed files on each call (E8). A command is one more recorded action.

## K1. Command and flags

`tb-session events --kind command` (alone or with the other kinds), with E1's flags. Lookout calls, for one Session:

```
tb-session events --all-projects --session <id> --kind command --limit 1000 --json
tb-session events --all-projects --session <id> --kind command --limit 1000 --page 2 --json   # and on, until total_results
```

- `--all-projects` is needed: without it, E1 scopes events to the current directory, and `--session` only narrows that.
- `--ext` drops every command row, as it drops a Share with no source (E4). `--q` searches the command text.

## K2. Fields

A command row has E2's fields that every row has (`id`, `kind: "command"`, `key`, `timestamp`, `title`, `harness`, `session_id`, `subagent`, `headless`, `pruned`), the ones it has when known (`project_path`, `git_branch`, `transcript_missing`, `tool_use_id`), and:

```
key,             // the tool_use_id
title,           // the command's first line, at most 120 characters
command,         // the command text, whole, as the Harness recorded it
cwd,             // the record's working directory, or null; not the result of a `cd` inside the command
started_at,      // the tool call's timestamp
timestamp,       // when its end was recorded (K4); for a running background command, its first result's (K5)
ended,           // "exited" | "refused" | "errored" | "timed_out" | "interrupted" | "running"
exit_code,       // an integer when the Harness recorded one, else null
refused_by,      // "hook" | "permission", only when ended is "refused"; absent otherwise
output_tail,     // the last 4,000 characters of the recorded result text (K6), or null when it can't be read
output_chars,    // the length of the whole recorded result text
output_saved_to  // the path the Harness saved a long output to; absent when it saved none
```

- A field marked "absent" isn't in the row; a field that can be null is always present.
- `exit_code: null` means the Harness recorded none. It never means 0 and never means a failure.

Examples, invented:

```json
{ "id": 812, "kind": "command", "key": "toolu_01A", "tool_use_id": "toolu_01A", "title": "pnpm test 2>&1 | tail -5",
  "command": "pnpm test 2>&1 | tail -5", "cwd": "/Users/me/shop", "started_at": "2026-11-18T14:19:02.120Z",
  "timestamp": "2026-11-18T14:20:11.480Z", "ended": "exited", "exit_code": 0,
  "output_tail": " Test Files  12 passed (12)\n      Tests  180 passed (180)\n", "output_chars": 61,
  "harness": "claude", "session_id": "5b0c…", "subagent": null, "headless": false, "pruned": false }

{ "id": 813, "kind": "command", "key": "toolu_01B", "ended": "running", "exit_code": null,
  "timestamp": "2026-11-18T14:21:00.000Z", "output_tail": "Command running in background with ID: b7x2", "…": "…" }

{ "id": 814, "kind": "command", "key": "toolu_01C", "ended": "refused", "refused_by": "hook", "exit_code": null,
  "output_tail": "PreToolUse:Bash hook error: …", "…": "…" }
```

## K3. Which records become rows (Claude Code)

- Each `Bash` tool call in a parent or Subagent Transcript makes one row once its `tool_result` is recorded. A call with no result yet makes none; a background call makes its row at its first result (K5).
- `api-request-blob` replays are ignored, as E3 says.
- A `fleet done`, a `git push` or a `codex exec` is a command like any other. The kind says nothing about what a command is for.

## K4. How it ended

The first row that matches the recorded result decides:

| # | The recorded result | `ended` | `exit_code` |
|---|---|---|---|
| 1 | `toolUseResult.backgroundTaskId` present; without a `toolUseResult`, a text starting `Command running in background with ID: X` or a last line `Command … moved to the background (ID: X)` | `running`, until K5 | null |
| 2 | `toolUseResult.timedOutAfterMs` present | `timed_out` | the N of a text starting `Exit code N`, else null |
| 3 | `toolUseResult.interrupted` true | `interrupted` | the same |
| 4 | `is_error` true, text starting `Exit code N` | `exited` | N |
| 5 | `is_error` true, text starting `PreToolUse:` and containing `hook error` | `refused`, `refused_by: "hook"` | null |
| 6 | `is_error` true, text starting `<tool_use_error>Blocked` (Claude Code's own check of the command, e.g. a `sleep`), `Permission for this` or `Permission to use`, saying the command `requires approval` or `was blocked. For security`, starting `The user doesn't want to proceed`, or naming the auto-mode classifier's refusal | `refused`, `refused_by: "permission"` | null |
| 7 | any other `is_error` true | `errored` | null |
| 8 | `is_error` false | `exited` | 0; null with `returnCodeInterpretation` or without a `toolUseResult` |

- `refused` means the command never ran: only rows 5 and 6, whose texts the probe saw. Seen: 393 hook refusals, most of them `res-guard` sending a test run through `res`.
- `errored` is an error tb-session can't place. The command may or may not have run. Lookout counts it as a run whose result is unknown.
- `exit_code` is the shell's: for a piped command, the last command of the pipe's. tb-session doesn't read the command to say whether it's piped (K8).
- `refused_by: "permission"` is any refusal of Claude Code's own, its check of a command included; `"hook"` only a hook's.
- Row 8's `exit_code` is null when Claude Code didn't count a result as an error although the shell returned non-zero, which it explains in `returnCodeInterpretation` (`grep` with no match, `diff` with differences, `find` with an unreadable directory): the code isn't recorded, and 0 would be false. Seen on 1,254 of 92,789 commands; no test runner's result has been seen with it.
- Some Subagent Transcripts (Claude Code 2.1.289 to 2.1.331) record a Bash result without its `toolUseResult`: 1,011 of about 40,500 Subagent results on Dario's Mac on 2026-11-24. Row 1 then reads the task id from the text (Claude Code's own line, not one quoted in the output), and row 8's code is null: nothing records it. Rows 2 and 3 can't be told apart without it.
- Rows 2 and 3 weren't seen in the Transcripts: every timeout also carried `backgroundTaskId` (row 1), and no result had `interrupted: true`. They stay for Harness versions that record them.

## K5. Background commands

- A background call's first result carries `backgroundTaskId`. Its end arrives later as a `<task-notification>` with `<tool-use-id>`, `<status>` and a summary that may say "(exit code N)", "(exit code N: …)" or "failed with exit code N". Older Claude Code records it in a user record; newer records a `queue-operation` `enqueue` and then delivers it as an `attachment` of type `queued_command`. Any of the three ends the command, the delivery's timestamp before the enqueue's; replays and `remove` records don't.
- On that notification the row becomes `exited` with N, or with null when the summary carries no code; `interrupted` for a `killed` or `stopped` status ("didn't finish before the previous session ended"). Its `timestamp` becomes the notification's. Its `output_tail` stays the first result's text: the output went to the Harness's file, which tb-session doesn't read (E11).
- A successful `TaskStop` whose `task_id` is the command's `backgroundTaskId` ends it `interrupted`, with `exit_code` null and the `TaskStop` result's `timestamp`. Claude Code records no notification after most stops (375 of 384 in one reviewer's Transcripts, all 249 in Dario's), so without this the command would stay `running`. A failed `TaskStop` ends nothing.
- A notification or `TaskStop` recorded in another Transcript of the Session ends the command the same way: a Subagent's background command is notified in its parent's Transcript. Only a command still `running` changes, with the latest such end.
- Claude Code also records a task's status as an `attachment` of type `task_status` (`taskId`, `status`). A final one (`completed`, `failed`, `killed` or `stopped`) ends the command, by its task id, only when nothing else does: in 9 of the 10 seen it came after the notification, and in the tenth it was the only end. It ends it as a notification without a code would, at its own `timestamp`.
- A notification counts only where Claude Code writes one: a text that opens with `<task-notification>`, or with Claude Code's `[SYSTEM NOTIFICATION - NOT USER INPUT]` wrapper. One quoted inside a prompt or a reply, or in a compaction summary (`isCompactSummary`), ends nothing. Seen quoted: 5 prompts and 2 summaries, none naming a real task yet.
- A background command with no notification, no `TaskStop` and no final `task_status` stays `running`, its `timestamp` its first result's.

## K6. The output's tail

- `output_tail` is the end of the result text as recorded, Claude Code's own notes appended to it included ("Shell cwd was reset to …"). Measured: the last 4,000 characters give the same test outcome as the whole text in 99.6% of runs that print a runner's summary, the last 2,000 in 98.7%.
- Size: Bash results had a median of 885 characters, a p90 of 5,532 and a p99 of 16,812. A 4,000-character tail of every call is about 45 MB of text per 14 days of this Mac's Transcripts. tb-session may keep an offset into the Transcript and read the tail when asked, as long as the answer is the same; with the Transcript gone (`transcript_missing`), it answers `output_tail: null`.

## K7. Order, paging and copies

E5 and E6 hold: newest `timestamp` first, `total_results` counts the rows, and a forked Session repeats its original's commands under its own `session_id` with the same `tool_use_id`. With `--session`, a command comes back once.

## K8. Boundary

tb-session gives facts. It doesn't decide which commands run tests, read a runner's summary line, parse a command for pipes or wrappers, or join a command to a Checkout. Those are Lookout's rules (EVID-2, [0010](../decisions/0010-single-consumer-rules-stay-with-the-consumer.md)).

## K9. Tests in cli-toolbox

Fixtures with the record shapes above, invented: each row of K4, a timeout whose text also starts `Exit code`, a background command with a notification, with one that carries no code, with a `killed` one and with none, one ended by a `TaskStop` (and one a failed `TaskStop` leaves running), a Subagent's background command ended by its parent's notification and `TaskStop`, results without a `toolUseResult` (sent to the background, moved there, a plain one, one quoting Claude Code's line), a command ended only by its final `task_status` and one whose notification a later `task_status` doesn't replace, a notification quoted in a prompt and in a compaction summary, a Subagent's command, a fork copy, an output longer than 4,000 characters, and an index written before this kind (K11).

## K10. Codex (a later version)

For EVID's slice 4. Codex records each command as an `event_msg` of type `item_completed` whose `item.type` is `CommandExecution`: `command` (`["/bin/zsh", "-lc", "<cmd>"]`, the last element is the command), `cwd` (a `file://` URL), `exit_code`, `status` (`completed`, or `failed` on a non-zero exit), `aggregated_output`, and `started_at_ms` and `completed_at_ms` on the event. All 4,148 seen carried an `exit_code`. A file edit is an `item_completed` of type `FileChange` with `changes` keyed by path. Codex's `exec` tool runs a script that may start several commands; each is its own `CommandExecution`.

## K11. Upgrade

- An index written before this kind holds no command rows, and E8 skips unchanged Transcripts. The kind comes with a schema bump that re-parses every Transcript on first use, as schema v4 did for `events` (E8): existing rows of the other kinds are kept, and none is duplicated.
- The first call after the upgrade can take longer than a warm one; Lookout allows 60 s for it (EVID-1.4). An older tb-session refuses a newer index, as E8 says.
- It ships in the same PR as the kind: the index is a local cache that tb-session rebuilds, not a deployed database.
