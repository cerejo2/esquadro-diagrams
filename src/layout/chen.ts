// Chen ER layout (FBD notation, docs/notacoes.md).
//
// ELK places entities and relationship diamonds with each diamond in the layer
// between the entities it joins. Each node's box is inflated with room for its
// attribute ellipses, which fan out on the side away from the relationships
// (above and below when the links run left to right, beside them when they run
// top to bottom). Lines are straight, border to border, as in the reference.
import type { DiagramEdge, DiagramNode } from '../model/types';
import { placeWithElk, type ElkInputEdge, type ElkPlacementOptions } from './elk';
import { assemble, GRID, PAD } from './finish';
import { borderPoint, center, diamondBorderPoint, rectsOverlap, segmentHitsRect, snap } from './geometry';
import { components, packComponents, snapAndNormalize, type Placement } from './polish';
import type { EdgeRoute, Layout, LayoutInput, PlacedLabel, Point, Rect, Size, Trunk } from './types';

const ELL_GAP = 12; // between ellipses of one fan
const FAN_GAP = 28; // between the owner and its fan
const MAX_PER_SIDE = 4;

const isDiamond = (n: DiagramNode) => n.kind === 'relationship' || n.kind === 'identifying-relationship';

interface Fan {
  /** Attribute indexes on the first side (above or left) and the second (below or right). */
  a: number[];
  b: number[];
}

function fanOf(n: DiagramNode): Fan {
  const idx = (n.attributes ?? []).map((_, i) => i);
  if (idx.length <= MAX_PER_SIDE) return { a: idx, b: [] };
  const half = Math.ceil(idx.length / 2);
  return { a: idx.slice(0, half), b: idx.slice(half) };
}

function shapeBorder(n: DiagramNode, r: Rect, toward: Point): Point {
  if (isDiamond(n)) return diamondBorderPoint(r, toward);
  return borderPoint(r, toward);
}

