---
title: "Design system"
code: "DS"
status: "In Progress"
created: "2026-10-22"
updated: "2026-11-06"
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

- [x] DS-1.1 Every font size in `web/src` comes from the scale's named steps (UX, "Type scale"): `caption` 11 px, `meta` 12 px, `body` 13 px, `prose` 14 px and `title` 15 px, plus `reading` 16 px and `reading-title` 20 px for long text read whole (the Spec view's Module, PLAIN-9.1, and the chat's prompts and replies, VIEW-11.1). A guard test fails on an arbitrary size (`text-[11.5px]`), on Tailwind's own size utilities (`text-xs`, `text-sm`, `text-base`, `text-lg` and up), and on a `font-size` or `fontSize` in CSS or a `style`, outside the exceptions listed in the Technical approach. (test)
- [x] DS-1.2 The shadcn components in `components/ui/` use the scale too: a button, input, menu item, label and popover are `body`, a dialog's title is `title`, its description `meta`. (test)
- [x] DS-1.3 Seen in both modes at 1440 px: the sidebar, the main pane, History and Work read in four UI levels plus the chat's prose, with no two neighbouring texts a half step apart. (manual)

### DS-2 Colour tokens

New tokens, each with a light and a dark value, and one meaning per family.

- [x] DS-2.1 `index.css` defines `info-soft`, `info-border` and `info-text` (neutral, for staleness and notices), `highlight` (search hits), `warning` and `warning-text` (a level heading toward a limit), and `destructive-soft` (the error Alert's box, DS-4), in light and dark mode, as `oklch()` values the Tailwind theme maps to `--color-*`. (test)
- [x] DS-2.2 `info-text` on `info-soft`, on the background and on the sidebar; `warning-text` on the background and the sidebar; and the foreground on `highlight` over the background and the sidebar keep 4.5:1 or more, in light and dark mode. (test)
- [x] DS-2.3 Each colour family is used only for its meaning (UX, "Colour by meaning"). A guard test fails when a family's token is used in a file its row doesn't list, or in a listed file in a class the row doesn't name, and on a raw colour: a Tailwind palette class (`text-amber-600`), an arbitrary colour (`bg-[#f59e0b]`, `text-[oklch(…)]`) or a hex, `rgb(` or `oklch(` in a TS string or style. The one exception is `HarnessIcon.tsx`'s brand hex. (test)
- [x] DS-2.4 `index.css` defines Productive's palette, `palette-0` to `palette-16`, Productive's 17 colours as Fantastic has them (Canary `#ffe500` to White `#ffffff`), the same in light and dark: they're the colours a status was given in Productive, not Lookout's. It's a family of its own, used only by `TaskStatusDot` (WORK-2.12, [0012](../../decisions/0012-task-status-dots-and-author-avatars.md)), written as `oklch()` like every other token, each Fantastic's hex once converted back. (test)
- [x] DS-2.5 `index.css` defines `diff-added-text`, a green, and `diff-removed-text`, a red (lines added and removed, DIFF-1.1, as a diff colours them), in light and dark mode, as `oklch()` values mapped to `--color-*`. Each keeps 4.5:1 or more on the background, on the sidebar and on every sidebar row state (SIDE-3.11), in both modes. It's a family of its own, used only by the Changes count on a row and in the status line and by the changed-files list (DIFF), and the DS-2.3 guard has its row. (test) It also has `diff-added-soft` and `diff-removed-soft`, the tints of an added and a removed clause or word in the Spec view (PLAIN-1.6): the text colour, the quieter colour and the diff colours keep 4.5:1 on them over the background, in both modes; its guard row lists `SpecView.tsx`.
- [x] DS-2.6 `index.css` defines `spec`, a violet, and `spec-text`, its text shade, for a `.plain` Module (PLAIN), in light and dark mode, as `oklch()` values mapped to `--color-*`. Violet is taken by no Status (DS-3) and no diff colour (DS-2.5). It's a family of its own, used only by a Module's row in the changed-files list (PLAIN-3.4), and the DS-2.3 guard has its row. On its 10% and 16% tints over the popover, the popover's text, the muted grey and the diff colours keep 4.5:1 or more, and `spec-text` 3:1 or more (an icon), in both modes. (test)

### DS-3 Colour means Status

The design review's suggestion 3, as decided with Dario.

- [x] DS-3.1 Harness logos are drawn in the text colour around them (monochrome), in the sidebar's rows, the usage strip and History's filter and results. They keep the brand colour in two places: the main pane's header (a live, a starting and a past Session's) and the new Session modal (the launcher). (test)
- [x] DS-3.2 A usage bar on the strip keeps its fill `foreground/55` at every level, which stays 3:1 or more against the track in both modes. The level shows as a 3 px edge at the fill's end: `warning` at 80% to 94%, `destructive` at 95% or more, none below 80%, set off from the fill by a 1 px gap in the sidebar's colour (3:1 or more against the fill in both modes), since the edge's own lightness is within 2:1 of the fill's and only the gap makes it a separate mark. The fill is `overflow-hidden`, so the edge follows its rounded end. The warning triangle and critical octagon (USAGE-1.2) stay. The usage details popover draws its bars as meters, the level as the same edge (DS-19.1). (test)
- [x] DS-3.3 Staleness uses the info tone, never amber: Work's "Possibly out of date" (WORK-7.5), Work's "old" chip (WORK-7.3), the sidebar's banners for a stale Fleet list and a lost server (SIDE-6.2), Work's "Session links are unavailable", and the terminal preview's "… · retrying", and the usage strip's "stale · …" on a reading marked old. (test)
- [x] DS-3.4 History's and Library's search hits are marked with the `highlight` token, not Needs you's amber. (test)
- [x] DS-3.5 A sidebar row's context usage, its number and its ring, takes the status line's colours (VIEW-5.5): the row's quiet colour up to 40%, `warning-text` above 40%, `destructive-text` above 60%, from the same `contextLevel`. Its text keeps 4.5:1 on every row state (SIDE-3.11). (test)
- [x] DS-3.6 Status colours show only a Status, or something its Status spec ties to one (UX, "Colour by meaning"): Work's "milestone" chip and PR "ready" chip are neutral; chat and Markdown links are underlined in the surrounding text colour; Work's CI-running spinner and the chat rail's finished-Subagent Mark are `muted-foreground`; History's live marker and a live Linked Session's marker in Work show the Session's real Status (DS-5.2, DS-5.3), never a stand-in colour. (test)
- [x] DS-3.7 Seen in both modes at 1440 px with several Sessions and a limit at 95% or more: the brightest things on screen are the Status markers, strips and the Needs you tint, and nothing is amber that neither needs you nor warns of a limit. (manual)
- [x] DS-3.8 Needs you's amber marks a question on the chat rail only while it waits for your answer: the guard pins `ChatRail.tsx`'s `needs-you` class to the pending question's Mark, and an answered, declined or abandoned one is `muted-foreground` (VIEW-1.21). (test)

### DS-4 One Alert

One component for "something went wrong" and "something to know", instead of four styles.

