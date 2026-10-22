---
status: Accepted
date: 2026-10-22
---

# 0009. Lookout's UI uses one design system, guarded by tests

## Context

- The design review of 2026-10-22 found the same thing done differently in many places: nine font sizes, five of them 12 px or smaller; four styles for "something failed"; the same dot meaning Busy in one list and "live" in another; Needs you's amber marking things that don't need you.
- Each was right when it was written, one component at a time. Nothing told the next component what already existed, or stopped it from adding a tenth size.
- [0008](0008-lucide-icons-only.md) solved this for icons: one rule, written once, and a guard test that reads the UI source and fails on anything else. Since then, no emoji or second icon set has come back.

## Decision

- **One design system**, made of three parts:
  - **tokens** in `web/src/index.css`: the type scale and the colour tokens, each with a light and a dark value;
  - **components** in `web/src/components/ui/`: shadcn's, plus Lookout's shared ones (Alert, Session marker, Loading, icon button, empty state, chip, key, command);
  - **rules**, written once in the design system spec (`docs/features/design-system/SPEC.md`, code DS): which size and which colour for what, and which component for which job.
- **Guarded by tests**, the way 0008's guard works: a test reads `web/src` and `shared` with TypeScript's parser and fails when a font size isn't from the scale, a colour token is used outside its meaning, an alert box or a Session marker is drawn by hand, or an icon button sets its own size. Each check lists its exceptions with a reason, so adding one is a reviewed change.
- **Colour has meaning.** Status colours show a Status; amber means act on it, now (Needs you) or soon (a warning level); grey info tokens carry staleness. The DS spec has the table.
- **New UI uses what exists.** A component that needs something the design system lacks adds it to the system (a token, a component, a rule in the DS spec) in the same change, not locally.
- **No separate package or Storybook.** The system is the code in `web/src`, the DS spec and its tests.
- **Relation to 0008:** this extends it and doesn't supersede it. 0008's icon rules, exceptions and guard stay as they are and become the design system's icon part. A new shape with its own meaning still needs a decision that supersedes 0008.

## Alternatives rejected

- **A style guide without tests:** it drifts the first time someone is in a hurry, and agents don't read it unless something fails.
- **Lint rules (ESLint, stylelint):** a second tool for what 0008's guard already does with TypeScript's parser; one pattern, in one place, is easier to keep.
- **A component library in its own package, with Storybook:** one user and one app. The cost of a package, its build and a gallery buys nothing the guard and component tests don't.
- **Fixing the review's findings one by one, without a system:** the same findings would come back with the next component.

## Consequences

- New UI picks its size, colour and pieces from the design system; the guard catches a hand-written size, an amber that doesn't need you, or a fifth error box.
- Specs describe UI by the design system's names (an info Alert, the `meta` size, a Session marker), not by pixel sizes or Tailwind classes.
- The DS spec's migration moves about 230 font sizes and a few dozen colour and component uses. Until it's done, the guard's real-tree tests can't pass, so the migration lands before or with them.
- Five feature specs (SIDE, VIEW, HIST, WORK, USAGE) change UX lines when their parts migrate, each with a Changelog line.
- Once Accepted, `AGENTS.md`'s "Constraints from accepted decisions" gains a line for it.
