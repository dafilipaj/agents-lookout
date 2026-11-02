import type { TopicPosition } from '@shared/topics.ts';

/**
 * TOPIC-7: the graph's geometry, kept apart from the drawing so it can be tested on its own. A
 * position is a node's centre in the graph's units (CSS pixels at scale 1). No graph library
 * (Technical approach): placing a new node is a spiral, "Arrange" groups of linked Topics in layers.
 */

export type Point = TopicPosition;

/** A Topic's node, at its smallest. */
export const NODE_W = 184;
export const NODE_H = 48;
export interface NodeSize {
  w: number;
  h: number;
}
/**
 * TOPIC-7.7: three node sizes, by how much a Topic holds: its members and its Edges, an Edge
 * counting twice (it ties the Topic into the graph). Steps, not a scale, so titles stay on the type
 * scale (DS-1): `body`, `prose`, `title`.
 */
export const NODE_SIZES = { s: { w: NODE_W, h: NODE_H }, m: { w: 216, h: 56 }, l: { w: 256, h: 64 } } as const satisfies Record<string, NodeSize>;
export type SizeStep = keyof typeof NODE_SIZES;
export const SIZE_WEIGHT = { m: 8, l: 24 } as const;
export function sizeStep(members: number, edges: number): SizeStep {
  const weight = members + 2 * edges;
  return weight >= SIZE_WEIGHT.l ? 'l' : weight >= SIZE_WEIGHT.m ? 'm' : 's';
}
const SMALL: NodeSize = NODE_SIZES.s;
/** The room kept between two nodes. */
const GAP_X = 32;
const GAP_Y = 40;
/** TOPIC-7.3: a member's small node. */
export const MEMBER_R = 13;

/** Whether two nodes centred here would touch, gaps included. */
export function overlaps(a: Point, b: Point, sa: NodeSize = SMALL, sb: NodeSize = SMALL): boolean {
  return Math.abs(a.x - b.x) < (sa.w + sb.w) / 2 + GAP_X && Math.abs(a.y - b.y) < (sa.h + sb.h) / 2 + GAP_Y;
}

/** A node already in the graph: where it is, and how big. */
export type Placed = Point & { size?: NodeSize };

/**
 * TOPIC-7.2: places new nodes on a spiral from `center`, each clear of the nodes already placed and
 * of the ones placed before it. One-shot: the result is stored, so it never moves again.
 */
export function placeNew(placed: readonly Placed[], count: number | readonly NodeSize[], center: Point): Point[] {
  const sizes = typeof count === 'number' ? Array.from({ length: count }, () => SMALL) : count;
  const taken = placed.map((p) => ({ p, size: p.size ?? SMALL }));
  const out: Point[] = [];
  // Golden-angle steps on a spiral stretched to the nodes' shape: wide rather than tall.
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let n = 0; out.length < sizes.length; n++) {
    const size = sizes[out.length]!;
    const r = 18 * Math.sqrt(n);
    const p = { x: Math.round(center.x + r * 2.4 * Math.cos(n * golden)), y: Math.round(center.y + r * Math.sin(n * golden)) };
    if (taken.some((q) => overlaps(p, q.p, size, q.size)) && n < 20_000) continue;
    taken.push({ p, size });
    out.push(p);
  }
  return out;
}

/** "Arrange": the room between two nodes in a layer, between two layers (an Edge's label sits there), and between two groups. */
const LAYER_GAP_X = 40;
const LAYER_GAP_Y = 72;
const GROUP_GAP = 96;

interface Laid {
  ids: string[];
  at: Map<string, Point>;
  w: number;
  h: number;
}

/** Rows of nodes, each wrapped at `max` wide (never, with `Infinity`), centred on the widest; top-left at 0,0. */
function rows(layers: readonly (readonly string[])[], sizeOf: (id: string) => NodeSize, max: number, gapX: number, gapY: number): Laid {
  const lines: string[][] = [];
  for (const layer of layers) {
    let line: string[] = [];
    let width = 0;
    for (const id of layer) {
      const w = sizeOf(id).w;
      if (line.length && width + gapX + w > max) {
        lines.push(line);
        line = [];
        width = 0;
      }
      width += (line.length ? gapX : 0) + w;
      line.push(id);
    }
    if (line.length) lines.push(line);
  }
  const widthOf = (line: readonly string[]) => line.reduce((s, id, i) => s + sizeOf(id).w + (i ? gapX : 0), 0);
  const w = Math.max(0, ...lines.map(widthOf));
  const at = new Map<string, Point>();
  let y = 0;
  for (const line of lines) {
    const h = Math.max(...line.map((id) => sizeOf(id).h));
    let x = (w - widthOf(line)) / 2;
    for (const id of line) {
      const s = sizeOf(id);
      at.set(id, { x: x + s.w / 2, y: y + h / 2 });
      x += s.w + gapX;
    }
    y += h + gapY;
  }
  return { ids: lines.flat(), at, w, h: Math.max(0, y - gapY) };
}

