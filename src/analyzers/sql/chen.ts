// sql.chen: undoes the ER → relational mapping taught in FBD (PROMPT.md §7.4).
//
// For each table, from its PK and FKs:
//   1. PK equal to an FK to another table's PK, nothing else  → specialisation (isa) of that table;
//   2. PK made only of two or more FKs                         → M:N relationship (diamond), the
//      other columns are its attributes; M for the FK of the first PK column, then N, P, Q;
//   3. PK = one FK plus one own column, nothing else, and no table references it
//                                                              → multivalued attribute of the owner
//      (TELEFONE(func, numero) is how FBD maps a multivalued attribute);
//   4. PK = FK(s) plus own columns                             → weak entity with an identifying
//      relationship to each owner; the own PK columns are the partial key;
//   5. otherwise                                               → entity.
// Every FK not used above becomes a 1:N relationship (1:1 if the FK is UNIQUE), with total
// participation of the FK side when the FK is NOT NULL. Diamonds take the constraint name
// (the associative table's name in lower case for M:N), or stay empty for the user to fill in.
// FK columns are not attributes: the diamonds already show them (§5.3).
//
// Participation edges go from the entity to the diamond; `to.multiplicity` is the
// cardinality written on that line and `from.total` marks a double line.
import type {
  Diagnostic,
  DiagramEdge,
  DiagramModel,
  DiagramNode,
  Member,
  MemberFlag,
  NodeKind,
} from '../../model/types';
import { diagnostic, evidence } from '../shared/evidence';
import { IdPool, edgeId, nodeId } from '../shared/ids';
import { qualified } from './build';
import { type ResolvedFk, type ResolvedSchema, fkColumns, isPkColumn } from './resolve';
import { type Table, keyOf, sameSet, subsetOf } from './schema';

type Shape =
  | { kind: 'entity' }
  | { kind: 'isa'; parents: ResolvedFk[] }
  | { kind: 'mn'; parts: ResolvedFk[] }
  | { kind: 'weak'; owners: ResolvedFk[] }
  | { kind: 'multivalued'; owner: ResolvedFk; column: string };

const MN_LETTERS = ['M', 'N', 'P', 'Q', 'R', 'S'];

/** Position in the PK of the FK's first PK column, to order the sides of an M:N. */
function pkPosition(t: Table, r: ResolvedFk): number {
  const positions = r.fk.columns.map((c) => t.pk.findIndex((p) => keyOf(p) === keyOf(c))).filter((i) => i >= 0);
  return positions.length ? Math.min(...positions) : Number.MAX_SAFE_INTEGER;
}

/** `referenced`: some other table has an FK to this one, so it cannot fold into its owner. */
export function classify(t: Table, fks: readonly ResolvedFk[], referenced = false): Shape {
  if (!t.pk.length) return { kind: 'entity' };
  const inPk = fks.filter((r) => subsetOf(r.fk.columns, t.pk));
  if (!inPk.length) return { kind: 'entity' };
  const parents = inPk.filter(
    (r) =>
      r.to !== t &&
      sameSet(r.fk.columns, t.pk) &&
      sameSet(
        r.pairs.map((p) => p[1] ?? ''),
        r.to.pk,
      ),
  );
  if (parents.length && parents.length === inPk.length) return { kind: 'isa', parents };
  const covered = fkColumns(inPk);
  const own = t.pk.filter((c) => !covered.has(keyOf(c)));
  if (!own.length && inPk.length >= 2) {
    const parts = [...inPk].sort((a, b) => pkPosition(t, a) - pkPosition(t, b));
    return { kind: 'mn', parts };
  }
  const owner = inPk[0]!;
  const onlyKeys = t.columns.length === covered.size + 1;
  if (own.length === 1 && inPk.length === 1 && fks.length === 1 && owner.to !== t && onlyKeys && !referenced)
    return { kind: 'multivalued', owner, column: own[0]! };
  if (own.length) return { kind: 'weak', owners: inPk };
  return { kind: 'entity' };
}

