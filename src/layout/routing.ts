// Draws the edges of a placed diagram: generalization trunks first, then
// every other edge with the orthogonal router (two passes, so the ports on a
// shared side are spread out in the order of the far ends), then the labels.
import type { DiagramEdge, DiagramModel } from '../model/types';
import { rectsOverlap, segmentHitsRect, simplify, snap } from './geometry';
import { Router, type RouteRequest } from './router';
import type { EdgeRoute, PlacedLabel, Point, Rect, Side, Size, Trunk } from './types';

export interface EdgePolicy {
  fromSides?: readonly Side[];
  toSides?: readonly Side[];
  fromSideCost?: Partial<Record<Side, number>>;
  toSideCost?: Partial<Record<Side, number>>;
}

export interface RoutingOptions {
  margin?: number;
  bendCost?: number;
  crossCost?: number;
  overlapCost?: number;
  grid?: number;
  /** Merge generalizations and realizations into trunks (UML). */
  trunks?: boolean;
  policy?: (e: DiagramEdge) => EdgePolicy;
  labelSize: (text: string) => Size;
}

const HIER = new Set(['generalization', 'realization']);

export function defaultPolicy(e: DiagramEdge): EdgePolicy {
  switch (e.kind) {
    case 'generalization':
    case 'realization':
      return { fromSideCost: { left: 80, right: 80, bottom: 200 }, toSideCost: { left: 80, right: 80, top: 200 } };
    case 'association':
    case 'aggregation':
    case 'composition':
    case 'nesting':
      return { fromSideCost: { top: 40, bottom: 40 }, toSideCost: { top: 40, bottom: 40 } };
    case 'foreign-key':
      return {};
    default:
      return { fromSideCost: { top: 60, left: 20, right: 20 }, toSideCost: { bottom: 60, left: 20, right: 20 } };
  }
}

interface Routed {
  edge: DiagramEdge;
  points: Point[];
  fromSide: Side;
  toSide: Side;
}

/** Text written next to each end of an edge, and in the middle. */
export function endTexts(e: DiagramEdge): { source?: string; target?: string; middle?: string } {
  const end = (role?: string, mult?: string) => [role, mult].filter(Boolean).join(' ') || undefined;
  if (e.kind === 'flow') return { source: e.label };
  if (e.kind === 'participation') return { source: e.to.multiplicity ?? e.from.multiplicity };
  if (e.kind === 'foreign-key') return {};
  return {
    source: end(e.from.role, e.from.multiplicity),
    target: end(e.to.role, e.to.multiplicity),
    middle: e.label,
  };
}

export function routeEdges(
  model: DiagramModel,
  nodes: ReadonlyMap<string, Rect>,
  opts: RoutingOptions,
): { edges: Record<string, EdgeRoute>; trunks: Trunk[] } {
  const margin = opts.margin ?? 16;
  const grid = opts.grid ?? 8;
  const policy = opts.policy ?? defaultPolicy;
  const boxes = [...nodes.values()];
  const edges = model.edges.filter((e) => nodes.has(e.from.node) && nodes.has(e.to.node));

  const trunks = opts.trunks ? buildTrunks(edges, nodes, margin, grid) : [];
  const inTrunk = new Map<string, string>();
  for (const t of trunks) for (const id of t.edges) inTrunk.set(id, t.id);

  const free = edges.filter((e) => !inTrunk.has(e.id) && e.from.node !== e.to.node);
  const loops = edges.filter((e) => !inTrunk.has(e.id) && e.from.node === e.to.node);

  // Pass 1: sides.
  const pass = (fixed?: Map<string, { fromSide: Side; toSide: Side; fromT: number; toT: number }>) => {
    const router = new Router(boxes, {
      margin,
      bendCost: opts.bendCost,
      crossCost: opts.crossCost,
      overlapCost: opts.overlapCost,
    });
    for (const t of trunks) {
      for (const b of t.branches) router.commit(b);
      router.commit(t.stem);
    }
    const out: Routed[] = [];
    // Shorter edges first: they have fewer alternatives.
    const order = [...free].sort((a, b) => manhattan(nodes, a) - manhattan(nodes, b) || cmp(a.id, b.id));
    for (const e of order) {
      const pol = policy(e);
      const f = fixed?.get(e.id);
      const req: RouteRequest = {
        from: nodes.get(e.from.node)!,
        to: nodes.get(e.to.node)!,
        fromSides: f ? [f.fromSide] : pol.fromSides,
        toSides: f ? [f.toSide] : pol.toSides,
        fromSideCost: pol.fromSideCost,
        toSideCost: pol.toSideCost,
        fromT: f ? { [f.fromSide]: f.fromT } : undefined,
        toT: f ? { [f.toSide]: f.toT } : undefined,
      };
      const r = router.route(req);
      router.commit(r.points);
      out.push({ edge: e, points: r.points, fromSide: r.fromSide, toSide: r.toSide });
    }
    return out;
  };

  const first = pass();
  const fixed = spreadPorts(first, nodes, trunks);
  const routed = pass(fixed);

  const routes: Record<string, EdgeRoute> = {};
  for (const r of routed) routes[r.edge.id] = { id: r.edge.id, points: r.points, labels: [] };
  for (const e of loops) routes[e.id] = { id: e.id, points: selfLoop(nodes.get(e.from.node)!, grid), labels: [] };
  for (const t of trunks) {
    for (const [i, id] of t.edges.entries()) {
      routes[id] = { id, points: simplify([...t.branches[i]!, ...t.stem.slice(1)]), labels: [], trunk: t.id };
    }
  }

  placeLabels(edges, routes, nodes, opts.labelSize);
  return { edges: routes, trunks };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function manhattan(nodes: ReadonlyMap<string, Rect>, e: DiagramEdge): number {
  const a = nodes.get(e.from.node)!;
  const b = nodes.get(e.to.node)!;
  return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) + Math.abs(a.y + a.height / 2 - b.y - b.height / 2);
}

