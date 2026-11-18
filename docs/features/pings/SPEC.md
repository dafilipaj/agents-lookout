---
title: "Pings: Slack threads that ask for you, beside your Sessions, each a press from the Session that answers it"
code: "PING"
status: "Draft"
created: "2026-11-18"
updated: "2026-11-18"
---

# Pings

## Summary

See, beside your Sessions, the threads in a few Slack channels that mention you, such as a release bot asking about your pull request. From one, open or resume the Session that wrote that pull request, or start a new one on the thread. A bot now asks in Slack and goes on without an answer, and the work that answers it starts in Lookout.

## Problem

- Since 2026-11-16 a bot runs fantastic-productive's releases and posts in a Slack channel, `#ai-ci-cd`, only when a person must know or act. It mentions a pull request's author in three cases:
  - the pull request blocks a release: it asks, waits 45 minutes, then reverts the pull request;
  - it changed app code from the pull request to get CI green, and the author should check that;
  - it put a test of the author's in quarantine, with a date to fix it by.
- Dario merges into that repo most working days, so he will be asked. Dario 2026-11-18: an "ai bot might ping me if release fails", which is the trigger for a new Session, so "some kind of tracker/listener for that ai channel might be a feature for Lookout".
- Slack tells him about a mention. It doesn't show it beside his Sessions, it doesn't know which Session wrote the pull request, and it can't start one. He works in Lookout and the terminal, where a 45-minute wait can pass unseen.
- In the threads read on 2026-11-18, the mention sat in a thread reply more often than in the channel's top-level message. Reading the channel's own messages misses those.
- `tb-slack`, the Slack tool in cli-toolbox, reads a channel, a thread and a search, one call at a time. It has no command that listens, none that lists the mentions of you, and no memory of what it read.
- Fleet's Slack links wake a Session when someone mentions the app or writes in a thread it posted in. The release bot listens that way. A mention of you wakes nothing.

## Requirements

Slice 1 is PING-1 to PING-5: read, list, and get to a Session. Slice 2 is PING-6: which Pings wait for an answer, and how long they have. Nothing can be built against the real channel until `tb-slack` has a token that works (Open question 1).

### PING-1 Watched channels

Lookout reads Slack only for the channels you list, and only through `tb-slack`.

- [ ] PING-1.1 Settings has a "Watched Slack channels" list, empty at first. While it's empty, Lookout runs no `tb-slack` command and shows nothing of Pings. (test)
- [ ] PING-1.2 Adding a channel takes its name, with or without `#`. Lookout saves it only when `tb-slack channels <name> --json` answers exactly one channel of that name, and keeps that channel's id with its name. Otherwise nothing is saved, and the field says why: no such channel, several of that name, or the read's own reason. (test)
- [ ] PING-1.3 Removing a channel drops its Pings from the list and from Lookout's store at once. (test)
- [ ] PING-1.4 Who "you" are is the user id in `tb-slack doctor --json`'s identity. It's read when the first channel is saved, at each server start with a Watched channel, and again after a read failed as not signed in (PING-4.7). No setting holds it. (test)
- [ ] PING-1.5 Lookout runs only `tb-slack doctor`, `channels`, `search` and `thread`, each with `--json`. The server refuses any other subcommand, every one that writes to Slack among them, as WORK-5.3 does for Productive and GitHub. (test)

### PING-2 Reading Slack

- [ ] PING-2.1 While at least one Lookout tab is connected and a channel is watched, the server reads once a minute, counted from the end of the last read. With no tab connected it reads nothing. The first tab to connect starts a read at once when the last one ended more than a minute ago. (test)
- [ ] PING-2.2 A read is one `tb-slack search` per Watched channel, for the messages there that mention you in the last 7 days: 100 at most, bots' messages among them. Each one found is a **match**. (test)
- [ ] PING-2.3 For each match Lookout hasn't placed in a thread yet, and for each open Ping (PING-3.2), it reads the thread with `tb-slack thread <permalink> --json`, 200 messages at most. A match belongs to the thread that answer names: Lookout doesn't read it out of the permalink. (test)
- [ ] PING-2.4 One read makes at most 10 thread reads: new matches first, the newest first, then open Pings by how long ago each was last read. The rest wait for the next read. (test)
- [ ] PING-2.5 One read runs at a time. A `tb-slack` call that takes more than 20 s is killed, and the read fails (PING-4.8). (test)
- [ ] PING-2.6 What Slack says is shown as plain text: a Slack link shows as its label, a mention as its name, and nothing else in it is interpreted. Lookout follows no link in it and puts none of it into a prompt (PING-5.3). (test)

