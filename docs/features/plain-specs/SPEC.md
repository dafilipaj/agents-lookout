---
title: "Spec view: a .plain module and its change, with imported concepts on hover"
code: "PLAIN"
status: "In Progress"
created: "2026-11-04"
updated: "2026-11-05"
---

# Spec view

## Summary

Open a PlainLang Module that a Session or a PR changed and read it in Lookout's main pane, as `/p-plain:page` shows it: the sections, the change since its base marked in place, a Changes card and "Only what changed". New over `/p-plain:page`: hovering a Concept defined in another Module shows that definition, so a reviewer never opens the other file to know what a word means. A Module is marked Viewed once read, so reviewing a PR's spec changes before its code is a step you can see.

## Problem

In fantastic-productive, two in three PRs change a spec: 465 of the 694 commits on `develop` from 2026-10-27 to 2026-11-04 touch `plain/`, almost always one Module each. Reading that change means `/p-plain:page` (an Artifact per Module, published from a terminal) or the raw diff in VS Code. Neither says what the words mean: 684 of `crm.plain`'s 928 Concept references are defined in another Module, mostly `productive` and `shell`, and `/p-plain:page` marks each one only as "defined in an imported module". So a reviewer reads the PR's spec with a second file open, or skips the spec and reads the code.

## Requirements

Rendering and resolution are `(test)` against fixtures (fantastic-productive's Modules, copied into the test tree); the flows across the server and the UI are `(e2e)` in a World with a real repo ([0007](../../decisions/0007-behaviour-tests-from-spec-requirements.md)); the look is `(manual)`.

### PLAIN-1 The Spec view

A Module shown whole in the main pane, with its change since the base marked in place.

- [x] PLAIN-1.1 The Spec view opens at its own URL, `/plain/<Session id>/<Checkout id>/<module path>`, where the Checkout id names a Checkout Lookout knows (PLAIN-6.1), or `/plain/pr/<repo>/<number>/<module path>` for a PR's Module (PLAIN-5), and the path is one encoded segment, so a reload keeps it, ⌘-click opens it in a new browser tab and Back returns to where it was opened from. It takes the main pane; the right sidebar stays as it was. (test)
- [x] PLAIN-1.2 Its header names the Module (`crm.plain`), its path in the Checkout, its description, and the Checkout (repo and Worktree or branch, as DIFF-3.2 heads a Checkout); its `import` and `requires` Modules are listed, each a link that opens that Module in the Spec view (PLAIN-2.5). (test)
- [x] PLAIN-1.3 Its sections are those of `/p-plain:page` (p-plain 0.6.1), in the same order: definitions, implementation reqs, test reqs, functional specs with their nested acceptance tests, and the Module's notes. A section nav beside the content ("On this page", PLAIN-8.2) lists them with their counts, and the touched ones are marked; in a main pane narrower than 640 px it sits above the content (as DS-13.1's side nav). (test)
- [x] PLAIN-1.4 Inside the Module, a `:Concept:` defined in it links to its definition, a `§N.M` to that functional spec, and a predefined Concept (`:UnitTests:`, `:ConformanceTests:`, `:AcceptanceTest:`, `:AcceptanceTests:`, `:Implementation:`) is marked as predefined by plain. Code spans stay code. (test)
- [x] PLAIN-1.5 The text is the Module as it is in the Checkout's working tree, uncommitted edits included. The base is the Checkout's Branch point, the one DIFF counts from (DIFF-2.3), so the view and DIFF's `+ −` agree. A Module new since the Branch point shows every clause as added; a deleted one shows its base text, every clause removed; an unchanged one shows no marks and no Changes card. (test)
- [x] PLAIN-1.6 Changed clauses are marked in place, as `/p-plain:page` tells them apart: added, removed, and rewritten with the word-level change inside the clause (drawn as PLAIN-8.3 says). The Changes card at the top counts added, changed and removed clauses, links to each touched spec or section (PLAIN-8.4), and has "Highlight changes" (on); "Only what changed" (off, in the header since PLAIN-8.6) hides every untouched clause and section. (test)
- [x] PLAIN-1.7 While the view is open, the Module and its base are read again every 3 s; when either differs, the view updates in place and keeps its scroll position, and the clauses that changed since the last read are briefly marked as just changed (as DIFF-3.8). (test)
- [x] PLAIN-1.8 A file that can't be read (gone from the Checkout and the base, not a `.plain` file, larger than 1 MB) shows an Alert (DS-4) saying why, with no content. Text the parser can't place in a section is shown under "Not in a section" as plain text, so nothing in the Module is hidden. (test)
- [x] PLAIN-1.9 Seen in both modes from a 480 px main pane to a wide one, on `crm.plain` (1240 lines) with a change in each kind of section: the marks read as `/p-plain:page`'s do, with the design system's colours (DS-2.5's `diff-added` and `diff-removed` families), the nav never hides the content, and scrolling stays smooth. (manual)

### PLAIN-2 Concepts from other Modules

A Concept used in the Module but defined in another one shows that definition on hover or focus.

- [x] PLAIN-2.1 A Module's visible Concepts are its own definitions, every definition of the Modules it imports and of theirs in turn (imports are transitive), and the `exported_concepts` of each Module it `requires` (not transitive). An import or `requires` path is resolved from the importing Module's own folder, with `.plain` added. A cycle is read once. (test)
- [x] PLAIN-2.2 A `:Concept:` from another Module is a focusable term; hovering it, or focusing it with Tab, opens a popover (the design system's) with the definition whole, its nested bullets included, the Module it comes from, and "Open <module>" (PLAIN-2.5). Esc or leaving it closes the popover. (test)
- [x] PLAIN-2.3 When that definition differs between the base and the working tree, the popover says "Changed in this branch" and shows its change marked as PLAIN-1.6 marks a clause. (test)
- [x] PLAIN-2.4 A Concept whose Module isn't there (an import path with no file, such as fantastic-productive's `providers/…` Modules, which are fetched and never committed) can't be told apart from one defined nowhere, so a Concept found in no visible Module shows "Not in the Modules this one reads here; it may be defined in `providers/exporter/exporter-public`, which isn't in this Checkout" when some of its Modules are missing, and "Not defined in any Module this one reads" when none are. Neither breaks the rest of the view. (test)
- [x] PLAIN-2.5 "Open <module>" and the header's import links open that Module in the Spec view, in the same Checkout, at the same base, as a new history entry, so Back returns to the Module and scroll position you came from. (test)
- [x] PLAIN-2.6 Resolution is done on the server, once per read of the Module (PLAIN-1.7), and a Module's imports are read from the same working tree and base as the Module itself. With fantastic-productive's `crm.plain` and its imports, a read takes under 500 ms on this Mac. (test)

### PLAIN-3 Open from a Session's changed files

Slice 1: the Spec view opens from DIFF's list.

- [ ] PLAIN-3.1 In DIFF's list of changed files (DIFF-3.1), clicking a `.plain` file, or Enter on it, opens it in the Spec view (DIFF-4.1's `code --diff` is not run). Its row gets a second action, "Open in VS Code", that does what DIFF-4 does for any file. (e2e)
- [x] PLAIN-3.2 The Spec view's header has "Back to <Session title>", which returns to that Session's view with its list closed; Back in the browser does the same. (test)
- [x] PLAIN-3.3 A `.plain` file's row in DIFF's list shows the Module's Viewed mark (PLAIN-4) in place of DIFF-3.7's, so both lists agree. (test)

