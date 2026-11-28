// Small helpers for the SQL analyzer tests.
import { formatAttribute } from '../../../model/format';
import type { DiagramEdge, DiagramKind, DiagramModel, DiagramNode } from '../../../model/types';
import type { AnalyzeOptions } from '../../types';
import { sqlAnalyzer } from '..';

/** Analyzes one inline script (or several: `{ 'a.sql': '...' }`). */
export function analyze(
  sql: string | Record<string, string>,
  kind: DiagramKind = 'sql.relational',
  opts: AnalyzeOptions = {},
): Promise<DiagramModel> {
  const sources = typeof sql === 'string' ? { 'schema.sql': sql } : sql;
  const files = Object.entries(sources).map(([path, content]) => ({ path, content }));
  return sqlAnalyzer.analyze(files, kind, opts);
}

export function node(m: DiagramModel, name: string): DiagramNode {
  const n = m.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`no node ${name} in [${m.nodes.map((x) => x.name).join(', ')}]`);
  return n;
}

export const attrs = (m: DiagramModel, name: string): string[] => (node(m, name).attributes ?? []).map(formatAttribute);

export const flagsOf = (m: DiagramModel, table: string, column: string) =>
  node(m, table).attributes?.find((a) => a.name === column)?.flags ?? [];

const nameOf = (m: DiagramModel, id: string) => m.nodes.find((n) => n.id === id)?.name ?? id;

/**
 * `kind From.col->To.col fromMult:toMult` for every edge (only the parts that are set),
 * e.g. `foreign-key B.a_id->A.id` or `participation B->r N total`.
 */
export function edgeList(m: DiagramModel): string[] {
  return m.edges.map((e) => describe(m, e));
}

function describe(m: DiagramModel, e: DiagramEdge): string {
  const end = (x: DiagramEdge['from']) => `${nameOf(m, x.node)}${x.column ? `.${x.column}` : ''}`;
  const mult =
    e.from.multiplicity || e.to.multiplicity ? ` ${e.from.multiplicity ?? ''}:${e.to.multiplicity ?? ''}` : '';
  return `${e.kind} ${end(e.from)}->${end(e.to)}${mult}${e.from.total ? ' total' : ''}`;
}

export const messages = (m: DiagramModel, level?: 'info' | 'warn' | 'error') =>
  m.diagnostics.filter((d) => !level || d.level === level).map((d) => d.message);
