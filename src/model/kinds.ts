// Runtime lists of the contract's string unions (for validators and UI menus).
// The `Exhaustive` checks fail to compile if types.ts gains a value missing here.
import type { DiagramKind, EdgeKind, Lang, MemberFlag, NodeKind } from './types';

type Exhaustive<Union, List extends readonly Union[]> = [Union] extends [List[number]] ? List : never;

const langs = ['java', 'c', 'bash', 'sql'] as const;
export const LANGS: Exhaustive<Lang, typeof langs> = langs;

// prettier-ignore
const diagramKinds = [
  'java.class', 'java.package', 'java.dependency',
  'c.struct', 'c.callgraph', 'c.include',
  'bash.callgraph', 'bash.flowchart', 'bash.dependency',
  'sql.relational', 'sql.ssms', 'sql.chen', 'sql.crowsfoot',
] as const;
export const DIAGRAM_KINDS: Exhaustive<DiagramKind, typeof diagramKinds> = diagramKinds;

// prettier-ignore
const nodeKinds = [
  'class', 'interface', 'abstract', 'enum', 'record', 'package',
  'struct', 'union', 'typedef', 'c-enum', 'source-file', 'header-file',
  'function', 'script', 'external',
  'table', 'view', 'entity', 'weak-entity', 'relationship', 'identifying-relationship',
  'terminator', 'process', 'decision', 'io', 'subroutine', 'connector',
] as const;
export const NODE_KINDS: Exhaustive<NodeKind, typeof nodeKinds> = nodeKinds;

// prettier-ignore
const edgeKinds = [
  'generalization', 'realization', 'association', 'aggregation', 'composition',
  'dependency', 'nesting', 'include', 'call', 'source', 'uses',
  'foreign-key', 'participation', 'isa', 'flow',
] as const;
export const EDGE_KINDS: Exhaustive<EdgeKind, typeof edgeKinds> = edgeKinds;

// prettier-ignore
const memberFlags = [
  'static', 'abstract', 'final', 'ctor', 'getter', 'setter', 'override', 'main',
  'fn-pointer', 'pk', 'fk', 'unique', 'notnull', 'identity', 'partial-key',
] as const;
export const MEMBER_FLAGS: Exhaustive<MemberFlag, typeof memberFlags> = memberFlags;

export function langOfKind(kind: DiagramKind): Lang {
  return kind.slice(0, kind.indexOf('.')) as Lang;
}

/** Association, aggregation and composition: one family for the relaxed edge score. */
export const ASSOCIATION_FAMILY: ReadonlySet<EdgeKind> = new Set(['association', 'aggregation', 'composition']);
