---
status: Accepted
date: 2026-11-22
---

# 0016. The tab title's Unread dot

## Context

- SIDE-13 marks a Session that finished since you last looked at it as Unread, and Dario chose (2026-11-22) to show it in the browser tab title as a dot after the Needs you count: "(2) • Lookout", or "• Lookout" with nothing that needs you. The count stays the urgent one, as Slack's title does.
- [0008](0008-lucide-icons-only.md) allows only lucide icons in the UI, with a closed list of exceptions (amended by [0012](0012-task-status-dots-and-author-avatars.md) and [0014](0014-the-lens-lookouts-own-mark.md)), and its guard counts `•` as a symbol used as an icon.
- A tab title is plain text the browser draws. No icon, colour or font can go there, so 0008's reasons (emoji that don't follow the theme or match lucide's stroke) don't apply, and its rule leaves only words or a second number.

## Decision

- **0008 stands, with one more exception: the `•` in the tab title**, built by `tabTitle` in `web/src/lib/unread.ts` while any Session is Unread (SIDE-13.6). It is the only `•` the UI source may hold.

## Alternatives rejected

- **A second count, "(2 · 3 new) Lookout":** longer in a narrow tab, and the urgent number no longer stands alone (Dario, 2026-11-22).
- **A word, "(2) new · Lookout":** takes most of a pinned tab's width.
- **A badge on the favicon:** Lookout has no favicon of its own yet, and a drawn badge is an icon outside lucide anyway.

## Consequences

- 0008's guard (`web/src/test/icons.test.ts`) lets `•` through in that one function of that one file, and a test shows it still catches `•` anywhere else.
- `AGENTS.md`'s line for 0008 names this decision.
