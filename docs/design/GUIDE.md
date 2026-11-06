# Design guide

How to build each piece of Lookout's UI. Read it before any UI change ([0015](../decisions/0015-design-guidelines-by-task.md)).

- **This guide is how.** The design system spec ([DS](../features/design-system/SPEC.md)) is the record of what and why, and the guards in `web/src/test/design-system.test.ts` and `icons.test.ts` enforce it. Every rule here links the requirement that holds it; nothing here is a requirement of its own.
- **Find your task below**, open the component it names, and copy its nearest use. If no entry fits, the nearest sibling decides (principle 6), and the new pattern gets an entry here in the same change.
- **Coming** marks a rule Dario has decided whose requirement isn't written or built yet, with its Plan item. Follow it in new code; don't migrate old code ahead of its spec. When the spec is written, its requirement IDs replace the Plan item.

Tokens live in `web/src/index.css`, components in `web/src/components/ui/`, decisions in [0008](../decisions/0008-lucide-icons-only.md), [0009](../decisions/0009-one-design-system-guarded-by-tests.md), [0012](../decisions/0012-task-status-dots-and-author-avatars.md), [0014](../decisions/0014-the-lens-lookouts-own-mark.md) and [0015](../decisions/0015-design-guidelines-by-task.md).

## Principles

1. **Colour means Status; amber means act on it.** A Status colour marks a Status and nothing else. Amber is Needs you (now) or a warning level (soon). Staleness is grey Info. (DS-3)
2. **Primary is you and your next step.** Indigo marks what you act on and what you wrote, and a surface has at most one Primary button. A selection, a link, a Chip or a Status is never Primary. (DS-12.4, DS-18.4)
3. **One name per thing, the same on every surface.** A Session has one name in the Session sidebar, its header, History and Work; a concept has its Glossary term. (Glossary, SIDE-10)
4. **Routine values are quiet; exceptions get colour and words.** A number in its usual range is in the row's quiet colour. Past a threshold it takes its level's colour and an icon or words, never colour alone. (DS-3.2, DS-3.5; coming: DS-22)
5. **Where your keys go is always visible.** Nothing takes focus by itself, and the column that has the keys shows it. (DS-9; coming: SIDE-11)
6. **Copy the nearest sibling, or extend the system first.** A new surface takes its anatomy from the closest one that exists: Memory's popover for a details popover, a Work row for a row. A piece the system lacks goes into `components/ui/` and this guide in the same change. (0009, 0015)
7. **One action, one icon.** An action shows the same icon on its button, in a menu and in the shortcuts list. Opening something inside Lookout and leaving Lookout have different icons. (0008, DS-18.6)
8. **Labels next to icons**, unless the icon is universal (close, search, more). A tooltip doesn't replace a label. The right sidebar's icon tabs are the one exception today.
9. **Sizes come from steps.** Type from the scale (DS-1); icon buttons 24 or 28 px (DS-7); icons 14 or 16 px, 20 px only in a labelled row button (DS-7.4); buttons 24, 28 or 32 px (DS-18.3). Nothing in between.

## By task

### A button

- **Use** `Button` (`ui/button.tsx`) for a word, with or without an icon; `IconButton` (`ui/icon-button.tsx`) for an icon alone; `RowActions` (`ui/row-actions.tsx`) for an expanded row's actions.
- An `IconButton` is `sm` (24 px) inside a line or row, `md` (28 px) in a column's header or a toolbar; its name is required and its tooltip says the same, with the key when it has one. An expanded row has one labelled action, the one Enter runs, and "More" for the rest.
- **Roles (DS-18.1):** a button's `variant` is its role, and its role sets its look; `secondary` is the default:

  | Role | Looks | For | Limit |
  |---|---|---|---|
  | Primary | indigo fill | the action the surface exists for: Send, Start, Submit, Save | one per surface |
  | Soft | `primary-soft` fill, `primary-text` label and icon | the next step in a dense place: a row's Enter action, a past Session's Resume | one per row |
  | Secondary | outline | a real alternative: Stop, Cancel, Review | |
  | Quiet | ghost | frequent, low-stakes actions in headers and toolbars: Add to Topic, More, Copy | |
  | Danger | red text and icon | End Session, Delete: visible where you use it often, last in its group, behind a `ButtonDivider` | a red fill (`destructive`) only in its confirm |

  Sizes, named by place (DS-18.3): `line` (24 px) inside a line of text, a card's line or the status line, `default` (28 px) in headers, rows, panels and toolbars, `form` (32 px) in dialogs and Settings' forms. End Session sits last in the header, after a divider (DS-18.5). An action's icon and word come from `lib/actions.ts` (DS-18.6): a row's first action and a menu item name their `action`, and a `Button` draws `<ActionIcon id>`.
