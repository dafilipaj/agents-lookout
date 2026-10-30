---
status: Accepted
date: 2026-10-30
supersedes: 0008 (its list of exceptions only)
---

# 0012. Task status dots and PR author avatars in Work's rows

## Context

- History's rows lead with a Session marker and Library's with an Output's type icon, but Work's rows lead with their title, so a Task, a PR of yours and a review request look alike at a glance (Dario, 2026-10-30).
- A Task's status has a colour of its own in Productive: each workflow status carries a `color_id` into the product's palette of 17 colours, and Fantastic draws a Task as a filled dot in it (`StatusDot`, a diamond for a key task). "In review" and "In progress" are both "started", so a dot by category alone can't tell them apart.
- A review request is about who asked: the author is the first thing to know, and a face is quicker to read than a login.
- [0008](0008-lucide-icons-only.md) allows only lucide icons, with a closed list of exceptions for shapes that carry a defined meaning, and says a new one needs a decision that supersedes it. [0009](0009-one-design-system-guarded-by-tests.md) keeps every colour in a token with one meaning, and Lookout's CSP allows images from its own origin only (`img-src 'self' data:`, [0003](0003-browser-first-react-stack.md)).

## Decision

- **0008 stands, with two more exceptions.** Its list becomes: the Harness logos (`HarnessIcon`); the Status shapes (`StatusMarker`); the chat rail's Marks; keyboard glyphs; **a Task's status dot (`TaskStatusDot`)**: a filled circle, a diamond for a milestone, in the Task's workflow status colour, or lucide's dashed circle when the status or its colour is unknown; and **a person's avatar (`Avatar`)**: a GitHub profile picture, or the person's initial while it loads or when it can't be had. An avatar is a picture of someone, not an icon, and it's never used for anything but a person.
- **Productive's palette is a colour family of its own** (0009): `palette-0` to `palette-16`, Productive's 17 colours as Fantastic has them, the same in light and dark, meaning "the colour this was given in Productive" and used only by `TaskStatusDot`. Every dot has a thin border, so White and Canary show on a light background. The status's name is always in words next to it, so the colour never carries the meaning alone.
- **Avatars come from Lookout's own server.** The browser asks `GET /api/avatars/<login>`; the server fetches `https://github.com/<login>.png` for a login in Work's last read only, keeps it under `~/.lookout/avatars/` for a day, and serves it from its own origin. The CSP stays `img-src 'self' data:`; GitHub sees one request per author a day from the server, never one per page load.

## Alternatives rejected

- **Dots by category only** (grey not started, blue started): no new family, but every started Task looks the same, and blue is Busy's (DS-3.6).
- **The browser loads avatars from GitHub:** the CSP would gain a third-party host, every page load would ask GitHub, and offline would show a broken image.
- **Initials only:** no network at all, but not the face you know the author by.
- **`GitMerge` for a PR:** Work lists open PRs only, and on GitHub that icon means merged. A PR takes lucide's `GitPullRequest`, or `GitPullRequestDraft` for a draft, which needs no exception.

## Consequences

- 0008's guard (`web/src/test/icons.test.ts`) lists `TaskStatusDot` and `Avatar` with their reason; `Avatar` is the one component that renders an `<img>`.
- 0009's guard gains the palette family, used only in `TaskStatusDot.tsx`; the DS spec's "Colour by meaning" gains its row.
- `AGENTS.md`'s line for 0008 names this decision.
- A Task whose status has no `color_id`, or one outside the palette, gets the dashed circle, as in Fantastic; a Task's dot never falls back to a Status colour.
