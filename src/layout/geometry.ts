// Small geometry helpers shared by the layout, the router and the score.
import type { Point, Rect, Side } from './types';

export const snap = (v: number, grid: number): number => Math.round(v / grid) * grid;
export const snapUp = (v: number, grid: number): number => Math.ceil(v / grid) * grid;

export function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by };
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap
  );
}

export function containsPoint(r: Rect, p: Point, eps = 0): boolean {
  return p.x > r.x + eps && p.x < r.x + r.width - eps && p.y > r.y + eps && p.y < r.y + r.height - eps;
}

/** True when the axis-aligned segment a→b passes through the inside of r (touching the border is fine). */
export function segmentHitsRect(a: Point, b: Point, r: Rect, eps = 0.5): boolean {
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  if (x1 === x2) return x1 > r.x + eps && x1 < r.x + r.width - eps && y2 > r.y + eps && y1 < r.y + r.height - eps;
  if (y1 === y2) return y1 > r.y + eps && y1 < r.y + r.height - eps && x2 > r.x + eps && x1 < r.x + r.width - eps;
  // Diagonal segments (straight Chen lines): sample along the segment.
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (containsPoint(r, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, eps)) return true;
  }
  return false;
}

/** Proper crossing of two segments (shared end points and collinear overlaps do not count). */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

export function polylineLength(points: readonly Point[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++)
    n += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return n;
}

/** Removes repeated points and merges collinear runs, so bends are counted honestly. */
export function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push({ x: p.x, y: p.y });
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3) as [Point, Point, Point];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) > 0.01) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

export function bends(points: readonly Point[]): number {
  return Math.max(0, simplify(points).length - 2);
}

export function union(rects: readonly Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.width);
    y2 = Math.max(y2, r.y + r.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** The point on side `side` of r, at fraction t (0..1) along that side. */
export function sidePoint(r: Rect, side: Side, t = 0.5): Point {
  switch (side) {
    case 'top':
      return { x: r.x + r.width * t, y: r.y };
    case 'bottom':
      return { x: r.x + r.width * t, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: r.y + r.height * t };
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height * t };
  }
}

/** Where the straight line from the centre of r towards p leaves r. */
export function borderPoint(r: Rect, p: Point): Point {
  const c = center(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx === 0 ? Infinity : r.width / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : r.height / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/** Same as borderPoint, for the diamond inscribed in r. */
export function diamondBorderPoint(r: Rect, p: Point): Point {
  const c = center(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const s = 1 / (Math.abs(dx) / (r.width / 2) + Math.abs(dy) / (r.height / 2));
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/** Same as borderPoint, for the ellipse inscribed in r. */
export function ellipseBorderPoint(r: Rect, p: Point): Point {
  const c = center(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const a = r.width / 2;
  const b = r.height / 2;
  const s = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
  return { x: c.x + dx * s, y: c.y + dy * s };
}

export const round2 = (v: number): number => Math.round(v * 100) / 100;
