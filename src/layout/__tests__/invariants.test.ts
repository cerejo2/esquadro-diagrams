// Layout invariants, checked on every public fixture and every diagram kind
// its language offers: no overlapping boxes, boxes on the grid, parents above
// children, no line through a box, no label collisions, same input → same output.
import { describe, expect, it } from 'vitest';
import { analyzerFor } from '../../analyzers';
import { loadFixtures } from '../../bench/fixtures';
import type { DiagramModel } from '../../model/types';
import { prepareLayout } from '../../render';
import { layoutCandidates } from '../candidates';
import { rectsOverlap, segmentHitsRect } from '../geometry';
import { labelOverlaps } from '../routing';
import type { Layout, Rect } from '../types';

const GRID = 8;
const cases = await loadFixtures({ includePrivate: false });

interface Case {
  tag: string;
  model: DiagramModel;
}

const all: Case[] = [];
for (const f of cases) {
  const a = analyzerFor(f.lang);
  for (const kind of a.kinds) {
    const model = await a.analyze(f.files, kind);
    if (model.nodes.length) all.push({ tag: `${f.lang}/${f.name} ${kind}`, model });
  }
}

async function layoutsOf(model: DiagramModel): Promise<Layout[]> {
  return layoutCandidates(prepareLayout(model, 'vp').input);
}

function boxesOf(l: Layout): [string, Rect][] {
  const out: [string, Rect][] = Object.entries(l.nodes);
  for (const [id, list] of Object.entries(l.attributes ?? {})) list.forEach((r, i) => out.push([`${id}#attr${i}`, r]));
  return out;
}

describe.each(all)('$tag', ({ model }) => {
  it('keeps every invariant in every candidate', async () => {
    const layouts = await layoutsOf(model);
    expect(layouts.length).toBeGreaterThan(0);
    const problems: string[] = [];
    const ends = new Map(model.edges.map((e) => [e.id, [e.from.node, e.to.node]]));
    const uml = model.kind === 'java.class' || model.kind === 'c.struct';
    for (const l of layouts) {
      const boxes = boxesOf(l);
      // No two boxes overlap.
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          if (rectsOverlap(boxes[i]![1], boxes[j]![1]))
            problems.push(`${l.strategy}: ${boxes[i]![0]} overlaps ${boxes[j]![0]}`);
        }
      }
      // Shapes sit on the grid.
      for (const [id, r] of Object.entries(l.nodes)) {
        if (r.x % GRID || r.y % GRID) problems.push(`${l.strategy}: ${id} off the grid at ${r.x},${r.y}`);
      }
      // Parents above children (UML hierarchy).
      for (const e of uml ? model.edges : []) {
        if (e.kind !== 'generalization' && e.kind !== 'realization') continue;
        const child = l.nodes[e.from.node]!;
        const parent = l.nodes[e.to.node]!;
        if (child.y < parent.y + parent.height) problems.push(`${l.strategy}: ${e.id} child not below parent`);
      }
      // No line passes through a box other than its own ends.
      for (const r of Object.values(l.edges)) {
        const own = ends.get(r.id) ?? [];
        for (const [id, box] of Object.entries(l.nodes)) {
          if (own.includes(id)) continue;
          for (let i = 1; i < r.points.length; i++) {
            if (segmentHitsRect(r.points[i - 1]!, r.points[i]!, box))
              problems.push(`${l.strategy}: ${r.id} crosses ${id}`);
          }
        }
      }
    }
    // The chosen layout has no label touching a box, a line or another label.
    const overlaps = labelOverlaps(layouts[0]!.edges, layouts[0]!.nodes);
    if (overlaps) problems.push(`${layouts[0]!.strategy}: ${overlaps} label collisions`);
    expect(problems).toEqual([]);
  });

  it('is deterministic', async () => {
    const a = await layoutsOf(model);
    const b = await layoutsOf(model);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
