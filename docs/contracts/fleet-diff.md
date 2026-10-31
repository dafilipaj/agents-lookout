# Contract: `fleet diff`

The command Lookout's Changed files feature ([DIFF](../features/changed-files/SPEC.md)) uses to read a live Session's Changes: the Checkouts it may work in, and what changed in each since its Branch point. It's built in the Fleet fork (`dafilipaj/fleet`, branch `lookout`, [0006](../decisions/0006-run-a-fork-of-fleet.md)) as one commit, and verified there, in Fleet's own tests; Lookout's fake `fleet` follows this file, and `pnpm req-check` never looks here (the criteria are DIFF's). Points are numbered C1 to C9 so the commit's tests can cite them. Every field and flag is add-only: a later Fleet may add, never rename or drop.

Written 2026-10-31 against the fork at `17183f9` (Lookout's pin in `e2e/pins.json`), which has upstream's web diff reviewer (`web/lib/diff.mjs`, `web/lib/touched.mjs`) in its Node web server and nothing in the CLI. Amended the same day after a Codex review.

## Why a new command

- Upstream's `GET /api/hosts/:host/sessions/:id/diffs` answers this in Fleet's web server, which Lookout doesn't run ([0004](../decisions/0004-fleet-cli-as-session-layer.md)).
- Which Checkouts a Session works in comes from its Transcripts, which Fleet already finds (`core/stack.rs`, `transcript_path`). Lookout reads no Transcript for this.
- Fleet reports facts: candidates, why each is one, and their Changes. Which candidates a consumer counts is its own rule ([0010](../decisions/0010-single-consumer-rules-stay-with-the-consumer.md)); Lookout's is DIFF-2.1 and 2.2.

## C1. Command and flags

```
fleet --local diff <target> --json [--since <fingerprint>]
```

- `<target>`: as every verb resolves it among the Sessions Fleet lists (`core/discovery.rs`, `resolve_target`): a title, a session-id prefix, `pid:<n>`, `id:<session_id>`. A Session without a session id (a Codex Session before its first prompt) is reached by `pid:<n>`.
- Local only. Lookout always passes `--local`; without it, `FLEET_HOST` or `-H` naming another host is `usage`, and the command never goes through remote dispatch.
- `--since <fingerprint>`: the `fingerprint` of an earlier answer. When it's equal to this one's, the answer is `{ ok, session_id, fingerprint, unchanged: true }` without `candidates` (C5).
- Read-only on every repo (C7).
- A Fleet without the command fails with clap's `error: unrecognized subcommand 'diff'` on stderr, exit 2. Lookout matches that line (DIFF-5.1).

## C2. The answer

```json
{
  "ok": true,
  "session_id": "6f0c…",
  "harness": "claude",
  "fingerprint": "<32 hex digits>",
  "unchanged": false,
  "candidates": [
    {
      "root": "/Users/x/Projects/work/repos/api-worktrees/fix-rates",
      "why": ["edited"],
      "repo": { "common_dir": "/Users/x/Projects/work/repos/api/.git", "linked_worktree": true },
      "branch": "fix/rates",
      "head": "<sha>",
      "on_default_branch": false,
      "base": { "ref": "origin/develop", "sha": "<sha>" },
      "stats": { "files": 2, "additions": 96, "deletions": 30 },
      "files": [
        { "path": "app/models/rates.rb", "kind": "modified", "old_path": null,
          "additions": 40, "deletions": 12, "binary": false, "uncommitted": true }
      ],
      "more_files": 0
    }
  ],
  "skipped": [ { "root": "/…/gone-worktree", "why": ["edited"], "detail": "gone" } ]
}
```

- `session_id`: `null` for a Session without one; `harness`: `claude` or `codex`.
- `candidates`: every candidate C3 found and read, with or without Changes, the working directory's first, then by most recent edit. At most 12.
- `why`: one or both of `"cwd"` (the Session's working directory is in it) and `"edited"` (the Session edited a file in it, C3).
- `repo`: git's common directory (`git rev-parse --path-format=absolute --git-common-dir`) and whether the root is a linked Worktree (its git dir differs from the common dir), so a consumer can name it.
- `branch`: the short branch name, `null` when HEAD is detached. `head`: `null` in a repo without commits.
- `on_default_branch`: `branch` equals the default branch's short name (C4); `false` when detached or there's no default.
- `base.ref`: the default branch used, `null` when there is none. `base.sha`: the Branch point (C4).
- `files`: sorted by `path`, at most 500; `more_files` counts the rest. `stats` covers all of them.
- `kind`: `added`, `modified`, `deleted`, `renamed` (with `old_path`), `type_changed`, `mode_changed` (only the file mode differs), `submodule` (a gitlink changed; its contents aren't diffed). `binary` and `submodule` files, and `mode_changed` ones, have `additions` and `deletions` 0.
- `uncommitted`: the file differs between HEAD and the working tree (staged or not, or untracked).
- `skipped`: candidates that couldn't be read, with `detail`: `gone` (the directory no longer exists), `not_git`, `unsupported` (C6), `busy` (C4, HEAD moved twice), `git_failed`, `timeout`. They count in no total.

## C3. Candidates

- **The working directory's Checkout** (git's `--show-toplevel` of the Session's cwd) is always a candidate, `why: ["cwd"]`, when the cwd is in git.
- **Edited files** come from the Session's Transcript and every Transcript of its Subagents, nested ones included, running or finished: all of the Session's Subagent Transcript files, not the process-filtered set `list` counts for running Subagents.
  - Claude Code: `tool_use` inputs `file_path` and `notebook_path` of `Edit`, `MultiEdit`, `Write` and `NotebookEdit`, and `edits[].file_path`; a `Bash` command's write targets (`> f`, `>> f`, `tee [-a] f`), resolved against the last `cd <dir>` before them when relative, as upstream's `touched.mjs` `ingestCommand` does. Paths other tools only read don't count.
  - Codex: none yet. Codex 0.16x rollouts carry no `patch_apply_end` event and run `apply_patch` inside `exec` (DIFF Technical approach, Codex); a later commit adds them after recording real rollouts.
  - Only absolute paths count (a `~/` one is expanded), never under `/dev` or `/proc`.
- **An edited file's Checkout** is found when the edit is read: the nearest directory up from the file holding a `.git` (a directory or, for a Worktree, a file), as git's `--show-toplevel` names it: symlinks are resolved first, as git resolves them. Never `$HOME` or `/` (the real paths). It's stored with the edit, so a Checkout that's removed later is still known and reported as `skipped: gone`, never replaced by the repo around it.
- At most 12 candidates: the working directory's, then by the most recent edit in each, by the edit's Transcript `timestamp` across all of the Session's Transcripts.
- **Incremental**: Fleet keeps, per Session with a session id, the Checkouts found with their latest edit time, and per Transcript its path, inode and the byte offset read to, under its state dir (`~/.local/state/fleet/diff/<session_id>.json`). A call reads only what each Transcript grew by since, up to its last complete line; a partial last line is read on a later call. A Transcript whose inode changed, or that shrank, is read again from the start. The first call reads each Transcript whole. The state is written to a temporary file and renamed into place, under an exclusive lock on `<session_id>.lock`; a second call waits for the lock up to 10 s, then answers without saving. A lock whose file was deleted meanwhile is taken again on the file now there. A state file that doesn't parse is discarded and rebuilt. A state file no call has touched for 7 days is deleted (its Session is long gone), only while its lock can be taken: a call still holding it keeps its state. A Session without a session id keeps no state: its only candidate is its cwd's.

## C4. A candidate's Changes

From one snapshot per candidate:

1. Read HEAD (`rev-parse --verify --quiet HEAD^{commit}`) and the branch (`symbolic-ref --quiet --short HEAD`).
2. **The working tree as a tree**: copy the Checkout's index (`rev-parse --git-path index`) to a temporary file outside the repo, `git add -A -- .` with `GIT_INDEX_FILE` set to it, `git write-tree`, delete the copy and its `.lock`. A repo without an index starts from an empty one. The real index, and any `index.lock` on it, is never touched. Ignored files stay out.
3. Read HEAD and the branch again. If either moved, start over once; if they moved again, the candidate is `skipped: busy`.
4. **The default branch**: `refs/remotes/origin/HEAD`'s target, else a local `main`, else `master`; none → no default.
5. **The Branch point**: HEAD when on the default branch (`on_default_branch`), when there's no default, or when there's no merge-base; else `git merge-base <head> <default>`, with the HEAD read in step 1, never a newer one. Without commits, the repo's empty tree (`git hash-object -t tree /dev/null`, so a SHA-256 repo gets its own).
6. **Files**: `git diff --numstat -z -M --no-ext-diff --no-textconv --no-color <base> <tree>` and `--raw -z` for kinds and modes; `uncommitted` from the same diff of HEAD (the empty tree without commits) against the tree.

- **Fingerprint**: opaque, 32 hex digits (two FNV-1a 64 hashes) over the lines `<root>[<why>]=<base.sha>:<head or ->:<branch or ->:<default ref or ->:<tree>` of every candidate, and `<root>[<why>]=skipped:<detail>` for skipped ones, in C3's order (`<why>` comma-joined: a Checkout first counted as the cwd's that the Session then edits changes the answer). Equal fingerprints mean equal answers. An `unchanged` answer still takes the snapshot (steps 1 to 3): it saves the diff (step 6), not the hashing.
- **Limits**: every git call runs with a 20 s timeout, two candidates at a time; the whole command stops at 50 s, reporting the candidates not yet read as `skipped: timeout`. Reading Transcripts counts toward it: past it, a Transcript is read no further (the next call goes on from there).

## C5. Failures

A failure (exit 1, exit 2 for `usage` from clap) prints `{ "ok": false, "kind", "error" }`, as other verbs do.

| kind | when |
|---|---|
| `usage` | flags as C1 says, or another host |
| `target_not_found` | no listed Session matches |
| `target_ambiguous` | more than one does |

A Session without a Transcript yet isn't a failure: its edited files are none. A candidate that fails is `skipped` (C2), never a failure of the call. A state dir that can't be written isn't one either: the answer comes without saving.

## C6. Unsupported states

- A Checkout with unmerged index entries (a merge, rebase or cherry-pick stopped on conflicts), or with a sparse index or sparse checkout on, is `skipped: unsupported`.
- A submodule's gitlink change is a file of kind `submodule`; its own working tree isn't read.
- A split index is read as git reads it: its shared index file from the git dir. The copy in step 2 is written whole (`-c core.splitIndex=false`), so no new shared index file lands in the repo. Reading one refreshes its mtime, as every git read does.

## C7. Boundary

- Every git call runs with a cleared environment for git's own variables (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` except as step 2 sets it, `GIT_OBJECT_DIRECTORY`, `GIT_CONFIG_*`, and the rest of `GIT_*`), `-C <root>`, and `-c core.quotePath=false -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.untrackedCache=false -c core.splitIndex=false -c fetch.negotiationAlgorithm=noop` with `GIT_NO_LAZY_FETCH=1` and `GIT_TERMINAL_PROMPT=0`, so no hook, fsmonitor or partial-clone fetch runs.
- Clean filters a repo configures (Git LFS's, `filter.<name>.clean`) still run on `add`, as they would for `git status`; this is a known limit, not a guarantee.
- Nothing in a repo changes: no refs, no real index, no config. The only writes are loose objects for changed files (git's `gc` reclaims them) and the temporary index outside the repo.
- No file contents are printed: paths and numbers only. Lookout reads a base version itself, with `git show` (DIFF Technical approach).

## C8. Codex

Codex Sessions get only their working directory's candidate (C3), with no state kept beyond what C3 needs.

## C9. Tests in the fork

Temporary repos built in the test, never a real one:

- A repo on its default branch with an uncommitted edit, and with a local commit ahead of `origin` (not counted: the Branch point is HEAD); a feature Worktree with a commit and an untracked file (both counted, `uncommitted` right for each); a rename; a mode change; a binary file; a deleted file; a type change (file to symlink); a submodule gitlink change; a repo without commits; a repo without a remote or `main`; a SHA-256 repo.
- C3 from recorded Transcript lines: each Claude Code tool and a shell write after `cd`; a finished Subagent's Transcript; a read-only path that doesn't count; `$HOME` and `/` never a candidate; a removed Worktree reported as `skipped: gone`, not as its parent repo.
- C4: a commit between the two HEAD reads (start over, then `busy`; covered by the retry's code path, not raced in a test); `--since` unchanged after a commit of the whole working tree (must differ: HEAD moved); an `index.lock` on the real index (still read); the cwd's Checkout that the Session then edits (`--since` must differ).
- C6: a conflicted merge and a sparse checkout as `unsupported`; a split index (no new shared index file).
- C7: a `post-index-change` hook and an fsmonitor hook that write a marker file never run; the real index's mtime and content are unchanged.
- Incremental state: a second call reads only the appended lines; a partial last line is read once complete; a replaced Transcript (new inode, same size) is read from the start; two concurrent calls; a corrupt state file.
- `pid:` targets without a session id; `FLEET_HOST` set to another host (`usage`).
- More than 500 files (`more_files`); more than 12 candidates; the 50 s stop (`skipped: timeout`; by the deadline checks, not waited out in a test).
- C3: a symlink into a repo finds it, one into `$HOME` doesn't; pruning keeps a state whose lock is held.