### PING-3 A Ping, open and closed

- [ ] PING-3.1 A Ping is one thread of a Watched channel with at least one match written by someone other than you. A top-level message nobody replied to is a thread of one. A thread has one Ping, however many of its messages mention you. (test)
- [ ] PING-3.2 A Ping is **open** from its first match. It's **answered** once a message of yours in the thread is later than its latest match, and **dismissed** once you dismiss it (PING-4.5). (test)
- [ ] PING-3.3 A match later than your answer, or than your dismissal, opens the Ping again. (test)
- [ ] PING-3.4 A Ping whose latest match is more than 7 days old leaves the list and the store, whatever its state. (test)
- [ ] PING-3.5 A Ping keeps its channel; its thread's first message and its latest match, each with who wrote it, when, and its text; its permalink; its pull requests (PING-5.1); and its state with the time it changed. Pings are kept in Lookout's store, dismissed ones too, so after a restart the same list shows before the first read ends. (test)

### PING-4 The list

Where Pings live is Open question 3. Drafted here: a section at the top of Work, and one line that shows wherever you are in Lookout.

- [ ] PING-4.1 Work shows a "Pings" section above Tasks while a Ping is open, or was answered or dismissed in the last 24 hours. Open ones come first, the newest latest match first; then the others, quieter (DS-22), newest first. Its heading counts the open ones. (test)
- [ ] PING-4.2 A Ping's row is two lines: the first line of its thread's first message, shortened to fit; under it, the channel's name and how long ago its latest match was written ("14 min ago"). (test)
- [ ] PING-4.3 A press on a row, or Enter on the selected one, expands it (DS-21): a state line with who wrote the latest match, its clock time and the Ping's state; the latest match's text, six lines at most; and its pull requests, each as `<repo>#<number>` with a count of its Linked Sessions (PING-5.2) that lists them in place, as WORK-4.10 does. (test)
- [ ] PING-4.4 An expanded Ping's actions, in this order: "Open Session" when a live Session is Linked, else "Resume" when a past one is, then "Start Session…", "Open in Slack" and "Dismiss"; on a dismissed Ping, "Reopen" in place of "Dismiss". The first is a labelled button and the rest are under "More" (DS-16), as WORK-2.10 has it. No click on a row opens, resumes or starts anything (WORK-1.12). (test)
- [ ] PING-4.5 "Dismiss" closes the Ping for you alone, and nothing is sent to Slack. "Open in Slack" opens the latest match's permalink in the browser. (test)
- [ ] PING-4.6 While at least one Ping is open, a line shows above the Session list, whichever right-sidebar tab is open or none: "1 Ping · 14 min ago", the age that of the newest latest match. A press on it opens Work with that Ping selected and expanded. With no open Ping there's no line. (e2e)
- [ ] PING-4.7 Without `tb-slack`, or with one too old (TOOLS-2.5), the section says so with the command that installs it. When `tb-slack` isn't signed in (its error's `code` is `credential_missing` or `authentication_failed`), the section says so with what fixes it. In both cases the section shows even without a Ping, and the line of PING-4.6 doesn't. (e2e)
- [ ] PING-4.8 When a read fails for any other reason, the section keeps the last list, marks it old and gives the reason, as WORK-7.3 does. A failing `tb-slack` whose output holds token-like text (a token starting `xox`, an `Authorization:` header) leaves none of it in the server's log, an event or an API answer (WORK-7.7). (test)
- [ ] PING-4.9 The section, an expanded Ping and the line look right in light and dark mode at 280 and 720 px. (manual)

### PING-5 From a Ping to a Session

