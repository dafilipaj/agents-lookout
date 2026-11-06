---
status: Accepted
date: 2026-11-06
extends: 0009
---

# 0015. Design guidelines by task, and guards on how pieces are put together

## Context

- [0009](0009-one-design-system-guarded-by-tests.md) made one design system: tokens, components in `components/ui/`, and rules in the DS spec, with guards that fail on a font size off the scale, a colour outside its meaning or a hand-drawn Alert. They work: no tenth font size or fifth error box has come back.
- The clarity pass of 2026-11-06 found drift that passes every guard:
  - 66 `Button`s in six variants; outline buttons alone come in five heights (20 to 36 px), and 29 of the 66 set their own height in `className`. Nothing says which button on a surface matters most.
  - Usage's and Memory's details popovers share a frame and differ in everything inside it: header, bar height, how they word a reading's age, sections, and how they show "critical". Four popovers use three widths and two paddings.
  - "Open" is drawn with three different icons, depending on the panel. A reading's age is formatted by three helpers and worded five ways.
- Three reasons the system didn't catch it:
  - **Rules are organised by build date.** DS-1 to DS-17 are in the order they were built. "How do I make a button" is spread over DS-7, DS-12.4, DS-16 and three Key decisions; "how do I make a popover" has no entry, so Memory's was invented from scratch. That is the failure 0009 names: nothing told the next component what already existed.
  - **Some gaps were chosen.** DS's Non-goals leave out spacing, row heights and buttons other than icon buttons.
  - **The guards check values, not composition.** They catch a size, a colour or an icon, never two pieces put together in a way the system doesn't have.

## Decision

- **A guide by task:** `docs/design/GUIDE.md`, read before any UI change. It opens with nine principles, then has one entry per task (a button, a details popover, a list row, a number with a level, a notice or error, a loading or empty state, a section heading, a time ago, a keyboard shortcut, an icon, a page in parts). Each entry gives the rule, the component, one do and one don't, the guard, and the requirements that hold it.
- **The guide holds no requirement of its own.** Every rule in it links the requirement or decision that holds it, in the DS spec or a feature spec. A rule Dario has decided whose requirement isn't built yet is marked *Coming*. The DS spec stays the record of what and why; the guide is how. `pnpm req-check` fails when the guide names a requirement that doesn't exist or is struck through (TEST-3.8), so it can't point at something gone.
- **The same change:** a change that adds or alters a pattern updates its guide entry, as 0009 already asks it to update the system.
- **Guards on composition**, where one can be written, next to 0009's guards on values and in the same file: for example, a `Button`'s `className` can't set its height, padding or text size; an action's icon comes from one table; a details popover's bar and section label come from `components/ui/`. Each lists its exceptions with a reason, as 0009's do. The DS requirements that add them come with this pass (DS-18 onwards).
- **A checklist for what no test can check:** whether a surface copies its nearest sibling, whether routine values stay quiet, which column has the keys. It ends the guide, and a reviewer, person or agent, goes through it for every UI change. `AGENTS.md` points at the guide.
- **Relation to 0009:** this extends it and doesn't supersede it, as 0009 extends 0008. 0009's system gains a fourth part, the guide, and its guard gains composition checks. Its rejection of Storybook and a separate package stands.

## Alternatives rejected

- **More DS requirements, in the same order:** that is what exists, and the drift happened anyway; the reader still has to know which of seventeen requirements to read.
- **Reordering the DS spec by task:** requirement IDs never change once a spec is Ready, and hundreds of tests name them. A guide on top keeps the IDs and gives the order.
- **The guidelines in `AGENTS.md`:** it's loaded into every session, UI or not. One line there pointing at the guide costs almost nothing.
- **Instructions without guards:** 0009's first rejected alternative, for the same reason: it drifts the first time someone is in a hurry.
- **A `/design` route in Lookout now,** showing every piece in both modes: the cheaper cousin of Storybook, and where drift would have been visible (the two popovers side by side). It shows drift but doesn't stop it, so it waits in the Backlog.

## Consequences

- Each spec of the clarity pass (DS-18 onwards, and its SIDE, VIEW, HIST, WORK, LIB, TOPIC, USAGE, MEM, PLAIN and LAUNCH changes) lands with its guide entry and its guard, and turns its *Coming* lines into plain rules.
- The guide's requirement links are checked by `pnpm req-check` (TEST-3.8); its words can still go stale, which the checklist's last item and review catch.
- A UI change costs one more file to read. The guide stays short, about two pages, by linking rather than repeating.
- `AGENTS.md`'s "Constraints from accepted decisions" has a line for it, and 0009's status reads "Accepted (extended by 0015)", as 0008's names 0012.
- Grilled with Dario on 2026-11-06, every question as recommended: the guide carries decided rules marked *Coming*; principle 8 stands, with the right sidebar's icon tabs as its one exception (words for them are in the Backlog); age formatting moves into `lib/time.ts` with Usage's rebuild; list popovers (Changes, Subagents) stay out of this pass; TEST-3.8 checks the guide's ids; reviews reach the checklist through `AGENTS.md`, not the shared review plugin's prompts; and the guide has eleven entries, "An icon" and "A page in parts" among them.
