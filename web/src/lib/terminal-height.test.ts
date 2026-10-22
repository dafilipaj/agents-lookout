import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HEIGHT, MIN_HEIGHT, clampHeight, drawerHeight, heightBounds, keepHeight, parseHeights, pruneHeights, readHeightsRaw } from './terminal-height';

const KEY = 'lookout.terminal';
const stored = () => JSON.parse(window.localStorage.getItem(KEY) ?? 'null');

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('terminal preview height (DS-11)', () => {
  it('DS-11.1: with none kept, the default is 285 px or 35% of the main pane, whichever is smaller', () => {
    expect(drawerHeight(1000, undefined)).toBe(DEFAULT_HEIGHT); // 350 > 285
    expect(drawerHeight(600, undefined)).toBe(210); // 35% of 600
    // A kept height wins over the default.
    expect(drawerHeight(1000, 400)).toBe(400);
  });

  it('DS-11.1: the default keeps the preview as tall as before it could be resized: a 256 px text area under the 28 px Terminal row, plus the top border', () => {
    expect(DEFAULT_HEIGHT).toBe(256 + 28 + 1);
  });

  it('DS-11.2: the content row, less the chat’s 96 px, caps it too, when it is measured', () => {
    expect(heightBounds(900, 500)).toEqual({ min: MIN_HEIGHT, max: 404 }); // 70% of 900 is 630
    expect(heightBounds(900, 2000)).toEqual({ min: MIN_HEIGHT, max: 630 });
    expect(heightBounds(900, undefined)).toEqual({ min: MIN_HEIGHT, max: 630 });
    expect(heightBounds(900, 120)).toEqual({ min: MIN_HEIGHT, max: MIN_HEIGHT });
    expect(drawerHeight(900, 630, 500)).toBe(404);
  });

  it('DS-11.2: the height stays between the Terminal row plus four lines and 70% of the main pane', () => {
    // 1 px border + 28 px row + 16 px padding + 4 lines of 17.4 px.
    expect(MIN_HEIGHT).toBe(115);
    expect(heightBounds(1000)).toEqual({ min: MIN_HEIGHT, max: 700 });
    expect(clampHeight(50, 1000)).toBe(MIN_HEIGHT);
    expect(clampHeight(900, 1000)).toBe(700);
    expect(clampHeight(333.4, 1000)).toBe(333);
    // A pane too short for both: the minimum holds, and the layout shrinks the preview (SIDE-8.1).
    expect(heightBounds(100)).toEqual({ min: MIN_HEIGHT, max: MIN_HEIGHT });
    // The default is clamped too.
    expect(drawerHeight(200, undefined)).toBe(MIN_HEIGHT);
  });

  it('DS-11.3: kept per Session by its id; one Session’s height leaves another’s alone; a kept height too tall for the window shows clamped and stays kept as it was', () => {
    keepHeight('a', 300);
    keepHeight('b', 180);
    keepHeight('a', 320);
    expect(stored()).toEqual({ a: 320, b: 180 });
    const kept = parseHeights(readHeightsRaw());
    expect(drawerHeight(1000, kept.a)).toBe(320);
    expect(drawerHeight(1000, kept.b)).toBe(180);
    // A smaller window: shown at 70% of the pane, still kept at 320.
    expect(drawerHeight(400, kept.a)).toBe(280);
    expect(stored().a).toBe(320);
  });

  it('DS-11.5: heights of Sessions no longer listed are pruned; a Codex Session’s follows its new id; nothing is written when nothing changed', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ a: 300, gone: 200, 'codex:42': 150 }));
    const set = vi.spyOn(Storage.prototype, 'setItem');
    pruneHeights(new Set(['a', 'b', 'thread-1']), new Map([['codex:42', 'thread-1']]));
    expect(stored()).toEqual({ a: 300, 'thread-1': 150 });
    set.mockClear();
    pruneHeights(new Set(['a', 'thread-1']));
    expect(set).not.toHaveBeenCalled();
    // Every Session gone: the entry goes.
    pruneHeights(new Set());
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('DS-11.5: storage that holds junk, or fails to read or write, falls back to the default without an error', () => {
    for (const junk of ['not json', '[1,2]', '"x"', 'null', '{"a":"tall","b":-5,"c":null,"d":1e999}']) {
      window.localStorage.setItem(KEY, junk);
      expect(parseHeights(readHeightsRaw())).toEqual({});
      expect(drawerHeight(1000, parseHeights(readHeightsRaw()).a)).toBe(DEFAULT_HEIGHT);
    }
    // Junk is cleared by the next prune.
    window.localStorage.setItem(KEY, 'not json');
    pruneHeights(new Set(['a']));
    expect(window.localStorage.getItem(KEY)).toBeNull();
    // Only the valid entries of a mixed map are read.
    expect(parseHeights('{"a":200,"b":"x"}')).toEqual({ a: 200 });

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(readHeightsRaw()).toBeNull();
    expect(() => keepHeight('a', 300)).not.toThrow();
    expect(() => pruneHeights(new Set(['a']))).not.toThrow();
    // Nothing is stored, but this page remembers (below).
    expect(drawerHeight(1000, parseHeights(readHeightsRaw()).a)).toBe(300);
    vi.restoreAllMocks();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    // Storage back: the next write goes through and storage is the truth again.
    keepHeight('b', 200);
    expect(stored()).toEqual({ a: 300, b: 200 });
  });

  it('DS-11.5: with storage blocked, what is kept lasts for the page: a later keep adds to it, a prune drops what is gone', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    keepHeight('a', 300);
    keepHeight('b', 180);
    expect(parseHeights(readHeightsRaw())).toEqual({ a: 300, b: 180 });
    pruneHeights(new Set(['b']));
    expect(parseHeights(readHeightsRaw())).toEqual({ b: 180 });
    vi.restoreAllMocks();
    keepHeight('c', 150); // storage works again: it clears the page's own copy
    expect(stored()).toEqual({ b: 180, c: 150 });
  });

  it('DS-11.5: invalid values inside an otherwise valid map are cleared by the next prune', () => {
    window.localStorage.setItem(KEY, '{"a":200,"b":"x"}');
    pruneHeights(new Set(['a']));
    expect(stored()).toEqual({ a: 200 });
  });
});
