// Relational schema layout in the FBD notation (docs/notacoes.md).
//
// Tables are stacked in one column, referenced tables above the tables that
// reference them. Every FK line leaves the bottom of its cell, drops into the
// gap under its table, runs right to a vertical corridor of its own, climbs,
// runs left under the PK cell and enters it from below. Corridors sit just
// right of the widest table the line passes, longer spans further out. Inside
// each gap the horizontal runs get the depths that cross the fewest lines.
import type { DiagramEdge } from '../model/types';
import { assemble, GRID, PAD } from './finish';
import { snap } from './geometry';
import type { Placement } from './polish';
import type { EdgeRoute, Layout, LayoutInput, Point } from './types';

const STEP = 20; // corridor pitch and first run depth (measured)
const RUN = 12; // distance between runs in one gap

interface Fk {
  edge: DiagramEdge;
  from: number; // table index (referencing)
  to: number; // table index (referenced)
  fkX: number;
  pkX: number;
  corridor: number;
}

interface Run {
  fk: Fk;
  kind: 'fk' | 'pk';
  stub: number;
  /** Direction the corridor leaves this run in: up (-1) or down (+1). */
  dir: number;
}

/** Referenced tables above the tables that reference them. Cycles fall back to the model order. */
function stackOrder(input: LayoutInput, mode: 'depth' | 'close'): string[] {
  const ids = input.model.nodes.map((n) => n.id);
  const refs = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const e of input.model.edges) {
    if (e.from.node !== e.to.node && refs.has(e.from.node) && refs.has(e.to.node))
      refs.get(e.from.node)!.add(e.to.node);
  }
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const d = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let v = 0;
    for (const r of refs.get(id)!) v = Math.max(v, d(r) + 1);
    visiting.delete(id);
    depth.set(id, v);
    return v;
  };
  const byDepth = [...ids].sort((a, b) => d(a) - d(b) || ids.indexOf(a) - ids.indexOf(b));
  if (mode === 'depth') return byDepth;
  // Close: each table goes right under the last table it references, so lines stay short.
  const out: string[] = [];
  const placed = new Set<string>();
  const visit = (t: string) => {
    out.push(t);
    placed.add(t);
    for (const u of ids) {
      if (placed.has(u) || !refs.get(u)!.has(t)) continue;
      if ([...refs.get(u)!].every((r) => r === u || placed.has(r))) visit(u);
    }
  };
  for (const t of byDepth) if (!placed.has(t) && [...refs.get(t)!].every((r) => r === t || placed.has(r))) visit(t);
  for (const t of byDepth) if (!placed.has(t)) visit(t);
  return out;
}

/** Crossings between two runs of one gap, given which one is deeper. */
function pairCrossings(deep: Run, shallow: Run): number {
  const inSpan = (x: number, r: Run) => x > Math.min(r.stub, r.fk.corridor) && x < Math.max(r.stub, r.fk.corridor);
  let n = 0;
  // The deeper run's stub climbs through the shallower run.
  if (inSpan(deep.stub, shallow)) n++;
  // A corridor going up from the deeper run passes the shallower run.
  if (deep.dir < 0 && inSpan(deep.fk.corridor, shallow)) n++;
  // A corridor going down from the shallower run passes the deeper run.
  if (shallow.dir > 0 && inSpan(shallow.fk.corridor, deep)) n++;
  return n;
}

/** Orders the runs of one gap, shallowest first, with the fewest crossings. */
function orderRuns(runs: Run[]): Run[] {
  const base = [...runs].sort((a, b) => b.stub - a.stub || b.fk.corridor - a.fk.corridor);
  if (runs.length > 7) return base;
  let best = base;
  let bestCost = Infinity;
  const permute = (prefix: Run[], rest: Run[]) => {
    if (!rest.length) {
      let c = 0;
      for (let i = 0; i < prefix.length; i++)
        for (let j = i + 1; j < prefix.length; j++) c += pairCrossings(prefix[j]!, prefix[i]!);
      if (c < bestCost) {
        bestCost = c;
        best = prefix;
      }
      return;
    }
    for (let i = 0; i < rest.length; i++) permute([...prefix, rest[i]!], [...rest.slice(0, i), ...rest.slice(i + 1)]);
  };
  permute([], base);
  return best;
}

