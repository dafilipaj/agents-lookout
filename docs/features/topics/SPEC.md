---
title: "Topics"
code: "TOPIC"
status: "Draft"
created: "2026-10-30"
updated: "2026-10-30"
---

# Topics

## Summary

A Topic bundles what belongs to one piece of your work: the Sessions that worked on it, its PR and its Task, and through those Sessions the Outputs they produced. You make a Topic, name it, and put things in it from where you already see them: a Work row, a History result, a Library row, the Session header. A Topics tab in the right sidebar lists them, and a graph in the main pane shows Topics as nodes with the Edges you draw between them: a mind map of what you're working on and how it hangs together. Lookout stores Topics itself, as references to things the Building blocks know. It never writes to Productive or GitHub.

## Problem

- **A piece of work has no home.** Its Task and its PR are in Work, and the Session that opened the PR is Linked there (WORK-4.2). The Session that specced it, the two that reviewed it and the one that fixed CI are not: WORK-4.6 Links only the inferred opener and the Sessions started on the item, and "every Session involved" (Gap 2, WORK Later) is a tb-session change that may never be precise. Finding them means History searches, several times a day.
- **Links are guesses, and they go away.** The opener is inferred and can be wrong (WORK Known gaps). Links are recomputed on every read and never kept (WORK-4.9; `server/work.ts` holds them in memory). When the PR merges and the Task closes they leave Work (WORK Non-goals), and every Link with them: a finished piece of work leaves no trace in Lookout but the Library's Outputs.
- **Work across pieces has no shape.** A CRM milestone is three Tasks, five PRs and a dozen Sessions over two weeks; a spec Session feeds two implementation Sessions in two repos. Nothing in Lookout says which belongs with which, or what came from what. The header chips tried to put a Session's Task and PR in the main pane and were dropped as too clunky (Backlog, 2026-10-27): the Link had to be recomputed every time a Session showed.
- **Measured** (WORK, 2026-10-19; HIST, 2026-10-16): 6 of 9 open Tasks had a PR with a Linked opener; 10 of 13 open PRs had exactly one Session that mentioned them, so the other Sessions around that work are invisible to Links; 150 of the last 300 Sessions started in `~/Projects/work` on `main`, so a Session's branch and directory say nothing about what it is for (Linking table, "Session → Task by branch": 0 of 300).

## Requirements

Draft: numbered freely until Ready (writing rule 1). The criteria are written to the recommendations under Open questions; an answer that differs changes them. Slice 1 is TOPIC-1 to TOPIC-4 and TOPIC-8; slice 2 is TOPIC-6 and TOPIC-7; slice 3 is TOPIC-5 and TOPIC-9.

### TOPIC-1 A Topic

A Topic is a named bundle you make by hand: a title, an optional brief (one paragraph), its members (TOPIC-2) and a state, Open or Archived. It has no type, steps or gates (Non-goals).

- [ ] TOPIC-1.1 "New Topic" in the Topics tab (TOPIC-3) asks for a title and makes an Open Topic with no members. The title is trimmed, must not be empty, and is cut to 120 characters. A Topic gets an id Lookout generates, never reused. (test)
- [ ] TOPIC-1.2 An expanded Topic's title and brief can be edited in place; the brief is plain text, at most 2,000 characters. Saving an empty brief clears it. (test)
- [ ] TOPIC-1.3 "Archive" moves a Topic out of the default list and keeps its members and Edges; "Unarchive" brings it back. An "Archived" toggle in the tab shows them. (test)
- [ ] TOPIC-1.4 "Delete" removes the Topic, its memberships and its Edges after a confirmation naming the Topic. Nothing else is touched: no Session, PR, Task or Output is changed, closed or deleted. (test)
- [ ] TOPIC-1.5 A Topic whose every PR member is no longer on tb-pr's board and whose every Task member is no longer in Tasks, with at least one of either, shows "looks done" as an info chip. Lookout never archives it on its own. (test)

### TOPIC-2 Members

A member is a reference to something a Building block knows: a Session (its Harness and `session_id`), a PR (its URL) or a Task (its id). Outputs aren't members; they come with their Sessions (TOPIC-4.4).

