---
title: Session view
code: VIEW
status: In Progress
created: 2026-10-16
updated: 2026-10-16
---

# Session view

## Summary

The main pane for the Session selected in the sidebar. It shows the conversation as a chat built from the Transcript, a terminal preview, a composer to type into the Session, and buttons to answer what it's waiting on. Together with SIDE, it lets you follow and steer a Session without opening a terminal.

## Problem

Selecting a Session in SIDE shows only a placeholder. To see what an agent did, or to reply, you still have to find its terminal. When it Needs you, the question it's asking is only visible in that terminal.

## Requirements

### VIEW-1 Chat from the Transcript

The selected Session's conversation, read from its Transcript. Works for every Session Fleet lists, Controllable or not.

- [ ] VIEW-1.1 Your prompts and the agent's replies show in order, newest at the bottom. Replies are rendered as Markdown, code blocks included. Works for Claude Code and Codex Transcripts. (test)
- [x] VIEW-1.2 Consecutive tool calls fold into one row naming the tools and counts, e.g. "▸ 6 tool calls: Read ×3, Grep ×2, Bash". Expanding it shows one line per call (tool plus a short argument). Tool output is never shown. (test)
- [x] VIEW-1.3 Thinking, hook output, system and bookkeeping entries, and subagent (sidechain) messages aren't shown. (test)
- [ ] VIEW-1.4 A message the Harness writes appears within 2 s, without reloading. (manual)
- [x] VIEW-1.5 While you're at the bottom, the chat follows new messages. Once you scroll up it stays put and shows a "Jump to latest" button. (manual)
- [x] VIEW-1.6 Long Transcripts open fast: the latest messages load first, and "Show earlier" loads older ones. (test)
- [ ] VIEW-1.7 The Transcript is found even after the agent moved into another directory or Worktree. (test)
- [x] VIEW-1.8 If no Transcript can be found, the pane says so; the terminal preview and composer still work. (test)
- [x] VIEW-1.9 A question the agent asked you (Claude Code's AskUserQuestion) shows in the chat with its options, and afterwards with the answer you gave. (test)

### VIEW-2 Terminal preview

A plain-text view of what the Session's terminal shows right now.

- [x] VIEW-2.1 For a Controllable Session, a drawer under the chat shows the terminal's last 40 lines as plain text, refreshed every second while it's open. (test)
- [x] VIEW-2.2 The drawer is collapsed by default and opens on its own when the Session starts to Need you. Your manual toggle wins until the Status changes again. (manual)
- [x] VIEW-2.3 Not shown for Sessions that aren't Controllable. (test)

### VIEW-3 Composer

- [x] VIEW-3.1 For a Controllable Session, a message box under the drawer. Enter sends; Shift+Enter adds a line. (test)
- [x] VIEW-3.2 The message arrives in the Session intact, line breaks included, and is submitted. (manual)
- [x] VIEW-3.3 You can send while the Session is Busy; the Harness queues it as it would in its terminal. (manual)
- [x] VIEW-3.4 If sending fails, the text stays in the box and the error is shown. (test)
- [x] VIEW-3.5 Each Session keeps its own unsent draft while you switch between Sessions (until the page reloads). (test)
- [x] VIEW-3.6 `i` focuses the composer when focus isn't in a text field; Esc leaves it. (manual)

### VIEW-4 Answer and stop

- [ ] VIEW-4.1 When a Controllable Session Needs you on a question (AskUserQuestion), its options are buttons in the chat, and picking them answers it. Multi-select and "type something" work as in the terminal. (manual)
- [ ] VIEW-4.2 When a Controllable Session Needs you on a permission prompt, its choices are buttons with the terminal's wording, and picking one answers it. (manual)
- [ ] VIEW-4.3 An answer is only sent if the terminal still shows that prompt untouched. Otherwise nothing is typed, and the pane says to answer in the terminal. (test)
- [ ] VIEW-4.4 A Stop button interrupts a Busy Session, as Esc does in its terminal. (manual)

### VIEW-5 Header and states

- [x] VIEW-5.1 A header shows the title, Harness, model, Status, repo, Worktree or branch, and context usage, all updating live. (test)
- [x] VIEW-5.2 For a Session that isn't Controllable, the chat is read-only, with a note saying why there's no composer, preview or buttons. (test)
- [x] VIEW-5.3 When the selected Session ends (SIDE-4.3), its chat stays readable, and the composer, preview and buttons are replaced by "This Session ended". (test)
- [x] VIEW-5.4 With nothing selected, the existing "Select a Session" hint stays. (test)

## Non-goals

- A live, interactive terminal in the app (xterm.js); see [0001](../../decisions/0001-tmux-as-hidden-session-host.md).
- ANSI colours in the terminal preview.
- Tool output, images and attachments from the Transcript (an image shows as a placeholder).
- Subagent Transcripts.
- Buttons for prompts other than questions and permission prompts: the trust prompt, plan approval, login, update prompts, rate-limit dialogs. The terminal preview shows them; answer them in the terminal.
- Slash-command autocomplete, file mentions, attachments and voice in the composer.
- Editing, rewinding or forking a conversation.
- Searching inside the chat, and past Sessions (HIST).
- Renaming or closing Sessions.
- Opening the Session in iTerm2 (ITERM; the header leaves room for its button).
- Several Sessions side by side.

## UX

```
┌───────────────┬──────────────────────────────────────────────────────┐
│ sidebar       │ fix-deal-rates · Claude · opus-5.5 · ◆ Needs you     │
│ (SIDE)        │ work · [wt] crm-rates · 41%           [iTerm2] [Stop]│
│               ├──────────────────────────────────────────────────────┤
│               │ You   Fix the rate rounding in deal totals …         │
│               │ Claude  I'll start by reading …                      │
│               │   ▸ 6 tool calls: Read ×3, Grep ×2, Bash             │
│               │ Claude  The rounding happens in …                    │
│               │   ▸ Bash(bundle exec rspec spec/models/deal…)        │
│               │   [ Yes ] [ Yes, don't ask again for rspec ] [ No ]  │
│               │                                  [Jump to latest ↓]  │
│               ├─ Terminal ─────────────────────────────────── ▾ ─────┤
│               │ Do you want to proceed?                              │
│               │ ❯ 1. Yes                                             │
│               │   2. Yes, and don't ask again for rspec commands …   │
│               ├──────────────────────────────────────────────────────┤
│               │ Message…                                   ↵ Send    │
└───────────────┴──────────────────────────────────────────────────────┘
```

- Loading: a skeleton for the chat; the header shows at once from SIDE's data.
- Errors: Transcript missing (VIEW-1.8), send failed (VIEW-3.4), answer refused (VIEW-4.3), and preview failed (the drawer says so and keeps retrying).

## Technical approach

- **Building blocks.** Fleet's CLI with `--json` ([0004](../../decisions/0004-fleet-cli-as-session-layer.md)), from the fork `dafilipaj/fleet` ([0006](../../decisions/0006-run-a-fork-of-fleet.md)). *Target* is the `session_id` prefix or the pid.
  - **Available now** (checked in Fleet 38a461c's source):
    - `fleet --local send -- <target> <text>` types the text and submits it (VIEW-3). Text with line breaks goes in as a tmux paste, so they survive; a single line is typed. The `--` keeps text that starts with `-` from being read as an option. Lookout's target is the full `session_id`, or the pid for a Codex Session without one.
    - **Targets aren't exact-only in Fleet.** `resolve_in` tries an exact match first, but a target nothing matches exactly falls through to prefix, substring and characters-in-order matching on titles. So the pid of a Session that just exited could match another Session's title, and the text would be typed there. Interim guard in Lookout: right before a send or peek with a pid target, the server runs a fresh `fleet list --json` and goes ahead only if that pid is still listed with the same Harness; otherwise it refuses ("no longer running"). A `session_id` target goes ahead only when the latest list has it. The real fix, an exact-only target, is filed for the fork; it also applies to `answer` and `keys` (VIEW-4).
    - `fleet --local peek --lines 40 -- <target>` prints the terminal's last lines (VIEW-2). The text is shown as is, never parsed, so it doesn't conflict with 0004. Known gaps, both for a raw peek mode in the fork:
      - Peek's first line is Fleet's own header, `▼ <title> (tmux, <status>) — <dir>`, so the preview names tmux, which 0001 keeps out of the UI. Lookout doesn't strip it, since that would be parsing.
      - Peek cuts each line to the terminal width minus 2. A detached tmux Session is 80 columns wide, which Claude Code and Codex fill anyway, but an iTerm2-backed Session loses most of each long line. VIEW-2.1 is verified for tmux Sessions.
    - Before sending, the server checks that Fleet's latest list has the Session and that it's Controllable, and caps a message at 100,000 characters (413 as a field error). In a one-line message a tab becomes four spaces, since one line is typed and a tab would be a keypress; multi-line text is pasted, so its tabs arrive intact (Makefiles, Go, TSV). Other control characters are refused, since typed they'd be keypresses (Esc, Ctrl-C). Fleet errors that mention tmux are reworded ("the Session host refused the message"), per 0001. It passes Fleet the same cleaned environment as LAUNCH.
  - **Added in the fork** (gaps today; VIEW-1 and VIEW-4 wait for them):
    - **`fleet messages <target> --json`** (VIEW-1). A Rust port of Fleet's own `web/lib/transcript.mjs` and `questions.mjs`, so it reads Claude Code and Codex Transcripts and finds them after a move to another Worktree. Additions:
      - **Tool calls:** entries with the tool name and a short argument.
      - **Questions:** entries with structured options and, once answered, the answer.
      - **Cursors:** `--after <cursor>` returns only newer entries. `--before <cursor> --limit <n>` pages back for "Show earlier".
      - **Contract** (agreed with the fork; as built in `dafilipaj/fleet` branch `lookout`, `docs/cli.md` "Messages"): `fleet --local messages --json [--after=<c> | --before=<c>] [--limit <n>] -- <target>`. Success is one JSON object: `ok`, `session_id`, `harness`, `transcript` (null before the first prompt), `entries`, `updated`, `has_more_before`, `has_more_after`, `cursor`. The top-level `cursor` is the one to poll with: the newest position plus a read hint, so it can move without new entries; it's null only for an empty conversation with no `--after`. Each entry has an opaque `cursor` (printable ASCII, at most 512 characters, no leading `-`), `role`, `kind` (`user`, `assistant`, `command`, `system`, `question`, `tool_call`), `ts` and `text` (Markdown for `assistant`); `assistant` adds `final`, `command` adds `name` and `args` (`command` and `system` have role `user`), `tool_call` adds `id`, `tool` and a `summary` of at most 120 characters (never output), and `question` adds `id`, `questions` (`question`, `header`, `multiSelect`, `options` of `label` and `description`), `status` (`pending`, `answered`, `declined`, `abandoned`: never answered and the conversation moved on) and `answer`: null while pending, `{declined: true}`, or `{answers, picked}` with one element per question (the recorded text, and the indexes of the options it picked; empty for a typed answer). `--after` answers also carry `updated`: older entries that changed since (a question answered, a reply that grew), to replace by cursor. Prompts typed while the agent is busy come last in every no-cursor and `--after` answer as the full current queue, `queued: true` with `q…` cursors that aren't positions. A Session with no Transcript yet is an empty conversation, not an error. Fleet never emits thinking, hook output, bookkeeping, sidechains or tool results. A failure exits 1 with `{ok: false, kind, error}` on stdout; kinds are `target_not_found`, `target_ambiguous`, `target_invalid`, `transcript_not_found` (a Claude Session without a session id), `harness_unsupported`, `cursor_invalid` (the Transcript was rewritten), `usage` and `io`.
      - **In Lookout:** every entry is type-checked and bounded (text 200,000 characters, a summary one line of 200, at most 10 questions of 20 options, every option kept in place so `picked` indexes hold, invalid indexes dropped); `system` and unknown kinds are dropped (VIEW-1.3), and repeated cursors within one answer are kept once. Queued prompts are kept apart from the history: never buffered, trimmed, paged or used as a cursor. Cursors go to Fleet as `--after=<c>`, so one starting with `-` stays a value. Fleet's error text reaches the browser as one line of at most 200 characters, with token-like runs, credentials in URLs and `Authorization` values redacted, and tmux reworded (0001). An answer, poll or page, naming another Session or Harness than the one asked for is refused. A pid target gets the same fresh-list check as send and peek, reused for 5 s.
    - **`fleet answer <target> …`** (VIEW-4.1–4.3). Ports the web app's AskUserQuestion answering and adds permission prompts. It checks that the screen still shows the prompt untouched before typing anything.
    - **`fleet keys <target> Escape|Enter|Up|Down`** (VIEW-4.4).
- **Live updates.** Each tab's event stream gets an id in its snapshot; the tab says what it views, and whether its drawer is open, with `PUT /api/watch` (Origin and token, like every mutating route). When the stream closes, the server forgets it. The server follows only the Sessions some tab is viewing:
  - `fleet messages --after` every second, pushed over the existing SSE stream (VIEW-1.4). One feed per Session however many tabs view it, and every viewed Session is followed, Controllable or not (reading controls nothing):
    - The first call has no cursor: the latest 100 entries and the queue go to the tabs as a `reset`, with the cursor for "Show earlier". After it, `--after <top-level cursor> --limit 500` runs a second after the previous call ended, so calls never overlap. Each answer goes out as one `append`: new entries, `updated` entries (replaced by cursor, in the server's buffer and in the tab, with no reload) and the queue as it is now (replacing the old one); nothing is sent when none of them changed. `has_more_after` makes the next call start at once.
    - An empty conversation (a new Session) keeps polling without a cursor, but a `reset` goes out only when something changed, not every second.
    - A tab that starts viewing gets the feed's latest entries (it keeps up to 500) and queue at once, without a Fleet call. A feed no tab views is parked for 5 s: no new calls, and the one in flight finishes (Lookout can't cancel a run yet); viewed again, it carries on, so quick switching (A→B→A, holding j/k) never runs two calls for one Session. After 5 s it's dropped, once its call has ended.
    - `cursor_invalid` reloads without a cursor; its `reset` replaces what the tabs have, pages loaded with "Show earlier" included. `transcript_not_found` is a `missing` problem, checked every 5 s (VIEW-1.8: the pane says the Transcript can't be found; a Session that simply hasn't written one yet shows a quiet "No messages yet"). Other failures keep the entries, show the reason and retry after 1 s, 2 s, then every 5 s.
    - Once Fleet no longer lists the Session, Fleet isn't asked again and nothing is cleared, so an ended Session's chat stays readable (VIEW-5.3); "Show earlier" is hidden then.
  - "Show earlier" (VIEW-1.6) is `GET /api/sessions/<id>/messages?before=<cursor>`, one `--before --limit 100` call. It's a read, so it needs no token; the guard still checks Host, Origin and Sec-Fetch-Site. The cursor must be a position cursor as the contract has them (printable ASCII, at most 512 characters, no leading `-`, never a `q…` one). The page goes above the history only if no reset or trim happened while it loaded.
  - In the tab: the chat in view plus the 3 most recently viewed are kept; those 3 are cut to their latest 100 entries (what the server's `reset` brings back anyway), so switching back is instant and never renders a long stale chat. A chat keeps at most 2,000 entries, trimming the oldest end only while you're at the bottom, so scrolling up and "Show earlier" pages are never pulled away.
  - `peek` every second only while a tab has the drawer open: one peek per Session however many tabs show it, the next one a second after the last ended, and pushed only to the tabs previewing it, only when the text changed.

### Key decisions

- **Transcript parsing lives in Fleet, not tb-session or Lookout**: Fleet already resolves the target and the Codex Transcript path, and has the parser in JS; Lookout stays a plain consumer. HIST's search stays in tb-session.
- **Answers go through Fleet commands that check the screen first**: typing into the wrong prompt is worse than not answering. This also works for Sessions on the iTerm2 backend.
- **The chat works for every Session; controls only for Controllable ones**: reading a Transcript doesn't control anything, and today most Sessions run in Orca.
- **Tool calls fold into one row per run**: you see what the agent touched without long tool-heavy turns drowning the text.
- **Enter sends**: it's what you type into the Claude Code and Codex terminals today; LAUNCH keeps ⌘Enter because its prompt sits in a form.
- **The terminal preview opens on its own on Needs you**: a permission prompt's choices, and screens such as the trust prompt, exist only on the terminal screen, not in the Transcript.

## Open questions

None.

## Changelog

- 2026-10-16: Created.
- 2026-10-16: Grilled. Transcript parsing goes into the Fleet fork (`fleet messages`). VIEW-4 is in, using `fleet answer` and `fleet keys` with a screen check. Tool calls fold. Enter sends. The drawer opens on its own on Needs you. Read-only chat for Sessions that aren't Controllable. Added VIEW-1.9 (questions in the chat) and VIEW-4.3 (no answer unless the prompt is still on screen). Ready.
- 2026-10-16: In Progress: VIEW-2, VIEW-3 and VIEW-5 built on `fleet send` and `fleet peek`. Technical approach: exact targets, `--` before text, how a tab subscribes, and peek's header naming tmux as a known gap.
- 2026-10-16: Review fixes: a pid target is re-checked against a fresh `fleet list` before each send or peek (an exact-only target is filed for the fork); control characters refused; tmux errors reworded; peek's line clipping noted next to its header gap.
- 2026-10-16: Tabs are kept in multi-line (pasted) messages; only a one-line message turns them into spaces.
- 2026-10-16: VIEW-1 built against the agreed `fleet messages` contract with a fake `fleet` (fixtures in `server/fixtures/fleet/messages/`). Technical approach: the contract, how Lookout validates and bounds it, and how a viewed Session's chat is followed and paged. VIEW-1.1, 1.4 and 1.7 wait for a check against real Transcripts once the fork's `fleet messages` lands.
- 2026-10-16: VIEW-1 review fixes against Fleet's `messages` as built: entries already shown are replaced by cursor (`updated`), so an answered question flips live (VIEW-1.9 re-verified by test); queued prompts are a separate queue below the history; questions mark options by `picked`; quiet polling of empty Transcripts; parked feeds instead of overlapping calls; a small chat cache in the tab; trimming only at the bottom.