function build(input: LayoutInput, strategy: string, outerLongest: boolean, mode: 'depth' | 'close'): Layout {
  const order = stackOrder(input, mode);
  const index = new Map(order.map((id, i) => [id, i]));
  const sizes = order.map((id) => input.sizeOf(id));
  const colX = (id: string, column: string | undefined, w: number) => {
    const x = column ? input.columnX?.(id, column) : undefined;
    return x ?? w / 2;
  };

  const fks: Fk[] = [];
  for (const e of input.model.edges) {
    const from = index.get(e.from.node);
    const to = index.get(e.to.node);
    if (from === undefined || to === undefined || e.kind !== 'foreign-key') continue;
    fks.push({
      edge: e,
      from,
      to,
      fkX: colX(e.from.node, e.from.column, sizes[from]!.width),
      pkX: colX(e.to.node, e.to.column, sizes[to]!.width),
      corridor: 0,
    });
  }

  // Corridors: shorter spans inside, longer spans outside.
  const right = (lo: number, hi: number) => Math.max(...sizes.slice(lo, hi + 1).map((s) => s.width));
  const span = (f: Fk) => [Math.min(f.from, f.to), Math.max(f.from, f.to)] as const;
  const byLength = [...fks].sort((a, b) => {
    const la = span(a)[1] - span(a)[0];
    const lb = span(b)[1] - span(b)[0];
    return outerLongest ? la - lb || a.from - b.from : lb - la || a.from - b.from;
  });
  const assigned: Fk[] = [];
  for (const f of byLength) {
    const [lo, hi] = span(f);
    let x = PAD + right(lo, hi) + STEP;
    const clash = () =>
      assigned.some((g) => {
        const [glo, ghi] = span(g);
        return glo <= hi && lo <= ghi && Math.abs(g.corridor - x) < STEP;
      });
    while (clash()) x += STEP;
    f.corridor = x;
    assigned.push(f);
  }

  // Several lines into one PK cell (or out of one FK cell) arrive side by side.
  const spread = (key: (f: Fk) => string, get: (f: Fk) => number, set: (f: Fk, v: number) => void) => {
    const groups = new Map<string, Fk[]>();
    for (const f of fks) groups.set(key(f), [...(groups.get(key(f)) ?? []), f]);
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => a.corridor - b.corridor);
      const c = get(g[0]!);
      g.forEach((f, i) => set(f, c + (i - (g.length - 1) / 2) * 14));
    }
  };
  spread(
    (f) => `${f.to}|${f.edge.to.column}`,
    (f) => f.pkX,
    (f, v) => (f.pkX = v),
  );
  spread(
    (f) => `${f.from}|${f.edge.from.column}`,
    (f) => f.fkX,
    (f, v) => (f.fkX = v),
  );

  // Runs per gap (the gap under table i).
  const gaps = order.map(() => [] as Run[]);
  for (const f of fks) {
    // A self-reference has both runs in one gap and no corridor between gaps.
    const dir = Math.sign(f.to - f.from);
    gaps[f.from]!.push({ fk: f, kind: 'fk', stub: f.fkX, dir });
    gaps[f.to]!.push({ fk: f, kind: 'pk', stub: f.pkX, dir: -dir });
  }
  const depthOf = new Map<Run, number>();
  gaps.forEach((runs) => {
    orderRuns(runs).forEach((r, k) => depthOf.set(r, STEP + k * RUN));
  });

  // Vertical positions: each gap is as deep as its runs need.
  const placement: Placement = new Map();
  let y = PAD;
  order.forEach((id, i) => {
    const s = sizes[i]!;
    placement.set(id, { x: PAD, y: snap(y, GRID), width: s.width, height: s.height });
    const need = gaps[i]!.length ? STEP + (gaps[i]!.length - 1) * RUN + 2 * STEP : 3 * STEP;
    y += s.height + Math.max(4 * STEP, need + STEP);
  });

  const edges: Record<string, EdgeRoute> = {};
  for (const f of fks) {
    const fr = placement.get(f.edge.from.node)!;
    const tr = placement.get(f.edge.to.node)!;
    const fkRun = gaps[f.from]!.find((r) => r.fk === f && r.kind === 'fk')!;
    const pkRun = gaps[f.to]!.find((r) => r.fk === f && r.kind === 'pk')!;
    const yf = fr.y + fr.height + depthOf.get(fkRun)!;
    const yp = tr.y + tr.height + depthOf.get(pkRun)!;
    const fx = fr.x + f.fkX;
    const px = tr.x + f.pkX;
    const points: Point[] = [
      { x: fx, y: fr.y + fr.height },
      { x: fx, y: yf },
      { x: f.corridor, y: yf },
      { x: f.corridor, y: yp },
      { x: px, y: yp },
      { x: px, y: tr.y + tr.height },
    ];
    edges[f.edge.id] = { id: f.edge.id, points, labels: [] };
  }
  return assemble(input, strategy, placement, edges, []);
}

export function layoutRelational(input: LayoutInput): Layout[] {
  return [
    build(input, 'relational:depth', true, 'depth'),
    build(input, 'relational:close', true, 'close'),
    build(input, 'relational:close-inner-long', false, 'close'),
  ];
}
