# Contract: `tb-session events`

The command Lookout's Library ([LIB](../features/library/SPEC.md)) reads. It exists: tb-session 0.4.0, cli-toolbox `3e15e58` on `main` (PR #106), and is verified there, in tb-session's own tests. This file says what Lookout relies on, so Lookout's fake tb-session follows it; `pnpm req-check` never looks here (the Library's criteria are LIB-1 to LIB-3). Points are numbered E1 to E11 so tests can cite them. Every field and flag is add-only: a later tb-session may add, never rename or drop.

Written 2026-10-29 from the 0.4.0 source (`crates/tb-session/SKILL.md`, `src/events.rs`, `src/commands/events.rs`, `src/sources/claude/events.rs`). It replaces [`tb-session-outputs.md`](tb-session-outputs.md): PR #106 moved from `outputs` to `events` in review, and the Library's rules moved to Lookout ([0010](../decisions/0010-single-consumer-rules-stay-with-the-consumer.md)). Measurements are from Dario's Mac on 2026-10-29 (0.4.0, warm).

## E1. Command and flags

```
tb-session events [--all-projects] [--project <path>]
                  [--kind write,edit,artifact,share] [--ext md,html,…]
                  [--session <id>] [--harness <h>] [--headless include|exclude|only]
                  [--after 7d] [--before …] [--q <text>] [-- <text>]
                  [--limit 50] [--page 1] --json
```

- Lookout uses `--all-projects`, `--json`, `--kind`, `--ext`, `--headless`, `--limit` and `--page`. The others exist and Lookout doesn't need them for slice 1 (`--session` for the "Produced" jump in slice 2).
- Without `--all-projects` or `--project`, events are scoped to the exact current directory. `--kind` takes `write`, `edit`, `artifact` and `share` (repeatable or comma-separated; anything else is a usage error).
- `--limit` defaults to 50 and `--page` to 1, both at least 1; there is no upper limit, so one call can return everything (E5).
- Without `--json`, a readable table; the shape below is `--json`'s.

## E2. Fields

```
{ total_results, page, results: [ {
    id,                 // the row's identity in the local index; means nothing outside it
    kind,               // "write" | "edit" | "artifact" | "share"
    key,                // file: its path as recorded; artifact: its URL; share: its token
    timestamp,          // when the action's result was recorded (ISO 8601)
    title,              // file: the basename; artifact and share: from the tool result
    path, ext,          // files, when present; path is key. On an artifact or share, ext is
                        // derived from source_path when there is one
    url,                // artifact and share
    source_path,        // artifact and share, when recorded: the local file they were made from
    version, seq,       // artifact, when recorded
    visibility, state, expires_at,   // share, when recorded: what the upload printed
    harness, session_id,             // the parent Session
    subagent,           // the Subagent Transcript's filename, or null for the parent
    project_path, git_branch,        // when known
    headless,           // true | false | null (unknown)
    transcript_missing, // when known (absent for a pruned Session)
    pruned,             // true when `index --prune` removed the Session's row (E7)
    tool_use_id         // the recorded tool call; absent on rows indexed before it was recorded (E6)
} ] }
```

- Every row has `id`, `kind`, `key`, `timestamp`, `title`, `harness`, `session_id`, `subagent`, `headless`, `pruned`; the others appear when known.
- A file's title is only its basename: no heading, no `<title>`, no Session title (E11).
- The metadata describes that action, not the current state of the file, the Artifact or the Share.

## E3. Which records become rows

From Claude Code Transcripts only: each Session's parent file and its Subagents' files (`<project>/<session>/subagents/*.jsonl`), the row carrying the parent's `session_id`. A row is made when a tool call and its successful result are both recorded:

| Tool call | `kind` | `key` | Rule |
|---|---|---|---|
| `Write` | `write` | the result's `filePath`, else the input's `file_path` | any extension, any path (relative, harness-internal, source code); a path that is empty is no row |
| `Edit` | `edit` | the same | as `Write` |
| `Artifact` with `action` absent or `publish` | `artifact` | the result's `url` | needs an `artifact_id` and a `url` in the result, not `asset: true`; `source_path` from the result's or the input's `file_path`; `version` and `seq` from the result |
| `Bash` whose command runs `tb-backyard share upload` | `share` | the token of the Share URL | one row per Share URL printed by an upload (`Share created` text, or a JSON response with a `files` array); `title`, `visibility`, `state`, `expires_at` from it; `source_path` only when the call has one upload and one Share; a lone upload whose output was filtered (`tail`, `grep`, `jq`) and prints exactly one distinct Share URL still makes a row |

- A failed tool (`is_error`), an asset upload, an Artifact `open` or any other action, `share list`/`update`/`publish`, and a shell write that isn't a Share upload aren't rows. Records in the Transcript that only replay earlier results (`api-request-blob`) are ignored, and a result with no timestamp leaves its call waiting for the real one.
- No file is read or stat'ed to make a row.

## E4. Filters

All filters, `total_results`, `--limit` and `--page` run in SQL.

