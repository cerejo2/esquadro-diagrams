// The diagram canvas: the same scene primitives as the SVG export (primAttrs),
// as React elements, plus what the screen needs and the file does not: the
// entrance and FLIP motion, hover and keyboard focus, and a wide invisible hit
// line per edge so thin lines are easy to point at.
import { createElement, useId, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Rect } from '../layout/types';
import type { Prim, Scene } from '../render/scene';
import { primAttrs, type Attrs } from '../render/svg';
import { playEntrance, playFlip, prefersReducedMotion } from './motion';

export type Focus = { type: 'node' | 'edge'; id: string } | null;

/** How the next scene arrives: drawn from scratch, slid from the previous layout, or shown at once. */
export type Arrival = { mode: 'enter' | 'flip' | 'none'; token: number };

const camel = (k: string) => (k.startsWith('data-') ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));

function props(attrs: Attrs): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) out[camel(k)] = v;
  return out;
}

function draw(p: Prim, scene: Scene, key: number, override?: Attrs): ReactNode {
  const { tag, attrs, text } = primAttrs(p, scene);
  const a = props({ ...attrs, ...override });
  // Filled heads (arrow, diamond) follow the highlight colour with their line.
  if (!override && p.t !== 'text' && p.fill !== 'none' && p.fill === p.stroke) a['data-solid'] = '';
  return createElement(tag, { key, ...a }, text);
}

const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '');

interface Props {
  scene: Scene;
  arrival: Arrival;
  focus: Focus;
  title: string;
  onFocus(f: Focus): void;
  onPin(f: Focus): void;
}

export function Canvas({ scene, arrival, focus, title, onFocus, onPin }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const last = useRef<Map<string, Rect>>(new Map());
  const running = useRef<Animation[]>([]);
  const uid = `d${safeId(useId())}`;

  useLayoutEffect(() => {
    const el = svg.current;
    if (!el) return;
    for (const a of running.current) a.cancel();
    running.current = [];
    if (!prefersReducedMotion()) {
      if (arrival.mode === 'enter') running.current = playEntrance(el, scene);
      else if (arrival.mode === 'flip') running.current = playFlip(el, last.current, scene);
    }
    last.current = new Map(scene.nodes.map((n) => [n.id, n.box]));
    // The token changes on "Redesenhar"; the scene changes on every new layout.
  }, [scene, arrival]);

  const related = useMemo(() => {
    const edges = new Set<string>();
    const nodes = new Set<string>();
    if (!focus) return { edges, nodes };
    if (focus.type === 'edge') {
      const e = scene.edges.find((x) => x.id === focus.id);
      if (e) {
        edges.add(e.id);
        e.ends.forEach((n) => nodes.add(n));
      }
    } else {
      nodes.add(focus.id);
      for (const e of scene.edges)
        if (e.ends.includes(focus.id)) {
          edges.add(e.id);
          e.ends.forEach((n) => nodes.add(n));
        }
    }
    return { edges, nodes };
  }, [focus, scene]);

  const paper = scene.paper;
  return (
    <svg
      ref={svg}
      className={`dg${focus ? ' has-focus' : ''}`}
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      width={scene.width}
      height={scene.height}
      role="group"
      aria-label={title}
      style={{ maxWidth: scene.width * 1.25, minWidth: Math.min(scene.width, Math.max(320, scene.width * 0.6)) }}
      onPointerLeave={() => onFocus(null)}
    >
      {paper && (
        <defs>
          <pattern id={`${uid}-paper`} width={paper.pitch} height={paper.pitch} patternUnits="userSpaceOnUse">
            <path d={`M${paper.pitch} 0H0V${paper.pitch}`} fill="none" stroke={paper.line} strokeWidth={1} />
          </pattern>
        </defs>
      )}
      <rect width="100%" height="100%" fill={scene.background} />
      {paper && <rect width="100%" height="100%" fill={`url(#${uid}-paper)`} />}

      <g className="edges">
        {scene.edges.map((e, i) => {
          const on = related.edges.has(e.id);
          const mask = `${uid}-m${i}`;
          return (
            <g
              key={e.id}
              data-edge={e.id}
              className={`edge${on ? ' on' : ''}`}
              onPointerEnter={() => onFocus({ type: 'edge', id: e.id })}
              onClick={() => onPin({ type: 'edge', id: e.id })}
            >
              <mask id={mask} maskUnits="userSpaceOnUse" x={0} y={0} width={scene.width} height={scene.height}>
                <g className="reveal">
                  {e.lines.map((p, k) =>
                    draw(p, scene, k, {
                      stroke: '#fff',
                      fill: 'none',
                      'stroke-width': 10,
                      'stroke-dasharray': undefined,
                    }),
                  )}
                </g>
              </mask>
              <g className="ink" mask={`url(#${mask})`}>
                {e.lines.map((p, k) => draw(p, scene, k))}
              </g>
              <g className="heads">{e.heads.map((p, k) => draw(p, scene, k))}</g>
              <g className="labels">{e.labels.map((p, k) => draw(p, scene, k))}</g>
              <g className="hit" aria-hidden="true">
                {e.lines.map((p, k) =>
                  draw(p, scene, k, {
                    stroke: 'transparent',
                    fill: 'none',
                    'stroke-width': 14,
                    'stroke-dasharray': undefined,
                  }),
                )}
              </g>
            </g>
          );
        })}
      </g>

      <g className="pens" aria-hidden="true" />

      <g className="nodes">
        {scene.nodes.map((n) => {
          const on = related.nodes.has(n.id);
          const pad = 5;
          return (
            <g
              key={n.id}
              data-node={n.id}
              className={`node${on ? ' on' : ''}`}
              tabIndex={0}
              role="img"
              aria-label={n.aria}
              onPointerEnter={() => onFocus({ type: 'node', id: n.id })}
              onFocus={() => onFocus({ type: 'node', id: n.id })}
              onClick={() => onPin({ type: 'node', id: n.id })}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  onPin({ type: 'node', id: n.id });
                } else if (ev.key === 'Escape') {
                  onPin(null);
                  (ev.currentTarget as SVGGElement).blur();
                }
              }}
            >
              <rect
                className="halo"
                x={n.box.x - pad}
                y={n.box.y - pad}
                width={n.box.width + pad * 2}
                height={n.box.height + pad * 2}
                rx={6}
              />
              <g className="body">{n.body.map((p, k) => draw(p, scene, k))}</g>
              <g className="text">{n.text.map((p, k) => draw(p, scene, k))}</g>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
