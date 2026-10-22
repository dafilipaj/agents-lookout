---
title: "Design system"
code: "DS"
status: "Draft"
created: "2026-10-22"
updated: "2026-10-22"
---

# Design system

## Summary

Lookout's look, written down once and guarded by tests: one type scale, colour tokens that each mean one thing, and a handful of shared components in `web/src/components/ui/`. Colour then means Status, a failure looks the same wherever it happens, and the next component can't invent a tenth font size or a fifth error box. It extends what [0008](../../decisions/0008-lucide-icons-only.md) did for icons to type, colour and components ([0009](../../decisions/0009-one-design-system-guarded-by-tests.md)).

## Problem

The design review of 2026-10-22 measured the running app and read every component. What it found:

- **Nine font sizes**, five of them 12 px or smaller: 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5 and 15 px, plus shadcn's 14, 16 and 18. Half-pixel steps next to each other read as rendering noise, not as levels. About 230 hand-written sizes in 27 files.
- **Colour that doesn't mean Status.** The brightest things on a screen of many Sessions are the constant ones: the orange Claude logo on every row, and a usage bar that stays solid red for hours. Needs you's amber also marks things that don't need you: "Possibly out of date", the "old" chip, the Fleet banner, and History's search hits. Busy's blue marks a milestone and a PR that's ready.
- **Four styles for "something failed"**: bare red text (composer), a red box with a background (launcher), a red border without one (Work, History), and an amber box (sidebar banner).
- **The same glyph means three things.** A filled dot is Busy in the sidebar, "live" in History and Work; a ring is Idle in the sidebar, "past" in History and Work.
- **Loading that never explains itself.** The chat shows four grey bars, and History a bare "Loading…", for as long as a read takes.
- **Small targets.** The status line's model button is 17 px tall, under WCAG 2.5.8's 24 px.
- **A list the keyboard can't enter.** The Session sidebar is a `listbox` that Tab never reaches, while History's is.
- **Constant motion.** Every Busy marker pulses for as long as it's Busy, so five Busy Sessions keep the edge of the screen moving.
- **A terminal preview that eats the chat.** It opens at a fixed 256 px when a Session Needs you, which on a 700 px window leaves the question card little room.

Each was fixed once, by hand, in one place. Nothing stops the next component from doing it again.

## Requirements

### DS-1 One type scale

Five sizes, by role. Nothing that carries information is smaller than 11 px, and there are no half-pixel sizes.

- [ ] DS-1.1 Every font size in `web/src` comes from the scale's five named steps (UX, "Type scale"): `caption` 11 px, `meta` 12 px, `body` 13 px, `prose` 14 px and `title` 15 px. A guard test fails on an arbitrary size (`text-[11.5px]`), on Tailwind's own size utilities (`text-xs`, `text-sm`, `text-base`, `text-lg` and up), and on a `font-size` or `fontSize` in CSS or a `style`, outside the exceptions listed in the Technical approach. (test)
- [ ] DS-1.2 The shadcn components in `components/ui/` use the scale too: a button, input, menu item, label and popover are `body`, a dialog's title is `title`, its description `meta`. (test)
- [ ] DS-1.3 Seen in both modes at 1440 px: the sidebar, the main pane, History and Work read in four UI levels plus the chat's prose, with no two neighbouring texts a half step apart. (manual)

### DS-2 Colour tokens

New tokens, each with a light and a dark value, and one meaning per family.

- [ ] DS-2.1 `index.css` defines `info-soft`, `info-border` and `info-text` (neutral, for staleness and notices), `highlight` (search hits), `warning`, `warning-soft` and `warning-text` (a level heading toward a limit), and `destructive-soft`, in light and dark mode, as `oklch()` values the Tailwind theme maps to `--color-*`. (test)
- [ ] DS-2.2 `info-text` on `info-soft`, on the background and on the sidebar; `warning-text` on the background and the sidebar; and the foreground on `highlight` over the background and the sidebar keep 4.5:1 or more, in light and dark mode. (test)
- [ ] DS-2.3 Each colour family is used only for its meaning (UX, "Colour by meaning"). A guard test fails when a family's token is used in a file its row doesn't list. (test)

### DS-3 Colour means Status

The design review's suggestion 3, as decided with Dario.

