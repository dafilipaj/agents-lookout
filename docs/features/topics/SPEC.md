---
title: "Topics"
code: "TOPIC"
status: "In Progress"
created: "2026-10-30"
updated: "2026-10-31"
---

# Topics

## Summary

A Topic is a wrapper for one piece of your work: the Sessions that worked on it, its PR, its Task and, once `tb-flow` exists, its run, all of them or some of them, plus your notes. A research Topic is Sessions and notes; a feature Topic has everything. You make Topics by hand and put things in them from where you already see them: a Work row, a History result, a Library row, the Session header. A recommendation queue proposes what else belongs, first from Work's Links and then from Jev, and nothing is added until you accept. A Topics tab lists them, a Topic view in the main pane shows one whole, with a summary a model writes when you ask, and a graph shows Topics as nodes with the Edges you draw. Lookout keeps Topics in its own SQLite database; it never writes to Productive or GitHub.

## Problem

- **A piece of work has no home.** Its Task and its PR are in Work, and the Session that opened the PR is Linked there (WORK-4.2). The Session that specced it, the two that reviewed it and the one that fixed CI are not: WORK-4.6 Links only the inferred opener and the Sessions started on the item, and "every Session involved" (Gap 2, WORK Later) is a tb-session change that may never be precise. Finding them means History searches, several times a day.
- **Two lists, no record** (Dario, 2026-10-30): Tasks link to Sessions and PRs, PRs link to Sessions and Tasks, but they sit in two lists, and there is no personal record of a piece of work besides your memory and the Transcripts on disk.
- **Links are guesses, and they go away.** The opener is inferred and can be wrong (WORK Known gaps). Links are recomputed on every read and never kept (WORK-4.9; `server/work.ts` holds them in memory). When the PR merges and the Task closes they leave Work (WORK Non-goals), and every Link with them.
- **Work across pieces has no shape.** A CRM milestone is three Tasks, five PRs and a dozen Sessions over two weeks; a spec Session feeds two implementation Sessions in two repos. Nothing in Lookout says which belongs with which. The header chips tried to put a Session's Task and PR in the main pane and were dropped as too clunky (Backlog, 2026-10-27): the Link had to be recomputed every time a Session showed.
- **Measured** (WORK, 2026-10-19; HIST, 2026-10-16): 6 of 9 open Tasks had a PR with a Linked opener; 10 of 13 open PRs had exactly one Session that mentioned them; 150 of the last 300 Sessions started in `~/Projects/work` on `main`, so a Session's branch and directory say nothing about what it is for ("Session → Task by branch": 0 of 300).

## Requirements

Slices, in build order: **1** TOPIC-1 to TOPIC-4 and TOPIC-8 (the store, the tab, adding from rows, Topic chips on rows); **2** TOPIC-9 (recommendations: Links first, then Jev); **3** TOPIC-6 and TOPIC-7 (Edges and the graph); **4** TOPIC-10 (the Topic view); **5** TOPIC-11 (a summary of the Topic, written by `claude -p` with Sonnet); **6** TOPIC-5 (the launcher, with the summary as its brief). The run member kind (TOPIC-2.6) waits in the Backlog for `tb-flow`. IDs are fixed from here on (writing rule 1).

### TOPIC-1 A Topic

A Topic has a title, notes, members (TOPIC-2), Edges (TOPIC-6) and a state, Open or Archived. It has no type, steps or gates (Non-goals): what kind of Topic it is follows from what's in it.

- [x] TOPIC-1.1 "New Topic" in the Topics tab (TOPIC-3) asks for a title and makes an Open Topic with no members. The title is trimmed, must not be empty, and is cut to 120 characters. A Topic gets an id Lookout generates, never reused. (test)
- [x] TOPIC-1.2 The Topic view's (TOPIC-10) title can be edited in place, and its notes in a text area under it: Markdown, at most 20,000 characters, rendered with the chat's Markdown component when not being edited, saved on blur or ⌘Enter, with "Saved" for 2 s. Saving empty notes clears them. (test)
- [x] TOPIC-1.3 "Archive" moves a Topic out of the default list and keeps its members, notes and Edges; "Unarchive" brings it back. An "Archived" toggle in the tab shows them. (test)
- [x] TOPIC-1.4 "Delete" removes the Topic, its memberships, its Edges and its recommendations after a confirmation naming the Topic. Nothing else is touched: no Session, PR, Task, run or Output is changed, closed or deleted. (test)
- [x] TOPIC-1.5 A Topic whose every PR member is no longer on tb-pr's board and whose every Task member is no longer in Tasks, with at least one of either, shows "looks done" as an info chip. Lookout never archives it on its own. (test)

### TOPIC-2 Members

A member is a reference to something a Building block knows: a Session (its Harness and `session_id`), a PR (its URL), a Task (its id) or, in slice 4, a run (its `tb-flow` id). Outputs aren't members; they come with their Sessions (TOPIC-4.4).

- [x] TOPIC-2.1 An expanded Work row (WORK-2.9, WORK-3.6), History result (HIST-2.9) and Library row (LIB-3.2) has an "Add to Topic" button that opens the Topic picker: Open Topics, most recently changed first, with "New Topic…" at the end. Picking one adds the row's item (a Task, a PR, a Session, or a Library row's Sessions) and closes the picker. `A`, with focus in that panel and not in a text field, opens the picker for the selected row. (test)
- [x] TOPIC-2.2 The Session header (VIEW-5) has the same button for the current Session, and a past Session opened read-only (HIST-3.3) has it too. A Session whose id is `<harness>:<pid>` (a Codex Session before its first prompt, SIDE Technical approach) can't be added: the button is disabled and its tooltip says why. (test)
- [x] TOPIC-2.3 Adding stores the reference and a snapshot of what Lookout knew at that moment: a Session's Harness, title and start directory; a PR's repo, number, title and URL; a Task's title, project and URL. The snapshot is what shows when the source no longer lists the item (TOPIC-4.2). Adding an item that's already a member changes nothing and says "Already in <Topic>". (test)
- [x] TOPIC-2.4 An item can be in any number of Topics. "Remove" on a member in the Topic view (TOPIC-10.4) removes that membership and nothing else. (test)
- [x] TOPIC-2.5 A Work row, a History result and a Library row whose item (for a Library row, any of its Sessions) is a member of a Topic shows each such Topic's title as a chip in its expanded row; a click on the chip opens the Topics tab on that Topic. The collapsed row shows no chip (WORK-6.1's rule: collapsed rows stay bare). (test)
- [ ] TOPIC-2.6 A run member (slice 4) is a `tb-flow` run id with its workflow name and brief as the snapshot; it shows as a line with the run's state from `tb-flow show --json` when that command exists, else its snapshot. Until `tb-flow` exists this kind is refused by the server. (test)

### TOPIC-3 Topics tab

A fourth tab in the right sidebar, after Library (LIB-1.1).

- [x] TOPIC-3.1 With focus not in a text field and no modal open, `T` opens the sidebar on Topics, switches to it from another tab, and closes the sidebar when Topics is showing, as `H`, `W` and `L` do. The closed rail has a Topics button under Library's; ←/→ on the tab strip reach it. The tab, the width and the open state are remembered with the others (WORK-1.2). (test)
- [x] TOPIC-3.2 The tab lists Open Topics, most recently changed first (a membership, Edge, title or notes change), each with its title, its member counts by kind ("2 Sessions · 1 PR · 1 Task") and a Session marker as WORK-2.4 draws it: the most urgent live member Session's Status, else the past marker, else nothing. A text filter matches titles and notes. (test)
- [x] TOPIC-3.3 Select, then act (HIST-3.5, WORK-1.12, LIB-3.1): a click or Enter selects and expands one Topic in place; Esc collapses it; ↑/↓ and j/k move without acting; nothing opens, resumes or starts on a click. (test)
- [x] TOPIC-3.4 An expanded Topic is a summary; the whole Topic is its view (TOPIC-10). It shows the notes' first three lines, rendered, with no "more" or "Edit"; its live member Sessions as chips and how many past ones it has ("+4 past"); and the buttons, in this order: "Open" (TOPIC-10), "Open graph" (TOPIC-7), "Link to Topic…" (TOPIC-6), "Archive" (or "Unarchive"), "Delete" (TOPIC-1.4). A Session member is a chip as WORK-4.10 (Harness icon, title, Status colour; Open, Resume or Show by what the Session is, LIB-3.5). Enter on an expanded Topic runs "Open", never Archive or Delete. (test)
- [x] TOPIC-3.5 The Session sidebar's filter (SIDE-2.13) also matches the titles of the Topics a live Session is in; the rows themselves show no Topic (Non-goals). (test)
- [x] TOPIC-3.6 Loading, empty and error states are the design system's (DS-6.3, DS-8.1, DS-4): "No Topics yet" with "New Topic", "Nothing matches" under a filter, and a failed read or write of the store as an error Alert with its reason. (test)
- [x] TOPIC-3.7 The expanded Topic's layout, notes rendered and in edit, holds at a 280 px sidebar, light and dark. (manual)

