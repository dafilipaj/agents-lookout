---
title: "Places: the rail that switches between the Inbox, Sessions and People"
code: "NAV"
status: "Done"
created: "2026-11-26"
updated: "2026-11-27"
---

# Places

## Summary

A rail at the window's left edge switches Lookout between its places: the Inbox, where Reports arrive, Sessions, which is the Lookout that existed before, and People, the people you manage ([PEOPLE](../people/SPEC.md)). A place owns the left column and the main pane; the right sidebar, the launcher and the keys of the panels are the same in every place. The rail counts what waits in each place, so a Session that Needs you shows while you read a Report. People joined the rail with its first page ([0017](../../decisions/0017-one-app-for-both-roles.md), PEOPLE-3.1).

## Problem

Lookout covers the contributor half of Dario's job. The managing half, reports on what the team did and where a person's goals stand, lives in other tools, and each switch between them costs attention. The first thing that half needs is somewhere for what arrives to land, beside the Sessions and not instead of them: with only one left column, a list of Reports would either push the Session list out or squeeze into the right sidebar, where the page it opens has no room for its own tabs.

## Requirements

### NAV-1 The rail

- [x] NAV-1.1 The window's first column is the rail, 56 px wide, a column of the shell's grid (SIDE-8.1): its header cell continues the header line and holds Lookout's mark (DS-14) at 20 px, centred, in the sidebar's text colour and hidden from screen readers; under it are the places' buttons, Inbox, Sessions, then People (PEOPLE-3.1), in a navigation landmark named "Places". (test)
- [x] NAV-1.2 A place's button (DS-24) shows its icon over its name and says where you are: the current place's has `aria-current="page"` and the selected row's neutral wash, never Primary (DS-12.4). Its tooltip names its key ("Inbox (1)"). (test)
- [x] NAV-1.3 Settings and Keyboard shortcuts are the rail's last two buttons, at its bottom, Keyboard shortcuts above Settings: the same `IconButton`s the Session sidebar's header had (`md`), Settings pressed while Settings is open and with its Tools dot (TOOLS-2.4), Keyboard shortcuts returning focus to itself when its dialog closes (SIDE-7.5). The Session sidebar's header keeps its filter and New Session. (test)
- [x] NAV-1.4 Seen in light and dark mode at 1440 px: the header line runs unbroken across the rail and the three columns, the rail's buttons are centred, and the Session sidebar's filter is wider by the room the mark and the two buttons gave up. (manual)

### NAV-2 A place owns the left column and the main pane

- [x] NAV-2.1 Sessions is the place of every path Lookout had before the rail except the four in NAV-2.3: `/`, a Session, a past Session, a start and a Spec view; and a document opened from a Session's chat (DOC-2.6). Its left column is the Session sidebar and its main pane what those paths showed. (test)
- [x] NAV-2.2 The Inbox is the place of `/inbox` and `/inbox/<Report>`: its left column is the Inbox's list (INBOX-1) and its main pane the Report (INBOX-2). The left column is 280 px wide in every place, and its dock holds the usage strip and the Memory line in each. (test)
- [x] NAV-2.3 Settings, the Topics graph, a Topic view, the Suggest view and a document opened from the Library or a Topic view (DOC-2.6) belong to no place: the left column keeps the place you came from, and that place's button stays current. Opened where no place was shown before (a new browser tab), they show over Sessions, whatever another tab shows. The place last shown is kept for the browser tab, so a reload on one of them keeps its left column. (test)
- [x] NAV-2.4 Pressing a place's button, or its key, shows that place where you left it in this page load: the Report or the Session that was last open there, when it still exists, else the place's own start (`/inbox`, `/`, `/people`). A Session that got its session id meanwhile (Codex, after its first prompt) is still that Session. Pressed while one of NAV-2.3's views is open over that place, it leaves that view the same way. (test)
- [x] NAV-2.5 The right sidebar is one thing in every place: whether it's open, its width, its tab and each panel's state carry over a switch of place unchanged. (test)
- [x] NAV-2.6 The Session sidebar keeps its state over a switch of place and back: its filter's text and the selected Session. A Session that finished while you were in the Inbox is Unread when you come back (SIDE-13). (test)
- [x] NAV-2.7 A switch of place and a reload on the Inbox's path work end to end: from Sessions, the Inbox button shows the Inbox's list and `/inbox` in the address bar, a reload keeps it, the Sessions button brings Sessions back, and Back and Forward step through the two. (e2e)

