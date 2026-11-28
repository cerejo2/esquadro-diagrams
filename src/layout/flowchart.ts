// ISO 5807 flowchart layout, top to bottom.
//
// The main path runs down one column. At a decision, one branch continues
// down and the other leaves to the right, into the next free column. Which one
// goes down: in the strict variant "sim" always goes down (the rule seen in the
// reference); in the default variant the longer branch goes down, so a chain
// of guard clauses ("if error, exit") does not walk the main path off to the
// right one step per check. Loops return on the left. Both variants are
// scored and the better one wins.
import type { DiagramEdge, DiagramModel } from '../model/types';
import { finish, GRID, PAD } from './finish';
import type { Placement } from './polish';
import type { EdgePolicy } from './routing';
import type { Layout, LayoutInput, Side } from './types';

const YES = new Set(['sim', 'yes', 's', 'y', 'true', 'verdadeiro']);

interface Graph {
  start: string;
  out: Map<string, DiagramEdge[]>;
  back: Set<string>;
}

function graphOf(model: DiagramModel): Graph {
  const out = new Map<string, DiagramEdge[]>();
  const indeg = new Map<string, number>();
  for (const n of model.nodes) {
    out.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const e of model.edges) {
    if (!out.has(e.from.node) || !out.has(e.to.node)) continue;
    out.get(e.from.node)!.push(e);
    indeg.set(e.to.node, (indeg.get(e.to.node) ?? 0) + 1);
  }
  const start =
    model.nodes.find((n) => n.kind === 'terminator' && !indeg.get(n.id))?.id ??
    model.nodes.find((n) => !indeg.get(n.id))?.id ??
    model.nodes[0]!.id;
  // Back edges: DFS from the start (and then from any node not reached yet).
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const visit = (root: string) => {
    const stack: [string, number][] = [[root, 0]];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const edges = out.get(top[0])!;
      if (top[1] >= edges.length) {
        state.set(top[0], 2);
        stack.pop();
        continue;
      }
      const e = edges[top[1]++]!;
      const s = state.get(e.to.node);
      if (s === 1) back.add(e.id);
      else if (!s) {
        state.set(e.to.node, 1);
        stack.push([e.to.node, 0]);
      }
    }
  };
  visit(start);
  for (const n of model.nodes) if (!state.has(n.id)) visit(n.id);
  return { start, out, back };
}

function reach(g: Graph, from: string): Set<string> {
  const seen = new Set<string>([from]);
  const todo = [from];
  while (todo.length) {
    const n = todo.pop()!;
    for (const e of g.out.get(n) ?? []) {
      if (g.back.has(e.id) || seen.has(e.to.node)) continue;
      seen.add(e.to.node);
      todo.push(e.to.node);
    }
  }
  return seen;
}

type Variant = 'longest-down' | 'yes-down';