- [x] DS-4.1 `Alert` in `components/ui/alert.tsx` has a tone, `error` or `info`, and a layout, `box` or `inline`. `error` is `role="alert"` with the `CircleX` icon in `destructive`; `info` is `role="status"` with the `Info` icon in `info-text`, or the icon it's given (`WifiOff`, `TriangleAlert`). A box takes a title, a detail and children (a command, a button); inline is a `meta` line that wraps, except the status line's, which is one line cut short with the whole text in its tooltip. An error Alert can be `quiet`: the same look without the live role, for an error announced elsewhere where it is selected (a failed Starting row's). (test)
- [x] DS-4.2 Every error and notice in the migration list (Technical approach) is an `Alert`. A guard test fails when `role="alert"` is written outside `alert.tsx` and the listed functions (Technical approach), when an `Alert` goes quiet (`quiet`, `role="presentation"`) outside the listed ones, or when an element outside it draws a box in `destructive` or `info` colours (a `border-destructive…`, `bg-destructive/…`, `bg-destructive-soft`, `border-info-border` or `bg-info-soft` class). A failure is never an `EmptyState`: History's search error and the chat's missing or unreadable Transcript are error boxes at the top of their panel or pane. (test)
- [x] DS-4.3 The words don't change: each Alert says what it said before, and Work's problem keeps its title, reason, what to do and its command (WORK-7.1 to 7.3). (test)
- [x] DS-4.4 Seen in both modes: every box Alert has the same padding, radius, border, icon size and type step, wherever it sits; every inline one the same type step and icon. (manual)
- [x] DS-4.5 A main-pane view that throws while drawing shows an error box Alert in its place, "This view couldn't be drawn" with the error's message and "Try again", instead of a blank app: the sidebar keeps working, and going to another view starts it clean. (test)

### DS-5 One Session marker

The design review's suggestion 9. A shape means the same thing in every list.

- [x] DS-5.1 `SessionMarker` in `components/ui/session-marker.tsx` draws a Session's state: a live Session's Status marker (`StatusMarker`, SIDE-3.2), a past Session that can be resumed as lucide's `History` in `muted-foreground`, and one that can't as `CircleSlash`. The Session sidebar, History and Work draw their Session markers only through it. (test)
- [x] DS-5.2 A History result for a live Session shows that Session's Status marker, from the Session sidebar's list, and follows its Status live. Its "live" chip stays. A resumable result shows the past marker, a blocked one the slashed circle. (test)
- [x] DS-5.3 A Work row with Linked Sessions shows one marker: the Status marker of its live Linked Session that needs action most (Needs you, then Busy, Idle, Unknown; Unknown for a live Link the Session sidebar's list doesn't have yet or no longer has), or the past marker when none is live. Its tooltip still lists each Link's reason (WORK-2.4). (test)
- [x] DS-5.4 A guard test fails when lucide's `Circle` or `CircleDot` is imported outside `Answering.tsx`, where they draw a question's options, not a Session. (test)
- [x] DS-5.5 Rows' accessible names don't change: the marker stays hidden from screen readers in History and Work, where the row's words already say it. (test)

### DS-6 Loading that admits time passes

The design review's suggestion 4. On 2026-11-06 (clarity pass, idea 10, Plan item 49) Dario found the Starting view unfinished and a PR's Specs submenu showing a bare "Fetching #3426", and asked for a small animation wherever Lookout waits. `Loading` was words only, in 31 places; 16 of them said only "Loading…", against DS-6.1's "what it's doing"; a Topic member's state, Suggest's preview line and the Sessions list's "Connecting…" and "Looking for Sessions…" were written by hand; and the Starting view and a Starting row spun lucide's `LoaderCircle` without its words, the view's even under reduced motion, as the chat's skeleton pulses. Now every wait is a `Loading` with the orbiting Lens (DS-14.4) and its own words.

- [x] DS-6.1 `Loading` in `components/ui/loading.tsx` shows what it's doing ("Reading the Transcript…") at once. From 3 s it adds how long it has taken ("· 4s"), every second. From 15 s it shows a hint, when the place gives one. The label is in a polite `role="status"` region, announced once; the seconds are outside it (as VIEW-1's "Working…" row does). (test)
- [x] DS-6.2 The chat's skeleton stays, with a `Loading` under it: "Reading the Transcript…", and from 15 s "This is taking a while. The terminal preview still works.", with a Show terminal button, for a Controllable Session; a View only one has no preview, so no hint. (test)
- [x] DS-6.3 Every other "Loading…" is a `Loading`: History's results and "Loading more…", Work's section headers, the main pane, a starting and a past Session's view, the terminal preview, the usage strip and its details ("Reading usage…"), and the status-line menus. (test)
- [x] DS-6.4 With no live Session and no Starting row, the main pane says "No Sessions running" with a "Start a Session" button that opens the launcher, as `N` does, instead of "Select a Session" and keys to move through an empty list. Under the button the hint lists `N` and `H` `W` `L` (the panels; History is where past Sessions are resumed) from the one shortcuts list (SIDE-7.4), then an "All shortcuts" button that opens the Keyboard shortcuts dialog. With Sessions, the hint stays (VIEW-5.4). (test)
- [x] DS-6.5 `Loading` shows the orbiting Lens (DS-14.4) before its words, in `muted-foreground`, at the size of an icon beside its text (DS-7): 14 px beside `meta`, 12 px beside `caption`, 16 px beside `body`. It orbits only while the wait lasts, and holds still under reduced motion; so does every skeleton's pulse (DS-6.2's included), which runs only under `motion-safe`. (test)
- [x] DS-6.6 Every `Loading` says what it reads or waits for, in the words of the UX table "Loading words", never "Loading…" alone; "Loading more…" under a list stays. The waits written by hand become `Loading`s with their words: a Topic member's state (`TopicView.tsx` `State`), Suggest's preview line, and the Sessions list's "Connecting…" and "Looking for Sessions…"; a PR's Specs submenu reads "Fetching #3426 from GitHub…". The Starting view's and a Starting row's `LoaderCircle` become the Lens (LAUNCH-7). (test)
- [x] DS-6.7 A place can show its hint earlier than 15 s, when it knows when a wait becomes a failure: the Starting view's at 10 s, since a start fails at 15 s (LAUNCH-4.5, LAUNCH-7.3). (test)
- [x] DS-6.8 The guard (Technical approach, check 12) fails on a `Loading` whose label is "Loading…"; the text "Loading…" outside `ui/loading.tsx`; `LoaderCircle` outside Work's CI icon, where it means "CI running" (WORK-3.2); `animate-spin` outside that icon and a Refresh button's icon while it refreshes (the right sidebar's, Settings' Tools); and `animate-spin` or `animate-pulse` without `motion-safe:`. (test)
- [x] DS-6.9 Seen in both modes at 1440 px and with the right sidebar at 280 px, with each place made slow: the Lens reads as Lookout looking, quieter than any Status marker and never as one; its words say what is read; nothing moves with reduced motion. (manual)

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
- [x] DS-8.4 `Kbd` is one key: the Filter box's `/`, the main pane's hints, the launcher's ⌘↵ and the composer hint's `i`. A sentence is never a key: the launcher's "Esc to close · your input is kept" (or "is discarded", in a launcher opened from Work or a Topic view, LAUNCH-1.3) keeps only "Esc" in a `Kbd`. (test)
- [x] DS-8.5 `Avatar` is a person's picture in a circle, 16 px in a row: an image from Lookout's own origin over the person's initial (the first letter, upper-case, `caption`, `muted-foreground` on `muted`), which stays when the image fails or hasn't loaded. Its accessible name is the person's login. It's the one component that renders an `<img>` (0012); the guard fails on an `<img>` anywhere else. (test)

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
- [x] DS-12.4 Primary marks you and what you act on, and nothing else: a `Button` of the default variant (the composer's Send, Start a Session, the launcher's Start, a question card's submit, Settings' Save); keyboard focus, a focused field's border and a resize handle while dragged (`ring`, as today); a question's chosen option (its border, and its dot or tick in `primary`); your own messages in the chat (`bg-primary-soft`); the composer's attachment drop target (VIEW-9.2: dashed `border-primary`, `bg-primary-soft`, `text-primary`); and drawing an Edge in the Topics graph (TOPIC-6.1: the line being drawn, the dashed target node and the handle). Never a Status marker, strip, row tint or Status tag, a Chip, a link, a list row's selection (a selected row keeps its neutral ring, SIDE-3.9), a selected graph node (a `foreground` ring), a "new" mark (TOPIC-13.2's dot is `foreground`) or a chart. The colour guard (DS-2.3) gets a Primary family, its files pinned to these classes. (test)
- [x] DS-12.5 Needs you grows with the rest. A sidebar row's Needs you tint is 16% at rest, 22% under the pointer and 28% selected (was 12, 20 and 26), and light `needs-you-text` darkens to `oklch(0.48 0.13 55)`, so the "waiting for" line keeps 4.5:1 on the selected tint over the new sidebar (SIDE-3.11's test). The header's Status tag for Needs you is solid: a `needs-you` fill under a new `needs-you-foreground`, 4.5:1 or more in both modes; the Busy, Idle and Unknown tags stay as they are (VIEW-5.9). (test)
- [x] DS-12.6 With one or more Controllable Sessions Needing you, a "Needs you" header with their count sits above them in the Session sidebar, in `needs-you-text`, built and spaced as the "View only" header. It isn't a Session: ↑/↓, j/k, ⌘1–9, ⌘J and the filter skip it as they skip "View only", it hides when the filter leaves no Needs you row, and screen readers get it the way they get "View only". While the pointer is over the sidebar (SIDE-3.4) it neither comes nor goes, so the rows under the pointer don't move: one that wasn't there waits for the pointer to leave, and one that was keeps its room, empty and hidden from screen readers, once its last Session stops Needing you; its count stays live. A View only Session that Needs you stays under "View only". (test)
- [x] DS-12.7 Seen in both modes at 1440 px, with Sessions in every Status and the chat showing a question card: the Needs you rows, their header and the header's tag are still the most prominent things on screen (DS-3.7 still holds); a Primary button or your own message never reads as Busy's blue beside a Busy marker; and the sidebar and the chat read as two planes. (manual)
- [x] DS-12.8 Primary also marks where your keys are and your prompts on the chat rail: the edge of the column that has the keys, in `ring` (SIDE-11.3), and a prompt's Mark, in `primary` (VIEW-1.21). The colour guard (DS-2.3) pins them: `ChatRail.tsx` to `bg-primary` on a prompt's Mark, and the edge's file to its one `ring` class. (test)

### DS-13 Sub-pages and tabs

A page in parts gets one of two shared pieces, never a strip made by hand: sub-pages for a page whose parts are separate places (Settings, SIDE-7.6), tabs for one thing seen in parts (a Topic view, TOPIC-10.7). The open part is in the path, so a reload keeps it; which part a path names is the page's own spec.

- [x] DS-13.1 `SideNav` (`ui/side-nav.tsx`) lists a page's sub-pages as links in a `nav` named after the page, on the left of its content. The open one has `aria-current="page"` and reads as a selected row (`bg-accent`, `foreground`, medium); the others are `muted-foreground`, `accent/60` under the pointer. A link can carry a dot with a tooltip (TOOLS-2.4's). Only the open sub-page is mounted, so a field typed and not saved is dropped on a switch, as on leaving the page. Each is a real link to its path, so ⌘-click opens it in a new browser tab; a plain click opens it in place and replaces the history entry, so Back leaves the page rather than walking its sub-pages. Tab reaches each link in turn. In a main pane narrower than 640 px the links sit above the content as one wrapping row. (test)
- [x] DS-13.2 `Tabs` (`ui/tabs.tsx`) is a `tablist`, named after what it splits, of text tabs, each with an optional count (`tabular-nums`) or note ("3 new") and an optional dot, over one `tabpanel` per tab, named by its tab. The selected tab is `foreground`, medium, with a 2 px `foreground` line under it on the strip's bottom border; the others are `muted-foreground`, `foreground` under the pointer. Only the selected tab is in the Tab order; ←/→ select the next or previous tab (wrapping), Home and End the first and last, focus following; Tab then goes into the panel. Panels not shown stay mounted and `hidden`, so what's typed or opened in one survives a switch. The page decides what a selection does (TOPIC-10.8: the path). (test)
- [x] DS-13.3 The guard fails on `role="tablist"` outside `tabs.tsx` and `RightSidebar.tsx` (whose icon tabs also open and close the sidebar, WORK-1.7), and on `aria-current="page"` outside `side-nav.tsx`. (test)
- [x] DS-13.4 Settings (SIDE-7.6) and a Topic view (TOPIC-10.7) read well from a 480 px main pane to a wide one, light and dark: the side nav beside the content when wide and above it when narrow, and the Topic view's tabs on one line at 480 px with "Members 46" and "Activity 10 new". (manual)

### DS-14 Lookout's own mark

Lookout's mark is the Lens: a ring and an off-centre dot (0014). It's the brand, so it never takes a Status colour (DS-3).

- [x] DS-14.1 `LookoutMark` (`ui/lookout-mark.tsx`) draws the Lens in a 24 px viewBox with lucide's grammar: a ring, `circle cx=12 cy=12 r=8.5`, stroked at 2 px with round caps and joins, and a solid dot, `circle cx=14.25 cy=9.75 r=2.75`. Its stroke and fill are `currentColor`, so it takes the text colour around it and never a Status, Warning, Destructive or Primary token; its size comes from its `className`; it's hidden from screen readers. The icon guard (0008) lists its file among those that may draw an `<svg>`. (test)
- [x] DS-14.2 The favicon (`web/public/favicon.svg`) is the Lens on a 32 px tile, `rx=8`, in `#18181b`: the mark in `#fafafa` at a 2.6 px stroke, scaled 0.9167 from `translate(5 5)`. No amber: it's Needs you's colour, kept free for a Needs you mark on the favicon later. (test)
- [x] DS-14.3 Seen in both modes: the favicon reads as the Lens in a light and a dark browser tab strip, and the sidebar's mark (SIDE-8.2) reads as the brand, quieter than any Status marker. (manual)
- [x] DS-14.4 The Lens can orbit: `LookoutMark` with `orbiting` turns its dot around the ring's centre, one turn every 1.6 s at a steady speed, as the clarity pass's mockups drew it, only under `prefers-reduced-motion: no-preference`; with reduced motion it's the still Lens. It's the loader of `Loading` (DS-6.5), the Starting view and a Starting row (LAUNCH-7), and nothing else: the still Lens stays the brand (SIDE-8.2, the favicon). (test)

### DS-15 One scroll bar

The chat's scroll bar (VIEW-1.16) everywhere: with scroll bars always shown, Chrome on macOS draws a lighter track with a line on each side, which the Spec view, a Topic's view and the graph still had.

- [x] DS-15.1 Every element's scroll bar is thin, its thumb the muted foreground at half strength, its track transparent, set once on `*` in `index.css`'s base layer. Nothing else in UI source styles a scroll bar (`scrollbar-width`, `scrollbar-color`, `scrollbar-gutter`, `::-webkit-scrollbar` or a `scrollbar-…` class), so a new view gets it without asking. (test)
- [x] DS-15.2 Seen with "Show scroll bars: Always", in light and dark mode: the Spec view, a Topic's view, the Topic graph, both sidebars and the chat show the same thin thumb and no track or border. (manual)

### DS-16 One labelled action per row

An expanded row's buttons kept multiplying (Plan item 39): a Review request had five, a Topic five, and they wrapped to two or three lines in the right sidebar. Now an expanded row has one labelled button, the action Enter runs, and "More" for the rest, so the row never wraps and a new feature's action has a known place. Chosen by Dario on 2026-11-05 from three drawn options (one button and More; one button and an icon strip; a grid of labelled actions with their keys), every question as recommended.

