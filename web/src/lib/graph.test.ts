import { describe, expect, it } from 'vitest';
import { NODE_H, NODE_SIZES, NODE_W, type Point, arrange, border, bounds, overlaps, placeMissing, placeNew, ring, sizeStep } from './graph';

/** Whether the straight line from `a` to `b` runs under the node centred at `c`. */
const under = (a: Point, b: Point, c: Point) =>
  Array.from({ length: 101 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / 100, y: a.y + ((b.y - a.y) * i) / 100 })).some((p) => Math.abs(p.x - c.x) < NODE_W / 2 && Math.abs(p.y - c.y) < NODE_H / 2);

describe('the graph’s layout (TOPIC-7.2)', () => {
  it('TOPIC-7.2: a node with no position is placed on a spiral clear of the placed ones and of each other', () => {
    const placed = [{ x: 400, y: 300 }, { x: 640, y: 300 }];
    const fresh = placeNew(placed, 12, { x: 520, y: 300 });
    expect(fresh).toHaveLength(12);
    const all = [...placed, ...fresh];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]!, all[j]!)).toBe(false);
    // The same nodes give the same places.
    expect(placeNew(placed, 12, { x: 520, y: 300 })).toEqual(fresh);
  });

  it('TOPIC-7.2: "Arrange" lays 30 nodes out within the pane’s width, none overlapping, linked ones nearer, the same way every time', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `t${i}`);
    const edges = [{ from: 't0', to: 't1' }, { from: 't1', to: 't2' }, { from: 't5', to: 't29' }];
    const size = { width: 1000, height: 700 };
    const laid = arrange(ids, edges, size);
    const p = ids.map((id) => laid.get(id)!);
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) expect(overlaps(p[i]!, p[j]!), `${ids[i]} and ${ids[j]}`).toBe(false);
    const dist = (a: string, b: string) => Math.hypot(laid.get(a)!.x - laid.get(b)!.x, laid.get(a)!.y - laid.get(b)!.y);
    const mean = ids.slice(1).reduce((s, id) => s + dist('t0', id), 0) / (ids.length - 1);
    expect(dist('t0', 't1')).toBeLessThan(mean);
    expect(arrange(ids, edges, size)).toEqual(laid);
    // As wide as the pane at most, so it reads at scale 1 with no sideways scrolling (TOPIC-7.5).
    expect(bounds(p, { width: 0, height: 0 }, 0).width).toBeLessThanOrEqual(size.width);
  });

  it('TOPIC-7.2: a first open, with no node placed, lays every node out as Arrange does, so no Edge runs under another node; a later node goes on the spiral', () => {
    const ids = ['crm', 'companies', 'datagrid', 'proposals'];
    const edges = ['companies', 'datagrid', 'proposals'].map((from) => ({ from, to: 'crm' }));
    const size = { width: 1550, height: 1180 };
    const first = placeMissing([], ids, edges, size);
    expect(first).toEqual(ids.map((id) => arrange(ids, edges, size).get(id)));
    const at = new Map(ids.map((id, i) => [id, first[i]!]));
    for (const e of edges) for (const id of ids) if (id !== e.from && id !== e.to) expect(under(at.get(e.from)!, at.get(e.to)!, at.get(id)!), `${e.from} to ${e.to} under ${id}`).toBe(false);
    expect(placeMissing(first, ['later'], edges, size)).toEqual(placeNew(first, 1, { x: first.reduce((s, p) => s + p.x, 0) / 4, y: first.reduce((s, p) => s + p.y, 0) / 4 }));
    expect(placeMissing(first, [], edges, size)).toEqual([]);
  });

  it('TOPIC-7.2: "Arrange" lays each group of linked Topics out in layers, an Edge\u2019s second Topic above its first, the biggest group first; Topics with no Edge go in a grid under them, the biggest first', () => {
    const ids = ['lone-small', 'crm', 'companies', 'proposals', 'deal-panel', 'deal-header', 'kg', 'hygiene', 'lone-big'];
    const edges = [
      { from: 'companies', to: 'crm' },
      { from: 'proposals', to: 'crm' },
      { from: 'deal-panel', to: 'crm' },
      { from: 'deal-header', to: 'deal-panel' },
      { from: 'hygiene', to: 'kg' },
      // Skips the layer between, where it must not run under a node.
      { from: 'deal-header', to: 'crm' },
    ];
    const step: Record<string, 's' | 'm' | 'l'> = { crm: 'l', companies: 'l', proposals: 'l', 'lone-big': 'm' };
    const sizeOf = (id: string) => NODE_SIZES[step[id] ?? 's'];
    const size = { width: 1400, height: 900 };
    const laid = arrange(ids, edges, size, sizeOf);
    const y = (id: string) => laid.get(id)!.y;
    // Layers: "part of" reads upwards, two layers for a chain of two.
    expect(y('crm')).toBeLessThan(y('companies'));
    expect(y('companies')).toBe(y('proposals'));
    expect(y('deal-panel')).toBe(y('companies'));
    expect(y('deal-header')).toBeGreaterThan(y('deal-panel'));
    expect(y('kg')).toBeLessThan(y('hygiene'));
    // The bigger group is on the left; the lone Topics under every group, the bigger one first.
    expect(laid.get('crm')!.x).toBeLessThan(laid.get('kg')!.x);
    const lowest = Math.max(...['crm', 'companies', 'proposals', 'deal-panel', 'deal-header', 'kg', 'hygiene'].map(y));
    expect(y('lone-big')).toBeGreaterThan(lowest);
    expect(laid.get('lone-big')!.x).toBeLessThan(laid.get('lone-small')!.x);
    // Whatever their sizes, no two overlap, and the whole fits the pane's width.
    for (const a of ids) for (const b of ids) if (a < b) expect(overlaps(laid.get(a)!, laid.get(b)!, sizeOf(a), sizeOf(b)), `${a} and ${b}`).toBe(false);
    expect(bounds(ids.map((id) => ({ ...laid.get(id)!, size: sizeOf(id) })), { width: 0, height: 0 }, 0).width).toBeLessThanOrEqual(size.width);
    expect(arrange(ids, edges, size, sizeOf)).toEqual(laid);
    const sizedUnder = (a: Point, b: Point, id: string) => {
      const c = laid.get(id)!;
      return Array.from({ length: 101 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / 100, y: a.y + ((b.y - a.y) * i) / 100 })).some((p) => Math.abs(p.x - c.x) < sizeOf(id).w / 2 && Math.abs(p.y - c.y) < sizeOf(id).h / 2);
    };
    for (const e of edges) for (const id of ids) if (id !== e.from && id !== e.to) expect(sizedUnder(laid.get(e.from)!, laid.get(e.to)!, id), `${e.from} to ${e.to} under ${id}`).toBe(false);
  });

  it('TOPIC-7.7: a node is small, medium or large by its members and its Edges, an Edge counting twice', () => {
    expect([sizeStep(0, 0), sizeStep(7, 0), sizeStep(8, 0), sizeStep(4, 2), sizeStep(23, 0), sizeStep(24, 0), sizeStep(18, 3)]).toEqual(['s', 's', 'm', 'm', 'm', 'l', 'l']);
    expect(NODE_SIZES.s.w).toBeLessThan(NODE_SIZES.m.w);
    expect(NODE_SIZES.m.w).toBeLessThan(NODE_SIZES.l.w);
    // A new node goes beside the placed node it has an Edge with, not in the middle of them all.
    const placed = [{ x: 100, y: 100 }, { x: 2000, y: 100 }];
    const [p] = placeMissing(placed, ['new'], [{ from: 'new', to: 'far' }], { width: 2200, height: 800 }, () => NODE_SIZES.s, new Map([['near', placed[0]!], ['far', placed[1]!]]));
    expect(Math.abs(p!.x - 2000)).toBeLessThan(Math.abs(p!.x - 100));
  });

  it('TOPIC-7.1: an Edge ends on its node’s border; members sit on a ring around their node; the view holds every node', () => {
    expect(border({ x: 0, y: 0 }, { x: 500, y: 0 })).toEqual({ x: 500 - NODE_W / 2, y: 0 });
    expect(border({ x: 500, y: -400 }, { x: 500, y: 0 })).toEqual({ x: 500, y: -NODE_H / 2 });
    const around = ring({ x: 0, y: 0 }, 4);
    expect(around[0]!.y).toBeLessThan(-NODE_H / 2);
    expect(around.every((m) => !(Math.abs(m.x) < NODE_W / 2 && Math.abs(m.y) < NODE_H / 2))).toBe(true);
    expect(bounds([], { width: 800, height: 600 })).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    const b = bounds([{ x: 0, y: 0 }, { x: 2000, y: 0 }], { width: 800, height: 600 });
    expect(b.x).toBeLessThan(-NODE_W / 2);
    expect(b.x + b.width).toBeGreaterThan(2000 + NODE_W / 2);
  });
});
