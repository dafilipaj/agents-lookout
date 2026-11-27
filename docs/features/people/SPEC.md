---
title: "People: the people you manage, read from your Vault"
code: "PEOPLE"
status: "In Progress"
created: "2026-11-27"
updated: "2026-11-27"
---

# People

## Summary

People is the third place on the rail: the people you manage, each with their Goals for the quarter, their 1on1 notes and their other notes, read from the Vault, the folder of notes you keep in Obsidian. Lookout keeps none of it and writes none of it ([0018](../../decisions/0018-peoples-data-lives-in-your-vault.md)). Before the place itself comes the part that is needed today: the Vault's folder in Settings, and a list of Private folders that Lookout never lists and never shows.

It ships in three slices: the Vault's folder and Private folders (PEOPLE-1, PEOPLE-2); the place and a Person's page (PEOPLE-3, PEOPLE-4); Goals (PEOPLE-5).

## Problem

The managing half of the job lives in a notes app Lookout doesn't know: a folder per person, a 1on1 note per meeting, review notes beside them. Preparing a 1on1 means leaving Lookout, finding the folder and reading back through the last notes, and nothing says what a person set out to reach this quarter.

Meanwhile Lookout already shows some of those notes where they don't belong. Sessions wrote a review cycle's files into the notes folder, so the Library lists 69 of them, and since the Document view (DOC) one click shows a person's review in the main pane, on whatever screen is shared.

## Requirements

### PEOPLE-1 The Vault's folder

Where the Vault is, set once in Settings.

- [x] PEOPLE-1.1 Settings has a third section, "Vault", after General and Tools, at `/settings/vault`. It opens by saying that your notes stay where they are: Lookout reads the Vault and never writes to it. Its first card is "Vault folder": one field for a full path (`~/…` or `/…`), with Save, and "Saved" or "Cleared" after a save. An empty field clears it, and none is set by default. (test)
- [x] PEOPLE-1.2 The server refuses a Vault folder that isn't a full path on one line ("The Vault folder is a full path, such as …"), and one that isn't a directory when it's saved ("Not a directory: …"); the saved one stays. It keeps the path as typed, `~` included. (test)

### PEOPLE-2 Private folders

Folders whose files stay out of Lookout's lists of documents and out of its reader.