- [x] DS-16.1 `RowActions` (`ui/row-actions.tsx`) takes the row's first action, `primary`, drawn as DS-7.1's labelled button with `↵` (a `Kbd`) after its word, since Enter on the expanded row runs it (WORK-1.7, HIST-3.2, LIB-3.2, TOPIC-3.4), and its other actions, `more`, drawn as one labelled button "More" (lucide `Ellipsis`, no count) that opens a menu. It takes no children, so a row can't draw a second labelled button. A row with no other action has no "More"; one whose Enter runs nothing (a Library file that's gone) has only "More". The two sit on one line and never wrap: the first one's word is cut short before they would. (test)
- [x] DS-16.2 The menu lists the actions in four groups, in this order, each group in the order the row gives them: what the row runs (Open Session, Resume, Start Session, Review); what opens elsewhere (Open on GitHub, Open in Fantastic, Open file, Copy link, Open graph, Specs); Topics (Add to Topic, Link to Topic…); and, after a divider, managing (Archive or Unarchive, then Delete, in `destructive-text`). An item shows its icon, its word and, when its panel has a key for it, that key as a `Kbd` at the right. No new keys. An item can open a submenu instead of acting (Specs, PLAIN-5.1). (test)
- [x] DS-16.3 Picking an item runs it and closes the menu; a disabled one (while a resume runs) says so and does nothing. The menu's clicks and keys are its own, never the row's under it (WORK-1.12): Esc closes it and leaves the row expanded. Closing gives focus back to the panel's list, unless focus went to another control. "More" opens and closes on a click, as a labelled button acts, so a click with no count (assistive technology's) opens it, and it ignores the second click of a double click, however slow, and a click while its row settles (`ROW_SETTLE_MS`). In the Topics tab, whose rows aren't listbox options (TOPIC-3.4), the first action and "More" are in the Tab order, Enter and Space press them, and closing gives focus back to "More". (test)
- [x] DS-16.4 Work, History, Library and Topics draw an expanded row's actions only through `RowActions`: a guard test fails on a `RowAction` outside `components/ui/` other than a Session chip (`data-action="session"`), and each row kind's test finds one labelled action and at most one "More". Not row actions, so not changed: the Topic view's header buttons (TOPIC-10.2), a Topic view member's own buttons (TOPIC-10.4) and Session chips (WORK-4.10, LIB-3.5). (test)
- [x] DS-16.5 Seen at the right sidebar's usual width and at 280 px, in light and dark mode: every expanded row's actions sit on one line, and the menu reads as Lookout's other menus (the Status menu). (manual)

### DS-17 Where one row ends

In the right sidebar's lists, rows of two to four lines followed each other with a pixel between them, so it took a moment to see where one ended and the next began (Dario, History first, then every tab). Now a hairline separates two rows, and History groups its rows by day as the Library does. Chosen by Dario on 2026-11-05 from three drawn options (hairlines; rows as cards; day groups and more space), hairlines everywhere and the day groups on top for History and Library, every question as recommended.

