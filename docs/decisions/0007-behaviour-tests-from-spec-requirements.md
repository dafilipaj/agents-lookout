---
status: Accepted
date: 2026-10-17
---

# 0007. Spec requirements are the behaviour catalogue, checked end to end

## Context

- Lookout's behaviours are written down as requirements in each feature spec, each tagged `(test)` or `(manual)`. About 180 tests across 18 files carry a requirement id in their name (`it('VIEW-1.9: …')`), but nothing enforces that link: a ticked requirement can have no test, and a test can name an id that no longer exists.
- Every test runs one layer, the server or the UI, against fakes of Fleet, tb-session and tb-jev. No test runs the whole app, so drift between Lookout and the Fleet fork is only caught by hand.
- Dario wants a structured way to state and check behaviours such as "Codex usage when the codex CLI isn't installed". That example also showed a requirement (USAGE-2.2) and an expectation disagreeing, which is what a catalogue should surface.

## Decision

- **The spec requirements are the single behaviour catalogue.** A behaviour is stated once, as a requirement in its feature spec. When a requirement is ambiguous, it's written Given/When/Then style inside the spec.
- **An end-to-end behaviour test layer.** Playwright drives the built Lookout in a declared environment (a "world"):
  - a temporary HOME;
  - a PATH that holds only the commands the scenario declares, so "codex not installed" means no `codex` on PATH;
  - the real Fleet (fork) and tb-session binaries, with fake `claude` and `codex` commands and fixture data;
  - a private tmux server.

  A test reads like `scenario('USAGE-2.2', world().without('codex'), …)`.
- **How many:** one behaviour test per requirement whose behaviour spans the server and the UI. Edge cases stay in the fast unit and component tests.
- **A requirement check:** `pnpm req-check` fails when a ticked `(test)` requirement has no test naming its id, or when a test names an id that doesn't exist in any spec.
- **When they run:** the behaviour suite and `req-check` run before each push.
- **In the build workflow:** agents write the behaviour test from the requirement first, and the reviewer checks the requirement-to-test mapping.

## Alternatives rejected

- **Gherkin `.feature` files with Cucumber step definitions:** they would duplicate the specs, and the step-definition glue rots quickly when agents write most of the code.
- **Behaviour tests against fakes of Fleet and tb-session only:** faster, but they can't catch drift between Lookout and the real CLIs, which is the gap that matters.
- **Running the behaviour suite on every commit:** too slow with real tmux. Before each push is enough.

## Consequences

- Each feature spec's requirements must be precise enough to test end to end. Vague ones get rewritten when they're picked up.
- Playwright, the world builder, the fake `claude`/`codex` commands and `req-check` have to be built first. That work is feature TEST, to be specced and grilled before it's built.
- The Fleet and tb-session binaries the suite uses must be pinned (a built fork binary and a tb-session version), so a run is reproducible.
- Existing requirements get behaviour tests gradually, starting with the features being worked on.