- [ ] DS-3.1 Harness logos are drawn in the text colour around them (monochrome), in the sidebar's rows, the usage strip and History's filter and results. They keep the brand colour in two places: the main pane's header (a live, a starting and a past Session's) and the new Session modal (the launcher). (test)
- [ ] DS-3.2 A usage bar at 95% or more is filled with `destructive-soft` and ends in a 2 px `destructive` edge at the fill's end, instead of a solid red block. At 80% to 94% it is filled with `warning-soft` and ends in a 2 px `warning` edge. Below 80% it stays `foreground/55`. The critical octagon (USAGE-1.2) stays. The usage details popover keeps its solid bars. (test)
- [ ] DS-3.3 Staleness uses the info tone, never amber: Work's "Possibly out of date" (WORK-7.5), Work's "old" chip (WORK-7.3), the sidebar's banners for a stale Fleet list and a lost server (SIDE-6.2), Work's "Session links are unavailable", and the terminal preview's "… · retrying", and the usage strip's "old · …" on a reading marked old. (test)
- [ ] DS-3.4 History's search hits are marked with the `highlight` token, not Needs you's amber. (test)
- [ ] DS-3.5 A sidebar row's context usage, its number and its ring, takes the status line's colours (VIEW-5.5): the row's quiet colour up to 40%, `warning-text` above 40%, `destructive` above 60%, from the same `contextLevel`. Its text keeps 4.5:1 on every row state (SIDE-3.11). (test)
- [ ] DS-3.6 Status colours show only a Status, or something its Status spec ties to one (UX, "Colour by meaning"): Work's "milestone" chip and its PR "ready" chip move to the neutral chip, and a live Linked Session's marker is no longer green (DS-5.3). (test)
- [ ] DS-3.7 Seen in both modes at 1440 px with several Sessions and a limit at 95% or more: the brightest things on screen are the Status markers, strips and the Needs you tint, and nothing is amber that neither needs you nor warns of a limit. (manual)

### DS-4 One Alert

One component for "something went wrong" and "something to know", instead of four styles.

- [ ] DS-4.1 `Alert` in `components/ui/alert.tsx` has a tone, `error` or `info`, and a layout, `box` or `inline`. `error` is `role="alert"` with the `CircleX` icon in `destructive`; `info` is `role="status"` with the `Info` icon in `info-text`, or the icon it's given (`WifiOff`, `TriangleAlert`). A box takes a title, a detail and children (a command, a button); inline is one line that can be cut short, with the whole text in its tooltip. (test)
- [ ] DS-4.2 Every error and notice in the migration list (Technical approach) is an `Alert`. A guard test fails when `role="alert"` is written outside `alert.tsx` (one exception, Technical approach), or when an element outside it draws a box in `destructive` or `info` colours (a `border-destructive…`, `bg-destructive/…`, `bg-destructive-soft`, `border-info-border` or `bg-info-soft` class). (test)
- [ ] DS-4.3 The words don't change: each Alert says what it said before, and Work's problem keeps its title, reason, what to do and its command (WORK-7.1 to 7.3). (test)
- [ ] DS-4.4 Seen in both modes: every box Alert has the same padding, radius, border, icon size and type step, wherever it sits; every inline one the same type step and icon. (manual)

### DS-5 One Session marker

The design review's suggestion 9. A shape means the same thing in every list.

- [ ] DS-5.1 `SessionMarker` in `components/ui/session-marker.tsx` draws a Session's state: a live Session's Status marker (`StatusMarker`, SIDE-3.2), a past Session that can be resumed as lucide's `History` in `muted-foreground`, and one that can't as `CircleSlash`. The Session sidebar, History and Work draw their Session markers only through it. (test)
- [ ] DS-5.2 A History result for a live Session shows that Session's Status marker, from the Session sidebar's list, and follows its Status live. Its "live" chip stays. A resumable result shows the past marker, a blocked one the slashed circle. (test)
- [ ] DS-5.3 A Work row with Linked Sessions shows one marker: the Status marker of its live Linked Session that needs action most (Needs you, then Busy, Idle, Unknown), or the past marker when none is live. Its tooltip still lists each Link's reason (WORK-2.4). (test)
- [ ] DS-5.4 A guard test fails when lucide's `Circle` or `CircleDot` is imported outside `Answering.tsx`, where they draw a question's options, not a Session. (test)
- [ ] DS-5.5 Rows' accessible names don't change: the marker stays hidden from screen readers in History and Work, where the row's words already say it. (test)

### DS-6 Loading that admits time passes

The design review's suggestion 4.

- [ ] DS-6.1 `Loading` in `components/ui/loading.tsx` shows what it's doing ("Reading the Transcript…") at once. From 3 s it adds how long it has taken ("· 4s"), every second. From 15 s it shows a hint, when the place gives one. The label is in a polite `role="status"` region, announced once; the seconds are outside it (as VIEW-1's "Working…" row does). (test)
- [ ] DS-6.2 The chat's skeleton stays, with a `Loading` under it: "Reading the Transcript…", and from 15 s "This is taking a while. The terminal preview still works.", with a Show terminal button for a Controllable Session. (test)
- [ ] DS-6.3 Every other "Loading…" is a `Loading`: History's results and "Loading more…", Work's section headers, the main pane, a starting and a past Session's view, the terminal preview, the usage strip and its details ("Reading usage…"), and the status-line menus. (test)
- [ ] DS-6.4 With no live Session and no Starting row, the main pane says "No Sessions running" with a "Start a Session" button that opens the launcher, as `N` does, instead of "Select a Session" and keys to move through an empty list. With Sessions, the hint stays (VIEW-5.4). (test)

### DS-7 Icon buttons

Fixed sizes, so a target never shrinks under 24 px.