### TOPIC-4 What a member is doing now

A Topic reads nothing of its own. A member's current state comes from what Lookout already holds: Fleet's Session list, Work's last read and the Library's last read.

- [x] TOPIC-4.1 A Session member is live when Fleet's list has its id (HIST-3.2), and its Status follows the list. A PR or Task member shows the state and CI from Work's last read when it's there. (test)
- [x] TOPIC-4.2 A member Work's last read doesn't list shows its snapshot (TOPIC-2.3) with a "not in Work" chip, whose hover says that Work lists open items only, so the item may be merged, closed or not read yet. A Session tb-session no longer has (pruned, LIB-2.6) shows its snapshot with "removed from the index" and no button. Nothing is read to find out more (Non-goals). (test)
- [x] TOPIC-4.3 While any tab has Topics open, Work's reads run as if Work were open (WORK-8.1): the same schedule and the same one read per source, so a Topic's PR and Task members are at most 5 minutes old. Opening Topics before anything was read shows "Loading" on those members until the first read lands. (e2e)
- [x] TOPIC-4.4 The Topic view (TOPIC-10) lists the Outputs any of its Session members touched, from the Library's last read (LIB-2.11's Sessions per Output), newest first, at most 10, then "+N more", which opens the Library filtered to those Sessions. Each is a Library row's first line with its Open button (LIB-3.3). Opening the view asks for a Library read, as opening the Library does (LIB-2.7), when none has run in the last minute, so Outputs its Sessions wrote since show without opening the Library. (test)

### TOPIC-5 Start a Session in a Topic (slice 6)

- [ ] TOPIC-5.1 "Start Session" in the Topic view's header (TOPIC-10.2) opens the launcher (LAUNCH-1) pre-filled as WORK-5.1 does: the prompt is the summary's `what`, `state`, `open` and `next` (TOPIC-11.4) when it has one that isn't out of date, else the notes' first paragraph; then one line per Task member's URL, then `Topic: <id> <title>` as its own last line. Nothing starts until you press Start, and you can edit it first. (e2e)
- [ ] TOPIC-5.2 A Session Lookout started from a Topic is added to it when Fleet reports it, with the reason "started from this Topic". One started from a Task's "Start Session" (WORK-5.1), while that Task is a member of exactly one Open Topic, is added to that Topic too. No other Session is added on its own: everything else goes through a recommendation (TOPIC-9). (e2e)
- [ ] TOPIC-5.3 The launcher opened with N, ⌘N or "+" has an optional "Topic" field listing Open Topics; a Session started with one picked is added as TOPIC-5.2 says. LAUNCH-1.3's draft rules apply. (test)

### TOPIC-6 Edges (slice 3)

An Edge goes from one Topic to another. You draw it; it has a direction and an optional label that reads from the first Topic to the second ("Rates table" part of "Proposals v2").

- [x] TOPIC-6.1 "Link to Topic…" on an expanded Topic or in the Topic view opens the Topic picker (TOPIC-2.1's, without "New Topic…") and makes an Edge from it to the chosen Topic, with an optional label of at most 60 characters. Two Topics have at most one Edge, whichever way it goes: linking them again says "Already linked", and a Topic can't be linked to itself. (test)
- [x] TOPIC-6.2 An Edge shows in both Topics' views (TOPIC-10.5), as "→ <other Topic> (<label>)" on the one it starts from and "← <other Topic> (<label>)" on the other; "Reverse" on either turns it around, and "Unlink" on either removes it. Deleting a Topic removes its Edges (TOPIC-1.4). (test)
- [x] TOPIC-6.3 Two Topics that share a member show, in their views, a dashed "shared: <item>" line on each, as a suggestion, never stored and with no direction; "Link" on it makes an Edge from the Topic it's clicked on. (test)

### TOPIC-7 The graph (slice 3)

A main-pane view at `/topics`, in place of the Session view while it's open, like the past-Session view (HIST, `/h/…`) and Settings: the Session sidebar and the right sidebar stay, and selecting a Session leaves it.

- [x] TOPIC-7.1 "Open graph" in the tab or the Topic view, or `G` with focus in Topics, shows the graph: one node per Open Topic (Archived ones behind the same "Archived" toggle) with its title and Session marker, and an arrow per Edge, from its first Topic to its second, with its label. The selected Topic's node is marked, and selecting a node selects the Topic in the tab. A reload keeps the view. (test)
- [x] TOPIC-7.2 Nodes are dragged into place; a node's position is stored with its Topic (TOPIC-8) and kept across reloads. A node with no position is placed by a one-shot layout that avoids the others; "Arrange" lays every node out again, after a confirmation. (test)
- [x] TOPIC-7.3 A node expands on a click to its members, drawn as small nodes around it with their kind's icon and, for a Session, its Status marker. A click on a member node does what its chip does (TOPIC-3.4); Esc collapses the node. (test)
- [x] TOPIC-7.4 An Edge is drawn by dragging from a node's handle onto another node, which makes it from the first to the second as TOPIC-6.1 does; a click on an Edge's label edits it, reverses it or unlinks. (test)
- [ ] TOPIC-7.5 Nodes, lines and labels use the design system's tokens and type steps (DS) and lucide's icons (0008); the view stays readable at the main pane's width with 30 nodes, light and dark. (manual)
- [x] TOPIC-7.6 With no Topic, the view shows "No Topics yet" and "New Topic" (DS-8.1). (test)

### TOPIC-10 The Topic view (slice 4)

A main-pane view at `/topics/<id>`, in place of the Session view while it's open, like the graph (TOPIC-7): the Session sidebar and the right sidebar stay, and selecting a Session leaves it. It holds the whole Topic at the main pane's width; the tab's expanded Topic is its summary (TOPIC-3.4).

- [x] TOPIC-10.1 "Open" on an expanded Topic, Enter on it, a double-click on a graph node, or Enter on an expanded graph node opens that Topic's view, and the Topic is selected in the tab. A reload keeps the view. An id no Topic has (deleted, or never made) shows "This Topic is gone" with "Open graph" (DS-8.1); a store that can't be opened shows TOPIC-3.6's error. (test)
- [x] TOPIC-10.2 The header: the Topic's Session marker, its title (edited in place, TOPIC-1.2), "archived" and "looks done" (TOPIC-1.5), its member counts, then "Open graph", "Link to Topic…", "Archive" (or "Unarchive") and "Delete"; "Start Session" goes first once TOPIC-5 is built. Delete asks as TOPIC-1.4 does, then shows the graph. (test)
- [x] TOPIC-10.3 The notes in full, rendered at the view's width, with no six-line cut; "Edit" and saving follow TOPIC-1.2. (test)
- [x] TOPIC-10.4 The members in sections, "Sessions", "PRs" and "Tasks", each headed with its count and only when it has any. A member is drawn as TOPIC-3.4 and WORK's rows draw it, with its state (TOPIC-4.1, TOPIC-4.2), its button and "Remove" (TOPIC-2.4). Sessions: the live ones first, most urgent Status first (DS-5.3), then the rest; PRs and Tasks: the ones in Work's last read first, then the rest; newest added first within each. (test)
- [x] TOPIC-10.5 Under the members, its pending recommendations (TOPIC-9.4), its Outputs (TOPIC-4.4) and its Edges with their shared-member lines (TOPIC-6.2, TOPIC-6.3). While the view shows, Work's reads run as TOPIC-4.3 says for the tab. (test)
- [ ] TOPIC-10.6 The view reads well from a 480 px main pane to a wide one, with 46 members, light and dark. (manual)

### TOPIC-11 A summary of the Topic (slice 5)

A summary is text a model writes about a Topic from what Lookout already knows of it: what the work is, where it stands, what's open, what happened last and what's likely next, each point naming the members it comes from. It's kept apart from the notes, which stay yours, and is rewritten whole each time. It runs only when you ask.

- [x] TOPIC-11.1 The Topic view (TOPIC-10) has a "Summary" section between its header and the notes, with "Summarize" while the Topic has none and "Summarize again" once it has one. Nothing writes a summary on its own: not on a poll, not when a member is added, not when the view opens. (test)
- [x] TOPIC-11.2 A summary is one `claude -p` run with Sonnet (decision 0013), with no tools, no MCP servers, no skills or slash commands, no settings files and no saved session, from an empty directory Lookout owns: text in, one structured answer out. It's cut off at 120 s and at $0.50 (`--max-budget-usd`). (test)
- [x] TOPIC-11.3 Its input is what Lookout already holds, plus one `tb-session show` per Session member: the Topic's title, notes and Edges (the other Topics' titles and labels); each member with a short key (`S1`, `PR1`, `T1`), its snapshot, its live state (a Session's Status, a PR's state and CI, a Task's status, or "not in Work") and when it was added; for each Session, tb-session's summary, branch, message count, last active time, first prompt (its first 600 characters) and last assistant message (its first 1,200); the Outputs (titles, types and ages, at most 20). It's at most 60,000 characters: past the limit, the Sessions least recently active lose their last messages first, then their first prompts. No Transcript is read whole. A Session tb-session no longer has is sent with its snapshot. (test)
- [x] TOPIC-11.4 The answer has a fixed shape (`--json-schema`): `what` (one or two sentences), `state` (`not started`, `in progress`, `blocked`, `waiting` or `done`) and `why` (one sentence), `open`, `recent` and `next` (each a list of points). Each point cites members by their keys; the view shows a cited member as its chip or line's name, and a click does what that chip or line does (TOPIC-3.4). A key the input didn't have is dropped from the point. (test)
- [x] TOPIC-11.5 A summary is stored with its Topic: the answer, when it was written, the model that wrote it (as `claude -p` reports it), its cost and a fingerprint of the Topic's members and notes at that moment. Once a member is added or removed or the notes change, the section shows "Out of date" (an info chip, DS-3.3) by the summary's age; a Status, CI or Task status change doesn't. Deleting the Topic deletes its summary (TOPIC-1.4). (test)
- [x] TOPIC-11.6 While a summary is written, the section shows "Summarizing…" with "Cancel", which stops the run; every tab sees it running. One run per Topic at a time, at most two at once. A run that fails, is cut off, is cancelled or answers something Lookout can't read leaves the stored summary as it was and shows why as an error Alert in the section, with one redacted log line (WORK-7.7's rules); a `claude` Fleet can't find (TOOLS-1.2) says "not installed" with TOOLS' fix. (test)
- [x] TOPIC-11.7 Under the summary, a line says who wrote it and what it cost: "Sonnet 5.5 · $0.04 · 2h ago". (test)
- [x] TOPIC-11.8 The tab's expanded Topic (TOPIC-3.4) shows the summary's `what` and `state` above the notes' lines while it has one, with "Out of date" when it is. (test)
- [ ] TOPIC-11.9 The Summary section reads well in the Topic view at its widths, light and dark, with a 46-member Topic's summary. (manual)

