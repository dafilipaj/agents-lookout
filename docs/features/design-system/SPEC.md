---
title: "Design system"
code: "DS"
status: "Done"
created: "2026-10-22"
updated: "2026-10-27"
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

- [x] DS-1.1 Every font size in `web/src` comes from the scale's five named steps (UX, "Type scale"): `caption` 11 px, `meta` 12 px, `body` 13 px, `prose` 14 px and `title` 15 px. A guard test fails on an arbitrary size (`text-[11.5px]`), on Tailwind's own size utilities (`text-xs`, `text-sm`, `text-base`, `text-lg` and up), and on a `font-size` or `fontSize` in CSS or a `style`, outside the exceptions listed in the Technical approach. (test)
- [x] DS-1.2 The shadcn components in `components/ui/` use the scale too: a button, input, menu item, label and popover are `body`, a dialog's title is `title`, its description `meta`. (test)
- [x] DS-1.3 Seen in both modes at 1440 px: the sidebar, the main pane, History and Work read in four UI levels plus the chat's prose, with no two neighbouring texts a half step apart. (manual)

### DS-2 Colour tokens

New tokens, each with a light and a dark value, and one meaning per family.

- [x] DS-2.1 `index.css` defines `info-soft`, `info-border` and `info-text` (neutral, for staleness and notices), `highlight` (search hits), `warning` and `warning-text` (a level heading toward a limit), and `destructive-soft` (the error Alert's box, DS-4), in light and dark mode, as `oklch()` values the Tailwind theme maps to `--color-*`. (test)
- [x] DS-2.2 `info-text` on `info-soft`, on the background and on the sidebar; `warning-text` on the background and the sidebar; and the foreground on `highlight` over the background and the sidebar keep 4.5:1 or more, in light and dark mode. (test)
- [x] DS-2.3 Each colour family is used only for its meaning (UX, "Colour by meaning"). A guard test fails when a family's token is used in a file its row doesn't list, or in a listed file in a class the row doesn't name, and on a raw colour: a Tailwind palette class (`text-amber-600`), an arbitrary colour (`bg-[#f59e0b]`, `text-[oklch(…)]`) or a hex, `rgb(` or `oklch(` in a TS string or style. The one exception is `HarnessIcon.tsx`'s brand hex. (test)

### DS-3 Colour means Status

The design review's suggestion 3, as decided with Dario.

- [x] DS-3.1 Harness logos are drawn in the text colour around them (monochrome), in the sidebar's rows, the usage strip and History's filter and results. They keep the brand colour in two places: the main pane's header (a live, a starting and a past Session's) and the new Session modal (the launcher). (test)
- [x] DS-3.2 A usage bar on the strip keeps its fill `foreground/55` at every level, which stays 3:1 or more against the track in both modes. The level shows as a 3 px edge at the fill's end: `warning` at 80% to 94%, `destructive` at 95% or more, none below 80%, set off from the fill by a 1 px gap in the sidebar's colour (3:1 or more against the fill in both modes), since the edge's own lightness is within 2:1 of the fill's and only the gap makes it a separate mark. The fill is `overflow-hidden`, so the edge follows its rounded end. The warning triangle and critical octagon (USAGE-1.2) stay. The usage details popover keeps its solid bars. (test)
- [x] DS-3.3 Staleness uses the info tone, never amber: Work's "Possibly out of date" (WORK-7.5), Work's "old" chip (WORK-7.3), the sidebar's banners for a stale Fleet list and a lost server (SIDE-6.2), Work's "Session links are unavailable", and the terminal preview's "… · retrying", and the usage strip's "old · …" on a reading marked old. (test)
- [x] DS-3.4 History's and Library's search hits are marked with the `highlight` token, not Needs you's amber. (test)
- [x] DS-3.5 A sidebar row's context usage, its number and its ring, takes the status line's colours (VIEW-5.5): the row's quiet colour up to 40%, `warning-text` above 40%, `destructive-text` above 60%, from the same `contextLevel`. Its text keeps 4.5:1 on every row state (SIDE-3.11). (test)
- [x] DS-3.6 Status colours show only a Status, or something its Status spec ties to one (UX, "Colour by meaning"): Work's "milestone" chip and PR "ready" chip are neutral; chat and Markdown links are underlined in the surrounding text colour; Work's CI-running spinner and the chat rail's finished-Subagent Mark are `muted-foreground`; History's live marker and a live Linked Session's marker in Work show the Session's real Status (DS-5.2, DS-5.3), never a stand-in colour. (test)
- [x] DS-3.7 Seen in both modes at 1440 px with several Sessions and a limit at 95% or more: the brightest things on screen are the Status markers, strips and the Needs you tint, and nothing is amber that neither needs you nor warns of a limit. (manual)

### DS-4 One Alert

One component for "something went wrong" and "something to know", instead of four styles.

- [x] DS-4.1 `Alert` in `components/ui/alert.tsx` has a tone, `error` or `info`, and a layout, `box` or `inline`. `error` is `role="alert"` with the `CircleX` icon in `destructive`; `info` is `role="status"` with the `Info` icon in `info-text`, or the icon it's given (`WifiOff`, `TriangleAlert`). A box takes a title, a detail and children (a command, a button); inline is a `meta` line that wraps, except the status line's, which is one line cut short with the whole text in its tooltip. An error Alert can be `quiet`: the same look without the live role, for an error announced elsewhere where it is selected (a failed Starting row's). (test)
- [x] DS-4.2 Every error and notice in the migration list (Technical approach) is an `Alert`. A guard test fails when `role="alert"` is written outside `alert.tsx` and the listed functions (Technical approach), when an `Alert` goes quiet (`quiet`, `role="presentation"`) outside the listed ones, or when an element outside it draws a box in `destructive` or `info` colours (a `border-destructive…`, `bg-destructive/…`, `bg-destructive-soft`, `border-info-border` or `bg-info-soft` class). A failure is never an `EmptyState`: History's search error and the chat's missing or unreadable Transcript are error boxes at the top of their panel or pane. (test)
- [x] DS-4.3 The words don't change: each Alert says what it said before, and Work's problem keeps its title, reason, what to do and its command (WORK-7.1 to 7.3). (test)
- [x] DS-4.4 Seen in both modes: every box Alert has the same padding, radius, border, icon size and type step, wherever it sits; every inline one the same type step and icon. (manual)

### DS-5 One Session marker

The design review's suggestion 9. A shape means the same thing in every list.

- [x] DS-5.1 `SessionMarker` in `components/ui/session-marker.tsx` draws a Session's state: a live Session's Status marker (`StatusMarker`, SIDE-3.2), a past Session that can be resumed as lucide's `History` in `muted-foreground`, and one that can't as `CircleSlash`. The Session sidebar, History and Work draw their Session markers only through it. (test)
- [x] DS-5.2 A History result for a live Session shows that Session's Status marker, from the Session sidebar's list, and follows its Status live. Its "live" chip stays. A resumable result shows the past marker, a blocked one the slashed circle. (test)
- [x] DS-5.3 A Work row with Linked Sessions shows one marker: the Status marker of its live Linked Session that needs action most (Needs you, then Busy, Idle, Unknown; Unknown for a live Link the Session sidebar's list doesn't have yet or no longer has), or the past marker when none is live. Its tooltip still lists each Link's reason (WORK-2.4). (test)
- [x] DS-5.4 A guard test fails when lucide's `Circle` or `CircleDot` is imported outside `Answering.tsx`, where they draw a question's options, not a Session. (test)
- [x] DS-5.5 Rows' accessible names don't change: the marker stays hidden from screen readers in History and Work, where the row's words already say it. (test)

### DS-6 Loading that admits time passes

The design review's suggestion 4.

- [x] DS-6.1 `Loading` in `components/ui/loading.tsx` shows what it's doing ("Reading the Transcript…") at once. From 3 s it adds how long it has taken ("· 4s"), every second. From 15 s it shows a hint, when the place gives one. The label is in a polite `role="status"` region, announced once; the seconds are outside it (as VIEW-1's "Working…" row does). (test)
- [x] DS-6.2 The chat's skeleton stays, with a `Loading` under it: "Reading the Transcript…", and from 15 s "This is taking a while. The terminal preview still works.", with a Show terminal button, for a Controllable Session; a View only one has no preview, so no hint. (test)
- [x] DS-6.3 Every other "Loading…" is a `Loading`: History's results and "Loading more…", Work's section headers, the main pane, a starting and a past Session's view, the terminal preview, the usage strip and its details ("Reading usage…"), and the status-line menus. (test)
- [x] DS-6.4 With no live Session and no Starting row, the main pane says "No Sessions running" with a "Start a Session" button that opens the launcher, as `N` does, instead of "Select a Session" and keys to move through an empty list. Under the button the hint lists `N` and `H` `W` `L` (the panels; History is where past Sessions are resumed) from the one shortcuts list (SIDE-7.4), then an "All shortcuts" button that opens the Keyboard shortcuts dialog. With Sessions, the hint stays (VIEW-5.4). (test)