/**
 * A group of linked Topics in layers: an Edge's second Topic a layer above its first, so "part of"
 * reads upwards, each layer ordered by where its neighbours sit (a few sweeps of the barycentre rule)
 * so fewer Edges cross. A layer is never wrapped: a second row would sit across the Edges of the
 * first, so a very wide layer scrolls instead. A cycle is cut after as many rounds as there are nodes.
 */
function layered(ids: readonly string[], links: readonly (readonly [string, string])[], sizeOf: (id: string) => NodeSize): Laid {
  const rank = new Map(ids.map((id) => [id, 0]));
  for (let round = 0; round < ids.length; round++) {
    let changed = false;
    for (const [from, to] of links) {
      const want = rank.get(to)! + 1;
      if (rank.get(from)! < want && want < ids.length) {
        rank.set(from, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const depth = Math.max(...rank.values());
  const layers: string[][] = Array.from({ length: depth + 1 }, () => []);
  for (const id of ids) layers[rank.get(id)!]!.push(id);
  const neighbours = new Map(ids.map((id) => [id, [] as string[]]));
  for (const [a, b] of links) {
    neighbours.get(a)!.push(b);
    neighbours.get(b)!.push(a);
  }
  const index = new Map<string, number>();
  const renumber = () => layers.forEach((layer) => layer.forEach((id, i) => index.set(id, i)));
  renumber();
  for (let sweep = 0; sweep < 4; sweep++) {
    const order = sweep % 2 ? [...layers.keys()].reverse() : [...layers.keys()];
    for (const l of order) {
      const near = l + (sweep % 2 ? 1 : -1);
      const layer = layers[l]!;
      const centre = (id: string) => {
        const ns = neighbours.get(id)!.filter((n) => rank.get(n) === near);
        return ns.length ? ns.reduce((s, n) => s + index.get(n)!, 0) / ns.length : index.get(id)!;
      };
      const keyed = layer.map((id) => ({ id, key: centre(id), was: index.get(id)! }));
      keyed.sort((a, b) => a.key - b.key || a.was - b.was);
      layers[l] = keyed.map((k) => k.id);
      renumber();
    }
  }
  const laid = rows(layers, sizeOf, Infinity, LAYER_GAP_X, LAYER_GAP_Y);
  // An Edge that skips a layer opens a gap in it where it crosses, so it never runs under a node.
  const CLEAR = 16;
  for (let round = 0; round < 8; round++) {
    let moved = false;
    for (const [from, to] of links) {
      const [lo, hi] = [rank.get(to)!, rank.get(from)!];
      if (hi - lo < 2) continue;
      for (let l = lo + 1; l < hi; l++) {
        const a = laid.at.get(from)!;
        const b = laid.at.get(to)!;
        const layer = layers[l]!;
        const y = laid.at.get(layer[0]!)!.y;
        const x = a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
        const hit = layer.find((id) => Math.abs(laid.at.get(id)!.x - x) < sizeOf(id).w / 2 + CLEAR);
        if (!hit) continue;
        const c = laid.at.get(hit)!;
        const right = c.x >= x;
        const by = right ? x + CLEAR + sizeOf(hit).w / 2 - c.x : -(c.x + sizeOf(hit).w / 2 + CLEAR - x);
        for (const id of layer) {
          const p = laid.at.get(id)!;
          if (right ? p.x >= c.x : p.x <= c.x) laid.at.set(id, { x: p.x + by, y: p.y });
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  const left = Math.min(...laid.ids.map((id) => laid.at.get(id)!.x - sizeOf(id).w / 2));
  for (const id of laid.ids) laid.at.set(id, { x: laid.at.get(id)!.x - left, y: laid.at.get(id)!.y });
  laid.w = Math.max(...laid.ids.map((id) => laid.at.get(id)!.x + sizeOf(id).w / 2));
  return laid;
}

/**
 * TOPIC-7.2, "Arrange": each group of linked Topics laid out in layers (`layered`), the biggest
 * group first, packed left to right in rows as wide as the pane; then the Topics with no Edge, in a
 * grid under them, the biggest first. Deterministic: the same Topics, Edges and sizes give the same
 * layout. No two nodes overlap, and the whole is no wider than the pane unless one group's widest
 * layer is.
 */
export function arrange(ids: readonly string[], edges: readonly { from: string; to: string }[], size: { width: number; height: number }, sizeOf: (id: string) => NodeSize = () => SMALL): Map<string, Point> {
  const out = new Map<string, Point>();
  if (!ids.length) return out;
  const known = new Set(ids);
  const links = edges.flatMap((e) => (known.has(e.from) && known.has(e.to) && e.from !== e.to ? [[e.from, e.to] as const] : []));
  const max = Math.max(size.width, ...ids.map((id) => sizeOf(id).w));
  // The groups: Topics joined by Edges, either way.
  const parent = new Map(ids.map((id) => [id, id]));
  const root = (id: string): string => (parent.get(id) === id ? id : root(parent.get(id)!));
  for (const [a, b] of links) parent.set(root(a), root(b));
  const groups = new Map<string, string[]>();
  for (const id of ids) groups.set(root(id), [...(groups.get(root(id)) ?? []), id]);
  const order = new Map(ids.map((id, i) => [id, i]));
  const weight = (id: string) => sizeOf(id).w * sizeOf(id).h;
  const linked = [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length || order.get(a[0]!)! - order.get(b[0]!)!);
  const alone = [...groups.values()].filter((g) => g.length === 1).map((g) => g[0]!).sort((a, b) => weight(b) - weight(a) || order.get(a)! - order.get(b)!);
  const blocks = linked.map((g) => layered(g, links.filter(([a]) => g.includes(a)), sizeOf));
  // Packed in rows (shelves), each block as laid out.
  let x = 0;
  let y = 0;
  let shelf = 0;
  const put = (b: Laid, left: number, top: number) => {
    for (const id of b.ids) {
      const p = b.at.get(id)!;
      out.set(id, { x: Math.round(left + p.x), y: Math.round(top + p.y) });
    }
  };
  for (const b of blocks) {
    if (x > 0 && x + b.w > max) {
      x = 0;
      y += shelf + GROUP_GAP;
      shelf = 0;
    }
    put(b, x, y);
    x += b.w + GROUP_GAP;
    shelf = Math.max(shelf, b.h);
  }
  if (alone.length) {
    if (blocks.length) y += shelf + GROUP_GAP;
    const grid = rows([alone], sizeOf, max, GAP_X, GAP_Y);
    put(grid, 0, y);
  }
  return out;
}

/**
 * TOPIC-7.2: where the nodes with no position go. With none placed yet (the graph's first open),
 * every node is laid out as "Arrange" does, so an Edge doesn't run under another node; after that,
 * each new one goes on the spiral around the placed nodes it has an Edge with, else around all of
 * them, and the placed ones stay where they are.
 */
export function placeMissing(placed: readonly Placed[], ids: readonly string[], edges: readonly { from: string; to: string }[], size: { width: number; height: number }, sizeOf: (id: string) => NodeSize = () => SMALL, placedAt?: ReadonlyMap<string, Point>): Point[] {
  if (!ids.length) return [];
  if (!placed.length) {
    const laid = arrange(ids, edges, size, sizeOf);
    return ids.map((id) => laid.get(id)!);
  }
  const mean = (ps: readonly Point[]) => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length });
  const taken: Placed[] = [...placed];
  return ids.map((id) => {
    const near = placedAt ? edges.flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : [])).flatMap((o) => [placedAt.get(o) ?? []].flat()) : [];
    const [p] = placeNew(taken, [sizeOf(id)], near.length ? mean(near) : mean(placed));
    taken.push({ ...p!, size: sizeOf(id) });
    return p!;
  });
}

/** Where the line from `from` to a node centred at `to` meets that node's border (an Edge's arrowhead lands there). */
export function border(from: Point, to: Point, half = { w: NODE_W / 2, h: NODE_H / 2 }): Point {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  if (!dx && !dy) return to;
  const s = Math.min(dx ? half.w / Math.abs(dx) : Infinity, dy ? half.h / Math.abs(dy) : Infinity);
  return { x: to.x + dx * s, y: to.y + dy * s };
}

/** TOPIC-7.3: `count` member nodes on an ellipse around a node, from its top, clockwise. */
export function ring(center: Point, count: number, size: NodeSize = SMALL): Point[] {
  const rx = size.w / 2 + MEMBER_R * 2.4;
  const ry = size.h / 2 + MEMBER_R * 2.6;
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / count;
    return { x: center.x + rx * Math.cos(a), y: center.y + ry * Math.sin(a) };
  });
}

/** The box that holds every node, with `pad` around it; at least `min` big, and centred on it when the nodes are smaller. */
export function bounds(points: readonly Placed[], min: { width: number; height: number }, pad = 48): { x: number; y: number; width: number; height: number } {
  if (!points.length) return { x: 0, y: 0, width: min.width, height: min.height };
  const half = (p: Placed) => p.size ?? SMALL;
  const x0 = Math.min(...points.map((p) => p.x - half(p).w / 2)) - pad;
  const x1 = Math.max(...points.map((p) => p.x + half(p).w / 2)) + pad;
  const y0 = Math.min(...points.map((p) => p.y - half(p).h / 2)) - pad;
  const y1 = Math.max(...points.map((p) => p.y + half(p).h / 2)) + pad;
  const width = Math.max(x1 - x0, min.width);
  const height = Math.max(y1 - y0, min.height);
  return { x: (x0 + x1) / 2 - width / 2, y: (y0 + y1) / 2 - height / 2, width, height };
}