- [x] DS-17.1 A row of a right-sidebar list (Work's Tasks and PRs, History, Library, Topics) is marked `data-slot="row"`, and `data-selected` while selected. One rule in `index.css` draws a 1 px line in `sidebar-border` at the top of a row that directly follows another row, from where the row's title starts (`--row-inset`, 28 px; Work's 30 px, after its 16 px icon) to 8 px from the right. So there is no line above a list's first row or under a heading (a day, a PR group), and none touching the selected row: neither above it nor above the row after it. The rows have no gap between them and 7 px of padding above and below. (test)
- [x] DS-17.2 In a browser, with the rule's real CSS, the line is drawn between two rows of Work's Tasks list (the one list with a Behaviour World; History's and the others' rows carry the same marks, DS-17.1), 1 px tall from 30 px in, and is gone on both sides of the selected row. (e2e)
- [x] DS-17.3 Seen in each of the four tabs, in light and dark mode, with an expanded row and a long list: where one row ends is plain at a glance, and the lines don't compete with the selected row. (manual)

### DS-18 Buttons by role

Lookout had 66 `Button`s in six variants and five heights: outline alone came in 20, 24, 28, 32 and 36 px, and 29 of the 66 set their own height in `className`, which no guard checked (DS-7.2 checks icon buttons only). Nearly everything was outline, so in the Session header Stop, Add to Topic and End Session had the same shape, weight and size, and nothing said which button mattered or which was safe. Primary sat in 15 places, almost all in dialogs, Settings and Topics; on the screens used all day only Send and Start. And one action had several icons: "Open" was `Play` in History, `Maximize2` on a Topic and `ExternalLink` in the Library; Review and Start Session both drew `Play`. Now a button's role sets its look, its place sets one of three heights, and each action has one icon. Decided by Dario on 2026-11-06 (clarity pass, idea 4, Plan item 46): End Session stays visible, and menu items have icons too.

- [x] DS-18.1 `Button` (`ui/button.tsx`) has five roles as its `variant`, each with one look (UX, "Buttons"): `primary` (indigo fill), `soft` (a `primary-soft` fill, its label and icon in a new `primary-text`), `secondary` (outline), `quiet` (no fill or border until the pointer is over it) and `danger` (`quiet`'s look in `destructive-text`). Two looks are kept for one use each: `destructive`, a red fill, only for the confirming button of a dialog that ends or deletes something, and `link`, a button inside a line of text. shadcn's grey `secondary` fill goes. `labelledButtonLook` (`ui/icon-button.tsx`), which `RowAction` and the listed hand-made buttons draw with, takes the same roles. (test)
- [x] DS-18.2 `index.css` defines `primary-text`, the Primary family's text shade (`oklch(0.52 0.2 281)` light, `oklch(0.74 0.14 281)` dark): on `primary-soft` over the background, the sidebar and `sidebar-accent` it keeps 4.5:1 or more in both modes, where dark `primary` measures 2.5 to 3.1:1. `destructive-text` keeps 4.5:1 on the same three planes. The colour guard's Primary row pins `bg-primary-soft` and `text-primary-text` to `button.tsx` and `icon-button.tsx` for buttons, beside its existing pins (DS-12.4). (test)
- [x] DS-18.3 A `Button` has three sizes, named by place: `line`, 24 px, `meta` text and a 14 px icon, inside a line of text, a card's line or the status line; `default`, 28 px, `body` text and a 16 px icon, in headers, rows, panels, toolbars and the chat; `form`, 32 px, `body` text and a 16 px icon, in dialogs and Settings' forms. shadcn's `xs`, `sm`, `lg` and 36 px `default` go; icon sizes stay inside `components/ui/` (DS-7). The labelled row button keeps its 28 px with a 20 px icon (DS-7.1). (test)
- [x] DS-18.4 A surface has at most one `primary` button: a view, a dialog, or a form with its own Save (each of Settings' sections is one). A row's first action is `soft` (DS-16.1), and so is a past Session view's Resume; a row's "More" is `quiet`, with its word. Component tests render each view and dialog in the Places list (Technical approach, "Buttons") and count its `primary` buttons. (test)
- [x] DS-18.5 A danger action stays where you use it: End Session in the Session header, last, after a divider (a 1 px line in `border`, 16 px tall, 4 px either side), as `danger` with its icon and word (the word gives way below 26 rem, as today); Delete last in its menu, after its divider (DS-16.2). Its confirming button in the dialog it opens is the red fill, `destructive` (VIEW-5.6, TOPIC's Delete). In the header, Stop and Esc are `secondary`, Add to Topic and Copy session ID `quiet`. (test)
- [x] DS-18.6 Each action has one icon, in one table, `lib/actions.ts` (UX, "Actions"), with its word and its key when it has one. A `RowActions` first action and a menu item name their action, never an icon of their own, so their icon and word come from the table; a `Button` that runs a table action draws its icon with `ActionIcon`; the Keyboard shortcuts dialog shows a shortcut's icon before its label when it runs a table action. Opening something inside Lookout (a Session, a Topic view, the Spec view) and leaving Lookout (GitHub, Fantastic, a file in its app, a URL) have different icons. Every item of an action menu has its icon; a menu of choices (the model, Effort and Status menus) doesn't. (test)
- [x] DS-18.7 The guard (Technical approach, check 9) fails on: a `Button` or `labelledButtonLook` whose `className` sets a height, minimum or maximum height, padding or text size; `variant="destructive"` outside the listed confirm dialogs; a hand-made `<button>` outside `components/ui/` that isn't in the list of allowed ones, each with its reason (rows, tabs, chips, Marks, the status line's menus, inline links); a `RowMenuItem` or `RowActions` first action with an `icon` of its own; and a `Button` whose text is a table action's word without that action's `ActionIcon`. (test)
- [x] DS-18.8 Seen in both modes at 1440 px and with the right sidebar at 280 px: in the Session header, Stop, Add to Topic and End Session read as three kinds of action, and End Session as the one to be careful with; an expanded row's Soft action reads as its next step without competing with a Needs you tint or a Busy marker; no button reads as a Status; and a row's actions, a header's and a dialog's sit on the heights the place gives. (manual)

### DS-19 One anatomy for details popovers

Usage's and Memory's details popovers open from the sidebar's footer in one frame (22 rem, no padding) and differed in everything inside it: one header per Harness against one verdict line; "updated 1m ago" against "3s ago"; 6 px solid bars against 4 px ones; blocks between dividers and a key–value list against tiles, a "Worth a look" box and an uppercase "Who uses it". Memory's was redesigned on 2026-11-06 (MEM-3.2 to 3.9) and Dario likes it. Now its pieces are the system's, Memory's popover is built from them unchanged, and Usage is rebuilt from them (USAGE-2.3 to 2.8). Decided by Dario on 2026-11-06 (clarity pass, idea 5, Plan item 47).

- [x] DS-19.1 `components/ui/details.tsx` holds the pieces of a details popover, moved from `MemoryLine.tsx` with their classes as they are: `Verdict` (a dot in its level's colour, `MEMORY_GLYPH`'s, the verdict in `body` medium, the reading's age at its end in `caption`: "4s ago", or "stale · 1m" in `info-text`); `Tiles` and `Tile` (up to three, each a label in `caption`, a value in `body` medium `tabular-nums` with its level's icon and text colour when it isn't normal, and a line in `caption`); `WorthALook` (a neutral box, `border` and `muted/40`, titled "Worth a look" in `meta` medium, one line each with its icon, and nothing at all when it has no lines); `SectionLabel` (`caption`, medium, uppercase, `tracking-wide`, `muted-foreground`, with an optional note at its right in normal case); and `Meter` (a name, a value and a mark on one line, a 4 px bar under it on a `foreground/10` track, its fill one of three tones, `foreground/55`, `/30` or `/15`, with an optional level edge drawn as DS-3.2 draws the strip's, and an optional `caption` line under it). Memory's popover is built from them and renders the same elements and classes as before. (test)
- [x] DS-19.2 The guard (Technical approach, check 10) fails on `uppercase` outside `ui/details.tsx`, except the chat's message tag `Chip` (listed, with its reason); and on a bar or track drawn by hand, a `rounded-full` element with a `bg-foreground/<n>` fill and an `h-1` or `h-1.5` height, outside `ui/details.tsx` and the usage strip's bar (DS-3.2). A question's header in the chat (`Answering.tsx`, `Chat.tsx`) is a `SectionLabel`. (test)
- [x] DS-19.3 Only `lib/time.ts` formats an age: `formatAge` with "ago" or "stale ·" around it where the place needs words. `lib/usage.ts`'s `formatAgeAgo` and `formatAgeShort` go, so "just now" reads "12s ago". The guard fails on a function named `format…Age…` or `…Ago` outside `lib/time.ts`. (test)
- [x] DS-19.4 Seen in both modes at 1440 px with both popovers opened one after the other, a limit at 100% and a Session growing: they read as one family, the same verdict line, tiles, box, labels and bars, and Memory's looks as it did before. (manual)

### DS-20 One of a few ways to show the same thing

Work's Show filter (WORK-1.5) is the one control that picks one of a few ways to show the same list: three hand-made buttons with `aria-pressed` in a bordered track (`WorkPanel.tsx`), each its own Tab stop, and not on the guard's list of hand-made buttons (DS-18.7). The Spec view's view switch (PLAIN-10) is a second. Now it's one component, with one look and one way to use it from the keyboard. Decided by Dario on 2026-11-06 (clarity pass, idea 9, Plan item 48).

- [x] DS-20.1 `Segmented` (`ui/segmented.tsx`) is a `radiogroup`, named after what it chooses, of two to four text choices side by side in one track, each a `radio` with an optional tooltip; a choice can be disabled, its tooltip saying why. Its look is Work's Show filter's, moved as it is (UX, "Segmented"): the chosen choice is `foreground`, medium, raised on `accent` (`sidebar-accent` in a sidebar), never in Primary; the others `muted-foreground`, `foreground` under the pointer. What a choice does is the page's. (test)
- [x] DS-20.2 Only the chosen choice is in the Tab order. ←/→ choose the previous or next, wrapping and skipping a disabled one, and Home and End the first and last, focus following, as on a `Tabs` strip (DS-13.2); the shortcuts list's ←/→ entry names it (SIDE-7.4). (test)
- [x] DS-20.3 Work's Show filter (WORK-1.5) and the Spec view's view switch (PLAIN-10.1) are `Segmented`s. The guard (Technical approach, check 11) fails on `role="radiogroup"` outside `ui/segmented.tsx`, except the launcher's Harness choice (`Launcher.tsx`, radio cards with an icon in a form). (test)

### DS-21 One anatomy for an expanded row

DS-16 settled an expanded row's buttons and DS-17 where a row ends; what's inside still had no shared order. Seen live on 2026-11-06, five kinds of expanded row (a Session in History, a Task and a PR in Work, an Artifact in Library, a Topic in Topics) had five layouts: the title cut on a Task and a PR, whole elsewhere; labels in a left column on three kinds, "Problem" above a Task's text, none on a Topic; Linked Sessions as three boxed chips on a Task and a PR, ten chips and "+7 older" on an Artifact, one chip and "+13 past" on a Topic; another link as inline text, a chip or plain text; the Artifact's actions in the middle; its URL twice and its source path wrapping mid-word. Two of a Task's three chips read "Fantastic-productive PR 3…". Now one order, one way to draw a link, and the rare facts out of the row. Decided by Dario on 2026-11-06: option A of three drawn (clarity pass, idea 8, Plan item 50); a detail view per kind (option B) only if A's counts hide too much.

- [x] DS-21.1 `ui/row-details.tsx` holds an expanded row's parts, and every expanded row in Work, History, Library and Topics is built from them, in one order: its title, whole (wrapped, never cut); its state, one line in `meta` with the kind's facts joined by " · "; a summary, at most three lines of the kind's own text, left out when it has none; its links (DS-21.2); and its actions last (`RowActions`, DS-16). No part has a label in a column beside it. What each kind puts in each part is UX "Expanded rows". (test)
- [x] DS-21.2 A row's links are counts on one line, one per kind of link it has ("3 Sessions", "1 PR", "1 Task", "2 Topics"), each a disclosure button. When the row expands, or its links arrive after it did, its first count is open if it holds three or fewer, so a Task with its three Sessions shows them at once, and the others are closed; once open, it stays open as it grows, until a count is pressed. Opening one lists its links in place under the counts, one per line, at most three, then "Show all 17"; opening another closes it. A link's line is the same in every row: a Session's Status marker (DS-5.1) or the kind's icon, its name (a Session's by SIDE-10), and its state at the end in `meta` ("live", its age, "past"). It does what WORK-4.10's chip did, with the same accessible name and hover. Boxed chips, grey chips and links as inline text go. (test)
- [x] DS-21.3 Facts you rarely need leave the row, and nothing shows twice: an Artifact's link and its source file are "Copy link" and "Show source file" under More (DS-16); dates, a Session's start directory and an Output's full path are in the state line's tooltip. A fact that's an exception stays, in words: a past Session that can't be resumed and why (HIST-3.3), a source file newer than its last publish (LIB-3.2), a fetch or read that failed. (test)
- [x] DS-21.4 The guard (Technical approach, check 13) fails on an expanded row in `WorkPanel.tsx`, `HistoryPanel.tsx`, `LibraryPanel.tsx` or `TopicsPanel.tsx` that isn't built from `ui/row-details.tsx`, and on `SessionChip` outside a Topic view's member list (`TopicView.tsx`). (test)
- [x] DS-21.5 Seen in both modes at 1440 px and with the right sidebar at 280 px, on a Task with three Linked Sessions and a PR, a Review request, a past Session, an Artifact touched by 17 Sessions and a Topic with past members: the five read as one family, a title is whole, the counts say what's linked, and an open list doesn't push the actions out of reach. (manual)

### DS-22 Quiet rows, loud exceptions

A Session row's second line held up to seven coded values with no labels: a memory mark, a queued mark, the Subagent count, the changed lines in green and red, a background shell, the time in its Status and the context, each sized to its value, so a value's place didn't say what it was (the Subagent count took the memory mark's place). Its colours showed when nothing was wrong: on 2026-11-06 the amber memory mark was on four of five live rows (+56 MB, +267 MB, +393 MB and +2.8 GB in 10 minutes), and on both live rows while this was written (+89 MB and +310 MB), since MEM-2.5 calls 30 MB growing; amber is "act on it" (DS-3), so the one Session running away didn't stand out. Every row with changes was green and red. Now routine values are grey in fixed columns, and an exception has colour and words at the front of the line. Decided by Dario on 2026-11-06 (clarity pass, idea 3, Plan item 50).

- [x] DS-22.1 A Session row's numbers sit in three fixed columns at the end of its second line, in this order: its changes, its time in its Status, its context (UX "Quiet rows"). Each is right-aligned, `tabular-nums`, of a fixed width, and empty when there's no value, so a value's place says what it is and the columns line up from row to row. They're never cut (SIDE-2.14). (test)
- [x] DS-22.2 Routine values are in the row's quiet colour: the changes are grey on the row, their green and red staying in the status line and the changed-files list, where they read as a diff (DIFF-1.1 amended); context is grey up to 40%. (test)
- [x] DS-22.3 An exception has its colour and an icon or words, never colour alone, and leads the second line, before the location and the Session's words, which truncate first: memory running away (MEM-4.1: `TrendingUp` and "+2.8 GB" in `warning-text`), a job queued in `res` (RES-3.1), Subagents running (SIDE-9.7: `Bot` and the count in `busy-text`) and a background shell (SIDE-2.6), in that order, as today's numbers group has them. Context past 40% keeps its column, in its level's colour with its ring (DS-3.5). (test)
- [x] DS-22.4 A component test renders a row with routine values only (changes, an age, context at 40%, memory growing under MEM-4.1's threshold) and finds no coloured text besides the Status's marker, strip and tag; with each exception on, finds it in its place and colour; and finds the columns in their order and widths in every Status. SIDE-3.11's contrast test covers the grey changes. (test)
- [ ] DS-22.5 Seen in both modes with five or more live Sessions, at 280 px and wider: a row says in half a second whether it needs you, the columns line up, and the one exception on the list is the thing you see. (manual)

## Non-goals

- **Narrow widths** (the review's suggestion 2): columns that collapse below about 1024 px, a header that folds its buttons, a status line that drops whole parts. Dario uses Lookout full screen; it's in the Backlog.
- **An in-app toast and a Needs you count in the Filter bar** (suggestion 6). In the Backlog.
- **What a sidebar row shows** (suggestion 1): hiding a repeated `repo · branch`, a Busy row's activity. A separate SIDE-2.1 amendment, in the Plan.
- **Select, then act** in History and Work (suggestion 8). Its own spec, merged with Plan item 2.
- A Storybook, a separate package, or a published component library. The design system is the code in `web/src`, this spec and its tests.
- Retuning the Status hues or the contrast rules SIDE-3.11, VIEW-5.9 and WORK-3.5 already test. DS-12 tints the neutrals, darkens light `needs-you-text` by 0.02 and light `warning-text` by 0.009 for contrast; no Status changes hue.
- More hues: a colour per project or repo, Harness brand colours in lists (DS-3.1 stands), links in Primary. Each would compete with Status in a list or with the text around a link.
- Line heights, spacing and row heights beyond buttons (DS-7, DS-18). They're consistent enough today.
- The review's smaller findings not listed in DS's requirements: the View only row's grey marker, the composer's Needs you border, the flagged usage line's dimming, the composer hint, the chat's measure, the header's Status tag shape, the launcher's layout, Settings' three Save buttons, a `?` shortcut overlay. Each can come back as its own item.
- A theme switch or other themes. Dark mode follows the system, as now.
- New icons or shapes. DS reuses lucide and the Status shapes, within 0008; the one new shape is Lookout's mark (DS-14, 0014).

## UX

### Type scale

| Step | Size / line height | Use | Replaces |
|---|---|---|---|
| `caption` | 11 / 16 px | chips, keys, a usage line's second line, tertiary counts | 10, 10.5, 11 px; `text-xs` in a chip |
| `meta` | 12 / 16 px | second lines, the status line, hints, inline errors | 11.5, 12, 12.5 px where secondary; `text-xs` |
| `body` | 13 / 20 px | row titles, controls, menus, dialogs, Settings, notices | 12.5 px where body text, 13 px; `text-sm`, `text-base` in controls |
| `prose` | 14 / 22 px | the chat's text, the composer, a question's text, Markdown's smaller headings | 13.5, 14, 14.5 px |
| `title` | 15 / 20 px | the main pane's title, a dialog's title, section headers (Work's, the Session sidebar's), Markdown's first heading | 15 px; `text-lg` |
| `reading` | 16 / 26 px | long text read whole: the Spec view's clauses, definitions and acceptance tests (PLAIN-9.1), the chat's prompts and replies (VIEW-11.1) | (new) |
| `reading-title` | 20 / 28 px | a heading inside such text: a functional spec's heading (PLAIN-9.2), a reply's first-level heading (VIEW-11.1) | (new) |

- Classes are `text-caption`, `text-meta`, `text-body`, `text-prose`, `text-title`, `text-reading` and `text-reading-title`, from `--text-*` theme variables, each with its line height. None of the names is a colour token, so `text-…` stays unambiguous.
- Monospace (the status line, commands, the terminal preview) uses the same steps.
- Weights stay as they are: 400, 500 for emphasis, 600 for titles.

### Colour by meaning

| Family | Tokens | Means | Used in |
|---|---|---|---|
| Needs you | `needs-you`, `-soft`, `-text`, `-foreground` | the Status Needs you, nothing else | Status marker, strip, tint and tag; the sidebar's Needs you header and count; a question or permission card; the Needs you row and Mark in the chat; a row's "waiting for" line |
| Busy, Idle | `busy…`, `idle…` | a Status, nothing else: no link, spinner, chip or Mark | Status marker, strip and tag; the chat's "Working…" dot; VIEW-8's running Subagents (Busy); SIDE-2.6's and VIEW-5.16's background shell (Idle) |
| Warning | `warning`, `-text` | a level heading toward a limit | context above 40% (status line and sidebar), usage at 80% or more, a PR aged 3 to 10 days (WORK-3.5) |
| Destructive | `destructive`, `-soft`, `-text` | an error, a critical level, a destructive action | error Alerts, the critical octagon and the bar's edge, context above 60% (`-text`), a PR over 10 days, End Session, a failed start |
| OK | `ok`, `-text` | something passed | CI passing, an approved PR, a PR under 3 days, a Done Session (SIDE-2.17, VIEW-5.17) |
| Info | `info-soft`, `-border`, `-text` | staleness, or something to know that needs nothing from you | info Alerts, the "old" chip, a usage reading marked old, "retrying" |
| Highlight | `highlight` | a search hit | History's snippets and Library's title, path and URL hits |
| Productive palette | `palette-0` … `palette-16` | the colour a status was given in Productive, the same in both modes (DS-2.4) | a Task's status dot (WORK-2.12) |
| Primary | `primary`, `-foreground`, `-soft`, `ring` | you, and what you act on (DS-12.4) | the default Button, keyboard focus and a focused field, a resize handle in use, a question's chosen option, your own messages |
| Neutral | `foreground`, `muted…`, `border`, `accent`, `sidebar…` | everything else, cool-tinted (DS-12.1) | |

- **Amber means "act on it"**: now (Needs you) or soon (a warning level). Never "this is old" or "this matched".
- **Info is grey, not blue**, since blue is Busy. The icon and the box tell it from plain text.
- **Primary is Productive's indigo, for you and what you act on**: buttons, focus, a chosen option, your messages. It sits on things you click or wrote, never on a shape that stands for a Session, so it can't be read as Busy's blue: a Status is a marker, a strip, a tint or a tag; Primary is a button, a ring or a bubble.
- **Harness logos**: monochrome, `currentColor`, everywhere but two places: the main pane's header and the new Session modal (the launcher), where the logo is the choice being made. History's filter and a sidebar row are monochrome; in a row the logo takes the row's quiet colour.
- **Usage bar**: the strip's fill is `foreground/55` at every level, 3:1 against its track in both modes, `overflow-hidden`. The level is a 3 px edge at the fill's end: `warning` at 80 to 94%, `destructive` at 95% or more, none under 80%, a 1 px sidebar-coloured gap between it and the fill; the triangle or octagon sits beside it. A details popover's `Meter` draws the same edge, its gap in the popover's colour (DS-19.1).
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
- **Loading's Lens (DS-6.5, DS-14.4)**: before the label, 6 px from it, at the text's icon size; its dot one turn every 1.6 s, linear, around the ring's centre (12, 12 in its box), so it stays inside the ring.

#### Loading words (DS-6.6)

| Place | Today | Words |
| --- | --- | --- |
| The main pane before Fleet's first list, a Session selected (`MainPane.tsx`) | Loading… | Finding the Session… |
| A Starting row's view before the first list (`StartingView.tsx`) | Loading… | Finding the start… |
| A past Session's view (`PastSessionView.tsx`) | Loading… | Reading the Session… |
| The chat's Show earlier (`Chat.tsx`) | Loading… | Reading earlier messages… |
| The terminal preview (`SessionView.tsx`) | Loading… | Reading the terminal… |
| The status line's menus (`StatusMenu.tsx`) | Loading… | Reading the choices… |
| Work's Tasks and PRs headers (`WorkPanel.tsx`) | Loading… | Reading from Productive…, Reading from GitHub… |
| History's results, and a page of them filling an empty list (`HistoryPanel.tsx`) | Loading… | Searching History… with a query, Reading History… without |
| A History row's "what it said" (`HistoryPanel.tsx`) | Loading… | Reading what it said… |
| The Library (`LibraryPanel.tsx`) | Loading… | Reading the Library… (a Topic view's words already) |
| Topics and the Topic graph (`TopicsPanel.tsx`, `TopicGraph.tsx`) | Loading… | Reading Topics… |
| A Topic view (`TopicView.tsx`) | Loading… | Reading the Topic… |
| A Topic's activity, its earlier summaries (`TopicView.tsx`) | Loading… | Reading activity…, Reading earlier summaries… |
| A Topic member's state (`TopicView.tsx` `State`, by hand) | Loading… | Reading from Work… |
| A PR's Specs submenu (`PrSpecs.tsx`) | Fetching #3426 | Fetching #3426 from GitHub… |
| Suggest's preview line (`SuggestView.tsx`, by hand) | Reading what's in no Topic… | the same, as a `Loading` |
| The Sessions list before the first list (`Sidebar.tsx`, as `EmptyState`s) | Connecting…, Looking for Sessions… | the same, as `Loading`s |

Not waits, so not `Loading`s: Work's CI icon while CI runs (`LoaderCircle`, WORK-3.2), Refresh's turning icon while it refreshes, a button's own word while its action runs ("Sending…", "Archiving…"), and the chat's "Working…" (a Status, VIEW-1.10, DS-10).
- **IconButton**: ghost by default, `muted-foreground` at rest, `accent` under the pointer; its focus ring is the Button's.
- **EmptyState**: centred, the title in `body` medium, the hint in `meta` `muted-foreground`, an optional 20 px icon above, an optional action below.
- **Chip**: `rounded-full px-1.5`, `caption` medium, `leading-4`, a 1 px border (transparent unless the tone has one) so every chip is one height. Neutral: `bg-muted`, foreground. Muted: a `border` border, `muted-foreground` (a draft PR). Info: `info-soft`, `info-text`. Ok: an `ok/40` border, `ok` (an approved PR). A Status tone: its header tag's colours (VIEW-5.9's `STATUS_TAG_CLASS`), solid for Needs you, `-soft` and `-text` for the others.
- **Kbd**: `caption` mono, `rounded border border-border px-1`, at least 20 px wide, 16 px tall (a 14 px line and the border), so it sits in a `caption` or `meta` line without growing it.
- **CommandBlock**: `rounded-md border border-border bg-background p-2`, `caption` mono, wrapped anywhere, `select-all`.
- **SideNav (DS-13.1)**: a 160 px column, links 28 px tall in `body`, `rounded-md px-2`, 2 px apart, 24 px from the content; narrow, a row of the same links with 4 px between them and 16 px under it. The dot is TOOLS-2.4's.
- **Expanded rows (DS-21)**: what each kind puts in each part, in order; actions are always last, as DS-16 has them.

| Kind | State | Summary | Links |
| --- | --- | --- | --- |
| Task (Work) | project · status · due · its one Linked PR's number, state and CI | its description, three lines | Sessions, PRs (when more than one), Topics |
| PR or Review request (Work) | repo #number · state chip (Mine) · CI · age | none | Task, Sessions, Topics |
| Session (History) | repo · branch · last active · "live", or why it can't be resumed | its first prompt and its last message, three lines each, with who said it | Topics |
| Output (Library) | kind · folder · updated 2h ago · published 24 times · "newer than published" | none | Sessions, with what each did ("wrote it"), Topics |
| Topic (Topics) | its members · updated | its notes, three lines, rendered | Sessions, live first, then past |

  The title is in `body`, medium, as the collapsed row's. Counts sit 8 px apart, each "3 Sessions" with a chevron that turns when open; a link's line is 24 px, its state in `meta` `muted-foreground` at its end.

- **Quiet rows (DS-22)**: the columns' widths, measured at 12 px Inter `tabular-nums` on 2026-11-06: changes 64 px ("+2.7k −392"; "+9.9k −999" fits, a wider one grows its own row's column), time 26 px ("59m"), context 44 px (the ring and "100%"), 6 px apart: 146 px, where the numbers group took 147 to 149 px on the live rows. An exception at the front is its icon and its value (`TrendingUp` and "+2.8 GB", `Bot` and "2"), 4 px from the next, and never cut.

- **Segmented (DS-20)**: Work's Show filter today, moved as it is: a track with a 1 px `input` border on `background/60` (`input/20` in dark), `rounded-md`, 2 px inside; choices in `meta`, `rounded`, `px-1.5`, as wide as their word (Work's fill the track's width, as now); the chosen one `accent` (`sidebar-accent` in a sidebar), `foreground`, medium, `shadow-xs`.
- **Tabs (DS-13.2)**: a 32 px strip on a 1 px `border` bottom line; tabs in `body`, `px-2` each and side by side, so labels are 16 px apart; the count or note after the label in `meta` (`muted-foreground`); the selected tab's 2 px line sits on the strip's line. The dot is TOPIC-13.2's.

```
SideNav, wide                         Tabs
 General   ┌ Idle threshold ────┐      Overview   Members 46 •  Activity 3 new
 Tools •   │ [ 4 ] hours  Save  │      ════════
           └────────────────────┘     ─────────────────────────────────────────
```

### Buttons (DS-18)

| Role | Looks | For | Limit |
|---|---|---|---|
| `primary` | `primary` fill, `primary-foreground` | the action the surface exists for: Send, Start, a question's submit, a dialog's confirm, Save | one per surface |
| `soft` | `primary-soft` fill, `primary-text` label and icon | the next step in a dense place: a row's first action, a past Session's Resume | one per row |
| `secondary` | 1 px `border`, `background`, `foreground` | a real alternative: Stop, Esc, Cancel, a Session chip | |
| `quiet` | no fill or border; `muted-foreground`, `accent` under the pointer | frequent, low-stakes actions in headers and toolbars: Add to Topic, More, Copy, Show more | |
| `danger` | `quiet`'s look in `destructive-text` | End Session, Delete, where they're used: last, after a divider | |
| `destructive` | `destructive` fill | only the confirming button of a dialog that ends or deletes | |
| `link` | underlined text | a button inside a line of text ("All shortcuts") | |

| Size | Height | Text | Icon | Where |
|---|---|---|---|---|
| `line` | 24 px | `meta` | 14 px | inside a line of text, a card's line, the status line (Compact, Show terminal) |
| `default` | 28 px | `body` | 16 px | headers, rows, panels, toolbars, the composer, an empty state |
| `form` | 32 px | `body` | 16 px | dialogs and Settings' forms |

#### Actions (DS-18.6)

| Action | Icon | Was |
|---|---|---|
| Open, inside Lookout (a live Session, a Topic view, the Spec view) | `ArrowRight` | `Play`, `Maximize2` |
| Open, leaving Lookout (GitHub, Fantastic, a file in its app, a URL) | `ExternalLink` | as before |
| Open in VS Code | `Code` | as before |
| Resume | `History` | as before |
| Show read-only | `Eye` | as before |
| Start Session | `Play` | as before |
| Review | `ScanEye` | `Play` |
| Specs | `FileText` | as before |
| Add to Topic | `Layers` | `Layers`, `Plus` |
| Link to Topic | `ArrowLeftRight` | as before |
| Open graph | `Network` | `Network`, `Maximize2` |
| Copy (a link, a path, a session ID, code) | `Copy` | as before |
| Archive, Unarchive | `Archive`, `ArchiveRestore` | as before |
| Delete | `Trash2` | as before |
| Stop | `CircleStop` | as before |
| Esc | `OctagonX` | as before |
| End Session | `Power` | as before |
| Show terminal | `SquareTerminal` | `TerminalSquare`, its old name |
| Refresh | `RefreshCw` | as before |
| Retry | `RotateCw` | as before |
| Suggest | `Sparkles` | `Sparkles`, `RefreshCw` |
| More | `Ellipsis` | as before |

```
Session header
 Fix rates rounding   Busy · 8m      [■ Stop]  (⊕ Add to Topic)  (⧉) │ (⏻ End Session)
                                      secondary  quiet            quiet   danger

An expanded row
 [→ Open Session ↵]  (… More)
   soft                quiet
```

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
9. **Buttons by role (DS-18.7).** On every `<Button>` and `labelledButtonLook(…)` call outside `components/ui/`: no `h-`, `min-h-`, `max-h-`, `p-`, `px-`, `py-`, `pt-`, `pr-`, `pb-`, `pl-`, `ps-`, `pe-` or `text-<step>` class, so the size decides; `variant="destructive"` only in the confirming button of End Session's and a Topic's Delete dialogs. A `<button>` outside `components/ui/` only in a pinned list of functions, each with its reason and count, as check 2 pins its functions: a list's rows and chips, a tab strip, the chat rail's Marks (VIEW-1.11), the status line's menus (DS-7.3), an inline link, a question's options. `RowMenuItem` and `RowActions`' first action take an `action` id, so an `icon` on either fails; a `<Button>` whose text is a word in `lib/actions.ts` fails without that action's `ActionIcon`. Its exceptions live in the test with a reason each.
10. **Details popovers (DS-19.2, 19.3).** `uppercase` in a class string only in `ui/details.tsx` and the chat's message tag (`Chat.tsx`, one use); a `rounded-full` element with a `bg-foreground/<n>` fill and an `h-1` or `h-1.5` height only in `ui/details.tsx` and `UsageStrip.tsx`'s strip bar; a function or variable named `format…Age…` (with no lowercase letter after `Age`, so `formatAgent` passes) or `…Ago` only in `lib/time.ts`, which holds `formatAge` alone. The message tag's exception is `Chat.tsx`'s `Meta`, the strip bar's `UsageStrip.tsx`'s `Bar`, each pinned to one use.

11. **One of a few (DS-20.3).** `role="radiogroup"` only in `ui/segmented.tsx` and `Launcher.tsx`'s Harness choice.
12. **Waits (DS-6.8).** A `<Loading>` whose `label` is the string "Loading…"; the text "Loading…" outside `ui/loading.tsx`; `LoaderCircle` outside `WorkPanel.tsx`'s `Ci`; `animate-spin` outside `Ci` and the Refresh buttons (`RightSidebar.tsx`, `ToolsSection.tsx`); and `animate-spin` or `animate-pulse` without `motion-safe:`.
13. **Expanded rows (DS-21.4).** An expanded row's details in `WorkPanel.tsx`, `HistoryPanel.tsx`, `LibraryPanel.tsx` and `TopicsPanel.tsx` render `RowDetails`; `SessionChip` only in `TopicView.tsx`'s member list; `SessionChips` gone.
14. **Quiet rows (DS-22.4).** A component test, not a source check: `SessionItem` with routine values has no `text-diff-*`, `text-warning-text` or `text-destructive-text` element, and its three columns in order.

The icons guard keeps its rules: `SessionMarker` draws with lucide and `StatusMarker`, and `SessionItem.tsx` draws the context gauge, a chart, so it's named in the icons guard (MEM's sparkline went with MEM-3.3's 2026-11-06 change). It reads a key glyph inside `<Kbd>` as it reads one inside `<kbd>` (the launcher's ⌘↵).

### Expanded rows and quiet rows (DS-21, DS-22)

- **`ui/row-details.tsx`:** `RowTitle`, the title, whole when the row is expanded and cut when it isn't, in the row's own first line beside its icon; `RowDetails` with `state` (facts, joined), `stateTip`, `summary`, `links` (`{ kind, noun, items }[]`) and `actions` (a `RowActions`), drawing them in DS-21.1's order, the state part of the row's name and the rest its description when `described` (Work and History, as before); `RowLinks`, the counts and the open one's lines, with `LINKS_SHOWN` (3); `LinkLine` for one link, with the action and accessible name WORK-4.10's chip had. Work's `SessionChips` and `DetailLine`, the Library's chips, `TopicChips` (now `useTopicLinks`, `lib/topics.ts`) and an expanded Topic's chips move onto it.
- **Moved to More (DS-21.3):** "Show source file" joins LIB's More, beside "Copy link"; the Artifact's URL and source path leave the expanded row.
- **The columns (DS-22.1):** `SessionItem`'s numbers group becomes three fixed-width spans (`w-16`, `w-6.5`, `w-11`, right-aligned) after the slot; the marks (memory, Subagents, queued, background shell) move to the slot's start, `shrink-0`.

### Buttons

- **Names:** the variants `default`, `outline` and `ghost` become `primary`, `secondary` and `quiet`; `soft` and `danger` are new; shadcn's grey `secondary` goes (its one use, Jump to latest, becomes `secondary`). The sizes `xs`, `sm`, `default` and `lg` become `line`, `default` and `form`. Every `Button` outside `components/ui/` moves in the same change, by its place: a dialog's or Settings' form's buttons are `form`; the status line's Compact (20 px today), a question card's Show terminal and the chat skeleton's are `line`; the rest `default`.
- **Hand-made buttons:** 43 today. Those that copy a button's look become `Button`s: Markdown's code Copy (`secondary`, `line`, beside its "Copied"). The rest go on the guard's list with their reason: a list's rows and chips (Servers, Topics, Memory), the right sidebar's and `Tabs`' tabs (DS-13.3), the chat rail's Marks, the status line's menus (DS-7.3), the Session title's rename (VIEW-5.12), inline links (Spec view, Topic view), a question's options, the chat's folded steps and Spec view sections (disclosures) and the Topic graph's node chip.
- **Places counted by DS-18.4:** the Session view (Send), a question card (its submit), the launcher (Start), the empty main pane (Start a Session), the Starting view (Trust), Settings' each section (Save), the Topic graph's and the Topic picker's dialogs, the Archive dialog, Suggest Topics (Accept), and Topics' new-Topic form (Make).
- **`lib/actions.ts`:** `ACTIONS: Record<ActionId, { word: string; icon: LucideIcon; key?: string }>` and `ActionIcon({ id })`. `RowActions`' first action and `RowMenuItem` take `action: ActionId` (and a word only where the row's differs, as "Open Session"); `lib/shortcuts.ts` entries that run an action name it, so the Keyboard shortcuts dialog draws its icon.

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
- **Loading's Lens and its words (DS-6.5 to 6.7):** `Loading` draws `LookoutMark orbiting` and takes `hintAfter` (15 s by default), `size` (`caption`, `meta`, `body`: the text and its Lens's size), `title` (the label's tooltip) and `live` (false where the place announces the words through its own region); the orbit is a CSS rotation of the dot's group inside `@media (prefers-reduced-motion: no-preference)`, as the chat's countdown ring does it. The Starting view passes `since` (the start's `startedAt`) and `hintAfter` 10 s.
- **Terminal preview (DS-11):** `lib/terminal-height.ts` holds a pure `drawerHeight(paneHeight, kept)` and the keep and read, as `lib/right-sidebar.ts` does for the width. One `localStorage` entry (key `lookout.terminal`) holds a map from the Session's id (`SessionRow.id`) to its height. Read and write are inside `try`; anything odd is the default, and an entry that isn't a positive number is left out. A Session with no entry uses the default. The height is the whole preview's (its top border, the 28 px Terminal row, the text's padding and lines), so its minimum, the Terminal row plus four 17.4 px lines, is 115 px; the maximum is 70% of the main pane (the Session view, measured with a `ResizeObserver`, the window's height until then) and no more than the content row's height less the chat's 96 px (the content row measured the same way), so the handle's value and a drag start from what the layout shows, and a kept height is shown clamped to both but kept as it was. When the Session list is known (`listKnown`) and loads or changes, App prunes the entries for ids not in it (in a layout effect, before paint), so the map doesn't grow; a Codex Session that got its session id (the store's `aliases`) keeps its entry under the new id. The drawer reads the entry through `useSyncExternalStore`, so a keep or a prune shows at once. It swaps `h-64` for that height as a style on the preview, which keeps `min-h-0` and shrinks before the chat's `min-h-24` (SIDE-8.1); the handle, shown while the preview is open, is a `role="separator"` with `aria-orientation="horizontal"`, `aria-valuenow`, `aria-valuemin` and `aria-valuemax`. ↑/↓ on it are handled there (`preventDefault`), so the Session sidebar's window handler doesn't also move the selection; a drag keeps the height when the pointer is let go, and drops it if the drag is cancelled. When `localStorage` throws, `terminal-height.ts` keeps the last map in memory and reads it back, so the handle works for the page's life; a write that goes through clears it.
- **Details popovers (DS-19):** `ui/details.tsx` holds `Verdict` (`level`, `age`, `flagged` for the info tone, and an `id` so a popover can be named by its verdict, as Usage's is), `Tiles` and `Tile` (`label`, `value`, `level`, `field`; its last line wraps, MEM-3.10), `WorthALook` (`lines`, each an icon and its words, the whole in its tooltip; nothing when there are none), `SectionLabel` (`as`, an `icon` before the label, a `note` at its right) and `Meter` (`name`, `value`, `mark`, `percent`, `tone`: `strong`, `mid` or `faint`, `level` for the edge, `line`). `lib/usage.ts` keeps `BAR_TRACK`, `BAR_FILL`, `BAR_EDGE` and `BAR_EDGE_GAP` (`strip`, `popover`) for the contrast tests; the classes are written where they're drawn, so check 10 sees them.
- **Segmented (DS-20):** `ui/segmented.tsx` takes `label`, `choices` (`{id, label, tooltip?, disabled?}`), `value`, `onChange(id)`, `surface` (`page`, or `sidebar` for `sidebar-accent`) and `fill` (the choices share the track's width). A disabled choice is `aria-disabled`, not `disabled`, so its tooltip still shows. The arrows, Home and End stop at the group, so the page's own keys never see them.
- **Sub-pages and tabs (DS-13):** `side-nav.tsx` takes `label`, `items` (`{id, label, href, dot?}`), the open `id` and `onOpen(id)`; a plain click (no modifier, the main button) calls `onOpen` and prevents the default, any other click is the browser's. Narrow is a container query on the main pane (`@container`, under 640 px), not the window, since the side columns take their own width; the page declares the container outside its padding, so the query measures the pane. Each tab panel is a Tab stop (`tabIndex 0`, the focus ring), so Tab goes into one that holds only text. `tabs.tsx` takes `label`, `tabs` (`{id, label, count?, note?, dot?}`), the selected `id`, `onSelect(id)` and one child per tab, rendered in its panel; ids are `tab-<label>-<id>` and `panel-<label>-<id>`. Both are controlled: the page keeps the open part in its route.
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
- **SIDE** (DS-13): Settings in two sub-pages (SIDE-7.6) and the shortcut list's "Switch tab" (SIDE-7.4). **TOOLS**: its list is Settings › Tools (TOOLS-1.4, 2.4). **TOPIC** (DS-13): the Topic view's tabs (TOPIC-10.7, 10.8) and what moves into them (TOPIC-10.5, 11.10, 12.3, 13.2).
- **WORK**, **PLAIN** and **SIDE** (DS-20): Work's Show filter (WORK-1.5) and the Spec view's view switch (PLAIN-10.1) are `Segmented`s; the shortcut list's ←/→ entry names it (SIDE-7.4).
- **WORK**, **HIST**, **LIB**, **TOPIC** (DS-21): WORK-2.9, 3.6 and 4.10, HIST-2.9, LIB-3.2 and 3.6, TOPIC-3.4: each kind's expanded row in DS-21's parts, links as counts. **SIDE**, **DIFF**, **MEM**, **RES** (DS-22): SIDE-2.6, 9.1 and 9.7, DIFF-1.1, MEM-4.1 and RES-3.1: the columns, grey changes, the marks first, the memory mark's threshold.
- **LAUNCH** (DS-6, DS-14.4): the Starting view and a Starting row draw the orbiting Lens (LAUNCH-7). **SIDE**, **VIEW**, **HIST**, **WORK**, **LIB**, **TOPIC**, **PLAIN** (DS-6.6): their `Loading`s take the table's words.

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
- **Sub-pages for Settings, tabs for a Topic** (Dario, 2026-11-02): Settings' parts are separate places you go to, so they're links in a side nav, as in a system's settings; a Topic is one thing in parts, and a side nav's 160 px would cost the Topic view too much at 480 px, so it gets a tab row. Two pieces, each guarded, so neither is drawn again by hand. The right sidebar's icon tabs stay its own: they also open and close it.
- **Drawing an Edge is Primary; a selected node or a "new" dot isn't** (Dario, 2026-11-02, when the guard's fixed cache showed them): the line, target and handle are what you act on, like the composer's drop target; a selection is where you are, and "new" is information, so both are `foreground`. The Subagents popover's Busy and Idle text is the status line's count's meaning (DS-3.6), so `SubagentsButton.tsx` is listed with it.
- **The selected tab is `foreground`, not Primary**: DS-12.4 keeps Primary for what you act on, and a selected tab is where you are, like a selected row.
- **A button's look comes from its role, not from colour (DS-18)**: Dario's impression was "we rarely use coloured buttons"; more colour would compete with Status again (DS-3.7), so the hierarchy comes from fill, border and weight, and colour stays for Primary's one button and Soft's next step.
- **Soft, a new role (DS-18.1)**: a dense list needs its next step marked without a second loud indigo block on every row; the tint is Primary's family, so it reads as "you act here" and not as a Status.
- **End Session stays visible, as `danger` behind a divider (DS-18.5)**: Dario ends Sessions often, so hiding it in a menu would cost a click every time; red text and a divider set it apart from Add to Topic without a red block in the header.
- **Memory's popover is the model, unchanged (DS-19)**: Dario likes it as redesigned; moving its pieces as they are makes the system's details popover the one he chose, and the next popover starts from it.
- **Sizes named by place (DS-18.3)**: like the type steps, a size says where it belongs, so the right one is the one whose name fits; three heights replace five.
- **The guard checks how a button is built (DS-18.7)**: value guards let 29 height overrides through (0015); a `className` that can't set a height leaves only the three sizes.
- **One icon per action, by construction (DS-18.6)**: a menu item names its action and gets its icon from the table, so a second icon for the same action can't be written.

## Open questions

None.

- **One component for one of a few ways to show a thing (DS-20)**: the Spec view's switch would have been a second hand-made copy of Work's filter. A `radiogroup` with arrows, as `Tabs`, rather than pressed buttons: one Tab stop, and the same keys as a tab strip.

- **The Lens as the one loader (DS-6.5, DS-14.4)**: Dario asked for a small animation where Lookout waits; a mark of Lookout's own, looking, says "Lookout is fetching this" where a generic spinner says only "busy", and one loader everywhere is one thing to learn. It orbits only while a wait lasts, and a wait that lasts gets words and a hint (DS-6.1), so it never runs on its own like DS-10's pulse.
- **Words name the source** (DS-6.6): "Reading from GitHub…" tells you whom you're waiting on, and that a slow wait isn't Lookout's fault.
- **Links as counts (DS-21, option A)** (Dario, 2026-11-06): the shortest rows, every kind the same five parts, and you stay on the Session you're reading, which a detail view (option B) wouldn't let you. If you open a Task's Sessions count most of the time, B is the next step for Task and PR. Topics keep their view.
- **Grey changes on the row (DS-22.2)**: the size of a Session's change helps you choose which to review next, so it stays, grey; read as a diff, in the status line and the list, it keeps its colours.
- **Exceptions lead the line (DS-22.3)**: you read a line from its start, so what needs you is first, and it has words or an icon as well as colour, never colour alone (DS-3).

## Changelog

- 2026-10-31: DS-4.5 added: a view in the main pane that throws (TOPIC-7's graph, reading a server without Edges) blanked the whole app; `ViewErrorBoundary` holds the failure to the main pane and clears it on a route change, without remounting the pane (a `key` would lose a Codex Session's open dialogs when its id arrives, VIEW-5.6).
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
- 2026-10-30: Added DS-2.4 (Productive's palette as a colour family, used only by a Task's status dot) and DS-8.5 (`Avatar`, the one `<img>`), for WORK-2.12 and WORK-3.8, decided in [0012](../../decisions/0012-task-status-dots-and-author-avatars.md). Built the same day: both ticked, the spec Done again.
- 2026-10-31: Added DS-2.5 (`diff-added-text` and `diff-removed-text`, a colour family used only by the DIFF spec's Changes count and list). The spec is In Progress again until it's built.
- 2026-10-31: DS-2.5 built and ticked (contrast on the background, the sidebar, every row state, the status line and the popover, in both modes); Done again.
- 2026-11-02: Added DS-13 (`SideNav` for sub-pages, `Tabs` for one thing in parts, both guarded) from Dario's request for Settings in sections (Backlog) and the Topic view in tabs; Dario chose sub-pages for Settings and tabs for a Topic. In Progress until built.
- 2026-11-02: DS-13.1 to 13.3 built and ticked (`ui/side-nav.tsx`, `ui/tabs.tsx`, the guard in `design-system.test.ts`); DS-13.4 waits for Dario's look. Found while building: Vitest 5's on-disk module cache (`fsModuleCache`) keyed the guards' `import.meta.glob` by the guard file's own text, so the colour guard had kept an old file list and passed while newer files broke it; the cache is off (`vitest.config.ts`). The focus rings it then found are pinned; TopicGraph's selected node, drag line and handle in Primary, the Topic view's new-activity dot in Primary, and the Subagents popover's Busy and Idle text are not, and failed it; Dario decided them the same day (Key decisions): the graph's selected node and the new-activity dot are `foreground`, drawing an Edge stays Primary (DS-12.4 amended), and the popover is listed under Busy and Idle.
- 2026-11-02: DS-3.3's quoted usage label follows USAGE: "stale · …".
- 2026-11-03: The `ok` family also marks a Done Session: its row's Done chip (SIDE-2.17, the Chip's `ok` tone) and its Done card in the chat (VIEW-5.17).
- 2026-11-04: Added DS-14, Lookout's own mark, the Lens (Plan item 36, decision 0014): `LookoutMark` and a new favicon without amber. Dario chose the Lens from five concepts. Built the same day: `ui/lookout-mark.tsx`, the favicon, the guard's exception (`icons.test.ts`), tests in `shared.test.tsx` (DS-14.1, DS-14.2); seen in Chromium in both modes at 1440 px with the server's build. DS-14.3 waits for Dario's look.
- 2026-11-04: DS-2.5 gains two tints for the Spec view's added and removed clauses (PLAIN-1.6), with their contrast in DS-2.5's test; the diff family's guard row lists `SpecView.tsx`.
- 2026-11-05: Added DS-15, one scroll bar (Dario: the Spec view's, a single Topic's and the graph's scroll bars had a border the chat's doesn't). VIEW-1.16's `scrollbar-blend` utility moves to the base layer's `*` rule, so every scroll area has it, and a guard test fails on any other scroll bar styling. Built the same day; DS-15.2 waits on Dario's look.
- 2026-11-05: Added DS-16, one labelled action per row (Plan item 39, Dario's choice of option A from three drawn on a canvas; every question as recommended): the first action labelled, with `↵`, the rest in a "More" menu grouped run, open elsewhere, Topics, then managing after a divider, with their existing keys. Amended for it: WORK-2.10, WORK-3.6, WORK-6.5, HIST-3.6, LIB-3.4, LIB-3.6, TOPIC-3.4 and PLAIN-5.1. DS-7.4's spacing still holds around the one line.
- 2026-11-05: DS-16 built: `RowActions` in `ui/row-actions.tsx` (the old `RowActions` in `icon-button.tsx` is gone), on Radix's dropdown menu with `modal={false}` and new `DropdownMenuSub…` parts; Work, History, Library and the Topics tab draw their expanded rows' actions through it, "Add to Topic" as a menu item (`useAddToTopicItem`), Specs as a submenu (`PrSpecsList`). Settled in building: the menu and a submenu are named for their row ("More for <row>", "Specs in <repo> #<n>"); picking an item first gives focus back to the panel's list, so a dialog it opens (the Topic picker, Archive, Delete) returns focus there; a submenu the panel opens with the menu (`S`) takes focus once the menu has, and focus moving to the menu around it doesn't close it; "Copied" (LIB-3.4) shows on the expanded row too, since the menu that was clicked has closed. Ticked DS-16.1 to 16.4 on `row-actions.test.tsx` and the guard (`design-system.test.ts`); the row tests and Behaviour tests read the menu. DS-16.5 waits on Dario's look.
- 2026-11-05: DS-16.3 amended from Codex's review of DS-15 and DS-16: "More" opens on a click, not Radix's press, so a click from assistive technology opens it and a slow double click's second click is ignored by its count; the Topics tab's first action and "More" are in the Tab order, as its old buttons were, with focus back on "More" after the menu or a dialog from it; a Specs submenu closes again when focus moves to another item. The guard (DS-15.1) also catches inline `scrollbarWidth`-style styles.
- 2026-11-05: From Codex's second round: the Topics tab's Archive and Delete dialogs, which have no trigger, give focus back to what had it when they opened ("More", or the Topic view's header button). Found while testing it: a key in a dialog a row opened reached the Topics list and the right sidebar through React's tree, so Esc cancelling Archive also collapsed the Topic; both now ignore keys from outside their own DOM.
- 2026-11-05: Added DS-17, where one row ends (Dario: rows in History, and the other tabs, looked too flat to tell apart). Drawn as three options on a canvas (hairlines; cards; day groups and more space); Dario chose hairlines for every right-sidebar list with day groups on top for History and Library (HIST-2.12, LIB-2.1), and answered six questions as recommended: one shared rule for all four tabs; lines only between two rows, from the title's edge, none under a heading or touching the selected row, 2 px more padding; History's day groups only without a query, since a search is best match first; Library's day words ("Today", "Yesterday", the date) without a count, since a day can span two pages; headings that scroll with the list, since a pinned one could cover the selected row; titles and snippets as they are.
- 2026-11-05: DS-15.2, DS-16.5 and DS-17.3 ticked: Dario looked and confirmed all three.
- 2026-11-05: DS-13.4 and DS-14.3 ticked: Dario checked and confirmed them.
- 2026-11-05: The colour guard's diff family lists `ChatRail.tsx` (a Module's added and removed changes as Marks, PLAIN-8.5) and pins `SpecView.tsx`'s bars (`before:bg-diff-added-text`, `before:bg-diff-removed-text`, PLAIN-8.3). A rewritten clause's bar and Mark are `muted-foreground`: no third diff hue, which would read as a Status (DS-3.6).
- 2026-11-05: DS-1.1 amended for PLAIN-9: two steps for a long document read whole, `reading` (16 / 26 px) and `reading-title` (20 / 28 px), used by the Spec view's Module only. The UI's own levels stay the five they were; a Module of 1,200 lines is read like a book, not scanned like a row (Dario, 2026-11-05, from the canvas https://claude.ai/artifact/1B7FmUEyqXzR2WoUGBmQrD).
- 2026-11-05: DS-1.1's `reading` steps serve the chat's prompts and replies too (VIEW-11.1).
- 2026-11-05: The colour guard's Busy family lists `SessionItem.tsx`: a sidebar row's running Subagent count is in `busy-text`, as the status line's (SIDE-9.7, VIEW-8.1), a meaning its Status spec ties to Busy (DS-3.6). It keeps 4.5:1 on every row state (SIDE-3.11).
- 2026-11-05: Added DS-2.6, the `spec` family (`spec`, `spec-text`), a violet for a `.plain` Module's row in DIFF's list (PLAIN-3.4); guarded, with its contrast measured.
- 2026-11-06: MEM's breakdown drops its sparkline (MEM-3.3), so `MemoryLine.tsx` leaves the icons guard's chart files.
- 2026-11-06: Added DS-12.8 (Primary marks where your keys are, in `ring`, and your prompts' Marks, in `primary`) and DS-3.8 (a question's Mark is amber only while it waits), for SIDE-11 and VIEW-1.21 (Plan item 45, the clarity pass's ideas 2 and 7). The spec is In Progress again until they're built.
- 2026-11-06: Added DS-18, buttons by role (Plan item 46, the clarity pass's idea 4, decided by Dario): five roles, a new `primary-text`, three heights named by place, at most one Primary per surface, End Session visible as `danger` after a divider, one icon per action from `lib/actions.ts` (menu items included), and a guard on how a button is built. Non-goals no longer leave buttons out.
- 2026-11-06: DS-18 grilled with Dario, eight questions, every one as recommended: the role and size names; `body` text at 28 px, headers included; Soft in `primary-soft` with `primary-text`; Danger as red text after a divider, a red fill only in its confirm; a surface is a view, a dialog or a form with its own Save; a row's More is `quiet`; the action table's five icon changes; Markdown's Copy becomes a `Button` and the other hand-made buttons are listed with a reason.
- 2026-11-06: Added DS-19, one anatomy for details popovers (Plan item 47, the clarity pass's idea 5, decided by Dario): Memory's pieces move to `ui/details.tsx` as they are, Usage is rebuilt from them (USAGE-2.3 to 2.8), age formatting lives only in `lib/time.ts`, and the guard checks hand-written uppercase labels and bars. DS-3.2's last sentence amended: the usage details popover's bars become meters with the same level edge.
- 2026-11-06: DS-19 and USAGE-2.3 to 2.8 grilled with Dario, seven questions, every one as recommended: the verdict names the worst window ("getting close", "nearly used up", "used up", "and 1 more"); its age is the oldest provider's, each section keeps its own; three tiles, Claude Code, Codex and Jev; the strip's wording follows the one age formatter; a tile's last line wraps (MEM-3.10); the guard's scope as drafted; Jev's details as rows.
- 2026-11-06: Added DS-20, one of a few ways to show the same thing (Plan item 48, the clarity pass's idea 9): `Segmented`, Work's Show filter's look as a `radiogroup`, for it and the Spec view's view switch (PLAIN-10), with guard check 11.
- 2026-11-06: DS-20 grilled with Dario with PLAIN-10, as recommended: one `Segmented`, a `radiogroup` with `Tabs`' keys, for the Spec view's switch and Work's Show filter. Plan item 50's requirements become DS-21 and DS-22.
- 2026-11-06: Added DS-6.5 to 6.9 and DS-14.4, loading that's alive (Plan item 49, the clarity pass's idea 10, widened by Dario to every wait): the orbiting Lens in `Loading`, words for each place's wait (UX "Loading words"), the hand-made waits onto `Loading`, an earlier hint where a wait becomes a failure, and guard check 12. Found while writing it: the chat's skeleton pulses and the Starting view's spinner turns under reduced motion.
- 2026-11-06: DS-6.5 to 6.9 and DS-14.4 grilled with Dario with LAUNCH-7, every question as recommended: one loader, the Lens, in every `Loading`; the words name the source ("Reading from GitHub…"); check 12 fails motion without `motion-safe:` too.
- 2026-11-06: Added DS-21, one anatomy for an expanded row, and DS-22, quiet rows, loud exceptions (Plan item 50, the clarity pass's ideas 8 and 3, decided by Dario: option A, links as counts; fixed columns, grey changes, exceptions in colour and words): `ui/row-details.tsx`, UX "Expanded rows" and "Quiet rows", guard checks 13 and 14.
- 2026-11-06: DS-21 and DS-22 grilled with Dario, seven questions, every one as recommended: the memory flag at 1 GB in 10 minutes, or 30 MB under warn or critical pressure (recorded 13:20 to 13:40: 37 of 84 readings of two working Sessions over 30 MB, from +58 to +892 MB, none at 1 GB; one constant, raised to 1.5 GB if it flags working Sessions); a canvas of a quiet row and an expanded row at 280 px, light and dark, before any code; the four marks lead the second line; the first count opens when it holds three or fewer; the title whole; a Topic view keeps its member chips; History says only when a Session can't be resumed, a wider diff grows its own row's column, a single Linked PR stays on the Task's state line.
- 2026-11-06: DS-18.1 to 18.7 built (Plan item 46): `Button`'s variants are the roles (`secondary` by default) and its sizes `line`, `default` and `form`, the unused `icon…` sizes gone; `primary-text` in `index.css`; `lib/actions.ts` with `ActionIcon`, and `RowActions`' first action and `RowMenuItem` take an `action` id; `ButtonDivider` (`ui/button.tsx`) before End Session and a Topic view's Delete; the labelled look's hand-made buttons (Topic view, Spec view, Recommendations, the Topics tab) and Markdown's code Copy are `Button`s; Suggest's and a recommendation's Accept are `soft`; `ActionIcon` counts as an icon for DS-7.2. Guard check 9 lists 27 hand-made buttons with their reasons and two hand-sized ones (a permission prompt's wrapping choices, the Output Type filter's chips). DS-18.8 waits for Dario's look.
- 2026-11-06: DS-18 review fixes: Suggest, "Suggest Topics" and a summary's Summarize draw `Sparkles` (Suggest's through `ActionIcon`), the Archive dialog's and End Session's confirms their action's icon; guard check 9 also reads a label written as strings in an expression, `size-` and any variant prefix, and an icon sized by hand inside a Button; a soft Button's hover is `primary/30` in dark mode; a Topic view's Delete keeps its divider when the row wraps. A past Session view has no Resume button (resuming is History's row), so DS-18.4's clause has nothing to apply to yet.
- 2026-11-06: DS-6.5 to 6.8 and DS-14.4 built (Plan item 49): `LookoutMark orbiting` turns its dot in a group with `animate-orbit`, defined in `index.css` only inside `prefers-reduced-motion: no-preference`; `Loading` draws it before its words and takes `size`, `hintAfter`, `title` and `live`; every place says the table's words, and the main pane with nothing selected, before Fleet's first list, says "Looking for Sessions…", as the Sessions list does; the skeleton's bars are `SkeletonBar` (`Chat.tsx`), pulsing under `motion-safe:`; a Topic member's state, Suggest's preview line and the Sessions list's two waits are `Loading`s; Work's section header names its source. Guard check 12 (`design-system.test.ts`, "waits") lists Work's `Ci` and the two Refresh buttons, and only `WorkPanel.tsx` may import a loader; a test pins the orbiting Lens to `Loading`, the Starting view and a Starting row. Check 12 reads `ui/loading.tsx` too and follows a loader imported under another name. DS-6.9 waits for Dario's look.
- 2026-11-06: DS-20.1 to 20.3 built (Plan item 48): `Segmented` (Technical approach), Work's Show filter and the Spec view's view switch on it, and guard check 11 (`design-system.test.ts`, "one of a few"), which pins one radio group each to `ui/segmented.tsx` and `Launcher.tsx`. The colour guard's Primary row lists `segmented.tsx` for its focus ring, as `tabs.tsx`'s; check 9's hand-made buttons lose Work's filter and gain the Spec view's fold line (PLAIN-10.5). The shortcuts list's ←/→ entry is "Switch tab or view" (SIDE-7.4).
- 2026-11-06: DS-19.1 to 19.3 built (Plan item 47): `ui/details.tsx` (Technical approach), Memory's popover drawn from it with its classes (one test reads them against the old ones), Usage rebuilt from it (USAGE-2.3 to 2.7), the chat's question headers and res's queue label as `SectionLabel`s, `lib/usage.ts`'s two age formatters gone, and guard check 10 (`design-system.test.ts`, "details popovers"). Decided in building: a `Meter`'s level edge is set off by a 1 px gap in the popover's colour, measured 3:1 or more against the fill in both modes, as the strip's is in the sidebar's; `Verdict` takes an `id`, so Usage's popover is named by its verdict (USAGE-2.3); a line of "Worth a look" carries its whole text in its tooltip; the colour guard's info row lists `ui/details.tsx` for a verdict's old age. Review, one Opus round (one major, four minors): the gap tests read `BAR_EDGE_GAP`'s classes off the strip's bar and a meter, and the fill's contrast is measured on the popover too; check 10 reads CSS for `uppercase` (`@apply`, `text-transform`). Kept, by decision: res's queue label is a `SectionLabel`, a flex `h3` with its words in a span that looks as the plain `h3` did, since DS-19.2 allows `uppercase` nowhere else; the bar check reads the classes written in a `className`, so a bar built from a constant isn't seen.
- 2026-11-06: DS-3.8 and DS-12.8 built (Plan item 45): the colour guard pins `ChatRail.tsx` to `bg-primary` (your prompts' Marks) and `Shell.tsx` to `bg-ring` (the keys' edge, its one class); a test reads `ChatRail.tsx`'s one `bg-needs-you` as the true side of `waiting ? … : 'bg-muted-foreground'` under `kind === 'question'`, and `waiting` as the Mark's pending question.
- 2026-11-09: DS-21.1 to 21.4 and DS-22.1 to 22.4 built (Plan item 50) and ticked. DS-21: `ui/row-details.tsx` (Technical approach) and its tests; Work's Task and PR, History's result, the Library's Output and the Topics tab's Topic are built from it; guard check 13 (`design-system.test.ts`, "expanded rows"). Decided in building: a Task's PR line opens it on GitHub, a PR's Task line opens it in Fantastic and a Topic's line opens the Topics tab on it (TOPIC-2.5); a past Session's line in Work says its age; "Show source file" opens the folded source in VS Code (VIEW-1.17), left out for a Markdown source, whose "Open file" already does; "newer than published" is words in the row's grey, not amber, as it isn't urgent; History's search snippet leads an expanded result's summary (HIST-2.3). The canvas (https://claude.ai/artifact/7Q6cYN6tM3g6hSTrRHXREA) drew two labelled buttons on a row, which DS-16 doesn't allow; Dario caught them not fitting at 280 px, and it's redrawn with one action and More. DS-22: three fixed columns, grey changes (`ChangesCount quiet`), the marks first, `runsAway` (`shared/memory.ts`) for MEM-4.1's threshold, and `QuietRows.test.tsx` (check 14). DS-21.5 and DS-22.5 wait for Dario's look.
- 2026-11-09: Item 50's review, Opus, round 1: one major, fixed: the Library's state line was out of a screen reader's reach, its row being named by its own label, so it's in the row's description now (`<id>-state`). Minors, fixed: MEM-1.4's count follows MEM-4.1's mark (`runsAway`); an expanded Topic keeps what happened last on its state line (TOPIC-3.8, TOPIC-3.4 amended); the first count opens when its links arrive after the row expanded, until a count is pressed; a Library hit in the path stays marked in an expanded row's summary (LIB-2.4).
- 2026-11-09: DS-6.9, DS-18.8, DS-19.4 and DS-21.5 checked by Dario in the running app and ticked; DS-22.5 still waits for his look.
