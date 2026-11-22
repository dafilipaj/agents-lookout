---
title: "Hand off: a Session's work, or a piece of it, continued in a new Session"
code: "HAND"
status: "Ready"
created: "2026-11-22"
updated: "2026-11-22"
---

# Hand off

## Summary

"Hand off" on a live Session asks it to write a Handover: what a new Session needs to carry on its work, or the piece of it you name. The launcher then opens with the Handover as the new Session's first prompt, in the same folder, Harness, model and Effort, ready to edit and start. Both Sessions keep running, linked: the new one says what it continues, and the old one what continued it.

## Problem

Two moments call for a fresh Session that knows what this one worked out:

- **Its context is full.** The Session compacts again and again, or has gone vague, and the same work should go on with an empty context window.
- **The work branches.** A piece of it (a bug found on the way, a follow-up, a second PR) belongs in its own Session, while this one carries on.

Today that's done by hand: ask the Session for a summary, copy it, open the launcher, pick the same folder, Harness and model again, paste it and add what it missed. Or, in a terminal, the tb-fleet skill's `fleet handoff`, which opens a window outside Lookout. Either way the two Sessions aren't linked: nothing shows that one continues the other, so a week later History has two unrelated Sessions. The Backlog's "Continue a Session's work in a new one" (2026-10-30) waited on a generated brief (Plan item 23); this spec has the Session write it instead, so it waits on nothing.

## Requirements

### HAND-1 Ask for a Handover