### NAV-3 What waits in each place

- [x] NAV-3.1 The Inbox's button counts the unread Reports (INBOX-3.3) as a neutral count on its icon's corner, the count Topics' tab has (TOPIC-9.4); none at 0. Its accessible name says it: "Inbox, 4 unread". (test)
- [x] NAV-3.2 The Sessions button counts the Sessions that Need you, the number the tab title shows (SIDE-3.3), in Needs you's amber, in every place; none at 0. Its accessible name says it: "Sessions, 2 need you". (test)
- [x] NAV-3.3 ⌘J works in every place: from the Inbox it selects the first Session that Needs you, which shows Sessions (SIDE-5.3). There it looks past the Session filter, which isn't on screen in the Inbox, and clears one that would hide the Session it lands on. (test)

### NAV-4 Keys

- [x] NAV-4.1 `1` shows the Inbox, `2` shows Sessions and `3` shows People (PEOPLE-3.1), as their buttons do (NAV-2.4): with no modifier, not in a text field and not while a dialog is open. Each is an entry of the shortcuts list (SIDE-7.4). (test)
- [x] NAV-4.2 The keys of the left column's list go to the list that shows: in the Inbox, ↑/↓, j/k, ⌘1–9 and `/` are the Inbox's (INBOX-5) and never move the Session selection, in People they are People's (PEOPLE-3.5), and in Sessions they are SIDE-5's. New Session (`N`) and the panels' keys work in every place. (test)
- [x] NAV-4.3 The edge that shows where the keys are (SIDE-11.3) sits on the left column while its list has them, in every place, and focus on a rail button counts as that list's. (test)

## Non-goals

- A right sidebar that differs by place, or a tab that narrows to what's open in the main pane: later, with its own spec.
- Hiding, collapsing or reordering the rail; a place per repo or project; places you add yourself.
- Unread Sessions counted on the rail: the Sessions button counts only what Needs you. The tab title keeps its dot (SIDE-13.6).
- New paths for the views that existed: Plan item 26 owns the routing scheme.
- A key for Settings or for Keyboard shortcuts: neither had one.

## UX

```
┌────┬───────────────┬──────────────────────────────────┬────┐
│ ◎  │ / filter    + │ header                           │ ⏱  │
├────┼───────────────┼──────────────────────────────────┤    │
│ ▣4 │ the place's   │ the place's main pane            │ …  │
│Inbx│ list          │                                  │    │
│ ▤2 │               │                                  │    │
│Sess│               │                                  │    │
│    │               │                                  │    │
│ ⌨  ├───────────────┼──────────────────────────────────┤    │
│ ⚙  │ usage, memory │ composer and status line         │    │
└────┴───────────────┴──────────────────────────────────┴────┘
```

- The rail is the sidebar's colour, with the sidebar's border at its right. Its body runs past the dock line to the bottom, as the right sidebar's does; Keyboard shortcuts and Settings sit 8 px above the window's edge, 4 px apart.
- A place's button is 48 px wide and 44 px tall, 4 px from its neighbour: a 16 px icon over its name in `caption`. Inbox is lucide's `Inbox`, Sessions is `MessagesSquare`, People is `Users`. The current one is on `sidebar-accent` in `foreground`; the others are `muted-foreground` and take `sidebar-accent` at 60% on hover, as the right sidebar's tabs do.
- A count sits on the icon's top right corner. The Inbox's is the neutral `Count`. The Sessions button's is the same shape in `needs-you` with `needs-you-foreground` text: amber means act on it (GUIDE, principle 1).
- **Shortcuts:** `1` Inbox, `2` Sessions, `3` People.
- Nothing takes focus on a switch of place (SIDE-11.1): the place's list has the keys because the page does (SIDE-11.2).

## Technical approach

