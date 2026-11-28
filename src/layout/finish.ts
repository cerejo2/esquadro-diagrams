// Shared last step of every layout strategy: route, measure, score.
import type { DiagramEdge, DiagramModel } from '../model/types';
import { union } from './geometry';
import type { Placement } from './polish';
import { routeEdges, type EdgePolicy } from './routing';
import { scoreLayout } from './score';
import type { Layout, LayoutInput, Rect } from './types';

export const GRID = 8;
export const PAD = 24;

const HIER = new Set(['generalization', 'realization']);

/** Parent → children used for centring and the symmetry score. */
export function treeOf(model: DiagramModel): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (p: string, c: string) => {
    const l = out.get(p) ?? [];
    if (!l.includes(c)) l.push(c);
    out.set(p, l);
  };
  const uml = model.kind === 'java.class' || model.kind === 'c.struct';
  for (const e of model.edges) {
    if (e.from.node === e.to.node) continue;
    if (HIER.has(e.kind)) add(e.to.node, e.from.node);
    else if (!uml && (e.kind === 'call' || e.kind === 'include' || e.kind === 'flow')) add(e.from.node, e.to.node);
  }
  return out;
}

/** Routes, measures and scores a finished placement. */
export function finish(
  input: LayoutInput,
  strategy: string,
  nodes: Placement,
  opts: {
    trunks?: boolean;
    policy?: (e: DiagramEdge) => EdgePolicy;
    bendCost?: number;
    crossCost?: number;
    overlapCost?: number;
  },
): Layout {
  const { edges, trunks } = routeEdges(input.model, nodes, {
    trunks: opts.trunks,
    policy: opts.policy,
    bendCost: opts.bendCost,
    crossCost: opts.crossCost,
    overlapCost: opts.overlapCost,
    grid: input.grid ?? GRID,
    labelSize: input.labelSize,
  });
  return assemble(input, strategy, nodes, edges, trunks);
}

export function assemble(
  input: LayoutInput,
  strategy: string,
  nodes: Placement,
  edges: Layout['edges'],
  trunks: Layout['trunks'],
): Layout {
  const all: Rect[] = [...nodes.values()];
  for (const r of Object.values(edges)) {
    for (const p of r.points) all.push({ x: p.x, y: p.y, width: 0, height: 0 });
    all.push(...r.labels);
  }
  const box = union(all);
  const layout: Layout = {
    strategy,
    width: Math.ceil(box.x + box.width + PAD),
    height: Math.ceil(box.y + box.height + PAD),
    nodes: Object.fromEntries(nodes),
    edges,
    trunks,
  };
  layout.score = scoreLayout(layout, {
    childrenOf: treeOf(input.model),
    ends: new Map(input.model.edges.map((e) => [e.id, [e.from.node, e.to.node] as const])),
    ...(input.model.kind === 'sql.relational' ? { bendAllowance: 4, aspectTarget: 0.6 } : {}),
  });
  return layout;
}