### TOPIC-8 Storage

- [x] TOPIC-8.1 Topics live in one SQLite database the server owns, `~/.lookout/topics.db`, opened through Node's `node:sqlite` with no dependency, in WAL mode, the directory 0700 and the file 0600 (as `~/.lookout/attachments/` is made). A `schema_version` table says which schema wrote it; a database from a newer schema is refused with a reason in the tab (TOPIC-3.6), never migrated down or overwritten. Every change goes through the server's API; the browser stores nothing but which Topic is selected. (test)
- [x] TOPIC-8.2 The tables: `topics` (`id`, `title`, `notes`, `state`, `created_at`, `updated_at`, `pos_x`, `pos_y`), `members` (`topic_id`, `kind`, `ref`, `snapshot`, `added_at`, `reason`; one row per Topic, kind and ref), `edges` (`from_id`, `to_id`, `label`, `created_at`; one row per pair of Topics, whichever way it goes), `candidates` and `recommendations` (TOPIC-9.6), and `summaries` (TOPIC-11.5, schema 3). A `ref` is `{harness, sessionId}`, `{url}`, `{id}` or `{runId}` by kind, stored as JSON text with its keys in a fixed order so it compares as a string. (test)
- [x] TOPIC-8.3 The server sends the whole set as a `topics` event on `/api/events` to every tab when it changes, and in the snapshot; a change made in one tab shows in the others within a second. Mutations (`POST`, `PUT`, `DELETE` under `/api/topics`) check the token and Origin as every mutation does (0003). (test)
- [x] TOPIC-8.4 A write that fails leaves the database as it was (one transaction per mutation) and answers with a plain reason, shown as an error Alert in the tab. A database that can't be opened at start leaves the tab with that reason and the rest of Lookout working. (test)

### TOPIC-9 Recommendations (slice 2)

A recommendation is a proposed membership: an item that showed up, and the Open Topic it probably belongs to, or a new Topic. Links come first and cost nothing; Jev (`tb-jev ask`) judges what Links can't tie. Nothing is added until you accept.

- [x] TOPIC-9.1 A candidate is an item new to Lookout that is in no Topic: a Session that joins Fleet's list with a `session_id` (never a `<harness>:<pid>` one, and never one Lookout itself added by TOPIC-5.2), and a PR or Task that appears in Work's read. Each item is a candidate once, however often it's seen again; one judged, accepted or dismissed is never judged again, and "Judge again" on it is the one way back. (test)
- [x] TOPIC-9.2 Links first: a candidate that Work's Links tie to a member of exactly one Open Topic (a Session Linked to a member PR or Task, WORK-4.2 to 4.4; a PR Linked to a member Task or the reverse, WORK-4.1) becomes a recommendation for that Topic with the Link's reason (WORK-4.5), with no Jev call. Tied to members of several Topics, it becomes one recommendation per Topic. (test)
- [x] TOPIC-9.3 Jev second: a candidate Links can't tie is judged by one `tb-jev ask` while Jev is ready (USAGE-1.4) and "Recommend Topics with Jev" is on in Settings (off by default): a `choice` question whose choices are the Open Topics, `new` and `none`, and whose state is the candidate's text and each Open Topic's title, notes and member titles (Technical approach, Jev). The pick becomes a recommendation only when its confidence is at least 0.6; `new` proposes a Topic titled after the item; `none`, a lower confidence, a timeout or an error leaves nothing and marks the candidate judged. Only candidates first seen while the switch is on are asked: turning it on never judges the ones that came while it was off, though Links still tie them (TOPIC-9.2), and "Judge again" asks for one of them. Asks run one at a time, at most 30 an hour, never on a poll and never for a Topic set with no Open Topic; the switch's hover says each ask is billed and how many ran today. (test)
- [x] TOPIC-9.4 Pending recommendations show at the top of the Topics tab under "Recommended", newest first, each with the item as its row would look (title, kind, marker), the Topic or "New Topic: <title>", and the reason: the Link's words, or "Jev, 82%". Each has "Accept", "Other Topic…" (the Topic picker) and "Dismiss"; Accept adds the member with the reason recorded ("from a Link", "from Jev, accepted") or makes the Topic and adds it. The Topic view repeats its own pending ones (TOPIC-10.5). The closed rail's Topics button shows the pending count; the open tab's title too. (test)
- [x] TOPIC-9.5 Nothing is added, made or archived by a recommendation on its own; Dismiss records the item as dismissed for that Topic. (test)
- [x] TOPIC-9.6 Two tables, so a restart loses nothing and an item is never asked twice. `candidates` holds one row per item, keyed by `kind` and `ref`: `first_seen`, `jev` (`waiting`, `asked` or `off`: first seen while the switch was off, TOPIC-9.3), `judged_at` and `outcome` (`link`, `jev` or `none`). `recommendations` holds one row per item and proposal: `kind`, `ref`, either `topic_id` or `new_title`, `source` (`link` or `jev`), `confidence`, `reason`, `created_at` and `status` (`pending`, `accepted`, `dismissed`); an item has at most one row per Topic and at most one "New Topic" row. (test)
- [x] TOPIC-9.7 A failed or slow `tb-jev ask` (exit, timeout, output Lookout can't read) is one redacted log line (WORK-7.7's rules) and leaves the candidate judged with `none`; the switch stays on. A tb-jev that isn't ready stops the asks and the Settings switch says so, with USAGE's fix. (test)

## Non-goals