async function build(
  input: LayoutInput,
  strategy: string,
  dir: 'RIGHT' | 'DOWN',
  elkOpts: ElkPlacementOptions,
): Promise<Layout> {
  const { model } = input;
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const attrSize = (id: string, i: number): Size => input.attributeSize?.(id, i) ?? { width: 80, height: 40 };
  const vertical = dir === 'RIGHT'; // fans above/below when links run sideways

  // Inflated sizes: the shape plus its fans.
  const fans = new Map<string, Fan>();
  const shape = new Map<string, Size>();
  const outer = new Map<string, Size>();
  const offset = new Map<string, Point>();
  for (const n of model.nodes) {
    const s = input.sizeOf(n.id);
    shape.set(n.id, s);
    const f = fanOf(n);
    fans.set(n.id, f);
    const along = (list: number[]) =>
      list.reduce((t, i) => t + (vertical ? attrSize(n.id, i).width : attrSize(n.id, i).height), 0) +
      Math.max(0, list.length - 1) * ELL_GAP;
    const across = (list: number[]) =>
      list.length
        ? Math.max(...list.map((i) => (vertical ? attrSize(n.id, i).height : attrSize(n.id, i).width))) + FAN_GAP
        : 0;
    const extraA = across(f.a);
    const extraB = across(f.b);
    if (vertical) {
      const w = Math.max(s.width, along(f.a), along(f.b));
      outer.set(n.id, { width: w, height: extraA + s.height + extraB });
      offset.set(n.id, { x: (w - s.width) / 2, y: extraA });
    } else {
      const h = Math.max(s.height, along(f.a), along(f.b));
      outer.set(n.id, { width: extraA + s.width + extraB, height: h });
      offset.set(n.id, { x: extraA, y: (h - s.height) / 2 });
    }
  }

  // Layering: first participant → diamond → other participants; super → sub for isa.
  const layer: ElkInputEdge[] = [];
  const byRel = new Map<string, DiagramEdge[]>();
  for (const e of model.edges) {
    if (e.kind === 'participation') byRel.set(e.to.node, [...(byRel.get(e.to.node) ?? []), e]);
    else if (e.kind === 'isa') layer.push({ id: e.id, source: e.to.node, target: e.from.node });
  }
  for (const [rel, es] of byRel) {
    es.forEach((e, i) => {
      if (i === 0) layer.push({ id: e.id, source: e.from.node, target: rel });
      else layer.push({ id: e.id, source: rel, target: e.from.node });
    });
  }
  const ids = model.nodes.map((n) => n.id);
  const parts: Placement[] = [];
  for (const comp of components(
    ids,
    layer.map((e) => [e.source, e.target]),
  )) {
    const set = new Set(comp);
    parts.push(
      await placeWithElk(
        comp,
        outer,
        layer.filter((e) => set.has(e.source) && set.has(e.target)),
        { ...elkOpts, direction: dir },
      ),
    );
  }
  const packed = parts.length > 1 ? packComponents(parts, 48) : parts[0]!;
  const grid = input.grid ?? GRID;
  snapAndNormalize(packed, grid, PAD);
  // From the inflated box to the shape itself, on the grid.
  const placement: Placement = new Map();
  for (const [id, r] of packed) {
    const o = offset.get(id)!;
    const s = shape.get(id)!;
    placement.set(id, { x: snap(r.x + o.x, grid), y: snap(r.y + o.y, grid), width: s.width, height: s.height });
  }

  // Attribute ellipses.
  const attributes: Record<string, Rect[]> = {};
  for (const n of model.nodes) {
    const r = placement.get(n.id)!;
    const f = fans.get(n.id)!;
    const list: Rect[] = [];
    const lay = (idx: number[], first: boolean) => {
      const sizes = idx.map((i) => attrSize(n.id, i));
      const total =
        sizes.reduce((t, s) => t + (vertical ? s.width : s.height), 0) + Math.max(0, idx.length - 1) * ELL_GAP;
      let pos = vertical ? r.x + r.width / 2 - total / 2 : r.y + r.height / 2 - total / 2;
      idx.forEach((i, k) => {
        const s = sizes[k]!;
        // A gentle arc: the middle ellipses sit a little further out.
        const t = idx.length > 1 ? (k / (idx.length - 1)) * 2 - 1 : 0;
        const lift = idx.length > 2 ? Math.round(10 * (1 - t * t)) : 0;
        let rect: Rect;
        if (vertical) {
          const y = first ? r.y - FAN_GAP - s.height - lift : r.y + r.height + FAN_GAP + lift;
          rect = { x: pos, y, width: s.width, height: s.height };
          pos += s.width + ELL_GAP;
        } else {
          const x = first ? r.x - FAN_GAP - s.width - lift : r.x + r.width + FAN_GAP + lift;
          rect = { x, y: pos, width: s.width, height: s.height };
          pos += s.height + ELL_GAP;
        }
        list[i] = { x: snap(rect.x, 1), y: snap(rect.y, 1), width: rect.width, height: rect.height };
      });
    };
    lay(f.a, true);
    lay(f.b, false);
    if (list.length) attributes[n.id] = list;
  }

  // Lines: straight, border to border. Repeated pairs (self relationships) get parallel offsets.
  const edges: Record<string, EdgeRoute> = {};
  const pairCount = new Map<string, number>();
  const pairSeen = new Map<string, number>();
  for (const e of model.edges) {
    if (e.kind !== 'participation') continue;
    const k = `${e.from.node}|${e.to.node}`;
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  }
  for (const e of model.edges) {
    if (e.kind !== 'participation') continue;
    const a = byId.get(e.from.node);
    const b = byId.get(e.to.node);
    if (!a || !b) continue;
    const ra = placement.get(a.id)!;
    const rb = placement.get(b.id)!;
    const k = `${a.id}|${b.id}`;
    const n = pairCount.get(k)!;
    const i = pairSeen.get(k) ?? 0;
    pairSeen.set(k, i + 1);
    const ca = center(ra);
    const cb = center(rb);
    const len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
    const off = (i - (n - 1) / 2) * 16;
    const nx = (-(cb.y - ca.y) / len) * off;
    const ny = ((cb.x - ca.x) / len) * off;
    const sa = { x: ca.x + nx, y: ca.y + ny };
    const sb = { x: cb.x + nx, y: cb.y + ny };
    const p1 = clipFrom(a, ra, sa, sb);
    const p2 = clipFrom(b, rb, sb, sa);
    edges[e.id] = { id: e.id, points: [p1, p2], labels: [] };
  }

  // Specialization: subs → circle → super.
  const trunks: Trunk[] = [];
  const isaBySuper = new Map<string, DiagramEdge[]>();
  for (const e of model.edges)
    if (e.kind === 'isa') isaBySuper.set(e.to.node, [...(isaBySuper.get(e.to.node) ?? []), e]);
  for (const [sup, es] of [...isaBySuper].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const rs = placement.get(sup);
    if (!rs) continue;
    const cs = center(rs);
    const subs = es.map((e) => center(placement.get(e.from.node)!));
    const avg = {
      x: subs.reduce((t, p) => t + p.x, 0) / subs.length,
      y: subs.reduce((t, p) => t + p.y, 0) / subs.length,
    };
    const toward = borderPoint(rs, avg);
    const d = Math.hypot(avg.x - cs.x, avg.y - cs.y) || 1;
    const circle = { x: toward.x + ((avg.x - cs.x) / d) * 36, y: toward.y + ((avg.y - cs.y) / d) * 36 };
    const branches = es.map((e) => {
      const r = placement.get(e.from.node)!;
      return [borderPoint(r, circle), circle];
    });
    trunks.push({
      id: `isa:${sup}`,
      kind: 'isa',
      parent: sup,
      edges: es.map((e) => e.id),
      branches,
      stem: [circle, toward],
    });
    es.forEach(
      (e, i) => (edges[e.id] = { id: e.id, points: [...branches[i]!, toward], labels: [], trunk: `isa:${sup}` }),
    );
  }

  // Cardinalities next to the entity end, off the line.
  const taken: Rect[] = [];
  const shapes: Rect[] = [...placement.values(), ...Object.values(attributes).flat()];
  const segs: [Point, Point][] = [];
  for (const r of Object.values(edges))
    for (let i = 1; i < r.points.length; i++) segs.push([r.points[i - 1]!, r.points[i]!]);
  for (const t of trunks) segs.push([t.stem[0]!, t.stem[1]!]);
  for (const [id, list] of Object.entries(attributes)) {
    const owner = placement.get(id)!;
    for (const r of list) segs.push([center(r), center(owner)]);
  }
  const blocked = (b: Rect) =>
    taken.some((t) => rectsOverlap(t, b, 2)) ||
    shapes.some((r) => rectsOverlap(r, b, 2)) ||
    segs.some(([p, q]) =>
      segmentHitsRect(p, q, { x: b.x - 2, y: b.y - 2, width: b.width + 4, height: b.height + 4 }, 0),
    );
  for (const e of model.edges) {
    const route = edges[e.id];
    // The analyzer writes the cardinality on the relationship end; it is drawn by the entity.
    const text = e.kind === 'participation' ? (e.to.multiplicity ?? e.from.multiplicity) : undefined;
    if (!route || !text) continue;
    const label = cardinality(route.points, text, input.labelSize(text), blocked);
    taken.push(label);
    route.labels.push(label);
  }

  const layout = assemble(input, strategy, placement, edges, trunks);
  layout.attributes = attributes;
  // assemble() measured the drawing without the ellipses: grow it to include them.
  for (const list of Object.values(attributes)) {
    for (const r of list) {
      layout.width = Math.max(layout.width, Math.ceil(r.x + r.width + PAD));
      layout.height = Math.max(layout.height, Math.ceil(r.y + r.height + PAD));
    }
  }
  return layout;
}

