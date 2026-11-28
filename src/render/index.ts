// Glue between the model, the layout and the scene.
//
//   const prepared = prepareLayout(model, 'vp', 'pt');
//   const layouts = await layoutCandidates(prepared.input);
//   const scene = buildScene(prepared, layouts[0]);
import { layoutCandidates } from '../layout/candidates';
import { borderPoint, center, diamondBorderPoint, ellipseBorderPoint } from '../layout/geometry';
import type { Layout, LayoutInput, Point, Rect } from '../layout/types';
import type { DiagramModel } from '../model/types';
import { chenAttributes, nodeShape, type Locale, type NodeShape } from './notations/nodes';
import { drawEdge, drawTrunk, edgeLength, edgeSentence, trunkBranch } from './notations/edges';
import { roughen, seedOf } from './rough';
import type { Prim, Scene, SceneEdge, SceneNode } from './scene';
import { textWidth } from './text';
import { THEMES, type Theme, type ThemeId } from './themes';

export interface Prepared {
  model: DiagramModel;
  theme: Theme;
  locale: Locale;
  shapes: Map<string, NodeShape>;
  input: LayoutInput;
}

export function prepareLayout(model: DiagramModel, themeId: ThemeId, locale: Locale = 'pt'): Prepared {
  const theme = THEMES[themeId];
  const shapes = new Map(model.nodes.map((n) => [n.id, nodeShape(n, model.kind, theme, locale)]));
  const labelFont = {
    size: theme.size.label,
    family: theme.fontClass === 'hand' ? ('hand' as const) : ('sans' as const),
  };
  const input: LayoutInput = {
    model,
    sizeOf: (id) => shapes.get(id)!.size,
    labelSize: (text) => ({ width: textWidth(text, labelFont) + 2, height: Math.round(theme.size.label * 1.3) }),
    columnX: (id, column) => shapes.get(id)?.columnX?.get(column),
    attributeSize: (id, i) => shapes.get(id)?.attributeSizes?.[i] ?? { width: 84, height: 40 },
  };
  return { model, theme, locale, shapes, input };
}

export async function layoutAndScene(model: DiagramModel, themeId: ThemeId, locale: Locale = 'pt') {
  const prepared = prepareLayout(model, themeId, locale);
  const layouts = await layoutCandidates(prepared.input);
  return { prepared, layouts, scene: buildScene(prepared, layouts[0]!) };
}

/** Rows of the drawing, top to bottom, for the entrance stagger. */
function ranks(layout: Layout): Map<string, number> {
  const tops = [...new Set(Object.values(layout.nodes).map((r) => r.y))].sort((a, b) => a - b);
  const bands: number[] = [];
  for (const t of tops) if (!bands.length || t - bands[bands.length - 1]! > 16) bands.push(t);
  const out = new Map<string, number>();
  for (const [id, r] of Object.entries(layout.nodes)) {
    let k = 0;
    while (k + 1 < bands.length && bands[k + 1]! <= r.y + 0.5) k++;
    out.set(id, k);
  }
  return out;
}

export function buildScene(p: Prepared, layout: Layout): Scene {
  const { model, theme, locale } = p;
  const rough = theme.rough;
  const rk = ranks(layout);
  const nodes: SceneNode[] = [];
  for (const n of model.nodes) {
    const box = layout.nodes[n.id];
    if (!box) continue;
    const shape = p.shapes.get(n.id)!;
    let { body, text } = shape.draw(box);
    const ellipses = layout.attributes?.[n.id];
    if (ellipses) {
      const diamond = n.kind === 'relationship' || n.kind === 'identifying-relationship';
      const links: Prim[] = ellipses.map((r) => {
        const c = center(r);
        const a = ellipseBorderPoint(r, center(box));
        const b = diamond ? diamondBorderPoint(box, c) : borderPoint(box, c);
        return { t: 'poly', pts: [a, b], fill: 'none', stroke: theme.stroke, sw: theme.strokeWidth };
      });
      const att = chenAttributes(n, theme, ellipses);
      body = [...links, ...body, ...att.body];
      text = [...text, ...att.text];
    }
    if (rough) body = roughen(body, seedOf(n.id), rough);
    const ref = n.ref ?? n.evidence?.find((e) => e.ref)?.ref;
    nodes.push({
      id: n.id,
      box,
      body,
      text,
      aria: shape.aria,
      rank: rk.get(n.id) ?? 0,
      source: ref ? `${ref.file}:${ref.line}` : undefined,
    });
  }

  const trunks = new Map(layout.trunks.map((t) => [t.id, t]));
  const owner = new Set(layout.trunks.map((t) => t.edges[0]!));
  const edges: SceneEdge[] = [];
  for (const e of model.edges) {
    const route = layout.edges[e.id];
    if (!route) continue;
    let lines: Prim[];
    let heads: Prim[];
    const trunk = route.trunk ? trunks.get(route.trunk) : undefined;
    if (trunk) {
      lines = trunkBranch(trunk, e.id, theme);
      heads = [];
      if (owner.has(e.id)) {
        const t = drawTrunk(trunk, theme);
        lines.push(...t.lines);
        heads.push(...t.heads);
      }
    } else ({ lines, heads } = drawEdge(e, route, model.kind, theme));
    if (rough) {
      const seed = seedOf(e.id);
      lines = roughen(lines, seed, { ...rough, bowing: rough.bowing * 0.5 });
      heads = roughen(heads, seed + 1, { roughness: rough.roughness * 0.6, bowing: 0 });
    }
    const labels: Prim[] = route.labels.map((l) => ({
      t: 'text',
      x: l.x + 1,
      y: l.y + l.height / 2 + theme.size.label * 0.35,
      text: l.text,
      size: theme.size.label,
      weight: e.kind === 'participation' ? 700 : 400,
      anchor: 'start',
      fill: theme.text,
      family: 'sans',
    }));
    edges.push({
      id: e.id,
      lines,
      heads,
      labels,
      ends: [e.from.node, e.to.node],
      length: edgeLength(route),
      sentence: edgeSentence(e, model, locale),
      trunk: route.trunk,
    });
  }
  return {
    width: layout.width,
    height: layout.height,
    background: theme.background,
    paper: theme.paper,
    fontFamily: theme.fontFamily,
    monoFamily: theme.monoFamily,
    nodes,
    edges,
  };
}

/** SVG path data for a polyline, with rounded corners when radius > 0. */
export function polyPath(pts: readonly Point[], closed = false, radius = 0): string {
  if (!pts.length) return '';
  const f = (v: number) => Math.round(v * 100) / 100;
  if (radius <= 0 || pts.length < 3) {
    return `M${pts.map((q) => `${f(q.x)} ${f(q.y)}`).join('L')}${closed ? 'Z' : ''}`;
  }
  let d = `M${f(pts[0]!.x)} ${f(pts[0]!.y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const p1 = { x: b.x - ((b.x - a.x) / (l1 || 1)) * r, y: b.y - ((b.y - a.y) / (l1 || 1)) * r };
    const p2 = { x: b.x + ((c.x - b.x) / (l2 || 1)) * r, y: b.y + ((c.y - b.y) / (l2 || 1)) * r };
    d += `L${f(p1.x)} ${f(p1.y)}Q${f(b.x)} ${f(b.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  const last = pts[pts.length - 1]!;
  d += `L${f(last.x)} ${f(last.y)}`;
  return closed ? `${d}Z` : d;
}

export type { Rect };
