---
title: "Inbox: what your Bots left for you, read in place"
code: "INBOX"
status: "In Progress"
created: "2026-11-26"
updated: "2026-11-26"
---

# Inbox

## Summary

The Inbox is the place where Reports arrive: one for each Bot run that finished, failed or waits on you. Its list sits in the left column, newest first, unread until opened, and the selected Report shows in the main pane: the page or the notes the run wrote, rendered in place, or its last reply when it wrote none. From a Report you open or resume the Session that wrote it, open the document in the browser, and archive it. The rail counts what's unread (NAV-3.1).

## Problem

What a scheduled agent writes has nowhere to arrive. The Library lists every Output of every Session, read or not, among the day's scratch files, and says nothing about a run that failed or wrote no document. Without a list of what's new and unread, a Monday report is something Dario has to remember to go and find.

## Requirements

### INBOX-1 The list

- [x] INBOX-1.1 In the Inbox the left column lists Reports: every Bot run that finished, failed or began waiting on you (BOT-4.8), newest arrival first, grouped by the day it arrived in the browser's local time ("Today", "Yesterday", then the date), each day a `group` of one listbox named by its heading (DS-17). A run that was waiting on you and then finished arrives again: it moves to the top, is unread again and, if you had archived it, is back in the Inbox. (test)
- [x] INBOX-1.2 A row shows the Report's title, and on a second line its Bot's name, what it holds and its age. The title is the title of the first document the run produced (INBOX-2.3), else the run's name, the Bot's and the day ("Team week · Nov 23"). What it holds is "2 documents", "1 document", "a reply", "failed", "waiting on you" in Needs you's amber, or "running" for a run that goes on after you answered it. Its icon, 16 px before the title, is the Library's for the first document's Type (LIB-2.2), lucide's `MessageSquareText` for a reply, `TriangleAlert` in the destructive colour for a failed run and `CircleHelp` for one waiting on you. A row's accessible name is its title, its Bot, what it holds, its age and "unread" when it is. (test)
- [x] INBOX-1.3 The column's header holds a filter, "Filter Reports", which `/` focuses: every word typed must be in the title or the Bot's name, whatever its case; Esc clears it and leaves it. (test)
- [x] INBOX-1.4 Under the header a `Segmented` shows "Inbox" or "Archived" (INBOX-4); the choice is kept in the browser for this page load only, and a reload shows Inbox. (test)
- [x] INBOX-1.5 With nothing to list the column says why: "Nothing has arrived", "A Bot's Report arrives here when its run ends.", with a "Bots" action that opens the Bots tab (BOT-1.1); "Nothing matches" under a filter; "Nothing archived" in Archived. Before the server's first answer it's a `Loading`, "Connecting…", as the Session sidebar's. (test)
- [ ] INBOX-1.6 Seen at 1440 px, light and dark: rows read like the Library's, the unread dot and the semibold title tell unread from read at a glance, and a row's second line doesn't wrap. (manual)

### INBOX-2 Read a Report