function selfLoop(r: Rect, grid: number): Point[] {
  const out = 3 * grid;
  const y1 = r.y + Math.min(r.height / 2, 3 * grid);
  const x1 = r.x + r.width - Math.min(r.width / 4, 4 * grid);
  return [
    { x: r.x + r.width, y: y1 },
    { x: r.x + r.width + out, y: y1 },
    { x: r.x + r.width + out, y: r.y - out },
    { x: x1, y: r.y - out },
    { x: x1, y: r.y },
  ];
}

/**
 * Children of one parent that sit in the band right below it share a trunk:
 * each child goes straight up to a horizontal bar halfway between the rows,
 * and one stem with one arrowhead goes up to the parent.
 */
function buildTrunks(
  edges: readonly DiagramEdge[],
  nodes: ReadonlyMap<string, Rect>,
  margin: number,
  grid: number,
): Trunk[] {
  const groups = new Map<string, DiagramEdge[]>();
  for (const e of edges) {
    if (!HIER.has(e.kind) || e.from.node === e.to.node) continue;
    const k = `${e.kind}|${e.to.node}`;
    const g = groups.get(k) ?? [];
    g.push(e);
    groups.set(k, g);
  }
  const trunks: Trunk[] = [];
  for (const [k, g] of [...groups].sort((a, b) => cmp(a[0], b[0]))) {
    const parent = nodes.get(g[0]!.to.node)!;
    const pBottom = parent.y + parent.height;
    const below = g.filter((e) => nodes.get(e.from.node)!.y >= pBottom + 2 * margin);
    if (!below.length) continue;
    const topRow = Math.min(...below.map((e) => nodes.get(e.from.node)!.y));
    // Only children whose top is in the first band under the parent join the trunk.
    const kids = below.filter((e) => nodes.get(e.from.node)!.y < topRow + 2 * margin);
    if (!kids.length) continue;
    const px = snap(parent.x + parent.width / 2, 1);
    const barY = snap(pBottom + (topRow - pBottom) / 2, grid);
    const branches: Point[][] = [];
    const cx = kids.map((e) => {
      const c = nodes.get(e.from.node)!;
      return c.x + c.width / 2;
    });
    const single = kids.length === 1;
    for (const [i, e] of kids.entries()) {
      const c = nodes.get(e.from.node)!;
      const x = cx[i]!;
      if (single && x > parent.x + 8 && x < parent.x + parent.width - 8) {
        branches.push([
          { x, y: c.y },
          { x, y: barY },
        ]);
      } else
        branches.push([
          { x, y: c.y },
          { x, y: barY },
          { x: px, y: barY },
        ]);
    }
    const stemX = single && branches[0]!.length === 2 ? cx[0]! : px;
    trunks.push({
      id: `trunk:${k}`,
      kind: g[0]!.kind as Trunk['kind'],
      parent: g[0]!.to.node,
      edges: kids.map((e) => e.id),
      branches,
      stem: [
        { x: stemX, y: barY },
        { x: stemX, y: pBottom },
      ],
    });
  }
  separateBars(trunks);
  return trunks;
}

/** Two trunks whose bars share a band and overlap horizontally get different heights. */
function separateBars(trunks: Trunk[]): void {
  const span = (t: Trunk) => {
    const xs = t.branches.flat().map((p) => p.x);
    return [Math.min(...xs), Math.max(...xs)] as const;
  };
  for (let i = 0; i < trunks.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = trunks[i]!;
      const b = trunks[j]!;
      if (a.stem[0]!.y !== b.stem[0]!.y) continue;
      const [a1, a2] = span(a);
      const [b1, b2] = span(b);
      if (a1 > b2 || b1 > a2) continue;
      const dy = 12;
      for (const br of a.branches) for (const p of br.slice(1)) p.y += dy;
      a.stem[0]!.y += dy;
    }
  }
}