### DS-7 Icon buttons

Fixed sizes, so a target never shrinks under 24 px.

- [x] DS-7.1 `IconButton` in `components/ui/icon-button.tsx` has two sizes: `sm`, a 24 px box with a 14 px icon, for buttons inside a line or a row; `md`, a 28 px box with a 16 px icon, for a column's header and toolbars. Its accessible name is a required prop, and its tooltip says the same, with the key when there is one. One more size is for a button with a word beside its icon (the row buttons of Work, WORK-6.5, and History, HIST-3.6): a 28 px tall target with a 20 px icon. (test)
- [x] DS-7.2 A guard test fails on a `Button` with an `icon…` size outside `components/ui/`, on an `IconButton` whose `className` sets a size, height or width, and on a `<button>` or `<Button>` that holds only an icon (so sized by hand, as `<Button size="xs" className="size-6">`), except the listed ones (Technical approach). Work's and History's row buttons, which can't be focusable inside an option (WORK UX, "Markers and buttons"), are `RowAction`s with the labelled size (DS-7.1). (test)
- [x] DS-7.3 The status line's text is `meta` (12 px). Its model and Effort menus (VIEW-6, VIEW-7) are 24 px tall buttons with 4 px of padding on each side, and the line stays 28 px tall. (test)
- [x] DS-7.4 Seen live: icon buttons side by side are 4 px apart, and a Close button sits 8 px from its neighbour, so the right sidebar's Refresh and Close are hard to mix up. Every icon inside a button is 14 or 16 px, except the 20 px one in the labelled-button size (DS-7.1). The labelled buttons of an expanded row (`RowActions`) are 8 px apart, 12 px under the details above them and 4 px clear of the row's bottom padding. (manual)

### DS-8 Shared pieces that repeat

Patterns the review found three or more times, each drawn slightly differently.

- [x] DS-8.1 `EmptyState` (a title, a hint, an optional icon and an optional action) replaces the sidebar's and History's `Message`, the chat's `Notice` and the main pane's hint. (test)
- [x] DS-8.2 `CommandBlock` shows a command to copy: monospace `caption`, wrapped, selected whole on click. Fleet's and tb-session's "isn't installed" and Work's problems use it. (test)
- [x] DS-8.3 `Chip` is one pill in `caption`, with a tone: `neutral`, `info` or a Status, and for Work's PR states `muted` (draft) and `ok` (approved, WORK-3.2), and `warning` for memory growth (MEM-3.5), with a `warning/40` border and `warning-text`. It replaces the "old", "live", "headless", "milestone" and PR state chips and the chat's message tag. (test)
- [x] DS-8.4 `Kbd` is one key: the Filter box's `/`, the main pane's hints, the launcher's ⌘↵ and the composer hint's `i`. A sentence is never a key: the launcher's "Esc to close · your input is kept" keeps only "Esc" in a `Kbd`. (test)

### DS-9 The Session list takes keyboard focus

The design review's suggestion 7, as History already does it.

- [x] DS-9.1 The Session sidebar's listbox has `tabIndex=0` and an `aria-activedescendant` naming the selected Session's option, each option with a stable id. With a Starting row or nothing selected, it names none. (test)
- [x] DS-9.2 Tab reaches the listbox after the Filter bar's buttons and any Starting row's Dismiss. With focus on it, ↑/↓, j/k, ⌘1–9 and ⌘J work as before (SIDE-5), the list shows a focus ring for keyboard focus only, and the selected row keeps its own ring (SIDE-3.9). (test)
- [x] DS-9.3 With VoiceOver, focusing the list reads the selected Session's option name (SIDE-3.10), and moving the selection reads the new one. (manual)

### DS-10 Busy pulses only when it changed

The design review's suggestion 11.

- [x] DS-10.1 A Busy marker pulses for 10 s after its Session became Busy, then holds steady. It goes by the Status's age, not by when the page loaded, so a Session Busy for a minute when the page opens doesn't pulse. The chat's "Working…" dot does the same. With reduced motion, nothing pulses, as now. (test)

### DS-11 Terminal preview height

The design review's suggestion 10.

- [x] DS-11.1 The terminal preview (VIEW-2) opens at the height remembered for that Session, its height being the whole preview's, from the handle down, its Terminal row included. A Session with none remembered uses the default: 285 px (the 256 px text area it had before it was resizable, under the 28 px Terminal row, plus the top border) or 35% of the main pane's height, whichever is smaller. (test)
- [x] DS-11.2 Its top edge is a handle: drag it to resize, or focus it and press ↑/↓ to move it by 16 px. It's a `separator` with its height as its value. The height stays between the Terminal row plus four lines and 70% of the main pane, and never above what the content row leaves once the chat has its 96 px, so the value and a drag start from the height the preview really has, on a short window or with a tall dock. A drag that is cancelled goes back to where it began. (test)
- [x] DS-11.3 The height is kept in this browser, per Session, keyed by the Session's stable id, like the right sidebar's width (HIST-1.3); a Codex Session's height follows it when it gets its session id. Resizing one Session's preview doesn't change another's. A kept height taller than a smaller window allows is shown clamped, and kept as it was. On a short window the preview still gives way before the chat (SIDE-8.1). (test)
- [x] DS-11.4 Seen on a 700 px tall window: when a Session starts to Need you and the preview opens on its own (VIEW-2.2), the question card and the Needs you row stay in view. (manual)
- [x] DS-11.5 Kept heights for Sessions no longer in the Session list are removed, so storage doesn't grow. Reading or writing storage that fails or holds junk falls back to the default, without an error; where storage can't be written, the handle still resizes for as long as the page lives, the heights just aren't kept beyond it. Invalid values inside an otherwise valid stored map go with the next prune. (test)

### DS-12 Lookout's own colour

Once colour meant only Status (DS-3), Lookout read as flat and grey (Dario, 2026-10-26). Colour comes back where no one can take it for a Status: in the surfaces, and in one hue, Productive's indigo, for you and what you act on. Needs you grows with it, so it stays the loudest thing on screen.

- [x] DS-12.1 The neutral tokens take a cool tint, hue 270 at a chroma of 0.016 or less, in light and dark mode, with the values in UX, "DS-12 token values": `background`, `foreground`, `card`, `popover` and the foregrounds that go with them, `secondary`, `muted`, `muted-foreground`, `accent`, `border` and `input` (light), and the `sidebar…` tokens. The Status, Warning, Destructive, OK, Info and Highlight tokens keep their chroma as it is, and `idle…` stays without one, so Idle's grey never leans toward Busy's blue. Every contrast pair already tested (DS-2.2, DS-3.2, DS-3.5, SIDE-3.11, VIEW-5.9, WORK-3.5, SIDE-9.6) still passes. (test)
- [x] DS-12.2 The side columns are a plane of their own: the Session sidebar, the right sidebar and its rail are `sidebar`, the main pane is `background`, and the two differ by 0.03 lightness or more in each mode. In dark mode the sidebar is the darker one (0.155 under 0.19, where today it is the lighter), in light mode the greyer one (0.962 under 0.995). (test)
- [x] DS-12.3 `primary` is Productive's Indigo (`#5D2BFF`, hue 281) at a lower chroma, so it's on brand and still quieter than Needs you: `primary`, `primary-foreground`, a new `primary-soft`, and `ring` take the values in UX, "DS-12 token values". `primary-foreground` on `primary` and `foreground` on `primary-soft` (over the background) keep 4.5:1, and `ring` keeps 3:1 against the background and the sidebar, in both modes. (test)
- [x] DS-12.4 Primary marks you and what you act on, and nothing else: a `Button` of the default variant (the composer's Send, Start a Session, the launcher's Start, a question card's submit, Settings' Save); keyboard focus, a focused field's border and a resize handle while dragged (`ring`, as today); a question's chosen option (its border, and its dot or tick in `primary`); your own messages in the chat (`bg-primary-soft`); and the composer's attachment drop target (VIEW-9.2: dashed `border-primary`, `bg-primary-soft`, `text-primary`). Never a Status marker, strip, row tint or Status tag, a Chip, a link, a list row's selection (a selected row keeps its neutral ring, SIDE-3.9) or a chart. The colour guard (DS-2.3) gets a Primary family, its files pinned to these classes. (test)
- [x] DS-12.5 Needs you grows with the rest. A sidebar row's Needs you tint is 16% at rest, 22% under the pointer and 28% selected (was 12, 20 and 26), and light `needs-you-text` darkens to `oklch(0.48 0.13 55)`, so the "waiting for" line keeps 4.5:1 on the selected tint over the new sidebar (SIDE-3.11's test). The header's Status tag for Needs you is solid: a `needs-you` fill under a new `needs-you-foreground`, 4.5:1 or more in both modes; the Busy, Idle and Unknown tags stay as they are (VIEW-5.9). (test)
- [x] DS-12.6 With one or more Controllable Sessions Needing you, a "Needs you" header with their count sits above them in the Session sidebar, in `needs-you-text`, built and spaced as the "View only" header. It isn't a Session: ↑/↓, j/k, ⌘1–9, ⌘J and the filter skip it as they skip "View only", it hides when the filter leaves no Needs you row, and screen readers get it the way they get "View only". While the pointer is over the sidebar (SIDE-3.4) it neither comes nor goes, so the rows under the pointer don't move: one that wasn't there waits for the pointer to leave, and one that was keeps its room, empty and hidden from screen readers, once its last Session stops Needing you; its count stays live. A View only Session that Needs you stays under "View only". (test)
- [x] DS-12.7 Seen in both modes at 1440 px, with Sessions in every Status and the chat showing a question card: the Needs you rows, their header and the header's tag are still the most prominent things on screen (DS-3.7 still holds); a Primary button or your own message never reads as Busy's blue beside a Busy marker; and the sidebar and the chat read as two planes. (manual)