export function buildChen(s: ResolvedSchema): Pick<DiagramModel, 'nodes' | 'edges' | 'diagnostics'> {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const diagnostics: Diagnostic[] = [];
  const npool = new IdPool();
  const epool = new IdPool();
  const ids = new Map<Table, string>();
  const shapes = new Map<Table, Shape>();

  const referenced = new Set<Table>();
  for (const list of s.fksOf.values()) for (const r of list) if (r.to !== r.from) referenced.add(r.to);
  for (const t of s.tables) shapes.set(t, classify(t, s.fksOf.get(t) ?? [], referenced.has(t)));
  // A diamond cannot hold an attribute ellipse of this kind: keep those tables as weak entities.
  for (const [t, sh] of shapes)
    if (sh.kind === 'multivalued' && shapes.get(sh.owner.to)?.kind === 'mn')
      shapes.set(t, { kind: 'weak', owners: [sh.owner] });

  // Pass 1: one node per table (entity, weak entity or M:N diamond).
  for (const t of s.tables) {
    const fks = s.fksOf.get(t) ?? [];
    const shape = shapes.get(t)!;
    if (shape.kind === 'multivalued') continue;
    const kind: NodeKind = shape.kind === 'mn' ? 'relationship' : shape.kind === 'weak' ? 'weak-entity' : 'entity';
    const fkCols = fkColumns(fks);
    const attributes: Member[] = [];
    for (const c of t.columns) {
      if (fkCols.has(keyOf(c.name))) continue;
      const flags: MemberFlag[] = [];
      if (isPkColumn(t, c.name)) flags.push(shape.kind === 'weak' ? 'partial-key' : 'pk');
      const m: Member = { name: c.name, ref: c.ref };
      if (flags.length) m.flags = flags;
      attributes.push(m);
    }
    const rule =
      shape.kind === 'mn'
        ? 'chen.mn'
        : shape.kind === 'weak'
          ? 'chen.weak-entity'
          : shape.kind === 'isa'
            ? 'chen.isa'
            : 'chen.entity';
    const note =
      shape.kind === 'mn'
        ? 'the PK is made only of FKs to other tables'
        : shape.kind === 'weak'
          ? 'the PK is an FK plus own columns (partial key)'
          : shape.kind === 'isa'
            ? 'the PK is also an FK to the PK of another table'
            : t.pk.length
              ? 'the PK has no FK'
              : 'no primary key';
    const id = npool.take(nodeId(kind, qualified(t)));
    ids.set(t, id);
    const n: DiagramNode = {
      id,
      kind,
      name: shape.kind === 'mn' ? t.name.toLowerCase() : t.name,
      attributes,
      ref: t.ref,
      evidence: [evidence(rule, t.pkRef ?? t.ref, note)],
    };
    if (t.schema) n.group = t.schema;
    nodes.push(n);
    if (!t.pk.length)
      diagnostics.push(diagnostic('info', `table ${t.name} has no primary key; drawn as an entity`, t.ref));
  }

  // Multivalued attributes join their owner's attributes.
  for (const t of s.tables) {
    const shape = shapes.get(t)!;
    if (shape.kind !== 'multivalued') continue;
    const owner = nodes.find((n) => n.id === ids.get(shape.owner.to));
    if (!owner) continue;
    const col = t.columns.find((c) => keyOf(c.name) === keyOf(shape.column));
    owner.attributes!.push({ name: col?.name ?? shape.column, flags: ['multivalued'], ref: col?.ref ?? t.ref });
    owner.evidence!.push(
      evidence(
        'chen.multivalued',
        t.pkRef ?? t.ref,
        `table ${t.name} holds the values of ${shape.column} (PK = FK + ${shape.column})`,
      ),
    );
  }

  const diamond = (kind: NodeKind, t: Table, r: ResolvedFk, rule: string, note: string): string => {
    const id = npool.take(nodeId(kind, `${qualified(t)}.${r.fk.name ?? r.fk.columns.join('+')}`));
    const n: DiagramNode = {
      id,
      kind,
      name: r.fk.name ?? '',
      attributes: [],
      ref: r.fk.ref,
      evidence: [evidence(rule, r.fk.ref, note)],
    };
    if (t.schema) n.group = t.schema;
    nodes.push(n);
    return id;
  };
  const participation = (
    entity: string,
    rel: string,
    multiplicity: string,
    total: boolean,
    side: string,
    confidence: number,
    rule: string,
    r: ResolvedFk,
  ) => {
    const e: DiagramEdge = {
      id: epool.take(edgeId('participation', entity, rel, side)),
      kind: 'participation',
      from: total ? { node: entity, total: true } : { node: entity },
      to: { node: rel, multiplicity },
      confidence,
      evidence: [evidence(rule, r.fk.ref, `FK ${r.from.name}(${r.fk.columns.join(', ')}) → ${r.to.name}`)],
    };
    edges.push(e);
  };
  const warnIfDiamond = (r: ResolvedFk) => {
    if (shapes.get(r.to)?.kind === 'mn')
      diagnostics.push(
        diagnostic(
          'info',
          `${r.from.name} references ${r.to.name}, which is drawn as a relationship (aggregation)`,
          r.fk.ref,
        ),
      );
  };

  // Pass 2: edges and the diamonds that come from FKs.
  for (const t of s.tables) {
    const fks = s.fksOf.get(t) ?? [];
    const shape = shapes.get(t)!;
    if (shape.kind === 'multivalued') continue;
    const self = ids.get(t)!;
    const used = new Set<ResolvedFk>();

    if (shape.kind === 'isa') {
      for (const r of shape.parents) {
        used.add(r);
        edges.push({
          id: epool.take(edgeId('isa', self, ids.get(r.to)!)),
          kind: 'isa',
          from: { node: self },
          to: { node: ids.get(r.to)! },
          confidence: 0.7,
          evidence: [evidence('chen.isa', r.fk.ref, `${t.name}'s PK is also an FK to ${r.to.name}'s PK`)],
        });
      }
    } else if (shape.kind === 'mn') {
      shape.parts.forEach((r, i) => {
        used.add(r);
        warnIfDiamond(r);
        participation(ids.get(r.to)!, self, MN_LETTERS[i] ?? 'N', false, `mn${i}`, 0.8, 'chen.mn', r);
      });
      // An FK outside the PK of an associative table: one more participant, on the 1 side.
      for (const r of fks) {
        if (used.has(r)) continue;
        used.add(r);
        warnIfDiamond(r);
        participation(ids.get(r.to)!, self, '1', false, `extra:${r.fk.columns.join('+')}`, 0.6, 'chen.mn.extra', r);
      }
    } else if (shape.kind === 'weak') {
      for (const r of shape.owners) {
        used.add(r);
        warnIfDiamond(r);
        const rel = diamond(
          'identifying-relationship',
          t,
          r,
          'chen.identifying',
          'the FK is part of the PK of a weak entity',
        );
        participation(self, rel, 'N', true, 'weak', 0.8, 'chen.identifying', r);
        participation(ids.get(r.to)!, rel, '1', false, 'owner', 0.8, 'chen.identifying', r);
      }
    }

    for (const r of fks) {
      if (used.has(r)) continue;
      warnIfDiamond(r);
      const rule = r.unique ? 'chen.one-to-one' : 'chen.one-to-many';
      const rel = diamond('relationship', t, r, rule, r.unique ? 'FK outside the PK, UNIQUE' : 'FK outside the PK');
      participation(self, rel, r.unique ? '1' : 'N', r.notNull, 'child', 0.9, rule, r);
      participation(ids.get(r.to)!, rel, '1', false, 'parent', 0.9, rule, r);
    }
  }
  return { nodes, edges, diagnostics };
}
