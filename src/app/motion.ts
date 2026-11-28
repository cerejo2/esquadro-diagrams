// Motion for the diagram canvas, with the Web Animations API.
//
// Entrance: boxes are stamped row by row, each line is inked from its source
// to its target once both ends are on the paper, and the heads and labels
// appear when their line arrives. FLIP: when a new layout or theme moves the
// nodes, each one slides from where it was. Every animation uses fill
// "backwards", so nothing flashes before its turn, and leaves no inline style
// behind when it ends.
import type { Rect } from '../layout/types';
import type { Scene } from '../render/scene';

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const q = (root: Element, sel: string) => [...root.querySelectorAll<SVGGraphicsElement>(sel)];

/** Start time (ms) of each node's stamp: row k, position i in the row. */
export function nodeDelays(scene: Scene): Map<string, number> {
  const rows = new Map<number, typeof scene.nodes>();
  for (const n of scene.nodes) rows.set(n.rank, [...(rows.get(n.rank) ?? []), n]);
  const out = new Map<string, number>();
  for (const [k, row] of rows) {
    row.sort((a, b) => a.box.x - b.box.x);
    row.forEach((n, i) => out.set(n.id, Math.min(900, 80 + k * 140 + i * 40)));
  }
  return out;
}

export function playEntrance(svg: SVGSVGElement, scene: Scene): Animation[] {
  const anims: Animation[] = [];
  const delays = nodeDelays(scene);
  for (const g of q(svg, '[data-node]')) {
    const d = delays.get(g.dataset.node!) ?? 0;
    anims.push(
      g.animate(
        [
          { opacity: 0, transform: 'translateY(6px) scale(0.98)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 320, delay: d, easing: EASE, fill: 'backwards' },
      ),
    );
    const text = g.querySelector<SVGGElement>('.text');
    if (text)
      anims.push(text.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: d + 120, fill: 'backwards' }));
  }

  // Edges in the order their ends appear; a small per-edge offset keeps the
  // inking readable without letting a large diagram run for seconds.
  const byId = new Map(scene.edges.map((e) => [e.id, e]));
  const groups = q(svg, '[data-edge]').map((g) => {
    const e = byId.get(g.dataset.edge!)!;
    const ready = Math.max(delays.get(e.ends[0]) ?? 0, delays.get(e.ends[1]) ?? 0) + 320;
    return { g, e, ready };
  });
  groups.sort((a, b) => a.ready - b.ready);
  groups.forEach(({ g, e, ready }, i) => {
    const start = ready - 60 + Math.min(i, 12) * 30;
    const dur = Math.max(240, Math.min(e.length * 0.9, 700));
    // The pen: a small nib that rides the first line while it is inked.
    const first = g.querySelector<SVGGeometryElement>('.reveal path');
    const pens = svg.querySelector('.pens');
    if (first && pens && e.length > 24) {
      const len = first.getTotalLength();
      const steps = Math.max(2, Math.min(24, Math.round(len / 24)));
      const frames: Keyframe[] = [];
      for (let k = 0; k <= steps; k++) {
        const pt = first.getPointAtLength((len * k) / steps);
        frames.push({ transform: `translate(${pt.x}px, ${pt.y}px)`, opacity: k === 0 || k === steps ? 0 : 1 });
      }
      const nib = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      nib.setAttribute('r', '3');
      nib.setAttribute('class', 'nib');
      nib.style.opacity = '0';
      pens.appendChild(nib);
      const a = nib.animate(frames, { duration: dur, delay: start, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' });
      const drop = () => nib.remove();
      a.addEventListener('finish', drop);
      a.addEventListener('cancel', drop);
      anims.push(a);
    }
    // The ink is revealed through a mask, so dashed lines keep their dashes.
    for (const p of q(g, '.reveal path')) {
      const len = (p as SVGGeometryElement).getTotalLength?.() || e.length || 1;
      anims.push(
        p.animate(
          [
            { strokeDasharray: `${len} ${len}`, strokeDashoffset: len },
            { strokeDasharray: `${len} ${len}`, strokeDashoffset: 0 },
          ],
          { duration: dur, delay: start, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'backwards' },
        ),
      );
    }
    for (const head of q(g, '.heads > *'))
      anims.push(
        head.animate(
          [
            { opacity: 0, transform: 'scale(0.6)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 160, delay: start + dur - 20, easing: EASE, fill: 'backwards' },
        ),
      );
    const labels = g.querySelector('.labels');
    if (labels)
      anims.push(
        labels.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: start + dur + 60, fill: 'backwards' }),
      );
  });
  return anims;
}

/** Slides each node from its previous box to the new one; edges fade back in once the nodes settle. */
export function playFlip(svg: SVGSVGElement, before: ReadonlyMap<string, Rect>, scene: Scene): Animation[] {
  const anims: Animation[] = [];
  const now = new Map(scene.nodes.map((n) => [n.id, n.box]));
  for (const g of q(svg, '[data-node]')) {
    const id = g.dataset.node!;
    const a = before.get(id);
    const b = now.get(id);
    if (!a || !b) {
      anims.push(g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 140, fill: 'backwards' }));
      continue;
    }
    const dx = a.x + a.width / 2 - (b.x + b.width / 2);
    const dy = a.y + a.height / 2 - (b.y + b.height / 2);
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    anims.push(
      g.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 360,
        easing: EASE,
      }),
    );
  }
  for (const g of q(svg, '[data-edge]'))
    anims.push(g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: 240, fill: 'backwards' }));
  return anims;
}
