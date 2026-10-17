import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Decision 0008: UI icons come only from lucide-react. This guard reads the UI source (web/src and
 * shared, tests left out) and fails on:
 * - an emoji or pictograph symbol in a string, template or JSX text (comments aren't UI);
 * - a hand-drawn `<svg>` outside the files allowed to draw their own shapes;
 * - an image or SVG file import, or a package outside the known set (lucide-react, and simple-icons in HarnessIcon, are the icon ones).
 * TypeScript's own parser finds the strings, so nothing in code or comments can hide them.
 */

/** Every UI source file, as text, keyed by its path from the repo root. */
const SOURCES = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['../**/*.{ts,tsx,css}', '../../../shared/**/*.ts', '!../**/*.test.{ts,tsx}', '!../../../shared/**/*.test.ts', '!./**'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([path, text]) => [path.replace(/^\.\.\/\.\.\/\.\.\//, '').replace(/^\.\.\//, 'web/src/'), text]),
);

/**
 * Files that draw with `<svg>`: the Harness logos and the Status shapes (both 0008 exceptions), and
 * the Session row's context gauge (`ContextRing`), a tiny chart of a number rather than an icon.
 * The chat rail's Marks are CSS shapes and need no entry.
 */
const SVG_FILES = new Set(['web/src/components/HarnessIcon.tsx', 'web/src/components/StatusMarker.tsx', 'web/src/components/SessionItem.tsx']);

/**
 * The packages UI source may import. Any other package fails the guard until someone checks it isn't
 * an icon library (react-feather, @mdi/*, react-icons, @heroicons/* …) and adds it here. lucide-react
 * and its subpaths are allowed anywhere; simple-icons only in the file named, for the Harness logos.
 */
const PACKAGES: Record<string, string | true> = {
  'lucide-react': true,
  'simple-icons': 'web/src/components/HarnessIcon.tsx',
  react: true,
  'react-dom': true,
  'react-markdown': true,
  'remark-gfm': true,
  'radix-ui': true,
  'class-variance-authority': true,
  clsx: true,
  'tailwind-merge': true,
};

/** An image file, SVG included: a hand-drawn icon by another route (`./warning.svg`, `@/assets/x.svg?react`). */
const IMAGE_FILE = /\.(svg|png|jpe?g|gif|webp|avif|ico|bmp)(\?.*)?$/i;

/** The package a bare specifier names (`@mdi/js/x` → `@mdi/js`, `lucide-react/dist/x` → `lucide-react`); null for local paths. */
function packageOf(specifier: string): string | null {
  if (/^(\.|\/|@\/|@shared\/)/.test(specifier)) return null;
  const parts = specifier.replace(/^node:/, '').split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/** Modifier glyphs only ever name a key, so they're allowed in any text ("⌘N in the installed app"). */
const MODIFIERS = new Set([...'⌘⌥⇧⌃']);
/** Key glyphs that are also common as icons: allowed only in a `<kbd>` or a shortcut attribute. */
const KEYS = new Set([...'↵⏎⌫⌦⇥⎋↑↓']);
const SHORTCUT_ATTRIBUTES = new Set(['keys', 'title', 'aria-keyshortcuts']);

/** Typographic signs that `\p{Extended_Pictographic}` counts but aren't icons. */
const TYPOGRAPHIC = new Set([...'©®™']);

/**
 * Emoji, plus the symbol blocks that get used as icons: bullets and chevrons (• ‹ ›), arrows,
 * circled operators (⊘), "more" ellipses (⋮ ⋯), technical symbols, enclosed alphanumerics, box
 * shapes (● ○ ◆ ▸), miscellaneous symbols and dingbats (⚠ ⛔ ☑ ✓), and the variation selector
 * that turns a symbol into an emoji.
 */
const PICTOGRAPH =
  /\p{Extended_Pictographic}|[•‹›←-⇿⊕-⊡⋮⋯⌀-⏿①-⓿■-◿☀-➿⤀-⥿⬀-⯿]|️/gu;

/** `×` is fine in counts ("Read ×3", `×${n}`); as a whole string or JSX text it's a close icon. */
const LONE_TIMES = /^\s*×\s*$/;

/** Whether a string sits in a `<kbd>` or a shortcut attribute such as `keys={['↑', '↓']}`. */
function inShortcutHint(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isJsxAttribute(n)) return SHORTCUT_ATTRIBUTES.has(n.name.getText());
    if (ts.isJsxElement(n)) return n.openingElement.tagName.getText() === 'kbd';
  }
  return false;
}

function where(file: ts.SourceFile, pos: number): string {
  const { line, character } = file.getLineAndCharacterOfPosition(pos);
  return `${line + 1}:${character + 1}`;
}

/** Symbols used as icons in one file, as `line:col symbol`. */
function iconSymbols(source: string, path = 'x.tsx'): string[] {
  if (path.endsWith('.css')) return cssSymbols(source);
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const check = (node: ts.Node, text: string, start: number, whole = true) => {
    if (whole && LONE_TIMES.test(text)) found.push(`${where(file, start)} ×`);
    for (const m of text.matchAll(PICTOGRAPH)) {
      const c = m[0];
      if (MODIFIERS.has(c) || TYPOGRAPHIC.has(c) || (KEYS.has(c) && inShortcutHint(node))) continue;
      found.push(`${where(file, start + m.index)} ${c}`);
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) check(node, node.text, node.pos); // getStart() would skip its leading spaces
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) check(node, node.text, node.getStart() + 1);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) check(node, node.text, node.getStart() + 1, false); // a part of a template, like `×${n}`
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** CSS has only block comments, so a regex strips them; anything left (e.g. `content: '⚠'`) counts. */
function cssSymbols(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  return [...code.matchAll(PICTOGRAPH)].filter((m) => !TYPOGRAPHIC.has(m[0])).map((m) => `${code.slice(0, m.index).split('\n').length} ${m[0]}`);
}

/** Hand-drawn `<svg>` elements, and imports, re-exports and `import()`s of image files or packages not allowed in `path`, as `line:col what`. */
function iconSources(source: string, path: string): { svg: string[]; imports: string[] } {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const svg: string[] = [];
  const imports: string[] = [];
  const checkImport = (node: ts.Node, specifier: ts.Node | undefined) => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return;
    const name = packageOf(specifier.text);
    const allowed = name === null ? true : PACKAGES[name];
    if (IMAGE_FILE.test(specifier.text) || !(allowed === true || allowed === path)) imports.push(`${where(file, node.getStart())} ${specifier.text}`);
  };
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === 'svg') svg.push(`${where(file, node.getStart())} <svg>`);
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) checkImport(node, node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) checkImport(node, node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { svg, imports };
}

