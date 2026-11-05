---
title: "Spec view: a .plain module and its change, with imported concepts on hover"
code: "PLAIN"
status: "In Progress"
created: "2026-11-04"
updated: "2026-11-04"
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
- [x] PLAIN-1.3 Its sections are those of `/p-plain:page` (p-plain 0.6.1), in the same order: definitions, implementation reqs, test reqs, functional specs with their nested acceptance tests, and the Module's notes. A section nav beside the content lists them with their counts, and the touched ones are marked; in a main pane narrower than 640 px it sits above the content (as DS-13.1's side nav). (test)
- [x] PLAIN-1.4 Inside the Module, a `:Concept:` defined in it links to its definition, a `§N.M` to that functional spec, and a predefined Concept (`:UnitTests:`, `:ConformanceTests:`, `:AcceptanceTest:`, `:AcceptanceTests:`, `:Implementation:`) is marked as predefined by plain. Code spans stay code. (test)
- [x] PLAIN-1.5 The text is the Module as it is in the Checkout's working tree, uncommitted edits included. The base is the Checkout's Branch point, the one DIFF counts from (DIFF-2.3), so the view and DIFF's `+ −` agree. A Module new since the Branch point shows every clause as added; a deleted one shows its base text, every clause removed; an unchanged one shows no marks and no Changes card. (test)
- [x] PLAIN-1.6 Changed clauses are marked in place as `/p-plain:page` marks them: added, removed, and rewritten with the word-level change inside the clause. The Changes card at the top counts added, changed and removed clauses, links to each touched one, and has "Highlight changes" (on) and "Only what changed" (off), which hides every untouched clause and section. (test)
- [x] PLAIN-1.7 While the view is open, the Module and its base are read again every 3 s; when either differs, the view updates in place and keeps its scroll position, and the clauses that changed since the last read are briefly marked as just changed (as DIFF-3.8). (test)
- [x] PLAIN-1.8 A file that can't be read (gone from the Checkout and the base, not a `.plain` file, larger than 1 MB) shows an Alert (DS-4) saying why, with no content. Text the parser can't place in a section is shown under "Not in a section" as plain text, so nothing in the Module is hidden. (test)
- [ ] PLAIN-1.9 Seen in both modes from a 480 px main pane to a wide one, on `crm.plain` (1240 lines) with a change in each kind of section: the marks read as `/p-plain:page`'s do, with the design system's colours (DS-2.5's `diff-added` and `diff-removed` families), the nav never hides the content, and scrolling stays smooth. (manual)

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

- [ ] PLAIN-5.1 An expanded PR or Review request row in Work (WORK-6) has a labelled button "Specs" in a repo Lookout has a local clone of (PLAIN-5.2). It lists the PR's changed `.plain` Modules, each opening the Spec view, with its Viewed mark; with none, it says "No spec changes in this PR". `S` with the PR selected does the same, expanding it; Esc closes the list and gives focus back to Work's list. Back from a Module opened so returns to what the main pane showed when it was opened, another Spec view included. (e2e)
  - Open: the component tests cover the button, the list, its Viewed marks, "No spec changes in this PR" and opening a Module; this waits on a World with a real repo and its `refs/pull/*`, as PLAIN-3.1 does.
- [x] PLAIN-5.2 Lookout fetches the PR's head into a clone of its repo it already knows (a Start directory's repo, a live Session's working directory or Checkout, or one found so before and remembered in `~/.lookout/plain-clones.json`, each matched by its `origin` remote's URL, `github.com/productiveio/<repo>` in any form git takes): `git fetch origin +refs/pull/<n>/head:refs/lookout/pr/<n>/head +refs/heads/<base>:refs/lookout/pr/<n>/base`, without tags, FETCH_HEAD, submodules or a gc. The base branch is tb-pr's `base_branch` from Work's last read, else `gh pr view <n> --repo productiveio/<repo> --json baseRefName`, asked on every fetch so a retargeted PR is compared with its new base, and the base last known when gh can't answer. The fetch never asks for anything: no terminal prompt, askpass or interactive credential helper, and ssh in batch mode; saved credentials still work. It never checks out, never changes a working tree, the index, a branch or a remote-tracking ref, and deletes `refs/lookout/pr/*` refs not fetched for a day, and those an earlier run of Lookout fetched, at start and every hour, never those of a fetch still in flight. (test)
- [x] PLAIN-5.3 For a PR, the text is the Module at the PR's head commit and the base is the merge-base of that commit with the PR's base branch, as GitHub's "Files changed" compares; imports are read from the same commits (PLAIN-2.6). The Changes card names the base "merge-base with <base branch>". A newer push is fetched when the Spec view or the "Specs" list opens and every 60 s while one is open; the view's 3 s reads (PLAIN-1.7) answer from the last fetch meanwhile. (test)
- [x] PLAIN-5.4 Without a clone of the PR's repo, the button is absent and the row's tooltip on the PR says why once ("No local clone of fantastic-productive"). A fetch that fails (offline, no access, no such PR) shows its error in the list, with Retry, which fetches again at once. Once a PR is fetched, a later failure keeps what was fetched and the Spec view says so above the Changes card ("Showing #2992 as fetched before", with the error). (test)

