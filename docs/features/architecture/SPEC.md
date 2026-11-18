---
title: "Architecture: a repo's structural problems, and what a Session's Changes do to them"
code: "ARCH"
status: "Draft"
created: "2026-11-18"
updated: "2026-11-18"
---

# Architecture

## Summary

See a repo's structural problems as ranked lists, the new and growing ones first: files that import each other in a circle, hubs, god files and hotspots. Start a Session on one. For a Session, see what its Changes do to that structure: the Areas it touched, the imports it added between them, the Findings it made or grew, and the files another live Session is changing too. Sessions write the code and nobody reads it line by line, so the structure is what's left to look at.

## Problem

- Dario's work moved from an IDE to Lookout, and he no longer reads the code Sessions write (2026-11-18: "we're not coding by hand anymore and we're not reading code anymore"). Specs, tests and the Spec view (PLAIN) say what a change does. Nothing says what it does to the structure of the code.
- Lookout's one view of a Session's Changes is DIFF: a count, a list of files by path, and a click that opens a side-by-side diff in VS Code. That is the reading he stopped doing.
- What degrades unseen is structural: a file everything imports, files that import each other in a circle, a shared place that fills with code belonging to one feature, a file every Session edits. He wants to see it from two sides: while a Session works on a PR, and for a repo as a whole ("understand architecture and notice any anti-patterns or problems arising", such as a dependency graph showing a "god object").
- A probe on 2026-11-18 ran fantastic-productive's own import-graph script over its default branch: 5,812 files and 40,292 imports, read in 2.1 s. Ranked, the graph showed:
  - one hand-written file of about 12,000 lines that 308 files in 17 of the repo's 19 units import, changed in about one commit in ten over 30 days;
  - 88 files over 1,000 lines, translation catalogs among them, the largest component importing 119 files;
  - 46 groups of files that import each other in a circle, 173 files in all, type-only imports counted;
  - the shared kernel as the largest unit, a fifth of the lines, holding code that serves single features.
- That repo's guards work: its rule on which unit may import which stands at zero violations. A guard holds what someone wrote a rule for, and none of the above breaks one.
- Outside Lookout, the measuring is 20 to 30 years old and well tooled, and the tools made since agents write code explain one question or one PR (Prior art). None of what was read shows a person who doesn't read code the structure and how it drifts.

## Requirements

Slice 1 is a repo's Findings (ARCH-1 to ARCH-3). Slice 2 is a Session's (ARCH-4). Which comes first is Open question 1. The thresholds are first guesses from the probe, to be checked on real repos before Ready (Open question 4).

### ARCH-1 The scan

Lookout asks the scanner, a Building block (Technical approach), for a Checkout's Import graph, and git for how often each file changed.

- [ ] ARCH-1.1 A scan answers, for every TypeScript and JavaScript file git doesn't ignore: its path, its lines, the files it imports (static imports, `export … from`, and `import()` with a literal path, each resolved to a file of the same tree), and for each import whether it's type-only. An import that resolves to no file of the tree (a package, an asset) is left out. (test)
- [ ] ARCH-1.2 A scan reads a commit's tree from git, with nothing checked out, or a Checkout's working tree with its uncommitted files. (test)
- [ ] ARCH-1.3 Each file is marked when it's a test (`*.test.*`, `*.spec.*`, or under a `tests`, `__tests__`, `e2e`, `fixtures` or `mocks` folder), a story (`*.stories.*`) or generated (`linguist-generated` in `.gitattributes`). A marked file is never a Finding and doesn't count as an importer. (test)
- [ ] ARCH-1.4 Each file belongs to one Area: the workspace package it's in when the repo declares workspaces (`package.json`'s `workspaces`, `pnpm-workspace.yaml`), else its top-level folder. A file in neither belongs to an Area named after the repo. (test)
- [ ] ARCH-1.5 For each file git tracks, Lookout reads how many commits on the default branch changed it in the 30 days before the scanned commit. (test)
- [ ] ARCH-1.6 A commit's scan is kept under `~/.lookout/arch/` by repo and commit, and is never run again. A working tree's scan is run again only when DIFF's fingerprint for that Checkout has changed. (test)
- [ ] ARCH-1.7 One scan runs at a time. One that takes longer than 60 s is killed; the view then says the scan failed, with the reason, and keeps the last result. (test)
- [ ] ARCH-1.8 In a repo with no file the scanner reads, only Hotspots show, with a line: "Imports aren't read in this repo's language." Without the scanner installed, Architecture says so with the command that installs it, as TOOLS-2 does for the other Building blocks. (test)