- [x] INBOX-2.1 Selecting a row shows its Report in the main pane at `/inbox/<run id>`, for every id the store takes, so a reload and Back and Forward keep it. A path whose run the server doesn't have shows "This Report is gone", with the Inbox's list beside it. (test)
- [x] INBOX-2.2 The Report's header shows its title; then its Bot's name, a link that opens the Bots tab on that Bot; when the run ended and how long it took ("Mon 23 Nov, 07:34 · took 4 min"), with "started 1 h 25 min late" when it did (BOT-3.3). Its actions are, in order: the Session's (INBOX-2.7), Open (INBOX-2.8), Archive (INBOX-4.1), and under More: Copy link and Mark unread. (test)
- [x] INBOX-2.3 A finished run's Report holds the Outputs its Session produced, by the Library's rules for what an Output is (LIB-2.10 to 2.12), the one updated last first: every one the Library has for it, up to 200, and its row counts those it shows. With more than one, a tab strip (DS-13.2) under the header names each by its title and Type word, and the open one is in the path (`/inbox/<run id>/<n>`, none for the first). (test)
- [x] INBOX-2.4 The open document shows in place by its Type: a Markdown file rendered as the chat renders Markdown (VIEW-1.6), from at most its first megabyte, saying so when it was cut; an HTML file as a page in a frame that fills the pane; an image at its own size, no wider than the pane. An Artifact shows its source file by the same rules while that file exists. A PDF, a Share, and an Artifact whose source file is gone show a card with the document's title, its Type, where it is and one Primary button, "Open", since a browser tab is the only place they can be read. A file that no longer exists says "This file no longer exists." and that resuming the Session is how it comes back (LIB-3.3). (test)
- [x] INBOX-2.5 A finished run that produced no Output shows its Session's last reply, rendered as Markdown under the line "It wrote no document. This is its last reply."; with no reply either, "It finished without a reply." (test)
- [x] INBOX-2.6 A failed run's Report is an error `Alert` saying what failed and why (BOT-4.5), then whatever the run did produce (INBOX-2.3, 2.5). A run waiting on you shows "It's waiting on you" with what it waits for (SIDE-2.3's words) and a Primary "Open Session", or "Open its start" while it waits at its Trust prompt and has no Session yet (BOT-4.3); once you answered and it runs again, "It's running again" until it ends. (test)
- [x] INBOX-2.7 The Session's action is one button by what the Session is, as LIB-3.5's: **Open Session** when it's live (selects it, which shows Sessions), **Resume Session** when it can be resumed (through History's resume route, HIST-3.1), **Show Session** when it can't (HIST-3.3). A run that never got a Session has none. `S` runs it. (test)
- [x] INBOX-2.8 **Open** leaves Lookout with the shown document, which the Report already shows in place: a Markdown file in VS Code, a page, PDF or image in a new browser tab from Lookout's file route (LIB-3.3), an Artifact or Share at its URL with no referrer. `O` runs it; a Report with no document has no Open. (test)
- [x] INBOX-2.9 An HTML Report's frame can't reach Lookout: the page runs in an opaque origin, where its scripts run, its storage doesn't, its requests to Lookout are refused and it can't navigate the window; its links and forms open as ordinary tabs, never inside the frame, unless the page names another target itself. The route sends that sandbox on every answer and lets only Lookout's own page frame it (LIB-3.3's rules, plus the frame). (test)
- [x] INBOX-2.10 A Report with a real page reads end to end: the Inbox lists a finished run from the server's store, selecting it shows the page the run wrote inside the pane, and Open opens that page in a new tab. (e2e)
- [ ] INBOX-2.11 Seen at 1440 px, light and dark: a Markdown Report reads as prose at the chat's width, a page fills the pane to its edges under the header, and the header's actions sit on one line with the right sidebar open at 360 px. (manual)

### INBOX-3 Unread

- [x] INBOX-3.1 A Report is unread from when it arrives until it's shown in the main pane. The server keeps it, so every tab and a reload agree. A mark names the arrival it was made for: one that reaches the server after the Report arrived again (INBOX-1.1) changes nothing. (test)
- [x] INBOX-3.2 An unread row has SIDE-13.2's mark: a 6 px dot in the title's colour after the title, and the title semibold. "Mark unread" (INBOX-2.2) makes a Report unread again and leaves it open; it's read again the next time it's selected. (test)
- [x] INBOX-3.3 The count the rail shows (NAV-3.1) is the unread Reports that aren't archived. (test)

### INBOX-4 Archive

- [x] INBOX-4.1 Archive, the header's button or `E`, moves the open Report out of the Inbox's list into Archived and marks it read; once the server kept it, the next row down is selected, else the one above, else nothing, of the rows that show with the filter as it is. An archive the server refuses moves nothing and says why above the Report until the next try. In Archived the same button is "Move to Inbox" and brings it back. (test)
- [x] INBOX-4.2 Archiving deletes nothing: the Report stays under Archived and on its Bot's runs (BOT-1.5) until BOT-4.8 drops the run, and its Outputs stay in the Library. (test)

### INBOX-5 Keys

- [x] INBOX-5.1 In the Inbox, with focus outside a text field and the right sidebar and no dialog open: ↑/↓ and j/k move the selection and show the Report, ⌘1–⌘9 select the first to ninth row (from a text field of the left column or the main pane too, as in Sessions, SIDE-5.2), `/` focuses the filter, `E` archives, `O` opens the document and `S` runs the Session's action. Each is an entry of the shortcuts list (SIDE-7.4). ↑/↓ from inside a Markdown Report scroll it instead (SIDE-5.1). (test)

## Non-goals