- [x] PEOPLE-2.1 The Vault section's second card is "Private folders": a list you add to and remove from, as Start directories are (LAUNCH-2.2), empty by default and at most 50 long. An entry names a folder: a path inside the Vault folder (`Team/Reviews`), or a full path (`~/…`, `/…`) for a folder anywhere. A `*` in it stands for any run of characters inside one folder's name: `Team/*/Reviews` is the `Reviews` folder of every folder in `Team`, and `Team/360 *` every folder in `Team` whose name starts with "360 ". An entry never names a file: a file whose own name matches one is not private. (test)
- [x] PEOPLE-2.2 The server refuses an entry that is empty, over 300 characters or on more than one line; that has an empty, `.` or `..` part or two `*` in a row; that is another user's home (`~name`); or that is a full path naming no folder outright (`/`, `~`, or one whose every part has a `*`), which would hide everything. It refuses a path inside the Vault while no Vault folder is set ("Set the Vault folder first, or give a full path."), clearing the Vault folder while an entry is a path inside it ("Remove the Private folders inside it first."), and a list that grows past 50 ("At most 50 Private folders."). What was saved stays. (test)
- [x] PEOPLE-2.3 A file is private when it lies under a folder an entry matches, at any depth. Paths are compared whatever the letter case and however an accented letter is encoded: the file's path as recorded and its physical path (every symlink resolved, the file's own included), against each entry as written and as it resolves. Of an entry, the part before its first `*` is resolved; a part of it that doesn't exist yet is kept as written, and the disk is asked again every 10 s, so a folder made, mounted or linked after the entry was saved is still met. Every place the disk has answered for an entry is kept until the settings change, so a volume that goes away and comes back opens nothing. A file's title is never read through a link (LIB-2.12). (test)
- [x] PEOPLE-2.4 A private file is not an Output (LIB-2.10): the Library, a Topic view's Output lines and a Report's documents leave it out as if it had never been written, and it isn't counted among the gone. An Artifact or a Share made from a private file is left out with it. (test)
- [x] PEOPLE-2.5 The server never reads a private file for the browser. The Document view's routes (DOC-3.1, DOC-3.2) and a Report's text route (INBOX-2.4) answer it as a path they never listed, one listed before its folder became private included, and the path check (VIEW-1.18) answers it "not a file", so its path in a chat is no link. When the disk is too slow to say where a file really is, the file counts as private until it answers; while it is slow about an entry's own folder, what it last answered for that entry stands. (test)
- [x] PEOPLE-2.6 A change of the list or of the Vault folder holds from the next thing Lookout draws, with no restart. The Library reads again. Every Topic's Output lines go at once and are read again, and an open Topic view asks for that read itself. A Report whose title was read from a file that is private now shows its Bot's name at once, with no read of the Library, and counts one document fewer; then each Report's title and what it holds are read again, without arriving again, and a run that finishes meanwhile reads its Outputs once more before it arrives. A Library that can't be read leaves the other titles as they are. When the server starts, titles are checked the first way once. An open Document view or Report asks the server again. A save of any other setting, and the disk's own answer to a change, tell no one and leave the Library's reads as they are. (test)
- [x] PEOPLE-2.7 End to end, with two Markdown Outputs, one of them in a folder inside the Vault folder and written by a Bot's run whose Report is named after it: once that folder is added to Private folders in Settings, the Library lists only the other, the Report shows its run's own name, and the private one's own path says "Lookout can't show this file."; removed from the list, it is listed again and the Report has its name back. (e2e)
- [ ] PEOPLE-2.8 Seen at 1440 px, light and dark: the Vault section's cards read as General's do, and an entry with a `*` in it stays on one line at Settings' narrowest. (manual)
- [x] PEOPLE-2.9 A file in the Vault folder that no longer exists is no Output either, whatever the Library's "hide gone" says, and it isn't counted among the gone: a note moved or renamed in the notes app, into a Private folder for example, leaves no row behind under its old name in the Library, a Topic view or a Report. An Artifact or a Share keeps its row. (test)
- [x] PEOPLE-2.10 A settings file edited by hand never shows more than it must. An entry the rule refuses is left out alone, and a list over 50 is kept whole: it can shrink in Settings, never grow. With a path inside the Vault and no Vault folder in it, the card says "No Vault folder is set, so the entries that aren't full paths hide nothing." A file that can't be read as settings at all leaves every setting at its default, so nothing is private until it's mended: the server's log says so, and the file's text is kept beside it as `settings.json.unreadable` when a setting is next saved, never written over. (test)

### PEOPLE-3 The People place

The rail's third place, and its list of Persons.

