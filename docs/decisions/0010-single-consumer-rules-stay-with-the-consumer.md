---
status: Accepted
date: 2026-10-29
---

# 0010. Building blocks give facts; a rule only one consumer needs stays with that consumer

## Context

- [0005](0005-building-blocks-live-outside-lookout.md) puts shared pieces into cli-toolbox as CLIs with `--json`. It doesn't say where a rule belongs when only Lookout needs it.
- The Library spec was written against `tb-session outputs`, which held Lookout's own rules: an extension table, "not git-owned", the Harness homes, one item per key, and the fold of an Artifact with its source file. In the review of cli-toolbox PR #106 that command became `events` (tb-session 0.4.0): one row per recorded action, with "Library rules (extensions, git-tracked files, Artifact-source fold)" moved to Lookout.
- cli-toolbox's README states the rule: "The CLI fetches, structures and verifies facts; the AI (or app) decides on their relevance and next steps. Rules specific to a single consumer stay with that consumer."

## Decision

- A Building block returns facts, with generic filters that run in its own store (`--kind`, `--ext`, `--headless`, paging). It doesn't encode what one consumer counts, hides or titles.
- A rule that only one consumer needs lives with that consumer. For the Library, the include rule (extensions, Harness homes, git-owned, folder gone), the grouping of actions into Outputs, the fold and the file titles live in Lookout's server, specified in the LIB spec.
- A contract in `docs/contracts/` says what Lookout relies on from the facts, not what the consumer does with them: [`tb-session-events.md`](../contracts/tb-session-events.md).

## Alternatives rejected

- **The rules in tb-session (`outputs`, as first specced):** other UIs on the same Building block would inherit Lookout's choices, such as hiding git-tracked files, and tb-session would need exceptions to its own boundary (a `git` check at index time).
- **A second CLI for the Library's rules:** a pin, a wrapper and a fake for what one app uses.

## Consequences

- Lookout's server reads every document event at once and groups them (LIB-2.1, LIB-2.11): a row per action can't be paged into Outputs, so the cost is a read of about 2.3 MB at 0.12 s.
- Lookout runs `git` read-only to ask whether a file is git-owned (LIB-2.10), which tb-session no longer does.
- A new Library rule, such as a wider extension list, is a change here, not a cli-toolbox PR.
- Refines 0005 without superseding it: the Building block is still a CLI outside this repo.
