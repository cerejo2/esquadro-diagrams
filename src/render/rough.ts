// Caderno theme: turns clean primitives into hand-drawn paths with rough.js.
// The seed comes from the node or edge id, so the stroke never changes
// between renders, exports or reloads (§5.5).
import rough from 'roughjs';
import type { Options } from 'roughjs/bin/core';
import type { Prim } from './scene';

const gen = rough.generator();

/** FNV-1a: a stable 31-bit seed from an id (rough.js wants a positive integer). */
export function seedOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 1 || 1;
}

export function roughen(prims: readonly Prim[], seed: number, opts: { roughness: number; bowing: number }): Prim[] {
  const out: Prim[] = [];
  prims.forEach((p, i) => {
    if (p.t === 'text' || p.t === 'path') {
      out.push(p);
      return;
    }
    const o: Options = {
      seed: seed + i * 7919,
      roughness: opts.roughness,
      bowing: opts.bowing,
      stroke: p.stroke,
      strokeWidth: p.sw,
      fill: p.fill === 'none' ? undefined : p.fill,
      fillStyle: 'solid',
      preserveVertices: true,
      disableMultiStrokeFill: true,
    };
    if ((p.t === 'rect' || p.t === 'poly') && p.dash) o.strokeLineDash = p.dash.split(/\s+/).map(Number);
    const d =
      p.t === 'rect'
        ? gen.rectangle(p.x, p.y, p.w, p.h, o)
        : p.t === 'ellipse'
          ? gen.ellipse(p.cx, p.cy, p.rx * 2, p.ry * 2, o)
          : p.closed
            ? gen.polygon(
                p.pts.map((q) => [q.x, q.y] as [number, number]),
                o,
              )
            : gen.linearPath(
                p.pts.map((q) => [q.x, q.y] as [number, number]),
                o,
              );
    for (const info of gen.toPaths(d)) {
      out.push({
        t: 'path',
        d: info.d,
        fill: info.fill ?? 'none',
        stroke: info.stroke,
        sw: info.strokeWidth,
        dash: (p.t === 'rect' || p.t === 'poly') && p.dash ? p.dash : undefined,
      });
    }
  });
  return out;
}
