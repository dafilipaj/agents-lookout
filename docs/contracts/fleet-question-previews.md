# Contract: questions with previews in `fleet messages` and `fleet answer`

What the Fleet fork (`dafilipaj/fleet`, branch `lookout`, [0006](../decisions/0006-run-a-fork-of-fleet.md)) adds so Lookout can show and answer a Claude Code question whose options have previews ([VIEW-10](../features/session-view/SPEC.md)). It's built in the fork as one commit and verified there, in Fleet's own tests; Lookout's fake `fleet` follows this file, and `pnpm req-check` never looks here (the criteria are VIEW-10). Points are numbered C1 to C8 (with C2a) so the commit's tests can cite them. Every field and flag is add-only: a later Fleet may add, never rename or drop.

Written 2026-10-28 from a live Session Lookout couldn't answer (Dario's Session `51c047a3`, a fantastic-productive spec question), against the fork at `bcec75c` (Lookout's pin in `e2e/pins.json`), and from real captures of Claude Code 2.1.312 taken the same day: `~/Projects/work/output/lookout-2026-10-28/preview-form/` (scenarios A to G, each `<name>.ans` from `capture-pane -p -e` plus `<name>.cursor`; `A-transcript.jsonl` and `C-transcript.jsonl`; the live four-question form, `claude-question-previews-200x50.json`, and its review screen, `live-4q-review-200x50.txt`). Amended the same day with C2a, after captures H1 to H4 showed what the live screen's `│ ` gutter is.

## Why

- AskUserQuestion's options may carry a `preview` (an ASCII mockup, a code snippet). For a single-select question with previews, Claude Code draws another layout: the options in a left column, the focused option's preview in a box beside them, no descriptions, no "Type something" row, and `n` for notes.
- Fleet reads neither. `core/questions.rs` keeps only a `preview: bool` (not serialized), `cli/answer.rs` refuses any call one of whose questions has previews (`has_previews`, `layout_unsupported`), and `prompt::read_form` doesn't recognise the layout at all, so `answer --list` says `no_form`: Lookout locks the options and, after 5 s, says the terminal doesn't show the question, which is false.
- The layout is per question: in the live form only question 1 had previews, and questions 2 to 4 were drawn in the plain layout. A multi-select question with previews is drawn plainly too (C4).
- A question longer than 80 characters gets a `│ ` gutter in either layout, which Fleet doesn't expect, so such a question can't be answered from Lookout even without previews (C2a).

## C1. `messages --json`: an option's preview

- An option of a `question` entry carries `preview` (a string) when the tool input gives it a non-blank string, as the Transcript has it: line breaks as `\n`, never trimmed, cut or rendered. Without one the key is absent. `answer --list`'s `questions` carry it the same way.
- Nothing else changes: the question's other fields, `status`, `answer` and the entry's `text` stay as they are. The answer's `annotations` (the picked option's `preview`, and `notes`) aren't passed on: Lookout marks the pick by `picked`, as today.

## C2. Recognising the preview layout (Claude Code 2.1.312)

Lines are read as `read_form` reads them today (the captured screen, colours dropped, trailing blanks trimmed). A form is in the preview layout when its footer, the last non-empty line, holds both "Enter to select" and "n to add notes". The captures show three footers:

- `Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel` (one question);
- `Enter to select · ↑/↓ to navigate · n to add notes · Tab to switch questions · Esc to cancel` (several);
- `… · n to add notes · ctrl+g to edit in Vim · Esc to cancel` (the notes field open: touched, C3).

From the bottom up:

1. **The footer**, then **`Chat about this`**, unnumbered, with `❯ ` when the cursor is on it, then a solid rule.
2. **The notes row**, `Notes: press n to add notes` when untouched (`Notes: Add notes on this design…` while open and empty, `Notes: <text>` once typed), indented to the box's column.
3. **The options and the box.** The box's left edge is the column of the `┌` on option 1's row (34 in every capture, at 200 and at 80 columns; read it, never assume it). Every row from option 1's down to the notes row is cut at that column; what's right of it is the box, which is never read. Left of it:
   - an option row: `❯ 1. <label>` or `  2. <label>`;
   - a label's wrapped lines, indented four spaces (`    grouped sections`, `    (Recommended)`), joined to the label with one space;
   - blank (the box running below the last option).
   The numbers run from 1 without a gap. Descriptions aren't drawn.
4. **The question**, its wrapped lines joined. A question longer than 80 characters carries a `│ ` gutter on every line (`│ New proposal on the global …`), in either layout (C2a); it's dropped.
5. **The head's top:** the tab bar (`←  ☐ Form shape  ☐ Deals  …  ✔ Submit  →`) or, with one question, a lone tab (` ☐ Layout `), then the form's top rule.

The box can be cut short: `├─── ✂ ─── N lines hidden ───┤` (a 45-line preview at 200×50, and a 9-line one at 80×24). The options, the notes row and the head stay whole in every capture, so a cut box doesn't make the form `clipped`. A form whose option rows or head run off the captured screen is `clipped`, as today.

A screen with that footer that can't be read this way (no `┌` on option 1's row, numbers with a gap, a row left of the box that is neither an option nor a wrapped label) is `layout_unsupported`, never `no_form`.

## C2a. The `│ ` gutter of a long question (both layouts)