- **The grid.** `SHELL_GRID` gains a first `auto` column for the rail (`Shell.tsx`); `PlaceRail` is a `SHELL_COLUMN` with a header cell and a body that runs to the bottom. The left column is whichever list the place has: the Session sidebar stays mounted, hidden under another place's list, so it keeps its filter, its hover-freeze and its scroll (NAV-2.6).
- **The place is derived from the path.** `placeOf(route, last)` in `lib/places.ts`: `inbox` for the Inbox's routes, `sessions` for Sessions', and the last place for Settings, the Topics graph, a Topic view and Suggest. The last place and each place's last path are kept in App; the last place is also written to `sessionStorage` (`lookout.place`), the tab's own, read with "anything odd is Sessions".
- **Routes.** `{ name: 'inbox'; id?: string; doc?: number }` at `/inbox`, `/inbox/<id>` and `/inbox/<id>/<n>` (INBOX-2.3). Nothing else moves (Plan item 26).
- **Keys.** The Session sidebar's window handler stands down while its column is hidden (`keyboardEnabled`), except ⌘J, which it still answers in the Inbox, from every row whatever its filter holds. `1`, `2` and `3` are handled in App beside the panels' keys.
- **Where the keys are.** The rail and the left column carry `data-place`; `placeOf(el)` in `lib/keys.ts` answers `inbox` or `sessions` for either.
- **Design system.** The place button is a new piece, `ui/place-rail.tsx` (DS-24), which also owns the amber count, so Needs you's colour gains one listed place in the colour guard (DS-2.3).

### Key decisions

- **A rail, not two more tabs or a header switch** ([0017](../../decisions/0017-one-app-for-both-roles.md)): a place needs the left column for its list and the right sidebar for its tabs.
- **Settings stays a view over the place you were in**: it has no list of its own, and the Session list beside it is what SIDE-7.6's Esc returns to. A rail button that swapped the left column for nothing would only move things.
- **The buttons carry their names**: an icon alone isn't universal here (GUIDE, principle 8), and 56 px holds a `caption` word.
- **The Sessions count is Needs you only, and amber**: it is the one number that means "act", and it's what you'd miss while reading a Report. Unread is a "new" mark, which never takes a Status colour or Primary (DS-12.4).
- **`1` and `2`, not letters**: every free letter is a panel's or a row's key somewhere, and digits read as "first place, second place". ⌘1–9 stays the rows'.
- **Both left lists stay mounted**: the Session sidebar holds state a remount would lose, and its window key handler already knows how to stand down.

## Open questions

None blocking.

## Changelog

- 2026-11-26: Created from Dario's pivot (Plan item 67) and the canvas of three layouts; he chose the rail (A), the names Sessions and People, and People off the rail until it has a page. Ready without a separate grill: its forks were the canvas's and that one question.
- 2026-11-26: Built: `PlaceRail.tsx`, `ui/place-rail.tsx` (DS-24), `lib/places.ts`, the `inbox` route, the left column hosting either list, and `1` and `2`. In Progress.
- 2026-11-26: From the review (Codex), before the first commit. NAV-2.3: the last place was kept for the whole browser, so a new tab opened on Settings could show over the Inbox because another tab was there; it's the tab's own now. NAV-3.3: ⌘J from the Inbox searched the rows the Session filter left, so a filter nobody could see there made it do nothing while the rail counted a Session that Needs you. NAV-2.4: a Codex Session that got its session id while you were in the Inbox was taken for gone.
- 2026-11-27: NAV-2.1 and 2.3 amended for the Document view (DOC): a document at a Session's path is Sessions', and one at `/doc/…` belongs to no place.
- 2026-11-27: NAV-1.4 ticked: Dario looked at the rail on 4747 ("New Nav looks good"). Every requirement is ticked, so the status is Done.
- 2026-11-27: People is the third place (PEOPLE-3.1): NAV-1.1, 2.4, 4.1 and 4.2 amended for its button, its start, its key `3` and its list's keys; its own criteria are PEOPLE-3's. The left column's slot for a place's list is `Sidebar`'s `list` now, for the Inbox's and People's alike. The non-goal that kept People off the rail is gone.
- 2026-11-27: Wording only, after a review of People: the Summary, NAV-2.2 and NAV-4.2 said "both" places from when there were two; so did NAV-4.3 ("either place"), whose test now asks People too; they say "every place" now.