- **Writing to Productive or GitHub**, as WORK: a Topic never changes a Task or a PR.
- **Adding anything without you.** Lookout never creates a Topic or adds a member on its own from a Link, a branch, a directory, a mention or a Jev answer; the two exceptions are the Sessions Lookout itself starts from a Topic, or from a Task that's in exactly one Open Topic (TOPIC-5.2). Everything else is a recommendation you accept.
- **A lifecycle with steps, gates or a recipe.** That's a run of a workflow: the FLOW idea and `tb-flow` (Backlog). A Topic wraps a run; it isn't one.
- **A type on a Topic.** What's in it says what it is: a research Topic has Sessions and notes, a feature Topic has everything.
- **Nested Topics (parent and child).** An Edge labelled "part of" says it; a tree can come once the graph exists.
- **Outputs, Worktrees or files as members.** Outputs come through Sessions (TOPIC-4.4); a Worktree is a Session's attribute (SIDE-2.2); the notes are the one piece of text.
- **Reading closed Tasks or merged PRs.** No `tb-pr show` or `tb-prod get` per member: the snapshot stands in (TOPIC-4.2).
- **A Topic on Session sidebar rows.** Rows show what varies (SIDE-2); the filter matches it instead (TOPIC-3.5).
- **A Topics CLI or a shared "personal knowledge" Building block.** Topics are Lookout's own store (0010), as Lookout is Dario's own UI; making the idea unopinionated and shareable is a later, secondary question (Dario, 2026-10-30), and the brain's lore and jobs stay where they are.
- **Jev on a poll or on every Session.** One ask per new item, bounded (TOPIC-9.3); never `tb-jev doctor` (USAGE).
- **Sharing, other Hosts, an export.**
- **Auto-layout as the default.** Positions are yours; "Arrange" is a button.
- **A summary written on its own, or edited.** A summary runs when you press the button (TOPIC-11.1) and is rewritten whole; what you want to keep goes in the notes. No summary per Session either: that's brief generation (Plan item 23).
- **A summary with tools.** It reads nothing itself: no files, no `gh`, no Productive. What it knows is what Lookout gives it (TOPIC-11.3).

## UX

```
┌───────────────┬──────────────────────────────────┬────────────────────────────────┐
│ / filter  + ⚙ │ header (VIEW)                    │ [History][Work][Library][Topics 2]│
├───────────────┼──────────────────────────────────┼────────────────────────────────┤
│ Sessions      │ main pane (VIEW)                 │ [ filter…          ] ☐ Archived│
│               │                                  │ [+ New Topic]  [⌗ Open graph]  │
│               │                                  │ Recommended                    │
│               │                                  │ ✳ fix-ci → Proposals rates     │
│               │                                  │   started on PR #812           │
│               │                                  │   [Accept] [Other Topic…] [Dismiss]│
│               │                                  │ ◎ rates-eval → New Topic: rate…│
│               │                                  │   Jev, 71%                     │
│               │                                  │ Topics                         │
│               │                                  │ ● Proposals rates              │
│               │                                  │   3 Sessions · 2 PRs · 1 Task  │
│               │                                  │ ○ Lookout topics spec          │
│               │                                  │   1 Session                    │
├───────────────┼──────────────────────────────────┤                                │
│ usage (USAGE) │ composer and status line (VIEW)  │                                │
└───────────────┴──────────────────────────────────┴────────────────────────────────┘
```

An expanded Topic (TOPIC-3.4) grows in place to a summary, as the other tabs' rows do:

```
│ ● Proposals rates                        │  ← selected, expanded
│   3 Sessions · 2 PRs · 1 Task            │
│   Port the rates table to Fantastic,     │
│   then the proposal totals. Rounding:    │
│   half up, as the invoice does.          │  ← notes, three lines
│   [✳ rates-port ●] +2 past               │  ← live Sessions
│   [↗ Open] [⌗ Open graph]                │
│   [⇄ Link to Topic…] [⊟ Archive] [Delete]│
```

The Topic view (TOPIC-10), in the main pane at `/topics/<id>`:

```
┌──────────────────────────────────────────────────────────────┐
│ ● Proposals rates   looks done        [⌗ Open graph] [⇄ Link…]│
│   3 Sessions · 2 PRs · 1 Task              [⊟ Archive] [Delete]│
├──────────────────────────────────────────────────────────────┤
│ Port the rates table to Fantastic, then the proposal totals.  │
│ Rounding: half up, as the invoice does. …              [Edit] │
│                                                               │
│ Sessions 3                                                    │
│   [✳ rates-port ●]  [✳ spec ○]  [◎ review-812 ○]               │
│ PRs 2                                                         │
│   ✓ fantastic #812 draft · Rates table          [Open on GitHub]│
│   ✓ api #4410 · not in Work                     [Open on GitHub]│
│ Tasks 1                                                       │
│   ● Rates table port · In progress           [Open in Fantastic]│
│ Recommended  ✳ fix-ci · started on PR #812  [Accept] [Dismiss]│
│ Outputs      ▤ Rates port doc · 5h                     [Open] │
│ Edges        → Proposals v2 (part of)       [Reverse] [Unlink]│
└──────────────────────────────────────────────────────────────┘
```

A Topic view's Summary section (TOPIC-11), between the header and the notes:

```
│ Summary                                  Out of date  [↻ Summarize again] │
│   Port the Proposals screens from Ember to Fantastic, part by part.       │
│   In progress: the send dialog and e-mail send are open in review.        │
│   Open   · Cancel closes the send dialog on the first click [PR #2902]    │
│          · Approval policy data model has no Task yet [S14]               │
│   Recent · PDF popup fixed and merged [PR #2610] [S21]                    │
│   Next   · Review PR #2888 after #2902 merges [PR #2888] [T3]             │
│   Sonnet 5.5 · $0.04 · 2h ago                                             │
```

The graph (TOPIC-7), in the main pane at `/topics`:

```
┌──────────────────────────────────────────────────┐
│ Topics                         [Arrange] [+ New] │
│                                                  │
│      ┌──────────────┐  part of   ┌─────────────┐ │
│      │ ● Proposals  │───────────▶│ ○ Proposals │ │
│      │   rates      │            │   v2        │ │
│      └──────┬───────┘            └─────────────┘ │
│             ┆ shared: api #4410                  │
│      ┌──────┴───────┐                            │
│      │ ○ CRM backlog│                            │
│      │   audit      │                            │
│      └──────────────┘                            │
└──────────────────────────────────────────────────┘
```

- **Shortcuts** (none with a modifier, all ignored in a text field or while a modal is open): `T` the Topics tab (TOPIC-3.1); `A`, in Work, History or Library, "Add to Topic" for the selected row (TOPIC-2.1); `G`, in Topics, the graph (TOPIC-7.1); Enter on an expanded Topic, its view (TOPIC-10.1); `O` and `S` keep their meanings inside Topics, on the selected Topic's first PR or Task and its first Session chip. `T`, `A` and `G` are unused today.
- **Markers:** the Session marker as WORK-2.4 and DS-5.3; the past marker for past Sessions only. "Not in Work" and "looks done" are info chips (DS-3.3), never amber or green. A recommendation's count on the rail button is a neutral count, not Needs you's amber.
- **Pickers:** the Topic picker is a small modal list with a filter; Enter picks, Esc closes. One component serves "Add to Topic", "Other Topic…" and "Link to Topic…".
- **Notes:** rendered with the chat's Markdown component; the text area is the composer's look (VIEW-3); ⌘Enter saves, Esc cancels an edit.
- **Settings:** a "Recommend Topics with Jev" switch under the Productive email, off by default, with "Each judgment is a billed Jev call; at most 30 an hour. 12 ran today." under it, and USAGE's "not set up" fix when Jev isn't ready.
- **Errors:** a database that can't be opened or written is an error Alert at the top of the tab with the reason and the file's path; a refused write the same, under the control that asked.
- **Empty:** "No Topics yet" with "New Topic", in the tab and in the graph; "Recommended" shows only while something is pending.

## Technical approach

Nothing new is read from a Building block for a Topic's members. Fleet's `list` (SIDE), Work's snapshot (`WorkSnapshot`, `shared/work.ts`) and the Library's held read (LIB-2.1) already carry every member's live state; a Topic joins them by reference. The one new call is `tb-jev ask`, for recommendations. Decisions that apply: [0003](../../decisions/0003-browser-first-react-stack.md) (token and Origin on mutations), [0005](../../decisions/0005-building-blocks-live-outside-lookout.md) and [0010](../../decisions/0010-single-consumer-rules-stay-with-the-consumer.md) (Topics are one consumer's rule and store), [0008](../../decisions/0008-lucide-icons-only.md), [0009](../../decisions/0009-one-design-system-guarded-by-tests.md).