Captures H1 to H4 (2026-10-28) settled it: Claude Code 2.1.312 draws a `│ ` gutter before a question's text when the text is longer than 80 characters (59, 73 and 80: none; 81, 82, 83, 84, 87, 90, 120 and 230: always), whatever its options. On the form every wrapped line of the question carries it (`│ foxtrot…`); on the review screen the item reads ` │ ● <question>` and its wrapped lines ` │   …`. It never shows on an option row, a `→` answer line, "Submit answers" or "Cancel". So it hits the plain layout too: before this commit a plain question over 80 characters failed `Form::check` on its text (`question`), and Lookout said the form didn't match. The gutter is dropped wherever it shows: the question's lines in both layouts, and a review item and its continuation lines. H1 is the live four-question input; H2 to H4 plain questions of chosen lengths (inputs in `H-input*.json`).

## C3. Which question it shows, and untouched

- **Shows (`Form::check`):** the tabs are the questions' headers, in order, as today; the active question's text is its `question`; its options are exactly the question's, in order, by label (wrapped lines joined, compared squashed, as today). The question has previews (`preview` on at least one option) and is single-select. Descriptions and the box aren't compared: the first isn't drawn, and the box is rendered as Markdown (`[__________]` shows as `[]`) and may be cut.
- **Untouched (`Form::fresh`):** no tab `☒`, the cursor on option 1, the notes row `Notes: press n to add notes`, and the plain footer (not the notes field's). Anything else is `touched` (notes typed or open, a tab answered) or `cursor_moved` (the cursor on another option or on `Chat about this`).
- **Weaker than the plain layout's check, knowingly:** two questions with the same headers, text and labels but other descriptions or previews read as the same. That needs the agent to ask the same question twice with other mockups, and the answer means the same label either way.

## C4. `answer --list`

- A preview form reads as any question form: `{kind: "question", id, questions, active, untouched}`, `answerable` true when C3 holds on the first question, `detail` as today otherwise (`clipped`, `tabs`, `question`, `options`, `touched`, `cursor_moved`, `different_prompt`).
- `layout_unsupported` stays only for C2's last paragraph. The blanket refusal goes: `has_previews` counts only a **single-select** question with previews, which is what Claude Code draws in this layout. A multi-select question with previews is drawn plainly (`[ ]` rows, `Type something`, `Submit`, no box; capture E) and is read and answered as a plain form.
- A pending question with previews whose form isn't on screen at all (a panel, a permission prompt) is still `no_form` or `different_prompt`: nothing is on screen to call unsupported.

## C5. `answer --question --answers`

- A single-select question with previews takes exactly one option and no `text`: anything else is `answer_invalid`, nothing typed. The terminal has no "Type something" row for it, and notes are a later slice (C6).
- Keys, as today: `Down` to the option, then `Enter`, each checked before the next (`form_at`): in the preview layout the cursor's row is the expected option (C2's numbered row, `❯ `), the tabs answered so far `☒`, the notes row untouched. `Down` past the last option goes to `Chat about this` and stays there (captures A-down3, A-down4); the plan never goes there.
- Forms with several questions mix layouts (the live form). Each step reads the question on screen in its own layout; questions without previews are planned and answered as today.
- **The review screen:** read as today, with C2a's gutter dropped from an item (` │ ● New proposal …`) and its wrapped lines. The live review showed it before questions 1, 3 and 4 (165, 105 and 100 characters) and not 2 (72). Without this, an answer would stop at the review after its options were typed (`prompt_changed`).
- After the last key: as today (`landed`).

## C6. Not in this commit

- **Notes:** `n`, a note, and Enter (which in a one-question form submits the whole answer, capture A-notes-enter; `toolUseResult.annotations[question].notes`). A later commit, after a capture of notes in a form with several questions.
- **`Chat about this`**, and `Tab`/`←`/`→` between tabs (Enter moves on as today).
- **Comparing the box with the preview**, or reporting which preview the box shows.
- Codex: its `request_user_input` has no previews.

## C7. Tests in the fork

- The captures copied to `testdata/screens/live/claude-question-preview-*` (`.ans` and `.cursor`), keeping their scenario letters, and the live screens as `claude-question-preview-live-4q-*`.
- Unit tests per point: C2 on every capture (the box's column, wrapped labels, the cut box at 80×24 and 200×50, `Chat about this` with the cursor, the notes row's three states, the live `│ ` question); C3 against each capture's Transcript question (shows, untouched; `cursor_moved` on A-down1 to A-down4; `touched` on A-notes-open and A-notes-typed); C4 (`answerable` on A-initial, C-initial and the live form; E answered as a plain multi-select; `layout_unsupported` on a damaged A-initial without its `┌`); C5's plan for a one-question and the live four-question form, and the review with and without the gutter; C2a on H1 to H4 (80 and 81 characters, a wrapped question on the form and on the review), with every plain-layout test still passing.
- An answer end to end against a Fake form isn't possible in the fork either; the live check is Lookout's VIEW-10.8.

## C8. Boundary

Lookout reads `preview` from `messages` and asks `answer --list` and `answer --question` exactly as today: no new flag or verb. Its pin moves to the commit, and the fake `fleet` gets `preview` in its fixtures and preview questions that `--list` calls answerable.