/** Spreads the ports that share a node side, ordered by where the far end goes. */
function spreadPorts(
  routed: readonly Routed[],
  nodes: ReadonlyMap<string, Rect>,
  trunks: readonly Trunk[],
): Map<string, { fromSide: Side; toSide: Side; fromT: number; toT: number }> {
  type End = { edge: string; which: 'from' | 'to'; key: number };
  const bySide = new Map<string, End[]>();
  for (const r of routed) {
    const ends: [string, Side, 'from' | 'to', Point][] = [
      [r.edge.from.node, r.fromSide, 'from', r.points[Math.min(2, r.points.length - 1)]!],
      [r.edge.to.node, r.toSide, 'to', r.points[Math.max(0, r.points.length - 3)]!],
    ];
    for (const [node, side, which, far] of ends) {
      const k = `${node}|${side}`;
      const list = bySide.get(k) ?? [];
      list.push({ edge: r.edge.id, which, key: side === 'top' || side === 'bottom' ? far.x : far.y });
      bySide.set(k, list);
    }
  }
  const trunkSides = new Set<string>();
  for (const t of trunks) {
    trunkSides.add(`${t.parent}|bottom`);
  }
  const out = new Map<string, { fromSide: Side; toSide: Side; fromT: number; toT: number }>();
  for (const r of routed) out.set(r.edge.id, { fromSide: r.fromSide, toSide: r.toSide, fromT: 0.5, toT: 0.5 });
  for (const [k, list] of bySide) {
    list.sort((a, b) => a.key - b.key || cmp(a.edge, b.edge));
    const n = list.length;
    const hasTrunk = trunkSides.has(k);
    if (n === 1 && !hasTrunk) continue;
    const [node] = k.split('|');
    const r = nodes.get(node!)!;
    const side = k.split('|')[1] as Side;
    const len = side === 'top' || side === 'bottom' ? r.width : r.height;
    // Keep ports at least 12 px from the corners and from the trunk stem.
    const ts = hasTrunk ? spreadAround(n, len) : spreadEven(n, len);
    list.forEach((end, i) => {
      const f = out.get(end.edge)!;
      if (end.which === 'from') f.fromT = ts[i]!;
      else f.toT = ts[i]!;
    });
  }
  // An end that is alone on its side lines up with the other end when it can,
  // so a spread port does not turn a straight line into an S.
  const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  for (const r of routed) {
    const f = out.get(r.edge.id)!;
    if (opposite[f.fromSide] !== f.toSide) continue;
    const a = nodes.get(r.edge.from.node)!;
    const b = nodes.get(r.edge.to.node)!;
    const vertical = f.fromSide === 'top' || f.fromSide === 'bottom';
    const fromAlone =
      bySide.get(`${r.edge.from.node}|${f.fromSide}`)!.length === 1 &&
      !trunkSides.has(`${r.edge.from.node}|${f.fromSide}`);
    const toAlone = bySide.get(`${r.edge.to.node}|${f.toSide}`)!.length === 1;
    const pos = (box: Rect, t: number) => (vertical ? box.x + box.width * t : box.y + box.height * t);
    const fit = (box: Rect, abs: number) => {
      const lo = vertical ? box.x : box.y;
      const len = vertical ? box.width : box.height;
      const t = (abs - lo) / len;
      return t * len >= 12 && (1 - t) * len >= 12 ? t : undefined;
    };
    if (toAlone) {
      const t = fit(b, pos(a, f.fromT));
      if (t !== undefined) f.toT = t;
    } else if (fromAlone) {
      const t = fit(a, pos(b, f.toT));
      if (t !== undefined) f.fromT = t;
    }
  }
  return out;
}

function spreadEven(n: number, len: number): number[] {
  const inset = Math.min(0.25, 12 / len);
  return Array.from({ length: n }, (_, i) => (n === 1 ? 0.5 : inset + ((1 - 2 * inset) * (i + 0.5)) / n));
}

function spreadAround(n: number, len: number): number[] {
  // Slots on both sides of the centre (taken by the trunk stem).
  const inset = Math.min(0.2, 12 / len);
  const slots = n + 1;
  const all = Array.from({ length: slots }, (_, i) => inset + ((1 - 2 * inset) * (i + 0.5)) / slots);
  const mid = Math.floor(slots / 2);
  return all.filter((_, i) => i !== mid);
}

// ---------------------------------------------------------------------------
// Labels

