import type { Status } from '@shared/types.ts';
import { describe, expect, it } from 'vitest';
import css from '@/index.css?raw';
import { type Mode, colourOf, contrast, paint, parseOklch, solid, themeTokens } from '@/test/contrast';
import { CONTEXT_LEVEL_CLASS, ROW_TONE, STATUS_STRIP_CLASS, STATUS_TAG_CLASS } from './sessions';

const STATUSES: Status[] = ['needs-you', 'busy', 'idle', 'unknown'];

/** index.css's three places a colour token lives: light (`:root`), dark (the media query) and the Tailwind theme. */
const light = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark) {'));
const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark) {'), css.indexOf('@theme inline'));
const theme = css.slice(css.indexOf('@theme inline'));

/** The colour tokens a set of classes uses (`bg-busy-soft text-busy-text` → busy-soft, busy-text). */
function tokens(classes: string): string[] {
  return [...classes.matchAll(/(?:^|\s)(?:bg|text)-([a-z-]+)(?=\s|$)/g), ...classes.matchAll(/var\(--color-([a-z-]+)\)/g)].map((m) => m[1]!);
}

/** Whether a token has a light and a dark value and a Tailwind colour. */
function themed(token: string) {
  return { token, light: light.includes(`--${token}:`), dark: dark.includes(`--${token}:`), theme: theme.includes(`--color-${token}: var(--${token});`) };
}

describe('Status colours', () => {
  it("SIDE-3.6: each Status's strip is its own Status's colour, which has light and dark values", () => {
    expect(STATUS_STRIP_CLASS['needs-you']).toBe('bg-needs-you');
    expect(STATUS_STRIP_CLASS.busy).toBe('bg-busy');
    expect(STATUS_STRIP_CLASS.idle).toBe('bg-idle');
    // Unknown's is Idle's grey, dashed like its marker's ring.
    expect(STATUS_STRIP_CLASS.unknown).toMatch(/^bg-\[repeating-linear-gradient\(.*var\(--color-idle\).*transparent.*\)\]$/);
    for (const s of STATUSES) {
      expect(tokens(STATUS_STRIP_CLASS[s])).toHaveLength(1);
      for (const t of tokens(STATUS_STRIP_CLASS[s])) expect(themed(t)).toEqual({ token: t, light: true, dark: true, theme: true });
    }
  });

  it("VIEW-5.9: each Status's header tag takes its own Status's colours, which have light and dark values", () => {
    expect(STATUS_TAG_CLASS).toEqual({
      'needs-you': 'bg-needs-you-soft text-needs-you-text',
      busy: 'bg-busy-soft text-busy-text',
      idle: 'bg-idle-soft text-idle-text',
      unknown: 'bg-idle-soft text-idle-text',
    });
    // Needs you, Busy and Idle no longer share one neutral grey (the bug: all but Needs you were `bg-muted`).
    expect(new Set([STATUS_TAG_CLASS['needs-you'], STATUS_TAG_CLASS.busy, STATUS_TAG_CLASS.idle]).size).toBe(3);
    for (const s of STATUSES) {
      expect(STATUS_TAG_CLASS[s]).not.toMatch(/bg-muted|text-foreground/);
      // A tag's colours are its Status's own: Unknown's are Idle's, as its marker is.
      const own = s === 'unknown' ? 'idle' : s;
      expect(tokens(STATUS_TAG_CLASS[s])).toEqual([`${own}-soft`, `${own}-text`]);
      for (const t of tokens(STATUS_TAG_CLASS[s])) expect(themed(t)).toEqual({ token: t, light: true, dark: true, theme: true });
    }
  });

  const THEMES = themeTokens(css);
  const MODES: Mode[] = ['light', 'dark'];
  type Themes = ReturnType<typeof themeTokens>;
  type Measure = { what: string; ratio: number };

  /** A sidebar row's background in each state, as `ROW_TONE` paints it over the sidebar. */
  function rowBackgrounds(themes: Themes, mode: Mode, tone: (typeof ROW_TONE)[keyof typeof ROW_TONE]) {
    const t = themes[mode];
    const sidebar = solid(t, 'sidebar');
    const layer = (c: ReturnType<typeof colourOf>) => (c ? paint(t, c.token, sidebar, c.alpha) : sidebar);
    return { rest: layer(colourOf(tone.rest, 'bg')), hover: layer(colourOf(tone.hover, 'hover:bg')), selected: layer(colourOf(tone.selected, 'bg')) };
  }

  /** SIDE-3.11: every text of a row on every state's background, in both modes. */
  function rowContrasts(themes: Themes): Measure[] {
    const out: Measure[] = [];
    for (const mode of MODES) {
      const t = themes[mode];
      for (const [kind, tone] of Object.entries(ROW_TONE)) {
        // The title (the sidebar's foreground), the quieter text, and on a Needs you row what it waits for.
        const texts = [{ token: 'sidebar-foreground', alpha: 1 }, colourOf(tone.quiet, 'text')!, ...(kind === 'needsYou' ? [{ token: 'needs-you-text', alpha: 1 }] : [])];
        for (const [state, under] of Object.entries(rowBackgrounds(themes, mode, tone))) {
          for (const text of texts) out.push({ what: `${mode} ${kind} ${state} ${text.token}`, ratio: contrast(paint(t, text.token, under, text.alpha), under) });
        }
      }
    }
    return out;
  }

  /** VIEW-5.9: each Status tag's text (its age included) on the tag, over the page, in both modes. */
  function tagContrasts(themes: Themes): Measure[] {
    const out: Measure[] = [];
    for (const mode of MODES) {
      const t = themes[mode];
      for (const s of STATUSES) {
        const bg = colourOf(STATUS_TAG_CLASS[s], 'bg')!;
        const text = colourOf(STATUS_TAG_CLASS[s], 'text')!;
        const under = paint(t, bg.token, solid(t, 'background'), bg.alpha);
        out.push({ what: `${mode} ${s}`, ratio: contrast(paint(t, text.token, under, text.alpha), under) });
      }
    }
    return out;
  }

  /** The measures under 4.5:1; each must be a finite number first, so NaN can't pass as "not below". */
  function below(measures: Measure[]): string[] {
    for (const m of measures) expect(Number.isFinite(m.ratio), m.what).toBe(true);
    return measures.filter((m) => m.ratio < 4.5).map((m) => `${m.what}: ${m.ratio.toFixed(2)}`);
  }

  it('SIDE-3.11: every text on a row keeps 4.5:1 or more on its background, at rest, under the pointer and selected, in both modes', () => {
    // Only `hover:` is measured: any other variant (`dark:`, `focus:`) would paint a colour the check never sees.
    for (const tone of Object.values(ROW_TONE)) for (const c of Object.values(tone).join(' ').split(/\s+/).filter(Boolean)) expect(c).toMatch(/^(?:hover:)?[^:]+$/);
    const measures = rowContrasts(THEMES);
    expect(measures).toHaveLength(2 * 3 * (3 + 2)); // light and dark × three states × the Needs you row's three texts and a plain row's two
    expect(below(measures)).toEqual([]);
    // The check can fail: the muted grey of plain rows is 3.6:1 on the selected tint in dark mode.
    const tint = rowBackgrounds(THEMES, 'dark', ROW_TONE.needsYou).selected;
    expect(contrast(paint(THEMES.dark, 'muted-foreground', tint), tint)).toBeLessThan(4.5);
  });

  it("VIEW-5.9: a tag's text, its age included, keeps 4.5:1 or more on the tag in both modes", () => {
    const measures = tagContrasts(THEMES);
    expect(measures).toHaveLength(2 * STATUSES.length);
    expect(below(measures)).toEqual([]);
  });

  it('SIDE-3.11 / VIEW-5.9 (support): a token written with percentages is read as CSS reads it, and a bad one fails the check', () => {
    expect(parseOklch('97% 0.04 80')).toEqual({ l: 0.97, c: 0.04, h: 80, a: 1 });
    expect(parseOklch('0.97 10% 80deg / 15%')).toEqual({ l: 0.97, c: 0.04, h: 80, a: 0.15 });
    for (const bad of ['none 0.04 80', '0.5 0.1', 'var(--x) 0 0', '0.5 0.1 80 / x', '50px 0 0', '0.5 0 10%']) expect(() => parseOklch(bad), bad).toThrow(/can't read oklch/);
    // A near-white Needs you text, written in percent, reads as 1:1 on its tag and fails, not NaN and passes.
    const pale = themeTokens(css.replace(/(:root \{[^}]*--needs-you-text:\s*)oklch\([^)]+\)/, '$1oklch(97% 0.04 80)'));
    expect(pale.light['needs-you-text']).toEqual({ l: 0.97, c: 0.04, h: 80, a: 1 });
    const tag = tagContrasts(pale).find((m) => m.what === 'light needs-you')!;
    expect(tag.ratio).toBeCloseTo(1, 0);
    expect(below(tagContrasts(pale))).toContain(`light needs-you: ${tag.ratio.toFixed(2)}`);
    expect(below(rowContrasts(pale)).some((m) => m.startsWith('light needsYou selected needs-you-text'))).toBe(true);
    // A token the reader can't read fails loudly instead of measuring NaN.
    expect(() => themeTokens(css.replace(/(:root \{[^}]*--needs-you-text:\s*)oklch\([^)]+\)/, '$1oklch(none 0.04 80)'))).toThrow(/can't read oklch/);
    // So does a dark colour written another way, which would otherwise measure as its light value.
    expect(() => themeTokens(css.replace(/(prefers-color-scheme: dark\) \{[^}]*--needs-you:\s*)oklch\([^)]+\)/, '$1#fff8d3'))).toThrow(/--needs-you isn't an oklch\(\) colour/);
    // And a background class it can't read, or two of them, instead of counting as no background.
    expect(() => colourOf('hover:bg-needs-you/[60%]', 'hover:bg')).toThrow(/can't read the colour/);
    expect(() => colourOf('bg-needs-you/12 bg-busy', 'bg')).toThrow(/more than one bg colour/);
  });

  /** DS-2.1: the design system's new colour tokens. */
  const DS_TOKENS = ['info-soft', 'info-border', 'info-text', 'highlight', 'warning', 'warning-text', 'destructive-soft'];

  it('DS-2.1: the new colour tokens have a light and a dark oklch() value and a Tailwind colour', () => {
    for (const t of DS_TOKENS) {
      expect(themed(t)).toEqual({ token: t, light: true, dark: true, theme: true });
      expect(light).toMatch(new RegExp(`--${t}:\\s*oklch\\(`));
      expect(dark).toMatch(new RegExp(`--${t}:\\s*oklch\\(`));
      // Read as colours in both modes (themeTokens refuses a colour token that isn't oklch()), and dark mode has its own.
      expect(THEMES.light[t], t).toBeDefined();
      expect(THEMES.dark[t], t).not.toEqual(THEMES.light[t]);
    }
    // Warning is amber like Needs you, but its own family, so the guard can keep them apart (DS spec, Key decisions).
    for (const mode of MODES) for (const s of ['', '-text']) expect(THEMES[mode][`warning${s}`]).toEqual(THEMES[mode][`needs-you${s}`]);
  });

  /** DS-2.2: each new text colour on what it sits on, in both modes. */
  function dsContrasts(themes: Themes): Measure[] {
    const out: Measure[] = [];
    for (const mode of MODES) {
      const t = themes[mode];
      for (const ground of ['background', 'sidebar']) {
        const under = solid(t, ground);
        const infoBox = paint(t, 'info-soft', under);
        const hit = paint(t, 'highlight', under);
        out.push(
          { what: `${mode} info-text on info-soft over ${ground}`, ratio: contrast(paint(t, 'info-text', infoBox), infoBox) },
          { what: `${mode} info-text on ${ground}`, ratio: contrast(paint(t, 'info-text', under), under) },
          { what: `${mode} warning-text on ${ground}`, ratio: contrast(paint(t, 'warning-text', under), under) },
          { what: `${mode} foreground on highlight over ${ground}`, ratio: contrast(paint(t, 'foreground', hit), hit) },
        );
      }
    }
    return out;
  }

  it('DS-2.2: info-text, warning-text and the foreground on a highlight keep 4.5:1 or more on what they sit on, in both modes', () => {
    const measures = dsContrasts(THEMES);
    expect(measures).toHaveLength(2 * 2 * 4);
    expect(below(measures)).toEqual([]);
    // The check can fail: an info text as pale as its box reads 1:1.
    const pale = themeTokens(css.replace(/(:root \{[^}]*--info-text:\s*)oklch\([^)]+\)/, '$1oklch(0.965 0 0)'));
    expect(below(dsContrasts(pale)).some((m) => m.startsWith('light info-text on info-soft'))).toBe(true);
  });

  /** DS-3.5: a sidebar row's context number above 40% and 60%, on every row state, in both modes. */
  function contextContrasts(themes: Themes): Measure[] {
    const out: Measure[] = [];
    for (const mode of MODES) {
      const t = themes[mode];
      for (const [kind, tone] of Object.entries(ROW_TONE)) {
        for (const [state, under] of Object.entries(rowBackgrounds(themes, mode, tone))) {
          for (const level of ['warning', 'danger'] as const) {
            const text = colourOf(CONTEXT_LEVEL_CLASS[level]!, 'text')!;
            out.push({ what: `${mode} ${kind} ${state} ${level} ${text.token}`, ratio: contrast(paint(t, text.token, under, text.alpha), under) });
          }
        }
      }
    }
    return out;
  }

  it("DS-3.5: a sidebar row's context colours are the status line's, warning-text above 40% and destructive-text above 60%, and keep 4.5:1 on every row state", () => {
    expect(CONTEXT_LEVEL_CLASS).toEqual({ normal: null, warning: 'text-warning-text', danger: 'text-destructive-text' });
    const measures = contextContrasts(THEMES);
    expect(measures).toHaveLength(2 * 2 * 3 * 2);
    expect(below(measures)).toEqual([]);
  });
});