- [ ] DS-7.1 `IconButton` in `components/ui/icon-button.tsx` has two sizes: `sm`, a 24 px box with a 14 px icon, for buttons inside a line or a row; `md`, a 28 px box with a 16 px icon, for a column's header and toolbars. Its accessible name is a required prop, and its tooltip says the same, with the key when there is one. (test)
- [ ] DS-7.2 A guard test fails on a `Button` with an `icon…` size outside `components/ui/`, and on an `IconButton` whose `className` sets a size, height or width. Work's row buttons, which can't be focusable inside an option (WORK UX, "Markers and buttons"), take the `sm` look from `iconButtonVariants`. (test)
- [ ] DS-7.3 The status line's text is `meta` (12 px). Its model and Effort menus (VIEW-6, VIEW-7) are 24 px tall buttons with 4 px of padding on each side, and the line stays 28 px tall. (test)
- [ ] DS-7.4 Seen live: icon buttons side by side are 4 px apart, and a Close button sits 8 px from its neighbour, so the right sidebar's Refresh and Close are hard to mix up. Every icon inside a button is 14 or 16 px. (manual)

### DS-8 Shared pieces that repeat

Patterns the review found three or more times, each drawn slightly differently.

- [ ] DS-8.1 `EmptyState` (a title, a hint, an optional icon and an optional action) replaces the sidebar's and History's `Message`, the chat's `Notice` and the main pane's hint. (test)
- [ ] DS-8.2 `CommandBlock` shows a command to copy: monospace `caption`, wrapped, selected whole on click. Fleet's and tb-session's "isn't installed" and Work's problems use it. (test)
- [ ] DS-8.3 `Chip` is one pill in `caption`, with a tone: `neutral`, `info` or a Status. It replaces the "old", "live", "headless", "milestone" and PR state chips and the chat's message tag. (test)
- [ ] DS-8.4 `Kbd` is one key: the Filter box's `/`, the main pane's hints, the launcher's ⌘↵ and the composer hint's `i`. A sentence is never a key: the launcher's "Esc to close · your input is kept" keeps only "Esc" in a `Kbd`. (test)

### DS-9 The Session list takes keyboard focus

The design review's suggestion 7, as History already does it.

- [ ] DS-9.1 The Session sidebar's listbox has `tabIndex=0` and an `aria-activedescendant` naming the selected Session's option, each option with a stable id. With a Starting row or nothing selected, it names none. (test)
- [ ] DS-9.2 Tab reaches the listbox after the Filter bar's buttons and any Starting row's Dismiss. With focus on it, ↑/↓, j/k, ⌘1–9 and ⌘J work as before (SIDE-5), the list shows a focus ring for keyboard focus only, and the selected row keeps its own ring (SIDE-3.9). (test)
- [ ] DS-9.3 With VoiceOver, focusing the list reads the selected Session's option name (SIDE-3.10), and moving the selection reads the new one. (manual)

### DS-10 Busy pulses only when it changed

The design review's suggestion 11.

- [ ] DS-10.1 A Busy marker pulses for 10 s after its Session became Busy, then holds steady. It goes by the Status's age, not by when the page loaded, so a Session Busy for a minute when the page opens doesn't pulse. The chat's "Working…" dot does the same. With reduced motion, nothing pulses, as now. (test)

### DS-11 Terminal preview height

The design review's suggestion 10.

- [ ] DS-11.1 The terminal preview (VIEW-2) opens at the height remembered for that Session. A Session with none remembered uses the default: 256 px or 35% of the main pane's height, whichever is smaller. (test)
- [ ] DS-11.2 Its top edge is a handle: drag it to resize, or focus it and press ↑/↓ to move it by 16 px. It's a `separator` with its height as its value. The height stays between the Terminal row plus four lines and 70% of the main pane. (test)
- [ ] DS-11.3 The height is kept in this browser, per Session, keyed by the Session's stable id, like the right sidebar's width (HIST-1.3). Resizing one Session's preview doesn't change another's. A kept height taller than a smaller window allows is shown clamped, and kept as it was. On a short window the preview still gives way before the chat (SIDE-8.1). (test)
- [ ] DS-11.4 Seen on a 700 px tall window: when a Session starts to Need you and the preview opens on its own (VIEW-2.2), the question card and the Needs you row stay in view. (manual)
- [ ] DS-11.5 Kept heights for Sessions no longer in the Session list are removed, so storage doesn't grow. Reading or writing storage that fails or holds junk falls back to the default, without an error. (test)

## Non-goals