## Non-goals

- **Narrow widths** (the review's suggestion 2): columns that collapse below about 1024 px, a header that folds its buttons, a status line that drops whole parts. Dario uses Lookout full screen; it's in the Backlog.
- **An in-app toast and a Needs you count in the Filter bar** (suggestion 6). In the Backlog.
- **What a sidebar row shows** (suggestion 1): hiding a repeated `repo · branch`, a Busy row's activity. A separate SIDE-2.1 amendment, in the Plan.
- **Select, then act** in History and Work (suggestion 8). Its own spec, merged with Plan item 2.
- A Storybook, a separate package, or a published component library. The design system is the code in `web/src`, this spec and its tests.
- Retuning the Status hues or the contrast rules SIDE-3.11, VIEW-5.9 and WORK-3.5 already test. DS-12 tints the neutrals, darkens light `needs-you-text` by 0.02 and light `warning-text` by 0.009 for contrast; no Status changes hue.
- More hues: a colour per project or repo, Harness brand colours in lists (DS-3.1 stands), links in Primary. Each would compete with Status in a list or with the text around a link.
- Line heights, spacing and row heights beyond icon buttons. They're consistent enough today.
- The review's smaller findings not listed in DS's requirements: the View only row's grey marker, the composer's Needs you border, the flagged usage line's dimming, the composer hint, the chat's measure, the header's Status tag shape, the launcher's layout, Settings' three Save buttons, a `?` shortcut overlay. Each can come back as its own item.
- A theme switch or other themes. Dark mode follows the system, as now.
- New icons or shapes. DS reuses lucide and the Status shapes, within 0008.

## UX

### Type scale

| Step | Size / line height | Use | Replaces |
|---|---|---|---|
| `caption` | 11 / 16 px | chips, keys, a usage line's second line, tertiary counts | 10, 10.5, 11 px; `text-xs` in a chip |
| `meta` | 12 / 16 px | second lines, the status line, hints, inline errors | 11.5, 12, 12.5 px where secondary; `text-xs` |
| `body` | 13 / 20 px | row titles, controls, menus, dialogs, Settings, notices | 12.5 px where body text, 13 px; `text-sm`, `text-base` in controls |
| `prose` | 14 / 22 px | the chat's text, the composer, a question's text, Markdown's smaller headings | 13.5, 14, 14.5 px |
| `title` | 15 / 20 px | the main pane's title, a dialog's title, section headers (Work's, the Session sidebar's), Markdown's first heading | 15 px; `text-lg` |

- Classes are `text-caption`, `text-meta`, `text-body`, `text-prose` and `text-title`, from `--text-*` theme variables, each with its line height. None of the names is a colour token, so `text-…` stays unambiguous.
- Monospace (the status line, commands, the terminal preview) uses the same steps.
- Weights stay as they are: 400, 500 for emphasis, 600 for titles.

### Colour by meaning

| Family | Tokens | Means | Used in |
|---|---|---|---|
| Needs you | `needs-you`, `-soft`, `-text`, `-foreground` | the Status Needs you, nothing else | Status marker, strip, tint and tag; the sidebar's Needs you header and count; a question or permission card; the Needs you row and Mark in the chat; a row's "waiting for" line |
| Busy, Idle | `busy…`, `idle…` | a Status, nothing else: no link, spinner, chip or Mark | Status marker, strip and tag; the chat's "Working…" dot; VIEW-8's running Subagents (Busy); SIDE-2.6's and VIEW-5.16's background shell (Idle) |
| Warning | `warning`, `-text` | a level heading toward a limit | context above 40% (status line and sidebar), usage at 80% or more, a PR aged 3 to 10 days (WORK-3.5) |
| Destructive | `destructive`, `-soft`, `-text` | an error, a critical level, a destructive action | error Alerts, the critical octagon and the bar's edge, context above 60% (`-text`), a PR over 10 days, End Session, a failed start |
| OK | `ok`, `-text` | something passed | CI passing, an approved PR, a PR under 3 days |
| Info | `info-soft`, `-border`, `-text` | staleness, or something to know that needs nothing from you | info Alerts, the "old" chip, a usage reading marked old, "retrying" |
| Highlight | `highlight` | a search hit | History's snippets and Library's title, path and URL hits |
| Primary | `primary`, `-foreground`, `-soft`, `ring` | you, and what you act on (DS-12.4) | the default Button, keyboard focus and a focused field, a resize handle in use, a question's chosen option, your own messages |
| Neutral | `foreground`, `muted…`, `border`, `accent`, `sidebar…` | everything else, cool-tinted (DS-12.1) | |

- **Amber means "act on it"**: now (Needs you) or soon (a warning level). Never "this is old" or "this matched".
- **Info is grey, not blue**, since blue is Busy. The icon and the box tell it from plain text.
- **Primary is Productive's indigo, for you and what you act on**: buttons, focus, a chosen option, your messages. It sits on things you click or wrote, never on a shape that stands for a Session, so it can't be read as Busy's blue: a Status is a marker, a strip, a tint or a tag; Primary is a button, a ring or a bubble.
- **Harness logos**: monochrome, `currentColor`, everywhere but two places: the main pane's header and the new Session modal (the launcher), where the logo is the choice being made. History's filter and a sidebar row are monochrome; in a row the logo takes the row's quiet colour.
- **Usage bar**: the strip's fill is `foreground/55` at every level, 3:1 against its track in both modes, `overflow-hidden`. The level is a 3 px edge at the fill's end: `warning` at 80 to 94%, `destructive` at 95% or more, none under 80%, a 1 px sidebar-coloured gap between it and the fill; the triangle or octagon sits beside it. The details popover keeps solid fills.
- **Links** (chat and Markdown): underlined in the surrounding text colour, with the underline kept on hover and a focus ring for keyboard focus. Blue is Busy's, so no link takes it.
- **Raw colours**: none. Colour comes from a token; the one exception is `HarnessIcon.tsx`'s brand hex.

Proposed values, checked by DS-2.2's test (`destructive-text`: by DS-3.5's):

| Token | Light | Dark |
|---|---|---|
| `info-soft` | `oklch(0.965 0 0)` | `oklch(1 0 0 / 7%)` |
| `info-border` | `oklch(0.88 0 0)` | `oklch(1 0 0 / 14%)` |
| `info-text` | `oklch(0.42 0 0)` | `oklch(0.82 0 0)` |
| `highlight` | `oklch(0.145 0 0 / 10%)` | `oklch(1 0 0 / 16%)` |
| `warning`, `-text` | Needs you's values today | Needs you's values today |
| `destructive-soft` | `oklch(0.577 0.245 27.325 / 14%)` | `oklch(0.704 0.191 22.216 / 20%)` |
| `destructive-text` (changed, dark only) | `oklch(0.5 0.21 27.325)`, as before | `oklch(0.78 0.15 22.216)`, was `oklch(0.704 0.191 22.216)` |

#### DS-12 token values

Neutrals at hue 270, Primary at Productive Indigo's hue 281. Today's value in brackets. Tokens not listed keep their values.

