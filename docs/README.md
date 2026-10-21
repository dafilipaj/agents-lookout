# Specs and decisions

How features get designed in Lookout. Written for people and agents alike.

## Where things live

```
docs/
  README.md              this file: the process
  GLOSSARY.md            concepts, each defined once
  BACKLOG.md             ideas for later that aren't specced yet
  PLAN.md                what's next, in order: spec changes, bugs and fixes
  features/
    README.md            index of features and their status
    <slug>/SPEC.md       one folder per feature; mockups and screenshots sit next to SPEC.md
  decisions/
    NNNN-<slug>.md       decisions that constrain more than one feature
  templates/
    feature-spec.md
    decision.md
```

## Feature spec or decision?

- **Feature spec**: what one feature does for the user, and how we know it works.
- **Decision**: a choice that constrains many features, such as the session host or the stack. A choice that only affects one feature stays in that spec's *Key decisions*.

## Lifecycle

`Draft → Ready → In Progress → Done`, and `Parked` from any state.

| Status | Meaning | To get here |
|---|---|---|
| Draft | Being written | Copy the template |
| Ready | Agreed and safe to build | Non-goals filled in; every requirement has acceptance criteria; no blocking open question; grilled with `/p-dev:grill-me` |
| In Progress | Being built | First code for it lands |
| Done | Shipped | Every acceptance criterion ticked |
| Parked | Deliberately not now | One line in the Changelog saying why |

Update the status in the spec's frontmatter and in `features/README.md` together.

Decisions are `Proposed`, `Accepted` or `Superseded by NNNN`. An accepted decision is never edited to mean something else; a new decision supersedes it.

## Writing rules

1. **Requirements are capabilities**, numbered `<CODE>-1`, `<CODE>-2`. Their acceptance criteria are `<CODE>-1.1`, `<CODE>-1.2`. While a spec is Draft, renumber freely. From Ready on, IDs never change and are never reused; a dropped one is struck through, not deleted.
2. **Every acceptance criterion is checkable.** Say when it holds, and how it's verified:
   - `(test)`: an automated test at any layer;
   - `(e2e)`: a Behaviour test, for a behaviour that spans the server and the UI and that a World can check;
   - `(manual)`: looking at the running app, for what only an eye can judge (layout, alignment, colour).

   A `(manual)` criterion that a World can check is retagged `(e2e)` when its feature is next worked on; retagging a ticked one unticks it until its Behaviour test passes. `pnpm req-check` checks each tag against the tests (TEST-3): a ticked `(test)` criterion needs a test naming its id, a ticked `(e2e)` one a Behaviour test, and no test may name an id that doesn't exist or is struck through.
3. **Non-goals are mandatory.** This is where scope creep gets stopped, for you and for agents.
4. **Use Glossary terms**, capitalized. A new concept goes into `GLOSSARY.md` in the same change.
5. **Key decisions are one line each, with the why.** The debate that led there lives in git history, not in the spec.
6. **The spec is the source of truth.** When the code has to differ, change the spec first and add a Changelog line, then change the code.

## Working with Claude

- **New feature**: ask for a spec draft. Claude copies `templates/feature-spec.md` to `features/<slug>/SPEC.md`, fills it from the conversation and adds a row to `features/README.md`.
- **Before Ready**: run `/p-dev:grill-me` on the spec and fold the answers back in.
- **Building**: point Claude at the spec. It works requirement by requirement, names tests after acceptance criteria (`SIDE-1.2: …`) and ticks a criterion only after verifying it. For an `(e2e)` criterion it writes the Behaviour test from the criterion first, then the code.
- **Reviewing**: check the criterion-to-test mapping with `pnpm req-check --feature <CODE>`.
- **Pushing**: the pre-push hook (`.githooks/pre-push`, set up by `pnpm install`) runs `pnpm req-check`, `pnpm test` and, once it exists, `pnpm e2e`.
- `/p-dev:spec` in its lite tier fits this layout (`docs/features/<slug>/SPEC.md`); tell it to use this repo's template.
