// sql.relational, sql.ssms and sql.crowsfoot from the resolved schema
// (PROMPT.md §7.4). All three draw one box per table; they differ in what an
// edge is and which multiplicities it carries.
import type { AnalyzeOptions } from '../types';
import type {
  DiagramEdge,
  DiagramKind,
  DiagramModel,
  DiagramNode,
  Member,
  MemberFlag,
  NodeKind,
} from '../../model/types';
import { evidence } from '../shared/evidence';
import { IdPool, edgeId, nodeId } from '../shared/ids';
import { type ResolvedFk, type ResolvedSchema, fkColumns, isPkColumn } from './resolve';
import { type Table, type View, findNamed, keyOf } from './schema';

export const qualified = (t: { name: string; schema?: string }) => (t.schema ? `${t.schema}.${t.name}` : t.name);

/** Columns as members. Types only where the notation shows them (crow's foot). */
export function columnMembers(t: Table, fks: readonly ResolvedFk[], withTypes: boolean): Member[] {
  const fkCols = fkColumns(fks);
  return t.columns.map((c) => {
    const flags: MemberFlag[] = [];
    const pk = isPkColumn(t, c.name);
    if (pk) flags.push('pk');
    if (fkCols.has(keyOf(c.name))) flags.push('fk');
    if (t.uniques.some((u) => u.length === 1 && keyOf(u[0]!) === keyOf(c.name))) flags.push('unique');
    if (c.notNull || pk) flags.push('notnull');
    if (c.identity) flags.push('identity');
    const m: Member = { name: c.name, ref: c.ref };
    if (withTypes && c.type) m.type = c.type;
    if (flags.length) m.flags = flags;
    return m;
  });
}

const fkRule = (r: ResolvedFk) => `sql.fk.${r.fk.origin}`;
const fkNote = (r: ResolvedFk) => {
  const cols = r.pairs.map(([a, b]) => `${a} → ${r.to.name}.${b ?? '?'}`).join(', ');
  return r.fk.name ? `constraint ${r.fk.name}: ${cols}` : cols;
};

function tableNodes(s: ResolvedSchema, kind: NodeKind, withTypes: boolean, ids: Map<Table, string>): DiagramNode[] {
  const pool = new IdPool();
  return s.tables.map((t) => {
    const id = pool.take(nodeId(kind, qualified(t)));
    ids.set(t, id);
    const n: DiagramNode = {
      id,
      kind,
      name: t.name,
      attributes: columnMembers(t, s.fksOf.get(t) ?? [], withTypes),
      ref: t.ref,
      evidence: [evidence('sql.create-table', t.ref)],
    };
    if (t.schema) n.group = t.schema;
    return n;
  });
}

/** View nodes, and (only with showDependencies) their FROM/JOIN dependencies, which are a guess. */
function viewParts(
  s: ResolvedSchema,
  ids: Map<Table, string>,
  opts: AnalyzeOptions,
): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const pool = new IdPool();
  const viewIds = new Map<View, string>();
  for (const v of s.views) {
    const id = pool.take(nodeId('view', qualified(v)));
    viewIds.set(v, id);
    const n: DiagramNode = {
      id,
      kind: 'view',
      name: v.name,
      ref: v.ref,
      evidence: [evidence('sql.create-view', v.ref)],
    };
    if (v.schema) n.group = v.schema;
    nodes.push(n);
  }
  if (!opts.showDependencies) return { nodes, edges };
  const epool = new IdPool();
  for (const v of s.views) {
    const from = viewIds.get(v)!;
    const seen = new Set<string>();
    for (const d of v.deps) {
      const table = findNamed(s.tables, d, v.schema);
      const view = table ? undefined : findNamed(s.views, d, v.schema);
      const to = table ? ids.get(table) : view ? viewIds.get(view) : undefined;
      if (!to || to === from || seen.has(to)) continue;
      seen.add(to);
      edges.push({
        id: epool.take(edgeId('dependency', from, to)),
        kind: 'dependency',
        from: { node: from },
        to: { node: to },
        confidence: 0.6,
        evidence: [evidence('sql.view.from', d.ref, 'table named in FROM or JOIN')],
      });
    }
  }
  return { nodes, edges };
}