### PLAIN-4 Viewed

A Module you've read is marked Viewed, kept across reloads, until it changes again.

- [x] PLAIN-4.1 The Spec view's header has a "Viewed" checkbox, as GitHub's; `V` toggles it with focus outside a text field. Opening a Module doesn't tick it. (test)
- [x] PLAIN-4.2 A Viewed mark is kept by the server, in `~/.lookout/plain-viewed.json` (mode `0600`), keyed by the repo (its common directory), the Module's path, and a hash of its text and its base text, so the same change seen from a Worktree and from its PR (PLAIN-5) shares one mark. It survives reloads and restarts; marks not used for 30 days are dropped. (test)
- [x] PLAIN-4.3 When the Module's text or its base changes, its mark no longer applies: the checkbox is clear, and the view says "Changed since you viewed it" above the Changes card. (test)
- [x] PLAIN-4.4 Nothing blocks or delays opening a PR. Viewed is a mark for you, not a gate. (test)

### PLAIN-5 Open from a PR in Work

Slice 2: a PR's Modules, your own and a Review request alike, read from GitHub's head of the PR.

- [ ] PLAIN-5.1 An expanded PR or Review request row in Work (WORK-6) has "Specs" under its "More" (DS-16) in a repo Lookout has a local clone of (PLAIN-5.2), a submenu that lists the PR's changed `.plain` Modules, each opening the Spec view, with its Viewed mark; with none, it says "No spec changes in this PR". `S` with the PR selected opens "More" with Specs open, expanding the row; Esc closes them and gives focus back to Work's list. Back from a Module opened so returns to what the main pane showed when it was opened, another Spec view included. (e2e)
  - Open: the component tests cover the button, the list, its Viewed marks, "No spec changes in this PR" and opening a Module; this waits on a World with a real repo and its `refs/pull/*`, as PLAIN-3.1 does.