### ARCH-2 Findings

Lookout turns a scan into Findings of four kinds. The names follow the research on architectural smells (Prior art). What counts as one is Lookout's rule ([0010](../../decisions/0010-single-consumer-rules-stay-with-the-consumer.md)).

- [ ] ARCH-2.1 **Cycle:** a group of two or more files that import each other, directly or through others, type-only imports left out. One Finding per group. Its measure is its number of files. (test)
- [ ] ARCH-2.2 **Hub:** a file that at least 15 files import and that imports at least 15 files itself. Its measure is importers times imports. (test)
- [ ] ARCH-2.3 **God file:** a file of at least 1,000 lines that files in at least three Areas import; in a repo with fewer than three Areas, that at least 20 files import. Its measure is lines times importers. (test)
- [ ] ARCH-2.4 **Hotspot:** a file of at least 500 lines that at least 10 commits changed in 30 days (ARCH-1.5). Its measure is commits times lines. It needs no Import graph, so it's found in a repo of any language. (test)
- [ ] ARCH-2.5 A file can be more than one kind, and is then listed under each. (test)
- [ ] ARCH-2.6 Each Finding is compared with the same repo's default branch as it was 7 days earlier (the last commit before then): **new** when it wasn't a Finding there, **growing** when its measure is at least 10% higher, **shrinking** when at least 10% lower, else **steady**. With no commit that old, every Finding is steady. (test)
- [ ] ARCH-2.7 A Finding of 7 days earlier that is none today is **gone**. (test)
- [ ] ARCH-2.8 The thresholds are constants in one file, not settings. (test)

### ARCH-3 A repo's Findings

Where this lives, a right-sidebar tab or a view in the main pane, is Open question 3. The criteria below hold for either.

- [ ] ARCH-3.1 Architecture lists the repos that live Sessions' Checkouts belong to, by name, each with its count of new and growing Findings. It opens on the selected Session's repo. (test)
- [ ] ARCH-3.2 A repo shows the default branch it was scanned at and how long ago that commit was made. Lookout doesn't fetch: the branch is as the last fetch left it. (test)
- [ ] ARCH-3.3 A repo's Findings are in four sections in this order: God files, Hubs, Cycles, Hotspots. Each has its count, and its rows are ranked by measure, highest first. A section with no row under the current filter is left out. (test)
- [ ] ARCH-3.4 A `Segmented` (DS-20) filters them: "New or growing" (the default), "All" and "Known". The choice is remembered across reloads. Under "New or growing", a last line, "<n> gone since <date>", opens to list the gone ones. (test)
- [ ] ARCH-3.5 A file's row is one line: its name, its folder in the quieter colour, and the kind's two numbers ("308 importers · 12k lines"; a Hotspot's "24 commits · 5k lines"), shortened as DIFF-1.2 shortens counts. A Cycle's row is its first file by path, "and <n> more", and the Areas it spans. A new or growing Finding carries a mark, with what changed in its tooltip ("Importers 280 → 308 in 7 days"). (test)
- [ ] ARCH-3.6 A press on a row, or Enter on the selected one, expands it (DS-21): a state line with its exact numbers, its Area and its comparison; and a summary of who imports it by Area, the five largest and "+<n> more" ("orders 41 · billing 38"), or for a Cycle its files, ten at most. (test)
- [ ] ARCH-3.7 The expanded row's action is "Open in VS Code", which opens the file, or a Cycle's first file. More has "Start Session…" and "Mark as Known". (test)
- [ ] ARCH-3.8 "Start Session…" opens the launcher (LAUNCH-1) in that repo with the prompt set to the Finding's facts and one request: say how to resolve it, and change nothing yet. Nothing starts until you press Start, and you can edit the prompt first, as WORK-5.1 says for a Task. (test)
- [ ] ARCH-3.9 A Finding you mark as Known leaves "New or growing" until its measure is 10% above what it was when you marked it; then it's back, as growing. It stays in "All", quieter, and "Known" lists it with "Unmark". Known marks are kept in `~/.lookout/`, per repo, by kind and path (a Cycle's first file). (test)
- [ ] ARCH-3.10 While a repo's first scan runs, the view says so. With no Finding under the filter it says "Nothing new or growing in 7 days", or "No Findings" under "All". (test)
- [ ] ARCH-3.11 The list, an expanded God file and an expanded Cycle look right in light and dark mode at 280 and 720 px. (manual)