function clipFrom(n: DiagramNode, r: Rect, from: Point, toward: Point): Point {
  // Shift the shape so its centre is on the (possibly offset) line, clip, shift back.
  const c = center(r);
  const dx = from.x - c.x;
  const dy = from.y - c.y;
  const moved = { ...r, x: r.x + dx, y: r.y + dy };
  const p = shapeBorder(n, moved, toward);
  return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
}

function cardinality(points: Point[], text: string, s: Size, blocked: (r: Rect) => boolean): PlacedLabel {
  const [a, b] = points as [Point, Point];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const cands: Rect[] = [];
  for (const along of [18, 28, 40, 54].map((d) => Math.min(d, len / 2))) {
    for (const side of [1, -1]) {
      const off = 6 + Math.hypot(s.width, s.height) / 2;
      const cx = a.x + ux * along - uy * off * side;
      const cy = a.y + uy * along + ux * off * side;
      cands.push({ x: cx - s.width / 2, y: cy - s.height / 2, width: s.width, height: s.height });
    }
  }
  const pick = cands.find((c) => !blocked(c)) ?? cands[0]!;
  return { ...pick, text, at: 'source' };
}

export async function layoutChen(input: LayoutInput): Promise<Layout[]> {
  return Promise.all([
    build(input, 'chen:right:brandes', 'RIGHT', { nodeSpacing: 40, layerSpacing: 72 }),
    build(input, 'chen:right:simplex', 'RIGHT', {
      nodePlacement: 'NETWORK_SIMPLEX',
      nodeSpacing: 40,
      layerSpacing: 72,
    }),
    build(input, 'chen:down:brandes', 'DOWN', { nodeSpacing: 40, layerSpacing: 64 }),
  ]);
}