- [x] PLAIN-5.2 Lookout fetches the PR's head into a clone of its repo it already knows (a Start directory's repo, a live Session's working directory or Checkout, or one found so before and remembered in `~/.lookout/plain-clones.json`, each matched by its `origin` remote's URL, `github.com/productiveio/<repo>` in any form git takes): `git fetch origin +refs/pull/<n>/head:refs/lookout/pr/<n>/head +refs/heads/<base>:refs/lookout/pr/<n>/base`, without tags, FETCH_HEAD, submodules or a gc. The base branch is tb-pr's `base_branch` from Work's last read, else `gh pr view <n> --repo productiveio/<repo> --json baseRefName`, asked on every fetch so a retargeted PR is compared with its new base, and the base last known when gh can't answer. The fetch never asks for anything: no terminal prompt, askpass or interactive credential helper, and ssh in batch mode; saved credentials still work. It never checks out, never changes a working tree, the index, a branch or a remote-tracking ref, and deletes `refs/lookout/pr/*` refs not fetched for a day, and those an earlier run of Lookout fetched, at start and every hour, never those of a fetch still in flight. (test)
- [x] PLAIN-5.3 For a PR, the text is the Module at the PR's head commit and the base is the merge-base of that commit with the PR's base branch, as GitHub's "Files changed" compares; imports are read from the same commits (PLAIN-2.6). The Changes card names the base "merge-base with <base branch>". A newer push is fetched when the Spec view or the "Specs" list opens and every 60 s while one is open; the view's 3 s reads (PLAIN-1.7) answer from the last fetch meanwhile. (test)
- [x] PLAIN-5.4 Without a clone of the PR's repo, the button is absent and the row's tooltip on the PR says why once ("No local clone of fantastic-productive"). A fetch that fails (offline, no access, no such PR) shows its error in the list, with Retry, which fetches again at once. Once a PR is fetched, a later failure keeps what was fetched and the Spec view says so above the Changes card ("Showing #2992 as fetched before", with the error). (test)

### PLAIN-6 Safety

- [x] PLAIN-6.1 The server reads only from Checkouts it knows: a live Session's Checkout from DIFF (DIFF-2), or a PR's fetched commits (PLAIN-5.2). The URL's `checkout` is an id Lookout issued for one of those, never a path, and a PR is named by its repo (letters, digits, `.`, `_`, `-`) and number, which Lookout turns into a clone it knows; a `path` that leaves the Checkout (`..`, an absolute path, a symlink out of it) or isn't `.plain` is refused. (test)
- [x] PLAIN-6.2 Reading a Module runs only `git` (`show`, `merge-base`, `rev-parse`, `diff --name-only`, `config --get remote.origin.url`, and PLAIN-5.2's `fetch`, `for-each-ref` and `update-ref` of its own `refs/lookout/pr/*`), with the clone's hooks and fsmonitor off and no password prompt, PLAIN-5.2's `gh pr view`, and file reads. Nothing in a Module is executed, fetched or rendered as HTML: its text is shown as text, its links (PLAIN-1.4, PLAIN-2.5) are Lookout's own. (test)

### PLAIN-8 Reading and stepping through a change

The Module reads as one centred column, as the chat does. Its outline sits beside it, and its changes are marks you step through, as the chat's bookmarks are.

- [x] PLAIN-8.1 The Module's text is one column at most 48rem wide, the chat's width (VIEW-1), centred in the main pane while the pane has room for it and the outline (PLAIN-8.2) on its right; in a narrower pane it moves left only as far as the outline needs, then narrows. Nothing in it widens the pane: a long code span or word wraps, so the main pane never scrolls sideways. (test)
- [x] PLAIN-8.2 The section nav (PLAIN-1.3) is "On this page", on the column's right. It lists the sections with their counts and, under Functional specs, the changed specs, each with its id, its gist (up to two lines) and its mark: `+` new, `−` removed, `~` changed. "Show all N specs" lists every spec, and a Module with no change lists every spec from the start. The entry for the section or spec at the top of the view is marked (`aria-current="location"`) and follows scrolling; an unlisted spec marks Functional specs. (test)
- [x] PLAIN-8.3 A changed clause, note or definition is marked by a bar at its left edge, not by a word: `diff-added` for added, `diff-removed` for removed, `muted-foreground` for rewritten. Its state is named to screen readers only. An added clause has no fill; a removed one is struck through in `muted-foreground`; a rewritten one keeps its inserted and deleted words marked (PLAIN-1.6). A changed spec has no border, and its heading carries its counts (`+2 ~1 −1`). (test)
- [x] PLAIN-8.4 The Changes card has one row per touched spec or section, not one per part of it: its id or name, its gist, and its counts summed over its clauses, acceptance tests and notes, naming tests and notes when they are among them. A new or removed spec says so. (test)
- [x] PLAIN-8.5 Each change is a mark on a rail beside the view's scroll bar, at its place in the Module's full height. A change is an added, removed or rewritten clause, note or definition, or the description (rewritten, or added or removed with its Module). The rail is the chat's (VIEW-1.11), each mark a short bar in its change's colour. Clicking a mark scrolls to its change and moves focus there, where the arrow keys scroll the view, as in the chat; hovering or focusing it shows the change's first line, its kind and its spec or section. The rail is hidden when nothing changed, when "Highlight changes" is off, and when the view is too narrow, as the chat's is. (test)
- [x] PLAIN-8.6 `[` and `]` jump to the previous and next change, as in the chat (VIEW-1.11): only with focus outside a text field and no dialog open, with the change landing just below the view's top edge (below PLAIN-9.3's strip, since PLAIN-9). The header shows where you are ("3 of 28": the change last jumped to, or the last one scrolled past; "28 changes" before the first), with Previous and Next change buttons. "Only what changed" moves from the Changes card to the header, so both stay in reach while you scroll; in a pane too narrow for the header, Back shows its arrow alone and the box reads "Changed only". The place you jumped to is kept until you scroll yourself, follow a link in the view or go Back; Space pressing a button doesn't count as scrolling, and a read that changes which changes there are lets go. (test)
- [x] PLAIN-8.7 Seen in both modes, from a 480 px main pane to a wide one, on `crm.plain` with PR #3338's change: the column lines up with the chat's, the outline sits beside it, nothing scrolls sideways, the bars and the rail read as one change, and `[`/`]` step through every change in order. (manual)

