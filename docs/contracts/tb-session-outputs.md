# Contract: `tb-session outputs`

The command Lookout's Library ([LIB](../features/library/SPEC.md)) reads. It's built in cli-toolbox (`crates/tb-session`) by a separate PR that lands first (LIB, Dependencies, Gap 1), and verified there, in tb-session's own tests; Lookout's fake tb-session follows this file, and `pnpm req-check` never looks here (the Library's criteria are LIB-1 to LIB-3). Points are numbered C1 to C10 so the PR's tests can cite them. Every field and flag is add-only: a later tb-session may add, never rename or drop.

Written 2026-10-23 from the LIB spec and its grill. Measurements are from Dario's Mac on that day (tb-session 0.3.2 installed, 0.3.1 checked out).

## C1. Command and flags

```
tb-session outputs [--all-projects] [--project <path>]
                   [--kind file,artifact,share] [--type markdown,html,pdf,image]
                   [--session <id> --harness <h>]
                   [--after 7d] [--before …] [--q <text>]
                   [--headless include|exclude|only]
                   [--limit 50] [--page 1] --json
```

- `--all-projects`, `--session <id> --harness <h>`, `--after`, `--before`, `--headless`, `--limit` and `--page` work as `list`'s do (`--session` lists the Outputs that Session touched).
- `--project <path>` keeps rows whose `project_path` is exactly that path, as `list` scopes its own cwd. Lookout's repo select uses it, so `total_results` stays true for the chosen repo.
- `--kind` keeps rows of those kinds. `--type` narrows **file rows only**: a row of kind `artifact` or `share` passes by `--kind` alone, whatever `--type` says; the flag's help says so. So "HTML files and Artifacts" is `--kind file,artifact --type html`.
- `--q <text>` searches `title`, `key` (the path, URL or token) and the source path (C5, C7). Lookout passes the text after `--`, as History does.
- Without `--json`, a readable table; the shape below is `--json`'s.
- A tb-session without the command fails with clap's usage error: `error: unrecognized subcommand 'outputs'` on stderr, exit 2 (checked on 0.3.2). Lookout matches that line for its install hint; it's a different line from History's `unexpected argument '--…'`, so the Library keeps its own flag, not History's `legacy`.

## C2. Fields

```
{ total_results, page, results: [ {
    kind,                      // "file" | "artifact" | "share"
    key,                       // file: absolute path; artifact: url; share: token
    type,                      // file only: "markdown" | "html" | "pdf" | "image" (C4); absent otherwise
    title,                     // artifact and share: from the result; file: the first Markdown heading or
                               // <title> in the Write's content, else the basename; an Edit never changes it
    url, path,                 // whichever applies
    source_path,               // artifact and share: the local file they were made from, when known
    source,                    // artifact only: its folded source file (C5), or absent
    harness, session_id,       // the parent Session that first produced it
    project_path, git_branch, headless,
    created_at, updated_at,    // first and last event
    events,                    // number of this item's own events: writes and edits, publishes, or uploads
    sessions: [ {              // every Session that touched it, newest last touch first (C6)
      harness, session_id, last_at,
      title,                   // summary, else first_prompt, as list gives them
      project_path, headless, transcript_missing,
      events,                  // that Session's touches of this item
      event,                   // its last touch: "write" | "edit" | "publish" | "upload"
      pruned                   // true when index --prune removed the Session's row (C8): then title,
                               // project_path, headless and transcript_missing are absent
    } ],
    version, seq,              // artifact: the last publish's
    visibility, state, expires_at   // share: what the upload printed, never reconciled
} ] }
```

- `total_results` counts rows after the fold (C5) and the flags, so Lookout's paging is exact.
- There is no `exists`: tb-session stats nothing (C9). Lookout checks files itself (LIB-2.9).
- An empty `project_path` is left out, as `list` does.

## C3. What makes an Output

From the Claude Code source, in the parent Transcript (`<project>/<session>.jsonl`) and in its Subagents' (`<project>/<session>/subagents/*.jsonl`), credited to the parent Session:

| Event in the Transcript | Kind | Key | Rule |
|---|---|---|---|
| `Write` of a file (`toolUseResult.filePath`) | `file` | absolute path | a document extension (C4); not git-owned; not under a Harness home |
| `Edit` of a qualifying file | `file` | absolute path | same rule; updates `updated_at`, adds the Session to `sessions`; creates the item if it isn't known (the file was made by a heredoc, say) |
| `Artifact` publish whose `toolUseResult` has `artifact_id` and `url`, not `asset: true` | `artifact` | `url` | every successful publish; an update to the same URL is a version of one item; the publish's `file_path` is its `source_path` |
| `Bash` whose command runs `tb-backyard share upload`, with a `backyard.productive.io/s/<token>` URL in its stdout | `share` | token | the URL is the anchor; with `--json` the stdout is the full `ShareResponse`, read for `title`, `visibility`, `state`, `expires_at`; without it `title` and `visibility` are parsed from the printed text when it parses, else left empty |

- A refused publish (`is_error`, no `artifact_id`), an asset upload (`asset: true`) and a `files` map aren't events.
- **Git-owned** means inside a git work tree and not ignored (`git check-ignore`). The answer is found at index time, once per distinct directory, cached (work-tree root and the ignore answer per directory), never at answer time: an `outputs` call runs no `git`.
- **Harness homes** are only the roots tb-session's scanner already knows: `~/.claude`, `~/.codex`, `~/.pi`. `CLAUDE_CONFIG_DIR` and `CODEX_HOME` set in a Session's environment aren't in the Transcript and aren't considered.

## C4. Extensions and types

A file is an Output only when its extension (case-insensitive) is in this table; `type` is the table's answer.

| Extension | `type` |
|---|---|
| `md` | `markdown` |
| `html`, `htm` | `html` |
| `pdf` | `pdf` |
| `png`, `jpg`, `jpeg`, `gif`, `svg`, `webp` | `image` |

Widening the table is one line here and one in Lookout's row icons.

## C5. The fold: an Artifact and its source file are one row

- A `file` item whose path is an Artifact item's `source_path` is **not returned as its own row**, whatever `--kind` or `--type` say. The Artifact item carries it as `source`:

  ```
  source: { path, type, created_at, updated_at, events }
  ```

  `path` is the file's absolute path, `type` its C4 type, `created_at` and `updated_at` its first and last write or edit, `events` its count of them. The file's title isn't carried: the Artifact's `title` is the page's.
- The Artifact's `sessions` lists every Session that published it **or** wrote or edited its source file, each once with its last touch and `event`; `events` stays the Artifact's own count (publishes).
- A file that is the source of two Artifacts nests under both.
- A file edited after the Artifact's last publish stays folded; `source.updated_at` is then later than the Artifact's `updated_at`, which is how Lookout says the file is newer than the published version.
- `--q` matches `source.path` too (C1), so a search for the file's name finds the Artifact's row.
- The fold is tb-session's, not Lookout's, so a page of 50 is 50 rows and `total_results` is exact. A source file nothing Wrote or Edited (a heredoc, an earlier Session) makes no `file` item, so there's nothing to fold: `source_path` is set and `source` is absent.

## C6. One item per key

Repeated events on one key make one item: `created_at` from the first, `updated_at` from the last, `events` counted, `sessions` listing each Session once with its last touch, newest first. An item is rebuilt per Session inside the same transaction as that Session's messages (delete its events, reinsert, re-aggregate the touched items).

## C7. Tables, search and change keys

- **Tables:** `outputs (harness, session_id, kind, key, type, title, source_path, project_path, created_at, updated_at, events, version, seq, visibility, state, expires_at, PRIMARY KEY (kind, key))` and `output_events (kind, key, harness, session_id, subagent, event, ts, version)`, filled in the same incremental pass as the messages (`ensure_fresh`), inside the same per-Session transaction and error handling, so a bad Transcript is skipped with a warning as today.
- **Change keys are per file:** `<session>.jsonl` and each `subagents/*.jsonl` carry their own change key (mtime + size), and `output_events.subagent` says which file an event came from. A Subagent's write re-parses that Subagent file alone and re-aggregates the parent's items; a parent write never re-parses its Subagents. (Subagent Transcripts are 2.2× the parents' bytes here, 1.84 GB; one key over all of them would re-parse the lot on every live write.)
- **`--q`:** `%` and `_` in the text are escaped; the match is case-insensitive for all of Unicode (`instr(lower(...))` or an equivalent, not bare `LIKE`, which folds ASCII only); results are newest `updated_at` first, no ranking.

## C8. Nothing is dropped

- Rows are never dropped when a file or a Transcript goes. A Session whose Transcript was deleted is `transcript_missing` in its `sessions` entry and still answers `show`.
- `index --prune` removes a pruned Session's row but keeps its Outputs; the item's `sessions` keeps the id with `pruned: true` and without the joined fields. `show` answers `session_not_found` for it, so Lookout gives that Session no button (LIB-3.5).

## C9. Boundary

tb-session indexes **facts from Transcripts**, with one named exception: the git-owned check of C3, at index time. It reads nothing from the network and nothing from files at answer time: `outputs` reads no file but the Transcripts and stats none. So a reconciliation with Backyard or claude.ai, or an existence or content check of files on disk, is never added to it; those are tb-backyard's, a Session's, Lookout's or a separate tool's. The crate's `SKILL.md` and the cli-toolbox README state this boundary (the crate has no README of its own).

## C10. Performance budget and migration

Measured on Dario's Mac (2,252 Sessions; 1.5 GB of parent Claude Transcripts, 1.84 GB of Subagent ones):

- A full re-index with outputs on, Subagent Transcripts included, stays within 3× of today's 6–8 s and in any case within 60 s, the budget Lookout gives the first call after an upgrade (LIB-2.8); measured with the Subagent files in the PR.
- A warm `outputs --json` call with nothing changed answers within 0.3 s (`list`: 0.19 s); one with a single changed 30 MB live Transcript within 2 s (`list`: 1.57 s).
- The outputs tables add less than 1 MB per 1,000 Sessions; `search` and `list` timings are unchanged.
- The schema bump to v4 migrates an older index without dropping rows, as the v3 migration does, and re-parses on first use (that first call is the 60 s one). `tb-session index --all-projects` runs the re-index by hand; Lookout names it when the first call times out.