/** sql.relational: one foreign-key edge per FK column, from the FK cell to the PK cell. */
function relational(s: ResolvedSchema, opts: AnalyzeOptions): Pick<DiagramModel, 'nodes' | 'edges'> {
  const ids = new Map<Table, string>();
  const nodes = tableNodes(s, 'table', false, ids);
  const edges: DiagramEdge[] = [];
  const pool = new IdPool();
  for (const r of s.fks) {
    const from = ids.get(r.from)!;
    const to = ids.get(r.to)!;
    for (const [col, refCol] of r.pairs) {
      const e: DiagramEdge = {
        id: pool.take(edgeId('foreign-key', from, to, col)),
        kind: 'foreign-key',
        from: { node: from, column: col },
        to: refCol ? { node: to, column: refCol } : { node: to },
        confidence: 1,
        evidence: [evidence(fkRule(r), r.fk.ref, fkNote(r))],
      };
      // Cells of one composite FK share the constraint name, so the editor can keep them together.
      if (r.pairs.length > 1 && r.fk.name) e.label = r.fk.name;
      edges.push(e);
    }
  }
  const v = viewParts(s, ids, opts);
  return { nodes: [...nodes, ...v.nodes], edges: [...edges, ...v.edges] };
}

/** sql.ssms: one line per FK constraint; key at the PK end, key (1:1) or infinity (1:N) at the FK end. */
function ssms(s: ResolvedSchema, opts: AnalyzeOptions): Pick<DiagramModel, 'nodes' | 'edges'> {
  const ids = new Map<Table, string>();
  const nodes = tableNodes(s, 'table', false, ids);
  const edges: DiagramEdge[] = [];
  const pool = new IdPool();
  for (const r of s.fks) {
    const from = ids.get(r.from)!;
    const to = ids.get(r.to)!;
    edges.push({
      id: pool.take(edgeId('foreign-key', from, to, r.fk.name ?? r.fk.columns.join('+'))),
      kind: 'foreign-key',
      from: { node: from, multiplicity: r.unique ? '1' : '*' },
      to: { node: to, multiplicity: '1' },
      confidence: 1,
      evidence: [
        evidence(fkRule(r), r.fk.ref, fkNote(r)),
        evidence(
          r.unique ? 'sql.ssms.one-to-one' : 'sql.ssms.one-to-many',
          r.fk.ref,
          r.unique ? 'the FK columns are the PK or UNIQUE' : undefined,
        ),
      ],
    });
  }
  const v = viewParts(s, ids, opts);
  return { nodes: [...nodes, ...v.nodes], edges: [...edges, ...v.edges] };
}

/**
 * sql.crowsfoot: entities with typed columns. Parent end: `1` for a NOT NULL FK,
 * `0..1` when it accepts NULL. Child end: `0..1` when the FK is UNIQUE or the PK (1:1), else `0..*`.
 */
function crowsfoot(s: ResolvedSchema): Pick<DiagramModel, 'nodes' | 'edges'> {
  const ids = new Map<Table, string>();
  const nodes = tableNodes(s, 'entity', true, ids);
  const edges: DiagramEdge[] = [];
  const pool = new IdPool();
  for (const r of s.fks) {
    const from = ids.get(r.from)!;
    const to = ids.get(r.to)!;
    edges.push({
      id: pool.take(edgeId('foreign-key', from, to, r.fk.name ?? r.fk.columns.join('+'))),
      kind: 'foreign-key',
      from: { node: from, multiplicity: r.unique ? '0..1' : '0..*' },
      to: { node: to, multiplicity: r.notNull ? '1' : '0..1' },
      confidence: 1,
      evidence: [
        evidence(fkRule(r), r.fk.ref, fkNote(r)),
        evidence(r.notNull ? 'sql.crowsfoot.parent-mandatory' : 'sql.crowsfoot.parent-optional', r.fk.ref),
        evidence(r.unique ? 'sql.crowsfoot.one-to-one' : 'sql.crowsfoot.one-to-many', r.fk.ref),
      ],
    });
  }
  return { nodes, edges };
}

export function buildTables(
  s: ResolvedSchema,
  kind: Exclude<DiagramKind, 'sql.chen'>,
  opts: AnalyzeOptions,
): Pick<DiagramModel, 'nodes' | 'edges'> {
  if (kind === 'sql.ssms') return ssms(s, opts);
  if (kind === 'sql.crowsfoot') return crowsfoot(s);
  return relational(s, opts);
}