- Anything in the Inbox that isn't a Bot's Report: Pings (PING) and Review requests come later, each with its own slice.
- The composer under a Report that asks the Session that wrote it: the next slice (Dario, 2026-11-26). Until then Resume Session opens it in Sessions.
- Filing a Report to a person, a Goal or a Topic; adding one to a Topic from the Inbox: with People, or when asked for.
- Deleting a Report, snoozing one, or rules that archive by themselves.
- A notification, a sound or a badge on the browser tab for a new Report: the rail's count is the signal. The tab title stays Sessions' (SIDE-3.3).
- Showing claude.ai inside Lookout: claude.ai refuses to be framed, so an Artifact with no source file opens in a tab.
- Serving a page's sibling files (LIB's Known gap): a Report that needs `./chart.js` shows without it; pages that inline everything, as Artifacts do, show whole.
- Searching inside Reports: the filter reads titles and Bots' names. History searches what a Session said.
- A Report's documents kept by Lookout: a file the run wrote lives where the run wrote it, and one in a scratchpad goes when the scratchpad is cleared (LIB's Known gap). A Bot that should last writes outside a scratchpad or publishes an Artifact.

## UX

```
┌────┬───────────────┬──────────────────────────────────────────────┬───┐
│ ◎  │ / Filter Rep… │ Team week 47   Team week · Mon 23 Nov, 07:34 │   │
├────┼───────────────┤          [Resume Session] [Open] [Archive] … │   │
│ ▣4 │ [Inbox|Archv] ├──────────────────────────────────────────────┤   │
│Inbx│ Today         │ [Team week 47 · Page] [Notes · Markdown]     │   │
│ ▤2 │ ▢ Team week ● │                                              │   │
│Sess│   Team week · │   the page, or the notes, in place           │   │
│    │   2 docs · 2h │                                              │   │
│    │ Yesterday     │                                              │   │
│ ⌨  │ ! Flaky tests │                                              │   │
│ ⚙  │   failed · 1d │                                              │   │
└────┴───────────────┴──────────────────────────────────────────────┴───┘
```