### ARCH-4 What a Session's Changes do to the structure

For a live Session, each Checkout that counts (DIFF-2) is scanned twice: at its Branch point, and as its working tree is now.

- [ ] ARCH-4.1 The comparison runs when the Session's Status leaves Busy and, while its popover is open, whenever DIFF's answer for the Session changes. It never runs for a Session with no Changes. (test)
- [ ] ARCH-4.2 **Areas:** the Areas its changed files are in, each with its `+ −` summed from DIFF's files. Generated files are summed apart, as "generated". (test)
- [ ] ARCH-4.3 **New imports between Areas:** each pair of Areas where no file of the first imported the second at the Branch point and one does now, with the files that do. (test)
- [ ] ARCH-4.4 **Findings:** each Cycle, Hub or God file that's new, or has a higher measure than at the Branch point, with its numbers before and after; and one quiet line counting those that are gone or lower. Hotspots aren't compared: how often a file changes isn't one Session's doing. (test)
- [ ] ARCH-4.5 **Reach:** how many files, in how many Areas, import a file it changed, the changed files themselves left out. (test)
- [ ] ARCH-4.6 **Also changed by:** each of its changed files that another live Session's Changes list too, in any Checkout of the same repo, with that Session's name. It comes from DIFF's answers alone and needs no scan. (test)
- [ ] ARCH-4.7 The status line (VIEW-5.5) shows a mark with a count after the Changes count only when there's a new import between Areas (ARCH-4.3), a Finding made or grown (ARCH-4.4) or a file also changed by another Session (ARCH-4.6). It opens a popover with all five parts. Without such an exception, the popover is reached from the list of changed files (DIFF-3). (e2e)
- [ ] ARCH-4.8 A View only Session shows it like a Controllable one. An ended or past Session shows none. A Codex Session's covers its working directory's Checkout only (DIFF-2.2). (test)
- [ ] ARCH-4.9 The popover looks right in light and dark mode, and fits the Session view at any width without sideways scrolling. (manual)

## Planned slices

Specced after the first two ship. No order yet.

3. **Areas as a matrix, and one Finding drawn:** which Area imports which, as a grid of counts with imports in both directions marked, and a Finding's neighbourhood (who imports it, by Area) drawn with the Topic graph's SVG, in the main pane.
4. **More kinds:** files that change in the same commits without an import between them (change coupling), duplicated blocks, and an Area that depends on a less stable one.
5. **A PR without a live Session:** its base and head scanned from git, shown from Work.

## Non-goals

- Enforcing a rule or failing a build. The repo's lint and CI do that; Lookout shows.
- Fixing a Finding from Lookout. A Session does, started from it (ARCH-3.8).
- A model's summary of a repo's architecture or of a change. It's one more text to check (PLAIN's Non-goals, 2026-11-09), and `/p-dev:overview` gives a deep read on demand.
- Drawing the whole Import graph.
- A diff viewer in Lookout. DIFF's Non-goal stands.
- Imports in languages other than TypeScript and JavaScript, and what an import doesn't show: lookups by name through a framework's container, calls between services at run time.
- Problems inside one file: long functions, complexity, naming. Linters cover those.
- Problems of meaning: a wrong abstraction, or logic in the wrong layer that imports legally.
- Scores per person or per team, and trends for management.
- Fetching. The default branch is as the last `git fetch` left it.
- Settings for the thresholds, in the first version.
- Clean-up Sessions on a schedule.
- Other Hosts.

## UX

A sketch only. A canvas of directions comes before any code (Open question 3). File names in it are invented.