- [ ] TOPIC-2.1 An expanded Work row (WORK-2.9, WORK-3.6), History result (HIST-2.9) and Library row (LIB-3.2) has an "Add to Topic" button that opens a picker of Open Topics, most recently changed first, with "New Topic…" at the end. Picking one adds the row's item (a Task, a PR, a Session, or a Library row's Sessions) and closes the picker. `A`, with focus in that panel and not in a text field, opens the picker for the selected row. (test)
- [ ] TOPIC-2.2 The Session header (VIEW-5) has the same button for the current Session, and a past Session opened read-only (HIST-3.3) has it too. A Session whose id is `<harness>:<pid>` (a Codex Session before its first prompt, SIDE Technical approach) can't be added: the button is disabled and its tooltip says why. (test)
- [ ] TOPIC-2.3 Adding stores the reference and a snapshot of what Lookout knew at that moment: a Session's Harness, title and start directory; a PR's repo, number, title and URL; a Task's title, project and URL. The snapshot is what shows when the source no longer lists the item (TOPIC-4.2). Adding an item that's already a member changes nothing and says "Already in <Topic>". (test)
- [ ] TOPIC-2.4 An item can be in any number of Topics. "Remove" on a member of an expanded Topic removes that membership and nothing else. (test)
- [ ] TOPIC-2.5 A Linked item of a member (a Task's Linked PRs and Sessions, a PR's Linked Task and Sessions, WORK-4) shows in the expanded Topic as a suggestion, under the members, with its Link's reason (WORK-4.5) and an "Add" button; it is never a member until added. (test)

### TOPIC-3 Topics tab

A fourth tab in the right sidebar, after Library (LIB-1.1).

- [ ] TOPIC-3.1 With focus not in a text field and no modal open, `T` opens the sidebar on Topics, switches to it from another tab, and closes the sidebar when Topics is showing, as `H`, `W` and `L` do. The closed rail has a Topics button under Library's; ←/→ on the tab strip reach it. The tab, the width and the open state are remembered with the others (WORK-1.2). (test)
- [ ] TOPIC-3.2 The tab lists Open Topics, most recently changed first (a membership, Edge, title or brief change), each with its title, its member counts by kind ("2 Sessions · 1 PR · 1 Task") and a Session marker as WORK-2.4 draws it: the most urgent live member Session's Status, else the past marker, else nothing. A text filter matches titles and briefs. (test)
- [ ] TOPIC-3.3 Select, then act (HIST-3.5, WORK-1.12, LIB-3.1): a click or Enter selects and expands one Topic in place; Esc collapses it; ↑/↓ and j/k move without acting; nothing opens, resumes or starts on a click. (test)
- [ ] TOPIC-3.4 An expanded Topic shows its brief; its members grouped Sessions, PRs, Tasks; its Outputs (TOPIC-4.4); the suggestions (TOPIC-2.5); and its Edges (TOPIC-6) as the other Topics' titles. A Session member is a chip as WORK-4.10 (Harness icon, title, Status colour; Open, Resume or Show by what the Session is, LIB-3.5). A PR or Task member is a line with the state WORK's rows show (WORK-2.2, WORK-3.2) and "Open on GitHub" or "Open in Fantastic" (WORK-6). The buttons, in this order: "Start Session" (TOPIC-5), "Open graph" (TOPIC-7), "Link to Topic…" (TOPIC-6), "Archive". Enter on an expanded Topic runs "Start Session". (test)
- [ ] TOPIC-3.5 The Session sidebar's filter (SIDE-2.13) also matches the titles of the Topics a live Session is in; the rows themselves show no Topic (Non-goals). (test)
- [ ] TOPIC-3.6 Loading, empty and error states are the design system's (DS-6.3, DS-8.1, DS-4): "No Topics yet" with "New Topic", "Nothing matches" under a filter, and a failed read or write of the store as an error Alert with its reason. (test)
- [ ] TOPIC-3.7 The expanded Topic's layout holds at a 280 px sidebar, light and dark. (manual)

### TOPIC-4 What a member is doing now

A Topic reads nothing of its own. A member's current state comes from what Lookout already holds: Fleet's Session list, Work's last read and the Library's last read.