- **Do:** pick the role by what the action is for, then the height by where it sits.
- **Don't:** set a height, padding or text size in a Button's `className` (`<Button size="sm" className="h-7">`); copy a button's look onto a hand-made `<button>`.
- **Guard:** DS-7.2 (icon buttons), DS-12.4 (Primary's places), DS-16.4 (row actions), DS-18.7 (no height, padding or text size in a Button's `className`; the red fill only in a confirm; a hand-made `<button>` only where the list says why; one icon per action, menus included).

### A details popover

What opens from a reading to explain it: Memory's and Usage's, from the sidebar's footer.

- **Use** `Popover` (`ui/popover.tsx`), `w-[22rem] p-0`, and build it as Memory's (`MemoryLine.tsx`), top to bottom:
  - a **verdict line**: a dot in its level's colour, the verdict in words ("The Mac has room"), and the reading's age at the right ("3s ago", or "stale · 3s" in `info-text`);
  - **tiles**: up to three, each a label, a value and a line under it;
  - **Worth a look**: a box listing what's past a threshold, in words, or nothing at all;
  - **sections**: each under an uppercase section label (below), its rows with thin 4 px meters.
- **Coming (DS-19):** these pieces move into `components/ui/details.tsx` as they are (`Verdict`, `Tiles`, `WorthALook`, `SectionLabel`, `Meter`), and Usage is rebuilt from them, keeping its reset line under each bar and its monochrome logos.
- **Do:** start from Memory's popover and drop the parts you don't need.
- **Don't:** invent a new header, a bar height or a way of saying "critical".
- **Guard:** none yet. Coming (DS-19): a bar or track drawn outside the meter piece fails, and so does an uppercase label written by hand.
- **See:** MEM-3, USAGE-1, DS-3.2.

### A list row

A row of the right sidebar's lists (Work, History, Library, Topics); the Session sidebar's rows follow SIDE-3.

- **Use** `data-slot="row"` on the row and `data-selected` while it's selected: the hairline between rows comes from one rule in `index.css`. Rows have 7 px of padding above and below and no gap. A Session's marker is a `SessionMarker`. An expanded row's actions are `RowActions`.
- A selected row is neutral (`sidebar-accent` and its ring, SIDE-3.9), never Primary.
- **Coming (DS-21, DS-22):** an expanded row is built from `ui/row-details.tsx`, in one order: title, state, summary, links, actions last; its title is whole; its links are counts that list in place, three at most, each link drawn as one line; facts you rarely need go into More or a tooltip. A Session row's numbers sit in three fixed columns and are grey; an exception leads the second line in its colour, with an icon or words.
- **Do:** let the row's parts come from the shared pieces, so the row reads like its siblings.
- **Don't:** draw a border, margin or card between rows; give an expanded row a second labelled button.
- **Guard:** DS-5.1 (markers), DS-16.4 (row actions), DS-17.1 (row marks and padding); coming: DS-21.4, DS-22.4.

### A number with a level

Context usage, a usage limit, memory and CPU load, a PR's age.

- **Levels:** none below the threshold; `warning` and `warning-text` heading toward a limit; `destructive` and `destructive-text` at a critical level. Each number's thresholds live with its helper: `contextLevel` (40% and 60%), usage (80% and 95%), `lib/memory.ts`, a PR's age (WORK-3.5).
- **A bar:** the fill is `foreground/55` at every level; the level is a 3 px edge at the fill's end, with the triangle or the octagon and words beside it (DS-3.2).
- **Do:** say the exception in words ("Codex's weekly limit is used up"), next to the colour.
- **Don't:** tint a whole fill; show a level in colour alone; use a Status colour or Needs you's amber for a level.
- **Coming (DS-22.2):** a Session sidebar row's Changes count is grey, and the diff colours stay in the status line and the changed-files list. Memory's amber is for a Session running away (MEM-4.1), not for one that works.
- **Guard:** DS-2.3 (each family in its files and classes), DS-3.6.

### A notice or an error

- **Use** `Alert` (`ui/alert.tsx`): tone `error` or `info`; layout `box`, at the top of its panel, with a title, a detail and a command or button, or `inline`, a `meta` line beside what it's about.
- An error says what failed, why, and what to do; a command to run is a `CommandBlock`. Info is staleness, or something to know that needs nothing from you.
- **Do:** keep the words the place had before (DS-4.3) when you move it onto `Alert`.
- **Don't:** write `role="alert"` by hand; draw a red or grey box; make an amber notice (amber is a Needs you card or a level); show a failure as an `EmptyState`.
- **Guard:** DS-4.2.

### A loading or an empty state