describe('icons', () => {
  it('0008: the guard catches emoji and symbol icons in any string, template or JSX text', () => {
    const symbols = (source: string) => iconSymbols(source).map((s) => s.split(' ')[1]);
    expect(symbols(`<span>⛔</span>; {'⚠'}; x = '✓ ready'; y = \`☑ \${z} ●\`; '⊘'; '▸'; '🚀'`)).toEqual(['⛔', '⚠', '✓', '☑', '●', '⊘', '▸', '🚀']);
    // Icon-like characters outside the emoji blocks, and a lone × as a close button.
    expect(symbols(`<button aria-label="Close">×</button>; '⋮'; '⋯'; '•'; '›'`)).toEqual(['×', '⋮', '⋯', '•', '›']);
    // An arrow beside text is an icon, not a shortcut hint.
    expect(symbols(`<Button>Jump to latest ↓</Button>; 'Open →'`)).toEqual(['↓', '→']);
    // `/*` and `//` outside comments don't hide what follows (a regex comment stripper would).
    expect(symbols(`<input accept="image/*" />;\n<Button>⛔ Stop</Button>;\n/** doc */`)).toEqual(['⛔']);
    expect(symbols(`// matches web/src/*\n<span>⚠</span>`)).toEqual(['⚠']);
    expect(symbols(`const sep = '//'; const label = '⛔ limit';`)).toEqual(['⛔']);
  });

  it('0008: the guard lets comments, typography, modifier keys and shortcut hints through', () => {
    expect(
      iconSymbols(
        `// ● in a comment\n/* ⛔ */ const url = 'http://x';\n<kbd>⌘↵</kbd>; <Hint keys={['↑', '↓']} text="New Session (⌘N in the installed app)" />;\n<b title="Next (↓)">'Read ×3 · 2m…' © 2026 ™</b>`,
      ),
    ).toEqual([]);
  });

  it('0008: the guard says where it found a symbol', () => {
    expect(iconSymbols(`const a = 1;\nconst b = <i>ok ⚠</i>;`)).toEqual(['2:17 ⚠']);
    expect(iconSymbols(`/* ⚠ */\n.x::before { content: '⚠'; }`, 'x.css')).toEqual(['2 ⚠']);
  });

  it('0008: UI source has no emoji or symbol icons', () => {
    expect(Object.keys(SOURCES)).toEqual(expect.arrayContaining(['web/src/components/UsageStrip.tsx', 'web/src/index.css', 'shared/history.ts'])); // it reads the real tree
    expect(Object.keys(SOURCES).filter((path) => /\.test\.|^web\/src\/test\//.test(path))).toEqual([]);
    const found = Object.entries(SOURCES).flatMap(([path, text]) => iconSymbols(text, path).map((s) => `${path}:${s}`));
    expect(found).toEqual([]);
  });

  it('0008: the guard catches icon packages and image files, however they are imported', () => {
    const imports = (source: string, path = 'web/src/components/X.tsx') => iconSources(source, path).imports.map((s) => s.split(' ')[1]);
    expect(
      imports(
        [
          `import { Bell } from 'react-feather';`,
          `import { mdiBell } from '@mdi/js';`,
          `import Icon from '@mdi/react';`,
          `import { FaBell } from 'react-icons/fa';`,
          `import { BellIcon } from '@heroicons/react/24/outline';`,
          `import { IconBell } from '@tabler/icons-react';`,
          `import { Bell } from '@phosphor-icons/react';`,
          `import warn from './warning.svg';`,
          `import Warn from '@/assets/warning.svg?react';`,
          `import logo from '../logo.png';`,
          `export { FaBell } from 'react-icons/fa';`,
          `export * from '@heroicons/react/24/solid';`,
          `const icons = await import('react-icons/fa');`,
          `const svg = import('./warning.svg');`,
          `import { siClaude } from 'simple-icons';`,
        ].join('\n'),
      ),
    ).toEqual([
      'react-feather',
      '@mdi/js',
      '@mdi/react',
      'react-icons/fa',
      '@heroicons/react/24/outline',
      '@tabler/icons-react',
      '@phosphor-icons/react',
      './warning.svg',
      '@/assets/warning.svg?react',
      '../logo.png',
      'react-icons/fa',
      '@heroicons/react/24/solid',
      'react-icons/fa',
      './warning.svg',
      'simple-icons', // only HarnessIcon may use it
    ]);
  });

  it('0008: the guard lets lucide-react, its subpaths, known packages and local modules through', () => {
    const source = [
      `import { Bell, type LucideIcon } from 'lucide-react';`,
      `import dynamicIconImports from 'lucide-react/dynamicIconImports';`,
      `import X from 'lucide-react/dist/esm/icons/x';`,
      `export { Bell } from 'lucide-react';`,
      `const icon = import('lucide-react/dist/esm/icons/bell');`,
      `import { useState } from 'react';`,
      `import { createRoot } from 'react-dom/client';`,
      `import { cn } from '@/lib/utils';`,
      `import type { UsageLevel } from '@shared/usage.ts';`,
      `export * from './icons';`,
      `import { iconFor } from '../lib/icon-for';`,
    ].join('\n');
    expect(iconSources(source, 'web/src/components/X.tsx').imports).toEqual([]);
    expect(iconSources(`import { siClaude } from 'simple-icons';`, 'web/src/components/HarnessIcon.tsx').imports).toEqual([]);
  });

  it('0008: icons come from lucide-react; only the 0008 exceptions draw their own <svg>', () => {
    expect(Object.keys(SOURCES)).toEqual(expect.arrayContaining([...SVG_FILES])); // the exceptions still exist
    const found = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('.css'))
      .flatMap(([path, text]) => {
        const { svg, imports } = iconSources(text, path);
        return [...(SVG_FILES.has(path) ? [] : svg), ...imports].map((s) => `${path}:${s}`);
      });
    expect(found).toEqual([]);
  });
});
