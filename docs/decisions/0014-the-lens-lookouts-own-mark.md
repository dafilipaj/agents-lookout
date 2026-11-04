---
status: Accepted
date: 2026-11-04
supersedes: 0008 (its list of exceptions only)
---

# 0014. The Lens, Lookout's own mark

## Context

- Lookout had no mark of its own: its favicon was an amber ring around a white dot, and nothing in the app said which tab or window was Lookout. Dario asked for a minimalist logo, used as the favicon and beside the sidebar's Filter box (2026-11-04).
- Five concepts were drawn on a canvas (Lens, Binoculars, Tower, Panes, an L with a sight). Dario chose the Lens over the recommended Panes.
- 0008 lets only shapes with a defined meaning draw their own `<svg>`. A brand is one: the Harness logos are already an exception for the same reason.
- The old favicon's ring was amber, which is Needs you's colour (DS-3).

## Decision

- **The Lens is Lookout's mark:** a ring and a solid dot set off centre toward the top right, so it looks one way. In a 24 px box, with lucide's grammar (2 px stroke, round caps and joins): `circle cx=12 cy=12 r=8.5`, stroked, and `circle cx=14.25 cy=9.75 r=2.75`, filled.
- **One component draws it:** `LookoutMark` in `web/src/components/ui/lookout-mark.tsx`, in `currentColor` and hidden from screen readers. It joins 0008's exceptions (as amended by 0012), and the icon guard's list of files that may draw an `<svg>`.
- **It's the brand, never a Status:** it takes the text colour around it, never a Status, Warning, Destructive or Primary token. The favicon is the mark in near-white on a near-black tile, with no amber, so a Needs you mark on the favicon stays possible later.

## Alternatives rejected

- **A lucide icon as the mark** (`Telescope`, `ScanEye`): a stock icon that also appears in other apps' toolbars isn't a brand.
- **The Panes** (the recommended concept, three columns as the app's grid): Dario preferred the Lens.
- **An amber or indigo mark:** amber means Needs you; Primary marks you and what you act on (DS-12.4).

## Consequences

- The favicon (`web/public/favicon.svg`) and the sidebar's Filter bar (SIDE-8.2) show the Lens; DS-14 holds the requirements.
- Another place that wants the mark uses `LookoutMark`, never a copy of its paths.