### PLAIN-6 Safety

- [x] PLAIN-6.1 The server reads only from Checkouts it knows: a live Session's Checkout from DIFF (DIFF-2), or a PR's fetched commits (PLAIN-5.2). The URL's `checkout` is an id Lookout issued for one of those, never a path, and a PR is named by its repo (letters, digits, `.`, `_`, `-`) and number, which Lookout turns into a clone it knows; a `path` that leaves the Checkout (`..`, an absolute path, a symlink out of it) or isn't `.plain` is refused. (test)
- [x] PLAIN-6.2 Reading a Module runs only `git` (`show`, `merge-base`, `rev-parse`, `diff --name-only`, `config --get remote.origin.url`, and PLAIN-5.2's `fetch`, `for-each-ref` and `update-ref` of its own `refs/lookout/pr/*`), with the clone's hooks and fsmonitor off and no password prompt, PLAIN-5.2's `gh pr view`, and file reads. Nothing in a Module is executed, fetched or rendered as HTML: its text is shown as text, its links (PLAIN-1.4, PLAIN-2.5) are Lookout's own. (test)

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
┌ Session sidebar ┬ main pane ─────────────────────────────────────────┬ right ┐
│                 │ ← Back to fix-deal-rates     crm.plain   [ ] Viewed │       │
│                 │ plain/crm.plain · fantastic-productive · crm-rates  │       │
│                 │ Deals on a pipeline board, proposals, companies …   │       │
│                 │ imports productive, view-config  requires shell     │       │
│                 ├──────────────┬──────────────────────────────────────┤       │
│                 │ Changes  •   │ Changes against 1a2b3c4 (Branch pt)  │       │
│                 │ Definitions 42│ 2 added · 1 changed · 0 removed     │       │
│                 │ Impl reqs  •  │ [x] Highlight  [ ] Only what changed│       │
│                 │ Test reqs     │                                     │       │
│                 │ Functional •  │ Definitions                         │       │
│                 │               │ :RateCard: is a list of …           │       │
│                 │               │   used by a ┌──────────────────────┐│       │
│                 │               │  :Deal:  ───│ Deal · productive    ││       │
│                 │               │             │ is an opportunity …  ││       │
│                 │               │             │ Open productive      ││       │
│                 │               │             └──────────────────────┘│       │
└─────────────────┴───────────────┴─────────────────────────────────────┴───────┘
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
- **WORK** (slice 2): WORK-6, the "Specs" button on an expanded PR or Review request row (PLAIN-5.1).

### Key decisions

- **Lookout renders it, on its own design system, not `page.mjs` in an iframe** (Dario, 2026-11-04): an iframe can't share Lookout's keyboard, Viewed marks or themes, and changing `page.mjs` waits on its owners' reviews.
- **The resolver stays in Lookout** (Dario, 2026-11-04): Lookout is its only consumer (0010); it moves to a CLI or p-plain when a second one wants it.
- **Two slices: a Session's changed files first, Work's PRs second** (Dario, 2026-11-04): your own PRs come from a Session whose Checkout DIFF already knows; a Review request has no Checkout and needs a fetch.
- **The main pane, at its own URL** (Dario, 2026-11-04): a 1,200-line Module needs the width, and a URL gives reload, new tab and Back.
- **The base is DIFF's Branch point, imports from the same tree** (Dario, 2026-11-04): the view and DIFF's count never disagree, and a Concept's popover shows the definition as this branch has it.
- **Viewed is explicit and persisted** (Dario, 2026-11-04): opening a long Module isn't reading it, and a review spans reloads; DIFF-3.7's marks, kept until a reload, are too short-lived for that.
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
