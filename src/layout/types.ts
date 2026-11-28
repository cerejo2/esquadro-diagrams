// Layout contract: what the layout stage hands to the renderer.
// Coordinates are in diagram pixels at 1x, origin top-left, y grows downwards.
import type { DiagramModel } from '../model/types';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface Size {
  width: number;
  height: number;
}

/** Where an edge label sits. (x, y) is the anchor of the text box's top-left corner. */
export interface PlacedLabel extends Rect {
  text: string;
  /** Which end of the edge it describes, or the middle. */
  at: 'source' | 'target' | 'middle';
}

export interface EdgeRoute {
  id: string;
  /** Orthogonal polyline from the source border to the target border. */
  points: Point[];
  labels: PlacedLabel[];
  /**
   * Set when this edge is drawn as part of a shared generalization or
   * realization trunk: the renderer draws the trunk once, with one head.
   */
  trunk?: string;
}

/** Several child → parent edges merged into one tree of segments with one arrowhead. */
export interface Trunk {
  id: string;
  /** isa: Chen specialization, drawn with a circle at the start of the stem. */
  kind: 'generalization' | 'realization' | 'isa';
  parent: string;
  edges: string[];
  /** Each polyline is drawn as is; the last point of `stem` touches the parent. */
  branches: Point[][];
  stem: Point[];
}

export interface Layout {
  /** Which strategy produced it, for the candidate picker ("elk:down:brandes"). */
  strategy: string;
  width: number;
  height: number;
  nodes: Record<string, Rect>;
  edges: Record<string, EdgeRoute>;
  trunks: Trunk[];
  /** Chen: attribute ellipses of each node, in the order of node.attributes. */
  attributes?: Record<string, Rect[]>;
  score?: Score;
}

export interface Score {
  /** 0..100, higher is better. 0 when a label overlaps something (eliminatory). */
  total: number;
  crossings: number;
  bends: number;
  length: number;
  aligned: number;
  labelOverlaps: number;
  aspect: number;
  symmetry: number;
  balance: number;
}

/** Sizes the renderer needs for each node, measured with the chosen theme. */
export type SizeOf = (id: string) => Size;

export interface LayoutInput {
  model: DiagramModel;
  sizeOf: SizeOf;
  /** Text size for edge labels (role, multiplicity, "sim"/"não"). */
  labelSize: (text: string) => Size;
  /** x of a column's cell centre, relative to its table (relational schema). */
  columnX?: (node: string, column: string) => number | undefined;
  /** Chen: size of the ellipse of attribute `index` of a node. */
  attributeSize?: (node: string, index: number) => Size;
  grid?: number;
}
