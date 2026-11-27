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
5. **Where your keys go is always visible.** Nothing takes focus by itself, and the column that has the keys shows it. (DS-9, SIDE-11)
6. **Copy the nearest sibling, or extend the system first.** A new surface takes its anatomy from the closest one that exists: Memory's popover for a details popover, a Work row for a row. A piece the system lacks goes into `components/ui/` and this guide in the same change. (0009, 0015)
7. **One action, one icon.** An action shows the same icon on its button, in a menu and in the shortcuts list. Opening something inside Lookout and leaving Lookout have different icons. (0008, DS-18.6)
8. **Labels next to icons**, unless the icon is universal (close, search, more). A tooltip doesn't replace a label. The right sidebar's icon tabs are the one exception today; the rail's places carry their names under their icons (DS-24.1).
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
  | Secondary | outline | a real alternative: Cancel, Review | |
  | Quiet | ghost | frequent, low-stakes actions in headers and toolbars: Add to Topic, More, Copy | |
  | Danger | red text and icon | End Session, Delete: visible where you use it often, last in its group, behind a `ButtonDivider` | a red fill (`destructive`) only in its confirm |

  Sizes, named by place (DS-18.3): `line` (24 px) inside a line of text, a card's line or the status line, `default` (28 px) in headers, rows, panels and toolbars, `form` (32 px) in dialogs and Settings' forms. The Session header's actions are `IconButton`s (`md`, 4 px apart), End Session last, after a divider, in the `danger` role (DS-18.5); its Stop and Esc sit in the Status tag, as `StatusTagAction` (`ui/status-tag.tsx`, DS-18.9), so the actions never move when the Status changes. An action's icon and word come from `lib/actions.ts` (DS-18.6): a row's first action and a menu item name their `action`, and a `Button` draws `<ActionIcon id>`.
- **Do:** pick the role by what the action is for, then the height by where it sits.
- **Don't:** set a height, padding or text size in a Button's `className` (`<Button size="sm" className="h-7">`); copy a button's look onto a hand-made `<button>`.
- **Guard:** DS-7.2 (icon buttons), DS-12.4 (Primary's places), DS-16.4 (row actions), DS-18.7 (no height, padding or text size in a Button's `className`; the red fill only in a confirm; a hand-made `<button>` only where the list says why; one icon per action, menus included).

### A details popover

What opens from a reading to explain it: Memory's and Usage's, from the sidebar's footer.

