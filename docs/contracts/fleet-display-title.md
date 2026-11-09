# Contract: `fleet list`'s `display_title`

What a Session is called ([SIDE-10](../features/session-sidebar/SPEC.md)). `list --json` already carries `display_title`, which the fork's `core/title.rs` calls "the one title every view draws". This contract changes the order it's chosen in, so it takes the Harness's own title. It's built in the Fleet fork (`dafilipaj/fleet`, branch `lookout`, [0006](../decisions/0006-run-a-fork-of-fleet.md)), with its tests there.

Written 2026-11-06 from the clarity pass (Plan item 44), against the fork at `5490190`.

## Why

- Today's order (`title::display_title`): the chosen name, then Fleet's generated title (`gen_title`, only after `fleet name`), then a slug of the first prompt (`naming::heuristic_from`), then the session label. Claude Code's own title never enters it.
- Claude Code titles every Session itself: it appends `{"type":"ai-title","aiTitle":"…"}` to the Transcript after the first exchange and again through the Session (21 times in each of the three long Transcripts sampled on 2026-11-06, the first by line 55). tb-session reads it for History (`custom-title`, then `ai-title`, then the first prompt).
- So a Session had two names. On 2026-11-06 all five live Sessions did: `let-s-resolve-merge-conflicts` in Lookout's sidebar was "Fantastic-productive PR 3426" in History, and three rows had that slug. `gen_title` was empty on all of them, so they fell through to the slug.

## C1. The order

`display_title` is the first of these that exists, trimmed, never blank:

1. **The chosen name.** Claude Code: the registry's `name` when `name_source` isn't `derived` (a `/rename`, `-n`, the resume picker, `fleet name --apply`), as today. Codex: its thread's name, the last entry for its id in `$CODEX_HOME/session_index.jsonl`; Codex writes one for a rename and also titles threads itself (31 threads named there on 2026-11-06), so both count here.
2. **The Harness's own title.** Claude Code: the `aiTitle` of the last `ai-title` record in the Session's Transcript. A record whose `aiTitle` isn't a non-blank string is skipped.
3. **Fleet's generated title** (`gen_title`), when `fleet name` has stored one.
4. **The first prompt, as written:** the first non-blank line of `title` (the first genuine prompt, as `list` reads it today), whitespace collapsed, at most 80 characters, cut at a word with `…`. Never a slug.
5. The session label (short session id, else the pid), as today.

Steps 1, 2 and 4 are tb-session's order, so a live Session's name and its History result agree once tb-session has indexed it.

## C2. What stays

- `title` (the first prompt, in full), `name`, `name_source` and `gen_title` keep their meaning and shape.
- The tmux session name stays a slug that follows renames (`tmux_name_for`, `apply_rename`). The Harness's title doesn't rename it: Lookout never shows tmux ([0001](../decisions/0001-tmux-as-hidden-session-host.md)).
- `resolve_target` matches a title through `Session::headline`, which is `display_title`, so a target written as the new name resolves. Lookout targets Sessions by session id, so it doesn't depend on this.

## C3. Cost

- Lookout runs `fleet --local list --json` every 2 s, a new process each time, and Transcripts reach 27 MB. Step 2 must not read a whole Transcript on every call.
- How is Fleet's to choose. One way: keep, per Transcript, the byte offset read so far and the last title found, on disk beside `fleet-names.json`. Each call then reads only what was appended, and starts over when the file is shorter than the offset or was replaced (another inode).
- Budget: a warm `list --json` with ten Sessions whose Transcripts total 100 MB takes at most 20 ms longer than today's. A cold one (no cache) stays well inside Lookout's 4 s timeout (`FLEET_TIMEOUT_MS`).

## C4. Failures

An unreadable or missing Transcript, a malformed record, or an unreadable cache leaves step 2 out for that Session. It never fails `list`, and never drops the row.

## C5. Tests in the fork

- The order: a fixture per step, and a Session with all of them shows the chosen name.
- Parity: on a set of fixture Transcripts, `display_title` equals tb-session's title for the same Session.
- Appending an `ai-title` changes `display_title` on the next `list`; truncating or replacing the Transcript resets the cache; a malformed record is skipped.
- The first-prompt step keeps the prompt's words and case (`Let's resolve merge conflicts and…`), never `let-s-resolve-…`.

## Lookout's side

- No new field to read: `normalize.ts` already takes `display_title` as the row's title. Lookout's pin in `e2e/pins.json` is the fork commit `2e8f860` (built 2026-11-06, pushed and pinned 2026-11-09).
- Built in the fork as `core::harness_title`: the cache is `~/.claude/fleet-harness-titles.json`, a first read scans 256 KiB, 2 MiB, 8 MiB, then the whole file until a title turns up, and entries unused for a week are dropped. Measured on 2026-11-06 with two live Sessions (one Transcript about 30 MB): warm `list --json` 100 to 108 ms against 110 to 118 ms before; cold 326 ms. A stamped row keeps its `display_title` in `headline()`, so another host's row in `list --all-hosts` keeps step 2.
- With an older Fleet, the row's name is what that Fleet sends, as today; nothing breaks.
