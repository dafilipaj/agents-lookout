---
title: Session view
code: VIEW
status: In Progress
created: 2026-10-16
updated: 2026-10-17
---

# Session view

## Summary

The main pane for the Session selected in the sidebar. It shows the conversation as a chat built from the Transcript, a terminal preview, a composer to type into the Session, and buttons to answer what it's waiting on. Together with SIDE, it lets you follow and steer a Session without opening a terminal.

## Problem

Selecting a Session in SIDE shows only a placeholder. To see what an agent did, or to reply, you still have to find its terminal. When it Needs you, the question it's asking is only visible in that terminal.

## Requirements

### VIEW-1 Chat from the Transcript

The selected Session's conversation, read from its Transcript. Works for every Session Fleet lists, Controllable or not.

- [x] VIEW-1.1 Your prompts and the agent's replies show in order, newest at the bottom. Replies are rendered as Markdown, code blocks included. Works for Claude Code and Codex Transcripts. (test)
- [x] VIEW-1.2 Consecutive tool calls fold into one row naming the tools and counts, e.g. "▸ 6 tool calls: Read ×3, Grep ×2, Bash". Expanding it shows one line per call (tool plus a short argument). Tool output is never shown. (test)
- [x] VIEW-1.3 Thinking, hook output, bookkeeping entries, and subagent (sidechain) messages aren't shown. A Subagent's result (Claude Code's task notification, e.g. `Agent "Build" finished`) shows as a compact one-line row, smaller than messages and set apart from them. (test)
- [x] VIEW-1.4 A message the Harness writes appears within 2 s, without reloading. (manual)
- [x] VIEW-1.5 While you're at the bottom, the chat follows new messages. Once you scroll up it stays put and shows a "Jump to latest" button. (manual)
- [x] VIEW-1.6 Long Transcripts open fast: the latest messages load first, and "Show earlier" loads older ones. (test)
- [ ] VIEW-1.7 The Transcript is found even after the agent moved into another directory or Worktree. (test)
- [x] VIEW-1.8 If no Transcript can be found, the pane says so; the terminal preview and composer still work. (test)
- [x] VIEW-1.9 A question the agent asked you (Claude Code's AskUserQuestion) shows in the chat with its options, and afterwards with the answer you gave. (test)
- [x] VIEW-1.10 While the Session works on an answer, a "Working…" row with the time since your prompt (e.g. "Working… 12s") sits at the bottom of the chat. It appears the moment you send from the composer. While the Session Needs you, it reads "Needs you" instead, with what it waits for when Status has it. It disappears once the reply is final and the Session is Idle, and never shows for an ended Session. (test)
- [x] VIEW-1.11 A narrow rail beside the chat's scroll bar has a Mark for each prompt you sent (a dot), Subagent result (a diamond) and question (a triangle), each at its entry's place in the chat's full height. Clicking a Mark scrolls to its entry, smoothly unless you prefer reduced motion; hovering or focusing it shows the entry's first line and time. `[` and `]` jump to the previous and next Mark when focus isn't in a text field. A jump counts as scrolling up (VIEW-1.5). Marks cover the loaded entries; while "Show earlier" is available, a Mark at the top loads the earlier page. The rail is hidden when there are no Marks, and when the chat is too narrow for it. (test)

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

- [x] VIEW-5.1 A header shows the title, Harness and Status, updating live, and the Session's actions. Where it works, its model and its context usage are in the status line (VIEW-5.5). (test)
- [x] VIEW-5.2 For a Session that isn't Controllable, the chat is read-only, with a note saying why there's no composer, preview or buttons. (test)
- [x] VIEW-5.3 When the selected Session ends (SIDE-4.3), its chat stays readable, and the composer, preview and buttons are replaced by "This Session ended". (test)
- [x] VIEW-5.4 With nothing selected, the existing "Select a Session" hint stays. (test)
- [x] VIEW-5.5 A status line directly below the composer, like a terminal's, shows the repo, Worktree or branch, model and context usage, all updating live. Without a composer (a Session that isn't Controllable, or has ended) it sits at the bottom of the pane. It stays one line at any width: parts that don't fit are truncated, and its tooltip shows the whole line. (test)
- [x] VIEW-5.6 An "End Session" action in the header ends a Controllable Session whose Session host is its own, after an in-app confirmation dialog (never `window.confirm`). Sessions that share their Session host, run in iTerm2 or run in another app don't get it. (test)
- [x] VIEW-5.7 Once ended, the Session shows as ended (VIEW-5.3) with its chat still readable, and History can resume it (HIST-3.1). (test)
- [x] VIEW-5.8 When it can't be ended, the dialog stays open and says why: "Fleet is typing into it; try again" while Fleet holds the Session; for a shared Session host, or a terminal Fleet can't close, why and to close it in the terminal instead. (test)

## Non-goals

- A live, interactive terminal in the app (xterm.js); see [0001](../../decisions/0001-tmux-as-hidden-session-host.md).
- ANSI colours in the terminal preview.
- Tool output, images and attachments from the Transcript (an image shows as a placeholder).
- Subagent Transcripts.
- Buttons for prompts other than questions and permission prompts: the trust prompt, plan approval, login, update prompts, rate-limit dialogs. The terminal preview shows them; answer them in the terminal.
- Slash-command autocomplete, file mentions, attachments and voice in the composer.
- Editing, rewinding or forking a conversation.
- Searching inside the chat, and past Sessions (HIST).
- Renaming Sessions.
- Ending a Session that shares its Session host with other windows or panes, runs in iTerm2, or runs in another app (VIEW-5.8 says to close it in the terminal).
- Stopping a Session's Local servers when it ends.
- Opening the Session in iTerm2 (ITERM; the header leaves room for its button).
- Several Sessions side by side.

## UX

```
┌───────────────┬──────────────────────────────────────────────────────┐
│ sidebar       │ fix-deal-rates · Claude        ◆ Needs you · 2m      │
│ (SIDE)        │ Waiting for: question  [End Session] [iTerm2] [Stop] │
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
│               ├──────────────────────────────────────────────────────┤
│               │ work · [wt] crm-rates · opus-5.5 · 41% context       │
└───────────────┴──────────────────────────────────────────────────────┘
```

- Status line (VIEW-5.5): one line in the monospace font, the parts separated by `·`. At narrow widths each part truncates with `…`; hovering shows the whole line, and the Worktree or branch on its own.
- End Session (VIEW-5.6): the dialog names the Session, says its Harness is asked to exit and its Session host closed, and that its chat stays readable and History can resume it. Buttons: Cancel and End Session (destructive). While Fleet works, End Session reads "Ending…".

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
      - **Contract** (agreed with the fork; as built in `dafilipaj/fleet` branch `lookout`, `docs/cli.md` "Messages"): `fleet --local messages --json [--after=<c> | --before=<c>] [--limit <n>] -- <target>`. Success is one JSON object: `ok`, `session_id`, `harness`, `transcript` (null before the first prompt), `entries`, `updated`, `has_more_before`, `has_more_after`, `cursor`. The top-level `cursor` is the one to poll with: the newest position plus a read hint, so it can move without new entries; it's null only for an empty conversation with no `--after`. Each entry has an opaque `cursor` (printable ASCII, at most 512 characters, no leading `-`), `role`, `kind` (`user`, `assistant`, `command`, `system`, `question`, `tool_call`), `ts` and `text` (Markdown for `assistant`); `assistant` adds `final`, `command` adds `name` and `args` (`command` and `system` have role `user`; `system` entries are Claude Code's task notifications, `text` their summary, and the only ones Fleet emits), `tool_call` adds `id`, `tool` and a `summary` of at most 120 characters (never output), and `question` adds `id`, `questions` (`question`, `header`, `multiSelect`, `options` of `label` and `description`), `status` (`pending`, `answered`, `declined`, `abandoned`: never answered and the conversation moved on) and `answer`: null while pending, `{declined: true}`, or `{answers, picked}` with one element per question (the recorded text, and the indexes of the options it picked; empty for a typed answer). `--after` answers also carry `updated`: older entries that changed since (a question answered, a reply that grew), to replace by cursor. Prompts typed while the agent is busy come last in every no-cursor and `--after` answer as the full current queue, `queued: true` with `q…` cursors that aren't positions. A Session with no Transcript yet is an empty conversation, not an error. Fleet never emits thinking, hook output, bookkeeping, sidechains or tool results. A failure exits 1 with `{ok: false, kind, error}` on stdout; kinds are `target_not_found`, `target_ambiguous`, `target_invalid`, `transcript_not_found` (a Claude Session without a session id), `harness_unsupported`, `cursor_invalid` (the Transcript was rewritten), `usage` and `io`.
      - **In Lookout:** every entry is type-checked and bounded (text 200,000 characters, a summary one line of 200, at most 10 questions of 20 options, every option kept in place so `picked` indexes hold, invalid indexes dropped); `system` entries are kept with their text bounded like any other, and unknown kinds are dropped (VIEW-1.3), and repeated cursors within one answer are kept once. Queued prompts are kept apart from the history: never buffered, trimmed, paged or used as a cursor. Cursors go to Fleet as `--after=<c>`, so one starting with `-` stays a value. Fleet's error text reaches the browser as one line of at most 200 characters, with token-like runs, credentials in URLs and `Authorization` values redacted, and tmux reworded (0001). An answer, poll or page, naming another Session or Harness than the one asked for is refused. A pid target gets the same fresh-list check as send and peek, reused for 5 s.
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