- [ ] TOPIC-4.1 A Session member is live when Fleet's list has its id (HIST-3.2), and its Status follows the list. A PR or Task member shows the state and CI from Work's last read when it's there. (test)
- [ ] TOPIC-4.2 A member Work's last read doesn't list shows its snapshot (TOPIC-2.3) with a "not in Work" chip, whose hover says that Work lists open items only, so the item may be merged, closed or not read yet. A Session tb-session no longer has (pruned, LIB-2.6) shows its snapshot with "removed from the index" and no button. Nothing is read to find out more (Non-goals). (test)
- [ ] TOPIC-4.3 While any tab has Topics open, Work's reads run as if Work were open (WORK-8.1): the same schedule and the same one read per source, so a Topic's PR and Task members are at most 5 minutes old. Opening Topics before anything was read shows "Loading" on those members until the first read lands. (e2e)
- [ ] TOPIC-4.4 An expanded Topic lists the Outputs any of its Session members touched, from the Library's last read (LIB-2.11's Sessions per Output), newest first, at most 10, then "+N more", which opens the Library filtered to those Sessions. Each is a Library row's first line with its Open button (LIB-3.3). With no Library read yet, the Topic asks for one as opening the Library does (LIB-2.7). (test)

### TOPIC-5 Start a Session in a Topic

- [ ] TOPIC-5.1 "Start Session" on an expanded Topic opens the launcher (LAUNCH-1) pre-filled as WORK-5.1 does: the prompt is the Topic's brief, then one line per Task member's URL, then `Topic: <id> <title>` as its own last line. Nothing starts until you press Start, and you can edit it first. (e2e)
- [ ] TOPIC-5.2 A Session Lookout started from a Topic is added to it when Fleet reports it, with the reason "started from this Topic". One started from a Task's "Start Session" (WORK-5.1), while that Task is a member of exactly one Open Topic, is added to that Topic too. No other Session is added on its own (Non-goals). (e2e)
- [ ] TOPIC-5.3 The launcher opened with N, ⌘N or "+" has an optional "Topic" field listing Open Topics; a Session started with one picked is added as TOPIC-5.2 says. LAUNCH-1.3's draft rules apply. (test)

### TOPIC-6 Edges

An Edge connects two Topics. You draw it; it is undirected and has an optional label.