| Token | Light | Dark |
|---|---|---|
| `background` | `oklch(0.995 0.002 270)` (`1 0 0`) | `oklch(0.19 0.013 270)` (`0.17 0 0`) |
| `foreground`, `card-foreground`, `popover-foreground`, `sidebar-foreground` | `oklch(0.17 0.012 270)` (`0.145 0 0`) | `oklch(0.96 0.004 270)` (`0.96 0 0`) |
| `card`, `popover` | `oklch(1 0 0)`, as before | `oklch(0.22 0.014 270)` (`0.205 0 0`) |
| `secondary`, `muted` | `oklch(0.955 0.008 270)` (`0.97 0 0`) | `oklch(0.26 0.016 270)`, `oklch(0.25 0.016 270)` (`0.269`, `0.25`) |
| `secondary-foreground`, `accent-foreground` | `oklch(0.21 0.012 270)` (`0.205 0 0`) | `oklch(0.96 0.004 270)` (`0.96 0 0`) |
| `muted-foreground` | `oklch(0.5 0.016 270)` (`0.52 0 0`) | `oklch(0.71 0.016 270)` (`0.68 0 0`) |
| `accent` | `oklch(0.945 0.01 270)` (`0.955 0 0`) | `oklch(0.26 0.016 270)` (`0.269 0 0`) |
| `border`, `input`, `sidebar-border` | `oklch(0.9 0.009 270)` (`0.922 0 0`) | as before (white at 10%, 15%, 8%) |
| `sidebar` | `oklch(0.962 0.008 270)` (`0.985 0 0`) | `oklch(0.155 0.012 270)` (`0.2 0 0`) |
| `sidebar-accent` | `oklch(0.925 0.01 270)` (`0.94 0 0`) | `oklch(0.235 0.016 270)` (`0.27 0 0`) |
| `primary` | `oklch(0.52 0.2 281)` (`0.205 0 0`) | `oklch(0.55 0.19 281)` (`0.922 0 0`) |
| `primary-foreground` | `oklch(0.99 0 0)` | `oklch(0.99 0 0)` (`0.205 0 0`) |
| `primary-soft` (new) | `oklch(0.95 0.035 281)` | `oklch(0.6 0.17 281 / 20%)` |
| `ring` | `oklch(0.52 0.2 281)` (`0.708 0 0`) | `oklch(0.74 0.14 281)` (`0.556 0 0`) |
| `needs-you-text` | `oklch(0.48 0.13 55)` (`0.5 0.13 55`) | as before |
| `warning-text` | `oklch(0.491 0.13 55)` (`0.5 0.13 55`) | as before |
| `needs-you-foreground` (new) | `oklch(0.2 0.045 55)` | `oklch(0.22 0.04 60)` |

Measured before building (sRGB, WCAG): `primary-foreground` on `primary` 5.8:1 light, 5.0:1 dark (dark `primary` at 0.58 measured 4.4:1, hence 0.55); `foreground` on `primary-soft` 16:1 light, 13:1 dark; `ring` against the background 5.9:1 light, 7.8:1 dark; `needs-you-foreground` on `needs-you` 6.5:1 light, 9.1:1 dark; light `needs-you-text` on the selected Needs you tint (28%) over the new sidebar 4.7:1 (4.3:1 at today's 0.5); `muted-foreground` on the sidebar 5.4:1 light, 7.6:1 dark. Measured in building with DS-3.5's test: light `warning-text` on that selected tint was 4.337:1 at 0.5, so it takes 0.491, the nearest lightness at 0.001 precision that passes (4.506:1; 0.492 gives 4.487:1), keeping its chroma and hue. The tests are what count.

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
- **Alert, inline**: a 12 px icon at the first line and `meta` text in `destructive-text` (error) or `info-text` (info), wrapping; the status line's is one line, cut short with an ellipsis (`oneLine`), the whole text in its tooltip. `quiet` leaves the look and drops the live role.
- **No amber Alert.** What used to be amber is now info (staleness) or a Needs you card, which is a Status, not an Alert.
- **SessionMarker** sits in a box the size its list gives (18 px in the sidebar, SIDE-3.8; 14 px in History and Work), so titles line up whichever shape shows.
- **Loading**: the label in `meta` `muted-foreground`; the elapsed time after a ` · ` in `tabular-nums`; the hint under it in `meta`, with an action when there is one.
- **IconButton**: ghost by default, `muted-foreground` at rest, `accent` under the pointer; its focus ring is the Button's.
- **EmptyState**: centred, the title in `body` medium, the hint in `meta` `muted-foreground`, an optional 20 px icon above, an optional action below.
- **Chip**: `rounded-full px-1.5`, `caption` medium, `leading-4`, a 1 px border (transparent unless the tone has one) so every chip is one height. Neutral: `bg-muted`, foreground. Muted: a `border` border, `muted-foreground` (a draft PR). Info: `info-soft`, `info-text`. Ok: an `ok/40` border, `ok` (an approved PR). A Status tone: its header tag's colours (VIEW-5.9's `STATUS_TAG_CLASS`), solid for Needs you, `-soft` and `-text` for the others.
- **Kbd**: `caption` mono, `rounded border border-border px-1`, at least 20 px wide, 16 px tall (a 14 px line and the border), so it sits in a `caption` or `meta` line without growing it.
- **CommandBlock**: `rounded-md border border-border bg-background p-2`, `caption` mono, wrapped anywhere, `select-all`.

### Places

- **Sidebar row**: the Harness logo in the row's quiet colour; the context ring and % in the warning or danger colour above 40% and 60%.
- **Status line**: 12 px mono; the model and Effort menus 24 px tall; the line 28 px.
- **Terminal preview**: a 6 px handle on its top border while it's open, `row-resize` under the pointer, a 2 px line in `border` that turns `ring` while dragged or focused (keyboard focus). Each Session keeps its own height; one with none opens at the default.
- **Main pane with no Sessions**: "No Sessions running", "Start a Session" as a primary button (`N`), and under it the `N` key hint.
- **Focus**: the Session list shows a ring around the list for keyboard focus (`focus-visible`); a click on a row focuses the list without one.

## Technical approach

DS changes only `web/src`. Nothing on the server changes, so every check is a unit or component test, or an eye on the running app.

### The guard

`web/src/test/design-system.test.ts`, next to the icons guard (`icons.test.ts`, [0008](../../decisions/0008-lucide-icons-only.md)), reads the same sources the same way: `web/src` and `shared`, tests left out, with TypeScript's parser, so classes inside `cn()`, `cva()` and templates are found and comments are not. Each check has a test that it catches what it should and lets through what it should, as `icons.test.ts` has, and a test on the real tree.

