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
      'needs-you': 'bg-needs-you text-needs-you-foreground',
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
      expect(tokens(STATUS_TAG_CLASS[s])).toEqual(s === 'needs-you' ? ['needs-you', 'needs-you-foreground'] : [`${own}-soft`, `${own}-text`]);
      for (const t of tokens(STATUS_TAG_CLASS[s])) expect(themed(t)).toEqual({ token: t, light: true, dark: true, theme: true });
    }
  });

  const THEMES = themeTokens(css);
  const MODES: Mode[] = ['light', 'dark'];
  type Themes = ReturnType<typeof themeTokens>;
  type Measure = { what: string; ratio: number };

  it('DS-12.1: the neutrals take the token table’s cool tint in both modes, while Status and semantic hues keep their chroma', () => {
    const neutrals = [
      ['background', '0.995 0.002 270', '0.19 0.013 270'],
      ['foreground card-foreground popover-foreground sidebar-foreground', '0.17 0.012 270', '0.96 0.004 270'],
      ['card popover', '1 0 0', '0.22 0.014 270'],
      ['secondary', '0.955 0.008 270', '0.26 0.016 270'],
      ['muted', '0.955 0.008 270', '0.25 0.016 270'],
      ['secondary-foreground accent-foreground', '0.21 0.012 270', '0.96 0.004 270'],
      ['muted-foreground', '0.5 0.018 270', '0.71 0.016 270'],
      ['accent', '0.945 0.01 270', '0.26 0.016 270'],
      ['border', '0.9 0.009 270', '1 0 0 / 10%'],
      ['input', '0.9 0.009 270', '1 0 0 / 15%'],
      ['sidebar-border', '0.9 0.009 270', '1 0 0 / 8%'],
      ['sidebar', '0.962 0.008 270', '0.155 0.012 270'],
      ['sidebar-accent', '0.925 0.01 270', '0.235 0.016 270'],
    ];
    for (const [names, lightValue, darkValue] of neutrals) {
      for (const name of names!.split(' ')) {
        expect(themed(name)).toEqual({ token: name, light: true, dark: true, theme: true });
        expect(THEMES.light[name], `light ${name}`).toEqual(parseOklch(lightValue!));
        expect(THEMES.dark[name], `dark ${name}`).toEqual(parseOklch(darkValue!));
      }
    }
    const chromas = [
      ['needs-you warning', 0.17, 0.15], ['needs-you-soft', 0.04, 0.15], ['needs-you-text warning-text', 0.13, 0.12],
      ['busy', 0.15, 0.13], ['busy-soft', 0.035, 0.13], ['busy-text', 0.15, 0.1],
      ['destructive destructive-soft', 0.245, 0.191], ['destructive-text', 0.21, 0.15],
      ['ok', 0.13, 0.14], ['ok-text', 0.12, 0.14],
      ['idle idle-soft idle-text info-soft info-border info-text highlight', 0, 0],
    ] as const;
    for (const [names, lightChroma, darkChroma] of chromas) for (const name of names.split(' ')) {
      expect(THEMES.light[name]!.c, `light ${name}`).toBe(lightChroma);
      expect(THEMES.dark[name]!.c, `dark ${name}`).toBe(darkChroma);
    }
    expect(below([...rowContrasts(THEMES), ...tagContrasts(THEMES), ...dsContrasts(THEMES), ...contextContrasts(THEMES)])).toEqual([]);
  });

  it('DS-12.2: the sidebar plane is darker than the background by at least 0.03 lightness in both modes, with readable text', () => {
    for (const mode of MODES) {
      const t = THEMES[mode];
      expect(t.background!.l - t.sidebar!.l, mode).toBeGreaterThanOrEqual(0.03);
      expect(contrast(solid(t, 'sidebar-foreground'), solid(t, 'sidebar')), mode).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('DS-12.3: Primary takes Productive’s indigo values, with readable buttons and bubbles and a visible ring against both planes', () => {
    const values = [
      ['primary', '0.52 0.2 281', '0.55 0.19 281'],
      ['primary-foreground', '0.99 0 0', '0.99 0 0'],
      ['primary-soft', '0.95 0.035 281', '0.6 0.17 281 / 20%'],
      ['ring', '0.52 0.2 281', '0.74 0.14 281'],
    ];
    for (const [name, lightValue, darkValue] of values) {
      expect(themed(name!)).toEqual({ token: name, light: true, dark: true, theme: true });
      expect(THEMES.light[name!]).toEqual(parseOklch(lightValue!));
      expect(THEMES.dark[name!]).toEqual(parseOklch(darkValue!));
    }
    for (const mode of MODES) {
      const t = THEMES[mode];
      const bubble = paint(t, 'primary-soft', solid(t, 'background'));
      expect(contrast(solid(t, 'primary-foreground'), solid(t, 'primary')), `${mode} button`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(paint(t, 'foreground', bubble), bubble), `${mode} bubble`).toBeGreaterThanOrEqual(4.5);
      for (const ground of ['background', 'sidebar']) expect(contrast(solid(t, 'ring'), solid(t, ground)), `${mode} ring on ${ground}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('DS-12.5: Needs you has stronger row tints and a solid header tag, with readable text on every state in both modes', () => {
    expect(ROW_TONE.needsYou).toEqual({
      rest: 'bg-needs-you/16', hover: 'hover:bg-needs-you/22',
      selected: 'bg-needs-you/28 hover:bg-needs-you/28 ring-needs-you/70', quiet: 'text-foreground/70',
    });
    expect(STATUS_TAG_CLASS['needs-you']).toBe('bg-needs-you text-needs-you-foreground');
    expect(themed('needs-you-foreground')).toEqual({ token: 'needs-you-foreground', light: true, dark: true, theme: true });
    expect(THEMES.light['needs-you-text']).toEqual(parseOklch('0.48 0.13 55'));
    expect(THEMES.light['needs-you-foreground']).toEqual(parseOklch('0.2 0.045 55'));
    expect(THEMES.dark['needs-you-foreground']).toEqual(parseOklch('0.22 0.04 60'));
    expect(below([...rowContrasts(THEMES), ...tagContrasts(THEMES)])).toEqual([]);
  });

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

  it('SIDE-3.11 / SIDE-9.6: every text on a row, including the quiet Subagent count, keeps 4.5:1 or more at rest, under the pointer and selected, in both modes', () => {
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
    // A near-white waiting-for text, written in percent, fails on the row, not NaN and passes.
    const pale = themeTokens(css.replace(/(:root \{[^}]*--needs-you-text:\s*)oklch\([^)]+\)/, '$1oklch(97% 0.04 80)'));
    expect(pale.light['needs-you-text']).toEqual({ l: 0.97, c: 0.04, h: 80, a: 1 });
    expect(below(rowContrasts(pale)).some((m) => m.startsWith('light needsYou selected needs-you-text'))).toBe(true);
    // The solid tag's foreground matching its fill reads as 1:1 too.
    const paleTag = themeTokens(css.replace(/(:root \{[^}]*--needs-you-foreground:\s*)oklch\([^)]+\)/, '$1oklch(70% 0.17 60)'));
    const tag = tagContrasts(paleTag).find((m) => m.what === 'light needs-you')!;
    expect(tag.ratio).toBeCloseTo(1, 0);
    expect(below(tagContrasts(paleTag))).toContain(`light needs-you: ${tag.ratio.toFixed(2)}`);
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
    for (const mode of MODES) {
      expect(THEMES[mode].warning).toEqual(THEMES[mode]['needs-you']);
      for (const part of ['c', 'h'] as const) expect(THEMES[mode]['warning-text']![part]).toBe(THEMES[mode]['needs-you-text']![part]);
    }
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
    // DS-12's stronger tint needs 0.491: the next lighter step at 0.001 precision still fails.
    expect(THEMES.light['warning-text']).toEqual(parseOklch('0.491 0.13 55'));
    const lighter = themeTokens(css.replace(/(:root \{[^}]*--warning-text:\s*)oklch\([^)]+\)/, '$1oklch(0.492 0.13 55)'));
    expect(below(contextContrasts(lighter))).toEqual([expect.stringMatching(/^light needsYou selected warning warning-text:/)]);
  });
});