- [ ] TOPIC-6.1 "Link to Topic…" on an expanded Topic opens the Topics picker (TOPIC-2.1's, without "New Topic…") and makes an Edge to the chosen Topic, with an optional label of at most 60 characters. An Edge that exists is not made twice, and a Topic can't be linked to itself. (test)
- [ ] TOPIC-6.2 An Edge shows on both Topics; "Unlink" on either removes it. Deleting a Topic removes its Edges (TOPIC-1.4). (test)
- [ ] TOPIC-6.3 Two Topics that share a member show a dashed "shared: <item>" line on each, as a suggestion, never stored; "Link" on it makes an Edge. (test)

### TOPIC-7 The graph

A main-pane view at `/topics`, like the past-Session view (HIST, `/h/…`) and Settings: the Session sidebar and the right sidebar stay.

- [ ] TOPIC-7.1 "Open graph" in the tab, or `G` with focus in Topics, shows the graph: one node per Open Topic (Archived ones behind the same "Archived" toggle) with its title and Session marker, and a line per Edge with its label. The selected Topic's node is marked, and selecting a node selects the Topic in the tab. (test)
- [ ] TOPIC-7.2 Nodes are dragged into place; a node's position is stored with its Topic (TOPIC-8) and kept across reloads. A node with no position is placed by a one-shot layout that avoids the others; "Arrange" lays every node out again, after a confirmation. (test)
- [ ] TOPIC-7.3 A node expands on a click to its members, drawn as small nodes around it with their kind's icon and, for a Session, its Status marker. A click on a member node does what its chip does (TOPIC-3.4); Esc collapses the node. (test)
- [ ] TOPIC-7.4 An Edge is drawn by dragging from a node's handle onto another node, which makes it as TOPIC-6.1 does; a click on an Edge's label edits it or unlinks. (test)
- [ ] TOPIC-7.5 Nodes, lines and labels use the design system's tokens and type steps (DS) and lucide's icons (0008); the view stays readable at the main pane's width with 30 nodes, light and dark. (manual)
- [ ] TOPIC-7.6 With no Topic, the view shows "No Topics yet" and "New Topic" (DS-8.1). (test)

### TOPIC-8 Storage

- [ ] TOPIC-8.1 Topics live in one file the server owns, `~/.config/lookout/topics.json`, next to `settings.json` (`XDG_CONFIG_HOME` honoured), written atomically as settings are (`server/settings.ts`), mode 0600, with a `version` field. Every change goes through the server's API; the browser stores nothing but which Topic is selected. (test)
- [ ] TOPIC-8.2 The file holds Topics (`id`, `title`, `brief`, `state`, `createdAt`, `updatedAt`, `position`), memberships (`topicId`, `kind`, `ref`, `snapshot`, `addedAt`, `reason`) and Edges (`a`, `b`, `label`, `createdAt`). A `ref` is `{harness, sessionId}`, `{url}` or `{id}` by kind. An unreadable file is reported in the tab (TOPIC-3.6) and never overwritten; a file from a newer version is refused the same way. (test)
- [ ] TOPIC-8.3 The server sends the whole set as a `topics` event on `/api/events` to every tab when it changes, and in the snapshot; a change made in one tab shows in the others within a second. Mutations (`POST`, `PUT`, `DELETE` under `/api/topics`) check the token and Origin as every mutation does (0003). (test)
- [ ] TOPIC-8.4 A write that fails leaves the previous file intact and answers with a plain reason, shown as an error Alert in the tab. (test)

### TOPIC-9 Topics where you already look (slice 3)

- [ ] TOPIC-9.1 A Work row whose item is a member of a Topic shows the Topic's title as a chip in its expanded row; a History result and a Library row whose Session is a member likewise. (test)
- [ ] TOPIC-9.2 When Work's Links give a member a Linked item that's in no Topic, the Topic shows it as TOPIC-2.5 does; a Session started on a Task or PR that's a member (WORK-4.3) is suggested with that reason. (test)

## Non-goals

- **Writing to Productive or GitHub**, as WORK: a Topic never changes a Task or a PR.
- **Topics made by inference.** Lookout never creates a Topic or adds a member on its own from a Link, a branch, a directory or a mention. The two exceptions are the Sessions Lookout itself starts from a Topic, or from a Task that's in exactly one Open Topic (TOPIC-5.2). Links are suggestions.
- **A lifecycle with steps, gates or a recipe.** That's a run of a workflow: the FLOW idea and `tb-flow` (Backlog). A Topic is a subject, not a job; a run can point at a Topic later.
- **Nested Topics (parent and child).** An Edge labelled "part of" says it; a tree can come once the graph exists.
- **Outputs, Worktrees, notes or files as members.** Outputs come through Sessions (TOPIC-4.4); a Worktree is a Session's attribute (SIDE-2.2); the brief is the one piece of text.
- **Reading closed Tasks or merged PRs.** No `tb-pr show` or `tb-prod get` per member: the snapshot stands in (TOPIC-4.2).
- **A Topic on Session sidebar rows.** Rows show what varies (SIDE-2); the filter matches it instead (TOPIC-3.5).
- **A Topics CLI in cli-toolbox.** Topics are one consumer's curation, not facts from a Transcript (0010). A second consumer, such as `tb-flow` runs, would reopen this.
- **Sharing, other Hosts, an export.**
- **Auto-layout as the default.** Positions are yours; "Arrange" is a button.

## UX

```
┌───────────────┬──────────────────────────────────┬────────────────────────────────┐
│ / filter  + ⚙ │ header (VIEW)                    │ [History][Work][Library][Topics]│
├───────────────┼──────────────────────────────────┼────────────────────────────────┤
│ Sessions      │ main pane (VIEW)                 │ [ filter…          ] ☐ Archived│
│               │                                  │ [+ New Topic]  [⌗ Open graph]  │
│               │                                  │ ● Proposals rates              │
│               │                                  │   3 Sessions · 2 PRs · 1 Task  │
│               │                                  │ ○ Lookout topics spec          │
│               │                                  │   1 Session                    │
│               │                                  │ ○ CRM backlog audit            │
│               │                                  │   2 Sessions · 1 Task          │
├───────────────┼──────────────────────────────────┤                                │
│ usage (USAGE) │ composer and status line (VIEW)  │                                │
└───────────────┴──────────────────────────────────┴────────────────────────────────┘
```

An expanded Topic (TOPIC-3.4) grows in place, as the other tabs' rows do:

```
│ ● Proposals rates                        │  ← selected, expanded
│   Port the rates table to Fantastic,     │
│   then the proposal totals.              │
│   Sessions  [✳ rates-port ●] [✳ spec ○]  │
│             [◎ review-812 ○]             │
│   PRs       ✓ fantastic #812 draft · 2d  │
│             ✓ api #4410 · not in Work    │
│   Tasks     Rates table port · In progr… │
│   Outputs   ▤ Rates port doc · 5h        │
│   Also      ✳ fix-ci ○ (probably opened…)│ [Add]
│   Edges     ⇄ Proposals v2 (part of)     │
│   [▶ Start Session] [⌗ Open graph]       │
│   [⇄ Link to Topic…] [⊟ Archive]         │
```

The graph (TOPIC-7), in the main pane at `/topics`:

```
┌──────────────────────────────────────────────────┐
│ Topics                         [Arrange] [+ New] │
│                                                  │
│      ┌──────────────┐  part of   ┌─────────────┐ │
│      │ ● Proposals  │────────────│ ○ Proposals │ │
│      │   rates      │            │   v2        │ │
│      └──────┬───────┘            └─────────────┘ │
│             ┆ shared: api #4410                  │
│      ┌──────┴───────┐                            │
│      │ ○ CRM backlog│                            │
│      │   audit      │                            │
│      └──────────────┘                            │
└──────────────────────────────────────────────────┘
```

- **Shortcuts** (none with a modifier, all ignored in a text field or while a modal is open): `T` the Topics tab (TOPIC-3.1); `A`, in Work, History or Library, "Add to Topic" for the selected row (TOPIC-2.1); `G`, in Topics, the graph (TOPIC-7.1); `O` and `S` keep their meanings inside Topics, on the selected Topic's first PR or Task and its first Session chip. `T`, `A` and `G` are unused today.
- **Markers:** the Session marker as WORK-2.4 and DS-5.3; the past marker for past Sessions only. "Not in Work" and "looks done" are info chips (DS-3.3), never amber or green.
- **Pickers:** the Topic picker is a small modal list with a filter; Enter picks, Esc closes. One component serves "Add to Topic" and "Link to Topic…".
- **Errors:** a failed read of `topics.json` is an error Alert at the top of the tab with the reason and the file's path; a refused write the same, under the control that asked.
- **Empty:** "No Topics yet" with "New Topic", in the tab and in the graph.

## Technical approach

Nothing new is read from a Building block. Fleet's `list` (SIDE), Work's snapshot (`WorkSnapshot`, `shared/work.ts`) and the Library's held read (LIB-2.1) already carry every member's live state; a Topic joins them by reference. Decisions that apply: [0003](../../decisions/0003-browser-first-react-stack.md) (token and Origin on mutations), [0005](../../decisions/0005-building-blocks-live-outside-lookout.md) and [0010](../../decisions/0010-single-consumer-rules-stay-with-the-consumer.md) (Topics are one consumer's rule and store), [0008](../../decisions/0008-lucide-icons-only.md), [0009](../../decisions/0009-one-design-system-guarded-by-tests.md).

- **The store** (`server/topics.ts`, a `TopicStore` shaped like `SettingsStore`): loads `topics.json` once, keeps it in memory, writes it whole and atomically on every change (a temp file and `rename`, as `server/settings.ts` does), and notifies listeners, which the event stream turns into a `topics` event. Tens of Topics and hundreds of memberships are a few KB; nothing needs SQLite. The shape (TOPIC-8.2), `version: 1`:

  ```json
  { "version": 1,
    "topics": [{ "id": "8f3a…", "title": "Proposals rates", "brief": "…", "state": "open",
                 "createdAt": 0, "updatedAt": 0, "position": { "x": 120, "y": 80 } }],
    "members": [{ "topicId": "8f3a…", "kind": "session",
                  "ref": { "harness": "claude", "sessionId": "51c0…" },
                  "snapshot": { "title": "rates-port", "projectPath": "~/Projects/work" },
                  "addedAt": 0, "reason": "added by you" }],
    "edges": [{ "a": "8f3a…", "b": "c21d…", "label": "part of", "createdAt": 0 }] }
  ```

  Ids are random (`crypto.randomUUID()`), never a slug: a title changes, an id doesn't. The parser rejects unknown kinds and unknown top-level keys, as the settings parser does, and leaves a file it can't read untouched.
- **Member identity.** A Session is `{harness, sessionId}` (HIST passes `--harness` to `show` because one id can exist under two Harnesses); a PR its `url` as `tb-pr` gives it; a Task its Productive id. A Codex Session before its first prompt has only `codex:<pid>` (SIDE Technical approach, Session identity), so it can't be a member yet (TOPIC-2.2). Lookout's row id (`SessionRow.id`, `shared/types.ts`) joins Fleet's list; `sessionId` joins tb-session.
- **Joining live state** happens on the server, where the three snapshots already are: a `TopicsMonitor` builds a `TopicsView` from the store plus Fleet's list (Status, live), Work's `WorkSnapshot` (PR state, CI, Task status, and the Links for the suggestions) and the Library's last read (Outputs per Session), and sends it as the `topics` event. A member a snapshot doesn't have carries its stored snapshot and `inWork: false` (TOPIC-4.2). Work's reads run while Topics is open through the same `PUT /api/work/watch` the Work tab uses (TOPIC-4.3): the tab says it watches, and `WorkMonitor` doesn't care which tab asked.
- **Adding from a row** sends `{kind, ref, snapshot}` to `POST /api/topics/<id>/members`; the snapshot is built in the browser from the row it already shows (a Work row's title and URL, a History result's title and start directory, a Library row's Sessions). The server keeps only the fields it knows and bounds every string (titles 300 characters, paths 1,024).
- **Starting from a Topic** reuses WORK-5's launcher draft (`setWorkDraft` and `openLauncher` in `App.tsx`): the prompt as TOPIC-5.1, the Harness and directory the launcher's last. The server records `{launchId → topicId}` in memory when the launch starts and adds the member once Fleet reports the Session, through the `started` pairs the snapshot already carries (LAUNCH). The `Topic: <id> <title>` line is also the one marker a Building block can see later (tb-session indexes first prompts, WORK-4.3), so a later slice can rebuild membership from it after a reinstall.
- **The graph** is SVG in the main pane, drawn by Lookout's own code: nodes as `<g>` groups with the design system's type and tokens, Edges as paths, drag with pointer events. No graph library in slice 2: 30 nodes don't need one, and the one-shot "Arrange" is a bounded spring layout (a few hundred iterations, no worker). A library (d3-force, elkjs) is a decision for later if "Arrange" proves poor. A node without a position is placed on a spiral away from the others.
- **Routes.** `GET /api/topics` (the view); `POST /api/topics`; `PUT /api/topics/<id>` (title, brief, state, position); `DELETE /api/topics/<id>`; `POST` and `DELETE /api/topics/<id>/members`; `POST` and `DELETE /api/topics/<id>/edges`. Every mutation is token and Origin checked (`server/security.ts`). The client route `/topics` for the graph, like `/h/<harness>/<id>` and `/settings`.
- **Tests.** `(test)`: the store's parser against fixture files (good, unknown version, truncated, unknown kind); the view's joins against recorded Fleet, Work and Library fixtures; the panel's select-then-act and keys; the pickers; the graph's drag and position write. `(e2e)`: TOPIC-4.3 and TOPIC-5.1 to 5.2, which span the server's watch and the launcher; TOPIC-5.2 waits on the Fake Harnesses (TEST-1.4) like WORK-5.1.

### Dependencies

- **Nothing new in the Fleet fork, tb-session, tb-pr or tb-prod** for slices 1 and 2.
- **Design system:** the Topic picker (a modal list with a filter) is new to `components/ui/`; the labelled button (DS-7.1), chips, Alerts and EmptyState exist. A graph node is a new piece, added to the system in the same change (0009).
- **World fakes:** none new; the Worlds' fake Fleet, tb-session, tb-pr and tb-prod serve the joins. `topics.json` lives under the World's `XDG_CONFIG_HOME`.
- **Fake Harnesses** (TEST-1.4) for TOPIC-5.2's Behaviour test, as for WORK-5.1.

### Known gaps

- **A Codex Session before its first prompt can't be added** (TOPIC-2.2); add it once it has an id.
- **Members outlive their sources.** A pruned Session, a merged PR or a closed Task shows its snapshot only (TOPIC-4.2), as old as the day it was added.
- **Sessions started outside Lookout are never added on their own**, even with a `Topic:` line typed by hand; a later slice can read it from tb-session's first prompts.
- **The first-prompt marker is text the agent reads.** `Topic: <id> <title>` is one line it can ignore; it costs a few tokens per Session.
- **The graph has no undo.** "Arrange" moves every node and asks first; a dragged node can be dragged back.
- **"Looks done"** reads Work's open lists, so it never shows before Work has read, and a Task reassigned away from you looks done.

### Key decisions

Draft: the choices below follow from accepted decisions and the sibling specs. Everything else is an open question with a recommendation.

- **Lookout reads nothing new for a Topic**: every member's live state is already in the Session list, Work's snapshot and the Library's read, and a Topic joins them. The header chips were dropped because they needed reads of their own (Backlog, 2026-10-27).
- **A Topic never writes to Productive or GitHub, and every start goes through the launcher** (WORK's Non-goals and Key decisions).
- **Select, then act** (HIST-3.5, WORK-1.12, LIB-3.1): a click expands; a labelled button, a chip or Enter on an expanded Topic acts.
- **Members are references with a snapshot, resolved at read time** (LIB: "Liveness is checked at read time, never stored as truth"): the store never holds a Status, a CI state or a Task status as truth.

## Open questions

Sent to Dario on 2026-10-30, each with evidence and a recommendation; the answers become Key decisions.

1. [ ] **What a Topic is** *(blocking)*: a hand-made bundle (recommended), Stjepan's job (type, brief, steps, gates, parent), or an automatic cluster of WORK's Links.
2. [ ] **Who creates one and when** *(blocking)*: by hand, plus the Sessions Lookout itself starts (recommended); or proposed from Links; or by an agent through a CLI.
3. [ ] **What can be a member** *(blocking)*: Sessions, PRs and Tasks, Outputs through Sessions, no exclusivity (recommended).
4. [ ] **Lifecycle** *(blocking)*: Open and Archived by hand with a "looks done" hint (recommended), or derived states.
5. [ ] **Relation to WORK's Links**: Links are suggestions inside a Topic and a Topic chip on Work rows (recommended), or Topics replace Links.
6. [ ] **Relation to the Library and History**: Outputs through member Sessions, "Add to Topic" on results and rows (recommended).
7. [ ] **What links two Topics** *(blocking)*: explicit undirected Edges with a label, shared members dashed and unstored (recommended); parent and child later.
8. [ ] **Where the graph lives** *(blocking)*: a Topics tab for the list, a main-pane view at `/topics` for the graph (recommended).
9. [ ] **Storage** *(blocking)*: `~/.config/lookout/topics.json`, server-owned (recommended); SQLite; a cli-toolbox CLI; files in a repo.
10. [ ] **Reading member state**: nothing new; Topics open counts as Work open (recommended).
11. [ ] **The first-prompt marker and auto-adding started Sessions**: yes, for Sessions Lookout starts (recommended).
12. [ ] **The smallest first slice** *(blocking)*: the store and the tab without the graph (recommended), or the graph in slice 1.

## Changelog

- 2026-10-30: Created as a Draft from Plan item 18, after reading WORK (Links, Gap 2, the dropped header chips), LIB (Outputs per Session), HIST, SIDE (Session identity), Lookout's stores (`settings.json`, attachments) and Stjepan's `glados` snapshot (a job has a type, a brief, a lead Session, a Task id, a parent and PRs). Twelve open questions sent to Dario with a recommendation each; the criteria follow the recommendations and renumber freely until Ready.