- **Ending a Session (VIEW-5.6–5.8).** Through the Fleet fork's `close` (contract agreed with the fork, being built there; Lookout consumes it through the fake `fleet` in `server/fixtures/fleet/messages/`, extended with `close`):
  - **Command:** `fleet --local close <target> --json --expect-pid <n> --expect-start <proc_start>`, where the target is exact: `id:<session_id>`, or `pid:<n>` for a Session without one (a Codex Session before its first prompt). Fleet never matches a close by fragment; a bare or fuzzy target is `usage`.
  - **Process identity (contract amended 2026-10-17):** every `fleet list --json` row carries `proc_start`, the agent process's start time as RFC 3339 UTC, or null when Fleet can't read it. Lookout keeps it as the row's `procStart` only when it's at most 40 characters of `YYYY-MM-DDTHH:MM:SS[.fraction]Z` naming a real calendar time, verbatim (it goes back to Fleet as is); anything else is null. With `--expect-pid` and `--expect-start` (both or neither, else `usage`), Fleet checks the resolved Session's live process has that pid and start time before any input and again right before the kill; a mismatch is the kind `target_changed`, and nothing is typed or killed. A pid alone can't tell a Session resumed under a new process, or a reused pid, from the one the user confirmed; pid plus start time can.
  - **What Fleet does:** only a Session alone in its own tmux session (one window, one pane) is closed. Under the same per-Session lock as `send`, it presses Escape if the Session is busy or waiting, types the Harness's own exit command (`/exit`, `/quit`), waits up to 5 s, then kills that tmux session by its exact name. Success is `{ok: true, session_id, pid, harness, how: "exit" | "killed", tmux_session, dry_run}`; failure exits 1 with `{ok: false, kind, error}`, kinds `usage`, `target_not_found`, `target_ambiguous`, `target_invalid`, `target_changed`, `host_shared`, `backend_unsupported`, `busy` and `io`.
  - **Who gets the button (decided 2026-10-17):** `fleet list --json` can't tell a tmux session that hosts only this Session from one that also holds other windows or panes: a row has `tmux_session`, `handle` (the pane id) and `tab` (the window name), but no window or pane count. What the list can tell is when two listed Sessions (pi included) share one `tmux_session`. So a row is `ownHost` when its backend is `tmux`, it has a `tmux_session`, and no other listed Session is in it; the button shows for those that are Controllable. A tmux session that also holds a plain shell window, like the user's `work`, still gets the button: Fleet's `host_shared` is the backstop, shown as VIEW-5.8's message. iTerm2 Sessions never get it (Fleet would answer `backend_unsupported`).
  - **Request:** `POST /api/sessions/<id>/end` with the JSON body `{pid, procStart}` (at most 1 KB): the process the user confirmed, captured from the row when the dialog opened, not when End Session is pressed. It's a mutation, so the guard wants our `Origin` and the token, as LAUNCH's start and HIST's resume. The server never takes a target from the browser: it looks the id up in its last list, reads a fresh `fleet list` (the Session must still be there, Controllable and `ownHost`), and builds the target from that row. A pid id (`codex:<pid>`) whose Session has got its session id since (so the last list no longer has it) is matched in the fresh list by pid and Harness, and closed by `id:<session_id>`; the start-time check below keeps it the same process. That row's pid and `procStart` must equal the body's, or it's refused as `target_changed` before Fleet is asked; both go to Fleet as `--expect-pid` and `--expect-start`, so a replacement landing after that check is refused by Fleet atomically. A null `procStart`, from the body or the fresh row, is refused: Lookout can't confirm it's the same Session. A session id must match `^[A-Za-z0-9][A-Za-z0-9-]{0,127}$`, a pid be a positive integer and `procStart` pass the same check as the list's, all before argv is built. Fleet gets the same cleaned environment as LAUNCH, and 20 s.
  - **The dialog:** it stays mounted while open or ending even when the button stops applying (another Session joins its Session host, it moves to iTerm2), so the refusal that follows is shown. It's mounted per view, and the view is keyed by the Session across a Codex Session getting its session id (the old pid id through the store's aliases), so that id change doesn't remount it and a pending request's result is still shown. Closing it returns focus to the End Session button through `onCloseAutoFocus` (the button sits outside Radix's trigger); after a successful end, or once the button is gone, to the header's title. While it, or any modal, is open, the page's background shortcuts stand down: Session list navigation, ⌘1–9, ⌘J, N, ⌘N and H. Each open `DialogContent` counts itself in `web/src/lib/modal.ts`, and App reads that.
  - **Afterwards:** the server polls `fleet list` at once (waiting out a poll already in flight, which may predate the close, and then polling again), so the Session's removal reaches the tabs without waiting for the next 2 s poll; the view then shows it ended (VIEW-5.3), its chat stays as it was, and History marks it resumable since it's no longer live.
  - **Failures (VIEW-5.8):** `busy` → "Fleet is typing into it; try again."; `host_shared` → "This Session shares its Session host with other windows, so Lookout won't end it. Close it in the terminal."; `backend_unsupported` → "Lookout can only end a Session that runs in a Session host of its own. Close this one in its terminal."; `target_not_found` → no longer running; `target_changed` → "This Session was restarted since you asked; nothing was closed."; no start time → "Lookout can't confirm it's the same Session, so it won't end it. Close it in the terminal." (in the dialog at once, with End Session disabled, and from the server as a backstop). A Fleet without `close` (clap's "unrecognized subcommand") says to update the fork. Anything else is Fleet's error on one line, redacted, with anything naming tmux reworded (0001).
- **Activity row (VIEW-1.10).** Built in the tab from data it already has: the Session's Status from `fleet list` (every 2 s) and the chat feed. No Fleet change, no new polling. Its own component (`ChatActivity`) sits in a slot under the chat's last row; the chat follows it like a new message while you're at the bottom. The rules, in order:
  - **Never** for an ended Session. A view-only Session that's still running gets it like any other.
  - **Needs you**: Status is `needs-you`; the text adds Fleet's `waiting_for` when there is one.
  - **Working** when any of these holds:
    - Status is `busy`.
    - **Optimistic:** less than 5 s since a composer send, Status hasn't changed since the send, and no `final` reply in the feed is newer than the send (Status can miss a quick turn; the feed then shows it answered). The send's time is kept per Session in the tab, so it survives switching away and back and follows a Codex Session whose id changes, whichever Session is selected (the old id's entry goes). Once the list is known and a Session is missing from it, it really ended and its send time goes, unless a send to it is still in flight; while the list isn't known, nothing goes. A failed send puts back the time it replaced, unless a newer send has replaced it since.
    - Status is `unknown` and the feed is mid-turn: the last history entry is your prompt (`user`), a `tool_call` or an `assistant` entry that isn't `final`.
    - **Settling:** Status turned `idle` less than 5 s ago and the feed is still mid-turn, so the row doesn't vanish before the final reply reaches the chat (the feed polls every 1 s, the list every 2 s).
  - **Timer:** from the latest `user` entry's `ts` that no `final` reply follows, or the composer send when that is newer. A send made while a turn runs (Status `busy`, an earlier send not yet caught up or answered, or Status `unknown` with the feed mid-turn) is queued behind it: decided when you send, it never sets the send's time, so it doesn't restart the clock. With neither, from when Status turned `busy` (a turn with no prompt of yours, such as a background task); otherwise no time is shown. "12s", then "3m 07s", then "1h 02m".
  - **Ticking:** the row keeps its own one-second clock, so only it re-renders.
  - **Accessibility:** the text sits in a `role="status"` polite live region that holds only the state ("Working…", "Needs you · …"), never the seconds, and stays mounted while empty so its first change is announced. The pulse uses `animate-busy`, which animates only under `prefers-reduced-motion: no-preference`.

- **Chat rail (VIEW-1.11).** Built in the tab from the loaded entries; no Fleet change. Its own component (`ChatRail`) sits beside the chat's scroll area, the Marks' logic in `web/src/lib/marks.ts`. The rail holds its own measurements (`web/src/lib/rail.ts`) and is memoized with stable props, so measuring doesn't re-render the chat and the chat's re-renders (the header's clock ticks every second) don't reach the rail.
  - **Marks:** `user` entries that aren't queued, `system` entries and `question` entries. Each row with a Mark carries `data-mark=<cursor>`.
  - **Placement:** each Mark's top is its row's offset in the chat's content over the chat's `scrollHeight`. The offsets are read in one batch when the rendered entries, queue, "Show earlier" cursor or problem change, or a ResizeObserver on the chat's scroll area, its content box (rows below the list, such as the Working row, change the full height) and its message list fires (the list itself, which moves its rows when one expands even in a chat shorter than its pane; it's re-observed when it appears), at most once per 100 ms. A poll that changes nothing leaves the chat state as it was, so it reads no layout.
  - **Jumps:** the entry lands 12 px below the chat's top edge. A jump holds the chat as scrolled up, even when it lands near the bottom, until you scroll yourself or press "Jump to latest". Scrolling yourself is the wheel, touch, a press on the scroll bar itself, or a key that scrolls (arrows, Page Up/Down, Home/End, Space) with focus in the chat or on the page itself (after clicking the chat's text focus stays on `<body>`, yet the key scrolls the chat); Space on a button presses it, like Enter, and doesn't release it, nor do clicking or selecting text in the chat, and `[`/`]` themselves. `[`/`]` step from the Mark last jumped to while the hold lasts, otherwise from the chat's scroll position; `[` past the first Mark loads the earlier page when there is one. They're ignored in a text field or a dialog, and Option or AltGr doesn't stop them (some layouts need it to type `[`; Windows reports AltGr as Ctrl+Alt, so only Ctrl without Alt, or ⌘, does). A jump from the rail moves focus to the entry (`tabindex="-1"`, without scrolling, with a focus ring when it came from the keyboard); `[`/`]` leave focus where it is. The sidebar's ↑/↓ (SIDE-5.1) skip keys from inside the chat (`data-scroll-keys`), so they scroll it rather than switch Sessions; j/k still switch.
  - **Accessibility:** a `Bookmarks` navigation landmark; each Mark is a button named after its kind, time and first line. The Marks are a vertical `toolbar`: one tab stop, which follows the last jump (by click or `[`/`]`), with the arrow keys moving between them. The hover or focus text is a `tooltip` hidden from assistive tech, since it repeats the Mark's name; hover and focus are tracked apart, so it stays after a click while the pointer is on the Mark. The Marks' hover scale animates only without reduced motion.
  - **Narrow chats:** a container query on the chat hides the rail below 28rem; the keys still work.
  - **Colours:** prompts `muted-foreground`, Subagent results `busy`, questions `needs-you`, each with its dark-mode value.
- **Subagent results (VIEW-1.3).** A `system` row doesn't count when VIEW-1.10 asks whether the feed is mid-turn (the entry before it decides), and the agent's reply after it is headed like one after a prompt.

### Key decisions

- **Transcript parsing lives in Fleet, not tb-session or Lookout**: Fleet already resolves the target and the Codex Transcript path, and has the parser in JS; Lookout stays a plain consumer. HIST's search stays in tb-session.
- **Answers go through Fleet commands that check the screen first**: typing into the wrong prompt is worse than not answering. This also works for Sessions on the iTerm2 backend.
- **The chat works for every Session; controls only for Controllable ones**: reading a Transcript doesn't control anything, and today most Sessions run in Orca.
- **Tool calls fold into one row per run**: you see what the agent touched without long tool-heavy turns drowning the text.
- **Enter sends**: it's what you type into the Claude Code and Codex terminals today; LAUNCH keeps ⌘Enter because its prompt sits in a form.
- **End Session shows for own-host Sessions as `fleet list` sees them, with Fleet's `host_shared` as the backstop**: the list can't count windows or panes, and adding that to `list` would be a Fleet change for a check `close` already makes. A refusal that explains itself costs one click; hiding the button from every tmux Session would make it useless.
- **The status line holds what describes the Session, the header what you act on**: the header stays short (title, Harness, Status, actions), and the line under the composer reads like a terminal's status line, where you look while typing.
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
- 2026-10-17: Added VIEW-1.10, a "Working…" / "Needs you" row at the bottom of the chat, built from Status and the chat feed (no Fleet change). Technical approach: its rules, including a 5 s optimistic start after a send and a 5 s wait for the final reply after the Session turns Idle.
- 2026-10-17: VIEW-1.1 and 1.4 checked by Dario against live Sessions with the fork's Fleet (`lookout` 1f824eb).
- 2026-10-17: VIEW-1.10 review fixes: whether a send is queued is decided when you send, and a queued send never restarts the timer; the send's time is kept per Session (survives switching, follows a Codex id change); a failed send puts back the earlier send's time.
- 2026-10-17: VIEW-1.10 second review fixes: a send the feed shows answered no longer makes the next send look queued; send times follow a Codex id change even when another Session is selected; send times of ended Sessions and old ids are dropped.
- 2026-10-17: Added VIEW-5.5, a status line under the composer with repo, Worktree or branch, model and context usage (moved out of the header; VIEW-5.1 amended), and VIEW-5.6–5.8, an "End Session" action through the Fleet fork's `fleet close` (built against its contract through the fake `fleet`). Non-goals no longer rule out closing Sessions, only those sharing their Session host. Technical approach: the close contract, who gets the button and why, the request guard and the failure messages.
- 2026-10-17: End Session review fixes. Major: a close is bound to the process the user confirmed. The dialog captures the row's pid and `proc_start`, the request carries them, the server checks them against a fresh list and passes `--expect-pid`/`--expect-start` to Fleet (contract amended: `proc_start` on list rows, `target_changed`); a Session without a start time is refused. Minors: background shortcuts stand down while any modal is open; closing the dialog returns focus to End Session; an open or pending dialog stays when the button stops applying. Technical approach: process identity, the request body, the dialog's behaviour and the two new messages.
- 2026-10-17: End Session second review fixes: the poll after a close never reuses one started before it; a Codex Session that gets its session id keeps an open or pending dialog, and the server finds it by pid and Harness; focus falls back to the header's title; tests for ⌘N, ⌘1–9 and ⌘J while the dialog is open. Technical approach updated.
- 2026-10-17: VIEW-1.3 amended: Subagent results (Claude Code's task notifications, Fleet's `system` entries) show as compact one-line rows; Lookout keeps `system` entries instead of dropping them. Added VIEW-1.11, a rail of Marks beside the chat's scroll bar for prompts, Subagent results and questions, with `[`/`]` to jump between them. Fixtures' `system` entries are now task notifications.
- 2026-10-17: VIEW-1.11 review fixes: only keys that scroll and presses on the scroll bar release a jump's hold, so `[`/`]` keep stepping with focus in the chat; Option/AltGr no longer blocks `[`/`]`; the Marks are re-measured when the message list resizes; the rail owns its measurements and is memoized. A jump from the rail moves focus to the entry, the rail's tab stop follows `[`/`]`, the Marks are a vertical toolbar, and the tooltip no longer repeats the name to assistive tech.
- 2026-10-17: VIEW-1.11 review fixes, round 2: ↑/↓ from inside the chat scroll it instead of switching Sessions; a scroll key from the page releases the hold, Space on a button doesn't; the rail re-measures when the Working row changes the chat's height; the entry keeps a focus ring; the tooltip survives a click; Windows AltGr types `[`/`]`.
