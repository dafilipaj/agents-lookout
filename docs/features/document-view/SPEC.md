---
title: "Document view: files open in Lookout"
code: "DOC"
status: "In Progress"
created: "2026-11-27"
updated: "2026-11-27"
---

# Document view

## Summary

A file opens in Lookout's main pane instead of leaving for VS Code or a browser tab: a Markdown file rendered as the chat renders Markdown, an HTML page in a sandboxed frame, an image. It opens from a file path in a Session's chat, from the Library's Open and from a Topic view's Output line, and it's the piece a Report already shows its document with (INBOX-2.4). VS Code and the browser are one press away, as the view's own action. This is slice 1: documents. Code files are slice 2.

## Problem

Lookout shows what Sessions did and sends you elsewhere to read it: a Markdown file opens VS Code, a page opens a browser tab, and a path in the chat opens VS Code whatever it names. Each is a switch of app for something you only want to read. The Inbox already renders a Report's document in the main pane (Plan item 67), so the reader exists; it only works for what a Bot wrote.

## Requirements

### DOC-1 What opens in Lookout

- [x] DOC-1.1 The Document view shows one file in the main pane: a Markdown file, an HTML page or an image, by its extension (LIB-2.10's table). It has its own path, `/doc/<the file's path>`, or `/s/<Session>/doc/<the file's path>` when it was opened from that Session's chat, or `/people/<Person>/doc/<the file's path>` from that Person's page (PEOPLE-4.4), so a reload and Back and Forward keep it. A path there that isn't absolute and plain (VIEW-1.18) is the start page. (test)
- [x] DOC-1.2 The Library's Open, its `O`, and Open file on an Artifact's row (LIB-3.3, LIB-3.7) show a Markdown file, a page or an image in the Document view. A PDF opens a browser tab as before, since the frame's sandbox can't show one, and an Artifact or a Share opens its URL. (test)
- [x] DOC-1.3 A Topic view's Output line (TOPIC-10) opens by the same rule. (test)
- [x] DOC-1.4 A file path in the chat (VIEW-1.17) that names a Markdown file, a page or an image opens the Document view on a plain click, at its Session's path, and its tooltip is "Open in Lookout". It is a real link to that path, so ⌘-click opens it in a new browser tab. A link to any other file still opens VS Code. (test)
- [x] DOC-1.5 A document opens end to end: the Library's Open on a Markdown Output shows it rendered in the main pane at its own path, a reload keeps it, Esc returns to where you were, and a page opens in the pane's frame the same way. (e2e)

### DOC-2 The view

- [x] DOC-2.1 The header shows Back, then the file's name as its title with its Type's icon (LIB-2.2), and under it its Type word and its folder, the home directory as `~`, with the whole path as the tooltip. Its actions are Open (DOC-2.5) and, under More, Copy path, which says "Copied" for 2 s or "Couldn't copy" (VIEW-1.14). (test)
- [x] DOC-2.2 The file shows by its Type with the piece a Report uses (INBOX-2.4): Markdown rendered as the chat renders it (VIEW-1.6), from at most its first megabyte, saying so when it was cut; a page in a frame that fills the pane, under INBOX-2.9's sandbox; an image at its own size, no wider than the pane. (test)
- [x] DOC-2.3 While the server is asked, the view says "Reading the file…". A file that no longer exists says "This file no longer exists."; one the server won't read (DOC-3.1) says "Lookout can't show this file." with why. Neither has Open. (test)
- [x] DOC-2.4 Back, and Esc with no modifier, outside a text field and with no dialog open, leave the view for where it was opened from: the Session's chat, the Topic view, the place it was over. A view with nothing of Lookout's before it in this tab (a ⌘-click's new tab) goes to its Session, to its Person's page, or to the place you were in, where you left it (NAV-2.4). (test)
- [x] DOC-2.5 Open leaves Lookout with the file, as a Report's does (INBOX-2.8): a Markdown file in VS Code, where its button reads "Open in VS Code", or in Obsidian when it is under the Vault folder, where it reads "Open in Obsidian" (PEOPLE-4.5); a page or an image in a new browser tab from the file route (LIB-3.3). `O` runs it. (test)
- [x] DOC-2.6 A document at a Session's path belongs to Sessions and that Session stays the selected row; one at a Person's path belongs to People and that Person stays the selected row (PEOPLE-4.4); one at `/doc/…` belongs to no place, so the left column keeps the place you came from (NAV-2.3). (test)
- [ ] DOC-2.7 Seen at 1440 px, light and dark: a Markdown file reads as prose at the chat's width, a page fills the pane to its edges under the header, and the header is one line with the right sidebar open at 360 px. (manual)

### DOC-3 What the server reads

- [x] DOC-3.1 The server reads a file for the Document view only when it listed its path since it started: one of its Library reads listed it (LIB-3.3), or the path check answered it as a file for a Session Fleet lists (VIEW-1.18) and its extension is a document's (LIB-2.10), or a Person's page named it (PEOPLE-4.4). `GET /api/doc?path=` answers such a file's Type, whether it still exists and whether it is under the Vault folder (PEOPLE-4.5). Any other path, and one that isn't absolute and plain, is answered 404, "Lookout can't show this file.", and nothing else about it. A file under a Private folder is such a path, whenever it was listed (PEOPLE-2.5). (test)
- [x] DOC-3.2 A Markdown file's text comes from `GET /api/library/text?path=`: only `.md`, only a listed path, at most its first megabyte as text, and whether it was cut. A page and an image come from the file route, with `frame=1` in the view (INBOX-2.9). Neither route runs a command or follows a link in place of the file. (test)
- [x] DOC-3.3 After a restart nothing is listed. A view at a Session's path asks the path check again before it asks for the file. For a path at `/doc/…` that isn't listed, the server first reads the Person's folder when the path is inside the Vault's People folder, which lists that Person's notes (PEOPLE-4.4), and else reads the Library once, headless Sessions included, before it answers. (test)
- [x] DOC-3.4 A file kept in iCloud that isn't on this Mac is fetched when it is opened, with "Reading the file…" meanwhile: the launchd agent's plist sets `MaterializeDatalessFiles`, without which macOS refuses such a read to the server. When the text can't be had, the view says why in place of it, under the file's header with Open still there: macOS refused the fetch all the same ("This file is kept in iCloud and isn't on this Mac…", with what to do); the read failed, as a fetch does with the network away ("…couldn't be fetched (<the disk's code>). It needs the network…", or "This file couldn't be read (<code>)." for a file that is on this Mac); or the text hasn't arrived in 20 s ("This file hasn't arrived yet…"). Asking again for a file whose read is still under way waits for that read, and no more than three reads wait at once. A Report's Markdown document says the same (INBOX-2.4). The server's own lists fetch no file: the Library's titles leave one that isn't on this Mac its name (LIB-2.12). The key holds for every process the server starts, so a Session or a Bot run started by it reads a file kept in the cloud as one started in a terminal does. (test)

## Non-goals

- Code files in Lookout: slice 2. Until then a code file's link opens VS Code.
- A diff view in Lookout: a changed file's diff stays in VS Code (DIFF-4; Dario, 2026-11-27).
- Setup's files (a skill, a `CLAUDE.md`, a memory file): they are settings you edit, and stay "Open in VS Code" (SETUP).
- A PDF in the pane: the frame's sandbox can't show one, so it keeps its browser tab.
- Editing a file, or a Rendered and Source switch for Markdown.
- A composer under the document that asks the Session that wrote it, and comments on a passage sent to that Session: later slices of this spec (Plan item 68).
- The Session that wrote a file, in the header: with the composer's slice, which needs it.
- Opening at a line (`notes.md:12`): a rendered file has no lines. The line is dropped.
- Links from one Markdown file to another, and images inside one: they render as the chat's do.
- Several documents open at once, tabs of them, or search inside one.
- File links in a past Session's chat (VIEW's Non-goal stands).

## UX

```
┌────┬───────────────┬──────────────────────────────────────┬────┐
│ ◎  │ / filter    + │ ← Back  # notes.md      [Open in VS Code][⋯] │
├────┼───────────────┤          Markdown · ~/work/output    │    │
│Inbx│ the place's   ├──────────────────────────────────────┤    │
│Sess│ list          │   # Notes                            │    │
│    │               │   the file, rendered, at the chat's  │    │
│    │               │   width                              │    │
│ ⚙  │ usage, memory │                                      │    │
└────┴───────────────┴──────────────────────────────────────┴────┘
```

- The view is the Report's without what belongs to a run (GUIDE, "A document shown in place"): `PlainView`'s header, then the document.
- Back is the quiet button Settings has, with lucide's `ArrowLeft`. Open is quiet; nothing here is Primary (DS-18.4).
- A page's frame is white to the pane's edges, since a page brings its own colours. Markdown and an image sit in the chat's column.
- **Loading and errors.** `Loading`, "Reading the file…". "This file no longer exists." and "Lookout can't show this file." are info and error `Alert`s in the chat's column.
- **Shortcuts:** Esc back, `O` Open. The arrow keys scroll a Markdown file (`data-scroll-keys`).

## Technical approach

- **Routes.** `{ name: 'doc'; path: string; session?: string }` in `lib/router.ts`, the file's path as one encoded segment. `placeOfRoute` answers Sessions with a Session and the last place without (`lib/places.ts`).
- **The view.** `DocumentView.tsx`: `PlainView` with the header above, and `DocumentFile` (`DocumentFile.tsx`), the Markdown, page, image and gone branches moved out of `ReportView.tsx`, which keeps its card and uses the same piece.
- **Opening.** `lib/outputs.ts` says which Types show in Lookout (`showsInLookout`) and which Output has a file that does (`documentOf`). The Library and the Topic view call App's `openDocument(path)`; `FilePath` links to the Session's document path and navigates on a plain click.
- **The server.** `OutputFiles` (`server/output-files.ts`) keeps one set of listed paths for the file route, the text route and `/api/doc`. The path check lists what it answers as a file when `documentType` knows its extension. `Bots.text` (INBOX-2.4) reads through the same function.
- **Tests.** The view, the router and the server routes in unit tests; DOC-1.5 in a World on the Library's fixtures.

### Key decisions

- **The main pane, not beside the chat** (Dario, 2026-11-27): a Report already reads this way, and a composer and comments fit under the same view later. The chat is one Esc away.
- **Documents first, code next** (Dario, 2026-11-27): the Inbox's reader covers Markdown, pages and images today; a code file needs a source view with lines.
- **The server still reads only what it listed** (LIB-3.3's rule): a path in a chat is listed by the path check, which is a POST with the token, so the file routes stay closed to a path nobody was shown.
- **The file's name is the title**: it needs no read of the Library, and a Markdown file's own heading is the first thing in the pane.
- **A PDF keeps its tab**: Chrome's viewer doesn't run in the sandbox the frame needs.
- **Leaving for a document replaces the Session's view**: its chat opens again as selecting the Session does. Keeping it underneath means a view whose keys still act on the Session.

## Known gaps

- Returning from a document opened deep in a chat shows the chat as selecting the Session does, not at the link you pressed.
- A text given up after 20 s (DOC-3.4) still holds one of the server's four file threads until macOS ends the read; three may wait at once, so one thread is left. What macOS does with such a read offline, and for how long, isn't tested: the words for a failed fetch are written for whatever code it ends with.
- `MaterializeDatalessFiles` is the whole agent's, and what it starts inherits it: git, which the Changes poll and the Library run in a Session's and an Output's folder, fetches a file kept in the cloud when it reads one there (a Vault kept in git, say), and so does every Session in a tmux server the agent started. A tmux server started before the key was set keeps the old way until it ends.
- Whether a file is on this Mac is told by its blocks (LIB-2.12), since Node doesn't give macOS's own flag: a file kept in the cloud that keeps something on the disk all the same would be read for its title, and fetched.
- A page or an image kept in the cloud that macOS won't fetch shows a broken frame, with no words of its own: only a Markdown file's read says why.

## Open questions

None blocking.

## Changelog

- 2026-11-27: Created from Dario's idea after the Inbox (Plan item 68): "it makes sense that files open in Lookout instead of launching VS Code". Three questions settled the same day, each as recommended: documents now and code next; the main pane; a changed file's diff stays in VS Code. In Progress.
- 2026-11-27: Built: `DocumentView.tsx`, `DocumentFile.tsx` (the piece a Report uses too), the `doc` route, `server/document.ts`, `/api/doc` and `/api/library/text`, and the path check's listing. Every `(test)` and `(e2e)` criterion is ticked on its tests (DOC-1.5 in a World). Seen in a development server beside 4747, at 1440 px with the right sidebar at 360 px: a Markdown Output in light mode and a page in dark; DOC-2.7 waits for Dario's look. Found in building: an image's path wasn't a link in the chat at all, so VIEW-1.17 gained the image extensions.
- 2026-11-27: DOC-3.1 gains Private folders (PEOPLE-2.5): a private file is answered as a path never listed, at every read, by `/api/doc`, the text route and the file route.
- 2026-11-27: For People (PEOPLE-4.4, 4.5): DOC-2.5 gains "Open in Obsidian" for a Markdown file under the Vault folder, DOC-3.1 a note a Person's page named and the answer's `vault`, and DOC-3.3 the read of a Person's folder for a path inside the People folder, before the Library's.
- 2026-11-27: DOC-3.4 added, after Dario got "Couldn't read this file" on a 1on1 note of his Vault. The cause, found on the live server: 83 of his 109 1on1 notes were kept in iCloud and not on the Mac, and macOS refuses the read of such a file to a launchd job (it fails at once with EDEADLK) unless the job's plist sets `MaterializeDatalessFiles`; a server started from a terminal is not refused, which is how the checks before shipping missed it. The plist sets the key now (tried in a launchd job of its own: the same reads then took about a second each), a refused read says why in place of "Lookout can't show this file.", and a read is given up after 20 s. After a review (Opus 5.5: no problem that had to be fixed, three weaknesses): a read that fails any other way, as a fetch does offline, says so with the disk's code and no longer answers as a file Lookout doesn't show; a second ask for a file whose read is under way joins it, and three reads wait at most, so asking again can't take every file thread; the privacy rule is asked again once a read ends; and the spec says that the key is inherited by what the server starts (Known gaps). The Library no longer opens a file that isn't on this Mac for its title (LIB-2.12), so that with the key set drawing a list still downloads nothing (0018).