- **The store** (`server/topics.ts`, a `TopicStore`): `node:sqlite`'s `DatabaseSync` on `~/.lookout/topics.db`, synchronous, one transaction per mutation, `PRAGMA journal_mode=WAL`, `foreign_keys=ON`. Lookout's `engines` is Node 25, where `node:sqlite` is built in and needs no package; it still prints `ExperimentalWarning` once, which the server silences for that one warning at start (`--disable-warning=ExperimentalWarning`, Known gaps). Tens of Topics and hundreds of rows are tiny; SQLite is chosen for the record keeping (TOPIC-9.6's judged-once rule, counts, "never asked twice") and for growing without a rewrite of one JSON file. Ids are random (`crypto.randomUUID()`), never a slug: a title changes, an id doesn't.

  ```sql
  create table schema_version (v integer not null);
  create table topics (id text primary key, title text not null, notes text not null default '',
    state text not null check (state in ('open','archived')), created_at integer not null,
    updated_at integer not null, pos_x real, pos_y real);
  create table members (topic_id text not null references topics(id) on delete cascade,
    kind text not null check (kind in ('session','pr','task','run')), ref text not null,
    snapshot text not null, added_at integer not null, reason text not null,
    primary key (topic_id, kind, ref));
  create table edges (from_id text not null references topics(id) on delete cascade,
    to_id text not null references topics(id) on delete cascade, label text, created_at integer not null,
    primary key (from_id, to_id), check (from_id <> to_id));
  create unique index edges_pair on edges (min(from_id, to_id), max(from_id, to_id));
  create table candidates (kind text not null, ref text not null, first_seen integer not null,
    jev text not null check (jev in ('waiting','asked','off')), judged_at integer,
    outcome text check (outcome in ('link','jev','none')), primary key (kind, ref));
  create table recommendations (kind text not null, ref text not null,
    topic_id text references topics(id) on delete cascade, new_title text,
    source text not null check (source in ('link','jev')), confidence real, reason text not null,
    created_at integer not null, status text not null check (status in ('pending','accepted','dismissed')),
    check ((topic_id is null) <> (new_title is null)),
    foreign key (kind, ref) references candidates(kind, ref) on delete cascade);
  create unique index recommendations_topic on recommendations (kind, ref, topic_id) where topic_id is not null;
  create unique index recommendations_new on recommendations (kind, ref) where topic_id is null;
  ```

  SQLite lets a primary key column hold nulls and counts each null as distinct, so a key that includes a column that can be null never stops a second insert (checked with `node:sqlite`). Every key above is on columns that are never null, and the two kinds of recommendation get a partial unique index each. `edges_pair` keeps a pair of Topics to one Edge whichever way it points; "Reverse" swaps `from_id` and `to_id` in one update.

  A `ref` is JSON text with its keys in a fixed order (`{"harness":…,"sessionId":…}`, `{"url":…}`, `{"id":…}`, `{"runId":…}`), so the primary key compares as a string. `snapshot` is JSON text bounded on write (titles 300 characters, paths 1,024). A database whose `schema_version` is above the server's is refused and left alone; one below is migrated forward in a transaction, with the file copied to `topics.db.bak-<version>` first.
- **Member identity.** A Session is `{harness, sessionId}` (HIST passes `--harness` to `show` because one id can exist under two Harnesses); a PR its `url` as `tb-pr` gives it; a Task its Productive id; a run its `tb-flow` run id (slice 4; the server refuses the kind until the Tools table knows `tb-flow`). A Codex Session before its first prompt has only `codex:<pid>` (SIDE Technical approach, Session identity), so it can't be a member or a candidate yet (TOPIC-2.2, TOPIC-9.1). Lookout's row id (`SessionRow.id`, `shared/types.ts`) joins Fleet's list; `sessionId` joins tb-session.
- **Joining live state** happens where each snapshot already is. The server's `Topics` (`server/topics.ts`) sends the stored set as the `topics` event with each Topic's Outputs joined from the Library's last read (`Library`'s `onRead`; Outputs per Session) and the Sessions that read's events say are pruned, whether or not the Library kept their Outputs; a pruned Session with no Output events at all isn't seen. The browser joins Fleet's list (Status, live) and Work's `WorkSnapshot` (PR state, CI, Task status), which every tab already holds (`web/src/lib/topics.ts`), so a Status change doesn't resend every Topic. A member Work's read doesn't have shows its stored snapshot (TOPIC-4.2). The Links for TOPIC-9.2 are joined on the server in slice 2. Work's reads run while Topics is open through the same `PUT /api/work/watch` the Work tab uses (TOPIC-4.3): the tab says it watches, and `WorkMonitor` doesn't care which tab asked.
- **Adding from a row** sends `{kind, ref, snapshot}` to `POST /api/topics/<id>/members`; the snapshot is built in the browser from the row it already shows (a Work row's title and URL, a History result's title and start directory, a Library row's Sessions). The server keeps only the fields it knows and bounds every string.
- **Candidates (TOPIC-9.1)** come from the diffs the server already computes: Fleet's 2 s poll gaining a Session with a `session_id`, and a Work read gaining a PR or Task. Each is inserted into `candidates` once (`insert or ignore`; the `(kind, ref)` key makes a second insert a no-op), with `jev` set to `waiting` when the switch is on and `off` when it isn't. Links are checked at insert and after every Work read (Links can arrive later, WORK-4.9), for every candidate, whatever its `jev`; what Links don't tie and is `waiting` goes to the Jev queue, oldest first. "Judge again" sets `jev` back to `waiting` and clears `judged_at` and `outcome`; the recommendations already accepted or dismissed stay.
- **Jev (TOPIC-9.3).** `tb-jev ask --questions topics@1 --questions-dir ~/.lookout/jev/questions --state - --timeout-ms 3000 --caller lookout-topics --subject <kind:ref> --on-error closed --format json`, the state on stdin, found as USAGE finds tb-jev (`resolveJevBin`), through `server/exec.ts` with the cleaned environment. The question set is written by Lookout before each ask, since its choices are the Open Topics: `{ "id": "topics", "version": "1", "questions": { "topic": { "type": "choice", "instructions": "Which Topic is this item part of? Pick `new` when it is a distinct piece of work that no listed Topic covers, and `none` when it is routine or unrelated to any.", "criteria": { "<topic id>": "<title>: <notes, first 300 chars>; members: <titles>", …, "new": "A distinct piece of work no listed Topic covers.", "none": "Routine, or unrelated to every listed Topic." } } } }`. The state: `{ "item": { "kind", "title", "text" }, "topics": [{ "id", "title", "notes", "members": [titles] }] }`, where `text` is a Session's first prompt's first 600 characters (from `tb-session show --tail 1 --json`, HIST's peek route, one 0.12 s call per candidate), a PR's repo, branch, title and task ids, a Task's project, title and description (the 600 characters Work already has). The answer's `choice`, `confidence` and `probabilities` (tb-jev's `answers.topic`) become the row; below 0.6 confidence, `none`. tb-jev keeps its own decision log (`~/.local/state/tb-jev/decisions.jsonl`, never `--log-state`, so no prompt text lands in it), which is what `tb-jev replay` can later calibrate against the accepted and dismissed rows (Later). Cost: input is billed at $0.042 per million tokens and output is free (tb-jev's SKILL.md); a 4 KB state is about a thousand tokens, so a hundred asks a day cost under a cent. Latency: Jev answers in well under a second in tb-jev's own measurements; the 3 s deadline covers retries. The cap of 30 an hour is a server-side counter in memory; the switch, its hover's counts and Jev's readiness come from `UsageMonitor`'s last Jev read, never a new `status` call. Nothing here runs `tb-jev doctor` or `--version` (USAGE).
- **Starting from a Topic** (slice 4) reuses WORK-5's launcher draft (`setWorkDraft` and `openLauncher` in `App.tsx`): the prompt as TOPIC-5.1, the Harness and directory the launcher's last. The server records `{launchId → topicId}` in memory when the launch starts and adds the member once Fleet reports the Session, through the `started` pairs the snapshot already carries (LAUNCH). The `Topic: <id> <title>` line is also the one marker a Building block can see later (tb-session indexes first prompts, WORK-4.3), so a later slice can rebuild membership from it after a reinstall.
- **The Topic view** (slice 4, `TopicView.tsx`) is a main-pane route like the graph, `/topics/<id>`, drawn from the same `topics` event and the same browser joins (Fleet's list, Work's snapshot): it reads nothing new. The member lines, chips, notes, Outputs and Edges move there from the tab's expanded Topic, which keeps a summary. Work's watch (`PUT /api/work/watch`) is on while the view shows, as while the tab is open.
- **The summary** (slice 5, `server/summarizer.ts`) is Lookout running `claude -p` itself, which decision [0013](../../decisions/0013-one-shot-claude-runs-for-lookouts-own-text.md) allows for a run that isn't a Session. `claude` is the path Fleet's `harness list` gives (TOOLS-1.2), run through `server/exec.ts` with argv only, LAUNCH's cleaned environment and its own process group, from `~/.lookout/claude-run/` (empty, 0700):

  ```
  claude -p --model sonnet --tools "" --strict-mcp-config --disable-slash-commands
    --setting-sources "" --no-session-persistence --output-format json
    --json-schema <TOPIC-11.4's schema> --max-budget-usd 0.5 --system-prompt <the summarizer's instructions>
  ```

  The input goes on stdin as one Markdown document: the Topic, then a section per kind with each member under its key. `--tools ""` leaves the model no tool but the one `--json-schema` adds to answer with; `--setting-sources ""` and the empty directory keep `CLAUDE.md`, skills and hooks out; `--strict-mcp-config` with no `--mcp-config` keeps every MCP server out. Checked on 2.1.316 (2026-10-31): a probe answered in 3.6 s for $0.0066, saw no tool but StructuredOutput and no `CLAUDE.md`, and `modelUsage` named `claude-sonnet-5-5`. `--bare` isn't used: it skips the keychain, where the login is. The answer is `structured_output` in the JSON; `is_error`, `subtype` other than `success`, or a shape the schema didn't hold is TOPIC-11.6's "couldn't read". `total_cost_usd` is the cost shown (TOPIC-11.7), `modelUsage`'s key the model.

  The Session reads are `tb-session show <id> --harness <h> --tail 2 --json`, four at a time, each with HIST's timeout; one that fails leaves that Session with its snapshot. The fingerprint (TOPIC-11.5) is a SHA-256 over the sorted member keys and the notes; the `topics` event carries each Topic's `summary` (answer, `writtenAt`, `model`, `costUsd`) and `summaryStale`, and the view's `summarizing` (the Topic ids running) and `summaryErrors` (by Topic id, kept in memory until the next run). A run is an `AbortController` per Topic; Cancel and a deleted Topic abort it, and the server's exit aborts them all.

  Schema 3 adds one table, migrated forward as TOPIC-8.1 says (the file copied to `topics.db.bak-2` first):

  ```sql
  create table summaries (topic_id text primary key references topics(id) on delete cascade,
    answer text not null, written_at integer not null, model text not null, cost_usd real,
    fingerprint text not null);
  ```
- **The graph** (slice 3) is SVG in the main pane, drawn by Lookout's own code: nodes as `<g>` groups with the design system's type and tokens, Edges as paths with an arrowhead marker at their second Topic, drag with pointer events. No graph library: 30 nodes don't need one, and the one-shot "Arrange" is a bounded spring layout (a few hundred iterations, no worker). A library (d3-force, elkjs) is a decision for later if "Arrange" proves poor. A node without a position is placed on a spiral away from the others. The view is a main-pane route like `/h/<harness>/<id>` and `/settings`; selecting a Session in the sidebar leaves it, and `G` or "Open graph" returns.
- **Routes.** The browser's: `/topics` (the graph) and `/topics/<id>` (a Topic's view). The server's: `GET /api/topics` (the view); `POST /api/topics`; `PUT /api/topics/<id>` (title, notes, state); `DELETE /api/topics/<id>`; `POST` and `DELETE /api/topics/<id>/members`; `POST`, `PUT` (label, reverse) and `DELETE /api/topics/<id>/edges`; `PUT /api/topics/positions` with `{positions: [{id, x, y}]}`, one node or many in one transaction (TOPIC-7.2); `POST /api/topics/<id>/summary` starts a summary (202, or 409 while one runs for it or two run), `DELETE /api/topics/<id>/summary` cancels it (TOPIC-11); `POST /api/topics/recommendations` with `{action, key, topicId}` for `accept` and `dismiss`, `to` for `move` (the picker), or `{action: "judge-again", member}`. Every mutation is token and Origin checked (`server/security.ts`).
- **Settings:** `recommendWithJev: boolean` in `shared/settings.ts`, default `false`, parsed as the other fields are.
- **Tests.** `(test)`: the store against a temporary database (schema, refusals, migrations, the judged-once key); the view's joins against recorded Fleet, Work and Library fixtures; candidates from recorded diffs; the Link rule; the Jev call against recorded `tb-jev ask` output (a pick above and below 0.6, `new`, `none`, a timeout, unreadable output), with a fake `tb-jev` that logs its argv and stdin and refuses anything but `ask` and `status`; the panel's select-then-act and keys; the pickers; the graph's drag and position write; the summarizer against a fake `claude` that logs its argv, working directory and stdin and answers from recorded `claude -p` JSON (an answer, `is_error`, a budget stop, a timeout, an unreadable answer), and the input's 60,000-character cut against a recorded 46-member Topic. `(e2e)`: TOPIC-4.3 and TOPIC-5.1 to 5.2, which span the server's watch and the launcher; TOPIC-5.2 waits on the Fake Harnesses (TEST-1.4) like WORK-5.1. The World's `HOME` holds `~/.lookout/topics.db`.

### Dependencies

- **Nothing new in the Fleet fork, tb-session, tb-pr or tb-prod** for slices 1 to 3. **tb-jev 0.2.0 or later** for slice 2 (`ask`, `status --json`; the Tools table already names 0.2.0 for USAGE). **`tb-flow`** for the run member (Backlog; not started). **Claude Code 2.1.316 or later** for slice 5 (`--tools ""`, `--json-schema`, `--max-budget-usd`, `--no-session-persistence`, `--setting-sources`, all checked on that version).
- **Design system:** the Topic picker (a modal list with a filter) and a notes text area are new to `components/ui/`; the labelled button (DS-7.1), chips, Alerts, EmptyState and the chat's Markdown exist. A graph node stays in `TopicGraph.tsx`, its one user: the system takes a piece once it repeats (0009).
- **World fakes:** a fake `tb-jev` answering `ask` from declared answers; the Worlds' fake Fleet, tb-session, tb-pr and tb-prod serve the joins.
- **Fake Harnesses** (TEST-1.4) for TOPIC-5.2's Behaviour test, as for WORK-5.1.
- **HIST's Non-goal** "tagging past Sessions" is amended in the same change: a Topic membership is a record in Lookout's store, not a change to the Session.

### Known gaps

- **`node:sqlite` is experimental in Node 25** ("might change at any time"); its API is small (`DatabaseSync`, `prepare`, `exec`) and a change is a server fix, not a data loss, since the file is plain SQLite.
- **A Codex Session before its first prompt can't be added or recommended** (TOPIC-2.2, TOPIC-9.1); it becomes a candidate once it has an id.
- **Members outlive their sources.** A pruned Session, a merged PR or a closed Task shows its snapshot only (TOPIC-4.2), as old as the day it was added.
- **Sessions started outside Lookout are never added on their own**, only recommended (TOPIC-9); a `Topic:` line typed by hand isn't read yet.
- **Jev sees text, not the work.** A Session's first prompt, a PR's title and a Task's description are what it judges; a Session whose first prompt is "continue" gets `none`. Links cover the id-based cases first.
- **The Jev cap is per server process:** a restart resets the 30-an-hour count.
- **The first-prompt marker is text the agent reads** (slice 4). `Topic: <id> <title>` is one line it can ignore; it costs a few tokens per Session.
- **The graph has no undo.** "Arrange" moves every node and asks first; a dragged node can be dragged back.
- **A summary is only as good as what it's given** (TOPIC-11.3): titles, first prompts and last messages, not the work. A Session whose last message is "Done." says little; one that ended mid-thought may say it's further along than it is. The citations let you check.
- **A summary costs Claude usage.** It runs under your Claude login, as Sessions do; `claude -p` reports a dollar cost, which on a subscription is what counts against its limits. About $0.01 for a small Topic; a 46-member Topic is estimated at under $0.10 (TOPIC-11.7 shows each one's).
- **No telemetry for summaries.** They run from `~/.lookout/claude-run/`, which isn't a `productiveio/*` repo, so 0002's login-shell function would send none either.
- **"Looks done"** reads Work's open lists, so it never shows before Work has read, and a Task reassigned away from you looks done. A run member's own `done` can feed it in slice 4.

### Key decisions

Answered by Dario on 2026-10-30; where the grill's recommendation stood uncontested it's marked so.

- **A Topic is a wrapper, not a job** (Dario): it holds a Task, a PR, Sessions and, later, a `tb-flow` run, all or some; a research Topic is Sessions and notes, a feature Topic has everything. Stjepan's job (`glados`: a type, a recipe, steps, gates, a parent) is a run of a workflow, the FLOW idea; a Topic can wrap one. No type field: what's in it says what it is.
- **Topics carry notes** (from Dario's "no personal knowledge or record besides your memory and the Transcripts"): Markdown, rendered in the tab, the launcher's prompt built from the first paragraph. The one piece of text a Topic has; files and Outputs stay where they are.
- **Made by hand, with a recommendation queue** (Dario): nothing is added without Accept. Links come first because an id-based tie is free and right (WORK's 12 of 12 openers); Jev judges the rest from text, once per item, bounded and billed, behind a Settings switch that's off by default so an upgrade never starts billed calls on its own.
- **Members are Sessions, PRs, Tasks and runs** (Dario); Outputs through Sessions (as recommended): LIB-2.11 already gives Outputs per Session, and a run is `tb-flow`'s record, referenced by id once it exists. No exclusivity: an item sits in any number of Topics.
- **Open and Archived by hand, "looks done" as a hint** (as recommended, uncontested): Work lists open items only and TOOLS's "show, never run" holds; a derived state would need `tb-pr show` and `tb-prod get` per member.
- **On top of Links, not instead** (Dario's motivation, the two split lists): a Topic unifies what Links find and what they miss. Links feed recommendations (TOPIC-9.2) and show as reasons; Work, History and Library rows get a Topic chip and "Add to Topic".
- **History and Library link to Topics** (Dario): the chip and the button on their rows (TOPIC-2.1, TOPIC-2.5); Outputs of member Sessions in the expanded Topic (TOPIC-4.4).
- **Explicit directed Edges with a label; shared members dashed and unstored** (as recommended, uncontested; directed from Dario's review, 2026-10-30): a stored inferred Edge would be WORK's wrong-Link problem again; parent and child wait for a tree to be needed. Edges point one way because the labels that matter do ("part of", "follows", "blocks"): undirected, "A part of B" and "B part of A" were the same row. Still one Edge per pair, so a pair can't say both.
- **Candidates and recommendations in two tables** (from Dario's review, 2026-10-30): one table keyed by `(kind, ref, topic_id)` held a candidate with no Topic yet under a null `topic_id`, and SQLite doesn't stop a second insert with a null in the key, so "never asked twice" would have failed.
- **Jev judges only what came while it was on** (from Dario's review, 2026-10-30): turning the switch on after weeks would otherwise start a billed backlog of every Session since, at 30 an hour, most of it long settled. "Judge again" reaches an old one.
- **A Topics tab for the list and a main-pane view for the graph, in place of the Session view** (Dario): a 280 px sidebar can't draw a graph, and the main pane already hosts the past-Session view and Settings.
- **SQLite, in Lookout** (Dario): `~/.lookout/topics.db` through `node:sqlite`, no package, no cli-toolbox CLI. Topics are Dario's own record, as Lookout is his own UI; a shareable, unopinionated "personal knowledge" Building block is a later, secondary question, and the brain's lore and jobs stay apart.
- **Nothing new is read for a member's state; Topics open counts as Work open** (as recommended, uncontested): the header chips were dropped because they needed reads of their own; here the Session list, Work's snapshot and the Library's read already hold it.
- **Members are references with a snapshot, resolved at read time** (LIB: "Liveness is checked at read time, never stored as truth"): the store never holds a Status, a CI state or a Task status as truth.
- **A first-prompt marker and auto-add for Sessions Lookout starts** (as recommended, uncontested; slice 4): the line is the one marker a Building block can see later, and the auto-add is what makes "Start Session" from a Topic worth having.
- **Slices: store and tab, then recommendations, then the graph, then the launcher and runs** (proposed; Dario's reply led with the queue): the bundle has to be used before Edges and a canvas are worth drawing, and the run member waits for `tb-flow`.
- **Select, then act** (HIST-3.5, WORK-1.12, LIB-3.1): a click expands; a labelled button, a chip or Enter on an expanded Topic acts.
- **A Topic view in the main pane; the tab's expanded Topic a summary** (Dario, 2026-10-31): expanded in the tab, Proposals porting (46 members) was taller than the sidebar. The tab keeps what tells Topics apart (counts, the notes' start, live Sessions); the view holds the rest. Enter on an expanded Topic opens its view rather than the graph, which keeps "Open graph" and `G`.
- **A Topic summary from `claude -p` with Sonnet, run by Lookout** (Dario, 2026-10-31): not a Lookout Session, so it never shows in the Session list or fills your history, and Sonnet over Haiku. Running `claude` outside tmux needs decision 0013, which narrows 0002 to Sessions; the summarizer is one consumer's rule, so it stays in Lookout (0010), and brief generation (Plan item 23) can share it.
- **On demand, rewritten whole, apart from the notes, citing members** (recommended 2026-10-31): a button keeps the cost to what you click; a whole rewrite avoids a summary drifting from its members; notes stay yours; citations make a wrong point checkable. "Out of date" is by members and notes only, since Statuses change by the minute.
- **The summary is the launcher's brief** (TOPIC-5.1): a new Session started from a Topic gets what it is, where it stands and what's next, not only the notes' first paragraph.
- **Ids are random, never slugs; Delete removes only the Topic's own rows** (decided while drafting, uncontested).

## Open questions

None blocking. Two for slice 2 and 4, answered when they're picked up:

- [ ] The Jev confidence threshold (0.6) and the per-hour cap (30) are starting values; `tb-jev replay` over the accepted and dismissed rows is the way to tune them once there are a few dozen.
- [ ] The run member's `ref` and snapshot follow `tb-flow`'s `show --json` once that exists (Backlog).

## Changelog

- 2026-10-30: Created as a Draft from Plan item 18, after reading WORK (Links, Gap 2, the dropped header chips), LIB (Outputs per Session), HIST, SIDE (Session identity), Lookout's stores (`settings.json`, attachments) and Stjepan's `glados` snapshot (a job has a type, a brief, a lead Session, a Task id, a parent and PRs). Twelve open questions sent to Dario with a recommendation each.
- 2026-10-30: Ready. Dario's answers folded in as Key decisions: a Topic is a wrapper of a Task, a PR, Sessions and a `tb-flow` run, all or some, with notes (TOPIC-1.2); made by hand with a recommendation queue, Links first and Jev second, nothing added without Accept (TOPIC-9, after checking `tb-jev ask`'s flags, its `choice` answer shape and its billing); SQLite in `~/.lookout/topics.db` through `node:sqlite` (TOPIC-8, checked on Node 25); History and Library link to Topics (TOPIC-2.5); the graph in the main pane in place of the Session view (TOPIC-7). The uncontested recommendations stand: Open and Archived by hand, explicit Edges, nothing new read for member state, the first-prompt marker. Slices reordered: store and tab, recommendations, graph, launcher and runs. HIST's Non-goal on tagging amended.
- 2026-10-31: In Progress. Slice 1 built: the store (`server/topics.ts`, `node:sqlite`, its ExperimentalWarning dropped at load), the routes, the `topics` event, the Topics tab (`TopicsPanel`), the Topic picker (`ui/picker.tsx`, `TopicPicker`), "Add to Topic" and Topic chips on Work, History and Library rows and in both Session headers, `T` and `A`, and the Session filter on Topic titles. Changed while building: Live Status and Work's state are joined in the browser, not on the server (Technical approach); TOPIC-3.4 lists "Delete" after Archive, and Enter on an expanded Topic never archives or deletes, so in slice 1 it does nothing; TOPIC-4.4's "+N more" filters the Library by a new `sessions` query parameter, shown as "Sessions of <Topic>" with a button to clear it. The database is made on the first change, so `~/.lookout` stays untouched until Topics are used. A World can declare Topics (`world().topics(…)`). TOPIC-4.4 amended from Dario's question (2026-10-31): a Topic asked for a Library read only before the first one, so with Library closed its Outputs stayed as old as the last read; expanding it now asks when the last read is a minute old or more, and the view carries `libraryReadAt`. TOPIC-1.1 to 4.4 and 8.1 to 8.4 ticked against their tests and TOPIC-4.3's Behaviour test; TOPIC-3.7 waits for Dario's look; TOPIC-2.6 is refused by the server until slice 4.
- 2026-10-31: Fixed from a Codex review of slice 1 (seven of eight findings; a forward migration waits for schema 2, as there is nothing below schema 1). The Topic picker and the notes give focus back when they close, so `A` and j/k keep working; a Library row adds and shows the Topics of its pruned Sessions too; the pruned set comes from every event the Library read, not only the Outputs it kept; "+N more" clears the Library's type, repo, gone and text filters; a failed Library read shows its reason in Outputs instead of reading forever; a database from a newer schema is refused before WAL is set, so not one byte of it changes.
- 2026-10-31: Slice 2 built: TOPIC-9.1 to 9.7 (`server/recommender.ts`, `Recommendations.tsx`, the Settings switch). TOPIC-3.7 seen by Dario. Changed while building: (1) Schema 2: `candidates` keeps a `snapshot` (what Lookout knew of the item when first seen) for the "Recommended" row, so the forward migration TOPIC-8.1 promised is built now: the file is copied with `vacuum into` to `topics.db.bak-1`, then migrated in one transaction. (2) Links are read both ways (TOPIC-9.2): a PR or Task Linked to a member Session is tied too, as the same Link seen from its other end. (3) A candidate waits 6 minutes before Jev is asked, so a Work read can tie it by a Link first and a new Session has a first prompt; "Judge again" skips the wait. (4) "Judge again" lives in the Topic picker, as "Ask Jev which Topic", offered while the switch is on and Jev is ready: the picker is already on every row. (5) The recommendations route takes its item in the body, not the path, since a ref is JSON. (6) "Other Topic…" adds the item where you picked and counts the recommendation as dismissed; an item added by hand to the Topic it was recommended for counts it as accepted. (7) Nothing is recorded as a candidate before the store exists, so `~/.lookout` stays untouched until Topics are used. Recommendations aren't on the panel's j/k list; their buttons are reached with Tab.
- 2026-10-31: Fixed from a review of slice 2 (Opus, as Codex's usage limit was reached): a Topics database that fails while candidates are recorded or Jev is asked is logged and Lookout keeps running (TOPIC-8.4); an item added to a Topic while it waits is never sent to Jev; a tb-jev that isn't set up (exit 4) leaves the item waiting and stops the asks for 10 minutes while USAGE reads Jev again (TOPIC-9.7); a Link that ties an item Jev was asked about keeps when it was asked, so "ran today" stays right. "Judge again" twice in a day still counts once.
- 2026-10-31: Slice 3 built: TOPIC-6.1 to 6.3 and TOPIC-7.1 to 7.4 and 7.6 (`TopicGraph.tsx`, `web/src/lib/graph.ts`, the Edge and position routes). TOPIC-7.5 waits for Dario's look. No schema change: `edges` and `pos_x`/`pos_y` were in schema 1. Changed while building: (1) Positions go through `PUT /api/topics/positions`, one or many in one transaction, not `PUT /api/topics/<id>`: placing new nodes and "Arrange" write several at once. Moving a node isn't a change to its Topic (TOPIC-3.2's order). (2) "Link to Topic…" asks for the label in a second step after the pick. (3) A shared-member suggestion (TOPIC-6.3) is only between Open Topics, and not for a pair that already has an Edge; the graph draws it as a dashed line with its "shared:" words, and its Link button is in the tab. (4) The graph is drawn at scale 1 and scrolls when it's larger than the pane, rather than shrinking its type (TOPIC-7.5). "Arrange" runs the bounded spring layout, then puts each node in the nearest free cell of a grid as wide as the pane, so no two nodes overlap. (5) A click on an Edge's label opens a small dialog: the label, Reverse, Unlink; an Edge with no label shows a pencil there. (6) Enter on an expanded Topic opens the graph; a click on it doesn't. (7) The "Archived" toggle is shared by the tab and the graph, and still isn't remembered across reloads. (8) The graph draws its own `<svg>`, a diagram like MEM's sparkline, so it's on the icon guard's list of files allowed to. The guard had been reading a cached copy of the source and missed a lone `→` in "Recommended" (slice 2), now a lucide icon, and DIFF-3.1's `old → new`. An arrow between two pieces of text is now notation; one on its own or at either end of the text is still an icon.
- 2026-10-31: Changed after Dario's first look at slice 3 with real Topics: placed on the spiral, a first graph had an Edge run under another node and two labels on top of each other. With no node placed yet, every node is now laid out as "Arrange" does, once the pane is measured (`placeMissing`); a node added later still goes on the spiral. A server without Edges blanked the app; DS-4.5 (design system) holds such a failure to the main pane.
- 2026-10-31: Fixed from a Codex review of slice 3 (Sol, xhigh; four of five findings). A position the server never took (a cancelled drag, a failed placement or Arrange) is dropped, so the node goes back and a later move from another tab shows; a new node is placed clear of hidden Archived ones too; a graph node the tab's filter hides clears the filter, so the tab marks that Topic; a shared-member suggestion is between Open Topics only, as (3) of the slice 3 line says. Rejected: making the graph node a design-system piece; the Technical approach now says it stays with its one user.
- 2026-10-31: Slice 4 specced from Dario's look at real Topics: expanded in the tab, a Topic of 46 members was taller than the sidebar. TOPIC-10, a Topic view at `/topics/<id>`. Changed for it: TOPIC-3.4's expanded Topic is a summary with "Open" first, and Enter on it opens the view, not the graph; editing the title and notes (TOPIC-1.2), Remove (TOPIC-2.4), Outputs (TOPIC-4.4), Edges (TOPIC-6.2, 6.3) and a Topic's own recommendations (TOPIC-9.4) move to the view, with their tests. TOPIC-10.1 to 10.5 built and ticked with the moved criteria; TOPIC-10.6 waits for Dario's look. Slices renumbered: 5 is a summary of the Topic (TOPIC-11, `claude -p` with Sonnet), 6 the launcher (TOPIC-5); the run member (TOPIC-2.6) waits in the Backlog for `tb-flow`.
- 2026-10-31: Fixed from a Codex review of slice 4 (Sol, xhigh; four of four findings). Each Topic's view is drawn afresh, so a notes draft left open never saves into the Topic Back goes to, and the Library read TOPIC-4.4 asks for is checked per Topic; the tab selects the viewed Topic however it was reached (Back, Forward, a URL), past its filter; `S` opens the summary's first chip, a live Session first, rather than the first Session in the order they were added.
- 2026-10-31: TOPIC-11 specced: a summary of the Topic, on demand, from `claude -p` with Sonnet run by Lookout (Dario's choice over a Lookout Session and over Haiku), with no tools and nothing loaded but its input; decision 0013 lets Lookout run `claude` for such a run and keeps 0002 for Sessions. The flags were checked with a probe on Claude Code 2.1.316. TOPIC-5.1's prompt starts from the summary when there's a current one. Schema 3 adds `summaries`.
- 2026-10-31: Slice 5 built: TOPIC-11.1 to 11.8 (`server/summarizer.ts`, `History.brief`, the summary routes, the Summary section in `TopicView.tsx`, the summary lines in the tab's expanded Topic); TOPIC-11.9 waits for Dario's look. Schema 3 adds `summaries`, migrated forward with `topics.db.bak-2` kept. Changed while building: (1) `why` is its own field next to `state`, so TOPIC-5.1 can quote both. (2) Past 60,000 characters, the Sessions least recently active by tb-session's last active time lose their messages first, not the ones added first. (3) A point keeps each cited member's name at writing time, so a member removed since still shows by name, without a button. (4) `exec.ts` gains a `cwd`, for the run's empty directory. A real run on Claude Code 2.1.316 answered a three-member Topic in 5.2 s for $0.015; it and a run stopped at a $0.0001 budget are the test's recorded answers (`server/fixtures/claude/`).
- 2026-10-31: Fixed from a Codex review of slice 5 (Sol, xhigh; three of three findings). An answer outside the schema's shape anywhere (a point that isn't one, `cites` missing, no `why`) is refused whole and the stored summary stays, instead of its bad parts being dropped quietly; when even the cut leaves the input too long, the members it took out can't be cited; a cited past Session tb-session no longer has is its name alone, as its chip has no button (TOPIC-4.2).
- 2026-10-30: Changed from Dario's review. (1) Candidates get their own `candidates` table keyed by `kind` and `ref`, and `recommendations` gets a partial unique index per kind of proposal (TOPIC-9.6, TOPIC-8.2): the one table keyed by `(kind, ref, topic_id)` let a candidate with no Topic yet be inserted twice, since SQLite counts nulls in a primary key as distinct, checked with `node:sqlite`. (2) Jev judges only candidates first seen while "Recommend Topics with Jev" is on; turning it on doesn't start on the backlog, Links still tie it, "Judge again" reaches one item (TOPIC-9.3). (3) Edges have a direction, so "part of" reads one way: "→" and "←" on the two Topics, "Reverse", an arrow in the graph, still one Edge per pair (TOPIC-6, TOPIC-7.1, TOPIC-7.4).
