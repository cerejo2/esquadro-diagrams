// The scene: a flat, serialisable list of drawing primitives per node and
// edge. The React canvas, the SVG export and the tests all read the same
// scene, so what is exported is exactly what is on screen.
import type { Point, Rect } from '../layout/types';

export type Family = 'sans' | 'mono';

export type Prim =
  | {
      t: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      rx?: number;
      fill: string;
      stroke: string;
      sw: number;
      dash?: string;
    }
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: string; stroke: string; sw: number }
  | {
      t: 'poly';
      pts: Point[];
      closed?: boolean;
      fill: string;
      stroke: string;
      sw: number;
      dash?: string;
      radius?: number;
    }
  | {
      t: 'text';
      x: number;
      y: number;
      text: string;
      size: number;
      weight?: number;
      italic?: boolean;
      underline?: 'solid' | 'dashed';
      anchor: 'start' | 'middle' | 'end';
      fill: string;
      family: Family;
    }
  | { t: 'path'; d: string; fill: string; stroke: string; sw: number; dash?: string };

export interface SceneNode {
  id: string;
  box: Rect;
  /** Outline and fill. */
  body: Prim[];
  /** Text drawn on top of the body. */
  text: Prim[];
  /** Short description for screen readers ("Classe Circle, 2 atributos, 3 operações"). */
  aria: string;
  /** Row of the drawing it belongs to, for the entrance stagger. */
  rank: number;
}

export interface SceneEdge {
  id: string;
  /** The line(s) that "ink in" during the entrance. */
  lines: Prim[];
  /** Arrowheads, diamonds, triangles, crow's feet, keys: appear when the line arrives. */
  heads: Prim[];
  labels: Prim[];
  /** Nodes it connects, for hover highlighting. */
  ends: [string, string];
  /** Length of the polyline in px (for stroke-dasharray). */
  length: number;
  /** Sentence shown on hover ("Composição: Festival cria Stage em …"). */
  sentence: string;
  /** Edges drawn by one shared trunk carry the trunk id; its lines are drawn once. */
  trunk?: string;
}

export interface Scene {
  width: number;
  height: number;
  background: string;
  /** Squared paper (Caderno theme). */
  paper?: { pitch: number; line: string; margin?: string };
  fontFamily: string;
  monoFamily: string;
  nodes: SceneNode[];
  edges: SceneEdge[];
}