1. **Font sizes only from the scale (DS-1.1, 1.2).** In any string: `text-[<n>px|rem|em]`, `text-(xs|sm|base|lg|xl|[2-9]xl)`, `text-[length:…]`. In CSS or a `style`: `font-size` and `fontSize`. Exceptions: the `?` glyph inside `StatusMarker`'s Unknown shape (an SVG `fontSize`), and the `--text-*` definitions in `index.css`.
2. **No hand-rolled alert boxes (DS-4.2).** `alert` written as a string (`role="alert"`, `role={x ? 'status' : 'alert'}`, `const role = 'alert'`) only in `components/ui/alert.tsx` (its role, and its `data-slot`, three strings), and in two functions, each pinned to its file and to one use: `Answering.tsx`'s `TerminalNote`, which tells you to answer in the terminal: part of a Needs you card, so amber, not an Alert; and `SessionView.tsx`'s `HeaderNote`, why Stop failed (VIEW-4.4) or a failed or pending rename (VIEW-5.14) beside the title, one line in the header with its whole text in a bubble on hover or focus and a twin for a narrow header, which an inline Alert's tooltip doesn't give. A second `alert` in a listed file is a reviewed change, not a pass. Another test finds any `role`, `quiet` or spread on an `<Alert>` outside two pinned places: `WorkPanel.tsx`'s `PrGroupView` (`role="presentation"`, below) and `LaunchItem.tsx`'s `LaunchItem` (`quiet`: a failed start's error is announced by `StartingView` while the row is selected, so the row doesn't announce it again). The classes `border-destructive…`, `bg-destructive/<n>`, `bg-destructive-soft`, `border-info-border` and `bg-info-soft` only in `alert.tsx` and `chip.tsx`, and in an allowlist with a reason each, pinned to the classes each uses: the destructive Button variant, an invalid field (`button`, `input`, `textarea`), a failed Starting row's tint (`LaunchItem`), a failed start's status pill (`StartingView`). An info Alert inside a listbox (Work's "Possibly out of date") takes `role="presentation"`, as no live region can sit there; the group's `aria-describedby` reads it.
3. **Colour tokens only in their meaning (DS-2.3, 3.6, 12.4).** For each family in UX, "Colour by meaning", the files that may use it: a `bg-`, `text-`, `border-`, `ring-`, `fill-`, `stroke-`, `outline-`, `from-`, `to-` or `decoration-` class, or a `var(--…)`, of a family's token outside its files fails. The lists live in the test with a reason per file, and each listed file pins the exact classes it may use per family, so a new use in a listed file is a reviewed change too. `needs-you`'s list, for example, is `StatusMarker`, `lib/sessions.ts` (strip, tint, tag), `Sidebar` (the Needs you header), `ChatActivity`, `ChatRail`, `Chat` and `Answering` (question and permission cards, and `TerminalNote`) and `SessionItem` (its "waiting for" line). Primary pins the default Button's fill and foreground, `Answering`'s chosen option border and icon, `Chat`'s own-message fill, and the existing `ring` uses for focus and resize handles.
4. **No raw colours (DS-2.3).** A Tailwind palette class (`text-amber-600`, `bg-red-500/10`), an arbitrary colour (`text-[#f59e0b]`, `bg-[oklch(…)]`, `bg-[color:…]`) or a hex, `rgb(`, `hsl(` or `oklch(` in a TS string or style fails, except `HarnessIcon.tsx`'s brand hex. The family checks above also read Tailwind v4's other spellings: the `!` suffix, `text-(--color-busy)` and `bg-(color:--busy)`, a fractional or `(--x)` opacity, `var(--busy, red)`, `text-shadow-`, `drop-shadow-` and `inset-shadow-` colours, `theme(--color-busy)`, `@apply …;` and sizes written as `calc()`, `clamp()`, `min()` or `max()`, and a DOM `style.fontSize` or `setProperty('font-size')`.
5. **Harness colour only in headers (DS-3.1).** `HarnessIcon` takes `tone: 'brand' | 'mono'`, `mono` by default. `tone="brand"` only in `SessionView`, `StartingView` and `PastSessionView` (the main pane's header) and `Launcher` (the new Session modal).
6. **The marker everywhere (DS-5.1, 5.4).** `Circle` and `CircleDot` (and their `…Icon` and `Lucide…` names, or a namespace import of lucide) imported only in `Answering.tsx`; `StatusMarker` imported only in `session-marker.tsx` and `SessionView.tsx` (the Status marker beside the header's title, one Session's, not a list's; the Status tag, VIEW-5.9, is a separate span). Component tests render a sidebar row, a History result in each state and a Work row with live and past Links, and check that each marker is a `SessionMarker` (`data-session-marker` with `data-state` and, when live, `data-status`).
7. **Icon buttons (DS-7.2).** `size="icon…"` on a `Button` only inside `components/ui/`; no `size-`, `h-`, `w-`, `min-…` or `max-…` class, with any variant, on an `IconButton`; and a `<button>` or `<Button>` whose children are only icons (lucide's, `HarnessIcon`, `MarkShape`, also in a conditional, besides `aria-hidden` elements) only in three pinned places: Copy session ID and a code block's copy button, which show "Copied" beside the icon for 2 s, and a Mark on the chat's rail, a 12 px target by design on a 16 px rail (VIEW-1.11).
8. **One key, one command (DS-8.2, 8.4).** A `<kbd>` only in `kbd.tsx`, and `select-all` only in `command-block.tsx`.

The icons guard keeps its rules: `SessionMarker` draws with lucide and `StatusMarker`, and `MemoryLine.tsx` draws MEM’s sparkline, a chart like `SessionItem.tsx`’s context gauge; both chart files are named in the icons guard. It reads a key glyph inside `<Kbd>` as it reads one inside `<kbd>` (the launcher's ⌘↵).

### Tokens

- **Type:** `@theme` in `index.css` gains `--text-caption: 11px` with `--text-caption--line-height: 16px`, and so on for each step (UX table). Tailwind v4 makes each a `text-<step>` class. Tailwind's own sizes are cleared (`--text-*: initial`), so `text-sm` generates nothing. The page's `body` takes `text-body`, so text without a class of its own is on the scale too, and `cn()` (`lib/utils.ts`) tells tailwind-merge the steps are font sizes, or it would take `text-meta` for a colour and drop it beside `text-muted-foreground`.
- **Colour:** the new tokens in `:root` and the dark media query, mapped to `--color-*` in `@theme inline`, so `test/contrast.ts`'s `themeTokens` reads them. DS-2.2 is a contrast test over those, as SIDE-3.11's and VIEW-5.9's are.
- **Context danger:** `CONTEXT_LEVEL_CLASS.danger` moves from `destructive` to `destructive-text`, in the status line and the sidebar alike: `destructive` is under 4.5:1 on a Needs you row's tint (3.55:1 selected, light) and on a plain row under the pointer or selected (light). Dark `destructive-text` is raised to `oklch(0.78 0.15 22.216)`, the nearest that keeps 4.5:1 on a selected Needs you row (4.64:1); everything that already used it only gains contrast.
- **DS-12:** the values in UX, "DS-12 token values", in `:root` and the dark block; `--color-primary-soft` and `--color-needs-you-foreground` mapped in `@theme inline` (and added to the guard's known `--color-*` set). DS-12.1 to 12.3 and 12.5 are contrast tests over `themeTokens`, beside DS-2.2's; DS-12.2 also checks the lightness gap. Primary joins the colour guard as a family (rule 3), so `bg-primary`, `bg-primary-soft`, `border-primary` and `text-primary-foreground` are allowed only where DS-12.4 lists them, each file pinned to its classes. `ring` stays where it is today; DS-12.4 doesn't move it.
- **Warning:** `CONTEXT_LEVEL_CLASS.warning` (`lib/sessions.ts`), the usage `warning` level (`lib/usage.ts`) and `AGE_LEVEL_CLASS.aging` (`lib/work.ts`) move from `needs-you-text` to `warning-text`. The usage bar's warning level is a 3 px `bg-warning` edge at the fill's end (the fill stays `foreground/55`), as the critical level is with `destructive`.

### Components

- New files in `web/src/components/ui/`: `alert.tsx`, `session-marker.tsx`, `loading.tsx`, `icon-button.tsx`, `empty-state.tsx`, `command-block.tsx`, `chip.tsx`, `kbd.tsx`. Each is small, takes its tone and size as props, and exports its `cva` variants, as `button.tsx` does.
- `StatusMarker.tsx` stays where it is: 0008 and its guard name that file. `SessionMarker` composes it.
- **SessionMarker's Status** for History and Work comes from the Session sidebar's list already in the browser (the store's `SessionRow`s by session ID), not from a new server field. History's `isLive` already looks there.
- **Pulse (DS-10):** `StatusMarker` takes the Status's `since`, and `SessionMarker` passes it through (the sidebar row and the header give the row's `statusSince`; History the live Session's; Work's marker for several Linked Sessions the latest Busy one's). `lib/pulse.ts`'s `usePulse(since, now)`: while `now - since` is under 10 s it adds `animate-busy`, with the animation's delay set negative by the age (from the real time at that moment, not the clock's last tick, so a Session's two markers pulse in step) when the pulse first shows and kept for that `since`, so a re-render or a tick doesn't restart or shift it. The marker reads the app's one-second clock (`ClockContext`), so the class goes at the first tick after 10 s. No `since`, no pulse. `ChatActivity`'s dot does the same with the Turn's start, on its own clock. `index.css` animates `animate-busy` only under `prefers-reduced-motion: no-preference`, as before.
- **Loading (DS-6):** takes `label`, `since` and an optional `hint` (with an action). It ticks on the app's one-second clock (`now`) rather than its own timer.
- **Terminal preview (DS-11):** `lib/terminal-height.ts` holds a pure `drawerHeight(paneHeight, kept)` and the keep and read, as `lib/right-sidebar.ts` does for the width. One `localStorage` entry (key `lookout.terminal`) holds a map from the Session's id (`SessionRow.id`) to its height. Read and write are inside `try`; anything odd is the default, and an entry that isn't a positive number is left out. A Session with no entry uses the default. The height is the whole preview's (its top border, the 28 px Terminal row, the text's padding and lines), so its minimum, the Terminal row plus four 17.4 px lines, is 115 px; the maximum is 70% of the main pane (the Session view, measured with a `ResizeObserver`, the window's height until then) and no more than the content row's height less the chat's 96 px (the content row measured the same way), so the handle's value and a drag start from what the layout shows, and a kept height is shown clamped to both but kept as it was. When the Session list is known (`listKnown`) and loads or changes, App prunes the entries for ids not in it (in a layout effect, before paint), so the map doesn't grow; a Codex Session that got its session id (the store's `aliases`) keeps its entry under the new id. The drawer reads the entry through `useSyncExternalStore`, so a keep or a prune shows at once. It swaps `h-64` for that height as a style on the preview, which keeps `min-h-0` and shrinks before the chat's `min-h-24` (SIDE-8.1); the handle, shown while the preview is open, is a `role="separator"` with `aria-orientation="horizontal"`, `aria-valuenow`, `aria-valuemin` and `aria-valuemax`. ↑/↓ on it are handled there (`preventDefault`), so the Session sidebar's window handler doesn't also move the selection; a drag keeps the height when the pointer is let go, and drops it if the drag is cancelled. When `localStorage` throws, `terminal-height.ts` keeps the last map in memory and reads it back, so the handle works for the page's life; a write that goes through clears it.
- **Session listbox (DS-9):** `SessionItem` gets `id="session-<id>"` (`sessionOptionId`); the listbox in `Sidebar.tsx` gets `tabIndex={0}`, `aria-activedescendant` (none while a Starting row or nothing is selected, or the filter hides the selected Session) and `focus-visible` ring classes, inset, with `outline-none`. A click on a row focuses the list, its nearest focusable ancestor, without the ring. The app's key handler already moves the selection when focus isn't in a text field, so nothing else changes.

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
- Usage bar: `UsageStrip.tsx:269-282` (`Bar`, its fill at `:276`), now a `foreground/55` fill at every level with a 3 px edge at 80 to 94% and 95% or more.
- Staleness to info: `WorkPanel.tsx:329` ("old"), `:659` ("Possibly out of date"), `:281` ("Session links are unavailable", `border-needs-you/30` today), `Sidebar.tsx:317-328` (`Banner`), `SessionView.tsx:809` ("retrying"), `UsageStrip.tsx:134,164` (a reading marked old, "old · …").
- Search hits: `HistoryPanel.tsx:369`.
- Sidebar context: `SessionItem.tsx:114-119` and `ContextRing` (`:136-146`).
- Warning levels: `lib/sessions.ts:69`, `lib/usage.ts:76`, `lib/work.ts:86-89`, `UsageStrip.tsx:276`.
- Status colours elsewhere: `WorkPanel.tsx:542` (milestone chip, Busy's blue), `:688` (PR "ready" chip, Busy's blue), `:569` (live Linked Session, `ok` green), `:826` (CI running, Busy's spinner: now `muted-foreground`), `lib/links.tsx` `LINK_CLASS` and `Markdown.tsx:259` (links, Busy's blue: now underlined in the text colour), `ChatRail.tsx:153` (a finished Subagent's Mark: now `muted-foreground`), `HistoryPanel.tsx:319` (the live marker: now `muted-foreground` until DS-5.2).

**Alert (DS-4).** Boxes: `WorkPanel.tsx:243` (couldn't open a Session), `:281` (Session links), `:353-370` (`Problem`), `Launcher.tsx:204,209`, `HistoryPanel.tsx:277`, `RightSidebar.tsx:181` (refresh problem), `SessionView.tsx:609` (End Session dialog), `StartingView.tsx:29` (no longer listed), `:87` (failed start), `MainPane.tsx:61,74`, `PastSessionView.tsx:60`, `Chat.tsx:328`, `Sidebar.tsx:317-328` (`Banner`), `:339-354` and `HistoryPanel.tsx:404-419` (`NotInstalled`). Inline: `SessionView.tsx:930` (composer), `SettingsPage.tsx:88,176,260`, `Answering.tsx:167`, `Chat.tsx:296` (Show earlier), `StatusMenu.tsx:110` (the only one cut short to one line), `LaunchItem.tsx:77` (`quiet`). Boxes, as errors, not empty states: `HistoryPanel.tsx`'s "Couldn't search History" and `Chat.tsx`'s "No Transcript found" and "Couldn't read the Transcript", at the top of their panel or pane.

**SessionMarker (DS-5).** `SessionItem.tsx:61`, `HistoryPanel.tsx:319-321`, `WorkPanel.tsx:559-572` (`SessionMarker`, renamed or removed).

**Loading (DS-6).** `Chat.tsx:278,669-677` (skeleton), `:293` (Show earlier), `HistoryPanel.tsx:192,195,223`, `WorkPanel.tsx:327`, `MainPane.tsx:53`, `StartingView.tsx:38`, `PastSessionView.tsx:52`, `SessionView.tsx:818`, `UsageStrip.tsx:60,67`, `StatusMenu.tsx:76`. Empty main pane: `MainPane.tsx:101-134` (`Empty`, `Hint`) and its caller.

**Icon buttons (DS-7).** `Sidebar.tsx:257-276` (New Session, Settings, each `size-7` over `icon-sm`), `RightSidebar.tsx:149-167,198-200` (Refresh, Close, the rail's tabs), `SettingsPage.tsx:229-238`, `SessionView.tsx:425-433` (Copy session ID), `WorkPanel.tsx:792-803` (`RowButton`), `StatusMenu.tsx:58-73` (menu trigger), `SessionView.tsx:779-789` (`StatusBar`). Copy session ID stays an outline `Button`, 28 px tall like its neighbours: it shows "Copied" beside its icon for 2 s (VIEW-5.10), which an icon button's fixed square can't hold. A failed start's Dismiss (`LaunchItem`) and Settings' Remove are `sm` icon buttons too, and so are History's two Harness toggles and the chat rail's "Load earlier messages" (`ChatRail.tsx`), which was a 16 px target: now 24 px, centred on the 16 px rail and overlapping the chat's gutter.

**Shared pieces (DS-8).** `EmptyState`: `Sidebar.tsx:330-337`, `HistoryPanel.tsx:382-390`, `Chat.tsx:659-667`, `MainPane.tsx:101-116`. `CommandBlock`: `Sidebar.tsx:346`, `HistoryPanel.tsx:411`, `WorkPanel.tsx:363`. `Chip`: `WorkPanel.tsx:329,532,542,745`, `HistoryPanel.tsx:326,361`, `Chat.tsx:526`. `Kbd`: `Sidebar.tsx:252`, `MainPane.tsx:118-134`, `Launcher.tsx:215,221`, `SessionView.tsx:900`.

**Session list (DS-9).** `Sidebar.tsx:199`, `SessionItem.tsx:34-37`.

**Pulse (DS-10).** `StatusMarker.tsx:27`, `ChatActivity.tsx:43`, `index.css:156-170`.

**Terminal preview (DS-11).** `SessionView.tsx:792-823` (`Drawer`, `h-64` at `:816`), which reads and keeps the height by the Session's id; the pruning runs where the Session list is read.

**Lookout's own colour (DS-12).** Lines from `main` on 2026-10-26.

- Tokens: `index.css:7-45` (light), `:48-85` (dark), `:87-132` (`@theme inline`).
- Planes: `RightSidebar.tsx:111,204` already use `bg-sidebar`; the Session sidebar's column and the main pane keep theirs. Check that nothing in the main pane paints `sidebar`, and nothing in the side columns paints `background` except fields (the filter boxes' `bg-background/60`).
- Primary: `ui/button.tsx:11` (the default variant) reaches Send (`SessionView.tsx:1117`), Start a Session (`MainPane.tsx:137`), the launcher's Start (`Launcher.tsx:271`), Settings' Save (`SettingsPage.tsx:82,161`) and the question card's submit (`Answering.tsx:174`) with no change at those places. A question's chosen option: `Answering.tsx:133` (`border-foreground/40 bg-accent` today) and its dot or tick (`Answering.tsx:11-16`). Your own message: `Chat.tsx:511` (`bg-muted` today). `ring` uses stay: focus (`input`, `textarea`, `button`, `dialog`, `checkbox`, `Sidebar.tsx:223,275`, `LibraryPanel.tsx:227,261`, `Launcher.tsx:190,206`, `SessionView.tsx:515,1108,1224`, `StatusMenu.tsx:70`, `SessionTitle.tsx:222,242`, `Markdown.tsx:124`, `MemoryLine.tsx:107`, `RightSidebar.tsx:143`, `lib/links.tsx:9`) and resize handles (`RightSidebar.tsx:123`, `SessionView.tsx:946`).
- Needs you: `ROW_TONE.needsYou` (`lib/sessions.ts:32-37`), `STATUS_TAG_CLASS['needs-you']` (`lib/sessions.ts:51`), the "View only" header (`Sidebar.tsx:230-244`) as the pattern for the new header.

### Other specs to amend

Each lands with the code it covers, with a Changelog line in that spec:

- **SIDE**: UX "Markers" (the pulse, DS-10), the row's Harness mark (mono) and context colours (DS-3.5), the banner's tone (SIDE-6.2's wording stays), the listbox's focus (DS-9).
- **VIEW**: links in the text colour (DS-3.6, VIEW-1.12), the finished Subagent's Mark (VIEW-1.11), UX "Loading" (DS-6.2), VIEW-5.4's empty state (DS-6.4), the status line's size and menus (DS-7.3), the preview's height (DS-11).
- **HIST**: UX "Markers" (DS-5.2, and the live marker's colour until then, DS-3.6) and the search hit's colour (DS-3.4).
- **SIDE**: SIDE-6.1's "Fleet isn't installed" (an error box with a command block), New Session and Settings as `IconButton`s (4 px apart), the empty states (DS-8.1).
- **LAUNCH**: a failed Starting row's error is a wrapping, `quiet` error line (LAUNCH-4.5), and Dismiss a 24 px `IconButton`.
- **USAGE**: "Reading usage…" is a `Loading` (DS-6.3): `meta`, not `caption`, and it counts seconds.
- **WORK**: UX "Markers and buttons" (DS-5.3), the milestone and "ready" chips (DS-3.6), "Possibly out of date" and "old" (DS-3.3), the CI-running spinner (DS-3.6).
- **USAGE**: the bar's edge at 80% to 94% and at 95% or more (DS-3.2), the Harness marks (DS-3.1), and "old · …" moving from amber to info (DS-3.3).
- **SIDE** (DS-12): the Needs you row tints (SIDE-3.7, 3.9) and the "Needs you" header (SIDE-1.5, 3.1, and SIDE-5's keys skipping it), with SIDE-3.11's values.
- **VIEW** (DS-12): the Needs you Status tag is solid (VIEW-5.9); your own message's colour and a chosen option's (VIEW-1, UX).

### Key decisions

- **Extend, don't add a library**: the components stay in `web/src/components/ui/` beside shadcn's, and this spec is the reference. No Storybook: one user, one app, and the guard plus component tests do what a gallery would.
- **Guard tests, not lint rules**: the same TypeScript-parser approach as 0008's guard, so one pattern covers icons, type, colour and components, with its exceptions in one place.
- **Steps named by role** (`caption`, `meta`, `body`, `prose`, `title`), not by size: a step's size can change without renaming its uses, and none collides with a colour token in `text-…`.
- **Warning has its own token names**: the guard can keep Needs you to the Status and levels to levels, even while both are amber.
- **Two Alert tones, no amber one**: after DS-3.3 nothing left is an amber box but Needs you cards, which are a Status.
- **Info is grey**: blue is Busy, and every other hue is taken.
- **Productive indigo for Primary, at chroma 0.2** (Dario, 2026-10-26, from a canvas of current, violet and indigo): on brand, and further from Busy's blue in what it marks than in hue. The brand's own chroma (0.28) would be the most saturated colour on screen and pull the eye from Needs you.
- **The tint is cool and faint, and leaves Status alone**: hue 270 at chroma 0.016 or less gives the greys depth without reading as a colour; `idle` and Info stay achromatic so grey still means "nothing to do".
- **A plane, not a card**: the side columns step back (darker in dark mode, greyer in light), the chat is the surface you read on. No shadows or gradients.
- **`StatusMarker` stays put; `SessionMarker` wraps it**: 0008 and its guard name the file, and moving it would need a decision for no gain.
- **A Linked Session's Status comes from the browser's Session list**: Work and History already have it, and a server field would duplicate Fleet's.
- **The pulse goes by the Status's age**: a reload, a second tab or a re-render doesn't restart it.
- **Terminal height is per Session**: Dario's choice, since Sessions differ in how much terminal they need. It's kept in this browser by the Session's stable id, like the right sidebar's width, with no server field. A Session with none uses the default, and entries for Sessions gone from the list are pruned.
- **Harness logos: monochrome except in the header and the launcher**: colour marks which Harness you're looking at or choosing. In lists and filters the Status carries the colour.
- **A usage bar's level is an edge, not a fill**: a tinted fill measured 1.2:1 against the track (lighter than it, in light mode), so on the strip the fill stays `foreground/55` and a 3 px edge in `warning` or `destructive`, with the triangle or octagon, carries the level. One look per level; `warning-soft` was dropped, and `destructive-soft` stays for the error Alert.
- **A past Session is lucide's `History`, in `muted-foreground`**: it can't be mistaken for Idle's ring, and `CircleSlash` stays for one that can't be resumed.
- **Milestone and "ready" chips are neutral**: Busy's blue means Busy. "Approved" keeps `ok` green, which isn't a Status.
- **Busy's blue is a Status's, with no exception** (Dario, 2026-10-22): links are underlined in the text colour, Work's CI-running spinner and the chat rail's finished-Subagent Mark are `muted-foreground`, and History's live marker is `muted-foreground` until DS-5.2 gives it the Session's real Status. The guard lists no Busy file for any of them.
- **The usage strip's "old · …" is info**: it's staleness, like Work's "old" chip.
- **The chat's text is `prose`, 14 px**: a fifth step, so what you read most isn't a row title's size or the page title's.
- **Warning levels are amber, through their own tokens**: "act on it, now or soon", kept apart from Needs you by the guard.

## Open questions

None.

## Changelog

- 2026-10-27: DS-12.4 includes VIEW-9.2's composer drop target in Primary; its allowed classes are pinned in the colour guard.

- 2026-10-22: Created, from the design review of 2026-10-22 and Dario's answers to its 12 suggestions: 3, 4, 5, 7, 9, 10, 11 and 12 here; 1 and 8 in the Plan; 2 and 6 in the Backlog.
- 2026-10-22: Dario answered the 8 open questions. 1, 2, 3, 5, 6 and 7 as recommended: separate amber `warning` tokens, the 14 px `prose` step, the usage strip's "old · …" as info, the 80 to 94% bar with `warning-soft` and a 2 px edge, `History` for a past Session, neutral milestone and "ready" chips. 4 differently: Harness logos are monochrome in History's filter and the sidebar, but keep brand colour in the new Session modal and the Session header (DS-3.1). 8 differently: the terminal preview's height is per Session, kept in this browser by the Session's stable id and pruned for gone Sessions (DS-11).
- 2026-10-22: Dario's 8 answers above were the grill: the spec went from Draft to Ready (nothing left in Open questions), then to In Progress when slice 1 started.
- 2026-10-22: In Progress: DS-1 to DS-3 built (tokens, the type scale everywhere in `web/src`, colour by meaning and their guard). Changed in building: a sidebar row's and the status line's context above 60% is `destructive-text`, not `destructive`, which fell to 3.55:1 on a selected Needs you row; dark `destructive-text` rises to `oklch(0.78 0.15 22.216)` so it keeps 4.5:1 there (DS-3.5). DS-3.6 stays open: only its two chips are neutral so far (see the next line for what else it covers).
- 2026-10-22: Review fixes, round 1. DS-3.2 amended: a tinted fill measured 1.2:1 against the track (the warning fill lighter than it, in light mode), so on the strip the fill stays `foreground/55` at every level and the level is a 3 px edge, `warning` at 80 to 94% and `destructive` at 95% or more, on an `overflow-hidden` fill; the details popover keeps solid bars. `warning-soft` is removed from DS-2.1 and `index.css`; `destructive-soft` stays for the error Alert (DS-4). USAGE amended.
- 2026-10-22: DS-3.6 widened, deciding with Dario what Busy's blue may mark. The slice-1 line first said the colour part was done; besides the two chips, Busy's blue was still on every chat and Markdown link, Work's CI-running spinner, the chat rail's finished-Subagent Mark and History's live marker. Now: links are underlined in the text colour, the spinner and the Mark are `muted-foreground`, and History's live marker is `muted-foreground` until DS-5.2. DS-3.6 stays open until DS-5.2 and DS-5.3. VIEW, WORK and HIST amended; the guard's Busy list has no exception left.
- 2026-10-22: DS-2.3's guard grew: raw colours (palette classes, arbitrary colours, hex, `rgb(`, `oklch(` in TS) fail except `HarnessIcon.tsx`'s brand hex; Tailwind v4's other spellings are read; each listed file's classes are pinned per family. The status line's menu error is `destructive-text`, as the context level beside it. PLAN item 12 and 0009 (now Accepted) brought up to date.
- 2026-10-22: Review fixes, round 2. DS-3.2: the usage bar's edge is set off from the fill by a 1 px gap in the sidebar's colour, since the edge measured 1.0 to 1.9:1 against the fill and read as a hue cue only at 95% or more; the test measures the gap against the fill. DS-2.3's guard exempts CSS-wide keywords, `none`, `transparent`, `currentColor` and `url(`, counts a hex only in a class, a CSS value or a style property, checks a template for a trailing `#` only in style, `fill` and `stroke` values, catches CSS named colours, and pins `index.css`'s `--color-*` mappings to the known set. USAGE amended.
- 2026-10-22: DS-4 to DS-8 built: `Alert`, `SessionMarker`, `Loading`, `IconButton`, `EmptyState`, `CommandBlock`, `Chip` and `Kbd` in `components/ui/`, every place in the Migration list on them, and their guards and tests; DS-3.6 closes with DS-5.2 and DS-5.3. Changed in building: the role guard reads `alert` written as any string, and lists a second exception, Stop's `HeaderNote` (VIEW-4.4), whose one-line note and hover bubble an inline Alert can't give; the box allowlist names `input` and `textarea`'s invalid field, as the Button's; an info Alert inside a listbox (Work's "Possibly out of date") is `role="presentation"`; `Chip` gains `muted` and `ok` tones for a draft and an approved PR, which WORK-3.2 keeps; DS-5.3's live Link the Session list doesn't have yet is Unknown; DS-6.2's hint shows only for a Controllable Session, as a View only one has no preview; Copy session ID stays a Button (Migration, DS-7); and the guard also keeps `StatusMarker` to the Session marker and the header, `<kbd>` to `Kbd` and `select-all` to `CommandBlock`. The icons guard (0008) reads a key glyph inside `<Kbd>` as inside `<kbd>`. VIEW, HIST and WORK amended. DS-4.4 and DS-7.4 are (manual), for Dario to see.
- 2026-10-22: Review fixes, round 1 (DS-4 to DS-8). DS-4.1: inline Alerts wrap everywhere (composer, QuestionForm, Settings, Show earlier, a failed start's row), as before slice 2, where a keyboard user couldn't reach a hover tooltip; only the status line's is still one line, cut short (`oneLine`). `Alert` gains `quiet` (the look, no live role) for a failed Starting row, so a start that failed while selected isn't announced twice. DS-4.2: History's search error and the chat's "No Transcript found" and "Couldn't read the Transcript" are error boxes at the top of their panel or pane, words unchanged, not EmptyStates. The role guard now pins each exception to its function and count (`HeaderNote` also carries a failed or pending rename), and a new guard pins where an Alert may take `role` or `quiet`. DS-7.2's guard extends to buttons that hold only an icon: the chat rail's "Load earlier messages" (16 px) and History's Harness toggles are `IconButton`s; Copy session ID, a code block's copy button and the rail's Marks are listed with reasons. DS-5.3's Unknown covers a live Link the Session list doesn't have yet or no longer has. Before the first snapshot the empty main pane shows a Loading, not a hint that gives way to "No Sessions running". SIDE, LAUNCH and USAGE amended ("Other specs to amend").
- 2026-10-22: DS-9 to DS-11 built: the Session list takes keyboard focus (DS-9), a Busy marker and the "Working…" dot pulse only for 10 s after the change (DS-10), and the terminal preview's height is kept per Session (DS-11). Every `(test)` criterion is ticked; DS stays In Progress until Dario checks the `(manual)` ones (DS-1.3, 3.7, 4.4, 7.4, 9.3, 11.4). Changed in building: DS-11.1 says what the height measures, the whole preview, its Terminal row included, which makes the minimum 115 px; DS-11.3: a Codex Session's height follows it when its id changes to its session id, since `SessionRow.id` does; the handle shows only while the preview is open, and takes ↑/↓ for itself so the Session sidebar doesn't move too; a pulse ends at the app clock's first tick after 10 s; Work's marker for several Linked Sessions pulses by the latest Busy one. SIDE and VIEW amended.
- 2026-10-22: DS slice 3 review fixes. DS-11.1: the default is 285 px, not 256, so the default terminal text area stays as tall as before the preview was resizable (the 256 px now includes the Terminal row's 29 px, which the first build had silently taken from the text). DS-11.2: the maximum also holds to the content row less the chat's 96 px, so the value and a drag match what's shown; a cancelled drag goes back. DS-11.5: with storage blocked the handle still resizes for the page's life, and junk inside a valid map is cleared by the next prune. DS-10.1: the pulse's phase comes from the real time, so a Session's markers pulse in step. DS-10.1 note: a Codex Session first seen after a server restart, or when it gets its session id, takes its Transcript's time as its Status start (`monitor.ts`), so a long-Busy one can pulse again once.
- 2026-10-23: Dario looked at the manual criteria (DS-1.3, 3.7, 4.4, 7.4, 9.3, 11.4) in the live app and found them as written; ticked. Done: every criterion is ticked.
- 2026-10-23: Amended from Select, then act (WORK-6.5, HIST-3.6; Dario's answers of the same day): DS-7.1 gains one button size, a word beside a 20 px icon in a 28 px tall target, and DS-7.4 allows that 20 px icon. Both unticked until the size is built, so DS is In Progress again.
- 2026-10-23: The labelled size built (DS-7.1): `labelledButtonVariants` and `RowAction` in `components/ui/icon-button.tsx`, outline, `text-body` in the foreground, 28 px tall, the 20 px going to a lucide icon and to an icon that is the target's own child (a Harness logo), while a Session marker inside keeps its size. `RowAction` is a mouse target with a button's role, for a listbox option; its press never reaches the row. A new guard keeps `size-5` (20 px) in `components/ui/`. DS-7.2's sentence on Work's row buttons now names `RowAction`, since the `sm` look it named is gone from Work (`iconButtonLook` removed); the guard is unchanged. DS-7.4 stays for Dario to see live: in a World, the labelled buttons measured 28 px tall with 20 px icons, 4 px apart.
- 2026-10-23: Spacing around the labelled buttons, from Dario's testing: they sat too close to the details above and below. `RowActions` (`components/ui/icon-button.tsx`) now holds them in Work's and History's expanded rows, in one place: 8 px between buttons (was 4), 12 px above (was 6) and 4 px below (was 0). DS-7.4 states it and stays unticked for Dario to re-check.
- 2026-10-23: DS-7.4 ticked: Dario checked the labelled row buttons' size and their wider spacing in the running app.

- 2026-10-24: MEM adds the warning Chip tone (DS-8.3); the colour guard allows memory/load levels in `lib/memory.ts`, the Session growth mark in `SessionItem.tsx`, the warning Chip in `ui/chip.tsx`, and stale memory age in `MemoryLine.tsx`, each pinned to its classes. The shared level icon accepts a label so memory and load never announce usage percentages.
- 2026-10-25: Library slice 1 uses highlight for title, path and URL search hits (LIB-2.4); extended DS-3.4 and the DS-2.3 guard’s file list.
- 2026-10-26: DS-12 added, Lookout's own colour: cool-tinted neutrals, the side columns as a plane, Primary in Productive's indigo for you and what you act on, and a louder Needs you (tints, a solid header tag, a "Needs you" header). From a canvas Dario chose from (current, violet, Productive indigo). The Non-goal on retuning colours narrowed to the Status hues; a Non-goal on more hues added. DS is In Progress again.
- 2026-10-26: Changed in building DS-12: light `warning-text` at `oklch(0.5 0.13 55)` fell to 4.337:1 on the selected 28% Needs you tint over the new sidebar (DS-3.5). The token table now gives `oklch(0.491 0.13 55)`, the nearest lightness at 0.001 precision that passes (4.506:1; 0.492 is 4.487:1); chroma, hue and every contrast threshold stay as they were.
- 2026-10-26: DS-12.1–12.6 built and verified by token, contrast, guard and component tests: cool-tinted planes, Productive indigo on the default Button, chosen options and your messages, the louder Needs you tint and solid tag, and its sidebar header with a visible Controllable count. The Primary family pins every allowed class, including existing focus and resize uses; input selection, the link Button and the launcher's key border are neutral. SIDE and VIEW amended. DS-12.7 stays unticked for Dario's visual check.
- 2026-10-26: Review fixes, round 1 (Codex). DS-12.6: the header came and went during a hover, moving every row below it by its height under the pointer (SIDE-3.4); now whether it takes room is held with the order until the pointer leaves, its count live, and a held header with no Needs you left is invisible and hidden from screen readers. DS-12.1: light `muted-foreground` was at chroma 0.018 in the token table, over the 0.016 the criterion sets; now `oklch(0.5 0.016 270)`, and the test checks the bound and the hue for every neutral, not only the table.
- 2026-10-26: Dario checked DS-12.7 in the running app, in both modes: Needs you is still the most prominent, Primary doesn't read as Busy's blue, and the sidebar and chat read as two planes. Ticked; every criterion is ticked, so DS is Done.
- 2026-10-27: Section headers moved from `meta` to `title`, semibold, in sentence case: Work's "Tasks" and "PRs" and the Session sidebar's "Needs you" and "View only" (DS-12.6) sat too close to the row text. Their counts, ages and Loading stay `meta`/`caption` muted.
- 2026-10-30: DS-6.4 amended from Dario's request: "No Sessions running" lists the shortcuts that matter with no Session (`N`, `H`) from the one shortcuts list, with an "All shortcuts" button for the dialog (SIDE-7.4).
- 2026-10-30: DS-6.4 reworded to match the view: the hint lists `N` and the panels `H` `W` `L` (what `NoSessions()` renders), not `N` and `H`.
