// Edge lines, heads and the hover sentence, per notation.
import type { DiagramEdge, DiagramKind, DiagramModel } from '../../model/types';
import type { EdgeRoute, Point, Trunk } from '../../layout/types';
import { polylineLength } from '../../layout/geometry';
import type { Prim } from '../scene';
import type { Theme } from '../themes';
import { keyIcon, type Locale } from './nodes';

type V = { x: number; y: number };

/** Unit vector of the last segment, pointing into the end point. */
function endDir(points: readonly Point[], atStart: boolean): V {
  const [a, b] = atStart ? [points[1]!, points[0]!] : [points[points.length - 2]!, points[points.length - 1]!];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

const at = (p: Point, d: V, back: number, side: number): Point => ({
  x: p.x - d.x * back - d.y * side,
  y: p.y - d.y * back + d.x * side,
});

function triangle(tip: Point, d: V, len: number, half: number, fill: string, stroke: string, sw: number): Prim {
  return { t: 'poly', closed: true, pts: [tip, at(tip, d, len, half), at(tip, d, len, -half)], fill, stroke, sw };
}

function diamond(tip: Point, d: V, fill: string, stroke: string, sw: number): Prim {
  return {
    t: 'poly',
    closed: true,
    pts: [tip, at(tip, d, 10, 6), at(tip, d, 20, 0), at(tip, d, 10, -6)],
    fill,
    stroke,
    sw,
  };
}

function openArrow(tip: Point, d: V, stroke: string, sw: number): Prim {
  return { t: 'poly', pts: [at(tip, d, 11, 6), tip, at(tip, d, 11, -6)], fill: 'none', stroke, sw };
}

/** Shortens a polyline at one end, so a head with a flat base does not overlap the line. */
function trim(points: Point[], atStart: boolean, by: number): Point[] {
  if (by <= 0 || points.length < 2) return points;
  const pts = points.map((p) => ({ ...p }));
  const d = endDir(pts, atStart);
  const i = atStart ? 0 : pts.length - 1;
  pts[i] = { x: pts[i]!.x - d.x * by, y: pts[i]!.y - d.y * by };
  return pts;
}

export interface EdgeDrawing {
  lines: Prim[];
  heads: Prim[];
}

export function drawEdge(e: DiagramEdge, route: EdgeRoute, kind: DiagramKind, theme: Theme): EdgeDrawing {
  const sw = theme.strokeWidth;
  const stroke = theme.stroke;
  const bg = theme.background;
  const radius = theme.edgeRadius;
  const pts = route.points;
  if (pts.length < 2) return { lines: [], heads: [] };
  const line = (p: Point[], dash?: string, w = sw): Prim => ({
    t: 'poly',
    pts: p,
    fill: 'none',
    stroke,
    sw: w,
    dash,
    radius,
  });
  const end = pts[pts.length - 1]!;
  const start = pts[0]!;
  const dEnd = endDir(pts, false);
  const dStart = endDir(pts, true);
  const hollow = bg;

  switch (e.kind) {
    case 'generalization':
    case 'realization':
      return {
        lines: [line(trim(pts, false, 14), e.kind === 'realization' ? '8 6' : undefined)],
        heads: [triangle(end, dEnd, 14, 8, hollow, stroke, sw)],
      };
    case 'aggregation':
    case 'composition':
      return {
        lines: [line(trim(pts, true, 20))],
        heads: [
          diamond(start, dStart, e.kind === 'composition' ? stroke : hollow, stroke, sw),
          ...(e.to.navigable ? [openArrow(end, dEnd, stroke, sw)] : []),
        ],
      };
    case 'association':
    case 'nesting':
      return {
        lines: [line(pts)],
        heads: [
          ...(e.to.navigable ? [openArrow(end, dEnd, stroke, sw)] : []),
          ...(e.from.navigable ? [openArrow(start, dStart, stroke, sw)] : []),
        ],
      };
    case 'dependency':
    case 'uses':
      return { lines: [line(pts, '6 5')], heads: [openArrow(end, dEnd, stroke, sw)] };
    case 'include':
    case 'source':
      return { lines: [line(pts)], heads: [openArrow(end, dEnd, stroke, sw)] };
    case 'call':
      return { lines: [line(trim(pts, false, 9))], heads: [triangle(end, dEnd, 9, 4.5, stroke, stroke, sw)] };
    case 'flow': {
      const w = theme.flowWidth;
      const ink = theme.id === 'vp' ? '#000000' : stroke;
      return {
        lines: [{ t: 'poly', pts: trim(pts, false, 9), fill: 'none', stroke: ink, sw: w }],
        heads: [triangle(end, dEnd, 9, 4.5, ink, ink, w)],
      };
    }
    case 'foreign-key':
      if (kind === 'sql.relational') {
        return { lines: [line(trim(pts, false, 10))], heads: [triangle(end, dEnd, 10, 4, stroke, stroke, sw)] };
      }
      if (kind === 'sql.ssms') {
        // Two parallel strokes, a key at the PK end, ∞ at the FK end.
        const ink = theme.ssms;
        const keyAt = at(end, dEnd, 12, 0);
        const inf1 = at(start, dStart, 7, 0);
        const inf2 = at(start, dStart, 13, 0);
        return {
          lines: [
            { t: 'poly', pts, fill: 'none', stroke: ink.inner, sw: 3.5, radius },
            { t: 'poly', pts, fill: 'none', stroke: bg, sw: 1.2, radius },
          ],
          heads: [
            ...keyIcon(keyAt.x, keyAt.y, ink.key, 1),
            { t: 'ellipse', cx: inf1.x, cy: inf1.y, rx: 3, ry: 3, fill: bg, stroke: ink.outer, sw: 1 },
            { t: 'ellipse', cx: inf2.x, cy: inf2.y, rx: 3, ry: 3, fill: bg, stroke: ink.outer, sw: 1 },
          ],
        };
      }
      // Crow's foot: "many" at the referencing end, "exactly one" at the referenced end.
      return {
        lines: [line(pts)],
        heads: [
          { t: 'poly', pts: [at(start, dStart, 14, 0), at(start, dStart, 0, 8)], fill: 'none', stroke, sw },
          { t: 'poly', pts: [at(start, dStart, 14, 0), at(start, dStart, 0, -8)], fill: 'none', stroke, sw },
          { t: 'poly', pts: [at(start, dStart, 18, 7), at(start, dStart, 18, -7)], fill: 'none', stroke, sw },
          { t: 'poly', pts: [at(end, dEnd, 9, 7), at(end, dEnd, 9, -7)], fill: 'none', stroke, sw },
          { t: 'poly', pts: [at(end, dEnd, 15, 7), at(end, dEnd, 15, -7)], fill: 'none', stroke, sw },
        ],
      };
    case 'participation': {
      if (!e.from.total) return { lines: [line(pts)], heads: [] };
      // Total participation: two strokes 4 px apart.
      const d = endDir(pts, false);
      const off = (s: number) => pts.map((p) => ({ x: p.x - d.y * s, y: p.y + d.x * s }));
      return { lines: [line(off(2)), line(off(-2))], heads: [] };
    }
    default:
      return { lines: [line(pts)], heads: [] };
  }
}

/** One trunk: the bar, the stem and the single head; the branches belong to each edge. */
export function drawTrunk(t: Trunk, theme: Theme): EdgeDrawing {
  const sw = theme.strokeWidth;
  const stroke = theme.stroke;
  if (t.kind === 'isa') {
    const c = t.stem[0]!;
    return {
      lines: [{ t: 'poly', pts: t.stem, fill: 'none', stroke, sw }],
      heads: [{ t: 'ellipse', cx: c.x, cy: c.y, rx: 11, ry: 11, fill: theme.background, stroke, sw }],
    };
  }
  const dash = t.kind === 'realization' ? '8 6' : undefined;
  const ys = t.branches.map((b) => b[b.length - 1]!.y);
  const barY = ys[0]!;
  const xs = [...t.branches.map((b) => b[0]!.x), t.stem[0]!.x];
  const lines: Prim[] = [];
  if (t.branches.some((b) => b.length > 2)) {
    lines.push({
      t: 'poly',
      pts: [
        { x: Math.min(...xs), y: barY },
        { x: Math.max(...xs), y: barY },
      ],
      fill: 'none',
      stroke,
      sw,
      dash,
    });
  }
  const tip = t.stem[t.stem.length - 1]!;
  const d = endDir(t.stem, false);
  lines.push({ t: 'poly', pts: trim(t.stem, false, 14), fill: 'none', stroke, sw, dash });
  return { lines, heads: [triangle(tip, d, 14, 8, theme.background, stroke, sw)] };
}

/** A child's own vertical piece of a trunk (child top → bar). */
export function trunkBranch(t: Trunk, edgeId: string, theme: Theme): Prim[] {
  const i = t.edges.indexOf(edgeId);
  const b = t.branches[i];
  if (!b) return [];
  const dash = t.kind === 'realization' ? '8 6' : undefined;
  const pts = t.kind === 'isa' ? b : b.slice(0, 2);
  return [{ t: 'poly', pts, fill: 'none', stroke: theme.stroke, sw: theme.strokeWidth, dash }];
}

export function edgeLength(route: EdgeRoute): number {
  return Math.round(polylineLength(route.points));
}

// ---------------------------------------------------------------------------
// Hover sentences (§4.5)

const SENTENCES: Record<Locale, Record<string, (a: string, b: string) => string>> = {
  pt: {
    generalization: (a, b) => `Generalização: ${a} estende ${b}`,
    realization: (a, b) => `Realização: ${a} implementa ${b}`,
    association: (a, b) => `Associação: ${a} conhece ${b}`,
    aggregation: (a, b) => `Agregação: ${a} agrega ${b}`,
    composition: (a, b) => `Composição: ${a} cria e contém ${b}`,
    dependency: (a, b) => `Dependência: ${a} usa ${b}`,
    nesting: (a, b) => `${a} está declarada dentro de ${b}`,
    include: (a, b) => `${a} inclui ${b}`,
    call: (a, b) => `${a} chama ${b}`,
    source: (a, b) => `${a} carrega ${b}`,
    uses: (a, b) => `${a} usa ${b}`,
    'foreign-key': (a, b) => `Chave estrangeira: ${a} referencia ${b}`,
    participation: (a, b) => `${a} participa em ${b}`,
    isa: (a, b) => `Especialização: ${a} é um ${b}`,
    flow: (a, b) => `Fluxo: ${a} → ${b}`,
  },
  en: {
    generalization: (a, b) => `Generalization: ${a} extends ${b}`,
    realization: (a, b) => `Realization: ${a} implements ${b}`,
    association: (a, b) => `Association: ${a} knows ${b}`,
    aggregation: (a, b) => `Aggregation: ${a} aggregates ${b}`,
    composition: (a, b) => `Composition: ${a} creates and owns ${b}`,
    dependency: (a, b) => `Dependency: ${a} uses ${b}`,
    nesting: (a, b) => `${a} is declared inside ${b}`,
    include: (a, b) => `${a} includes ${b}`,
    call: (a, b) => `${a} calls ${b}`,
    source: (a, b) => `${a} sources ${b}`,
    uses: (a, b) => `${a} uses ${b}`,
    'foreign-key': (a, b) => `Foreign key: ${a} references ${b}`,
    participation: (a, b) => `${a} takes part in ${b}`,
    isa: (a, b) => `Specialization: ${a} is a ${b}`,
    flow: (a, b) => `Flow: ${a} → ${b}`,
  },
};

export function edgeSentence(e: DiagramEdge, model: DiagramModel, locale: Locale): string {
  const name = (id: string, column?: string) => {
    const n = model.nodes.find((x) => x.id === id);
    const base = (n?.label ?? n?.name ?? id).split('\n')[0]!;
    return column ? `${base}.${column}` : base;
  };
  const f = SENTENCES[locale][e.kind] ?? ((a: string, b: string) => `${a} → ${b}`);
  let s = f(name(e.from.node, e.from.column), name(e.to.node, e.to.column));
  const ev = e.evidence[0];
  if (ev?.ref) s += ` ${locale === 'pt' ? 'em' : 'at'} ${ev.ref.file}:${ev.ref.line}`;
  if (ev?.note) s += ` (${ev.note})`;
  return s;
}
