// Orthogonal edge router.
//
// Used after every automatic layout and whenever a node is dragged. It builds
// a sparse grid from the borders of the boxes (plus the middle of each channel
// between them), drops the points that fall inside a box, and runs A* over
// (point, direction) states. The cost is length + a penalty per bend + a
// penalty for running along or across a line that was routed earlier, so the
// result has few bends, keeps off the boxes and avoids crossings when it can.
import { segmentHitsRect, sidePoint, simplify } from './geometry';
import type { Point, Rect, Side } from './types';

export interface RouteRequest {
  from: Rect;
  to: Rect;
  fromSides?: readonly Side[];
  toSides?: readonly Side[];
  /** Extra cost per side, to express preferences ("associations leave by the sides"). */
  fromSideCost?: Partial<Record<Side, number>>;
  toSideCost?: Partial<Record<Side, number>>;
  /** Where along each side the port sits, 0..1. Keyed by side so a later pass can spread ports. */
  fromT?: Partial<Record<Side, number>>;
  toT?: Partial<Record<Side, number>>;
}

export interface RouteResult {
  points: Point[];
  fromSide: Side;
  toSide: Side;
  cost: number;
}

export interface RouterOptions {
  /** Clearance kept between a line and any box it does not touch. */
  margin?: number;
  bendCost?: number;
  overlapCost?: number;
  crossCost?: number;
}

const ALL_SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
const OUT: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
// Direction index: 0 up, 1 right, 2 down, 3 left.
const DIRS: Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
const sideDir: Record<Side, number> = { top: 0, right: 1, bottom: 2, left: 3 };

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! < key || (k[p] === key && v[p]! <= val)) break;
      k[i] = k[p]!;
      v[i] = v[p]!;
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0]!;
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mk = lastK;
        let mv = lastV;
        if (l < k.length && (k[l]! < mk || (k[l] === mk && v[l]! < mv))) {
          m = l;
          mk = k[l]!;
          mv = v[l]!;
        }
        if (r < k.length && (k[r]! < mk || (k[r] === mk && v[r]! < mv))) m = r;
        if (m === i) break;
        k[i] = k[m]!;
        v[i] = v[m]!;
        i = m;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
}

export class Router {
  private readonly margin: number;
  private readonly bendCost: number;
  private readonly overlapCost: number;
  private readonly crossCost: number;
  /** Committed horizontal segments as [y, x1, x2] and vertical ones as [x, y1, y2]. */
  private h: number[] = [];
  private v: number[] = [];

  private readonly boxes: readonly Rect[];

  constructor(boxes: readonly Rect[], opts: RouterOptions = {}) {
    this.boxes = boxes;
    this.margin = opts.margin ?? 16;
    this.bendCost = opts.bendCost ?? 60;
    this.overlapCost = opts.overlapCost ?? 30;
    this.crossCost = opts.crossCost ?? 90;
  }

