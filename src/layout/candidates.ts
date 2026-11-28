// Entry point of the layout stage: builds 3 to 6 candidate layouts with
// different strategies, scores them and returns them best first (§5.2).
import type { DiagramEdge, DiagramKind } from '../model/types';
import { placeWithElk, type ElkInputEdge, type ElkPlacementOptions } from './elk';
import { layoutChen } from './chen';
import { layoutFlowchart } from './flowchart';
import { finish, GRID, PAD, treeOf } from './finish';
import {
  alignRows,
  centerParents,
  compactRow,
  components,
  equalizeWidths,
  packComponents,
  rowsOf,
  snapAndNormalize,
  type Placement,
} from './polish';
import { layoutRelational } from './relational';
import { defaultPolicy, type EdgePolicy } from './routing';
import { compareLayouts } from './score';
import type { Layout, LayoutInput, Rect, Size } from './types';

const HIER = new Set(['generalization', 'realization']);
export const UML_KINDS = new Set<DiagramKind>(['java.class', 'c.struct']);

/** Edges as ELK should see them: the node that must be on top is the source. */
function layeringEdge(e: DiagramEdge, kind: DiagramKind): ElkInputEdge | undefined {
  if (e.from.node === e.to.node) return undefined;
  if (HIER.has(e.kind)) return { id: e.id, source: e.to.node, target: e.from.node };
  if (e.kind === 'foreign-key') return { id: e.id, source: e.to.node, target: e.from.node };
  if (e.kind === 'nesting') return { id: e.id, source: e.to.node, target: e.from.node };
  if (kind === 'java.dependency' || kind === 'java.package' || kind === 'bash.dependency') {
    return { id: e.id, source: e.from.node, target: e.to.node };
  }
  return { id: e.id, source: e.from.node, target: e.to.node };
}

interface Strategy {
  name: string;
  elk: ElkPlacementOptions;
}

function strategiesFor(kind: DiagramKind): Strategy[] {
  const down: Strategy[] = [
    { name: 'elk:down:brandes', elk: { nodePlacement: 'BRANDES_KOEPF' } },
    { name: 'elk:down:simplex', elk: { nodePlacement: 'NETWORK_SIMPLEX' } },
    {
      name: 'elk:down:ordered',
      elk: { nodePlacement: 'BRANDES_KOEPF', modelOrder: true, nodeSpacing: 72, layerSpacing: 96 },
    },
    { name: 'elk:down:linear', elk: { nodePlacement: 'LINEAR_SEGMENTS', nodeSpacing: 64 } },
  ];
  if (kind === 'sql.ssms' || kind === 'sql.crowsfoot' || kind === 'java.dependency' || kind === 'bash.dependency') {
    return [
      { name: 'elk:right:brandes', elk: { direction: 'RIGHT', nodeSpacing: 48, layerSpacing: 96 } },
      {
        name: 'elk:right:simplex',
        elk: { direction: 'RIGHT', nodePlacement: 'NETWORK_SIMPLEX', nodeSpacing: 48, layerSpacing: 96 },
      },
      ...down.slice(0, 3),
    ];
  }
  return down;
}

function policyFor(kind: DiagramKind): (e: DiagramEdge) => EdgePolicy {
  if (kind === 'sql.ssms' || kind === 'sql.crowsfoot') return () => ({});
  return defaultPolicy;
}

async function graphLayout(input: LayoutInput, s: Strategy): Promise<Layout> {
  const { model } = input;
  const ids = model.nodes.map((n) => n.id);
  const sizes = new Map<string, Size>(ids.map((id) => [id, input.sizeOf(id)]));
  const layerEdges = model.edges.map((e) => layeringEdge(e, model.kind)).filter((e): e is ElkInputEdge => !!e);
  const last = new Set(model.nodes.filter((n) => n.kind === 'external').map((n) => n.id));
  const comps = components(
    ids,
    layerEdges.map((e) => [e.source, e.target]),
  );
  const tree = treeOf(model);
  const gap = s.elk.nodeSpacing ?? 56;
  const parts: Placement[] = [];
  for (const comp of comps) {
    const set = new Set(comp);
    const placed = await placeWithElk(
      comp,
      sizes,
      layerEdges.filter((e) => set.has(e.source) && set.has(e.target)),
      { ...s.elk, last },
    );
    if ((s.elk.direction ?? 'DOWN') === 'DOWN') polishRows(placed, tree, gap, s.elk.layerSpacing ?? 80);
    parts.push(placed);
  }
  const all = parts.length > 1 ? packComponents(parts, gap + 16) : (parts[0] ?? new Map<string, Rect>());
  snapAndNormalize(all, input.grid ?? GRID, PAD);
  return finish(input, s.name, all, { trunks: UML_KINDS.has(model.kind), policy: policyFor(model.kind) });
}

function polishRows(p: Placement, tree: ReadonlyMap<string, readonly string[]>, gap: number, layerGap: number): void {
  const rows = rowsOf(p);
  alignRows(p, rows, Math.min(layerGap, 48));
  const rowOf = new Map<string, number>();
  rows.forEach((r, i) => r.forEach((id) => rowOf.set(id, i)));
  const siblings: string[][] = [];
  for (const kids of tree.values()) {
    const byRow = new Map<number, string[]>();
    for (const k of kids) {
      const r = rowOf.get(k);
      if (r === undefined) continue;
      byRow.set(r, [...(byRow.get(r) ?? []), k]);
    }
    siblings.push(...byRow.values());
  }
  equalizeWidths(p, siblings);
  for (const row of rows) compactRow(p, row, gap);
  centerParents(p, rows, tree, gap);
}

/** All candidate layouts for the model, best first. Same input, same output. */
export async function layoutCandidates(input: LayoutInput): Promise<Layout[]> {
  const { model } = input;
  if (!model.nodes.length) {
    return [{ strategy: 'empty', width: 2 * PAD, height: 2 * PAD, nodes: {}, edges: {}, trunks: [] }];
  }
  let out: Layout[];
  switch (model.kind) {
    case 'sql.relational':
      out = layoutRelational(input);
      break;
    case 'sql.chen':
      out = await layoutChen(input);
      break;
    case 'bash.flowchart':
      out = layoutFlowchart(input);
      break;
    default:
      out = [];
      for (const s of strategiesFor(model.kind)) out.push(await graphLayout(input, s));
  }
  // Two strategies can land on the same drawing: keep one of each.
  const seen = new Set<string>();
  out = out.filter((l) => {
    const sig = JSON.stringify(Object.entries(l.nodes).map(([id, r]) => [id, r.x, r.y]));
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
  return out.sort(compareLayouts);
}

export async function layoutBest(input: LayoutInput): Promise<Layout> {
  return (await layoutCandidates(input))[0]!;
}
