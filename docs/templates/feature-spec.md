---
title: <Feature name>
code: <CODE>          # 3–6 capital letters; prefixes requirement IDs, e.g. SIDE
status: Draft         # Draft | Ready | In Progress | Done | Parked
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <Feature name>

## Summary

Two or three sentences: what you can do once this ships, and why it matters.

## Problem

What hurts today, concretely. When you hit it and how often.

## Requirements

One requirement per capability. Each acceptance criterion says when it holds and how it's verified: `(test)` or `(manual)`.

### <CODE>-1 <Short name>

One or two sentences, in Glossary terms.

- [ ] <CODE>-1.1 When …, then … (test)
- [ ] <CODE>-1.2 When …, then … (manual)

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