- [ ] PING-5.1 A Ping's pull requests are the GitHub pull request URLs (`https://github.com/<owner>/<repo>/pull/<number>`) in its thread's messages: each once, in the order they first appear, five at most. (test)
- [ ] PING-5.2 A pull request's Linked Sessions are found as Work finds a PR's: its opener (WORK-4.2) and the Sessions started on it (WORK-4.3). These pull requests are mostly merged, so Work doesn't list them, and the opener needs the time the pull request was created (Gap 3). Without that time, only the Sessions started on it are Linked. (test)
- [ ] PING-5.3 "Start Session…" opens the launcher (LAUNCH-1) with the prompt set to the Ping's permalink, its pull requests' URLs and one request: read the thread, say what it asks of you and what answering would take, and change and post nothing yet. No text from Slack is in the prompt. Nothing starts until you press Start, you can edit the prompt first, and this launcher is separate from the one N opens, as WORK-5.1 says for a Task. (e2e)
- [ ] PING-5.4 "Open Session" selects the Linked Session that WORK-2.4's rule picks, and "Resume" resumes it (HIST-3). Either puts the prompt of PING-5.3 into that Session's composer, unsent. (e2e)
- [ ] PING-5.5 A Session whose first prompt contains a Ping's permalink, matched as WORK-4.7 matches a URL, is Linked to that Ping. So a Session started from a Ping is the one "Open Session" names the next time. (test)
- [ ] PING-5.6 Lookout starts, resumes and prompts nothing from a Ping by itself: each of these follows a press. (test)

### PING-6 Pings that wait (slice 2)

Some Pings wait for your answer and go on without it. Others only tell you something. Slice 2 tells them apart and shows the time left. How it tells them apart is Open question 4.

- [ ] PING-6.1 A Watched channel can have a wait in minutes, set in Settings beside its name: how long whoever asks there waits for an answer. Empty means none. (test)
- [ ] PING-6.2 Each new latest match is judged once by Jev (`tb-jev ask`), while Jev is ready (USAGE-1.4) and "Judge Pings with Jev" is on in Settings (off by default). The question is yes or no: does the message ask the person it mentions to answer or decide, and say it will go on without them? Its state is the match's text. A yes at or above the threshold makes the Ping **waiting**. (test)
- [ ] PING-6.3 An open, waiting Ping in a channel with a wait shows its time left in place of its age, counted from the latest match: "31 min left" in its row and on the line of PING-4.6, in the warning colour under 15 minutes. Once the wait has passed it shows its age again, and its state line says "waited 45 min". (test)
- [ ] PING-6.4 Open, waiting Pings with time left sort first, the least time left first. (test)
- [ ] PING-6.5 A failed or slow `tb-jev ask` isn't a judgment: the Ping shows its age, and the match is asked again as TOPIC-9.7 retries. A match is never judged twice. (test)
- [ ] PING-6.6 An expanded Ping says how it was judged: "Jev, 91%: waits for an answer". (test)

## Planned slices

Specced after the first two ship. No order yet.

3. **Mentions anywhere:** every channel and direct message, not only the Watched ones.
4. **The Session answers in the thread:** Fleet's Slack link ties a Session to the thread, so what's written there reaches it. It needs Fleet's bridge to Slack, which Lookout doesn't run today.
5. **A start without a press,** for one named bot in one Watched channel.

## Non-goals

