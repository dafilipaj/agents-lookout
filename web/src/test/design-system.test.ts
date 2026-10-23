import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import css from '@/index.css?raw';
import { TYPE_SCALE } from '@/lib/utils';

/**
 * Decision 0009: one design system, guarded by tests (docs/features/design-system/SPEC.md, DS). Like
 * 0008's icons guard (icons.test.ts), this reads the UI source (web/src and shared, tests left out)
 * with TypeScript's parser, so classes inside `cn()`, `cva()` and templates are found and comments
 * aren't. It fails on:
 * - a font size that isn't one of the type scale's five steps (DS-1.1, 1.2);
 * - a colour family's token in a file its row in "Colour by meaning" doesn't list, or in a listed file in
 *   a class the row doesn't pin (DS-2.3, 3.6);
 * - a raw colour: a Tailwind palette class, an arbitrary colour, or a hex, rgb(), hsl() or oklch() (DS-2.3);
 * - a Harness logo in brand colour outside the main pane's header and the launcher (DS-3.1);
 * - `role="alert"` outside the Alert and the listed functions, a quiet Alert (`role`, `quiet`) outside the listed ones, or a box
 *   drawn in error or info colours outside the Alert and the chip (DS-4.2);
 * - lucide's `Circle` or `CircleDot` outside `Answering.tsx`, or `StatusMarker` outside the Session marker and
 *   the header (DS-5.1, 5.4);
 * - a `Button` with an `icon…` size outside `components/ui/`, an `IconButton` whose `className` sets a size, or a
 *   `<button>`/`<Button>` holding only an icon that isn't an `IconButton` (DS-7.2);
 * - a 20 px icon (`size-5`) outside `components/ui/`: only the labelled button size draws one (DS-7.1, 7.4);
 * - a `<kbd>` outside `Kbd`, or a `select-all` command outside `CommandBlock` (DS-8.2, 8.4).
 * Every exception is in this file, with its reason, so adding one is a reviewed change.
 */

/** Every UI source file, as text, keyed by its path from the repo root (the same set icons.test.ts reads). */
const SOURCES = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['../**/*.{ts,tsx,css}', '../../../shared/**/*.ts', '!../**/*.test.{ts,tsx}', '!../../../shared/**/*.test.ts', '!./**'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([path, text]) => [path.replace(/^\.\.\/\.\.\/\.\.\//, '').replace(/^\.\.\//, 'web/src/'), text]),
);

function where(file: ts.SourceFile, pos: number): string {
  const { line, character } = file.getLineAndCharacterOfPosition(pos);
  return `${line + 1}:${character + 1}`;
}

function parse(source: string, path: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** A CSS file without its comments, each kept as blanks so positions stay put. */
const uncommented = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));

/** Where `m` found something, as `line:col what` (TS) or `line what` (CSS). */
function matches(text: string, pattern: RegExp, at: (index: number) => string): string[] {
  return [...text.matchAll(pattern)].map((m) => `${at(m.index)} ${m[0].trim()}`);
}

/**
 * Every place class names can hide in a file: TS's strings, templates and template parts, or a CSS
 * file's text without comments (custom properties left out when `withProperties` is false: a token's
 * definition isn't a use of it).
 */
function scan(source: string, path: string, pattern: RegExp, withProperties = true): string[] {
  if (path.endsWith('.css')) {
    let code = uncommented(source);
    if (!withProperties) code = code.replace(/--[\w-]+\s*:[^;]*;/g, (d) => d.replace(/[^\n]/g, ' '));
    return matches(code, pattern, (i) => `${code.slice(0, i).split('\n').length}`);
  }
  const file = parse(source, path);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const start = node.getStart() + 1;
      found.push(...matches(node.text, pattern, (i) => where(file, start + i)));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

// ---------------------------------------------------------------------------------------------
// DS-1: font sizes only from the scale

/**
 * A font size written any way but the scale's steps: Tailwind's sizes (`text-xs` to `text-9xl`), an
 * arbitrary length (`text-[11.5px]`, `text-[length:var(--x)]`, `text-(length:--x)`), each with any
 * math function (`text-[calc(1rem-2px)]`, `clamp()`, `min()`, `max()`), each with any variant, line
 * height or important suffix (`md:text-sm`, `text-sm/6`, `text-sm!`), and `font-size` in CSS, an
 * arbitrary property or an inline style string.
 */
const SIZE_CLASS =
  /(?<=^|[\s"'`:!(])text-(?:xs|sm|base|lg|[2-9]?xl|\[(?:length:[^\]\s]+|(?:calc|clamp|min|max)\([^\]\s]*|-?[\d.]+(?:px|rem|em|pt|%|vw|vh|ch)?)\]|\(length:[^)\s]+\))!?(?=$|[\s"'`/)\],;])|(?<![\w-])font(?:-size)?\s*:/g;

/**
 * Where a font size may be set outside the scale, by file, with what and why. `index.css` defines the
 * steps themselves (`--text-caption` …), which this check doesn't count as a font size; see
 * "the scale is five steps" below.
 */
const SIZE_EXCEPTIONS: Record<string, { allow: string; reason: string }> = {
  'web/src/components/StatusMarker.tsx': { allow: 'fontSize', reason: "the ? inside Unknown's shape: an SVG text, sized in the shape's 14-unit viewBox, not a UI text" },
};

/** `fontSize` / `font-size` set as a JSX attribute (`<text fontSize="8">`), an object property (`style={{ fontSize: 12 }}`) or a DOM write (`el.style.fontSize = …`, `setProperty('font-size', …)`). */
function sizeProperties(source: string, path: string): string[] {
  const file = parse(source, path);
  const found: string[] = [];
  const isSize = (name: string) => /^(?:fontSize|font-size|font)$/.test(name);
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && isSize(node.name.getText())) found.push(`${where(file, node.getStart())} ${node.name.getText()}`);
    // `el.style.fontSize = …`, `style['fontSize']`, `el.style.font = …`
    if (ts.isPropertyAccessExpression(node) && (node.name.text === 'fontSize' || (node.name.text === 'font' && /style$/.test(node.expression.getText())))) found.push(`${where(file, node.getStart())} ${node.name.text}`);
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && /^(?:fontSize|font-size)$/.test(node.argumentExpression.text)) found.push(`${where(file, node.getStart())} ${node.argumentExpression.text}`);
    // `style.setProperty('font-size', …)`
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'setProperty') {
      const first = node.arguments[0];
      if (first && ts.isStringLiteralLike(first) && /^(?:font-size|font)$/.test(first.text)) found.push(`${where(file, node.getStart())} ${first.text}`);
    }
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
      // `font` only counts in a style object; elsewhere it's a word like any other.
      if (name && (name === 'fontSize' || name === 'font-size' || (name === 'font' && inStyle(node)))) found.push(`${where(file, node.getStart())} ${name}`);
    }
    ts.forEachChild(node, visit);
  };
  const inStyle = (node: ts.Node) => {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) if (ts.isJsxAttribute(n)) return n.name.getText() === 'style';
    return false;
  };
  visit(file);
  return found;
}

/** Every font size in one file that isn't from the scale, as `line:col what`, before exceptions. */
function fontSizes(source: string, path = 'x.tsx'): string[] {
  return [...scan(source, path, SIZE_CLASS), ...(path.endsWith('.css') ? [] : sizeProperties(source, path))];
}

/** The same, with the file's exception taken out. */
function offScale(source: string, path: string): string[] {
  const allow = SIZE_EXCEPTIONS[path]?.allow;
  return fontSizes(source, path).filter((f) => f.split(' ')[1] !== allow);
}