- **Use** `Popover` (`ui/popover.tsx`), `w-[22rem] p-0`, and the pieces in `ui/details.tsx`, top to bottom, as Memory's (`MemoryLine.tsx`) and Usage's (`UsageStrip.tsx`) are:
  - `Verdict`: a dot in its level's colour, the verdict in words ("The Mac has room"), and the reading's age at the right ("3s ago", or "stale · 3s" in `info-text`); its `id` can name the popover;
  - `Tiles` and `Tile`: up to three side by side, or four in two rows of two (Evidence's Review tile, EVID-6.4), each a label, a value and a line under it, which wraps; a tile that opens something more is a `Tile` with `onClick`, a button with a chevron at its value's end (Evidence's Test files, EVID-5.4);
  - `WorthALook`: a box listing what's past a threshold, in words, or nothing at all;
  - sections: each under a `SectionLabel` (below), its rows `Meter`s, thin 4 px bars, the level as an edge.
- **Do:** start from Memory's popover and drop the parts you don't need.
- **Don't:** invent a new header, a bar height or a way of saying "critical".
- **Guard:** DS-19.2 (a bar or track drawn outside `Meter` and the usage strip's bar fails, and so does `uppercase` outside `SectionLabel` and the chat's message tag).
- **A row the reading leaves out:** list it after the rows that count, its name and numbers in `muted-foreground` (a `ChangesCount` `quiet`), and say why in its tooltip and accessible name ("a document, not counted"); the section's note counts both ("1 file · 2 documents"). Evidence's documents (EVID-7.4).
- **Two openers, one popover:** Evidence's opens from the status line and from the Done card (`SessionView.tsx`); one is open at a time, and Esc returns focus to whichever opened it (EVID-5.8).
- **See:** MEM-3, USAGE-2, EVID-5, DS-19, DS-3.2.

### A small form from a header action

A header's icon action that asks one thing before it runs, then waits on the Session: "Hand off…" (`HandOff.tsx`, HAND-1, HAND-2).

- **Use** `Popover` (`ui/popover.tsx`) on the action's `IconButton` (`md`, `data-[state=open]:bg-accent` while open), `align="end"`, `w-[22.5rem] p-3`, `gap-2.5`: a `body` semibold title naming the action, one field with its `meta` label and a `meta` line saying what happens, then Cancel (Secondary) and the action (Primary, `default` size, its `Kbd`). While it waits, `Loading` with what it waits for and Cancel; a failure, an `Alert` with Cancel and "Try again".
- A wait that outlives the popover shows on the button as a 6 px dot at its top right, ringed in `background`, in the colour its spec ties to it (HAND-2.2: Busy's blue while the Session writes, `ok` ready, `destructive` failed), its tooltip in words. Never a spinner (DS-6.8).
- **Do:** keep the wait in App, next to the composer's drafts, so closing the popover or switching Sessions keeps it.
- **Don't:** open a dialog for one field, or move focus anywhere but into the popover.

### A link to another Session in a header

What the header names besides the Session: "from <title>" and "Continued in <title>" (`HandoffLinks`, HAND-4), and the Topics it's in (`TopicHeaderLinks`, TOPIC-16.4), after them.

- **Use** a Quiet `Button`, `line` size, after the Harness's name: its icon, then its words, cut to fit (`min-w-0 shrink`, the words `truncate`); below 32rem of header the words go (`@max-[32rem]:sr-only`), as the Harness's name does, and the tooltip keeps them. Several Sessions are one link with a `ChevronDown`, opening a `DropdownMenu` of `SessionMarker`, title and `StatusTag` rows; several Topics are one "N Topics" link the same way, its rows a Topic's `SessionMarker`, title and, for an Archived one, "archived".
- **Don't:** colour it Primary or underline it: it's a way to another Session, not the next step.

### A line in a column's footer

A reading or a switch about the Mac, at the bottom of a column: the Memory line (and the Usage strip above it) in the Session sidebar, keep-awake in the right sidebar.

- **Use** `FOOTER_LINE_TRIGGER` from `ui/footer-line.tsx` (DS-23): a 28 px line with a top border, the muted wash and `caption` text, its icon at 14 px. The whole line is the trigger of what it opens: Memory's details popover, keep-awake's menu (`KeepAwake.tsx`). The menu opens upward, at the line's end (`side="top"`).
- Lines at the bottom of two columns sit level, so their top borders make one line across the window. A column too narrow for words, the closed right sidebar's rail, ends in the same 28 px line (`FOOTER_LINE`) holding the icon alone, as an `IconButton` (`sm`), pressed while what it switches is on (AWAKE-4.1).
- **Do:** say the state in words on the line ("Awake · 2 at work"), with an exception's note in the tooltip.
- **Don't:** add a third line to the Session sidebar's dock: its height is the composer's (SIDE-8.1).
- **Guard:** DS-23.1 (the line's border and wash only in `ui/footer-line.tsx`). No guard can check the alignment; its look is AWAKE-4.6.

### A part of the status line

What describes a Session, on the line under its composer (VIEW-5.5): where it works, what it changed, how the agent is doing.

- **Its end:** the left end is where the Session works and what it changed (repo, Worktree or branch, Changes, Evidence, a queued job, Local servers); the right end is how the agent is doing (Subagents, a background shell, the model and Effort), with the context usage and Compact at the right edge. What comes and goes sits at the seam, "N more" closing the left end.
- **Its rank (VIEW-5.19):** when the line runs out of room a part leaves whole, lowest rank first, into "N more"; what the Session is doing now outranks what it did, which outranks how it's set up. Only the Worktree or branch is cut. A new part names its end and its rank in `lib/status-fold.ts` and in its requirement.
- **Use** `PartSlot` in `StatusLine` (`SessionView.tsx`) for its place on the line; its component draws one button with a `look` (`ui/status-part.tsx`): on the line, a 24 px target in the line's `meta` text (DS-7.3), whole (`shrink-0`, `whitespace-nowrap`); as a row of "N more", `PART_ROW` with `PartRowContent` (its name, its value as the line shows it, then a chevron down for a menu, right for a list or popover, `ExternalLink` for a page in the browser, `ArrowRight` inside Lookout). A part that opens nothing is a `PART_ROW_STATIC` row. The row is the part's own component, so its menu, list or popover opens from the row.
- **Do:** give a part's words their own `data-subpart` when one of them can leave on its own (the files count, "from the next reply"), so the line measures it apart.
- **Don't:** truncate a part, or hide one below a width with a container query: give it a rank.
- **Guard:** VIEW-5.19's guard in `lib/status-fold.test.ts` (every `PartSlot` has an end, every part that can leave a rank, "N more"'s rows in the line's order); DS-18.7 lists each part's hand-made button. No guard can check the look; it's VIEW-5.20.

### A list row

A row of the right sidebar's lists (Work, History, Library, Topics, Bots, Setup); the Session sidebar's rows follow SIDE-3.

- **Use** `data-slot="row"` on the row and `data-selected` while it's selected: the hairline between rows comes from one rule in `index.css`. Rows have 7 px of padding above and below and no gap. A Session's marker is a `SessionMarker`. An expanded row's actions are `RowActions`.
- A selected row is neutral (`sidebar-accent` and its ring, SIDE-3.9), never Primary.
- **An Unread Session row (SIDE-13):** a 6 px round dot in the title's colour (`sidebar-foreground`) on the first line, after the title, its suffix and a Done chip and before the Harness mark, hidden from screen readers with "unread" in the row's name; the title semibold. A "new" mark is never Primary (DS-12.4) and never a Status colour: the marker and strip stay Idle's. TOPIC-13.2's new-activity dot is the same mark in the main pane, in `foreground`.
- **A ready Handover on its row (HAND-6.3):** the Hand off icon (`ActionIcon` `hand-off`, lucide's `Forward`), 12 px, in `ok` like an ok verdict's icon, after the Unread dot and before the Harness mark, 6 px from each (SIDE-15.4), its tooltip and its words in the row's name "Handover ready". Something waiting for you, so an icon, not a Status colour or a chip: the row stays its Status's.
- **A Session row's marks (DS-22.3):** what is running leads the second line: a queued job, Subagents running, a background shell, each with an icon, its words its accessible name, 8 px apart. Nothing that is wrong goes there.
- **What is wrong with a Session (SIDE-15):** one `warning` `Chip` after its title, never a mark on the second line: the most urgent Warning's 12 px icon and one word ("Memory", "Tests"), then "+1" for the rest, with every Warning in words in its tooltip and in the row's name. Beside it Done is its tick alone, the first of the line's end icons, which sit 6 px apart. A new Warning is a new entry in `lib/warnings.ts` (`warningsOf`), never a mark or a chip of its own. **Guard:** DS-22.4's component test (a Warning is in the chip and nowhere on the second line).
- **A Session row's second line must hold its numbers (DS-22.1):** the location gives way first, then each column gives back the room its value doesn't fill. Before adding anything to that line, add up its widths at 280 px: the line is 225 px and the columns take 134 px of it.
- **Coming (DS-21, DS-22):** an expanded row is built from `ui/row-details.tsx`, in one order: title, state, summary, links, actions last; its title is whole; its links are counts that list in place, three at most, each link drawn as one line; facts you rarely need go into More or a tooltip. A Session row's numbers sit in three fixed columns and are grey; what is running leads the second line with an icon and its count, and what is wrong is the first line's chip (SIDE-15).
- **A row's items waiting on you** (a Topic's recommendations, DS-21.2, TOPIC-9.4): on the row, a neutral `Chip` with an icon and the count ("3 recommended"); expanded, a count among its links, `eager`, so it's open whatever it holds; each a `RowLink` with `decide`, its reason under its name, its one action a Secondary `line` button and the rest under its own More. A line above the list says how many and where, with "Next". Never a list of their own above the rows: it grows with the pile and reads like the rows under it.
- **A Bot's row (BOT-1.2):** no leading icon; its name, with "running", "waiting on you" in `needs-you-text` or an "Off" chip at the right; under it its schedule in words and one fact, the schedule giving way first. A Bot that is off is dimmed while its row is folded.
- **A group that folds** (Setup's sources, SETUP-1.3): its line is a listbox option of its own, 32 px, a 14 px `ChevronRight` turned when open, the group's 14 px icon in `muted-foreground`, its name in `body` medium, its count in `muted-foreground` and a version in `meta` at the right. Its rows are inset under its name and set `--row-inset` to where their names start, so the hairline begins there. Enter, → and ← open and close it; a filter with text shows every group with a match open. Groups start folded where there are many (Everywhere), open where there are few and they are the content (This Session's files and memory, SETUP-7.1).
- **A list's closing line that switches the view** (This Session's "It also loaded… from Everywhere", SETUP-6.3): `meta` in `muted-foreground` with a trailing `ArrowRight`, a row's hover, and one of the listbox's options, so j/k reach it and Enter runs it; never a hand-made `<button>` in the list.
- **Do:** let the row's parts come from the shared pieces, so the row reads like its siblings.
- **Don't:** draw a border, margin or card between rows; give an expanded row a second labelled button, or a waiting item's line a Soft one.
- **Guard:** DS-5.1 (markers), DS-16.4 (row actions), DS-17.1 (row marks and padding); coming: DS-21.4, DS-22.4.

### A list in the left column that drives the main pane

The list of a place (NAV): the Session sidebar's, and the Inbox's (`InboxList.tsx`, INBOX-1). Selecting a row shows it in the main pane; the right sidebar's lists expand in place instead, because the main pane isn't theirs.

- **Use** the column's header cell for the filter (its `/` hint as the Session filter's) and its body for the list: a `Segmented` (`surface="sidebar"`, `fill`) when the list shows a few ways, then one `listbox` grouped by day (`byDay`, `dayLabel`), its rows the right sidebar's (`data-slot="row"`).
- The keys are the window's, as the Session sidebar's: ↑/↓ and j/k select and show, ⌘1–9 jump, `/` filters. They stand down while a dialog is open, in a text field, with focus in the right sidebar, and while another place shows (NAV-4.2).
- **A Report's row (INBOX-1.2):** the Library's row with SIDE-13's unread mark. Its 16 px icon says what it holds; a failed run's is the triangle in `destructive`, drawn once, with "failed" as its word; "waiting on you" is in `needs-you-text`. Everything else is quiet.
- **Don't:** expand a row in place here; give the list a second selected state; colour an unread mark.
- **Guard:** the colour guard's rows for `InboxList.tsx`. Its look is INBOX-1.6.

### A document shown in place

A file read in the main pane: what a Report holds (`ReportView.tsx`, INBOX-2.4), and any Markdown file, page or image opened from the Library, a Topic view or a path in the chat (`DocumentView.tsx`, DOC-2). Both draw it with `DocumentFile` (`DocumentFile.tsx`).

- **Use** `Markdown` (`reading`) in the chat's column for text, inside a focusable `role="region"` with `data-scroll-keys`, so the arrow keys scroll it. A page is an `iframe` that fills the pane on white, since a page brings its own colours, with the file route's `frame=1` URL (`framedFileUrl`, `lib/outputs.ts`), the same `sandbox` the route sends, and the document's title as its `title` (INBOX-2.9).
- What only a browser tab can show (a PDF, a Share, an Artifact without its source file) is a bordered card: its title, its Type, where it is, and one Primary "Open".
- Several documents are `Tabs` under the header, and only the open one is drawn.
- The Document view's header is Back (the quiet button Settings has), the file's name with its Type's icon, its Type word and folder under it, then Open and More; Open's icon says it leaves Lookout (DS-18.6). A row that opens a file here uses `open`, the icon for staying inside (`documentOf`, `lib/outputs.ts`).
- **Don't:** frame a page without the sandbox; frame another origin; read a file the server didn't list (DOC-3.1); open a Markdown file, a page or an image in VS Code or a tab from a row when the Document view shows it.
- **Guard:** INBOX-2.9's tests, in the server and the view, and DOC-3.1's for what the server reads. Their looks are INBOX-2.11 and DOC-2.7.

### A form that sets up a start

The launcher, and a Bot's dialog (`BotDialog.tsx`, BOT-2.1).

- **Use** the launcher's own fields from `LaunchFields.tsx` (Directory, Harness, Model with Effort, Skip permissions) on `FIELD_GRID`, with their rules in `lib/launch-fields.ts`. Never a second Harness choice.
- **A refusal beside its field (BOT-2.2):** an inline `Alert` in the grid's second column under the field, with `aria-invalid` and `aria-describedby` on the field, until that field changes. A refusal with no field is a box `Alert` above the buttons.
- **Several of a few** (a Bot's days): labels in a `role="group"` around visually hidden checkboxes, with `CHOSEN_LOOK`, the Harness choice's neutral chosen look. Not a `Segmented`, which is one of a few, and not pressed Buttons.
- **A dialog that edits:** "Esc to close · nothing is saved" at its foot, Save as its one Primary with the `⌘↵` `Kbd`, and focus back to what opened it.
- **A surface that can't save** (BOT-2.3, BOT-2.6): an `Alert` under its header saying why, and each disabled button's reason in its tooltip. A disabled `Button` takes no pointer, so the tooltip sits on a wrapping `span`; in a menu the reason is a `role="note"` line.
- **Guard:** DS-20.3 (the Harness choice only in `LaunchFields.tsx`), DS-18.7 (the red fill only in a confirm).

### A list that completes what you type

What a field offers while you type in it: the `/` list of the composer and of the launcher's prompt (VIEW-15, LAUNCH-8).

- **Use** `CommandList` (`ui/command-list.tsx`) inside `CommandsPopover` (`Commands.tsx`), with `useCommandList` (`lib/command-list.ts`) for when it's open, its highlight and its keys.
- The field keeps focus throughout. The list is a listbox the field owns (`aria-controls`, `aria-activedescendant`), in a `Popover` anchored to the field's box and as wide as it: upward from the composer, downward from a field in a dialog. It takes no room in the layout, and a press anywhere in it doesn't take focus: `CommandsPopover` prevents the popover's `mousedown`, since Radix makes a popover's content focusable.
- **The field closes it, never the popover:** its own `Esc`, and focus leaving it. Radix's closing on `Esc` and on a press outside is prevented, since Radix hears the key before the field does and the field would take the same `Esc` twice. Closed, it leaves at once, with no fade.
- **For a screen reader:** a row's id is its item's, not its place, so a new first row is said as you type; the listbox holds only rows, and what it says in their place sits above it, "nothing matches" in a status region that is there from the start.
- **A row:** 28 px, a listbox option as a picker's is, the highlighted one on `accent`. What picking types, in mono `body`; a hint in mono `meta`; the description in `meta`, the part that gives way; a mark as a 14 px icon with its words ("opens in terminal"); where it's from at the right. All but the first in `muted-foreground`. A match is a `Hit`.
- **Keys:** `↑` `↓` move, `Tab` or `Enter` pick, `Esc` closes the list before it does anything else. While it's open the hint line names them (VIEW-15.9), and each is an entry of the shortcuts list.
- **Do:** move the highlight to a row under the pointer only when the pointer itself moved; open it only for what was typed, never for text that came back by itself; say what it reads while it waits and that nothing matches when nothing does; type the pick into the field as one edit, so the field's own undo takes it back.
- **Don't:** give the list a filter of its own (that's a picker, `ui/picker.tsx`); highlight in Primary; send on a pick.
- **Guard:** none of its own beyond the colour and icon guards; `Commands.test.tsx` sends `Esc` as a browser does. Its look is VIEW-15.13.

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

### A place on the rail

One of Lookout's top-level places, on the rail at the window's left edge: the Inbox, Sessions, later People (NAV, [0017](../decisions/0017-one-app-for-both-roles.md)).

- **Use** `PlaceButton`, `RailCount` and `RailMark` (`ui/place-rail.tsx`, DS-24), put together in `PlaceRail.tsx`. A new place is an entry of `PLACES` in `lib/places.ts` with its name and its key, its icon in `PlaceRail.tsx`, and its routes in `placeOfRoute`.
- A place owns the left column and the main pane, nothing else: its list goes into the left column's header and body cells (the Inbox's through `Sidebar`'s `inbox`), and the right sidebar, the launcher and the dock are the same everywhere.
- The current place is where you are: `aria-current="page"` on the neutral wash, as a selected row. What waits in a place is a `RailCount` on its icon: neutral for what is new (unread Reports), Needs you's amber only for the Sessions that Need you (NAV-3.2).
- The rail's top holds places and nothing else; what isn't a place (Settings, Keyboard shortcuts) is an `IconButton` at its bottom.
- **Do:** add a place only when it has a page; give it the next digit as its key.
- **Don't:** colour the current place Primary; count something new in amber; give a place a right sidebar of its own.
- **Guard:** DS-13.3 (`aria-current="page"` only in `side-nav.tsx` and `place-rail.tsx`), DS-2.3 (Needs you's amber on the rail only in `place-rail.tsx`), DS-7.4 (the 20 px mark stays in `components/ui/`). Its look is NAV-1.4.

### A main-pane view's header

What sits in the header row of the main pane: a Session's, a Report's, a document's, a Topic's, Settings'.

- **Use** `PaneHeader`, or `PlainView`'s `header` for a view with no dock. The header row is 60 px in every view (SIDE-8.4): room for a `title` line with one line of facts under it in `meta` (`ReportView.tsx`, `DocumentView.tsx`, `TopicView.tsx`), and a one-line header (`SessionView.tsx`, `SettingsPage.tsx`) is centred in it, so the header line and the rail's buttons stay where they are from view to view.
- **Do:** keep a new header to two lines: the title, and at most one line under it, cut to fit (`truncate`), with the actions at the right.
- **Don't:** add a third line or taller padding to a header: the row grows for all four columns, and the line moves when you switch views. An archived Topic's closing line is the one header that does it.
- **Guard:** SIDE-8.4, a Behaviour test that measures the header line under a one-line header, a Topic view and a Report.

### A piece that changes with its column's width

A tab that drops its name, a header that folds its facts: something inside a column of the shell that shows less when the column is narrow.

- **Use** the width the piece is given when its column has one: the right sidebar's tab strip takes its `width` (`TAB_NAME_MIN_WIDTH`, BOT-1.6). Where there is none, a container query on a cell inside the column: `@container` on a `ShellCell`, a `PaneHeader` or a panel's own root, as the Session header's is.
- **Don't:** put `@container`, or any other containment, on a column of the shell (`SHELL_COLUMN`, a `ShellView`). Containment turns its subgrid off: the column lays its rows out by itself, and its header cell grows off the header line. The right sidebar's was 330 px tall for that, in the build of 2026-11-26.
- **Guard:** SIDE-8.3 (`Shell.test.tsx`: no subgrid is contained, in the page or where a column's classes are put together) and SIDE-8.4, a Behaviour test that measures the header line in a browser. jsdom lays nothing out, so only the second sees a height.

### A section heading

| Level | Looks | Where |
|---|---|---|
| Page title | `title`, semibold, in the view's `h1`; a dialog's `DialogTitle` | a view's header, Settings, a dialog |
| Column section | `title`, semibold, sentence case | Work's Tasks and PRs, the Session sidebar's Needs you and View only |
| Group in a list | `caption`, medium, `muted-foreground`, sentence case | a day in History and Library |
| Section label | `caption`, medium, uppercase, `tracking-wide`, `muted-foreground`; a total at its right in normal case | a section of a details popover ("Who uses it"), a question's header |

- **Don't:** add a fifth level, or make body text bold to act as a heading.
- **Use** `SectionLabel` (`ui/details.tsx`) for a section label.
- **Guard:** DS-19.2 (`uppercase` only in `SectionLabel` and the chat's message tag).

### A time ago

- **Use** `formatAge` (`lib/time.ts`): `12s`, `5m`, `3h`, `2d`, and `useNow` or `useClock` so it keeps time.
- **Rule:** in a row's column, the age alone, `tabular-nums`, in the row's quiet colour (`5m`); in a sentence or as a reading's age, `5m ago`; a stale reading, `stale · 5m` in `info-text`.
- **Don't:** write another age formatter, or "just now": a reading a few seconds old says `12s ago`.
- **Guard:** DS-19.3 (no function or variable named `format…Age…` or `…Ago` outside `lib/time.ts`).

### A keyboard shortcut

- **Use** the one shortcuts list, `SHORTCUTS` in `lib/shortcuts.ts`: every shortcut is an entry there with its group, keys and label, and the Keyboard shortcuts dialog and the empty views list it from there (SIDE-7.4). A key is a `Kbd`, and a sentence is never a key (DS-8.4).
- A button with a key says it in its tooltip (DS-7.1); a menu item shows it at its right (DS-16.2).
- **Where the keys are:** nothing takes focus by itself, a search box or a list included; a panel takes it only for a request (`focusKey` above 0, from your key or click). The column that has the keys shows `KeysEdge` (`Shell.tsx`), a `ring` line along its top, and the hint line under the composer (`KeysHint`) names who has the keys and their keys, from `hint()` in the shortcuts list (SIDE-11, VIEW-3.12).
- **Don't:** handle a key that isn't in the list; give a field focus on load.
- **Guard:** SIDE-7.4 (every entry pressed by a test), DS-8.4 (`<kbd>` only in `kbd.tsx`).

### An icon

- **Use** `lucide-react`, sized and stroked like its neighbours, coloured with tokens (0008). Only the listed shapes draw their own: `StatusMarker`, the chat rail's Marks, `TaskStatusDot`, `Avatar`, `HarnessIcon` and `LookoutMark`.
- In a button, 14 or 16 px; 20 px only in a labelled row button.
- In a `Chip`, pass it as `icon` (DS-8.3): 14 px before the word, in the chip's colour.
- An action's icon comes from `lib/actions.ts`, the same on its button, in menus and in the shortcuts list (DS-18.6).
- **Don't:** emoji, a Unicode symbol, or a second icon for an action that already has one.
- **Guard:** 0008's icons guard, DS-7.2.

### A page in parts, or one thing shown a few ways

- **Use** `SideNav` (`ui/side-nav.tsx`) when the parts are separate places (Settings), `Tabs` (`ui/tabs.tsx`) when they're one thing seen in parts (a Topic). The open part is in the path.
- **Use** `Segmented` (`ui/segmented.tsx`) when it's the same thing shown two to four ways: the Spec view's Changes, Whole and Clean, Work's All, Tasks and PRs (DS-20.1); five only for a kind filter that starts with All, Setup's (SETUP-1.2). The chosen way is raised on `accent`, never Primary.
- **Do:** keep a state that isn't a way of showing (Viewed) out of the switch, after a divider (PLAIN-10.1).
- **Don't:** make one choice out of two checkboxes, or a row of pressed buttons.
- **Guard:** DS-13.3, DS-20.3.

### A text beside another that explains it

- **Use** two columns in rows, as the Spec view's simplified side (PLAIN-14.8): the source at most 34rem on the left, the explanation at most 30rem on the right, sharing what's narrower 34 to 30, 2rem either side of a 1 px `border` line, 3rem of margin to the pane's edges. Each part is one row, so the two halves start level; the right half sticks while its row scrolls, unless it's taller than the view.
- **Do:** tie the halves both ways: the explanation cites the source's numbers, and hovering either lights the other. A gap (a part nothing explains) is outlined dashed in `muted-foreground` and said in words, with no Status or Warning colour.
- **Do:** under the width the two need (64rem), swap the explanation in place, with the source a button away.
- **Don't:** put a toggle for the side inside the switch of ways to show the page: it's a state of its own, beside it.
- **Guard:** none can check the layout; its look is PLAIN-14.16.

### A search hit

- **Use** `Hits` (`ui/hits.tsx`) with the ranges that matched: a `mark` in `highlight`, the foreground on it (DS-3.4). A hit isn't something to act on, so it's never Needs you's amber or Primary.
- In a sidebar row, pass `tight`: no padding, so the row truncates where it would without the mark (SIDE-12.5).
- **Do:** when a row matched on something it doesn't show, say where in a quiet line under it (SIDE-12.6), so no row matches for a reason you can't see.
- **Guard:** DS-2.3's colour guard, where `ui/hits.tsx` is the only file that uses `highlight`; DS-3.4.

## Before you ask for review

What no guard checks. A reviewer, person or agent, goes through it for every UI change.

- [ ] It copies its nearest sibling's anatomy, and the PR names which one.
- [ ] Routine values are quiet; an exception has colour and words.
- [ ] Each thing has the name it has elsewhere (Glossary, principle 3).
- [ ] Nothing takes focus by itself; it's clear which column has the keys.
- [ ] An icon alone is universal, or has a label.
- [ ] Seen in light and dark mode, at 1440 px and with the right sidebar at 280 px.
- [ ] A new or changed pattern has its entry here, and its guard where one can be written.
