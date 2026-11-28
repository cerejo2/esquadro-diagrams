// Post-processing of a placement: the choices a person makes after the
// automatic layout. Rows are aligned at the top, siblings get the same width
// when they are close, parents are centred over their children, everything
// sits on the grid and separate components are packed side by side.
import { snap, snapUp, union } from './geometry';
import type { Rect } from './types';

export type Placement = Map<string, Rect>;

/** Groups nodes into rows: a node joins a row when it overlaps the row's band vertically. */
export function rowsOf(p: Placement): string[][] {
  const ids = [...p.keys()].sort((a, b) => p.get(a)!.y - p.get(b)!.y || p.get(a)!.x - p.get(b)!.x);
  const rows: { top: number; bottom: number; ids: string[] }[] = [];
  for (const id of ids) {
    const r = p.get(id)!;
    const row = rows[rows.length - 1];
    // Same row when the node starts above the middle of the row's band.
    if (row && r.y < (row.top + row.bottom) / 2) {
      row.ids.push(id);
      row.bottom = Math.max(row.bottom, r.y + r.height);
    } else rows.push({ top: r.y, bottom: r.y + r.height, ids: [id] });
  }
  for (const row of rows) row.ids.sort((a, b) => p.get(a)!.x - p.get(b)!.x);
  return rows.map((r) => r.ids);
}

/** Every node of a row starts at the same y; rows keep at least `gap` between them. */
export function alignRows(p: Placement, rows: string[][], gap: number): void {
  let y = Math.min(...[...p.values()].map((r) => r.y));
  for (const row of rows) {
    const top = Math.max(y, Math.min(...row.map((id) => p.get(id)!.y)));
    for (const id of row) p.get(id)!.y = top;
    y = top + Math.max(...row.map((id) => p.get(id)!.height)) + gap;
  }
}

/** Siblings (same parent, same row) get the widest width when the spread is small. */
export function equalizeWidths(p: Placement, groups: readonly string[][], maxRatio = 1.4): void {
  for (const g of groups) {
    const rs = g.map((id) => p.get(id)).filter((r): r is Rect => !!r);
    if (rs.length < 2) continue;
    const max = Math.max(...rs.map((r) => r.width));
    const min = Math.min(...rs.map((r) => r.width));
    if (max / min > maxRatio) continue;
    for (const r of rs) {
      r.x -= (max - r.width) / 2;
      r.width = max;
    }
  }
}

/**
 * Moves the nodes of one row as close as possible to their desired x while
 * keeping their order and a minimum gap. Desired x is the current x unless given.
 */
export function compactRow(
  p: Placement,
  row: readonly string[],
  gap: number,
  desired?: ReadonlyMap<string, number>,
): void {
  const rs = row.map((id) => p.get(id)!);
  const want = row.map((id, i) => desired?.get(id) ?? rs[i]!.x);
  // Forward pass: no overlaps, as far left as wanted.
  const xs: number[] = [];
  for (let i = 0; i < rs.length; i++) {
    const min = i ? xs[i - 1]! + rs[i - 1]!.width + gap : -Infinity;
    xs.push(Math.max(want[i]!, min));
  }
  // Backward pass: pull nodes that were pushed right back towards what they wanted, as blocks.
  for (let i = rs.length - 2; i >= 0; i--) {
    const max = xs[i + 1]! - rs[i]!.width - gap;
    if (xs[i]! > max) xs[i] = max;
  }
  // The backward pass may have broken the forward constraint on the left: redo forward.
  for (let i = 1; i < rs.length; i++) {
    const min = xs[i - 1]! + rs[i - 1]!.width + gap;
    if (xs[i]! < min) xs[i] = min;
  }
  rs.forEach((r, i) => (r.x = xs[i]!));
}

/**
 * Centres each parent over the span of its children in the next row. Works
 * bottom-up, so a grandparent is centred over parents that were already moved.
 */