- **Narrow widths** (the review's suggestion 2): columns that collapse below about 1024 px, a header that folds its buttons, a status line that drops whole parts. Dario uses Lookout full screen; it's in the Backlog.
- **An in-app toast and a Needs you count in the Filter bar** (suggestion 6). In the Backlog.
- **What a sidebar row shows** (suggestion 1): hiding a repeated `repo · branch`, a Busy row's activity. A separate SIDE-2.1 amendment, in the Plan.
- **Select, then act** in History and Work (suggestion 8). Its own spec, merged with Plan item 2.
- A Storybook, a separate package, or a published component library. The design system is the code in `web/src`, this spec and its tests.
- Retuning existing colours (`muted-foreground`, the Status hues) or the contrast rules SIDE-3.11, VIEW-5.9 and WORK-3.5 already test.
- Line heights, spacing and row heights beyond icon buttons. They're consistent enough today.
- The review's smaller findings not listed in DS's requirements: the View only row's grey marker, the composer's Needs you border, the flagged usage line's dimming, the composer hint, the chat's measure, the header's Status tag shape, the launcher's layout, Settings' three Save buttons, a `?` shortcut overlay. Each can come back as its own item.
- A theme switch or other themes. Dark mode follows the system, as now.
- New icons or shapes. DS reuses lucide and the Status shapes, within 0008.

## UX

### Type scale

| Step | Size / line height | Use | Replaces |
|---|---|---|---|
| `caption` | 11 / 16 px | chips, keys, a usage line's second line, tertiary counts | 10, 10.5, 11 px; `text-xs` in a chip |
| `meta` | 12 / 16 px | second lines, section headers, the status line, hints, inline errors | 11.5, 12, 12.5 px where secondary; `text-xs` |
| `body` | 13 / 20 px | row titles, controls, menus, dialogs, Settings, notices | 12.5 px where body text, 13 px; `text-sm`, `text-base` in controls |
| `prose` | 14 / 22 px | the chat's text, the composer, a question's text, Markdown's smaller headings | 13.5, 14, 14.5 px |
| `title` | 15 / 20 px | the main pane's title, a dialog's title, Markdown's first heading | 15 px; `text-lg` |

- Classes are `text-caption`, `text-meta`, `text-body`, `text-prose` and `text-title`, from `--text-*` theme variables, each with its line height. None of the names is a colour token, so `text-…` stays unambiguous.
- Monospace (the status line, commands, the terminal preview) uses the same steps.
- Weights stay as they are: 400, 500 for emphasis, 600 for titles.

### Colour by meaning

| Family | Tokens | Means | Used in |
|---|---|---|---|
| Needs you | `needs-you`, `-soft`, `-text` | the Status Needs you, nothing else | Status marker, strip, tint and tag; a question or permission card; the Needs you row and Mark in the chat; a row's "waiting for" line |
| Busy, Idle | `busy…`, `idle…` | a Status | Status marker, strip and tag; VIEW-8's running Subagents (Busy); SIDE-2.6's background shell (Idle) |
| Warning | `warning`, `-soft`, `-text` | a level heading toward a limit | context above 40% (status line and sidebar), usage at 80% or more, a PR aged 3 to 10 days (WORK-3.5) |
| Destructive | `destructive`, `-soft`, `-text` | an error, a critical level, a destructive action | error Alerts, the critical octagon and bar, context above 60%, a PR over 10 days, End Session, a failed start |
| OK | `ok`, `-text` | something passed | CI passing, an approved PR, a PR under 3 days |
| Info | `info-soft`, `-border`, `-text` | staleness, or something to know that needs nothing from you | info Alerts, the "old" chip, a usage reading marked old, "retrying" |
| Highlight | `highlight` | a search hit | History's snippets |
| Neutral | `foreground`, `muted…`, `border`, `accent`, `sidebar…` | everything else | |

- **Amber means "act on it"**: now (Needs you) or soon (a warning level). Never "this is old" or "this matched".
- **Info is grey, not blue**, since blue is Busy. The icon and the box tell it from plain text.
- **Harness logos**: monochrome, `currentColor`, everywhere but two places: the main pane's header and the new Session modal (the launcher), where the logo is the choice being made. History's filter and a sidebar row are monochrome; in a row the logo takes the row's quiet colour.
- **Usage bar**: normal (under 80%) `foreground/55`; warning (80 to 94%) `warning-soft` with a 2 px `warning` edge; critical (95% or more) `destructive-soft` with a 2 px `destructive` edge. The details popover keeps solid fills.

Proposed values, to be checked by DS-2.2's test:

| Token | Light | Dark |
|---|---|---|
| `info-soft` | `oklch(0.965 0 0)` | `oklch(1 0 0 / 7%)` |
| `info-border` | `oklch(0.88 0 0)` | `oklch(1 0 0 / 14%)` |
| `info-text` | `oklch(0.42 0 0)` | `oklch(0.82 0 0)` |
| `highlight` | `oklch(0.145 0 0 / 10%)` | `oklch(1 0 0 / 16%)` |
| `warning`, `-soft`, `-text` | Needs you's values today | Needs you's values today |
| `destructive-soft` | `oklch(0.577 0.245 27.325 / 14%)` | `oklch(0.704 0.191 22.216 / 20%)` |

### Components

```
Alert, box, error                       Alert, box, info
┌──────────────────────────────────┐    ┌──────────────────────────────────┐
│ (x) Couldn't read PRs            │    │ (i) Fleet isn't answering.       │
│     GitHub rate limit. In 12m.   │    │     List is 2m old.              │
│     ┌──────────────────────────┐ │    └──────────────────────────────────┘
│     │ gh auth login            │ │    Alert, inline, error
│     └──────────────────────────┘ │    (x) Couldn't send: the Session ended.
└──────────────────────────────────┘

SessionMarker                Loading                          IconButton
 ◆ ● ○ ?   live, by Status    Reading the Transcript… · 7s     sm  [24 px, 14 px icon]
 [hist]    past, resumable    This is taking a while. The      md  [28 px, 16 px icon]
 [slash]   can't be resumed   terminal preview still works.
                              [Show terminal]
```

- The mock-ups use symbols as shorthand: `(x)` is lucide's `CircleX`, `(i)` its `Info`, `[hist]` its `History`, `[slash]` its `CircleSlash`, and ◆ ● ○ ? the Status shapes.
- **Alert, box**: `rounded-md`, a 1 px border, `px-2.5 py-2`, a 14 px icon at the first line, the title in `meta` medium, the detail in `meta`. Error: `destructive-soft` background, `destructive/30` border, title in `destructive-text`, detail in `muted-foreground`. Info: `info-soft` background, `info-border` border, `info-text`.
- **Alert, inline**: a 12 px icon and one line of `meta` in `destructive-text` (error) or `info-text` (info), cut short with an ellipsis.
- **No amber Alert.** What used to be amber is now info (staleness) or a Needs you card, which is a Status, not an Alert.
- **SessionMarker** sits in a box the size its list gives (18 px in the sidebar, SIDE-3.8; 14 px in History and Work), so titles line up whichever shape shows.
- **Loading**: the label in `meta` `muted-foreground`; the elapsed time after a ` · ` in `tabular-nums`; the hint under it in `meta`, with an action when there is one.
- **IconButton**: ghost by default, `muted-foreground` at rest, `accent` under the pointer; its focus ring is the Button's.
- **EmptyState**: centred, the title in `body` medium, the hint in `meta` `muted-foreground`, an optional 20 px icon above, an optional action below.
- **Chip**: `rounded-full px-1.5`, `caption` medium, `leading-4`. Neutral: `bg-muted`, foreground. Info: `info-soft`, `info-text`. A Status tone: its `-soft` and `-text`.
- **Kbd**: `caption` mono, `rounded border border-border px-1`, at least 20 px wide.
- **CommandBlock**: `rounded-md border border-border bg-background p-2`, `caption` mono, wrapped anywhere, `select-all`.

### Places

- **Sidebar row**: the Harness logo in the row's quiet colour; the context ring and % in the warning or danger colour above 40% and 60%.
- **Status line**: 12 px mono; the model and Effort menus 24 px tall; the line 28 px.
- **Terminal preview**: a 6 px handle on its top border, `row-resize` under the pointer, a 2 px line in `border` that turns `ring` while dragged or focused. Each Session keeps its own height; one with none opens at the default.
- **Main pane with no Sessions**: "No Sessions running", "Start a Session" as a primary button (`N`), and under it the `N` key hint.
- **Focus**: the Session list shows a ring around the list for keyboard focus (`focus-visible`); a click on a row focuses the list without one.

## Technical approach

DS changes only `web/src`. Nothing on the server changes, so every check is a unit or component test, or an eye on the running app.

### The guard

`web/src/test/design-system.test.ts`, next to the icons guard (`icons.test.ts`, [0008](../../decisions/0008-lucide-icons-only.md)), reads the same sources the same way: `web/src` and `shared`, tests left out, with TypeScript's parser, so classes inside `cn()`, `cva()` and templates are found and comments are not. Each check has a test that it catches what it should and lets through what it should, as `icons.test.ts` has, and a test on the real tree.

1. **Font sizes only from the scale (DS-1.1, 1.2).** In any string: `text-[<n>px|rem|em]`, `text-(xs|sm|base|lg|xl|[2-9]xl)`, `text-[length:…]`. In CSS or a `style`: `font-size` and `fontSize`. Exceptions: the `?` glyph inside `StatusMarker`'s Unknown shape (an SVG `fontSize`), and the `--text-*` definitions in `index.css`.
2. **No hand-rolled alert boxes (DS-4.2).** `role="alert"` only in `components/ui/alert.tsx`, and in `Answering.tsx`'s `TerminalNote`, which tells you to answer in the terminal: part of a Needs you card, so amber, not an Alert. The classes `border-destructive…`, `bg-destructive/<n>`, `bg-destructive-soft`, `border-info-border` and `bg-info-soft` only in `alert.tsx` and `chip.tsx`, and in an allowlist with a reason each: the destructive Button variant, a failed Starting row's tint (`LaunchItem`), a failed start's status pill (`StartingView`).
3. **Colour tokens only in their meaning (DS-2.3, 3.6).** For each family in UX, "Colour by meaning", the files that may use it: a `bg-`, `text-`, `border-`, `ring-`, `fill-`, `stroke-`, `outline-`, `from-`, `to-` or `decoration-` class, or a `var(--…)`, of a family's token outside its files fails. The lists live in the test with a reason per file; adding a file is a reviewed change. `needs-you`'s list, for example, is `StatusMarker`, `lib/sessions.ts` (strip, tint, tag), `ChatActivity`, `ChatRail`, `Chat` and `Answering` (question and permission cards, and `TerminalNote`) and `SessionItem` (its "waiting for" line).
4. **Harness colour only in headers (DS-3.1).** `HarnessIcon` takes `tone: 'brand' | 'mono'`, `mono` by default. `tone="brand"` only in `SessionView`, `StartingView` and `PastSessionView` (the main pane's header) and `Launcher` (the new Session modal).
5. **The marker everywhere (DS-5.1, 5.4).** `Circle` and `CircleDot` imported only in `Answering.tsx`. Component tests render a sidebar row, a History result in each state and a Work row with live and past Links, and check that each marker is a `SessionMarker` (`data-session-marker` with `data-state` and, when live, `data-status`).
6. **Icon buttons (DS-7.2).** `size="icon…"` on a `Button` only inside `components/ui/`; no `size-`, `h-` or `w-` class on an `IconButton`.

The icons guard is unchanged: `SessionMarker` draws with lucide and `StatusMarker`, so no new file draws an `<svg>`.

### Tokens

- **Type:** `@theme` in `index.css` gains `--text-caption: 11px` with `--text-caption--line-height: 16px`, and so on for each step (UX table). Tailwind v4 makes each a `text-<step>` class.
- **Colour:** the new tokens in `:root` and the dark media query, mapped to `--color-*` in `@theme inline`, so `test/contrast.ts`'s `themeTokens` reads them. DS-2.2 is a contrast test over those, as SIDE-3.11's and VIEW-5.9's are.
- **Warning:** `CONTEXT_LEVEL_CLASS.warning` (`lib/sessions.ts`), the usage `warning` level (`lib/usage.ts`) and `AGE_LEVEL_CLASS.aging` (`lib/work.ts`) move from `needs-you-text` to `warning-text`. The usage bar's warning fill moves from `bg-needs-you` to `bg-warning-soft` with a 2 px `bg-warning` edge, as the critical level does with `destructive`.

### Components

- New files in `web/src/components/ui/`: `alert.tsx`, `session-marker.tsx`, `loading.tsx`, `icon-button.tsx`, `empty-state.tsx`, `command-block.tsx`, `chip.tsx`, `kbd.tsx`. Each is small, takes its tone and size as props, and exports its `cva` variants, as `button.tsx` does.
- `StatusMarker.tsx` stays where it is: 0008 and its guard name that file. `SessionMarker` composes it.
- **SessionMarker's Status** for History and Work comes from the Session sidebar's list already in the browser (the store's `SessionRow`s by session ID), not from a new server field. History's `isLive` already looks there.
- **Pulse (DS-10):** `StatusMarker` takes the Status's `since`. While `now - since` is under 10 s it adds `animate-busy`, with the animation's delay set negative by the time already passed, so a re-render doesn't restart it. After 10 s the class goes. `ChatActivity`'s dot does the same with the Turn's start.
- **Loading (DS-6):** takes `label`, `since` and an optional `hint` (with an action). It ticks on the app's one-second clock (`now`) rather than its own timer.
- **Terminal preview (DS-11):** `lib/terminal-height.ts` holds a pure `drawerHeight(paneHeight, kept)` and the keep and read, as `lib/right-sidebar.ts` does for the width. One `localStorage` entry (key `lookout.terminal`) holds a map from the Session's stable id to its height. Read and write are inside `try`; anything odd is the default. A Session with no entry uses the default. When the Session list loads or changes, entries for ids not in it are pruned, so the map doesn't grow. The drawer swaps `h-64` for that height; the handle is a `role="separator"` with `aria-orientation="horizontal"`, `aria-valuenow`, `aria-valuemin` and `aria-valuemax`.
- **Session listbox (DS-9):** `SessionItem` gets `id="session-<id>"`; the listbox in `Sidebar.tsx` gets `tabIndex={0}`, `aria-activedescendant` and `focus-visible` ring classes. The app's key handler already moves the selection when focus isn't in a text field, so nothing else changes.

### Migration

Every place to change. Lines are from `main` on 2026-10-22; the guard finds any that move.

**Type scale (DS-1).** About 230 sizes in 27 files: `Chat` 27, `WorkPanel` 24, `HistoryPanel` 21, `SessionView` 20, `UsageStrip` 18, `Answering` 17, `SettingsPage` 17, `Launcher` 13, `StartingView` 13, `Sidebar` 12, `Markdown` 9, `MainPane` 8, `PastSessionView` 6, `LaunchItem` 4, `SessionItem` 3, `StatusMenu` 3, `ui/input` 3, `ChatRail`, `RightSidebar`, `SessionTitle`, `ui/button`, `ui/dialog`, `ui/dropdown-menu`, `ui/textarea` 2 each, `ChatActivity`, `ui/label`, `ui/popover` 1 each. The ones below 11 px or on a half pixel:

- 10 px: `Sidebar.tsx:252` (the `/` key), `LaunchItem.tsx:82`.
- 10.5 px: `WorkPanel.tsx:532,542,745` (PR and milestone chips), `HistoryPanel.tsx:361` (headless), `UsageStrip.tsx:121` (weekly line), `Chat.tsx:526` (message tag), `ChatRail.tsx:135`.
- 11.5 px: `SessionItem.tsx:76,124`, `SessionView.tsx:783,816` (status line, terminal preview), `StatusMenu.tsx:65`, `WorkPanel.tsx:654,659,837`, `HistoryPanel.tsx:363,364`, `UsageStrip.tsx:179`, `Answering.tsx:46,109,203,212,231`, `Chat.tsx:263,449,522,540,562,589,612`, `ChatRail.tsx:131`, `LaunchItem.tsx:69,77`, `StartingView.tsx:96`, `Markdown.tsx:124`.
- 12.5 px: `SessionView.tsx:384,609,930,1053,1069`, `Launcher.tsx:94,105,204,209`, `SettingsPage.tsx:60,83,88,143,166,171,176,221,226,253,260`, `Answering.tsx:41,167`, `Chat.tsx:421,537,552,560,664`, `ChatActivity.tsx:39`, `MainPane.tsx:106`, `PastSessionView.tsx:80`, `StartingView.tsx:58,78,93`, `UsageStrip.tsx:67,149`, `Markdown.tsx:58,291`.
- 13.5, 14, 14.5 px: `SessionView.tsx:939` (composer), `Chat.tsx:430,509,611`, `Answering.tsx:108,210,218`, `Markdown.tsx:277,279`.
- Tailwind sizes: `MainPane.tsx:53,62,75,105`, `PastSessionView.tsx:52,61`, `StartingView.tsx:30,38`, `StatusMenu.tsx:96`, `ui/button.tsx:7,24`, `ui/dialog.tsx:137,150`, `ui/dropdown-menu.tsx:52,80`, `ui/input.tsx:10`, `ui/label.tsx:13`, `ui/popover.tsx:49`, `ui/textarea.tsx:9`.

**Colour (DS-2, DS-3).**

- Tokens: `index.css:7-45` (light), `:48-85` (dark), `:87-132` (`@theme inline`).
- Harness logos: `SessionItem.tsx:73`, `HistoryPanel.tsx:270,333`, `UsageStrip.tsx:88,104,155`, `LaunchItem.tsx:66` go `mono`; `SessionView.tsx:385`, `StartingView.tsx:59`, `PastSessionView.tsx:81` and `Launcher.tsx:141` stay `brand`. `HarnessIcon.tsx:23` (its `fill`) takes the tone. `Launcher.tsx:141` is `brand` too, so the choice in the modal keeps its colour.
- Usage bar: `UsageStrip.tsx:269-282` (`Bar`, its fill at `:276`), now with the warning fill and edge at 80 to 94%.
- Staleness to info: `WorkPanel.tsx:329` ("old"), `:659` ("Possibly out of date"), `:281` ("Session links are unavailable", `border-needs-you/30` today), `Sidebar.tsx:317-328` (`Banner`), `SessionView.tsx:809` ("retrying"), `UsageStrip.tsx:134,164` (a reading marked old, "old · …").
- Search hits: `HistoryPanel.tsx:369`.
- Sidebar context: `SessionItem.tsx:114-119` and `ContextRing` (`:136-146`).
- Warning levels: `lib/sessions.ts:69`, `lib/usage.ts:76`, `lib/work.ts:86-89`, `UsageStrip.tsx:276`.
- Status colours elsewhere: `WorkPanel.tsx:542` (milestone chip, Busy's blue), `:688` (PR "ready" chip, Busy's blue), `:569` (live Linked Session, `ok` green).

**Alert (DS-4).** Boxes: `WorkPanel.tsx:243` (couldn't open a Session), `:281` (Session links), `:353-370` (`Problem`), `Launcher.tsx:204,209`, `HistoryPanel.tsx:277`, `RightSidebar.tsx:181` (refresh problem), `SessionView.tsx:609` (End Session dialog), `StartingView.tsx:29` (no longer listed), `:87` (failed start), `MainPane.tsx:61,74`, `PastSessionView.tsx:60`, `Chat.tsx:328`, `Sidebar.tsx:317-328` (`Banner`), `:339-354` and `HistoryPanel.tsx:404-419` (`NotInstalled`). Inline: `SessionView.tsx:930` (composer), `SettingsPage.tsx:88,176,260`, `Answering.tsx:167`, `Chat.tsx:296` (Show earlier), `StatusMenu.tsx:110`, `LaunchItem.tsx:77`.

**SessionMarker (DS-5).** `SessionItem.tsx:61`, `HistoryPanel.tsx:319-321`, `WorkPanel.tsx:559-572` (`SessionMarker`, renamed or removed).

**Loading (DS-6).** `Chat.tsx:278,669-677` (skeleton), `:293` (Show earlier), `HistoryPanel.tsx:192,195,223`, `WorkPanel.tsx:327`, `MainPane.tsx:53`, `StartingView.tsx:38`, `PastSessionView.tsx:52`, `SessionView.tsx:818`, `UsageStrip.tsx:60,67`, `StatusMenu.tsx:76`. Empty main pane: `MainPane.tsx:101-134` (`Empty`, `Hint`) and its caller.

**Icon buttons (DS-7).** `Sidebar.tsx:257-276` (New Session, Settings, each `size-7` over `icon-sm`), `RightSidebar.tsx:149-167,198-200` (Refresh, Close, the rail's tabs), `SettingsPage.tsx:229-238`, `SessionView.tsx:425-433` (Copy session ID), `WorkPanel.tsx:792-803` (`RowButton`), `StatusMenu.tsx:58-73` (menu trigger), `SessionView.tsx:779-789` (`StatusBar`).

**Shared pieces (DS-8).** `EmptyState`: `Sidebar.tsx:330-337`, `HistoryPanel.tsx:382-390`, `Chat.tsx:659-667`, `MainPane.tsx:101-116`. `CommandBlock`: `Sidebar.tsx:346`, `HistoryPanel.tsx:411`, `WorkPanel.tsx:363`. `Chip`: `WorkPanel.tsx:329,532,542,745`, `HistoryPanel.tsx:326,361`, `Chat.tsx:526`. `Kbd`: `Sidebar.tsx:252`, `MainPane.tsx:118-134`, `Launcher.tsx:215,221`, `SessionView.tsx:900`.

**Session list (DS-9).** `Sidebar.tsx:199`, `SessionItem.tsx:34-37`.

**Pulse (DS-10).** `StatusMarker.tsx:27`, `ChatActivity.tsx:43`, `index.css:156-170`.

**Terminal preview (DS-11).** `SessionView.tsx:792-823` (`Drawer`, `h-64` at `:816`), which reads and keeps the height by the Session's id; the pruning runs where the Session list is read.

### Other specs to amend

Each lands with the code it covers, with a Changelog line in that spec:

- **SIDE**: UX "Markers" (the pulse, DS-10), the row's Harness mark (mono) and context colours (DS-3.5), the banner's tone (SIDE-6.2's wording stays), the listbox's focus (DS-9).
- **VIEW**: UX "Loading" (DS-6.2), VIEW-5.4's empty state (DS-6.4), the status line's size and menus (DS-7.3), the preview's height (DS-11).
- **HIST**: UX "Markers" (DS-5.2) and the search hit's colour (DS-3.4).
- **WORK**: UX "Markers and buttons" (DS-5.3), the milestone and "ready" chips (DS-3.6), "Possibly out of date" and "old" (DS-3.3).
- **USAGE**: the bar at 95% or more (DS-3.2), the bar at 80% to 94% (DS-3.2), the Harness marks (DS-3.1), and "old · …" moving from amber to info (DS-3.3).

### Key decisions

- **Extend, don't add a library**: the components stay in `web/src/components/ui/` beside shadcn's, and this spec is the reference. No Storybook: one user, one app, and the guard plus component tests do what a gallery would.
- **Guard tests, not lint rules**: the same TypeScript-parser approach as 0008's guard, so one pattern covers icons, type, colour and components, with its exceptions in one place.
- **Steps named by role** (`caption`, `meta`, `body`, `prose`, `title`), not by size: a step's size can change without renaming its uses, and none collides with a colour token in `text-…`.
- **Warning has its own token names**: the guard can keep Needs you to the Status and levels to levels, even while both are amber.
- **Two Alert tones, no amber one**: after DS-3.3 nothing left is an amber box but Needs you cards, which are a Status.
- **Info is grey**: blue is Busy, and every other hue is taken.
- **`StatusMarker` stays put; `SessionMarker` wraps it**: 0008 and its guard name the file, and moving it would need a decision for no gain.
- **A Linked Session's Status comes from the browser's Session list**: Work and History already have it, and a server field would duplicate Fleet's.
- **The pulse goes by the Status's age**: a reload, a second tab or a re-render doesn't restart it.
- **Terminal height is per Session**: Dario's choice, since Sessions differ in how much terminal they need. It's kept in this browser by the Session's stable id, like the right sidebar's width, with no server field. A Session with none uses the default, and entries for Sessions gone from the list are pruned.
- **Harness logos: monochrome except in the header and the launcher**: colour marks which Harness you're looking at or choosing. In lists and filters the Status carries the colour.
- **A usage bar's warning level gets the soft fill and edge too**: one bar with one look per level, not a saturated fill at 80% and a soft one at 95%.
- **A past Session is lucide's `History`, in `muted-foreground`**: it can't be mistaken for Idle's ring, and `CircleSlash` stays for one that can't be resumed.
- **Milestone and "ready" chips are neutral**: Busy's blue means Busy. "Approved" keeps `ok` green, which isn't a Status.
- **The usage strip's "old · …" is info**: it's staleness, like Work's "old" chip.
- **The chat's text is `prose`, 14 px**: a fifth step, so what you read most isn't a row title's size or the page title's.
- **Warning levels are amber, through their own tokens**: "act on it, now or soon", kept apart from Needs you by the guard.

## Open questions

None.

## Changelog

- 2026-10-22: Created, from the design review of 2026-10-22 and Dario's answers to its 12 suggestions: 3, 4, 5, 7, 9, 10, 11 and 12 here; 1 and 8 in the Plan; 2 and 6 in the Backlog.
- 2026-10-22: Dario answered the 8 open questions. 1, 2, 3, 5, 6 and 7 as recommended: separate amber `warning` tokens, the 14 px `prose` step, the usage strip's "old · …" as info, the 80 to 94% bar with `warning-soft` and a 2 px edge, `History` for a past Session, neutral milestone and "ready" chips. 4 differently: Harness logos are monochrome in History's filter and the sidebar, but keep brand colour in the new Session modal and the Session header (DS-3.1). 8 differently: the terminal preview's height is per Session, kept in this browser by the Session's stable id and pruned for gone Sessions (DS-11).