describe('type scale', () => {
  const what = (source: string, path?: string) => fontSizes(source, path).map((s) => s.split(' ').slice(1).join(' '));

  it('DS-1.1: the scale is five steps, caption 11, meta 12, body 13, prose 14 and title 15 px, each with its line height, defined once in index.css', () => {
    const theme = css.slice(css.indexOf('@theme inline'));
    expect(theme).toMatch(/--text-\*:\s*initial;/); // Tailwind's own sizes are cleared, so `text-sm` generates nothing
    const steps = [...theme.matchAll(/--text-([a-z]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]);
    expect(steps).toEqual([
      ['caption', '11px'],
      ['meta', '12px'],
      ['body', '13px'],
      ['prose', '14px'],
      ['title', '15px'],
    ]);
    const lines = Object.fromEntries([...theme.matchAll(/--text-([a-z]+)--line-height:\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
    expect(lines).toEqual({ caption: '16px', meta: '16px', body: '20px', prose: '22px', title: '20px' });
    // cn() knows the same five steps as font sizes (tailwind-merge), and the page's own text is `body`.
    expect([...TYPE_SCALE]).toEqual(steps.map(([name]) => name));
    expect(css).toMatch(/body \{\s*@apply [^;]*\btext-body\b/);
    // No other file defines a step.
    const elsewhere = Object.entries(SOURCES).filter(([path, text]) => path !== 'web/src/index.css' && /--text-[\w-]+\s*:/.test(text));
    expect(elsewhere.map(([path]) => path)).toEqual([]);
  });

  it('DS-1.1: the guard catches Tailwind sizes, arbitrary sizes and font-size, however they are written', () => {
    expect(
      what(
        [
          `<p className="text-xs" />; cn('a text-sm b', 'md:text-base'); cva('text-lg', { v: { x: 'text-2xl' } });`,
          "const t = `p-2 ${big ? 'text-xl' : ''} text-[11.5px]`;",
          `'text-[10px] text-[0.8rem] text-[1.1em] text-[length:var(--x)] text-(length:--size) text-sm/6 !text-[13px] hover:text-[12.5px]';`,
          `<text fontSize="8" />; <div style={{ fontSize: 12 }} />; <i style={{ font: '12px x' }} />; const s = { 'font-size': '1px' };`,
          `<b className="[font-size:12px]" />; el.setAttribute('style', 'font-size: 12px');`,
          `'text-sm! md:text-sm! text-[11px]! text-[calc(1rem-2px)] text-[clamp(1rem,2vw,2rem)] text-[min(1rem,2vw)] text-[max(1rem,2vw)]';`,
          `el.style.fontSize = '12px'; el.style.setProperty('font-size', '12px'); el.style['fontSize'] = '1px';`,
        ].join('\n'),
      ),
    ).toEqual([
      'text-xs', 'text-sm', 'text-base', 'text-lg', 'text-2xl', 'text-xl', 'text-[11.5px]',
      'text-[10px]', 'text-[0.8rem]', 'text-[1.1em]', 'text-[length:var(--x)]', 'text-(length:--size)', 'text-sm', 'text-[13px]', 'text-[12.5px]',
      'font-size:', 'font-size:',
      'text-sm!', 'text-sm!', 'text-[11px]!', 'text-[calc(1rem-2px)]', 'text-[clamp(1rem,2vw,2rem)]', 'text-[min(1rem,2vw)]', 'text-[max(1rem,2vw)]',
      'fontSize', 'fontSize', 'font', 'font-size',
      'fontSize', 'font-size', 'fontSize',
    ]);
    expect(what(`/* text-sm in a comment */\n.x { font-size: 12px; }\n.y { @apply text-[11px]; }\n.z { font: 12px/1 x; }`, 'x.css')).toEqual(['font-size:', 'text-[11px]', 'font:']);
  });

  it('DS-1.1: the guard lets the scale, colours, alignment and comments through', () => {
    expect(
      fontSizes(
        [
          `// text-sm and text-[11px] in a comment`,
          `/* style={{ fontSize: 12 }} */`,
          `cn('text-caption text-meta text-body text-prose text-title text-meta/5 md:text-body');`,
          `'text-left text-center text-right text-wrap text-nowrap text-ellipsis text-balance';`,
          `'text-muted-foreground text-destructive text-[#abc] text-[color:red] text-(--x) text-[var(--color-idle)] text-small-caps';`,
          `const font = 'Inter'; const o = { font: 'Inter' }; 'text-smooth text-base-x';`,
        ].join('\n'),
      ),
    ).toEqual([]);
    expect(fontSizes(`:root { --text-caption: 11px; --font-sans: 'Inter'; font-feature-settings: 'cv11'; }`, 'x.css')).toEqual([]);
  });

  it('DS-1.1: the guard says where it found a size', () => {
    expect(fontSizes(`const a = 1;\nconst b = <i className="p-1 text-sm">x</i>;`)).toEqual(['2:29 text-sm']);
    expect(fontSizes(`.a {}\n.b { font-size: 1px }`, 'x.css')).toEqual(['2 font-size:']);
  });

  it('DS-1.1: every font size in UI source comes from the scale, outside the listed exceptions', () => {
    expect(Object.keys(SOURCES)).toEqual(expect.arrayContaining(['web/src/components/Chat.tsx', 'web/src/index.css', 'shared/history.ts'])); // it reads the real tree
    expect(Object.keys(SOURCES).filter((path) => /\.test\.|^web\/src\/test\//.test(path))).toEqual([]);
    const found = Object.entries(SOURCES).flatMap(([path, text]) => offScale(text, path).map((s) => `${path}:${s}`));
    expect(found).toEqual([]);
    // Each exception still exists and is still needed, so the list can't rot.
    for (const [path, { allow }] of Object.entries(SIZE_EXCEPTIONS)) expect(fontSizes(SOURCES[path] ?? '', path).map((s) => s.split(' ')[1]), path).toContain(allow);
  });

  it('DS-1.2: the shadcn components in components/ui use the scale too', () => {
    const ui = Object.entries(SOURCES).filter(([path]) => path.startsWith('web/src/components/ui/'));
    expect(ui.map(([path]) => path)).toEqual(expect.arrayContaining(['web/src/components/ui/button.tsx', 'web/src/components/ui/dialog.tsx', 'web/src/components/ui/popover.tsx']));
    expect(ui.flatMap(([path, text]) => offScale(text, path).map((s) => `${path}:${s}`))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// DS-2.3, DS-3.6: colour tokens only in their meaning

/**
 * A family's tokens, and the files that may use them, each with why ("Colour by meaning" in the DS spec)
 * and the exact classes it uses (sorted, each once), so a new use in a listed file is a reviewed change.
 */
type Family = { tokens: string[]; files: Record<string, { why: string; uses: string[] }> };

const FAMILIES: Record<string, Family> = {
  'needs-you': {
    tokens: ['needs-you', 'needs-you-soft', 'needs-you-text'],
    files: {
      'web/src/components/StatusMarker.tsx': { why: 'the Needs you marker', uses: ['text-needs-you'] },
      'web/src/lib/sessions.ts': { why: "the Status's strip, row tint and header tag", uses: ['bg-needs-you', 'bg-needs-you-soft', 'bg-needs-you/12', 'bg-needs-you/20', 'bg-needs-you/26', 'ring-needs-you/70', 'text-needs-you-text'] },
      'web/src/components/SessionItem.tsx': { why: 'a Needs you row\'s "waiting for" line', uses: ['text-needs-you-text'] },
      'web/src/components/ChatActivity.tsx': { why: 'the Needs you row in the chat', uses: ['bg-needs-you', 'text-needs-you-text'] },
      'web/src/components/ChatRail.tsx': { why: "a question's Mark on the chat rail", uses: ['bg-needs-you'] },
      'web/src/components/Chat.tsx': { why: 'a pending question card', uses: ['bg-needs-you-soft', 'border-needs-you/60', 'text-needs-you-text'] },
      'web/src/components/Answering.tsx': { why: 'the question and permission cards, and their TerminalNote', uses: ['bg-needs-you-soft', 'border-needs-you/60', 'text-needs-you-text'] },
    },
  },
  busy: {
    tokens: ['busy', 'busy-soft', 'busy-text'],
    files: {
      'web/src/components/StatusMarker.tsx': { why: 'the Busy marker', uses: ['text-busy'] },
      'web/src/lib/sessions.ts': { why: "the Status's strip and header tag", uses: ['bg-busy', 'bg-busy-soft', 'text-busy-text'] },
      'web/src/components/ChatActivity.tsx': { why: 'the "Working…" dot: the Session is Busy', uses: ['bg-busy'] },
      'web/src/components/SessionView.tsx': { why: "VIEW-8's running Subagents in the status line", uses: ['text-busy-text'] },
    },
  },
  idle: {
    tokens: ['idle', 'idle-soft', 'idle-text'],
    files: {
      'web/src/components/StatusMarker.tsx': { why: 'the Idle and Unknown markers', uses: ['text-idle'] },
      'web/src/lib/sessions.ts': { why: "the Status's strip and header tag", uses: ['bg-idle', 'bg-idle-soft', 'text-idle-text', 'var(--color-idle)'] },
      'web/src/components/SessionItem.tsx': { why: "SIDE-2.6's background shell: Idle with a command still running", uses: ['text-idle-text'] },
      'web/src/components/SessionView.tsx': { why: "VIEW-5.16's background shell and VIEW-8's finished Subagents in the status line", uses: ['text-idle-text'] },
    },
  },
  warning: {
    tokens: ['warning', 'warning-text'],
    files: {
      'web/src/lib/sessions.ts': { why: 'context above 40% (CONTEXT_LEVEL_CLASS), in the status line, the sidebar and a PR aged 3 to 10 days', uses: ['text-warning-text'] },
      'web/src/lib/usage.ts': { why: "the usage warning level's triangle, and its bar's edge (and the details' solid bar)", uses: ['bg-warning', 'text-warning-text'] },
    },
  },
  destructive: {
    tokens: ['destructive', 'destructive-soft', 'destructive-text'],
    files: {
      'web/src/components/ui/button.tsx': { why: 'the destructive Button variant, and an invalid field', uses: ['bg-destructive', 'bg-destructive/60', 'bg-destructive/90', 'border-destructive', 'ring-destructive/20', 'ring-destructive/40'] },
      'web/src/components/ui/input.tsx': { why: 'an invalid field', uses: ['border-destructive', 'ring-destructive/20', 'ring-destructive/40'] },
      'web/src/components/ui/textarea.tsx': { why: 'an invalid field', uses: ['border-destructive', 'ring-destructive/20', 'ring-destructive/40'] },
      'web/src/lib/sessions.ts': { why: 'context above 60% (CONTEXT_LEVEL_CLASS)', uses: ['text-destructive-text'] },
      'web/src/lib/usage.ts': { why: "the usage critical level's octagon, and its bar's edge (and the details' solid bar)", uses: ['bg-destructive', 'text-destructive'] },
      'web/src/lib/work.ts': { why: 'a PR over 10 days', uses: ['text-destructive-text'] },
      'web/src/components/ui/alert.tsx': { why: "the error Alert (DS-4): its box, title and icon; every error's look", uses: ['bg-destructive-soft', 'border-destructive/30', 'text-destructive', 'text-destructive-text'] },
      'web/src/components/Launcher.tsx': { why: 'a Harness at a critical limit', uses: ['text-destructive'] },
      'web/src/components/LaunchItem.tsx': { why: 'a failed Starting row', uses: ['bg-destructive/8', 'ring-destructive/40', 'text-destructive'] },
      'web/src/components/StartingView.tsx': { why: "a failed start's icon and status pill", uses: ['bg-destructive/10', 'ring-destructive/30', 'text-destructive'] },
      'web/src/components/WorkPanel.tsx': { why: 'CI failing', uses: ['text-destructive'] },
      'web/src/components/SessionView.tsx': { why: 'a Stop that failed, and a failed copy', uses: ['text-destructive'] },
      'web/src/components/Markdown.tsx': { why: 'a failed copy', uses: ['text-destructive'] },
    },
  },
  ok: {
    tokens: ['ok', 'ok-text'],
    files: {
      'web/src/components/ui/chip.tsx': { why: "an approved PR's chip (WORK-3.2)", uses: ['border-ok/40', 'text-ok'] },
      'web/src/components/WorkPanel.tsx': { why: 'CI passing', uses: ['text-ok'] },
      'web/src/lib/work.ts': { why: 'a PR under 3 days', uses: ['text-ok-text'] },
    },
  },
  info: {
    tokens: ['info-soft', 'info-border', 'info-text'],
    files: {
      'web/src/components/ui/alert.tsx': { why: 'the info Alert (DS-4): staleness and notices, its box, text and icon', uses: ['bg-info-soft', 'border-info-border', 'text-info-text'] },
      'web/src/components/ui/chip.tsx': { why: 'the info chip: "old" (DS-3.3)', uses: ['bg-info-soft', 'text-info-text'] },
      'web/src/components/SessionView.tsx': { why: 'the terminal preview\'s "… · retrying" (DS-3.3)', uses: ['text-info-text'] },
      'web/src/components/UsageStrip.tsx': { why: 'a usage reading marked old (DS-3.3)', uses: ['text-info-text'] },
    },
  },
  highlight: {
    tokens: ['highlight'],
    files: {
      'web/src/components/HistoryPanel.tsx': { why: "History's search hits (DS-3.4)", uses: ['bg-highlight'] },
    },
  },
};

/** The utilities that paint with a colour token. */
const COLOUR_UTILITY = '(?:bg|text|(?:text|drop|inset)-shadow|border(?:-[xytrbles])?|ring|ring-offset|inset-ring|fill|stroke|outline|from|via|to|decoration|divide|shadow|caret|accent|placeholder)';

/** What may follow a class name: an opacity (`/40`, `/12.5`, `/[0.5]`, `/(--a)`), Tailwind's `!`, then the class's end. */
const CLASS_TAIL = '(?:\\/(?:\\d+(?:\\.\\d+)?|\\[[^\\]]+\\]|\\([^)]*\\)))?!?(?=$|[\\s"\'`)\\],;])';
/** What may come before a class name. */
const CLASS_HEAD = '(?<=^|[\\s"\'`:!(\\[])';

/**
 * A family's tokens used as a class (`bg-busy-soft`, `hover:border-busy/40`, `[&_svg]:text-busy!`), as
 * a variable shorthand (`text-(--color-busy)`, `bg-(color:--busy)`), as a variable (`var(--color-busy)`,
 * `var(--busy, red)`) or in CSS's `theme(--color-busy)`.
 */
function familyPattern(family: Family): RegExp {
  const tokens = [...family.tokens].sort((a, b) => b.length - a.length).join('|');
  return new RegExp(
    `${CLASS_HEAD}${COLOUR_UTILITY}-(?:${tokens}|\\((?:color:)?--(?:color-)?(?:${tokens})\\))${CLASS_TAIL}|var\\(--(?:color-)?(?:${tokens})(?:\\)|\\s*,)|theme\\(--(?:color-)?(?:${tokens})\\)`,
    'g',
  );
}

/** One family's uses in one file, as `line:col class`. Token definitions in CSS don't count. */
function familyUses(name: string, source: string, path = 'x.tsx'): string[] {
  return scan(source, path, familyPattern(FAMILIES[name]!), false);
}

/** A family's classes in one file, each once, sorted: what its exception pins. */
const classesOf = (name: string, path: string) => [...new Set(familyUses(name, SOURCES[path] ?? '', path).map((s) => s.split(' ').slice(1).join(' ')))].sort();

// ---------------------------------------------------------------------------------------------
// DS-2.3: no raw colours

/** Tailwind's numbered palette (`amber-600`). Black and white (a scrim, text on a solid red button) aren't in it. */
const PALETTE = '(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|taupe|mauve|mist|olive)-\\d{2,3}';

/**
 * CSS's named colours, except `black` and `white` (allowed as classes, so allowed here) and the keywords
 * `transparent` and `currentColor`, which aren't a colour of their own.
 */
const NAMED_COLOURS = (
  'aliceblue antiquewhite aqua aquamarine azure beige bisque blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan ' +
  'darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet ' +
  'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
  'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow ' +
  'lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin ' +
  'navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue ' +
  'saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat whitesmoke yellow yellowgreen'
).split(' ');
const NAMED = `(?<![a-zA-Z0-9-])(?:${NAMED_COLOURS.join('|')})(?![a-zA-Z0-9(-])`;
/** A hex digit string led by `#` (3, 4, 6 or 8 digits). It is a colour only in a class, a CSS value or a style property, never in free text ("PR #123"). */
const HEX = '#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![a-zA-Z0-9-])';
/** A colour function: unambiguous wherever it is written. */
const COLOUR_FN = '(?<![a-zA-Z0-9-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|light-dark)\\(';
/** `url(…)`, whose contents (`/red.png`) are never a colour. */
const URL_ARG = 'url\\([^)]*\\)';
/** Anything up to a `]` or `;`, skipping `url(…)`'s contents. */
const NOT_URL = (stop: string) => `(?:${URL_ARG}|(?!url\\()[^${stop}])*?`;

/** The CSS properties (and their `style` / SVG-attribute spellings) that hold a colour. */
const COLOUR_PROPS = 'color|background(?:-color)?|fill|stroke|border(?:-[a-z]+)?-color|outline-color|text-decoration-color|caret-color|accent-color|stop-color|flood-color|lighting-color|box-shadow|text-shadow';

/**
 * A raw colour in a string or CSS rule:
 * - a palette class (`text-amber-600`, `bg-red-500/10`, `border-black`);
 * - an arbitrary value or property holding one (`text-[#f59e0b]`, `bg-[oklch(…)]`, `text-[color:red]`, `stroke-[red]`,
 *   `shadow-[0_0_0_1px_red]`, `[background:#fff]`), but not `[fill:none]`, `[color:inherit]`, `bg-[color:transparent]`,
 *   `[background:url(/red.png)]` or `[stroke:currentColor]`;
 * - a colour function (`rgb(`, `hsl(`, `oklch(` …) anywhere;
 * - a hex or a named colour as the value of a colour property in a string or CSS rule (`fill: #fff`, `color: orange`).
 * A hex or named colour as a style property's value in TS is found by `styleColours`.
 */
const RAW_COLOUR = new RegExp(
  [
    `${CLASS_HEAD}${COLOUR_UTILITY}-(?:${PALETTE})${CLASS_TAIL}`,
    `${CLASS_HEAD}${COLOUR_UTILITY}-\\[${NOT_URL('\\]')}(?:${HEX}|${NAMED}|${COLOUR_FN})[^\\]]*\\]`,
    `${CLASS_HEAD}\\[(?:${COLOUR_PROPS}):${NOT_URL('\\]')}(?:${HEX}|${NAMED}|${COLOUR_FN})[^\\]]*\\]`,
    `(?<![\\w-])(?:${COLOUR_PROPS})\\s*:\\s*${NOT_URL(';}"\'`\\]')}(?:${HEX}|${NAMED})`,
    COLOUR_FN,
  ].join('|'),
  'gi',
);

/** Where a raw colour may be, by file, with what and why: the brand hex of Claude's logo, built as `#${siClaude.hex}`. */
const RAW_COLOUR_EXCEPTIONS: Record<string, { allow: string; reason: string }> = {
  'web/src/components/HarnessIcon.tsx': { allow: '#${…}', reason: "Claude's brand orange, `#${siClaude.hex}`, where the logo is the point (DS-3.1)" },
};

/** The property names, in a `style` object or as an SVG attribute, that hold a colour. */
const COLOUR_PROP_NAME = /^(?:color|background(?:Color)?|fill|stroke|border(?:(?:Top|Right|Bottom|Left|Inline|Block)(?:Start|End)?)?Color|outlineColor|textDecorationColor|caretColor|accentColor|stopColor|floodColor|lightingColor|boxShadow|textShadow|(?:background|border|stop|flood|lighting|text-decoration|caret|accent|outline)-color)$/;

/** The colour property whose value `node` is part of (through a template, a conditional or parentheses), if any. */
function colourPropOf(node: ts.Node): string | null {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isPropertyAssignment(n) || ts.isJsxAttribute(n)) {
      const name = ts.isPropertyAssignment(n) ? (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : '') : n.name.getText();
      return COLOUR_PROP_NAME.test(name) ? name : null;
    }
    if (ts.isBlock(n) || ts.isCallExpression(n) || ts.isArrowFunction(n) || ts.isVariableDeclaration(n) || ts.isReturnStatement(n)) return null;
  }
  return null;
}

/**
 * What TS alone can see: a hex or a named colour as the whole value of a colour property
 * (`style={{ color: 'orange' }}`, `<path fill="#d97757" />`), and a template that builds a hex there
 * (`fill: \`#${x}\``) or in a CSS string (`\`fill: #${x}\``). A `#` in free text (`PR #${n}`, `href={\`#${id}\`}`) isn't one.
 */
function styleColours(source: string, path: string): string[] {
  const file = parse(source, path);
  const found: string[] = [];
  const own = new RegExp(`${HEX}|${NAMED}`, 'i');
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && colourPropOf(node)) {
      const hit = node.text.replace(new RegExp(URL_ARG, 'g'), '').match(own);
      if (hit) found.push(`${where(file, node.getStart())} ${hit[0]}`);
    }
    if (ts.isTemplateExpression(node)) {
      const inColourProp = colourPropOf(node) !== null;
      const cssDecl = new RegExp(`(?<![\\w-])(?:${COLOUR_PROPS})\\s*:[^;]*#$`);
      for (const part of [node.head, ...node.templateSpans.map((span) => span.literal)]) {
        if (/#$/.test(part.text) && (inColourProp || cssDecl.test(part.text))) found.push(`${where(file, part.getStart())} #\${…}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Every raw colour in one file, as `line:col what`. Token definitions in CSS (`--x: oklch(…)`) aren't raw colours. */
function rawColours(source: string, path = 'x.tsx'): string[] {
  return [...scan(source, path, RAW_COLOUR, false), ...(path.endsWith('.css') ? [] : styleColours(source, path))];
}

describe('colour by meaning', () => {
  const uses = (name: string, source: string, path?: string) => familyUses(name, source, path).map((s) => s.split(' ')[1]);

  it('DS-2.3: the guard catches a family\'s tokens however they are written, and nothing else', () => {
    expect(
      uses(
        'busy',
        `cn('bg-busy', 'text-busy-text hover:border-busy/40'); '[&_svg]:text-busy'; \`ring-busy-soft \${x}\`; 'bg-[repeating-linear-gradient(var(--color-busy)_0_3px)]'; 'fill-busy stroke-busy/[0.5] decoration-busy border-l-busy';`,
      ),
    ).toEqual(['bg-busy', 'text-busy-text', 'border-busy/40', 'text-busy', 'ring-busy-soft', 'var(--color-busy)', 'fill-busy', 'stroke-busy/[0.5]', 'decoration-busy', 'border-l-busy']);
    // Words, the Status's value, the pulse's animation, other families and comments aren't uses.
    expect(uses('busy', `// text-busy in a comment\nconst s = 'busy'; 'animate-busy'; 'bg-busy-ish'; 'text-busybody'; STATUS.busy;`)).toEqual([]);
    expect(uses('needs-you', `'needs-you'; status === 'needs-you'; 'bg-needs-you-soft text-needs-you-text'`)).toEqual(['bg-needs-you-soft', 'text-needs-you-text']);
    expect(uses('warning', `'text-warning-text'; 'Warning: 80% or more used'`)).toEqual(['text-warning-text']);
    // In CSS, a token's definition isn't a use; a rule that paints with it is.
    expect(uses('info', `:root { --info-soft: oklch(0.9 0 0); --color-info-soft: var(--info-soft); }\n.x { background: var(--info-soft); }`, 'x.css')).toEqual(['var(--info-soft)']);
  });

  it("DS-2.3: the guard catches the other ways Tailwind v4 writes a colour: !, variable shorthands, opacity forms, fallbacks, shadows, theme() and @apply", () => {
    // The important suffix.
    expect(uses('busy', `'text-busy! md:bg-busy-soft! hover:border-busy/40!'`)).toEqual(['text-busy!', 'bg-busy-soft!', 'border-busy/40!']);
    // A colour by variable shorthand.
    expect(uses('busy', `'text-(--color-busy) bg-(--busy) bg-(color:--color-busy) border-(color:--busy-soft)'`)).toEqual(['text-(--color-busy)', 'bg-(--busy)', 'bg-(color:--color-busy)', 'border-(color:--busy-soft)']);
    // An opacity as a decimal, or a variable.
    expect(uses('busy', `'bg-busy/12.5 bg-busy/(--a) text-busy-text/[0.5]'`)).toEqual(['bg-busy/12.5', 'bg-busy/(--a)', 'text-busy-text/[0.5]']);
    // A variable with a fallback.
    expect(uses('busy', `'bg-[linear-gradient(var(--color-busy,red),blue)]'; const c = 'var(--busy, red)';`)).toEqual(['var(--color-busy,', 'var(--busy,']);
    // Shadow colours.
    expect(uses('busy', `'text-shadow-busy drop-shadow-busy inset-shadow-busy shadow-busy/50'`)).toEqual(['text-shadow-busy', 'drop-shadow-busy', 'inset-shadow-busy', 'shadow-busy/50']);
    // In CSS: theme(), and a class ending a statement in @apply.
    expect(uses('busy', `.x { color: theme(--color-busy); @apply border-busy; }\n.y { @apply bg-busy/20;\n}`, 'x.css')).toEqual(['theme(--color-busy)', 'border-busy', 'bg-busy/20']);
    // And still not: another family's token, a word that starts like one.
    expect(uses('busy', `'text-(--color-idle) text-busyish text-(--busyness) bg-busy-x'`)).toEqual([]);
  });

  it('DS-2.3: the guard catches a raw colour however it is written', () => {
    const raw = (source: string, path?: string) => rawColours(source, path).map((s) => s.split(' ').slice(1).join(' '));
    const sorted = (list: string[]) => [...list].sort();
    expect(
      sorted(raw(
        [
          `'text-amber-600 bg-red-500/10 hover:border-blue-400 ring-emerald-500/[0.4] fill-slate-900! shadow-rose-500 decoration-stone-400';`,
          `cn('text-[#f59e0b]', "bg-[oklch(0.7_0.1_60)]", 'border-[rgb(1,2,3)]', 'text-[color:red]', 'bg-[color:#fff]', 'bg-[hsl(1_2%_3%)]');`,
          `'bg-[red] text-[orange] stroke-[red] shadow-[0_0_0_1px_red] bg-[color-mix(in_oklch,red_50%,transparent)] bg-[linear-gradient(to_right,navy,var(--x))]';`,
          `<i style={{ color: '#d97757', background: 'rgb(1, 2, 3)', borderColor: 'oklch(0.5 0.1 20)' }} />; const f = 'hsla(0 0% 0% / 0.5)';`,
          `<i style={{ color: 'orange', backgroundColor: "tomato", borderTopColor: \`teal\` }} />; <path fill="#d97757" stroke="red" />; <i style={{ color: ok ? 'gold' : 'var(--x)' }} />;`,
          `'[color:#f00] [background:#fff] [border-color:red] [fill:#123abc] [stroke:blue]'; const h2 = 'fill: #11223344'; const n = 'color: orange; background: #fff; border-color: crimson';`,
        ].join('\n'),
      )),
    ).toEqual(sorted([
      'text-amber-600', 'bg-red-500/10', 'border-blue-400', 'ring-emerald-500/[0.4]', 'fill-slate-900!', 'shadow-rose-500', 'decoration-stone-400',
      'text-[#f59e0b]', 'bg-[oklch(0.7_0.1_60)]', 'border-[rgb(1,2,3)]', 'text-[color:red]', 'bg-[color:#fff]', 'bg-[hsl(1_2%_3%)]',
      'bg-[red]', 'text-[orange]', 'stroke-[red]', 'shadow-[0_0_0_1px_red]', 'bg-[color-mix(in_oklch,red_50%,transparent)]', 'bg-[linear-gradient(to_right,navy,var(--x))]',
      'rgb(', 'oklch(', 'hsla(',
      '[color:#f00]', '[background:#fff]', '[border-color:red]', '[fill:#123abc]', '[stroke:blue]', 'fill: #11223344', 'color: orange', 'background: #fff', 'border-color: crimson',
      '#d97757',
      'orange', 'tomato', 'teal', '#d97757', 'red', 'gold',
    ]));
    // In CSS: a hex or a named colour as a colour property's value, a function anywhere, a palette class in @apply.
    expect(raw(`.a { color: #fff; background: rgb(0 0 0); }\n.b { @apply text-amber-600; }\n.c { color: orange; fill: var(--x, red); border-bottom-color: #abc; }`, 'x.css')).toEqual(['color: #fff', 'rgb(', 'text-amber-600', 'color: orange', 'fill: var(--x, red', 'border-bottom-color: #abc']);
    // A template that builds a hex, in a style or SVG colour or in a CSS string.
    expect(rawColours(`<i style={{ fill: \`#\${hex}\` }} />`)).toEqual(['1:19 #${…}']);
    expect(rawColours(`<path stroke={\`#\${a}\${b}\`} />; const c = \`fill: #\${hex}; stroke: #\${x}\`; const d = \`\${a}#\${b}\`;`).map((s) => s.split(' ').slice(1).join(' '))).toEqual(['#${…}', '#${…}', '#${…}']);
  });

  it('DS-2.3: the guard lets tokens, sizes, keywords, URLs, issue numbers, words and comments through', () => {
    const raw = (source: string, path?: string) => rawColours(source, path).map((s) => s.split(' ').slice(1).join(' '));
    expect(
      raw(
        [
          `// text-amber-600 and #fff in a comment`,
          `'text-white bg-black/50 bg-[color-mix(in_oklab,var(--x)_50%,transparent)] text-foreground bg-busy-soft/40 border-border text-muted-foreground bg-transparent text-current fill-current text-(--x)';`,
          `'text-[length:var(--x)] bg-[url(/a.png)] text-[var(--color-busy)] bg-[linear-gradient(var(--color-idle),transparent)] [color:var(--x)]';`,
          // CSS-wide keywords, none, transparent, currentColor and url( in an arbitrary property or value.
          `'[fill:none] [stroke:currentColor] [color:inherit] text-[color:inherit] bg-[color:transparent] [border-color:transparent] [background:none] [background:url(/a.png)] [background:url(/red.png)] bg-[url(/red.png)] [color:initial] [fill:currentcolor]';`,
          `'amber-600 white-space color-scheme #section #1 #123456789 colors(1) label(x) bg-whitespace text-blackish bg-redish text-[length:var(--tan)]';`,
          // Issue and PR numbers, and a hex-shaped word, in free text and in templates that aren't a colour.
          `const issue = 'PR #12'; const b = 'Fixes #1234'; const c = '#abc123'; const d = 'See #deadbeef'; const a = 'black'; const e = 'rgba'; const g = 'red';`,
          `const t = \`PR #\${n}\`; const u = \`\${repo}#\${n}\`; const l = <a href={\`#\${id}\`}>{\`through PR #\${number}\`}</a>;`,
          `<i style={{ color: 'inherit', background: 'none', fill: 'currentColor', stroke: 'none', backgroundImage: 'url(/red.png)', borderColor: 'transparent' }} />; <path fill="none" stroke="currentColor" />;`,
        ].join('\n'),
      ),
    ).toEqual([]);
    expect(raw(`:root { --busy: oklch(0.6 0.1 250); --color-busy: var(--busy); }\n@media (prefers-color-scheme: dark) { :root { --busy: oklch(0.7 0.1 250); } }`, 'x.css')).toEqual([]);
    expect(raw(`.x { color: inherit; fill: none; stroke: currentColor; background: url(/red.png) no-repeat; border-color: transparent; scrollbar-color: color-mix(in oklab, var(--m) 50%, transparent) transparent; }`, 'x.css')).toEqual([]);
  });

  it('DS-2.3: no raw colour in UI source, outside the listed exceptions', () => {
    expect(Object.keys(SOURCES)).toEqual(expect.arrayContaining(['web/src/components/Chat.tsx', 'web/src/index.css', 'web/src/components/HarnessIcon.tsx'])); // it reads the real tree
    const found = Object.entries(SOURCES).flatMap(([path, text]) => {
      const allow = RAW_COLOUR_EXCEPTIONS[path]?.allow;
      return rawColours(text, path)
        .filter((c) => c.split(' ').slice(1).join(' ') !== allow)
        .map((c) => `${path}:${c}`);
    });
    expect(found).toEqual([]);
    // Each exception still exists and is still needed, so the list can't rot.
    for (const [path, { allow }] of Object.entries(RAW_COLOUR_EXCEPTIONS)) expect(rawColours(SOURCES[path] ?? '', path).map((c) => c.split(' ').slice(1).join(' ')), path).toContain(allow);
  });

  it("DS-2.3: index.css maps exactly the known colour tokens: shadcn's and the families', so a new one is a reviewed change", () => {
    const SHADCN = [
      'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground', 'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
      'accent', 'accent-foreground', 'border', 'input', 'ring', 'sidebar', 'sidebar-foreground', 'sidebar-accent', 'sidebar-border',
    ];
    const mapped = [...uncommented(css).matchAll(/--color-([\w-]+)\s*:\s*([^;]*);/g)];
    expect(mapped.map((m) => m[1]!).sort()).toEqual([...SHADCN, ...Object.values(FAMILIES).flatMap((f) => f.tokens)].sort());
    // Each is a mapping onto the variable of the same name, never a value of its own.
    expect(mapped.filter((m) => m[2]!.trim() !== `var(--${m[1]})`).map((m) => m[1])).toEqual([]);
  });

  it('DS-2.3: every family has its tokens defined, and each token is in exactly one family', () => {
    const all = Object.values(FAMILIES).flatMap((f) => f.tokens);
    expect(new Set(all).size).toBe(all.length);
    for (const token of all) expect(css, token).toContain(`--color-${token}: var(--${token});`);
  });

  /** Where a family's file uses other classes than it pins, as `family: path: pinned [...], uses [...]`. */
  const pinDrift = (families: Record<string, Family>, sources: Record<string, string>) =>
    Object.entries(families).flatMap(([name, family]) =>
      Object.entries(family.files).flatMap(([path, { uses: pinned }]) => {
        expect(pinned, `${name}: ${path} pins its classes sorted`).toEqual([...pinned].sort());
        const actual = [...new Set(familyUses(name, sources[path] ?? '', path).map((s) => s.split(' ').slice(1).join(' ')))].sort();
        return JSON.stringify(actual) === JSON.stringify(pinned) ? [] : [`${name}: ${path}: pinned ${JSON.stringify(pinned)}, uses ${JSON.stringify(actual)}`];
      }),
    );

  it('DS-2.3, DS-3.6: each colour family is used only in the files its meaning lists, and in the classes it pins there', () => {
    const found = Object.keys(FAMILIES).flatMap((name) =>
      Object.entries(SOURCES)
        .filter(([path]) => !(path in FAMILIES[name]!.files))
        .flatMap(([path, text]) => familyUses(name, text, path).map((s) => `${name}: ${path}:${s}`)),
    );
    expect(found).toEqual([]);
    // Each listed file uses exactly the classes it pins: a new one in a listed file is a reviewed change, and a stale one can't stay.
    const drift = pinDrift(FAMILIES, SOURCES);
    expect(drift).toEqual([]);
  });

  it('DS-2.3: a file listed for a family can\'t reuse it in a class it doesn\'t pin', () => {
    // History's search hit going back to Busy's soft fill, in a file that does use Busy: the pin catches it.
    const families: Record<string, Family> = { busy: { tokens: FAMILIES.busy!.tokens, files: { 'x.tsx': { why: 'a test', uses: ['text-busy'] } } } };
    expect(pinDrift(families, { 'x.tsx': `cn('text-busy')` })).toEqual([]);
    expect(pinDrift(families, { 'x.tsx': `cn('text-busy', 'bg-busy-soft')` })).toEqual([`busy: x.tsx: pinned ["text-busy"], uses ["bg-busy-soft","text-busy"]`]);
    expect(pinDrift(families, { 'x.tsx': `cn('bg-idle')` })).toEqual([`busy: x.tsx: pinned ["text-busy"], uses []`]); // a stale pin can't stay
  });

  it('DS-3.6: Busy\'s colour is only a Status\'s: the marker, strip, tag, "Working…" dot and VIEW-8\'s running Subagents', () => {
    expect(Object.keys(FAMILIES.busy!.files).sort()).toEqual(['web/src/components/ChatActivity.tsx', 'web/src/components/SessionView.tsx', 'web/src/components/StatusMarker.tsx', 'web/src/lib/sessions.ts']);
    // No link, spinner, chip, search hit or Mark takes Busy's blue: the places that did are neutral now.
    for (const path of ['web/src/lib/links.tsx', 'web/src/components/Markdown.tsx', 'web/src/components/WorkPanel.tsx', 'web/src/components/HistoryPanel.tsx', 'web/src/components/ChatRail.tsx']) {
      expect(classesOf('busy', path), path).toEqual([]);
    }
  });

  it('DS-3.6: links are underlined in the text colour, with a focus ring and the underline kept on hover', () => {
    const link = SOURCES['web/src/lib/links.tsx']!.match(/export const LINK_CLASS = '([^']+)'/)![1]!.split(' ');
    expect(link).toEqual(expect.arrayContaining(['underline', 'underline-offset-2', 'focus-visible:outline-2', 'focus-visible:outline-ring']));
    expect(link.filter((c) => /^(?:hover:)?(?:no-underline|text-)/.test(c))).toEqual([]); // the surrounding colour, and no hover that drops the underline
  });

  it('DS-3.6: Needs you\'s colours stay off staleness, search hits and the usage bar', () => {
    for (const path of ['web/src/components/Sidebar.tsx', 'web/src/components/UsageStrip.tsx', 'web/src/components/WorkPanel.tsx', 'web/src/components/SessionView.tsx', 'web/src/components/HistoryPanel.tsx']) {
      expect(familyUses('needs-you', SOURCES[path]!, path), path).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// DS-3.1: Harness colour only in headers and the launcher

/** The files that may draw a Harness logo in brand colour: the main pane's header (live, starting, past) and the launcher. */
const BRAND_FILES: Record<string, string> = {
  'web/src/components/SessionView.tsx': "a live Session's header",
  'web/src/components/StartingView.tsx': "a starting Session's header",
  'web/src/components/PastSessionView.tsx': "a past Session's header",
  'web/src/components/Launcher.tsx': 'the new Session modal, where the logo is the choice being made',
};

/** `<HarnessIcon>`s with a `tone` that is, or may be, `brand`, as `line:col tone=…`. */
function brandLogos(source: string, path = 'x.tsx'): string[] {
  const file = parse(source, path);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText() === 'HarnessIcon') {
      for (const attr of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attr)) found.push(`${where(file, attr.getStart())} {...}`); // a spread could carry a tone
        else if (attr.name.getText() === 'tone') {
          const value = attr.initializer;
          const literal = value && ts.isStringLiteral(value) ? value.text : value && ts.isJsxExpression(value) && value.expression && ts.isStringLiteralLike(value.expression) ? value.expression.text : null;
          if (literal !== 'mono') found.push(`${where(file, attr.getStart())} tone=${literal ?? value?.getText()}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('Harness logos', () => {
  it('DS-3.1: the guard catches a brand logo, or a tone it can\'t read, and lets mono through', () => {
    const tones = (source: string) => brandLogos(source).map((s) => s.split(' ')[1]);
    expect(tones(`<HarnessIcon harness="claude" tone="brand" />; <HarnessIcon harness={h} tone={'brand'} />; <HarnessIcon harness={h} tone={t} />; <HarnessIcon {...p} />`)).toEqual([
      'tone=brand',
      'tone=brand',
      'tone={t}',
      '{...}',
    ]);
    expect(tones(`<HarnessIcon harness="claude" />; <HarnessIcon harness={h} tone="mono" className="size-4" />; <Other tone="brand" />`)).toEqual([]);
  });

  it('DS-3.1: Harness logos are monochrome everywhere but the main pane\'s header and the launcher', () => {
    const found = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('.css') && !(path in BRAND_FILES))
      .flatMap(([path, text]) => brandLogos(text, path).map((s) => `${path}:${s}`));
    expect(found).toEqual([]);
    for (const path of Object.keys(BRAND_FILES)) expect(brandLogos(SOURCES[path] ?? '', path), path).toEqual([expect.stringMatching(/ tone=brand$/)]);
    // The lists and filters really draw HarnessIcon, so a mono default covers them.
    for (const path of ['web/src/components/SessionItem.tsx', 'web/src/components/UsageStrip.tsx', 'web/src/components/HistoryPanel.tsx', 'web/src/components/LaunchItem.tsx']) {
      expect(SOURCES[path], path).toMatch(/<HarnessIcon\b/);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// DS-4.2: no hand-rolled alert boxes

/** The name of the function a node sits in: `function F`, `const F = () =>`, a method; the innermost named one, or `-`. */
function enclosingFn(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
    if (ts.isVariableDeclaration(n) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) return n.name.getText();
  }
  return '-';
}

/** An exception to a guard: a function in a file, how many times it does the thing, and why. */
interface Exception {
  path: string;
  fn: string;
  count: number;
  reason: string;
}

/** Found `path:line:col what fn` entries, split into those no exception covers, and each exception's real count. */
function againstExceptions(found: string[], exceptions: readonly Exception[]) {
  const inside = (f: string, e: Exception) => f.startsWith(`${e.path}:`) && f.endsWith(` ${e.fn}`);
  return {
    unlisted: found.filter((f) => !exceptions.some((e) => inside(f, e))),
    counts: exceptions.map((e) => ({ path: e.path, fn: e.fn, count: found.filter((f) => inside(f, e)).length })),
  };
}

/**
 * Where the word `alert` may be written as a string (a `role`): each function and how many times it
 * writes it, with why. The Alert writes it for every error; a new one in a listed file is a reviewed
 * change, as the colour guard's per-file classes are.
 */
const ROLE_ALERT_EXCEPTIONS: Exception[] = [
  { path: 'web/src/components/ui/alert.tsx', fn: 'Alert', count: 3, reason: 'the Alert: an error is `role="alert"`, and `data-slot="alert"` is written twice (inline, box)' },
  { path: 'web/src/components/Answering.tsx', fn: 'TerminalNote', count: 1, reason: 'tells you to answer in the terminal: part of a Needs you card, so amber, not an Alert' },
  {
    path: 'web/src/components/SessionView.tsx',
    fn: 'HeaderNote',
    count: 1,
    reason:
      "why Stop failed (VIEW-4.4), or a failed or pending rename (VIEW-5.14), beside the title: one line in the header with its whole text in a bubble on hover or focus and a twin for narrow headers, so an inline Alert's tooltip and icon don't fit it",
  },
];

/** `alert` written as a whole string: `role="alert"`, `role={x ? 'status' : 'alert'}`, `const role = 'alert'`, as `line:col alert fn`. */
function roleAlerts(source: string, path = 'x.tsx'): string[] {
  const file = parse(source, path);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.trim() === 'alert') found.push(`${where(file, node.getStart())} alert ${enclosingFn(node)}`);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * Where an Alert may go quiet: `role="presentation"` (no live region can sit in a listbox) or
 * `quiet` (the same error is announced where it is selected). Any `role`, `quiet` or spread on an
 * `<Alert>` is found, as `line:col what fn`.
 */
const QUIET_ALERT_EXCEPTIONS: Exception[] = [
  { path: 'web/src/components/WorkPanel.tsx', fn: 'PrGroupView', count: 1, reason: "Possibly out of date (WORK-7.5), inside the listbox: the group's `aria-describedby` reads it" },
  { path: 'web/src/components/LaunchItem.tsx', fn: 'LaunchItem', count: 1, reason: "a failed Starting row's error, which StartingView announces when the row is selected (LAUNCH-4.5)" },
];

function quietAlerts(source: string, path = 'x.tsx'): string[] {
  const file = parse(source, path);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText() === 'Alert') {
      for (const p of node.attributes.properties) {
        const name = ts.isJsxAttribute(p) ? p.name.getText() : '{...}';
        if (name === 'role' || name === 'quiet' || name === '{...}') found.push(`${where(file, p.getStart())} ${name} ${enclosingFn(node)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** A box in error or info colours: `border-destructive…`, `bg-destructive/<n>`, `bg-destructive-soft`, `border-info-border`, `bg-info-soft`. */
const ALERT_BOX = new RegExp(`${CLASS_HEAD}(?:border-destructive(?:-[\\w-]+)?|bg-destructive\\/(?:[\\d.]+|\\[[^\\]]+\\])|bg-destructive-soft|border-info-border|bg-info-soft)(?:\\/[\\d.]+)?!?(?=$|[\\s"'\`)\\],;])`, 'g');

/** Where such a box's classes may be, by file: the classes (sorted, each once) and why. */
const ALERT_BOX_FILES: Record<string, { allow: string[]; reason: string }> = {
  'web/src/components/ui/alert.tsx': { allow: ['bg-destructive-soft', 'bg-info-soft', 'border-destructive/30', 'border-info-border'], reason: 'the Alert itself' },
  'web/src/components/ui/chip.tsx': { allow: ['bg-info-soft'], reason: 'the info chip ("old")' },
  'web/src/components/ui/button.tsx': { allow: ['bg-destructive/60', 'bg-destructive/90', 'border-destructive'], reason: 'the destructive Button variant, and an invalid field' },
  'web/src/components/ui/input.tsx': { allow: ['border-destructive'], reason: 'an invalid field' },
  'web/src/components/ui/textarea.tsx': { allow: ['border-destructive'], reason: 'an invalid field' },
  'web/src/components/LaunchItem.tsx': { allow: ['bg-destructive/8'], reason: "a failed Starting row's tint" },
  'web/src/components/StartingView.tsx': { allow: ['bg-destructive/10'], reason: "a failed start's status pill" },
};

const boxClasses = (source: string, path = 'x.tsx') => scan(source, path, ALERT_BOX, false);

describe('Alert', () => {
  const words = (list: string[]) => list.map((s) => s.split(' ')[1]);

  it('DS-4.2: the guard catches role="alert" however it is written, and lets other roles and words through', () => {
    expect(words(roleAlerts(`<p role="alert" />; <div role={info ? 'status' : 'alert'} />; const role = 'alert'; const r = { role: \`alert\` };`))).toEqual(['alert', 'alert', 'alert', 'alert']);
    expect(roleAlerts(`<p role="status" />; <i role="alertdialog" />; 'an alert'; // role="alert" in a comment\nconst alerts = 1;`)).toEqual([]);
  });

  it('DS-4.2: the guard catches a box in error or info colours, and lets text colours and other tokens through', () => {
    expect(words(boxClasses(`cn('border border-destructive/30 bg-destructive/5', 'aria-invalid:border-destructive', 'bg-destructive-soft', 'border-info-border bg-info-soft/50', 'border-destructive-text', 'bg-destructive/[0.1]')`))).toEqual([
      'border-destructive/30', 'bg-destructive/5', 'border-destructive', 'bg-destructive-soft', 'border-info-border', 'bg-info-soft/50', 'border-destructive-text', 'bg-destructive/[0.1]',
    ]);
    expect(boxClasses(`cn('text-destructive text-destructive-text bg-destructive ring-destructive/40 text-info-text border-border bg-muted')`)).toEqual([]);
  });

  it('DS-4.2: the guard pins each exception to its function and count, so a second alert in a listed file is found', () => {
    const path = 'web/src/components/SessionView.tsx';
    const src = `function HeaderNote() { return <p role="alert" />; }\nfunction Composer() { return <p role="alert" className="text-destructive" />; }`;
    const found = roleAlerts(src, path).map((f) => `${path}:${f}`);
    expect(found.map((f) => f.split(' ').slice(1).join(' '))).toEqual(['alert HeaderNote', 'alert Composer']);
    const exceptions = [{ path, fn: 'HeaderNote', count: 1, reason: 'x' }];
    expect(againstExceptions(found, exceptions).unlisted).toEqual([expect.stringMatching(/ alert Composer$/)]);
    const twice = [`${path}:1:1 alert HeaderNote`, `${path}:9:1 alert HeaderNote`];
    expect(againstExceptions(twice, exceptions).counts).toEqual([{ path, fn: 'HeaderNote', count: 2 }]);
  });

  it('DS-4.2: role="alert" is written only by the Alert and, once each, by the listed functions', () => {
    const found = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('.css'))
      .flatMap(([path, text]) => roleAlerts(text, path).map((s) => `${path}:${s}`));
    const { unlisted, counts } = againstExceptions(found, ROLE_ALERT_EXCEPTIONS);
    expect(unlisted).toEqual([]);
    expect(counts).toEqual(ROLE_ALERT_EXCEPTIONS.map(({ path, fn, count }) => ({ path, fn, count })));
  });

  it('DS-4.2: the guard finds a `role` or `quiet` on an Alert, or a spread that could carry one, and lets other props through', () => {
    const what = (src: string) => quietAlerts(src).map((f) => f.split(' ').slice(1).join(' '));
    expect(what(`function A() { return <><Alert role="presentation" title="x" /><Alert quiet title="x" /><Alert {...p} title="x" /></>; }`)).toEqual(['role A', 'quiet A', '{...} A']);
    expect(what(`function A() { return <><Alert tone="info" title="x" data-field="y" /><Other role="presentation" quiet /></>; }`)).toEqual([]);
  });

  it('DS-4.2: an Alert goes quiet (`role="presentation"`, `quiet`) only in the listed functions, once each', () => {
    const found = Object.entries(SOURCES)
      .filter(([path]) => /\.tsx$/.test(path))
      .flatMap(([path, text]) => quietAlerts(text, path).map((s) => `${path}:${s}`));
    const { unlisted, counts } = againstExceptions(found, QUIET_ALERT_EXCEPTIONS);
    expect(unlisted).toEqual([]);
    expect(counts).toEqual(QUIET_ALERT_EXCEPTIONS.map(({ path, fn, count }) => ({ path, fn, count })));
  });

  it('DS-4.2: no element outside the Alert and the chip draws a box in error or info colours, outside the listed exceptions', () => {
    const found = Object.entries(SOURCES).flatMap(([path, text]) => {
      const allow = ALERT_BOX_FILES[path]?.allow ?? [];
      return boxClasses(text, path)
        .filter((c) => !allow.includes(c.split(' ')[1]!))
        .map((c) => `${path}:${c}`);
    });
    expect(found).toEqual([]);
    // Each exception is exactly what its file uses, so a stale one can't stay.
    for (const [path, { allow }] of Object.entries(ALERT_BOX_FILES)) {
      expect([...new Set(boxClasses(SOURCES[path] ?? '', path).map((c) => c.split(' ')[1]!))].sort(), path).toEqual(allow);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// DS-5.1, DS-5.4: one Session marker

/** lucide's names for its empty and dotted circles, which once drew a Session's state. */
const CIRCLES = new Set(['Circle', 'CircleIcon', 'LucideCircle', 'CircleDot', 'CircleDotIcon', 'LucideCircleDot']);
/** Where they may be imported: Answering.tsx draws a question's options with them, not a Session. */
const CIRCLE_FILES: Record<string, string> = { 'web/src/components/Answering.tsx': "a question's options (a single-choice option's radio)" };
/** Where `StatusMarker` may be imported: the Session marker, and the main pane's header, where a Session's own Status tag sits (VIEW-5.9), not a list. */
const STATUS_MARKER_FILES: Record<string, string> = {
  'web/src/components/ui/session-marker.tsx': 'the Session marker draws a live Session with it',
  'web/src/components/SessionView.tsx': "the header's Status tag (VIEW-5.9): one Session's Status, not a list's marker",
};

/** The named imports of `names` from a module whose specifier passes `from`, and namespace imports of it, as `line:col name`. */
function importsOf(source: string, path: string, from: (specifier: string) => boolean, names: (name: string) => boolean): string[] {
  const file = parse(source, path);
  const found: string[] = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const spec = statement.moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec) || !from(spec.text)) continue;
    const clause = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : statement.exportClause;
    if (clause && (ts.isNamespaceImport(clause) || ts.isNamespaceExport(clause))) found.push(`${where(file, clause.getStart())} *`);
    if (clause && (ts.isNamedImports(clause) || ts.isNamedExports(clause))) {
      for (const el of clause.elements) {
        const name = (el.propertyName ?? el.name).text;
        if (names(name)) found.push(`${where(file, el.getStart())} ${name}`);
      }
    }
  }
  return found;
}

const circleImports = (source: string, path = 'x.tsx') => importsOf(source, path, (s) => s === 'lucide-react' || s.startsWith('lucide-react/'), (n) => CIRCLES.has(n));
const statusMarkerImports = (source: string, path = 'x.tsx') => importsOf(source, path, (s) => /(?:^|\/)StatusMarker(?:\.tsx?)?$/.test(s), (n) => n === 'StatusMarker');

describe('Session marker', () => {
  it("DS-5.4: the guard catches Circle and CircleDot however they're imported, and lets other circles through", () => {
    const names = (source: string) => circleImports(source).map((s) => s.split(' ')[1]);
    expect(names(`import { Circle, CircleDot as Live } from 'lucide-react';\nimport { CircleIcon } from 'lucide-react';\nimport * as L from 'lucide-react';\nexport { LucideCircleDot } from 'lucide-react';`)).toEqual(['Circle', 'CircleDot', 'CircleIcon', '*', 'LucideCircleDot']);
    expect(circleImports(`import { CircleSlash, CircleX, CircleCheck, History } from 'lucide-react';\nimport { Circle } from './Circle';`)).toEqual([]);
  });

  it('DS-5.4: Circle and CircleDot are imported only in Answering.tsx, where they draw a question\'s options', () => {
    const found = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('.css') && !(path in CIRCLE_FILES))
      .flatMap(([path, text]) => circleImports(text, path).map((s) => `${path}:${s}`));
    expect(found).toEqual([]);
    for (const path of Object.keys(CIRCLE_FILES)) expect(circleImports(SOURCES[path] ?? '', path), path).not.toEqual([]);
  });

  it('DS-5.1: the lists draw a Session\'s marker only through SessionMarker: StatusMarker is imported by it and the header alone', () => {
    expect(statusMarkerImports(`import { StatusMarker } from './StatusMarker';\nimport { StatusMarker as M } from '@/components/StatusMarker';`).map((s) => s.split(' ')[1])).toEqual(['StatusMarker', 'StatusMarker']);
    const found = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('.css') && !(path in STATUS_MARKER_FILES))
      .flatMap(([path, text]) => statusMarkerImports(text, path).map((s) => `${path}:${s}`));
    expect(found).toEqual([]);
    for (const path of Object.keys(STATUS_MARKER_FILES)) expect(statusMarkerImports(SOURCES[path] ?? '', path), path).not.toEqual([]);
    for (const path of ['web/src/components/SessionItem.tsx', 'web/src/components/HistoryPanel.tsx', 'web/src/components/WorkPanel.tsx']) {
      expect(SOURCES[path], path).toMatch(/<SessionMarker\b/);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// DS-7.2: icon buttons keep their sizes

/** The JSX attribute `name` on an element, if it's there. */
const attr = (node: ts.JsxOpeningLikeElement, name: string) => node.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);

/** Every string inside an attribute's value (a literal, `cn(…)`, a conditional, a template). */
function stringsIn(node: ts.Node): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** A class that sets a box's size: `size-7`, `h-6`, `w-[30px]`, `min-h-8`, `max-w-4`, with any variant. */
const SIZE_UTILITY = /^(?:[\w-]+:|\[[^\]]+\]:)*!?(?:size|h|w|min-h|min-w|max-h|max-w)-\S+$/;

/** `<Button size="icon…">` and `<IconButton className="…size…">`, as `line:col what`. */
function iconButtonSizes(source: string, path = 'x.tsx'): string[] {
  const file = parse(source, path);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText();
      if (tag === 'Button') {
        const size = attr(node, 'size')?.initializer;
        if (size && stringsIn(size).some((v) => v.startsWith('icon'))) found.push(`${where(file, node.getStart())} Button size=${stringsIn(size).find((v) => v.startsWith('icon'))}`);
      }
      if (tag === 'IconButton') {
        const className = attr(node, 'className')?.initializer;
        for (const value of className ? stringsIn(className) : []) {
          for (const c of value.split(/\s+/).filter((c) => SIZE_UTILITY.test(c))) found.push(`${where(file, node.getStart())} IconButton ${c}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Tags that draw one icon besides lucide's own (imported from `lucide-react`). */
const ICON_TAGS = new Set(['HarnessIcon', 'MarkShape']);

/**
 * A `<button>` or `<Button>` with an icon and no words of its own: its children are icons (lucide's,
 * `HarnessIcon`, `MarkShape`), also in a conditional, and at most `aria-hidden` elements. As
 * `line:col <tag> fn`. These are `IconButton`s, whatever their classes (DS-7.2).
 */
function iconOnlyButtons(source: string, path = 'x.tsx'): string[] {
  const file = parse(source, path);
  const lucide = new Set<string>();
  for (const st of file.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text === 'lucide-react') {
      const named = st.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) for (const el of named.elements) lucide.add(el.name.text);
    }
  }
  const isIcon = (n: ts.JsxChild | ts.Expression): boolean => (ts.isJsxSelfClosingElement(n) || ts.isJsxElement(n)) && (lucide.has(tagOf(n)) || ICON_TAGS.has(tagOf(n)));
  const tagOf = (n: ts.JsxSelfClosingElement | ts.JsxElement) => (ts.isJsxElement(n) ? n.openingElement.tagName.getText() : n.tagName.getText());
  /** The icons and the things that make words in a child; `aria-hidden` elements make none. */
  const leaves = (n: ts.Node, out: { icons: number; words: number }) => {
    if (ts.isJsxText(n)) {
      if (n.text.trim()) out.words++;
    } else if (ts.isJsxExpression(n)) {
      if (n.expression) leaves(n.expression, out);
    } else if (ts.isParenthesizedExpression(n)) leaves(n.expression, out);
    else if (ts.isConditionalExpression(n)) {
      leaves(n.whenTrue, out);
      leaves(n.whenFalse, out);
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) leaves(n.right, out);
    else if (ts.isJsxSelfClosingElement(n) || ts.isJsxElement(n)) {
      const opening = ts.isJsxElement(n) ? n.openingElement : n;
      if (isIcon(n)) out.icons++;
      else if (!attr(opening, 'aria-hidden')) out.words++;
    } else if (ts.isJsxFragment(n)) n.children.forEach((c) => leaves(c, out));
    else if (n.kind === ts.SyntaxKind.NullKeyword || n.kind === ts.SyntaxKind.FalseKeyword) return;
    else out.words++;
  };
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && ['button', 'Button'].includes(node.openingElement.tagName.getText())) {
      const out = { icons: 0, words: 0 };
      node.children.forEach((c) => leaves(c, out));
      if (out.icons > 0 && out.words === 0) found.push(`${where(file, node.getStart())} <${node.openingElement.tagName.getText()}> ${enclosingFn(node)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Icon-only buttons that aren't `IconButton`s, outside `components/ui/`: where, and why. */
const ICON_ONLY_BUTTON_EXCEPTIONS: Exception[] = [
  { path: 'web/src/components/SessionView.tsx', fn: 'CopySessionId', count: 1, reason: 'Copy session ID shows "Copied" beside its icon for 2 s (VIEW-5.10), which a fixed square can\'t hold; 28 px tall' },
  { path: 'web/src/components/Markdown.tsx', fn: 'CopyButton', count: 1, reason: 'a code block\'s copy button: 24 px tall, shows "Copied" beside its icon for 2 s (VIEW-1.14), which a fixed square can\'t hold' },
  { path: 'web/src/components/ChatRail.tsx', fn: 'ChatRail', count: 1, reason: "a Mark on the chat's rail: a 12 px-tall target on the 16 px rail by design (VIEW-1.11), a toolbar's roving stop; not a button in a row" },
];

describe('icon buttons', () => {
  const what = (source: string) => iconButtonSizes(source).map((s) => s.split(' ').slice(1).join(' '));

  it('DS-7.2: the guard catches an icon-sized Button and an IconButton that sets its own size, and lets the rest through', () => {
    expect(what(`<Button size="icon-sm" />; <Button size={'icon'} />; <IconButton label="x" className="size-7" />; <IconButton label="x" className={cn('h-6', on && 'md:w-[30px]')} />; <IconButton label="x" className="min-h-8" />`)).toEqual([
      'Button size=icon-sm', 'Button size=icon', 'IconButton size-7', 'IconButton h-6', 'IconButton md:w-[30px]', 'IconButton min-h-8',
    ]);
    expect(what(`<Button size="sm" />; <IconButton label="x" size="md" className={cn('-my-0.5 text-foreground', on && 'bg-sidebar-accent')} />; <Other size="icon" className="size-7" />`)).toEqual([]);
  });

  it('DS-7.2: the guard finds a button with only an icon, however it is sized, and lets words, other children and IconButton through', () => {
    const what = (src: string) => iconOnlyButtons(`import { X, Copy, Check } from 'lucide-react';\n${src}`).map((s) => s.split(' ').slice(1).join(' '));
    expect(
      what(`function A() { return <><button aria-label="a"><X className="size-3" /></button><Button size="xs" className="size-6"><X /></Button><button>{on ? <Check /> : <Copy />}{said && <span aria-hidden>{said}</span>}</button><button><HarnessIcon harness="x" /></button></>; }`),
    ).toEqual(['<button> A', '<Button> A', '<button> A', '<button> A']);
    expect(what(`function A() { return <><button><X /> Close</button><Button><X />{label}</Button><button><span>Copied</span></button><IconButton label="x"><X /></IconButton><button>text</button><Other><X /></Other></>; }`)).toEqual([]);
  });

  it('DS-7.2: a button with only an icon is an IconButton, outside components/ui and the listed exceptions', () => {
    const found = Object.entries(SOURCES)
      .filter(([path]) => /\.tsx$/.test(path) && !path.startsWith('web/src/components/ui/'))
      .flatMap(([path, text]) => iconOnlyButtons(text, path).map((s) => `${path}:${s}`));
    const { unlisted, counts } = againstExceptions(found, ICON_ONLY_BUTTON_EXCEPTIONS);
    expect(unlisted).toEqual([]);
    expect(counts).toEqual(ICON_ONLY_BUTTON_EXCEPTIONS.map(({ path, fn, count }) => ({ path, fn, count })));
  });

  it('DS-7.2: no Button outside components/ui takes an icon size, and no IconButton sets its own', () => {
    const found = Object.entries(SOURCES)
      .filter(([path]) => /\.tsx$/.test(path) && !path.startsWith('web/src/components/ui/'))
      .flatMap(([path, text]) => iconButtonSizes(text, path).map((s) => `${path}:${s}`));
    expect(found).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// DS-7.1, DS-7.4: a 20 px icon only in the labelled button size

/** `size-5` (20 px) as a class, with any variant (`[&>svg]:size-5`), as `line:col what`. */
const twentyPx = (source: string, path = 'x.tsx') => scan(source, path, new RegExp(`${CLASS_HEAD}size-5(?=$|[\\s"'\`)\\],;])`, 'g'));

describe('the labelled button size', () => {
  it('DS-7.1: the guard catches a 20 px size however it is written, and lets other sizes through', () => {
    expect(twentyPx(`<X className="size-5" />; cn('[&>svg]:size-5', on && 'md:size-5'); <Y className="size-50 size-4 size-3.5 gap-5" />`).map((s) => s.split(' ')[1])).toEqual(['size-5', 'size-5', 'size-5']);
  });

  it('DS-7.1, DS-7.4: a 20 px icon comes only from components/ui, where the labelled size gives it to the buttons of an expanded Work row and History result', () => {
    const found = Object.entries(SOURCES)
      .filter(([path]) => /\.tsx?$/.test(path) && !path.startsWith('web/src/components/ui/'))
      .flatMap(([path, text]) => twentyPx(text, path).map((s) => `${path}:${s}`));
    expect(found).toEqual([]);
    expect(twentyPx(SOURCES['web/src/components/ui/icon-button.tsx'] ?? '').length).toBeGreaterThan(0);
    for (const path of ['web/src/components/WorkPanel.tsx', 'web/src/components/HistoryPanel.tsx']) expect(SOURCES[path], path).toMatch(/<RowAction\b/);
  });
});

// ---------------------------------------------------------------------------------------------
// DS-8.2, DS-8.4: one key, one command block

/** `<kbd` written as JSX, and `select-all` in a class, as `line:col what`. */
function keysAndCommands(source: string, path = 'x.tsx'): string[] {
  const file = parse(source, path);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText() === 'kbd') found.push(`${where(file, node.getStart())} <kbd>`);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...found, ...scan(source, path, new RegExp(`${CLASS_HEAD}select-all(?=$|[\\s"'\`)\\],;])`, 'g'))];
}

describe('keys and commands', () => {
  it('DS-8.2, DS-8.4: the guard catches a hand-drawn key and a hand-drawn command, and lets Kbd and CommandBlock through', () => {
    expect(keysAndCommands(`<kbd>/</kbd>; <pre className="select-all" />; cn('p-2', 'md:select-all')`).map((s) => s.split(' ')[1])).toEqual(['<kbd>', 'select-all', 'select-all']);
    expect(keysAndCommands(`<Kbd>/</Kbd>; <CommandBlock>{c}</CommandBlock>; 'select-none select-text'`)).toEqual([]);
  });

  it('DS-8.2, DS-8.4: keys are drawn only by Kbd, and commands to copy only by CommandBlock', () => {
    const own: Record<string, string> = { 'web/src/components/ui/kbd.tsx': '<kbd>', 'web/src/components/ui/command-block.tsx': 'select-all' };
    const found = Object.entries(SOURCES)
      .filter(([path]) => /\.tsx?$/.test(path))
      .flatMap(([path, text]) => keysAndCommands(text, path).filter((s) => s.split(' ')[1] !== own[path]).map((s) => `${path}:${s}`));
    expect(found).toEqual([]);
  });
});