function place(
  input: LayoutInput,
  g: Graph,
  variant: Variant,
): { placement: Placement; down: Set<string>; flat: Set<string> } {
  const { model } = input;
  // Which out-edge of each decision continues down.
  const down = new Set<string>();
  for (const n of model.nodes) {
    const edges = (g.out.get(n.id) ?? []).filter((e) => !g.back.has(e.id));
    if (!edges.length) continue;
    if (edges.length === 1) {
      down.add(edges[0]!.id);
      continue;
    }
    const yes = edges.find((e) => YES.has((e.label ?? '').toLowerCase())) ?? edges[0]!;
    const sets = edges.map((e) => reach(g, e.to.node));
    const exclusive = edges.map(
      (_, i) => [...sets[i]!].filter((id) => sets.every((s, j) => j === i || !s.has(id))).length,
    );
    const max = Math.max(...exclusive);
    const longest = edges[exclusive.indexOf(max)]!;
    const yesSize = exclusive[edges.indexOf(yes)]!;
    // Strict variant: "sim" goes down, unless its branch is much shorter (a guard clause).
    const pick = variant === 'longest-down' ? (yesSize === max ? yes : longest) : yesSize * 2 < max ? longest : yes;
    down.add(pick.id);
  }

  const forward = (id: string) => (g.out.get(id) ?? []).filter((e) => !g.back.has(e.id));
  const ins = new Map<string, DiagramEdge[]>();
  for (const n of model.nodes) for (const e of forward(n.id)) ins.set(e.to.node, [...(ins.get(e.to.node) ?? []), e]);

  // A short side branch that ends the script ("if error: show it, exit") lies flat,
  // in the decision's own row, instead of taking rows away from the main path.
  const flat = new Set<string>();
  for (const n of model.nodes) {
    for (const e of forward(n.id)) {
      if (down.has(e.id) || forward(n.id).length < 2) continue;
      const chain: DiagramEdge[] = [e];
      let cur = e.to.node;
      let ok = true;
      while (ok) {
        if ((ins.get(cur) ?? []).length !== 1) ok = false;
        const next = forward(cur);
        if (!next.length) break;
        if (next.length > 1 || chain.length >= 3) ok = false;
        else {
          chain.push(next[0]!);
          cur = next[0]!.to.node;
        }
      }
      if (ok) for (const c of chain) flat.add(c.id);
    }
  }

  // Rows: longest path over the forward edges; flat edges stay in the row.
  const row = new Map<string, number>([[g.start, 0]]);
  const order = topo(model, g);
  for (const id of order) {
    const r = row.get(id) ?? 0;
    row.set(id, r);
    for (const e of forward(id)) {
      // A side branch starts beside its decision, in the same row.
      const next = flat.has(e.id) || !down.has(e.id) ? r : r + 1;
      row.set(e.to.node, Math.max(row.get(e.to.node) ?? 0, next));
    }
  }

  // Columns, in topological order: a down edge keeps the column, a side edge
  // moves one column right, a node where branches meet takes the leftmost.
  const col = new Map<string, number>();
  const taken = new Set<string>();
  for (const id of order) {
    const wanted = (ins.get(id) ?? [])
      .filter((e) => col.has(e.from.node))
      .map((e) => col.get(e.from.node)! + (down.has(e.id) && !flat.has(e.id) ? 0 : 1));
    let c = wanted.length ? Math.min(...wanted) : 0;
    while (taken.has(`${row.get(id)!}:${c}`)) c++;
    col.set(id, c);
    taken.add(`${row.get(id)!}:${c}`);
  }

  // Coordinates: columns as wide as their widest shape, rows as tall as their tallest.
  // Sizes are rounded to two grid steps so every centre falls on the grid.
  const size = (id: string) => {
    const s = input.sizeOf(id);
    return { width: Math.ceil(s.width / (2 * GRID)) * 2 * GRID, height: Math.ceil(s.height / (2 * GRID)) * 2 * GRID };
  };
  const colWidth = new Map<number, number>();
  const rowHeight = new Map<number, number>();
  for (const n of model.nodes) {
    const s = size(n.id);
    const c = col.get(n.id) ?? 0;
    const r = row.get(n.id) ?? 0;
    colWidth.set(c, Math.max(colWidth.get(c) ?? 0, s.width));
    rowHeight.set(r, Math.max(rowHeight.get(r) ?? 0, s.height));
  }
  const hGap = 6 * GRID;
  const vGap = 4 * GRID;
  // Room on the left for loops coming back.
  const loopRoom = g.back.size ? 4 * GRID : 0;
  const colX = new Map<number, number>();
  let x = PAD + loopRoom;
  for (const c of [...colWidth.keys()].sort((a, b) => a - b)) {
    colX.set(c, x + colWidth.get(c)! / 2);
    x += colWidth.get(c)! + hGap;
  }
  const rowY = new Map<number, number>();
  let y = PAD;
  for (const r of [...rowHeight.keys()].sort((a, b) => a - b)) {
    rowY.set(r, y + rowHeight.get(r)! / 2);
    y += rowHeight.get(r)! + vGap;
  }
  const placement: Placement = new Map();
  for (const n of model.nodes) {
    const s = size(n.id);
    const cx = colX.get(col.get(n.id) ?? 0)!;
    const cy = rowY.get(row.get(n.id) ?? 0)!;
    placement.set(n.id, { x: cx - s.width / 2, y: cy - s.height / 2, width: s.width, height: s.height });
  }
  return { placement, down, flat };
}

function topo(model: DiagramModel, g: Graph): string[] {
  const indeg = new Map(model.nodes.map((n) => [n.id, 0]));
  for (const edges of g.out.values())
    for (const e of edges) if (!g.back.has(e.id)) indeg.set(e.to.node, indeg.get(e.to.node)! + 1);
  const ready = [g.start, ...model.nodes.map((n) => n.id).filter((id) => id !== g.start && !indeg.get(id))];
  const out: string[] = [];
  const seen = new Set<string>();
  while (ready.length) {
    const id = ready.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const e of g.out.get(id) ?? []) {
      if (g.back.has(e.id)) continue;
      const d = indeg.get(e.to.node)! - 1;
      indeg.set(e.to.node, d);
      if (d === 0) ready.push(e.to.node);
    }
  }
  for (const n of model.nodes) if (!seen.has(n.id)) out.push(n.id);
  return out;
}

export function layoutFlowchart(input: LayoutInput): Layout[] {
  const g = graphOf(input.model);
  const out: Layout[] = [];
  for (const variant of ['longest-down', 'yes-down'] as const) {
    const { placement, down, flat } = place(input, g, variant);
    const policy = (e: DiagramEdge): EdgePolicy => {
      if (g.back.has(e.id)) {
        // Loops return on the left; from a side column they may come back on the right instead of crossing the main path.
        return {
          fromSideCost: { bottom: 40, top: 80, right: 80 },
          toSides: ['left', 'right'],
          toSideCost: { right: 150 },
        };
      }
      if (flat.has(e.id)) return { fromSides: ['right'], toSides: ['left'] };
      const from = placement.get(e.from.node)!;
      const to = placement.get(e.to.node)!;
      if (down.has(e.id) && Math.abs(from.x + from.width / 2 - (to.x + to.width / 2)) < 1) {
        return { fromSides: ['bottom'], toSides: ['top'] };
      }
      const fromSides: Side[] = down.has(e.id) ? ['bottom'] : ['right'];
      return {
        fromSides,
        toSides: ['top', 'right', 'left'],
        fromSideCost: { bottom: 60 },
        toSideCost: { right: 30, left: 50 },
      };
    };
    out.push(finish(input, `flow:${variant}`, placement, { policy, bendCost: 80, crossCost: 1000, overlapCost: 600 }));
  }
  return out;
}