```
A repo's Findings (280 px)
┌──────────────────────────────────────────────┐
│ shop ▾                        main · 2h ago  │
│ [ New or growing |  All  |  Known ]          │
│                                              │
│ GOD FILES                                  1 │
│   api.ts       lib/        [up] 308 · 12k    │
│ CYCLES                                     1 │
│   tokens.ts and 3 more     [new] view, core  │
│ HOTSPOTS                                   2 │
│   board.tsx    planner/    [up] 24 · 5k      │
│   en.ts        i18n/       [up] 19 · 4.1k    │
│                                              │
│ 4 gone since 11 Nov                          │
└──────────────────────────────────────────────┘

An expanded God file
│   api.ts       lib/        [up] 308 · 12k    │
│   308 importers · 11,995 lines · core        │
│   Importers 280 → 308 in 7 days              │
│   orders 41 · billing 38 · planner 35 ·      │
│   people 29 · time 27 · +12 more             │
│   [Open in VS Code]                  [More]  │

A Session's status line, with the popover open
  shop · fix/rates   [+120 −30 · 4 files]  [st]2   Opus 5.5   23%
  ┌──────────────────────────────────────────────────────┐
  │ AREAS                                                │
  │   orders  +96 −30        shared  +24 −0              │
  │ NEW IMPORTS BETWEEN AREAS                            │
  │   orders → billing       rates.ts                    │
  │ FINDINGS                                             │
  │   God file   api.ts      11,855 → 11,995 lines       │
  │ ALSO CHANGED BY                                      │
  │   api.ts                 Add tax to invoices         │
  │                                                      │
  │ Imported by 41 files in 5 Areas                      │
  └──────────────────────────────────────────────────────┘
```

- `[up]`, `[new]` and `[st]` stand for lucide icons, chosen on the canvas ([0008](../../decisions/0008-lucide-icons-only.md)).
- A repo's Findings are quiet rows (DS-22): grey numbers, with colour and a mark only for new and growing.
- A key for Architecture is chosen with its place. `A` is taken.

## Technical approach

### What exists

- fantastic-productive builds its own Import graph with TypeScript's parser (`scripts/build/module-graph.mjs`): every file's imports resolved to files, each file given a unit and a tier, and a test that holds forbidden imports at a baseline of zero. The probe timed that script.
- DIFF already gives, per Session, its Checkouts, each one's Branch point, changed files and a fingerprint. ARCH-4 builds on that answer and adds no second way to find a Session's work.
- Lookout already has the pieces the views need: the list row and its expanded details (DS-17, DS-21), `Segmented` (DS-20), the launcher opened with a prompt (WORK-5.1), "Open in VS Code" (DIFF-4), the Topic graph's SVG (TOPIC-7) and `server/git.ts`.
- cli-toolbox, where Building blocks live, is Rust.

### The scanner: a Building block

- The scan is reusable ([0005](../../decisions/0005-building-blocks-live-outside-lookout.md)). An agent in a Session wants the same facts as Lookout, to check its own change before it reports Done, so there is a second consumer from the first day.
- It gives facts only ([0010](../../decisions/0010-single-consumer-rules-stay-with-the-consumer.md)): files with their lines and marks, and imports with their type-only flag, for a working tree or a commit, as `--json`. What counts as a Finding, the comparison and the Known marks are Lookout's.
- Its contract is written in `docs/contracts/` before it's built, as `fleet-diff.md` was. Its engine and its name are Open question 2.
- It joins Settings › Tools as a Building block (TOOLS).

### Lookout

- `server/arch.ts`: runs scans one at a time through the runner, keeps a commit's scan on disk (ARCH-1.6), reads commits per file from `git log`, finds the groups of ARCH-2.1 (strongly connected components), applies the thresholds and compares two scans.
- A repo's Findings are read on demand. A Session's comparison goes to the watching tab over the event stream, as its Changes do (DIFF-3.6), so an older answer can't land after a newer one.
- Known marks are a small file per repo under `~/.lookout/`.

### Other specs, when built

- DIFF and VIEW-5.5: the status line gains the mark of ARCH-4.7.
- LAUNCH and WORK-5.1: the launcher opened with a Finding's prompt.
- TOOLS: the scanner's row.
- DS: the mark for new and growing, if no existing piece fits.
- SIDE's routes, if a repo's Findings get a view in the main pane (Plan item 26).

### Prior art

Researched on 2026-11-18. The sources, with what couldn't be verified, are in Dario's `output/lookout-2026-11-18-architecture/research.md`.

