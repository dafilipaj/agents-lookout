---
title: "<Feature name>"   # quoted, so a title with ": ", a backtick or "@" is still valid YAML
code: "<CODE>"            # 3–6 capital letters; prefixes requirement IDs, e.g. SIDE
status: "Draft"           # Draft | Ready | In Progress | Done | Parked
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
---

# <Feature name>

## Summary

Two or three sentences: what you can do once this ships, and why it matters.

## Problem

What hurts today, concretely. When you hit it and how often.

## Requirements

One requirement per capability. Each acceptance criterion says when it holds and how it's verified: `(test)`, `(e2e)` or `(manual)` (writing rule 2 in `docs/README.md`).

### <CODE>-1 <Short name>

One or two sentences, in Glossary terms.

- [ ] <CODE>-1.1 When …, then … (test)
- [ ] <CODE>-1.2 When …, then … (e2e)
- [ ] <CODE>-1.3 When …, then … (manual)

### <CODE>-2 <Short name>

- [ ] <CODE>-2.1 …

## Non-goals

Mandatory. What this feature deliberately does not do.

- …

## UX

Layout sketch (ASCII, or an image in this folder), keyboard shortcuts, empty, loading and error states.

## Technical approach

Data sources → interfaces → flows. Name the building blocks used (Fleet CLI, tb-session, …) and any gap that must be filled first. Link the decisions in `docs/decisions/` that apply.

### Key decisions

- **<Decision>**: <one-sentence why>.

## Open questions

- [ ] <Question> *(blocking)*

## Changelog

- YYYY-MM-DD: Created.
