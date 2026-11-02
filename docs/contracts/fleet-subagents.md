# Contract: `subagents.items` in `fleet list --json`

The per-Subagent list Lookout's status line opens from its Subagents count ([VIEW-8](../features/session-view/SPEC.md#view-8-subagents-in-the-status-line), VIEW-8.6–8.13). It's built in the Fleet fork (`dafilipaj/fleet`, branch `lookout`, [0006](../decisions/0006-run-a-fork-of-fleet.md)) as an addition to the `subagents` field the counts already use (SIDE's Technical approach, "Running Subagents"), which left room for it.

Written 2026-11-02 against the fork at `1ef21c6`, and corrected the same day as the fork built it (the fork-log rule, `depth` and `model` as found, Codex's `exec` calls). Text fields are cut to 500 characters.

## Why in `subagents`, not `background`

- `list --json` also carries upstream's `background` (`core/background.rs`): `agents[]` with `description`, `type`, `model`, `started_at`, `last_activity_at` and `activity`. Lookout doesn't use it for this.
- It reads the main thread only, so it misses nested Subagents, and it doesn't apply the rules behind the counts (a Subagent waiting on background work of its own, one revived with `SendMessage`, one stopped with `TaskStop`). Its list and the count would disagree.
- It has nothing for Codex.
- The items come from the same reader as `running` and `finished` (`core/subagents.rs`: Claude Code's sidecars, Codex's child rollouts), so the list is always the count's Subagents.

## S1. The field

```json
"subagents": {
  "running": 2,
  "finished": 1,
  "items": [
    {
      "id": "a0425fcef2aef6acc",
      "parent": null,
      "depth": 1,
      "state": "running",
      "task": "Review the diff",
      "type": "general-purpose",
      "name": null,
      "role": null,
      "model": "claude-opus-5-5",
      "started_at": "2026-11-02T10:58:26.120Z",
      "ended_at": null,
      "activity": "Bash: run the tests"
    }
  ]
}
```

- `items`: the Subagents `running` and `finished` count, at most 20. With more, the running ones are kept first, oldest start first, then the finished ones, most recently ended first; the rest are left out, and Lookout says how many from the counts. Missing when Fleet can't list them (an older Fleet): the counts stand alone.
- `id`: Claude Code's agent id, Codex's child thread id.
- `parent`: the `id` of the Subagent that started it (Claude Code's `parentAgentId`; Codex's `parent_thread_id` when it's another child), or null for one the Session itself started.
- `depth`: 1 for one the Session started, 2 for one a Subagent started, and so on (Claude Code's `spawnDepth`, Codex's `depth`); null when the meta or rollout doesn't say.
- `state`: `running`, or how it ended: `completed`, `failed` or `stopped`.
- `task`: what it was asked, short. Claude Code: the meta's `description`. Codex: the last part of `agent_path` (`/root/fill_review` → `fill_review`). Null when there's none.
- `type`: Claude Code's `agentType` (`general-purpose`, `Explore`, …); null for Codex.
- `name`, `role`: Codex's `agent_nickname` (`Bohr`) and `agent_role`; null for Claude Code.
- `model`: Claude Code's meta `model`, as Claude Code wrote it (an alias such as `haiku` when the Agent call asked for one); Codex's last `turn_context` or `thread_settings_applied` model in the child's rollout. Null when unknown.
- `started_at`, `ended_at`: RFC 3339 UTC. Claude Code: the first `timestamp` in its log, and the end the count already uses. A fork's log starts with a `fork-context-ref` entry that has no timestamp (2 of 400 recent logs; every other one starts with a timed `user` entry), so the shared reader takes the entry after that one, within the first 1 MiB, for the `finished` count too, so a forked Subagent counts and lists alike. No other line is searched for a start. Codex: the child turn the count uses, its latest: that turn's `task_started`, and its `task_complete` or `turn_aborted`. A child's rollout can start with a copy of its parent's history (an aborted parent turn included), and a reused child runs more than one turn, so its first `task_started` is never taken. `ended_at` is null while running; either is null when unknown.
- `activity`: its last tool call, short, from the end of its log (at most 64 KiB). Claude Code: the last `tool_use` in an assistant `message.content`, worded as `core::background` words it (`Bash: run the tests`). Codex: the last `response_item` whose payload is a `function_call` (its name and its JSON `arguments`, worded the same way: `spawn_agent: check_rates`) or a `custom_tool_call`. Codex 0.166 runs commands through the `exec` custom tool, whose input is JavaScript calling `tools.exec_command({cmd: "…"})`; its first `tools.<name>` call and that call's `cmd` or `command` say what it does (`exec_command: pnpm test`), else the tool's name. At most 100 characters. Null before its first tool call, or when it can't be read.

## S2. How it ended

- **Claude Code:** first, a meta with `stoppedByUser: true` is `stopped`, whatever else it says (real metas carry it beside `finished: true`, and the counts reader already takes it as an end). Otherwise the latest task notification's `<status>` for that id: `completed` is `completed`, `failed` is `failed`, `killed` and `stopped` are `stopped`. A successful `TaskStop` is `stopped`. A meta with `finished: true` and none of these is `completed`.
- **Codex:** the latest child turn (S1): ended with `task_complete` is `completed`, with `turn_aborted` is `stopped`.

## S3. Cost

- Lookout runs a fresh `fleet list` every poll, so nothing is cached between polls. Fleet already reads every sidecar meta (Claude Code) or child rollout (Codex) to count. The items add, per poll:
  - for each running Claude Code Subagent, its log's first entry for `started_at` (one line, at most 1 MiB, as the `finished` count already reads for one that ended), needed to pick the oldest before the cap;
  - for each listed Codex child, its rollout's first line (`session_meta`, at most 1 MiB); a child whose first line can't be read is still listed, by the id in its file name, its other fields null, so the list holds every child the counts count;
  - for each listed Subagent, the end of its log for `activity` (at most 64 KiB).
- At most 20 items per Session, so a Session with many Subagents costs at most its running ones' head reads and 20 tail reads. Measured once built, as `fleet list` was.

## S4. Tests in the fork

- Claude Code: running, finished, stopped (`TaskStop`; `stoppedByUser` with `finished: true` and no notification), failed (notification) and nested sidecars give the right `state`, `parent` and `depth`; a fork whose log starts with `fork-context-ref` has its `started_at` and counts in `finished` as it's listed; `activity` is the last tool call; a 21st Subagent is left out, the running ones kept first.
- Codex: a running and a finished child (the existing `testdata/subagents/codex/` fixtures gain `agent_nickname`, `agent_path`, a `turn_context`, a `function_call` and a `custom_tool_call`); an aborted one is `stopped`; a child whose rollout starts with a copied, aborted parent turn, and one that ran a second turn, take their start, end and state from their latest turn.
- `items` always agrees with `running` and `finished`: the same Subagents, when there are 20 or fewer.
