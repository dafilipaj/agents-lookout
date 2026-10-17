---
status: Accepted
date: 2026-10-17
---

# 0008. UI icons come only from lucide-react

## Context

- Lookout mixed two kinds of icon. Buttons such as End Session and Send use `lucide-react` stroke icons, while other places used emoji and Unicode symbols: the usage level icons (⚠ at 80%, ⛔ at 95%, USAGE-1.2), the launcher's limit hint, Jev's "✓ ready", the History markers (● ○ ⊘) and the chat question options (☑ ☐ ● ○).
- Emoji render in the operating system's colour font, so they don't follow the theme, don't match the stroke weight of the icons beside them, and look different on every platform. Dario disliked the red ⛔ next to Codex at 100% for exactly that: it's a different style from the End Session and Send icons.
- Colour itself is fine; the style is the problem.

## Decision

- **UI icons come only from `lucide-react`.** Each is sized and stroked like its neighbours (usually `size-3` to `size-3.5`, lucide's default stroke) and coloured with theme tokens (`text-needs-you-text`, `text-destructive`, `text-busy`, `text-muted-foreground` …). A stroke icon takes the text token of a colour (`needs-you-text`), not its fill token (`needs-you`), which is too faint for a thin stroke on a light background. Colour is welcome; it never carries the meaning alone.
- **Emoji and Unicode symbols are never used as icons.**
- **Exceptions:**
  - the Harness logos (`HarnessIcon`);
  - the Status shapes (`StatusMarker`, SIDE-3.2);
  - the chat rail's Mark shapes (VIEW-1.11);
  - keyboard glyphs in shortcut hints and `<kbd>` (⌘ ↵ ↑ ↓ and the like).
- Typographic characters that aren't icons stay: `·` as a separator, `…`, `×` in counts, curly quotes, `©`.
- **A guard test** (`web/src/test/icons.test.ts`) reads the UI source in `web/src` and `shared` (tests left out) with TypeScript's parser and fails when:
  - an emoji or pictograph symbol (arrows, bullets, chevrons, "more" ellipses, shapes, dingbats) appears in a string, template or JSX text, or a `×` stands alone as an element's text. Comments aren't checked. Modifier glyphs (⌘ ⌥ ⇧ ⌃) pass anywhere; other key glyphs (↵ ↑ ↓ …) only inside `<kbd>` or a `keys`, `title` or `aria-keyshortcuts` attribute;
  - an `<svg>` is drawn outside `HarnessIcon`, `StatusMarker` and `SessionItem` (its context gauge is a tiny chart of a number, not an icon);
  - an image or SVG file is imported, or a package outside the guard's known set is imported, re-exported or loaded with `import()`. The set holds `lucide-react` (and its subpaths), `simple-icons` (only in `HarnessIcon`) and the non-icon packages the UI uses; a new package goes in only once someone has checked it isn't an icon library.

## Alternatives rejected

- **Keep emoji, add `font-variant-emoji: text`:** browsers and fonts honour it unevenly, and text-style symbols still don't match lucide's stroke and size.
- **Hand-drawn SVGs per place:** more to maintain, and they drift from lucide's style. The exceptions above are shapes that carry a defined meaning (a brand, a Status, a Mark), not general icons.
- **A second icon set:** two styles is the problem being fixed.

## Consequences

- New UI picks its icon from lucide; the guard catches a pasted emoji or symbol.
- Specs describe icons by what they show (a warning triangle, a slashed circle), not by a glyph.
- ASCII mock-ups in specs may still use symbols as shorthand; they aren't UI.
- A new shape with its own meaning, like the Status shapes, needs its file added to the guard's exceptions and to this list, by a decision that supersedes this one.
- The guard can't tell a `×` close button from a count when the `×` sits next to other text; reviews catch that one.
