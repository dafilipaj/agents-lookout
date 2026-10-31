import type { TopicPosition } from '@shared/topics.ts';

/**
 * TOPIC-7: the graph's geometry, kept apart from the drawing so it can be tested on its own. A
 * position is a node's centre in the graph's units (CSS pixels at scale 1). No graph library
 * (Technical approach): placing a new node is a spiral, "Arrange" a bounded spring layout.
 */

export type Point = TopicPosition;

/** A Topic's node. */
export const NODE_W = 184;
export const NODE_H = 48;
/** The room kept between two nodes. */
const GAP_X = 32;
const GAP_Y = 40;
/** TOPIC-7.3: a member's small node. */
export const MEMBER_R = 13;

/** Whether two nodes centred here would touch, gaps included. */
export function overlaps(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < NODE_W + GAP_X && Math.abs(a.y - b.y) < NODE_H + GAP_Y;
}

/**
 * TOPIC-7.2: places `count` new nodes on a spiral from `center`, each clear of the nodes already
 * placed and of the ones placed before it. One-shot: the result is stored, so it never moves again.
 */
export function placeNew(placed: readonly Point[], count: number, center: Point): Point[] {
  const taken = [...placed];
  const out: Point[] = [];
  // Golden-angle steps on a spiral stretched to the nodes' shape: wide rather than tall.
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let n = 0; out.length < count; n++) {
    const r = 18 * Math.sqrt(n);
    const p = { x: Math.round(center.x + r * 2.4 * Math.cos(n * golden)), y: Math.round(center.y + r * Math.sin(n * golden)) };
    if (taken.some((q) => overlaps(p, q)) && n < 20_000) continue;
    taken.push(p);
    out.push(p);
  }
  return out;
}

/** "Arrange" places nodes on a grid of cells this big: room for an Edge's label between two. */
const CELL_W = NODE_W + 88;
const CELL_H = NODE_H + 56;

/**
 * TOPIC-7.2, "Arrange": a bounded spring layout (Fruchterman–Reingold, a fixed number of steps, no
 * worker) finds which nodes belong near which, linked ones pulled together; then each node takes the
 * free cell of a grid nearest to where it landed, the grid as wide as the pane, so none overlap and
 * the graph reads at scale 1. Deterministic: the same Topics and Edges give the same layout.
 */
