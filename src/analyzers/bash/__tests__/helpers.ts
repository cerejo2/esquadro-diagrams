// Small helpers for the Bash analyzer tests.
import type { DiagramKind, DiagramModel, DiagramNode, NodeKind } from '../../../model/types';
import type { AnalyzeOptions } from '../../types';
import { bashAnalyzer } from '..';

/** Analyzes inline scripts: `{ 'a.sh': 'f() { :; }' }`. */
export function analyze(
  sources: Record<string, string>,
  kind: DiagramKind = 'bash.callgraph',
  opts: AnalyzeOptions = {},
): Promise<DiagramModel> {
  const files = Object.entries(sources).map(([path, content]) => ({ path, content }));
  return bashAnalyzer.analyze(files, kind, opts);
}

/** One script, as a flowchart of its top-level code (or of `entry`). */
export function flow(script: string, opts: AnalyzeOptions = {}): Promise<DiagramModel> {
  return analyze({ 'x.sh': script }, 'bash.flowchart', opts);
}

export function nameOf(m: DiagramModel, id: string): string {
  return m.nodes.find((n) => n.id === id)?.name ?? id;
}

/** `kind from->to` (plus ` [label]`) for every edge, by node name. */
export function edgeList(m: DiagramModel): string[] {
  return m.edges.map(
    (e) => `${e.kind} ${nameOf(m, e.from.node)}->${nameOf(m, e.to.node)}${e.label ? ` [${e.label}]` : ''}`,
  );
}

export function nodesOf(m: DiagramModel, kind: NodeKind): DiagramNode[] {
  return m.nodes.filter((n) => n.kind === kind);
}

/** The text a node shows: its label, or its name. */
export const shown = (n: DiagramNode) => n.label ?? n.name;

/** Labels of every node of a kind, in order. */
export const labels = (m: DiagramModel, kind: NodeKind) => nodesOf(m, kind).map(shown);

/** Node counts per kind and the number of flow edges, for flowchart assertions. */
export function counts(m: DiagramModel): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of m.nodes) out[n.kind] = (out[n.kind] ?? 0) + 1;
  out.flow = m.edges.filter((e) => e.kind === 'flow').length;
  return out;
}

/** `from -[label]-> to` using the shown text of both ends, for flowchart assertions. */
export function arrows(m: DiagramModel): string[] {
  const text = (id: string) => {
    const n = m.nodes.find((x) => x.id === id);
    return n ? shown(n).replace(/\n/g, ' / ') : id;
  };
  return m.edges.map((e) => `${text(e.from.node)} -${e.label ? `[${e.label}]` : ''}-> ${text(e.to.node)}`);
}