function placeLabels(
  edges: readonly DiagramEdge[],
  routes: Record<string, EdgeRoute>,
  nodes: ReadonlyMap<string, Rect>,
  size: (text: string) => Size,
): void {
  const taken: Rect[] = [];
  const segs: [Point, Point][] = [];
  for (const r of Object.values(routes))
    for (let i = 1; i < r.points.length; i++) segs.push([r.points[i - 1]!, r.points[i]!]);
  const boxes = [...nodes.values()];

  const collides = (b: Rect) =>
    taken.some((t) => rectsOverlap(t, b, 2)) ||
    boxes.some((n) => rectsOverlap(n, b, 2)) ||
    segs.some(([a, c]) =>
      segmentHitsRect(a, c, { x: b.x - 2, y: b.y - 2, width: b.width + 4, height: b.height + 4 }, 0),
    );

  const place = (route: EdgeRoute, text: string, at: PlacedLabel['at']) => {
    const s = size(text);
    const pts = at === 'target' ? [...route.points].reverse() : route.points;
    const cands: Rect[] = [];
    if (at === 'middle') {
      // Middle of the longest segment.
      let best = 1;
      let bestLen = -1;
      for (let i = 1; i < pts.length; i++) {
        const l = Math.abs(pts[i]!.x - pts[i - 1]!.x) + Math.abs(pts[i]!.y - pts[i - 1]!.y);
        if (l > bestLen) {
          bestLen = l;
          best = i;
        }
      }
      const a = pts[best - 1]!;
      const b = pts[best]!;
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (a.y === b.y) {
        cands.push({ x: m.x - s.width / 2, y: m.y - s.height - 4, ...s }, { x: m.x - s.width / 2, y: m.y + 4, ...s });
      } else {
        cands.push({ x: m.x + 6, y: m.y - s.height / 2, ...s }, { x: m.x - 6 - s.width, y: m.y - s.height / 2, ...s });
      }
    } else {
      const a = pts[0]!;
      const b = pts[1] ?? a;
      const dx = Math.sign(b.x - a.x);
      const dy = Math.sign(b.y - a.y);
      for (const d of [6, 14, 26, 40, 56, 76]) {
        if (dy !== 0) {
          // Vertical segment leaving the node: label beside it, right side first.
          const y = dy > 0 ? a.y + d : a.y - d - s.height;
          cands.push({ x: a.x + 6, y, ...s }, { x: a.x - 6 - s.width, y, ...s });
        } else {
          // Horizontal segment: above the line first.
          const x = dx > 0 ? a.x + d : a.x - d - s.width;
          cands.push({ x, y: a.y - 4 - s.height, ...s }, { x, y: a.y + 4, ...s });
        }
      }
    }
    let chosen = cands.find((c) => !collides(c));
    if (!chosen) {
      // Walk the whole line, both sides, until a free spot turns up.
      for (let i = 1; i < pts.length && !chosen; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        for (let d = 8; d < len - 8 && !chosen; d += 8) {
          const t = d / len;
          const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          const opts: Rect[] =
            a.y === b.y
              ? [
                  { x: m.x - s.width / 2, y: m.y - s.height - 4, ...s },
                  { x: m.x - s.width / 2, y: m.y + 4, ...s },
                ]
              : [
                  { x: m.x + 6, y: m.y - s.height / 2, ...s },
                  { x: m.x - 6 - s.width, y: m.y - s.height / 2, ...s },
                ];
          chosen = opts.find((c) => !collides(c));
        }
      }
    }
    chosen ??= cands[0]!;
    taken.push(chosen);
    route.labels.push({ ...chosen, text, at });
  };

  for (const e of edges) {
    const route = routes[e.id];
    if (!route) continue;
    const t = endTexts(e);
    if (t.source) place(route, t.source, 'source');
    if (t.target) place(route, t.target, 'target');
    if (t.middle) place(route, t.middle, 'middle');
  }
}

/** Number of placed labels that overlap a node, a line or another label. */
export function labelOverlaps(
  routes: Record<string, EdgeRoute>,
  nodes: ReadonlyMap<string, Rect> | Record<string, Rect>,
): number {
  const boxes = nodes instanceof Map ? [...nodes.values()] : Object.values(nodes);
  const labels = Object.values(routes).flatMap((r) => r.labels);
  const segs: [Point, Point][] = [];
  for (const r of Object.values(routes))
    for (let i = 1; i < r.points.length; i++) segs.push([r.points[i - 1]!, r.points[i]!]);
  let n = 0;
  labels.forEach((l, i) => {
    const hit =
      labels.some((o, j) => j < i && rectsOverlap(o, l)) ||
      boxes.some((b) => rectsOverlap(b, l)) ||
      segs.some(([a, b]) => segmentHitsRect(a, b, l, 0));
    if (hit) n++;
  });
  return n;
}
