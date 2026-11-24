# Contract: `tb-session events --kind agent`, and tb-session 0.6.0

What Lookout's Evidence ([EVID](../features/done-evidence/SPEC.md), slice 2) needs from tb-session: a new kind of row in `events`, one per Subagent a Session started, with what it was asked, its model and how it ended. Evidence counts the review Subagents among them (EVID-6.1). It doesn't exist yet. It's built in cli-toolbox in 0.6.0, one PR stacked on #130 (the command kind), with a Session's model and effort ([`tb-session-list-model.md`](tb-session-list-model.md)) and the changes in A9. Lookout's fake tb-session follows this file, and `pnpm req-check` never looks here (the criteria are EVID-6). Points are numbered A1 to A10 so the PR's tests can cite them. It extends [`tb-session-events.md`](tb-session-events.md) (E1 to E11) and follows [`tb-session-events-command.md`](tb-session-events-command.md) where a point says so. Every field and flag is add-only.

Written 2026-11-21 from probes of Dario's Claude Code Transcripts (the 250 to 300 most recent Sessions of the 7 days before), and from an assessment, the same day, of whether `events` belongs in tb-session (A9). The record shapes below are what those Transcripts hold, not Claude Code's documentation. Reviewed the same day by Codex (gpt-6.1-sol, xhigh), whose fixes are in A2 (a running foreground call's `timestamp`), A3 (the sidecar), A4 (an error first, ends matched across Transcripts) and A10 (the upgrade). Amended after 0.6.0 was built and reviewed, from what the build found in the Transcripts: `background` and a fork's launch (A3, A4), an interrupt's words (A4), commands' notifications (A4), the model's placeholder records (A3), a late sidecar (A3) and which refreshes must leave which rows alone (A10).

## Why `events`, not Fleet

- Fleet's `subagents.items` ([`fleet-subagents.md`](fleet-subagents.md)) gives a live Session's Subagents with their task, model, start, end and state, but at most 20, and only while Fleet tracks the Session. A Session that builds a spec slice by slice starts more than 20.
- `events` already reads a Session's parent and Subagent Transcripts whole, keeps their history, and gives the command kind's start, end and notifications. A Subagent call is one more recorded action, and its end comes the same way as a background command's.

## A1. Command and flags

`tb-session events --kind agent` (alone or with the other kinds), with E1's flags. Lookout reads it with the commands, for one Session:

```
tb-session events --all-projects --session <id> --kind command,agent --limit 1000 --json
tb-session events --all-projects --session <id> --kind command,agent --limit 1000 --page 2 --json   # and on, until total_results
```

- `--ext` drops every agent row, as it drops command rows (K1). `--q` searches the description.
- tb-session 0.5.0 refuses `agent` as an unknown `--kind` value (clap's exit 2); Lookout asks for it only when TOOLS says the version has it (EVID-6.2).

## A2. Fields

An agent row has E2's fields that every row has (`id`, `kind: "agent"`, `key`, `timestamp`, `title`, `harness`, `session_id`, `subagent`, `headless`, `pruned`), the ones it has when known (`project_path`, `git_branch`, `transcript_missing`, `tool_use_id`), and:

```
key,            // the tool_use_id
title,          // the description, at most 120 characters, or the subagent type when there's none
description,    // what the call asked it to be called, whole, or null
subagent_type,  // as recorded ("general-purpose", "Explore", a plugin's agent), or null
model,          // the model it ran on (A3), or null
effort,         // the effort it ran with (A3), or null
agent_id,       // Claude Code's agent id, which names its Transcript (agent-<id>.jsonl), or null until recorded
background,     // true when the call ran it in the background
started_at,     // the tool call's timestamp
timestamp,      // when its end was recorded (A4); while it runs, its launch result's (background) or its started_at (foreground, no result yet)
ended           // "completed" | "failed" | "stopped" | "running"
```

- `subagent` is E2's: the Subagent whose Transcript holds the call, null for the Session itself. `agent_id` is the Subagent the call started.
- A field that can be null is always present. null means the Transcript records none, never a default.
- The prompt isn't a field. It can be long, and Lookout's rule reads the description and the type (EVID-6.1).

Example, invented:

```json
{ "id": 915, "kind": "agent", "key": "toolu_01D", "tool_use_id": "toolu_01D", "title": "Code review round 2",
  "description": "Code review round 2", "subagent_type": "general-purpose", "model": "claude-opus-5-5", "effort": "xhigh",
  "agent_id": "a1f0c2…", "background": true, "started_at": "2026-11-21T14:02:10.120Z",
  "timestamp": "2026-11-21T14:08:41.900Z", "ended": "completed",
  "harness": "claude", "session_id": "5b0c…", "subagent": null, "headless": false, "pruned": false }
```

## A3. Where they come from

Claude Code records a Subagent as an `Agent` tool call (older Transcripts: `Task`) and its result:

| Field | From |
|---|---|
| `description`, `subagent_type` | the call's input: `description`, `subagent_type` |
| `background` | true when the call's input asked for it (`run_in_background`), or when its result shows it was launched in the background (A4 rule 2); else false. 501 of 1,015 background launches seen had no `run_in_background` in the call. |
| `agent_id` | the result's `toolUseResult.agentId`; else the sidecar's (below) |
| `model` | the result's `toolUseResult.resolvedModel` (a model id); else the last assistant record's `message.model` in the Subagent's Transcript, Claude Code's `<synthetic>` placeholders left out; else null. The call's own `model` and the sidecar's are an alias when the call asked for one (`opus`), and are never the field. |
| `effort` | the call's input `effort`; else the sidecar's `effort`; else the last assistant record's `effort` in the Subagent's Transcript; else null |

- A value from the Subagent's own Transcript, or from its sidecar, is read again whenever either changes, so a sidecar written after the Transcript, or a model the Subagent switched to, shows on the next refresh.
- **The sidecar links a call to its Subagent.** Beside each Subagent's Transcript (`subagents/agent-<id>.jsonl`), Claude Code writes `agent-<id>.meta.json`, holding the call's `toolUseId` and its `description`, `agentType`, `model`, `effort` and `spawnDepth` (seen 2026-11-21). The Subagent whose sidecar's `toolUseId` is the call's id is the one it started, and `<id>` is its `agent_id`. Two Subagents started at once are told apart this way, never by time.
- Seen 2026-11-21: of 31 results with a `toolUseResult`, every one had `agentId` and `resolvedModel`. Its `status` was `async_launched` for one started in the background and `completed` for one that ran in the foreground. 14 results had no `toolUseResult`; `agent_id` and `model` then come through the sidecar, else null.
- The input's `model` and `effort` are present only when the call asked for them (20 and 16 of 39 calls).

## A4. How it ended

The first rule that applies:

1. **An error result** (`is_error` true) is failed, unless its text says the user interrupted it ("interrupted by user"), which is stopped. This holds whatever the input asked, so a background launch that failed never waits for a notification.
2. **A launched background one** (its result's `toolUseResult.status` is `async_launched`; or, without a `toolUseResult`, its input's `run_in_background` is true or its result's text begins "Async agent launched" or "Fork started — processing in background", as a fork's does: 22 of 25 forks seen had neither the flag nor a `toolUseResult`) ends with its latest task notification. A notification belongs to it by its `<tool-use-id>`; one with only a `<task-id>` belongs to the row whose `agent_id` is that id (in the probe, a Subagent's task id was its agent id in all 64 notifications that had both, and the 8 with only a task id each matched one). Its `<status>`: `completed` is completed, `failed` is failed, `killed` and `stopped` are stopped. A successful `TaskStop` of its task id is stopped. Without either yet, it's running. Notifications come in K5's three forms (a user record, a queue-operation enqueue, a `queued_command` attachment). A notification without a status ("resumed by the user") changes nothing.
3. **Any other result** is completed.
4. **No result yet:** running.

- Notifications and `TaskStop` results are matched across every Transcript of the Session, its parent's and all its Subagents', wherever they're recorded. A nested Subagent's notification can land in the Transcript of the one that started it, or higher. A command's are matched the same way, across the Session (K5, amended 2026-11-24).
- How a row ends after it's written is one rule for commands and calls (A9); only where their notifications are looked for differs.
- As K5's amendments have it for commands: a known end is never replaced by running, and an end never moves earlier.
- `timestamp` is the record that ended it: the error or other result, the notification, or the `TaskStop`'s result.

## A5. Which calls

- Every `Agent` or `Task` call in the Session's parent Transcript and in its Subagents' Transcripts, so a Subagent started by a Subagent is a row, with `subagent` set to the one that started it.
- One row per `tool_use_id`. A forked Session's copied calls come back once (E6, K7).
- A call that a hook or a permission refused started nothing and isn't a row.

## A6. Order and paging

As K7: newest `timestamp` first, `--limit` and `--page` as E1, `total_results` counting every row that matches.

## A7. Facts only

tb-session never says which Subagent is a review, a test run or anything else. Lookout's rule does that from the description and the type (EVID-6.1, [0010](../decisions/0010-single-consumer-rules-stay-with-the-consumer.md)).

## A8. Codex (a later version)

Codex records its Subagents as `spawn_agent` calls and child rollouts (Fleet reads them, `fleet-subagents.md` S1). They're out of 0.6.0, with K10's Codex commands; Codex Sessions are EVID's slice 4.

## A9. The release, 0.6.0

One cli-toolbox PR, stacked on #130, which merges first as it is. An assessment on 2026-11-21 found that `events` added a new responsibility to tb-session, "what did Sessions do?" beside "which conversation?", whose only caller is Lookout. Dario chose to keep it in tb-session and to separate it inside the binary in this release, rather than start a second CLI:

- **The agent kind (this file) and a Session's `model` and `effort`** ([`tb-session-list-model.md`](tb-session-list-model.md)) ship together, so there is one re-read of every Transcript.
- **Events keep their own change keys and parse version.** A later kind then re-reads for events only, with no schema bump and no rewrite of the search index. Today `event_files` has no parse version, so every new kind is a schema bump (`src/index/schema.rs`).
- **`search`, `list` and `show` stop extracting events,** and `events --session <id>` refreshes only that Session's files, not every project's (`src/main.rs`).
- **Each Harness's events go behind its source** (`TranscriptSource`): no `source.id() == "claude"` in the shared refresh, and no `harness='claude'` in the events SQL (`src/index/mod.rs`, `src/index/events.rs`).
- **A fact per kind:** an enum by kind, not one flat event with an optional command fact, so an agent's start and end don't collide with a command's (`src/events.rs`). How a row ends after it's written (K5, A4) is one shared rule, not a `command` special case.
- **tb-session's purpose, restated** in `Cargo.toml` and the Skill: "the local index of agent Transcripts: find Sessions and list what they did". `events` joins the Skill's "When to use", and field-level detail moves from the Skill to `events --help`.
- **The PR states the index's size** before and after, for #130's schema 5 and for this release.

The index upgrade: once, to the layout above. tb-session 0.5.0 then refuses the index, as 0.4.0 refuses 0.5.0's (K11).

## A10. Tests in cli-toolbox

Invented Transcripts:

- a foreground Subagent that completed, one whose result is an error, one the user interrupted, and one with no result yet (running, its `timestamp` its `started_at`);
- a background one ended by each notification status (completed, failed, killed, stopped), one stopped by `TaskStop`, one still running, one whose notification carries only a task id, and one whose launch failed with an error result (failed, never running);
- each of K5's three notification forms;
- a Subagent started by a Subagent, whose notification is recorded in its starter's Transcript, and one whose notification is recorded in the parent's;
- two Subagents started at once whose results have no `toolUseResult`, each linked to its call by its sidecar's `toolUseId`, its model from its own Transcript;
- a forked Session's copied call;
- an old `Task` call.

Also: a call refused by a hook (no row); `--kind command,agent` paging; a new event kind re-reading events only, with the search rows untouched (A9).

The upgrade, from a populated 0.5.0 index (schema 5) holding command rows, one Session whose Transcript is gone and one pruned Session's surviving Subagent:

- every event row is kept, those whose Transcript is gone included, with no row twice;
- agent rows appear for the Transcripts that still exist;
- `model` and `effort` are null for a Session whose Transcript is gone (M3);
- after it, a `search`, `list` or `show` refresh leaves the events' change keys and parse version as they were, and an `events` re-read caused only by a new events parse version (no Transcript changed) leaves the Sessions' rows, their change keys and the search rows as they were.
- An `events` refresh of a Transcript that changed may index its Session as `list` would, Session row and search rows included, so a Session only `events` has seen can be pruned and marked `transcript_missing`; `list` then finds it fresh. (Amended after the Codex review of 0.6.0: the earlier wording forbade this.)
