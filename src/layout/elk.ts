// ELK wrapper: node placement only.
//
// ELK's layered algorithm is good at the hard combinatorial part (layers,
// order within a layer to reduce crossings, balanced x positions). Its edge
// routes are thrown away: the polish step moves nodes afterwards and our own
// router draws the edges, so they always match the final positions.
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode, LayoutOptions } from 'elkjs/lib/elk-api';
import type { Rect, Size } from './types';

let elk: InstanceType<typeof ELK> | undefined;
const engine = () => (elk ??= new ELK());

export interface ElkInputEdge {
  id: string;
  /** ELK puts sources above targets (direction DOWN). */
  source: string;
  target: string;
}

export interface ElkPlacementOptions {
  direction?: 'DOWN' | 'RIGHT';
  nodeSpacing?: number;
  layerSpacing?: number;
  nodePlacement?: 'BRANDES_KOEPF' | 'NETWORK_SIMPLEX' | 'LINEAR_SEGMENTS';
  crossing?: 'LAYER_SWEEP' | 'NONE';
  modelOrder?: boolean;
  /** Nodes forced into the last layer (externals in call graphs). */
  last?: ReadonlySet<string>;
  first?: ReadonlySet<string>;
}

export async function placeWithElk(
  ids: readonly string[],
  sizes: ReadonlyMap<string, Size>,
  edges: readonly ElkInputEdge[],
  opts: ElkPlacementOptions = {},
): Promise<Map<string, Rect>> {
  const layoutOptions: LayoutOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': opts.direction ?? 'DOWN',
    'elk.randomSeed': '1',
    'elk.spacing.nodeNode': String(opts.nodeSpacing ?? 56),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.layerSpacing ?? 80),
    'elk.layered.nodePlacement.strategy': opts.nodePlacement ?? 'BRANDES_KOEPF',
    'elk.layered.crossingMinimization.strategy': opts.crossing ?? 'LAYER_SWEEP',
    'elk.layered.considerModelOrder.strategy': opts.modelOrder ? 'NODES_AND_EDGES' : 'NONE',
    'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
    'elk.separateConnectedComponents': 'false',
    'elk.edgeRouting': 'ORTHOGONAL',
  };
  const children: ElkNode[] = ids.map((id) => {
    const s = sizes.get(id)!;
    const constraint = opts.last?.has(id) ? 'LAST' : opts.first?.has(id) ? 'FIRST' : undefined;
    return {
      id,
      width: s.width,
      height: s.height,
      ...(constraint ? { layoutOptions: { 'elk.layered.layering.layerConstraint': constraint } } : {}),
    };
  });
  const known = new Set(ids);
  const elkEdges: ElkExtendedEdge[] = edges
    .filter((e) => known.has(e.source) && known.has(e.target) && e.source !== e.target)
    .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }));
  const out = await engine().layout({ id: 'root', layoutOptions, children, edges: elkEdges });
  const placed = new Map<string, Rect>();
  for (const c of out.children ?? []) {
    placed.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 });
  }
  return placed;
}