- **Use** `Loading` (`ui/loading.tsx`) for every wait: the orbiting Lens, then what it reads or waits for at once ("Reading from GitHub…", never "Loading…" alone), the seconds from 3 s, and a hint from 15 s when the place has one, sooner where a wait becomes a failure (DS-6.5 to 6.7, the words in DS's UX "Loading words"). A skeleton only where the layout is known (the chat's, the Starting view's), with a `Loading` under it (DS-6.2, LAUNCH-7.2).
- **Use** `EmptyState` (`ui/empty-state.tsx`): a title, a hint, an optional icon and action. It says what would fill the place and offers that action ("No Sessions running" with Start a Session).
- **Do:** show a wait in the layout of what will arrive, as the Starting view shows the Session with your first prompt (LAUNCH-7).
- **Don't:** a bare "Loading…", a spinner, or motion that ignores reduced motion. A button's own word while its action runs ("Sending…") isn't a wait.
- **Guard:** DS-6.8.

### A section heading

| Level | Looks | Where |
|---|---|---|
| Page title | `title`, semibold, in the view's `h1`; a dialog's `DialogTitle` | a view's header, Settings, a dialog |
| Column section | `title`, semibold, sentence case | Work's Tasks and PRs, the Session sidebar's Needs you and View only |
| Group in a list | `caption`, medium, `muted-foreground`, sentence case | a day in History and Library |
| Section label | `caption`, medium, uppercase, `tracking-wide`, `muted-foreground`; a total at its right in normal case | a section of a details popover ("Who uses it"), a question's header |

- **Don't:** add a fifth level, or make body text bold to act as a heading.
- **Guard:** none yet. Coming (DS-19): the section label is a `ui/` piece, and `uppercase` written elsewhere fails.

### A time ago

- **Use** `formatAge` (`lib/time.ts`): `12s`, `5m`, `3h`, `2d`, and `useNow` or `useClock` so it keeps time.
- **Rule:** in a row's column, the age alone, `tabular-nums`, in the row's quiet colour (`5m`); in a sentence or as a reading's age, `5m ago`; a stale reading, `stale · 5m` in `info-text`.
- **Don't:** write another age formatter, or "just now": a reading a few seconds old says `12s ago`.
- **Coming (DS-19):** `lib/usage.ts`'s two formatters (`formatAgeAgo`, `formatAgeShort`) go when Usage takes Memory's wording.
- **Guard:** none yet. Coming (DS-19): no age formatter outside `lib/time.ts`.

### A keyboard shortcut

- **Use** the one shortcuts list, `SHORTCUTS` in `lib/shortcuts.ts`: every shortcut is an entry there with its group, keys and label, and the Keyboard shortcuts dialog and the empty views list it from there (SIDE-7.4). A key is a `Kbd`, and a sentence is never a key (DS-8.4).
- A button with a key says it in its tooltip (DS-7.1); a menu item shows it at its right (DS-16.2).
- **Coming (SIDE-11, VIEW-3.12):** nothing takes focus by itself, a search box or a list included; the column that has the keys shows a `ring` edge along its top; the hint line under the composer names who has the keys, from the shortcuts list.
- **Don't:** handle a key that isn't in the list; give a field focus on load.
- **Guard:** SIDE-7.4 (every entry pressed by a test), DS-8.4 (`<kbd>` only in `kbd.tsx`).

### An icon

- **Use** `lucide-react`, sized and stroked like its neighbours, coloured with tokens (0008). Only the listed shapes draw their own: `StatusMarker`, the chat rail's Marks, `TaskStatusDot`, `Avatar`, `HarnessIcon` and `LookoutMark`.
- In a button, 14 or 16 px; 20 px only in a labelled row button.
- An action's icon comes from `lib/actions.ts`, the same on its button, in menus and in the shortcuts list (DS-18.6).
- **Don't:** emoji, a Unicode symbol, or a second icon for an action that already has one.
- **Guard:** 0008's icons guard, DS-7.2.

### A page in parts, or one thing shown a few ways

- **Use** `SideNav` (`ui/side-nav.tsx`) when the parts are separate places (Settings), `Tabs` (`ui/tabs.tsx`) when they're one thing seen in parts (a Topic). The open part is in the path.
- **Use** `Segmented` (`ui/segmented.tsx`) when it's the same thing shown two to four ways: the Spec view's Changes, Whole and Clean, Work's All, Tasks and PRs (DS-20.1). The chosen way is raised on `accent`, never Primary.
- **Do:** keep a state that isn't a way of showing (Viewed) out of the switch, after a divider (PLAIN-10.1).
- **Don't:** make one choice out of two checkboxes, or a row of pressed buttons.
- **Guard:** DS-13.3, DS-20.3.

## Before you ask for review

What no guard checks. A reviewer, person or agent, goes through it for every UI change.

- [ ] It copies its nearest sibling's anatomy, and the PR names which one.
- [ ] Routine values are quiet; an exception has colour and words.
- [ ] Each thing has the name it has elsewhere (Glossary, principle 3).
- [ ] Nothing takes focus by itself; it's clear which column has the keys.
- [ ] An icon alone is universal, or has a label.
- [ ] Seen in light and dark mode, at 1440 px and with the right sidebar at 280 px.
- [ ] A new or changed pattern has its entry here, and its guard where one can be written.
