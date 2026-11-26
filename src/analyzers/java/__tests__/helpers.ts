// Small helpers for the Java analyzer tests.
import { formatAttribute, formatOperation } from '../../../model/format';
import type { DiagramEdge, DiagramKind, DiagramModel, DiagramNode } from '../../../model/types';
import type { AnalyzeOptions } from '../../types';
import { javaAnalyzer } from '..';
import type { JavaOptions } from '../members';

export type Opts = AnalyzeOptions & JavaOptions;

/** Analyzes inline sources: `{ 'a/A.java': 'class A {}' }`. */
export function analyze(
  sources: Record<string, string>,
  kind: DiagramKind = 'java.class',
  opts: Opts = {},
): Promise<DiagramModel> {
  const files = Object.entries(sources).map(([path, content]) => ({ path, content }));
  return javaAnalyzer.analyze(files, kind, opts);
}

export function node(m: DiagramModel, name: string): DiagramNode {
  const n = m.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`no node ${name} in [${m.nodes.map((x) => x.name).join(', ')}]`);
  return n;
}

export const attrs = (m: DiagramModel, name: string): string[] => (node(m, name).attributes ?? []).map(formatAttribute);
export const ops = (m: DiagramModel, name: string): string[] => (node(m, name).operations ?? []).map(formatOperation);

/** `kind From->To` for every edge, with role and multiplicity at the `to` end when present. */
export function edgeList(m: DiagramModel): string[] {
  const name = (id: string) => m.nodes.find((n) => n.id === id)?.name ?? id;
  return m.edges.map((e) => describe(e, name));
}

function describe(e: DiagramEdge, name: (id: string) => string): string {
  const extra = [e.to.role, e.to.multiplicity].filter(Boolean).join(' ');
  return `${e.kind} ${name(e.from.node)}->${name(e.to.node)}${extra ? ` ${extra}` : ''}`;
}

export function edge(m: DiagramModel, kind: DiagramEdge['kind'], from: string, to: string): DiagramEdge | undefined {
  const id = (n: string) => m.nodes.find((x) => x.name === n)?.id;
  return m.edges.find((e) => e.kind === kind && e.from.node === id(from) && e.to.node === id(to));
}
