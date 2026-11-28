// Aesthetic score of a finished layout, from the classic graph-drawing criteria (§5.2).
//
// Each criterion becomes a penalty in points; the score is 100 minus the
// penalties, clamped to 0..100. Overlapping labels are not part of the number:
// they are eliminatory, so `compareLayouts` ranks any layout without them
// above every layout with them.
import { bends, polylineLength, segmentHitsRect, segmentsCross, union } from './geometry';
import { labelOverlaps } from './routing';
import type { Layout, Point, Rect, Score } from './types';

export interface ScoreContext {
  /** parent id → children ids, for the symmetry criterion. */
  childrenOf?: ReadonlyMap<string, readonly string[]>;
  /** edge id → [from, to], to know which boxes an edge may touch. */
  ends: ReadonlyMap<string, readonly [string, string]>;
  /** Bends every edge has by notation (the relational FK route always has 4). */
  bendAllowance?: number;
  /** Width/height the notation naturally has (a relational stack is tall). */
  aspectTarget?: number;
}

export function scoreLayout(l: Layout, ctx: ScoreContext): Score {
  const nodes = Object.entries(l.nodes);
  const boxes = nodes.map(([, r]) => r);
  const routes = Object.values(l.edges);

  // Lines grouped by drawing unit: a trunk counts as one line.
  const units = new Map<string, Point[][]>();
  for (const r of routes) {
    const k = r.trunk ?? r.id;
    const list = units.get(k) ?? [];
    list.push(r.points);
    units.set(k, list);
  }
  const unitSegs = [...units.values()].map((lines) => {
    const segs: [Point, Point][] = [];
    for (const pts of lines) for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1]!, pts[i]!]);
    return segs;
  });
  let crossings = 0;
  for (let i = 0; i < unitSegs.length; i++) {
    for (let j = i + 1; j < unitSegs.length; j++) {
      for (const [a, b] of unitSegs[i]!) for (const [c, d] of unitSegs[j]!) if (segmentsCross(a, b, c, d)) crossings++;
    }
  }

  let bendCount = 0;
  let length = 0;
  let through = 0;
  for (const r of routes) {
    if (!r.trunk) bendCount += Math.max(0, bends(r.points) - (ctx.bendAllowance ?? 0));
    length += polylineLength(r.points);
    const [from, to] = ctx.ends.get(r.id) ?? ['', ''];
    for (const [id, box] of nodes) {
      if (id === from || id === to) continue;
      for (let i = 1; i < r.points.length; i++) if (segmentHitsRect(r.points[i - 1]!, r.points[i]!, box)) through++;
    }
  }
  for (const t of l.trunks) bendCount += t.branches.length ? 1 : 0;

  // Alignment: a node counts when its centre x or its top y matches another node.
  let alignedCount = 0;
  for (const [id, r] of nodes) {
    const cx = r.x + r.width / 2;
    if (nodes.some(([o, s]) => o !== id && (Math.abs(s.x + s.width / 2 - cx) < 1 || Math.abs(s.y - r.y) < 1)))
      alignedCount++;
  }
  const aligned = nodes.length ? alignedCount / nodes.length : 1;

  const overlaps = labelOverlaps(l.edges, l.nodes);
  const box = union(boxes);
  const ratio = box.height ? box.width / box.height : 1;
  const aspect = Math.abs(Math.log(ratio / (ctx.aspectTarget ?? 1.6)));

  let symmetry = 0;
  let parents = 0;
  for (const [p, kids] of ctx.childrenOf ?? []) {
    const pr = l.nodes[p];
    const ks = kids.map((k) => l.nodes[k]).filter((r): r is Rect => !!r);
    if (!pr || !ks.length) continue;
    const span = union(ks);
    symmetry += Math.min(1, Math.abs(pr.x + pr.width / 2 - (span.x + span.width / 2)) / Math.max(pr.width, 1));
    parents++;
  }
  symmetry = parents ? symmetry / parents : 0;

  const filled = boxes.reduce((s, r) => s + r.width * r.height, 0) / Math.max(1, box.width * box.height);
  const balance = filled < 0.12 ? (0.12 - filled) / 0.12 : filled > 0.55 ? (filled - 0.55) / 0.45 : 0;

  const e = Math.max(1, routes.length);
  const avgSize = boxes.reduce((s, r) => s + (r.width + r.height) / 2, 0) / Math.max(1, boxes.length);
  const penalty =
    Math.min(40, crossings * 8) +
    Math.min(20, (bendCount / e) * 6) +
    Math.min(15, Math.max(0, (length / e / Math.max(1, avgSize) - 1.2) * 4)) +
    (1 - aligned) * 15 +
    Math.min(1, aspect) * 8 +
    symmetry * 10 +
    balance * 8 +
    Math.min(30, through * 15);
  return {
    total: Math.max(0, Math.min(100, Math.round(100 - penalty))),
    crossings,
    bends: bendCount,
    length: Math.round(length),
    aligned: Math.round(aligned * 100) / 100,
    labelOverlaps: overlaps,
    aspect: Math.round(aspect * 100) / 100,
    symmetry: Math.round(symmetry * 100) / 100,
    balance: Math.round(balance * 100) / 100,
  };
}

/** Best first: no overlapping labels, then the higher score, then the strategy name (stable). */
export function compareLayouts(a: Layout, b: Layout): number {
  const sa = a.score!;
  const sb = b.score!;
  if (sa.labelOverlaps > 0 !== sb.labelOverlaps > 0) return sa.labelOverlaps > 0 ? 1 : -1;
  if (sa.total !== sb.total) return sb.total - sa.total;
  return a.strategy < b.strategy ? -1 : a.strategy > b.strategy ? 1 : 0;
}
