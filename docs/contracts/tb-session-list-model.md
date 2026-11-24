# Contract: a Session's model and effort in `tb-session list` and `show`

What Lookout needs from tb-session so that a Review round names its reviewers' model and effort (EVID-6.5). History shows no model today because tb-session gives none (HIST, Key decisions), so it can use the same fields later. It shipped in tb-session 0.6.0 with the agent kind (cli-toolbox `18924a3` on `main`; [`tb-session-events-agent.md`](tb-session-events-agent.md), A9). From an older tb-session, Lookout shows the Harness alone.

## M1. Fields

Every `list --json` row and the `show --json` answer gain two fields, always present:

```
model,   // the model the Session last ran on, as its Transcript names it, or null
effort   // the reasoning effort it last ran with, as its Transcript names it, or null
```

- null means the Transcript records none. It never means a default.
- Both are text as recorded (`"gpt-6.1-sol"`, `"xhigh"`, `"claude-opus-5-5"`); tb-session doesn't map or shorten them.

## M2. Where they come from

| Harness | `model` | `effort` |
|---|---|---|
| Codex | the last `turn_context` record's `payload.model` | that record's `payload.effort` |
| Claude Code | the last assistant record's `message.model`, Claude Code's `<synthetic>` placeholders and records of another Transcript (`isSidechain` unlike the Transcript's own) left out | that record's `effort` (seen 2026-11-21 on a headless run's records, beside `message.model`), else null |
| Pi | null | null |

- "Last" is the last such record in the Transcript, so a Session that switched model mid-way gives the one it ended on.
- A Subagent's records don't count for its parent.

Example, invented:

```json
{ "session_id": "01a1…", "harness": "codex", "headless": true, "project_path": "/Users/me/shop",
  "created_at": "2026-11-21T12:46:30.649Z", "modified_at": "2026-11-21T12:52:51.282Z",
  "model": "gpt-6.1-sol", "effort": "xhigh", "…": "…" }
```

## M3. Upgrade

The index gains the two columns, in 0.6.0's one upgrade (`tb-session-events-agent.md`, A9), which re-reads every Transcript once. A Session whose Transcript is gone keeps null.

## M4. Tests in cli-toolbox

Invented Transcripts:

- Codex: one with one `turn_context`, one with two that switch model, one without `effort`;
- Claude Code: one with two models, and one whose records carry `effort`;
- Pi: one.

`list` and `show` give the same values. The upgrade from a populated 0.5.0 index fills both for every Session whose Transcript exists, and leaves null for one whose Transcript is gone (the agent contract's A10 covers the rest of that upgrade).