export function arrange(ids: readonly string[], edges: readonly { from: string; to: string }[], size: { width: number; height: number }): Map<string, Point> {
  const n = ids.length;
  const out = new Map<string, Point>();
  if (!n) return out;
  const index = new Map(ids.map((id, i) => [id, i]));
  const links = edges.flatMap((e) => {
    const a = index.get(e.from);
    const b = index.get(e.to);
    return a === undefined || b === undefined || a === b ? [] : [[a, b] as const];
  });
  // The springs, on a unit area: start on a circle, in the order given.
  const k = Math.sqrt(1 / n);
  const pos = ids.map((_, i) => ({ x: 0.5 + 0.4 * Math.cos((2 * Math.PI * i) / n), y: 0.5 + 0.4 * Math.sin((2 * Math.PI * i) / n) }));
  const STEPS = 300;
  for (let step = 0; step < STEPS; step++) {
    const t = 0.1 * (1 - step / STEPS) + 0.001;
    const d = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i]!.x - pos[j]!.x || 1e-4 * (j - i);
        const dy = pos[i]!.y - pos[j]!.y;
        const dist = Math.max(1e-4, Math.hypot(dx, dy));
        const f = (k * k) / dist;
        d[i]!.x += (dx / dist) * f;
        d[i]!.y += (dy / dist) * f;
        d[j]!.x -= (dx / dist) * f;
        d[j]!.y -= (dy / dist) * f;
      }
    }
    for (const [a, b] of links) {
      const dx = pos[a]!.x - pos[b]!.x;
      const dy = pos[a]!.y - pos[b]!.y;
      const dist = Math.max(1e-4, Math.hypot(dx, dy));
      const f = (dist * dist) / k;
      d[a]!.x -= (dx / dist) * f;
      d[a]!.y -= (dy / dist) * f;
      d[b]!.x += (dx / dist) * f;
      d[b]!.y += (dy / dist) * f;
    }
    for (let i = 0; i < n; i++) {
      // A pull to the middle keeps unlinked nodes from drifting off.
      d[i]!.x -= (pos[i]!.x - 0.5) * k;
      d[i]!.y -= (pos[i]!.y - 0.5) * k;
      const len = Math.max(1e-6, Math.hypot(d[i]!.x, d[i]!.y));
      pos[i]!.x += (d[i]!.x / len) * Math.min(len, t);
      pos[i]!.y += (d[i]!.y / len) * Math.min(len, t);
    }
  }
  // The grid: as many columns as the pane holds, enough rows for every node with some room spare.
  const cols = Math.max(1, Math.min(n, Math.floor(Math.max(size.width, CELL_W) / CELL_W)));
  const rows = Math.max(Math.ceil((n * 1.15) / cols), Math.ceil(n / cols));
  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const want = pos.map((p) => ({ c: x1 > x0 ? ((p.x - x0) / (x1 - x0)) * (cols - 1) : (cols - 1) / 2, r: y1 > y0 ? ((p.y - y0) / (y1 - y0)) * (rows - 1) : (rows - 1) / 2 }));
  const taken = new Set<number>();
  // Nodes nearest the middle choose first, so the middle stays dense and the edges sparse.
  const order = ids.map((_, i) => i).sort((a, b) => Math.hypot(want[a]!.c - (cols - 1) / 2, want[a]!.r - (rows - 1) / 2) - Math.hypot(want[b]!.c - (cols - 1) / 2, want[b]!.r - (rows - 1) / 2) || a - b);
  for (const i of order) {
    let best = -1;
    let bestD = Infinity;
    for (let cell = 0; cell < cols * rows; cell++) {
      if (taken.has(cell)) continue;
      const dd = Math.hypot((cell % cols) - want[i]!.c, Math.floor(cell / cols) - want[i]!.r);
      if (dd < bestD) {
        bestD = dd;
        best = cell;
      }
    }
    taken.add(best);
    out.set(ids[i]!, { x: Math.round(CELL_W / 2 + (best % cols) * CELL_W), y: Math.round(CELL_H / 2 + Math.floor(best / cols) * CELL_H) });
  }
  return out;
}

/**
 * TOPIC-7.2: where the nodes with no position go. With none placed yet (the graph's first open),
 * every node is laid out as "Arrange" does, so an Edge doesn't run under another node; after that,
 * each new one goes on the spiral around the placed ones, which stay where they are.
 */
export function placeMissing(placed: readonly Point[], ids: readonly string[], edges: readonly { from: string; to: string }[], size: { width: number; height: number }): Point[] {
  if (!ids.length) return [];
  if (!placed.length) {
    const laid = arrange(ids, edges, size);
    return ids.map((id) => laid.get(id)!);
  }
  const center = { x: placed.reduce((s, p) => s + p.x, 0) / placed.length, y: placed.reduce((s, p) => s + p.y, 0) / placed.length };
  return placeNew(placed, ids.length, center);
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
export function ring(center: Point, count: number): Point[] {
  const rx = NODE_W / 2 + MEMBER_R * 2.4;
  const ry = NODE_H / 2 + MEMBER_R * 2.6;
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / count;
    return { x: center.x + rx * Math.cos(a), y: center.y + ry * Math.sin(a) };
  });
}

/** The box that holds every node, with `pad` around it; at least `min` big, and centred on it when the nodes are smaller. */
export function bounds(points: readonly Point[], min: { width: number; height: number }, pad = 48): { x: number; y: number; width: number; height: number } {
  if (!points.length) return { x: 0, y: 0, width: min.width, height: min.height };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs) - NODE_W / 2 - pad;
  const x1 = Math.max(...xs) + NODE_W / 2 + pad;
  const y0 = Math.min(...ys) - NODE_H / 2 - pad;
  const y1 = Math.max(...ys) + NODE_H / 2 + pad;
  const width = Math.max(x1 - x0, min.width);
  const height = Math.max(y1 - y0, min.height);
  return { x: (x0 + x1) / 2 - width / 2, y: (y0 + y1) / 2 - height / 2, width, height };
}