- [ ] HAND-1.1 The Session header has "Hand off…" as its first action, an icon button (`Forward`, the actions table's new `hand-off`), for a Controllable Claude Code or Codex Session with a session id that hasn't ended. It's enabled while the Session is Idle; while it's Busy or Needs you, it's disabled, its tooltip saying it waits for the Session to be Idle. (test)
- [ ] HAND-1.2 "Hand off…" opens a popover under the button, "Hand off", with one optional field, "What to hand off". Left empty, the Handover covers all of the Session's work; filled, only that piece of it. "Write Handover" (Enter) sends the request; Esc or Cancel closes the popover and sends nothing. (test)
- [ ] HAND-1.3 The request is a prompt sent to the Session as the composer sends one (VIEW-3.2, with VIEW-3.7's conditions and errors), in Lookout's fixed wording (Technical approach), the piece in it when given. It shows in the chat as any prompt does, with its Mark, and the Handover as the Turn's answer, so the Session's history says what it was asked. (test)
- [ ] HAND-1.4 `F` opens "Hand off…" for the selected Session when focus isn't in a text field, as the button would; it joins the shortcuts list (SIDE-7.4). (test)

### HAND-2 The Session writes it

- [ ] HAND-2.1 While the Session writes, the popover says "Writing the Handover…", with the piece when one was given and that the launcher opens when the Session is Idle again, and Cancel. Cancel stops waiting; it doesn't stop the Session, whose reply stays in its chat. (test)
- [ ] HAND-2.2 Closing the popover while the Session writes (Esc, a click elsewhere, another Session selected) doesn't stop the wait: the button shows a spinner in its place, and opening it again shows "Writing the Handover…". Only Cancel stops it. The wait is kept until the page reloads, as a composer's draft is (VIEW-3.5). (test)
- [ ] HAND-2.3 When the Turn's reply is done (the Session is Idle again), the Handover is the text of the reply between its `<handover>` and `</handover>` lines; a reply without them is taken whole. If that Session is selected, the popover closes and the launcher opens (HAND-3). If not, its button shows that the Handover is ready, and the launcher opens when you press it or select that Session again. (test)
- [ ] HAND-2.4 A send that fails, a Session that ends or Needs you before replying, or a reply with no text shows the reason in the popover, as an Alert, with "Try again"; while the popover is closed, the button shows that it failed. (test)

### HAND-3 The new Session

- [ ] HAND-3.1 The launcher (LAUNCH-1) opens pre-filled: the old Session's directory (HAND-3.4), Harness, model and Effort, its Topic when it's in exactly one Open Topic, no name (the Harness titles it from its work), Skip permissions as the launcher last had it for that Harness, and the prompt (HAND-3.2). Nothing starts until you press Start, and everything can be changed first, as with TOPIC-5.1. (test)
- [ ] HAND-3.2 The prompt is the Handover, then `Continued from: <session id> <title>` on its own line, then one line asking the new Session to restate, in its first reply and before it changes anything, what the work is, where it stands and what it will do first, and then to carry on. (test)
- [ ] HAND-3.3 A start from a Handover is recorded once Fleet reports the new Session with its session id (a Codex Session gets one after its first prompt, as TOPIC-5.2's starts do): the old Session's id, the new one's, and when. A start that fails, or that you close the launcher on, records nothing. (test)
- [ ] HAND-3.4 The launcher's Directory lists the old Session's directory first, selected, as "<path> · from <old title>", with the Start directories under it. The server starts a Session there only as a start from that Handover, and only when it's the old Session's own directory as Fleet or History reports it again at that moment; any other directory outside the Start directories is refused as LAUNCH-2.1 says. (test)

### HAND-4 Linked both ways

- [ ] HAND-4.1 The new Session's header shows, after its Harness, "from <old title>" with a `Reply` icon, named "Continued from <old title>" for a screen reader, which opens the old Session: live, or past through History. (test)
- [ ] HAND-4.2 The old Session's header shows, after its Harness, "Continued in <new title>" with a `Forward` icon, which opens it; with more than one, "Continued in N Sessions", which opens a menu of them, newest first, each with its Status, each opening its Session. (test)
- [ ] HAND-4.3 The links survive a restart of Lookout's server, and a Session started from a Handover before the record existed is still linked by its `Continued from:` line, read from its first prompt. (test)

### HAND-5 The look

- [ ] HAND-5.1 "Hand off…", the popover in each of its states, the launcher with a Handover, and both links look right in light and dark mode at 280 and 720 px, and match canvas A (UX). (manual)

## Non-goals

- **A Handover for a past Session, or without asking the Session.** Lookout's own `claude -p` or Fleet's generated brief (Plan item 23) could write one for an ended Session, but from its messages alone; the Session itself knows what it ruled out and why. A later slice, if needed.
- **Ending the old Session.** Both keep running; you end the old one yourself when you're ready (End Session, VIEW-5).
- **Copying the context.** The new Session starts empty but for the Handover; carrying the old context over is Claude Code's `--fork-session`, and the opposite of what a full context needs.
- **A new Worktree for the new Session.** The launcher's directory can be changed (LAUNCH-2); making a Worktree isn't part of handing off.
- **A report back.** The new Session isn't told to send the old one an update when it finishes, as tb-fleet's handoff does.
- **Fleet's `handoff`.** It opens a new terminal window; Lookout starts the Session through its own launcher, as for any start (decision 0002).
- **Editing Lookout's request.** Its wording is fixed, in this spec; what you add goes in "What to hand off", and the Handover itself can be edited in the launcher.
- **Folding the request and the Handover in the old Session's chat.** They show as any prompt and answer do (VIEW-1); the header's "Continued in" says what came of them.
- **Handing off while the Session works.** A request queued behind a running Turn could be folded into it, and the Handover written mid-work; you hand off once it's Idle.
- **Keeping the wait across a reload.** Like a composer's draft, it lives in the page; after a reload the Handover is still in the old Session's chat.

## UX

Canvas A, Dario's pick of three on 2026-11-22: https://claude.ai/artifact/L7iTaRyktXhSLmGfVukjfZ (B put the button in the status line by the context %, C the form and the links in the chat as cards).

- **The button.** "Hand off…" is the Session header's first icon action, before Add to Topic, with lucide's `Forward` (an arrow curving right). Pressed while its popover is open.
- **The popover.** It drops under the button, 360 px wide, titled "Hand off". At rest: the "What to hand off" field (three lines, its placeholder "All of the work. Or name a piece of it: a bug found on the way, a follow-up, a second PR"), a line saying the Session writes a Handover and the launcher opens with it, then Cancel and "Write Handover" (Primary, its `Enter` hint). Writing: a spinner in Busy's blue, "Writing the Handover…", the piece and that the launcher opens when the Session is Idle again, and Cancel. Failed: the reason as an Alert, Cancel and "Try again".
- **The button while it waits** (HAND-2.2 to 2.4, not on the canvas): with the popover closed, its icon gives way to a spinner in Busy's blue while the Session writes, then to the icon with a dot when the Handover is ready (in `ok`) or failed (in `destructive`), its tooltip saying which. A Session's row in the sidebar doesn't change.
- **The links.** In the header after the Harness's name, in `meta` grey, a quiet link: "from <old title>" with lucide's `Reply` in the new Session; "Continued in <new title>" or "Continued in N Sessions ▾" with `Forward` in the old one, the latter opening a menu of the Sessions with their Status markers and tags. The title gives way first; at narrow widths the link shows its icon alone, its words in the tooltip, as the Harness's name does.
- **Keys.** `F` opens "Hand off…" for the selected Session (HAND-1.4; free, `H` being History's); Enter writes; Esc closes the popover, which at rest sends nothing and while writing keeps waiting (HAND-2.2).

## Technical approach

Everything is in Lookout: the send (VIEW-3), the chat (VIEW-1), the launcher's draft (`setWorkDraft`, `openLauncher` in `App.tsx`, as WORK-5.1 and TOPIC-5.1 use) and the start (LAUNCH-4). Nothing new is needed from Fleet or tb-session. Claude Code and Codex alike: Lookout sends to both, reads both chats and Statuses, and a Session row carries both Harnesses' `model` and `effort`.

- **The request.** The client sends the prompt through `POST /api/sessions/<id>/send`, in this wording (the first line's `{…}` is `all of this Session's work` with the field empty, else `this piece of it: <piece>`):

  ```
  Write a Handover for a new Session that will continue {…}. It starts with an empty context, so the Handover is all it will know: err on the side of too much. Write it to that Session, not as a summary of ours:
  - the goal, and what done looks like;
  - where things stand: the directory, the branch or Worktree, what's changed, what's committed or pushed;
  - the files, commands, links, Tasks and PRs it would otherwise have to find again;
  - what's settled and why, and what was tried and ruled out;
  - the scope and its limits: what not to touch, whether to push;
  - the first move.
  Don't change anything now. Reply with the Handover alone, between a line <handover> and a line </handover>.
  ```

  The markers are plain text, kept as written in both Harnesses' Transcripts; the chat shows them as text.
- **The wait.** In the client, per Session, next to the composer's drafts (`App.tsx`), so switching Sessions keeps it and a reload drops it: `{piece, sentAt, state: writing | ready | failed, handover?, reason?}`. It follows the Session's row in the snapshot, which carries every Session's Status: a Busy seen after the send, then Idle, ends the Turn (as SETUP's This Session counts one); an Idle before any Busy waits until the send's prompt shows in the Session's chat. At the Turn's end the client reads the Session's chat (the route VIEW-1 reads, whether or not the Session is selected) and takes the latest reply after the request.
- **The start.** `LaunchRequest` gains an optional `continues: {sessionId}`. With it, `validate` (`server/launcher.ts`) accepts a directory outside the Start directories only when it equals the old Session's `cwd`, from Fleet's list, else from History's `lookup` (HAND-3.4). The server keeps `{launchId → old session id}` in memory until Fleet reports the new Session with its id, as `server/topic-launches.ts` does for a Topic, then records the pair.
- **The record.** `~/.lookout/handoffs.json`: `[{from, to, at}]`, written atomically. The `Continued from: <id>` line is the marker tb-session can see later (it indexes first prompts, WORK-4.3), as TOPIC-5.1's `Topic:` line is, so a lost record can be rebuilt.
- **The links.** The snapshot's Session rows carry `continuedFrom` and `continuedIn` from the record; a past Session's come from the record when History opens it.
- **Tests.** `(test)`: the popover's states and keys against a fake send and a row whose Status changes, including a wait kept while another Session is selected; the reply's markers; the launcher's draft for both Harnesses; `validate`'s directory exception and its refusals (no `continues`, a Session whose `cwd` differs, one Fleet and History don't know); the record against a temporary `HOME`, including the rebuild from a first prompt. The start itself waits on the Fake Harnesses (TEST-1.4), as WORK-5.1 and TOPIC-5.2 do.

### Key decisions

- **The Session writes its own Handover** (Dario, 2026-11-22, over Lookout's `claude -p` or a template): it knows the decisions and dead ends that its messages alone don't show. It costs the old Session one Turn, and only a live Session can do it.
- **Both moments, one action** (Dario, 2026-11-22): a full context and work that branches differ only in "What to hand off", empty or not.
- **The old Session keeps running, linked both ways** (Dario, 2026-11-22, over offering to end it or ending it): you end it when you're sure the Handover missed nothing.
- **Through the launcher, never straight to a start**: the Handover is the Session's own account, so you read it before anything runs, as with TOPIC-5.1.
- **Canvas A: the header holds the button, its popover and both links** (Dario, 2026-11-22, over B's status line and C's chat cards): a Session's actions and what it is already live in its header.
- **The new Session starts in the old one's directory** (grill, over the nearest Start directory or adding it to Settings first): a Worktree or subfolder is rarely a Start directory, and Claude Code's settings, memory and permissions follow the directory a Session starts in. LAUNCH-2.1 gains this one exception, checked on the server.
- **The wait outlives the popover** (grill, over closing cancels or the launcher opening wherever you are): a Turn can take minutes, and you look at other Sessions meanwhile; the launcher never opens over another Session.
- **Both Harnesses** (grill, over Claude Code first): the send, the chat and the Status are the same for both.
- **The checklist wording** (grill, over a short request or deferring to the tb-fleet skill): it steers every Session, and Codex's too, toward the same complete Handover.
- **Idle only** (grill, over queuing while Busy): Claude Code can fold a queued message into the running Turn, and the Handover would describe unfinished work.
- **No name** (grill, over the piece or the old name with a number): the Harness titles it from its work, and the header's link says where it came from.
- **The chat unchanged** (grill, over folding the request with a Mark): no VIEW change in this slice.

## Open questions

None. Settled in the grill on 2026-11-22; `F` and Skip permissions from the code (`F` is free in `shortcuts.ts`; Lookout doesn't know a Session's permission mode).

## Changelog

- 2026-11-22: Created from a conversation with Dario, from the Backlog's "Continue a Session's work in a new one" (2026-10-30). Three questions settled first: the Session writes its own Handover; it covers both a full context and work that branches; the old Session keeps running, linked both ways. Draft until its canvas and grill (Open questions).
- 2026-11-22: Drawn on a canvas of three looks; Dario chose A, everything in the header. HAND-1.1, 1.2, 2.1 to 2.3, 4.1, 4.2 and 5.1 name A's pieces (the `Forward` button first among the actions, its popover, the links after the Harness); UX describes it. A popover that closes while the Session writes joins the Open questions.
- 2026-11-22: Grilled with Dario (eight questions, Key decisions) and Ready. HAND-3.4 added: the launcher found to start only in Start directories, the new Session starts in the old one's directory, checked on the server (LAUNCH-2.1 amended). HAND-2.2 added: the wait outlives the popover; the reply and the failures move to 2.3 and 2.4, and a Handover ready while you're elsewhere waits on the button. HAND-1.1: both Harnesses. HAND-1.4 added: `F`. HAND-3.1: Skip permissions as the launcher last had it. Technical approach: the request's wording, the wait, the directory check. Non-goals gain folding the chat, handing off while Busy and a wait across a reload.