- Writing to Slack from Lookout: a reply, a reaction, marking as read. The Session answers, after you approve its exact text.
- Starting, resuming or prompting a Session without a press (Work's Non-goal, "One-click starts").
- OS notifications and sounds. Slack already notifies you of a mention, and SIDE's Non-goal stands.
- A Slack client: channels' other messages, threads that don't mention you, reactions, files, direct messages.
- Mentions outside the Watched channels, mentions of a group (`@channel`, `@here`, a user group), and messages that name you without mentioning you.
- Other Slack workspaces. `tb-slack` is bound to one.
- A live connection to Slack (a Slack app, Socket Mode, the Events API). A read a minute is enough for a 45-minute wait.
- Reading a bot's wording with patterns, to find its deadline or whether the matter is settled.
- The release pipeline itself: which release is in flight, blocked or shipped.
- A model's summary of what a Ping asks, or a drafted answer, in Lookout. The Session does that.
- Failed CI on your PR and new Review requests as Pings (Work's Non-goal, "Notifications").
- Other Hosts.

## UX

A sketch only. A canvas of directions comes before any code (Open question 3). The channel, the names and the text in it are invented.

```
Above the Session list, while a Ping is open
┌──────────────────────────────────────────────┐
│ [at] 1 Ping · 14 min ago                     │
├──────────────────────────────────────────────┤
│ ● Add tax to invoices                        │
│ ○ Fix the rates table                        │

Work, with Pings above Tasks (280 px)
┌──────────────────────────────────────────────┐
│ PINGS                                      1 │
│   Release 12 is blocked: a test from #482…   │
│   #releases · 14 min ago                     │
│   Release 11 shipped. I changed code from…   │
│   #releases · 3h ago · answered              │
│ TASKS                                     14 │

An expanded Ping
│   Release 12 is blocked: a test from #482…   │
│   release-bot · 14:18 · open                 │
│   The rounding test fails on the release.    │
│   Fix it, or I revert #482. I wait 45        │
│   minutes for an answer.                     │
│   shop#482 · 1 Session                       │
│   [Resume]                           [More]  │

Slice 2: the same Ping, judged as waiting
│ [at] 1 Ping · 31 min left                    │
```

- `[at]` stands for a lucide icon, chosen on the canvas ([0008](../../decisions/0008-lucide-icons-only.md)).
- An answered or dismissed Ping is a quiet row (DS-22).
- Keys: ↑/↓, j/k, Enter and Esc as in the rest of Work (WORK-1.12 to WORK-1.15). `O` opens the selected Ping in Slack and `S` opens the launcher for it, as they do for a Task (WORK-6.4, WORK-5.1).
- Empty: no section. A read in progress shows nothing of its own; the list changes when it ends.

## Technical approach

### What exists

- **`tb-slack`** (cli-toolbox, 0.3.4 of 2026-10-30):
  - reads `search`, `history`, `thread`, `users` and `channels`, and writes `send`, `reply`, `edit`, `delete`, `react` and `file`, one call each;
  - every message it answers carries a `permalink`;
  - `--json` is a stable envelope: `ok`, `data`, `pagination`, `warnings`, and errors with `code`, `message` and `recovery`;
  - it's bound to one Slack workspace, and its skill calls what it reads untrusted data.
- **Fleet's Slack links** (`fleet slack link`): a bridge in Fleet's web server ties a Session to a thread, a channel or a direct message. It wakes the Session when someone mentions the app, messages it, or writes in a thread it posted in.
- **Work** already Links a PR to the Session that opened it (WORK-4.2), opens the launcher with a prompt (WORK-5.1) and resumes a past Session from a row.
- **TOPIC** already asks Jev one bounded question per new item (TOPIC-9.3), with its retries and its switch in Settings.
- **Checked on 2026-11-18:** a search for one person's mention in the channel, run through Claude's Slack connector, returned the bot's messages, thread replies among them. The same search through `tb-slack` wasn't run, because its token on this Mac was rejected.

### Sources ([0005](../../decisions/0005-building-blocks-live-outside-lookout.md))

| What | Command | Read from the answer |
|---|---|---|
| You | `tb-slack doctor --json` | `data.identity.user_id` |
| A channel | `tb-slack channels <name> --json` | the one channel of that name: its id and name |
| Matches | `tb-slack search "<@<your id>> in:<#<channel id>> after:<date>" --limit 100 --json` | `data.items`: each match's `ts`, `text` and `permalink` |
| A thread | `tb-slack thread <permalink> --limit 200 --json` | `data.channel`, `data.thread_ts`, and `data.items`, oldest first: each message's `ts`, its `user` or `bot_id`, and its `text` |

- These shapes are read from `tb-slack`'s source at 0.3.4, not from a run. They're checked against real answers once a token works.
- Fixtures for tests are invented with the same shape. No Slack text from the workspace goes into this repo.
- What's a Ping, when it's open, and which channels are watched are Lookout's rules ([0010](../../decisions/0010-single-consumer-rules-stay-with-the-consumer.md)). Finding pull request URLs in a thread's text (PING-5.1) is Lookout's too: one fixed pattern, with one consumer.

### Gaps (cli-toolbox)

1. **A token that lasts.** `tb-slack` takes `SLACK_TOKEN` from the environment or the Keychain. Slack's `search.messages` takes a user token. On this Mac the stored token is of Slack's expiring kind and is rejected, and `tb-slack` doesn't refresh one. Its README doesn't say where a user token comes from.
2. **`tb-slack mentions`:** the threads that mention a user since a time, replies included, each with whether that user wrote after the latest mention. One call in place of one search and a thread read per Ping, and no dependence on Slack's search index. Its contract goes in `docs/contracts/` before it's built. Slice 1 can run on `search` and `thread`.
3. **A pull request's creation time, by URL,** for PING-5.2. `tb-pr` answers open pull requests.
4. **The installed version:** this Mac has 0.2.1. Lookout needs 0.2.0, the first whose reads carry permalinks.

### Lookout's side

- `server/pings.ts`: the read loop (PING-2), the Pings and their states (PING-3), and a `pings` event to the tabs over the event stream, as Work's snapshot goes.
- The store: one row per Ping, by channel id and thread; its matches; dismissals; and, in slice 2, Jev's judgment per match.
- Settings: the Watched channels, each with its id, its name and, in slice 2, its wait.
- The line above the Session list reads the same snapshot as the section.

### Other specs, when built

- WORK: the Pings section sits in its tab. Its Non-goal on notifications stands.
- TOOLS: `tb-slack` as a Building block, with the version Pings need.
- LAUNCH-1.3: a launcher opened from a Ping, as one opened from Work.
- VIEW: a composer filled from outside, unsent (PING-5.4).
- SIDE: the line above the Session list, and SIDE-3.3's count if Open question 6 says so.
- TEST: a World with a fake `tb-slack`.
- USAGE and Settings: the switch for Jev (slice 2).

### Key decisions

Proposed in the draft. The grill confirms or changes them.

- **Poll, don't listen:** `tb-slack` answers one call at a time, a live connection needs a Slack app, and a minute's delay is small against a 45-minute wait.
- **`tb-slack`, not Fleet's Slack link:** the link wakes a Session on mentions of the app, not of you, spends a model's turn on each message, and needs a bridge Lookout doesn't run.
- **A mention of you is the signal:** the bot mentions only whoever must act, so none of its wording has to be read.
- **One Ping per thread:** the bot asks, reminds and closes in one thread, and a row per mention would show one question three times.
- **You press Start:** Slack's text is untrusted, and a start without a press would let anyone who can post in a public channel start an agent on this Mac.
- **The prompt holds the link, not the text:** the Session reads the thread with its own tools, so Lookout never hands Slack's words to an agent as instructions.
- **Lookout doesn't write to Slack:** an answer is the Session's, sent after you approve it.
- **Not an alarm:** Slack already notifies you of a mention. Lookout adds the step from the mention to the Session.
- **Answered when you write in the thread:** Slack gives that as a fact. Whether the matter is settled would be a judgment.
- **Jev for "waits", not patterns:** the bot's wording is a model's and changes, and Lookout already asks Jev bounded questions.
- **Watched channels, not all of Slack:** one channel is today's need, and an inbox of every mention is a larger feature (slice 3).

## Open questions

- [ ] 1. How `tb-slack` gets a user token that lasts on this Mac, and where that setup is written down. *(blocking)*
- [ ] 2. Whether `tb-slack search` returns a bot's thread replies, and how long after they're written, measured on the real channel. If it takes minutes, read `history` and `thread` instead, or build Gap 2 first. *(blocking)*
- [ ] 3. Where Pings live: a section in Work with a line above the Session list (drafted), a tab of their own, or rows among the Sessions. A canvas of directions first. *(blocking)*
- [ ] 4. Slice 2's judgment: Jev, as drafted, which sends a mention's text to Jev; or every Ping in a channel with a wait counts down; or no time left at all. Its threshold comes from labelled examples.
- [ ] 5. A merged pull request's Sessions: its opener, which needs Gap 3, or every Session whose Transcript names its URL.
- [ ] 6. Whether open Pings count in the tab title (SIDE-3.3), which today counts the Sessions that need you.
- [ ] 7. Whether "Open Session" and "Resume" fill the composer (PING-5.4), which needs a change in VIEW, or only select the Session.
- [ ] 8. Whether "Start Session…" opens the launcher in the Start directory that holds the pull request's repo, or where the launcher opened last.
- [ ] 9. Whether to read with no tab connected, so the list is current the moment Lookout opens.
- [ ] 10. Gap 2 before slice 1, or after it has run on `search` for a while.

## Changelog

- 2026-11-18: Created as a Draft from a conversation with Dario and a check, the same day, of `tb-slack`, Fleet's Slack links and the channel. Not grilled.