- **A row** copies the Library's (GUIDE, "A list row"): `data-slot="row"`, the 16 px icon, the title in `body`, the second line in `meta` `muted-foreground`, the age at its right in `tabular-nums`. Selected, it's the neutral `sidebar-accent`.
- **The Report's view** is a `PlainView`: it has no dock, and its body runs to the bottom. A Markdown Report sits in the chat's column (`max-w` as the chat's prose) with 24 px above it; a page's frame has no padding and a `background` of white, since a page brings its own colours.
- **The header** copies a Topic view's: the title in the `h1`, facts after it in `meta` `muted-foreground`, actions at the right as `Button`s in the `default` size, the Session's first, then Open, then Archive, then More. None is Primary, except in a card or a waiting Report, where the card's one button is what the surface is for.
- **The document strip** is `Tabs` (DS-13.2), shown only with more than one document.
- **Loading and errors.** While a Report's documents are read: `Loading`, "Reading what it produced…". A Library that can't be read (tb-session missing or too old): the Library's own Alert (LIB-2.8) above the reply. A file that can't be read: an error `Alert` with why.
- **Shortcuts:** ↑/↓, j/k, ⌘1–9, `/`, `E`, `O`, `S` (INBOX-5.1).

## Technical approach

- **What a Report is.** A run in `~/.lookout/bots.json` (BOT, Technical approach) with `arrivedAt` set, and the Inbox's own fields on it: `title`, `holds` (`{ documents, reply }`), `reply` (the last reply, at most 20,000 characters), `read`, `archived`. They go to every tab with the Bots in the `bots` event, without `reply`.
- **When it arrives.** As a run finishes, `Bots` asks the Library for the Outputs its Session touched (`Library.find` with LIB's `sessions` filter, every Type, gone ones included) and Fleet for the Session's last reply (the chat feed's reader), before it ends the Session. A Session that ended by itself leaves no reply to keep: Fleet reads the chat of a live Session only. It stores the title and what the Report holds; a Library that fails leaves the Report with its reply and the run's name, and the reader tries again when it opens.
- **Reading one.** `GET /api/inbox/<run id>` answers the run, its `reply` and its Outputs, read again from the Library (which reuses a read under 2 s old, LIB-2.1), so a document edited or published since shows as it is now.
- **Showing a document.** A Markdown file: `GET /api/inbox/text?path=…`, which serves only a `.md` that a Report's own read of the Library listed (a part of the file route's allowlist, with its exact-string and regular-file rules; LIB Technical approach, Opening), at most 1 MB, as `text/plain`. So a Report is read (`GET /api/inbox/<run id>`) before its text is asked for, after a restart too. An HTML file or an image: the Library's file route with `frame=1`, which answers with the same sandbox and `frame-ancestors 'self'` in place of `'none'` (and no `X-Frame-Options: DENY`), inside an `iframe` that carries the same `sandbox` attribute. Lookout's own page allows frames from itself only (`frame-src 'self'`).
- **Marking.** `PUT /api/inbox/<run id>` with `{ read }` or `{ archived }`, and `arrivedAt`, the arrival the tab showed.
- **Bounds.** The last reply is looked for in the chat's latest 300 entries, the page the chat itself opens on. A Report holds at most 200 documents. A framed page gets `<base target="_blank">` after its own bytes, which browsers honour wherever it stands.
- **Design system.** The list is the left column's second list, `InboxList.tsx`, a listbox with the window's keys as the Session sidebar's; the reader is `ReportView.tsx`. Both reuse `Segmented`, `Tabs`, `EmptyState`, `Loading`, `Alert`, `Markdown` and the Library's Type icons, moved to `lib/outputs.ts` if they aren't there.
- **Tests.** The server's against the fake tb-session and a store on a temporary HOME; INBOX-2.10's Behaviour test in a World that declares a `bots.json` with one finished run and the Outputs of its Session (`.outputs`, LIB's World needs).

### Key decisions

- **One Report per run, not per document** (Dario, 2026-11-26): a run that failed, waits on you or only replied still arrives, and one run is one thing to read and archive.
- **The Library's rules decide what a run produced**: one definition of an Output, and a published Artifact folds its source file as it does there.
- **Read in place**: a Report you have to open elsewhere is a link, and the point of one app is not to leave it. A page gets the same sandbox as the Library's tab, so framing it gives it nothing new.
- **The reply is kept with the run**: once the Session is ended, the Transcript is the only other copy, behind tb-session's index.
- **Unread is the server's**: a count on the rail that differs between two tabs would mean nothing.
- **Selecting shows, as in the Session list**: a list in the left column drives the main pane; the right sidebar's lists expand in place because the main pane isn't theirs.

## Open questions

None blocking.

## Changelog

- 2026-11-26: Created from Dario's pivot (Plan item 67), grilled the same day in seven questions with BOT, every one as recommended: one item per run; the composer under a Report in the next slice.
- 2026-11-26: Amended while building: a failed Report's row draws its triangle once, as its icon in the destructive colour (INBOX-1.2); a Report that waited on you and runs again says so (INBOX-1.2, 2.6); INBOX-2.6 cited SIDE-2.5 for SIDE-2.3; arriving again brings an archived Report back (INBOX-1.1); the text route's allowlist is the Reports' own.
- 2026-11-26: From the review (Codex), before the first commit. INBOX-4.1: the neighbour selected after an archive came from every Report, so a filter could leave the selection on a hidden row, and it moved before the server answered; now it's a row that shows, after the server kept it, and a refusal is said. INBOX-3.1: a mark carries the arrival it was made for, so a late one can't mark a Report that arrived again. INBOX-2.9: a plain link no longer replaces the Report inside its frame. INBOX-2.6: a Report waiting at a Trust prompt had no way to its start. INBOX-2.3: a Report read only the Library's first 50 Outputs while counting them all. INBOX-2.1: a Report id with an underscore, which the store takes, had no path. INBOX-5.1 says what the code does with ⌘1–9 in a text field, which is what Sessions does. Not taken: looking for the last reply further back than the chat's latest 300 entries.
- 2026-11-26: Built: the list and the Report's view (`InboxList.tsx`, `ReportView.tsx`, `lib/inbox.ts`), the server's Reports in `server/bots.ts`, the text route and the file route's `frame=1`. In Progress.
- 2026-11-27: INBOX-2.8 reworded, nothing changed: the Library's Open now shows a file in the Document view (DOC), so a Report's Open says for itself where it goes. The Markdown, page and image branches of INBOX-2.4 are one piece with the Document view's (`DocumentFile.tsx`).