  /** Records a polyline (a routed edge, a trunk) so later routes avoid running along or across it. */
  commit(points: readonly Point[]): void {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      if (a.y === b.y) this.h.push(a.y, Math.min(a.x, b.x), Math.max(a.x, b.x));
      else if (a.x === b.x) this.v.push(a.x, Math.min(a.y, b.y), Math.max(a.y, b.y));
    }
  }

  /** Cost of running along a→b given the lines committed so far. */
  private interference(ax: number, ay: number, bx: number, by: number): number {
    let cost = 0;
    const h = this.h;
    const v = this.v;
    if (ay === by) {
      const x1 = Math.min(ax, bx);
      const x2 = Math.max(ax, bx);
      for (let i = 0; i < h.length; i += 3) {
        if (h[i] !== ay) continue;
        const o = Math.min(x2, h[i + 2]!) - Math.max(x1, h[i + 1]!);
        if (o > 0.5) cost += this.overlapCost + o * 0.5;
      }
      for (let i = 0; i < v.length; i += 3) {
        const x = v[i]!;
        if (x > x1 && x < x2 && ay > v[i + 1]! && ay < v[i + 2]!) cost += this.crossCost;
      }
    } else {
      const y1 = Math.min(ay, by);
      const y2 = Math.max(ay, by);
      for (let i = 0; i < v.length; i += 3) {
        if (v[i] !== ax) continue;
        const o = Math.min(y2, v[i + 2]!) - Math.max(y1, v[i + 1]!);
        if (o > 0.5) cost += this.overlapCost + o * 0.5;
      }
      for (let i = 0; i < h.length; i += 3) {
        const y = h[i]!;
        if (y > y1 && y < y2 && ax > h[i + 1]! && ax < h[i + 2]!) cost += this.crossCost;
      }
    }
    return cost;
  }

  route(req: RouteRequest): RouteResult {
    const m = this.margin;
    const fromSides = req.fromSides ?? ALL_SIDES;
    const toSides = req.toSides ?? ALL_SIDES;
    const ports = (r: Rect, sides: readonly Side[], t: Partial<Record<Side, number>> | undefined) =>
      sides.map((side) => {
        const p = sidePoint(r, side, t?.[side] ?? 0.5);
        const o = OUT[side];
        return { side, port: p, stub: { x: p.x + o.x * m, y: p.y + o.y * m } };
      });
    const starts = ports(req.from, fromSides, req.fromT);
    const goals = ports(req.to, toSides, req.toT);

    // Obstacles: every box, kept at a distance of margin - 1 (so lines may run exactly at margin).
    const obstacles = this.boxes.map((b) => ({
      x: b.x - m + 1,
      y: b.y - m + 1,
      width: b.width + 2 * m - 2,
      height: b.height + 2 * m - 2,
    }));

    const xsSet = new Set<number>();
    const ysSet = new Set<number>();
    for (const b of this.boxes) {
      xsSet.add(b.x - m);
      xsSet.add(b.x + b.width + m);
      ysSet.add(b.y - m);
      ysSet.add(b.y + b.height + m);
    }
    for (const s of [...starts, ...goals]) {
      xsSet.add(s.stub.x);
      ysSet.add(s.stub.y);
    }
    const addMid = (set: Set<number>) => {
      const sorted = [...set].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i]! - sorted[i - 1]!;
        if (gap > 2 * m) set.add(Math.round((sorted[i]! + sorted[i - 1]!) / 2));
      }
    };
    addMid(xsSet);
    addMid(ysSet);
    const xs = [...xsSet].sort((a, b) => a - b);
    const ys = [...ysSet].sort((a, b) => a - b);
    const nx = xs.length;
    const ny = ys.length;
    const idx = (ix: number, iy: number) => iy * nx + ix;

    const inside = (x: number, y: number) =>
      obstacles.some((o) => x > o.x && x < o.x + o.width && y > o.y && y < o.y + o.height);
    const free = new Uint8Array(nx * ny);
    for (let iy = 0; iy < ny; iy++)
      for (let ix = 0; ix < nx; ix++) free[idx(ix, iy)] = inside(xs[ix]!, ys[iy]!) ? 0 : 1;

    const segFree = (ax: number, ay: number, bx: number, by: number) => {
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      return !inside(mx, my);
    };

    const xi = new Map(xs.map((v, i) => [v, i]));
    const yi = new Map(ys.map((v, i) => [v, i]));

    const goalAt = new Map<number, { side: Side; port: Point; dir: number }[]>();
    for (const g of goals) {
      const gi = idx(xi.get(g.stub.x)!, yi.get(g.stub.y)!);
      const list = goalAt.get(gi) ?? [];
      list.push({ side: g.side, port: g.port, dir: (sideDir[g.side] + 2) % 4 });
      goalAt.set(gi, list);
    }

    const N = nx * ny * 4;
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const heap = new MinHeap();
    const tx = goals.reduce((s, g) => s + g.stub.x, 0) / goals.length;
    const ty = goals.reduce((s, g) => s + g.stub.y, 0) / goals.length;
    const h = (ix: number, iy: number) => Math.abs(xs[ix]! - tx) + Math.abs(ys[iy]! - ty) * 0.999;

    for (const s of starts) {
      const ix = xi.get(s.stub.x)!;
      const iy = yi.get(s.stub.y)!;
      const p = idx(ix, iy);
      const dir = sideDir[s.side];
      const st = p * 4 + dir;
      const c = m + (req.fromSideCost?.[s.side] ?? 0);
      if (c < dist[st]!) {
        dist[st] = c;
        heap.push(c + h(ix, iy), st);
      }
    }

    let best: { state: number; cost: number; goal: { side: Side; port: Point } } | undefined;
    const done = new Uint8Array(N);
    while (heap.size) {
      const st = heap.pop();
      if (done[st]) continue;
      done[st] = 1;
      const d = dist[st]!;
      if (best && d >= best.cost) break;
      const p = st >> 2;
      const dir = st & 3;
      const ix = p % nx;
      const iy = (p - ix) / nx;
      const gl = goalAt.get(p);
      if (gl) {
        for (const g of gl) {
          const turn = g.dir === dir ? 0 : (g.dir + 2) % 4 === dir ? 2 * this.bendCost : this.bendCost;
          const total = d + turn + m + (req.toSideCost?.[g.side] ?? 0);
          if (!best || total < best.cost) best = { state: st, cost: total, goal: g };
        }
      }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (dir + 2) % 4) continue;
        const v = DIRS[nd]!;
        const jx = ix + v.x;
        const jy = iy + v.y;
        if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
        const q = idx(jx, jy);
        if (!free[q] && !goalAt.has(q)) continue;
        const ax = xs[ix]!;
        const ay = ys[iy]!;
        const bx = xs[jx]!;
        const by = ys[jy]!;
        if (!segFree(ax, ay, bx, by)) continue;
        const len = Math.abs(bx - ax) + Math.abs(by - ay);
        const c = d + len + (nd === dir ? 0 : this.bendCost) + this.interference(ax, ay, bx, by);
        const ns = q * 4 + nd;
        if (c < dist[ns]!) {
          dist[ns] = c;
          prev[ns] = st;
          heap.push(c + h(jx, jy), ns);
        }
      }
    }

    if (!best) return this.fallback(req);

    const pts: Point[] = [best.goal.port];
    let st = best.state;
    let first = st;
    while (st !== -1) {
      const p = st >> 2;
      const ix = p % nx;
      const iy = (p - ix) / nx;
      pts.push({ x: xs[ix]!, y: ys[iy]! });
      first = st;
      st = prev[st]!;
    }
    const firstPoint = first >> 2;
    const start =
      starts.find((s) => idx(xi.get(s.stub.x)!, yi.get(s.stub.y)!) === firstPoint && sideDir[s.side] === (first & 3)) ??
      starts[0]!;
    const fromSide = start.side;
    pts.push(start.port);
    pts.reverse();
    return { points: simplify(pts), fromSide, toSide: best.goal.side, cost: best.cost };
  }

  /** No orthogonal path (boxes overlap or the request is impossible): one elbow, centre to centre. */
  private fallback(req: RouteRequest): RouteResult {
    const a = sidePoint(req.from, 'bottom');
    const b = sidePoint(req.to, 'top');
    const pts = simplify([a, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, b]);
    return { points: pts, fromSide: 'bottom', toSide: 'top', cost: Infinity };
  }
}

/** True when no segment of the polyline passes through a box other than its own ends. */
export function routeIsClear(points: readonly Point[], boxes: readonly Rect[]): boolean {
  for (let i = 1; i < points.length; i++) {
    for (const b of boxes) if (segmentHitsRect(points[i - 1]!, points[i]!, b)) return false;
  }
  return true;
}