export function centerParents(
  p: Placement,
  rows: readonly string[][],
  childrenOf: ReadonlyMap<string, readonly string[]>,
  gap: number,
): void {
  const rowIndex = new Map<string, number>();
  rows.forEach((row, i) => row.forEach((id) => rowIndex.set(id, i)));
  for (let ri = rows.length - 2; ri >= 0; ri--) {
    const desired = new Map<string, number>();
    for (const id of rows[ri]!) {
      const kids = (childrenOf.get(id) ?? []).filter((k) => rowIndex.get(k) === ri + 1);
      if (!kids.length) continue;
      const span = union(kids.map((k) => p.get(k)!));
      const r = p.get(id)!;
      desired.set(id, span.x + span.width / 2 - r.width / 2);
    }
    if (desired.size) compactRow(p, rows[ri]!, gap, desired);
  }
  // Top-down: a single child (or a tight group) that sits off-centre under its parent slides under it.
  for (let ri = 1; ri < rows.length; ri++) {
    const desired = new Map<string, number>();
    for (const parent of rows[ri - 1]!) {
      const kids = (childrenOf.get(parent) ?? []).filter((k) => rowIndex.get(k) === ri);
      if (!kids.length) continue;
      const span = union(kids.map((k) => p.get(k)!));
      const pr = p.get(parent)!;
      const shift = pr.x + pr.width / 2 - (span.x + span.width / 2);
      if (Math.abs(shift) < 1) continue;
      for (const k of kids) if (!desired.has(k)) desired.set(k, p.get(k)!.x + shift);
    }
    if (desired.size) compactRow(p, rows[ri]!, gap, desired);
  }
}

/** Snaps positions to the grid and sizes up to the grid, then moves the drawing to (pad, pad). */
export function snapAndNormalize(p: Placement, grid: number, pad: number): void {
  for (const r of p.values()) {
    r.width = snapUp(r.width, grid);
    r.height = snapUp(r.height, grid);
    r.x = snap(r.x, grid);
    r.y = snap(r.y, grid);
  }
  const box = union([...p.values()]);
  const dx = snap(pad - box.x, grid);
  const dy = snap(pad - box.y, grid);
  for (const r of p.values()) {
    r.x += dx;
    r.y += dy;
  }
}

/** Splits node ids into connected components, each in input order. Largest first. */
export function components(ids: readonly string[], links: readonly [string, string][]): string[][] {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = a;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  for (const [a, b] of links) {
    if (!parent.has(a) || !parent.has(b)) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const r = find(id);
    const g = groups.get(r) ?? [];
    g.push(id);
    groups.set(r, g);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

/**
 * Packs laid-out components in rows, left to right, largest first. Every row
 * width from "one per row" to "all in one row" is tried, and the packing whose
 * bounding box is closest to a 16:10 shape (the screen and the A4 landscape
 * page) wins; ties go to the smaller area.
 */
export function packComponents(parts: readonly Placement[], gap: number, aspect = 1.6): Placement {
  const boxes = parts.map((p) => union([...p.values()]));
  const pack = (maxWidth: number) => {
    const at: { x: number; y: number }[] = [];
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    let width = 0;
    for (const b of boxes) {
      if (x > 0 && x + b.width > maxWidth) {
        x = 0;
        y += rowHeight + gap;
        rowHeight = 0;
      }
      at.push({ x, y });
      width = Math.max(width, x + b.width);
      x += b.width + gap;
      rowHeight = Math.max(rowHeight, b.height);
    }
    return { at, width, height: y + rowHeight };
  };
  const widths = new Set<number>();
  let sum = 0;
  for (const b of boxes) {
    sum += b.width;
    widths.add(sum);
    sum += gap;
  }
  let best: ReturnType<typeof pack> | undefined;
  let bestCost = Infinity;
  for (const w of [...widths].sort((a, b) => a - b)) {
    const r = pack(Math.max(w, ...boxes.map((b) => b.width)) + 0.5);
    const cost = Math.abs(Math.log(r.width / r.height / aspect)) + (r.width * r.height) / 1e9;
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = r;
    }
  }
  const out: Placement = new Map();
  parts.forEach((part, i) => {
    const b = boxes[i]!;
    const { x, y } = best!.at[i]!;
    for (const [id, r] of part) out.set(id, { ...r, x: r.x - b.x + x, y: r.y - b.y + y });
  });
  return out;
}