- `--ext` matches case-insensitively, with an optional leading dot: the file's path extension on a `write` or `edit`, the recorded `source_path`'s on an `artifact` or `share`. A row with no matching path extension is out when `--ext` is set, so a Share with no source is dropped by any `--ext`. There is no default extension filter.
- `--q` (or text after `--`, which also takes text starting with a dash) searches titles, keys and source paths literally, case-insensitively for all of Unicode. Lookout does not use it (the LIB search runs on its own list).
- `--project` matches the exact `project_path`. `--session` matches the parent Session's full id, subagent actions included. `--harness` and `--headless` scope by the recorded Session metadata; `--headless exclude` keeps unknown (`null`), `only` drops it.
- `--after` and `--before` filter each action's timestamp by inclusive UTC day.

## E5. Order and paging

- Newest `timestamp` first, then `id` descending. `total_results` counts actions after the filters, not distinct keys.
- A call's count and its page are read from one snapshot, so a write between them can't make them disagree.
- Lookout reads everything in one call (`--limit 100000`), compares `total_results` with the rows it got, and reads the next pages if it is short (LIB-2.1). Measured: `events --all-projects --json --headless exclude --kind write,edit,artifact,share --ext <the LIB-2.10 table> --limit 100000` took 0.12 s and returned 2.3 MB, 3,066 rows, 1,535 distinct keys, from 185 Sessions, 1,393 rows from Subagents.

## E6. Fork copies and `tool_use_id`

- A forked Session repeats the actions it copied from its original, under its own `session_id` and the **same** `tool_use_id`. A consumer that counts actions once collapses them; tb-session returns each row.
- One `Bash` call can make several `share` rows, all with that call's `tool_use_id` and different keys, so a consumer collapses on `tool_use_id` together with `kind` and `key`.
- Rows indexed before `tool_use_id` was recorded have none; they are what they are.

## E7. Nothing is dropped

- Rows stay when a file or a Transcript goes. A Session whose Transcript was deleted keeps its events and is `transcript_missing`.
- `index --prune` removes the Session's rows and messages but keeps its events, `session_id` and last recorded metadata, with `pruned: true` and without `transcript_missing`. `show` answers `session_not_found` for it, so Lookout gives that Session no button (LIB-3.5).
- A bad record is skipped and the rest are indexed; a rewrite refreshes a Session while keeping its historical actions, and a rebuild or reappearing record doesn't duplicate rows.

## E8. Freshness, upgrade and cost

- `events` first refreshes the parent and Subagent Transcripts that changed, then queries the index, so a new Output is in the next call. An unchanged file is skipped until its mtime or size changes, or `--no-cache` forces it. `list` and `search` refresh parent facts without scanning Subagents; `events` and `index` refresh both.
- Schema v4 upgrades a v3 index without losing Session history and re-parses on first use. Measured: 16.7 s for the upgrade on Dario's Mac (18.9 s in the PR's own run); the Library's 60 s first-call budget stays (LIB-2.8). `tb-session index --all-projects` runs it by hand. A tb-session 0.3.2 refuses a v4 index (`Error: the index was written by a newer tb-session (schema 4, this build knows 3)`) and leaves it untouched.
- Warm, a call with nothing changed is 0.12 s for the whole Library read (E5); `list --all-projects --json --limit 200` is 0.73 s over 13 pages for 2,406 Sessions (one page of all of them is 22 MB, mostly `first_prompt`) (fields `summary`, `first_prompt`, `created_at`, among others).

## E9. Add-only

A later tb-session may add fields, flags and kinds; it never renames or drops one. Lookout leaves a row of a kind it doesn't know out (LIB-2.1).

## E10. A tb-session without the command

0.3.x fails `events` with clap's usage error on stderr, `error: unrecognized subcommand 'events'`, exit 2. Lookout matches that line for its install hint (LIB-2.8); it's a different line from History's `unexpected argument '--…'`, so the Library keeps its own flag, not History's `legacy`.

## E11. Boundary

tb-session gives facts from Transcripts and Lookout keeps its own rules: the README's line, "The CLI fetches, structures and verifies facts; the AI (or app) decides on their relevance and next steps. Rules specific to a single consumer stay with that consumer."

- `events` checks no git ownership, reads and stats no referenced file, calls no network service and reconciles no remote state. It applies no extension rule, no Harness-home rule and no fold; it extracts no title from a file's content and has no Session title; it infers nothing from a Session's environment (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`). Paths are kept as recorded.
- So these are Lookout's (LIB-2.9 to LIB-2.12): which files are Outputs (extension table, Harness homes, git-owned, folder gone), one Output per kind and key, counting fork copies once, the fold of an Artifact and its source file, titles from a file's heading, Session titles from `list`, and whether a file exists.
- File existence, selection and relevance belong to consumers. A reconciliation with Backyard or claude.ai, or a check of files on disk, is never added to `events`; those are tb-backyard's, a Session's, Lookout's or a separate tool's.
