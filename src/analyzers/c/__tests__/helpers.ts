// Small helpers for the C analyzer tests.
import { formatAttribute, formatOperation } from '../../../model/format';
import type { DiagramEdge, DiagramKind, DiagramModel, DiagramNode } from '../../../model/types';
import type { AnalyzeOptions } from '../../types';
import { cAnalyzer } from '..';

/** Analyzes inline sources: `{ 'list.h': '...', 'list.c': '...' }`. */
export function analyze(
  sources: Record<string, string>,
  kind: DiagramKind = 'c.struct',
  opts: AnalyzeOptions = {},
): Promise<DiagramModel> {
  const files = Object.entries(sources).map(([path, content]) => ({ path, content }));
  return cAnalyzer.analyze(files, kind, opts);
}

export function node(m: DiagramModel, name: string): DiagramNode {
  const n = m.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`no node ${name} in [${m.nodes.map((x) => x.name).join(', ')}]`);
  return n;
}

export const names = (m: DiagramModel): string[] => m.nodes.map((n) => `${n.kind}:${n.name}`).sort();
export const attrs = (m: DiagramModel, name: string): string[] => (node(m, name).attributes ?? []).map(formatAttribute);
export const ops = (m: DiagramModel, name: string): string[] => (node(m, name).operations ?? []).map(formatOperation);

/** `kind From->To role mult [label]` for every edge. */
export function edgeList(m: DiagramModel): string[] {
  const name = (id: string) => m.nodes.find((n) => n.id === id)?.name ?? id;
  return m.edges.map((e) => describe(e, name)).sort();
}

function describe(e: DiagramEdge, name: (id: string) => string): string {
  const extra = [e.to.role, e.to.multiplicity, e.label && `[${e.label}]`].filter(Boolean).join(' ');
  return `${e.kind} ${name(e.from.node)}->${name(e.to.node)}${extra ? ` ${extra}` : ''}`;
}

export function edge(m: DiagramModel, kind: DiagramEdge['kind'], from: string, to: string): DiagramEdge | undefined {
  const id = (n: string) => m.nodes.find((x) => x.name === n)?.id;
  return m.edges.find((e) => e.kind === kind && e.from.node === id(from) && e.to.node === id(to));
}

export const loud = (m: DiagramModel) => m.diagnostics.filter((d) => d.level !== 'info');