### PLAIN-9 Reading a Module

The Module reads at a book's line length, and each functional spec reads as one unit with a heading of its own.

- [x] PLAIN-9.1 The Module's own text is in the `reading` step (DS-1.1, 16 / 26 px): its description, every clause, a definition's term and body, and a spec's acceptance tests. Its notes are `prose`, quieter than its clauses, and a code span is `prose` wherever it sits. The Module is at most 42rem wide, about 85 characters a line, from the left edge of PLAIN-8.1's column, which stays where it is: the text no longer fills the column, and the room before "On this page" grows by 6rem. (test)
- [x] PLAIN-9.2 A functional spec opens with a heading: its gist (PLAIN-8.2's), wrapped, never cut, in `reading-title` (DS-1.1, 20 / 28 px), and under it, in `meta`, its counts (PLAIN-8.3), "New spec" or "Spec removed". Its id hangs in the margin left of the heading, right-aligned, in `meta` monospace, in a main pane at least 73rem wide; in a narrower one it sits above the heading. More space comes before a spec than between its clauses. (test)
- [x] PLAIN-9.3 While the view's top edge is inside a functional spec whose heading has scrolled out of sight, a strip pinned to the top of the column names it: its id, its gist on one line and its counts. Clicking it scrolls to the spec's heading. The strip takes no room in the page, so it showing or hiding never moves the text. A change you jump to (PLAIN-8.5, 8.6), a spec or section opened from the outline or the strip, and an element Tab moves focus to land below where the strip sits, not under it, and what lands there is where you are in "On this page" (PLAIN-8.2). (test)
- [x] PLAIN-9.4 A spec's acceptance tests follow its clauses in a box of their own, headed "Acceptance tests". (test)
- [x] PLAIN-9.5 A spec's notes follow its acceptance tests, behind a button "Notes" with their count: closed when none of them changed, open when one did, and opened or closed by hand after that while the view stays open. With "Only what changed", a spec's unchanged notes are hidden, as before. (test)
- [x] PLAIN-9.6 Every change bar in the Module (PLAIN-8.3) sits in one gutter, 0.75rem left of the column's text edge, whatever the depth of its clause: a nested clause's, a note's, a definition's and an acceptance test's bars line up with a top-level clause's. A Concept's popover (PLAIN-2.2) keeps its own. (test)
- [x] PLAIN-9.7 Seen in both modes, from a 480 px main pane to a wide one, on `crm.plain` with PR #3338's change: lines read at about 85 characters, each spec starts at a heading you can't miss, the strip names the spec you're in without covering a change you stepped to, the bars run in one line, and nothing scrolls sideways. (manual)

## Non-goals

- **Talking back to the Session from the view** (select a clause, "Ask the Session about this"). In the Backlog.
- **Editing a Module.** "Open in VS Code" (PLAIN-3.1) is where you edit.
- **Comments on clauses**, or posting a review to GitHub.
- **Ability-key links** (`/p-plain:page`'s `--ability-url`): Lookout doesn't know a repo's catalogue URL.
- **Gating a PR on Viewed** (PLAIN-4.4). A gate belongs in `/p-dev:open-pr` if anywhere.
- **Checking a Module**: syntax errors, Concept collisions, missing `required_concepts`. That is `/p-plain:plain`'s and codeplain's job.
- **Fetching provider Modules** from other repos (fantastic-productive's `providers.json`). PLAIN-2.4 says they're missing.
- **Publishing** the view as an Artifact or a Share. `/p-plain:page` still does that, for a reviewer outside Lookout.
- **Moving the resolver into p-plain or a CLI.** Lookout is its only consumer today (0010); it moves when `/p-plain:page` wants the popover too.

## UX

```
┌ Session sidebar ┬ main pane ──────────────────────────────────────────────────────────┬ right ┐
│                 │ ← Back   crm.plain       [↑] 3 of 28 [↓]  [ ] Only what changed  [ ] Viewed │   │
│                 │            plain/crm.plain · fantastic-productive · #3338    │ On this page   ┆│   │
│                 │            Deals on a pipeline board, proposals … §16.       │ Changes        ┆│   │
│                 │            ┌ Changes against develop ──── 16 added … ┐       │ Definitions 13 ┆│   │
│                 │            │ §16.5.28  People tab add button +9 ~3 −3 │       │ Functional 156 ┆│   │
│                 │            │ §16.5.28.1 Kinds a reader may add  new   │       │ ┃§16.5.28 …   ~ ━│   │
│                 │            └ [x] Highlight changes ───────────────────┘       │  §16.5.28.1 … + ┆│   │
│                 │            §16.5.28 A client Company's People tab… +4 ~3 −1  │                ━│   │
│                 │          ▌ • A client Company's People tab offers ~~Add~~ one │                ┆│   │
│                 │          ▌   • With one kind allowed it reads "Add contact" … │                ━│   │
│                 │            ←───────── 48rem column, centred ────────→        │   rail of marks ┘│   │
└─────────────────┴───────────────────────────────────────────────────────────────────────────┴───────┘
```
- Type and colour from the design system: clause text in `body`, the header's path and Checkout in `meta`, added and removed from DS-2.5's diff families (the same green and red as DIFF's `+ −`), a rewritten clause's inserted and deleted words likewise. Nothing in Status colours (DS-3).
- A term from another Module is underlined dotted in the text colour; a local one is a plain link to its definition; a predefined one is `muted-foreground`.
- Keyboard: Tab moves through the header's links, the Viewed box, the nav and the terms; `V` toggles Viewed; Esc closes a popover, then does what Esc does in the main pane.
- Loading: the design system's Loading (DS-6) in the content while the first read runs; later reads (PLAIN-1.7) show nothing while they run.
- Empty: a Module with no clauses shows its header and "This Module is empty".

## Technical approach

- **Parser and diff** in `shared/plain/`, in TypeScript, ported from p-plain 0.6.1's `page-template.html` (its `parse`, `lcs`, `wordDiff`, `diffContainer`), with tests on fantastic-productive's Modules copied into the test fixtures. The output is a tree of sections and clauses, each with its state (`same`, `added`, `removed`, `changed` with its old text).
- **Resolution** on the server (`server/plain.ts`): read the Module and its base with `git show <ref>:<path>` (the working tree for the head of a Checkout), walk `import` transitively and `requires` one level for `exported_concepts`, and answer the Module's tree with a map of every visible Concept to `{ module, text, baseText | null, state }`. One endpoint, `GET /api/plain?checkout=&path=`, answers the lot; the client renders it.
- **Checkout ids** come from DIFF's answer (each candidate Checkout gets an opaque id for its path); a PR is named by its repo and number, which the server maps to a clone it knows (`server/plain-prs.ts`), so the URL never carries a path (PLAIN-6.1).
- **Viewed** in `~/.lookout/plain-viewed.json`, as `{ key: { at } }`, written atomically, read once at start.
- **Work** (slice 2) gets the PR's base branch from `tb-pr` 0.4.0's `base_branch` (confirmed in its `--json`); for a PR Work hasn't read, `gh pr view --json baseRefName`, through the repo flag.
- **Building blocks**: git and the existing Fleet `diff` answer; `tb-pr` for slice 2. No new CLI (0005, 0010).
- Decisions: [0005](../../decisions/0005-building-blocks-live-outside-lookout.md), [0010](../../decisions/0010-single-consumer-rules-stay-with-the-consumer.md), [0009](../../decisions/0009-one-design-system-guarded-by-tests.md).

### Other specs to amend

Each with its own requirement and Changelog line, in the slice that needs it:

- **DS** (slice 1): DS-2.5's diff family is used by PLAIN too, and gains two tints for an added and a removed clause's background, with their contrast checked as DS-2.2's are; the colour guard's row lists PLAIN's files.
- **DIFF** (slice 1): DIFF-3.1 and DIFF-4.1, a `.plain` file opens the Spec view and "Open in VS Code" is its second action (PLAIN-3.1); DIFF-3.7, a `.plain` file's Viewed mark is PLAIN-4's (PLAIN-3.3).
- **VIEW** (PLAIN-8): VIEW-1.11's rail takes a change's marks too, for the Spec view; the chat's are as they were.
- **DS** (PLAIN-8): the colour guard lets the rail use the diff family for a change's mark.
- **WORK** (slice 2): WORK-6, the "Specs" button on an expanded PR or Review request row (PLAIN-5.1).

### Key decisions

- **Lookout renders it, on its own design system, not `page.mjs` in an iframe** (Dario, 2026-11-04): an iframe can't share Lookout's keyboard, Viewed marks or themes, and changing `page.mjs` waits on its owners' reviews.
- **The resolver stays in Lookout** (Dario, 2026-11-04): Lookout is its only consumer (0010); it moves to a CLI or p-plain when a second one wants it.
- **Two slices: a Session's changed files first, Work's PRs second** (Dario, 2026-11-04): your own PRs come from a Session whose Checkout DIFF already knows; a Review request has no Checkout and needs a fetch.
- **The main pane, at its own URL** (Dario, 2026-11-04): a 1,200-line Module needs the width, and a URL gives reload, new tab and Back.
- **The base is DIFF's Branch point, imports from the same tree** (Dario, 2026-11-04): the view and DIFF's count never disagree, and a Concept's popover shows the definition as this branch has it.
- **Viewed is explicit and persisted** (Dario, 2026-11-04): opening a long Module isn't reading it, and a review spans reloads; DIFF-3.7's marks, kept until a reload, are too short-lived for that.
- **Reading and stepping (PLAIN-8): option A of three drawn, with B's change stepper** (Dario, 2026-11-05, https://claude.ai/artifact/QtSAwRw2w1WjkjFHcfz5eN): the column centred as the chat's, the outline on its right, bars instead of words. C, the outline as a sidebar-style panel, took the most width and added a fourth column.
- **A change is a bookmark** (Dario, 2026-11-05): "On this page" is the Module's structure, which the chat doesn't have; stepping through changes is what the chat's bookmarks do, so it is the same rail and the same `[`/`]`, not a third kind of navigation with its own keys.
- **Reading a Module (PLAIN-9): ideas 1 and 2 of three drawn, nothing from the third** (Dario, 2026-11-05, https://claude.ai/artifact/1B7FmUEyqXzR2WoUGBmQrD). Measured on `crm.plain` before it: 14 px text at about 111 characters a line, against 45 to 75 in the research (Bringhurst; Dyson and Haselgrove; Nanavati and Bias, 2005) and WCAG 1.4.8's 80; and a spec's heading the size of its text, so one spec ran into the next. Idea 3, quieter terms and folded removals, was left out: underlining a term only at its first use, and folding removed clauses and a rewrite's old words, hide what a review is for.
- **Two type steps of its own, not a bigger `prose`** (Dario, 2026-11-05): the chat stays at 14 px; a Module of 1,200 lines is read like a book, not scanned like a row. DS-1.1 amended.
- **The column's left edge stays the chat's** (Dario, 2026-11-05): the text stops short of the 48rem column's right edge rather than a narrower column centred on its own.
- **42rem, not 36rem** (Dario, 2026-11-05, after seeing it): 36rem (74 characters a line, measured on `crm.plain`) left the text small in the middle of a wide pane. 42rem measures 86, past the research's 75 and WCAG 1.4.8's 80, traded for a fuller column; the gap before "On this page" is 6rem instead of 12.
- **A rewritten clause's colour is `muted-foreground`** (2026-11-05): DS-2.5's diff family has added and removed only, and a third hue would read as a Status (DS-3.6); the words inside it carry the green and red.
- **No gate on opening a PR** (Dario, 2026-11-04): Lookout can't enforce it; the harness rule puts gates in the CLIs and hooks.

## Open questions

None.

## Changelog

- 2026-11-04: Created from Plan item 31 and grilled with Dario the same day; every question as recommended (renderer, entry points and slices, place, base and imports, Viewed, no talking back). Ready.
- 2026-11-04: Slice 1 built: `shared/plain.ts` (the parser and diff, ported from p-plain 0.6.1's page template), `server/plain.ts` (reads, resolution, Viewed in `~/.lookout/plain-viewed.json`), `GET /api/plain`, `GET`/`POST /api/plain/viewed`, `SpecView.tsx`, and DIFF's list opening a `.plain` file in it. PLAIN-1.1's URL carries the Session and the Checkout id in the path, since Lookout's router reads only the path. PLAIN-2.4: a Concept's Module can't be known when its import is missing, so the card names the missing Modules as where it may be. Ticked: every `(test)` criterion of slice 1. Open: PLAIN-3.1 `(e2e)`, which waits on DIFF's World with a real Fleet (DIFF-1.3, 3.1 and 4.1 are open for the same reason), and PLAIN-1.9 `(manual)`, Dario's look. Fixtures: the 8 fantastic-productive Modules `crm.plain` reaches, at `d9353385cf`.
- 2026-11-04: Codex review, round 1 (Sol, high: 4 major, 6 minor), all fixed. A Module's `>` notes inside its sections, which the page template drops (16 in `crm.plain`), and text before a section's first bullet are kept and shown (PLAIN-1.8); notes are diffed with their spec. Viewed keeps every Viewed change of a Module, not one per Module, so two Worktrees' versions don't evict each other; saves are queued; a mark still read counts as used, and expiry runs without a restart (PLAIN-4.2). The working tree is read through one handle opened without following a link and resolved again afterwards (PLAIN-6.1). In the view: a save that ends after a newer read leaves it standing, a refusal on a later read clears the content, Back restores the scroll position (PLAIN-2.5), and links to Modules are real links, ⌘-click included in DIFF's list (PLAIN-1.1).
- 2026-11-04: Codex review, round 2 (the last; 1 major, 5 minor), fixed without a further round. The opened file must be the file the path names after the read (device and inode), so a folder swapped for a link and back is refused too; a swap toggled twice between the two final checks remains possible in principle, and is accepted, since only the user's own processes write to a Checkout and the page shows it only to the user. No cap on the changes of a Module kept Viewed: 30 days unused is the only limit. A section holding only notes is shown; a note between a clause and its nested bullet keeps the nesting; text before the first spec is kept once; the scroll position is kept per history entry, not per URL.
- 2026-11-04: Slice 2 built: `server/plain-prs.ts` (finds a clone by `origin`, fetches a PR into `refs/lookout/pr/<n>/head` and `…/base`, lists its changed Modules against the merge-base, sweeps old refs), `GET /api/plain/pr`, `GET /api/plain/clones`, the PR source on `GET /api/plain` and `POST /api/plain/viewed`, the route `/plain/pr/<repo>/<number>/<path>` (PLAIN-1.1), and Work's "Specs" button (`PrSpecs.tsx`). `tb-pr` 0.4.0 gives `base_branch`, so the open question is closed. PLAIN-5.2: the refs are `refs/lookout/pr/<n>/head` and `…/base`, two refs per PR, since a ref can't also be a folder; a clone found once is remembered, since a Review request's repo is often no live Session's; refs an earlier run fetched go at start, since their age isn't known. PLAIN-5.4: a failure after a fetch that worked keeps it and says so in the view. PLAIN-6.1 and 6.2 name the PR's repo and number and the git and gh commands it adds. Ticked: PLAIN-5.2 to 5.4. Open: PLAIN-5.1 `(e2e)`, which waits on a World with a real repo, as PLAIN-3.1 does.
- 2026-11-04: Codex review of slice 2, round 1 (Sol, high: 5 major, 2 minor), all fixed. The fetch passes `--refmap=`, so fetching the base branch no longer moves `origin/<base>` (the test that should have caught it compared empty ref lists); it can't prompt (askpass, credential helper and ssh passphrase off); a sweep spares a fetch in flight; without Work's base branch gh is asked on every fetch, so a retargeted PR follows its new base (PLAIN-5.2). `S` opens a selected PR's Specs, Esc gives focus back to Work's list without collapsing the row, and Back returns to the view that opened it (PLAIN-5.1).
- 2026-11-05: Codex review of slice 2, round 2 (the last; 1 major, 3 minor), fixed without a further round. A clone's fetches and sweeps run one at a time, so a sweep can't delete the refs of a fetch that started after it; the fetch's ssh keeps git's own order (`GIT_SSH_COMMAND`, then `core.sshCommand`, then `GIT_SSH`), adding `BatchMode=yes` only to a plain `ssh` (PLAIN-5.2). Back is kept per PR Spec view, so Back through a PR opened from another PR's Spec view steps through both; closing Specs gives focus back to Work's list only when it was lost, never taken from another control (PLAIN-5.1).
- 2026-11-05: PLAIN-5.1 amended for DS-16: "Specs" is a submenu of the row's "More", no longer a button with its own list; `S` opens it there.
- 2026-11-05: PLAIN-1.9 ticked: Dario checked and confirmed it.
- 2026-11-05: Added PLAIN-8, reading and stepping through a change (Dario: the view sits on the left while the chat and Topics are centred, its nav has a style of its own, and it could read better). Drawn as three options on a canvas (https://claude.ai/artifact/QtSAwRw2w1WjkjFHcfz5eN); Dario chose A with B's stepper, and agreed that stepping through changes is the chat's bookmarks (VIEW-1.11): the same rail and `[`/`]`. Found on 4747: a long code span widened the pane, which scrolled 51 px sideways (PLAIN-8.1). PLAIN-1.3 and 1.6 amended; VIEW and DS amended ("Other specs to amend").
- 2026-11-05: PLAIN-8 built. `SpecView.tsx`: the layout is a three-column grid (`1fr`, `48rem`, `15rem`–`1fr`), so the column is centred until the outline needs the room; "On this page" follows the scroll position; bars are `before:` on the clause's own block, so a parent's bar doesn't run down its nested clauses. Every change on screen is read from the page after a render (`data-change`), so the Marks follow "Only what changed" and Highlight. `ChatRail` takes a landmark name and change kinds (`lib/marks.ts`), and `PlainView` an optional rail beside its scroll box (`Shell.tsx`). Ticked: PLAIN-8.1 to 8.6. Open: PLAIN-8.7 `(manual)`, Dario's look.
- 2026-11-05: Codex review of PLAIN-8, round 1 (Sol, high: 3 major, 4 minor), all fixed. Each read clears every Mark's cursor before giving them out again, so a node React kept can't carry a stale one. The view's scroll box carries `data-scroll-keys`, so after a jump from the rail the arrow keys scroll it, not the Session list (SIDE-5). The header fits a 480 px pane (PLAIN-8.6). Space pressing a button keeps the hold; a link in the view, Back and Forward let go of it. `[`/`]` don't step while the Concept card is open. A new or deleted Module's description is an added or removed change (PLAIN-8.5).
- 2026-11-05: Codex review of PLAIN-8, round 2 (the last; 3 minor), fixed without a further round. A description deleted from a Module is a rewritten change. A read that gives the changes other cursors lets go of the hold, which would otherwise step from the wrong change. Space on a link scrolls the view, so it lets go of the hold too; only a button's Space keeps it (PLAIN-8.6).
- 2026-11-05: PLAIN-8.7 ticked: Dario checked and confirmed it.
- 2026-11-05: Added PLAIN-9, reading a Module (Dario: ideas for its readability, research first). Three ideas drawn on a canvas (https://claude.ai/artifact/1B7FmUEyqXzR2WoUGBmQrD): shorter lines and bigger type, a spec as one unit, quieter terms and marks. Dario chose the first two and nothing from the third, with two type steps of the Spec view's own (DS-1.1 amended) and the column's left edge kept. PLAIN-8.6 amended: a change you jump to lands below PLAIN-9.3's strip.
- 2026-11-05: PLAIN-9 built. `index.css` has the two steps (`reading`, `reading-title`), `cn()` knows them. `SpecView.tsx`: the Module is `max-w-[36rem]`; a spec's heading is a `header` with its id hanging by a `@min-[73rem]` container query; the strip is a `sticky top-0 h-0` holder at the top of the column, with the spec found from the scroll position as PLAIN-8.2's current entry is, and every jump and "3 of 28" measured from below it (`STRIP_PX`, 36 px); a list given an `inset` puts its bars at `--bar-x`, so they share one gutter; the notes' button is the chat's tool-calls disclosure. Notes lost their left border, which the gutter's bars would have doubled. Ticked: PLAIN-9.1 to 9.6. Open: PLAIN-9.7 `(manual)`, Dario's look.
- 2026-11-05: Opus review of PLAIN-9 (high: 1 major, 1 medium, 1 minor), all fixed. Opening or closing a spec's notes reads the Marks again, so a folded change leaves no dead Mark on the rail (PLAIN-9.5). An outline or strip link landed its spec 48 px down and "On this page" then marked the spec before it: the scroll box keeps the strip's room clear for links and focus (`scroll-pt-9`), and the outline's current entry counts from below the strip, as jumps do (PLAIN-9.3 amended).
- 2026-11-05: PLAIN-9.1 amended: the Module is at most 42rem wide (86 characters a line, measured), not 36rem (74); Dario found 36rem too narrow in a wide pane.
- 2026-11-05: Dario tested and confirmed the feature (Plan item 31); PLAIN-9.7 ticked. PLAIN-3.1 and 5.1 are `(e2e)` and stay open until a World has a real repo to open a `.plain` change from.