- [ ] PEOPLE-3.1 People is the rail's third place, after Sessions: lucide's `Users` over "People", with the key `3`, at `/people` and `/people/<Person>`. It has no count. It shows where you left it (NAV-2.4), and the right sidebar carries over (NAV-2.5). (test)
- [ ] PEOPLE-3.2 Its left column lists the Persons: one row per folder directly inside the Vault's people folder, by name, A to Z in the browser's language. The people folder is the Vault section's third field, "People folder", `Team` by default. A folder named `Archive`, a Private folder, and a folder whose name starts with `.` or `_` are no Person. (test)
- [ ] PEOPLE-3.3 A row shows the Person's name and, under it, when their last 1on1 note was, from the newest date in a note's name ("1on1 3 days ago"), or "No 1on1 notes". (test)
- [ ] PEOPLE-3.4 The list comes from folder and file names alone: the server opens no note to draw it, so a note kept in the cloud isn't downloaded. It is read when People shows, when the window gets focus again 30 s or more after the last read, and after a change of the Vault's settings. (test)
- [ ] PEOPLE-3.5 The list's header cell holds a filter, "Filter people" with `/`, which keeps the rows whose name contains what's typed, whatever the case or accents. The list's keys are the Inbox's (INBOX-5): ↑/↓ and j/k move, ⌘1–9 pick a row. (test)
- [ ] PEOPLE-3.6 Without what it needs, the main pane says so, with the way out: no Vault folder ("People reads your Vault.", and a button to Settings' Vault section); no people folder in it ("No `Team` folder in your Vault."); a folder the server may not read ("Lookout can't read your Vault.", naming macOS's Files and Folders setting); no Person yet ("No people yet: add a folder for each one to `Team`."). (test)
- [ ] PEOPLE-3.7 End to end, in a World whose Vault holds two invented Persons: the People button shows the list, a row shows that Person's page at `/people/<name>`, a reload keeps it, a 1on1 note opens in the Document view and Esc returns to the page. (e2e)
- [ ] PEOPLE-3.8 Seen at 1440 px, light and dark: the list reads as the Inbox's, and the rail's three places and its two buttons at the bottom fit a 700 px tall window. (manual)

### PEOPLE-4 A Person's page

One Person in the main pane: what you read before a 1on1.

- [ ] PEOPLE-4.1 The header shows the Person's name as its title and, under it, how many 1on1 notes there are and when the last was ("12 1on1 notes · last 3 days ago"). It is two lines, so the header row keeps its height (SIDE-8.4). (test)
- [ ] PEOPLE-4.2 "1on1 notes" lists every Markdown note in the Person's `1on1s` folder, in any letter case, newest first by the date in its name (`YYYY-MM-DD`); notes without one come last, by name. A row shows the date ("24 Nov 2026"), its age, and what the name says besides the Person's name, "1on1" and the date. (test)
- [ ] PEOPLE-4.3 "Notes" lists every other Markdown note directly in the Person's folder, by name. A file that isn't Markdown, a folder other than `1on1s` and `Goals`, and anything in a Private folder aren't listed. (test)
- [ ] PEOPLE-4.4 A row opens its note in the Document view (DOC-1.1), on a plain click or Enter. People stays the current place, and Back returns to the page (DOC-2.4). The server reads a note this page named (DOC-3.1 gains it). (test)
- [ ] PEOPLE-4.5 A Markdown file under the Vault folder opens in Obsidian, not in VS Code: in the Document view and on a Report, Open reads "Open in Obsidian" and opens `obsidian://open?path=<the file>` (DOC-2.5, INBOX-2.8). (test)
- [ ] PEOPLE-4.6 A Person whose folder is gone, renamed in the notes app for example, says "No folder for <name> in your Vault.", with the list still beside it. (test)
- [ ] PEOPLE-4.7 Seen at 1440 px, light and dark, with the right sidebar open at 360 px: the page reads top to bottom as Goals, 1on1 notes, Notes, in the chat's column, and a row's date and age stay on one line. (manual)

### PEOPLE-5 Goals

What a Person set out to reach this quarter, and how far they are.

- [ ] PEOPLE-5.1 A Person's Goals are in the `Goals` folder of their folder, one Markdown note per quarter. The quarter comes from the note's name: `Q4 2026` or `2026 Q4`, in any letter case, with a space, `-` or `_` between. A note with no quarter in its name is listed after the quarters, by name. (test)
- [ ] PEOPLE-5.2 A Goal is a top-level checklist item of a quarter's note: a line that starts at the margin with `- [ ]`, open, or `- [x]`, reached; `*` and `+` count as `-`. Indented lines under it are its details, an indented checklist item is no Goal, and nothing inside a code block is one. Its text is the rest of the line, with inline Markdown shown as the chat shows it. (test)
- [ ] PEOPLE-5.3 A Person's page starts with "Goals": the current quarter's, by this Mac's date, in the note's order, each with its state and its text, and how many are reached ("2 of 5 reached"). With no note for the current quarter it says "No Goals for Q4 2026." The other quarters are rows under it, newest first, each with its own count, and a row opens its note in the Document view. (test)
- [ ] PEOPLE-5.4 A Person's row in the list shows the current quarter's count after the 1on1 line ("2 of 5 Goals"). For it the server reads one note per Person, at most its first 256 KB, and again only when its size or its modified time changed. A note it can't read shows no count, and PEOPLE-3.4 holds for every other note. (test)
- [ ] PEOPLE-5.5 End to end, in a World whose Vault holds a Person with three Goals this quarter, one of them reached: their page shows the three and "1 of 3 reached", and their row "1 of 3 Goals". (e2e)
- [ ] PEOPLE-5.6 Seen at 1440 px, light and dark: a reached Goal reads as done without Status colours, and a Goal of two lines wraps under its own text, not under its mark. (manual)

## Non-goals

- Writing to the Vault: no new note, no tick of a Goal, no rename, from Lookout itself. A Session or a Bot's run writes what its prompt says.
- Meeting series (a folder per series, a note per meeting) and transcripts: a later slice.
- Starting a Session about a Person, a Bot per Person, and a Person's Reports on their page: later slices.
- Hiding the People place while you share your screen.
- Hiding what a Session's own chat shows, what History finds in a Transcript, or a path in a tool call. A Private folder covers Lookout's lists of documents and its reader.
- Private by file name: a Private folder is a folder (0018).
- Archived people, and a Person's full name, role, photo or any property.
- Obsidian's links between notes (`[[…]]`), embeds and properties: a note renders as the chat renders Markdown.
- A preview of a note in its row, and search inside notes: both would download every note.
- Goals across people, a Goal's history, due dates, owners or weights.
- More than one Vault, and a notes app other than Obsidian for "Open in Obsidian".
- Data about a Person from Productive, 15Five or Slack on their page.

## UX

```
┌────┬───────────────┬──────────────────────────────────────┬────┐
│ ◎  │ / filter      │ Ines                                 │    │
├────┼───────────────┤ 12 1on1 notes · last 3 days ago       │    │
│Inbx│ Ines          ├──────────────────────────────────────┤    │
│Sess│ 1on1 3d · 2/5 │ Goals · Q4 2026        2 of 5 reached │    │
│Peop│ Tomo          │  ◉ Lead the import rewrite           │    │
│    │ 1on1 9d · 0/3 │  ○ Give a talk at the guild          │    │
│    │               │ 1on1 notes                           │    │
│ ⌨  │               │  24 Nov 2026 · 3 days ago            │    │
│ ⚙  │ usage, memory │ Notes                                │    │
└────┴───────────────┴──────────────────────────────────────┴────┘
```

- The list is the Inbox's (GUIDE, "A place on the rail"): the place's filter in the header cell, rows the right sidebar's. People's icon is lucide's `Users`.
- A Person's page is a `PlainView` with a two-line header (GUIDE, "A main-pane view's header") and sections under `SectionLabel`s in the chat's column. Rows are the Library's, without actions: the row is the action.
- A Goal's state is an icon in the text's colour, `CircleCheck` when reached and `Circle` when open, never a Status colour and never a checkbox, since nothing here can be ticked.
- Settings' Vault section is two cards, then a third from slice 2: "Vault folder" as Productive email's card, "Private folders" as Start directories', "People folder" as a one-field card.
- **Loading and errors.** `Loading`, "Reading your Vault…". PEOPLE-3.6's four states are an info `Alert` in the chat's column, an error one for the folder that can't be read.
- **Shortcuts:** `3` People; in the list ↑/↓, j/k, ⌘1–9 and `/`; on a page Esc does nothing, since the page is the place's own.

## Technical approach

- **Settings.** `vaultFolder: string | null`, `privateFolders: string[]` and, from slice 2, `peopleFolder: string` in `shared/settings.ts`. What needs the saved value beside the patch (a path inside the Vault with no Vault set, clearing the Vault under one) is checked in `SettingsStore.update`, where a Start directory's existence already is.
- **The matcher.** `shared/private-folders.ts`: an entry's parse; `privatePatterns(entries, vaultFolders, home)`, each entry as a full folder pattern; and `privateMatcher(patterns)`, which answers whether one absolute path is a file under a matched folder. Parts are compared one by one on NFC, lower-cased text, a `*` matched by a two-cursor wildcard match and no expression, so no entry can make a match slow. `server/private-folders.ts` (`PrivateFolders`) builds the rule from the settings, adds each entry's resolved form, asks the disk again every 10 s, and tells its listeners only when the rule changed.
- **Where it's asked.** In the Library's read, beside the git question (LIB-2.10), on recorded and physical paths; in `OutputFiles`, at every read and not only when a path is listed; in the path check, before its answer. A Report's documents and a Topic view's Output lines come from the Library's read.
- **What a change redoes.** `main.ts` hears the rule change: the Library drops its kept reads (`privacyChanged`), Topics forgets the last read's Outputs and the Library is read again (`forgetOutputs`, `refresh`), and Bots holds every arrived run again (`Bots.privacyChanged`). In the browser, the Library panel reads again and the Document view and the Report are keyed by the two settings, so each asks the server again.
- **People.** `server/people.ts` reads the people folder with `readdir` alone, plus one bounded read per Person for the current quarter's Goals (slice 3), cached by size and modified time. `GET /api/people` answers the list or why there is none; `GET /api/people/<name>` one Person's notes by name, and lists them for the Document view.
- **Routes and the place.** `{ name: 'people'; person?: string }` in `lib/router.ts`; `people` joins `PLACES` in `lib/places.ts` with the key `3` (NAV's own criteria are amended when it's built).
- **Behaviour tests.** A World gains `.vault({ … })`: invented people and notes written under its home, and its settings pointed at them.
- Decisions that apply: [0017](../../decisions/0017-one-app-for-both-roles.md) (places), [0018](../../decisions/0018-peoples-data-lives-in-your-vault.md) (the Vault), [0005](../../decisions/0005-building-blocks-live-outside-lookout.md): reading a folder of notes is Lookout's own, since nothing else would use it.

### Key decisions

- **Private folders first** (Dario, 2026-11-27): review files are in the Library today, so the rule that hides them ships before the place that would add more.
- **A Private folder is a folder, and review notes move into one** (Dario, 2026-11-27): one entry, `Team/*/Reviews`, covers every Person, where a rule by file name would miss the note named differently.
- **Checked at every read, not when a path is listed**: a folder made private must close at once, for paths the server listed an hour ago too.
- **A Goal is a checklist item** (Dario, 2026-11-27): it gives "2 of 5" with no schema, and his weekly planners already use tasks.
- **Goals in `Goals/`, one note per quarter, inside the Person's folder** (Dario, 2026-11-27): beside the 1on1 notes they're discussed in.
- **People first, meetings later** (Dario, 2026-11-27): the first page is what you read before a 1on1.
- **Names only for lists**: most of the Vault is kept in the cloud, and a list that opened each note would download the lot.
- **The Person's name is the folder's name**: it needs no note read and no property, and it's what he calls them.
- **Open in Obsidian for a Vault file**: a note is edited where its links work.

## Known gaps

- A folder a `*` stands for that is itself a symlink: a file recorded at where the link points isn't met, since only the part of an entry before its first `*` is resolved. A file recorded through the entry's own path is.
- A Vault kept in git: the Changes list of a Session working in it names the files it changed, private ones included (DIFF). A Private folder covers Lookout's lists of documents and its reader.
- An Artifact or a Share made from a note that was later moved keeps its row, with the path it was made from.
- A settings file that can't be read hides nothing until it's mended, and only the server's log says so (PEOPLE-2.10).
- A second Lookout server on the same settings file hears of a change at its next start, as with every setting. A Report named before its title's file was kept with it (any from before this slice) and made private while its server was stopped keeps that title until the list next changes; its documents and the file itself are refused all the same.
- A Topic's summary written before a folder became private can still name a note in it: the summary was written from the Output titles of its day, and it is kept until it is written again.
- A change that comes from the disk alone (a folder found at a new place) reads the lists again but doesn't make an open Document view or Report ask again; the file routes refuse the file from then on.
- A list drawn before the disk said where an entry's folder really is (a volume mounted in the last 10 s) can name a file recorded at its physical path until its next read; the file routes refuse it as soon as the disk has answered.

## Open questions

- [ ] Should the People place hide while you share your screen? Not blocking: Private folders cover the review notes, and the place holds what the notes app shows too.

## Changelog

- 2026-11-27: Created after Dario pointed at the notes folder he keeps in Obsidian as the place for people and meeting data, and for Reports, with its path a setting (decision 0018). Three answers the same day: a Report can go to the Vault now; Private folders as a list in Settings; a Person's Goals in a folder of quarterly notes inside their own. Then four forks, each as recommended: review notes move into a subfolder per Person; a Goal is a checklist item; people first and meetings later; Private folders before the People page. Ready.
- 2026-11-27: Slice 1 built (PEOPLE-1, PEOPLE-2): `shared/private-folders.ts` (an entry's parse and the matcher), `server/private-folders.ts` (the rule with physical paths, asked at every read), the two settings, Settings' Vault section (`VaultSettings.tsx`), and the rule asked in the Library's read, the file routes, a Report's text route and the path check. Every `(test)` and `(e2e)` criterion of the slice is ticked on its tests (PEOPLE-2.7 in a World). In Progress. Decided in building: a settings file edited by hand keeps its good entries when one is bad, since falling back to an empty list would show every private file; a disk too slow to say where a folder really is leaves its files private until it answers; the part of an entry before its first `*` is resolved on disk too, so a symlink on either side still meets. Tried on the real Library through a development server with a settings file of its own: one entry for the review cycles took the 69 listed files to none, and one of their paths from 200 to 404. PEOPLE-2.8, the section's look, was seen there in light and dark at 1440 px and waits for Dario's own look.
- 2026-11-27: After a review of slice 1 (Opus 5.5, 14 findings), before it shipped. Fixed: a Report kept a private note's heading as its title, and a Topic view its Output lines, after the folder became private (PEOPLE-2.6 now names both, an open Document view and Report too); every settings save, a Session start included, dropped the Library's reads (the rule now tells its listeners only when it changed); an entry's resolved form was worked out once and lost for good when the disk was slow or the folder not made yet (PEOPLE-2.3: kept, a missing part as written, asked again every 10 s); a file that is itself a symlink into a Private folder was listed with the note's heading (PEOPLE-2.3: the file's own link is resolved); a `*` also matched file names, and `/*` hid everything (PEOPLE-2.1, 2.2); an entry of many `*` could stall the server (the matcher uses no expression). New: PEOPLE-2.9, a note moved into a Private folder leaves no gone row under its old name; PEOPLE-2.10, what a settings file edited by hand keeps. PEOPLE-1.1, 1.2 and 2.2 reworded to what the code does. Known gaps added for what stays open.
- 2026-11-27: After the review's second round, which found three problems in the first round's fixes. A run finishing while the list changed could still arrive named after a private note: it now reads its Outputs again when the rule moved meanwhile. A place the disk had answered for an entry was forgotten while its link pointed nowhere, opening up to 10 s after a volume came back: every place is kept until the settings change (PEOPLE-2.3). A restart could read every Report again and, on a failed read, leave them all with their Bot's name: a Report now keeps the file its title was read from, a private title is taken back from that path with no read of the Library, a failed read leaves the others alone, and the disk's first answer after a change tells no one (PEOPLE-2.6). Also: an open Topic view asks for the new read itself; a title is never read through a link (LIB-2.12); a listener that throws fails no save and no read. Still not covered by a test: that the server passes the rule to the path check (the unit tests cover the check, and no World has a live Session to click a link in).