| Kind | Examples | What it gives |
|---|---|---|
| IDE built-ins | [IntelliJ's Dependency Structure Matrix](https://www.jetbrains.com/help/idea/2026.1/dsm-analysis.html), [Visual Studio's live dependency validation](https://devblogs.microsoft.com/devops/live-dependency-validation-in-visual-studio-2017/) | A who-depends-on-whom matrix with cycles in red; declared layers checked as you type |
| Analyzers | [NDepend](https://ndepend.com/features/dependency-cycles), Structure101 ([bought by Sonar](https://www.sonarsource.com/company/press-releases/sonar-acquires-structure101-to-strengthen-code-quality-offering/) in 2024), [CodeScene](https://codescene.io/docs/guides/technical/hotspots.html) | Rules over the graph, intended against actual architecture, hotspots, change coupling |
| Research | [Arcan](https://essere.disco.unimib.it/wiki/arcan/), [reflexion models](https://www.cs.ubc.ca/~murphy/papers/rm/fse95.html), [Tornhill's hotspots](https://www.infoq.com/news/2015/03/code-as-a-crime-scene) | Named, detectable smells: cyclic dependency, hub-like dependency, unstable dependency, god component |
| Rules in CI | ArchUnit, dependency-cruiser, [Nx](https://nx.dev/docs/features/ci-features/affected) | The build fails on a forbidden import ([fitness functions](https://www.infoq.com/articles/fitness-functions-architecture/)) |
| Since agents write code | [Windsurf Codemaps](https://cognition.com/blog/codemaps), [CodeRabbit's Change Stack](https://www.coderabbit.ai/blog/introducing-change-stack-the-first-ai-native-code-review-interface) | A map made per question; a PR reordered into a guided walkthrough |

- Teams that write no code by hand hold structure with custom linters, structural tests and agents that clean up on a schedule ([Böckeler on OpenAI's team](https://www.martinfowler.com/articles/exploring-gen-ai/harness-engineering-memo.html)). The texts read don't describe what a person looks at to keep a picture of the structure.
- The loss of understanding has a name: [comprehension debt](https://addyosmani.com/blog/comprehension-debt/), or [cognitive debt](https://arxiv.org/abs/2603.22106).
- Reports of duplicated code rising and refactoring falling since 2023 ([GitClear](https://gitclear.com/the_ai_code_quality_maintainability_gap)) are why duplicated blocks are a planned kind.

### Key decisions

Proposed in the draft. The grill confirms or changes them.

- **Lists, not a drawing of everything:** 5,812 files and 40,292 imports drawn is a hairball; ranked, the same graph named the problems in the probe.
- **Facts from git and imports, no model:** a written summary is one more text to check, and Dario dropped one for that reason on 2026-11-09.
- **New and growing first:** the same ten Findings every day would teach you to stop looking, and "arising" is what was asked for.
- **Known marks, not thresholds per repo:** a types file that everything imports is expected; marking it Known keeps it quiet until it grows.
- **The research's names:** cycle, hub and god component are defined and detected the same way in the literature, so the numbers can be compared with other tools'.
- **Areas from what the repo declares:** workspaces first, so a repo with packages needs no configuration.
- **A Session is compared with its Branch point:** the same base as its Changes (DIFF), so the two always describe the same work.
- **Compared with a week earlier, from git:** a past commit can always be scanned again, so no history is stored.
- **Type-only imports don't make a Cycle:** they don't exist at run time (Open question 8).
- **Hotspots for every repo:** they need only git, so a Ruby repo still shows something.
- **Start a Session, don't fix:** Lookout starts and watches Sessions, and changing code is theirs.

## Open questions

- [ ] 1. Which slice first: a repo's Findings, which settles what counts as a Finding on real data (recommended), or a Session's, which is used daily. *(blocking)*
- [ ] 2. The scanner's engine and name: a new CLI in cli-toolbox, in Rust on an existing TypeScript parser, or a wrapper around dependency-cruiser's JSON output. Neither is timed on a real repo yet. *(blocking)*
- [ ] 3. Where a repo's Findings live: a seventh right-sidebar tab, or a view in the main pane opened from a Session's repo. A canvas of directions first. *(blocking)*
- [ ] 4. The thresholds (ARCH-2.2 to 2.4, the 10% and the 7 days), checked on fantastic-productive, Lookout and one more repo: how many Findings each gives, and whether the lists read as problems. *(blocking)*
- [ ] 5. How a repo says more about its Areas than ARCH-1.4 finds: a tier per Area, so an import against the tiers is a Finding, and second-level folders where one top-level folder holds everything.
- [ ] 6. Known marks in `~/.lookout/`, yours alone, or in the repo, where a Session and CI could read them as a baseline.
- [ ] 7. Whether a Session's row in the sidebar also shows that another Session changes its files (ARCH-4.6), or only its status line.
- [ ] 8. Type-only imports: left out of Cycles, as drafted, or shown as a weaker kind.

## Changelog

- 2026-11-18: Created as a Draft from a conversation with Dario, a probe of fantastic-productive's Import graph and research into prior art the same day. Not grilled.
