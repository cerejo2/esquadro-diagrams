// Builds the three Java diagrams from the collected types and their relations.
import type { DiagramEdge, DiagramModel, DiagramNode, EdgeKind, Evidence, NodeKind } from '../../model/types';
import { evidence } from '../shared/evidence';
import { IdPool, edgeId, nodeId } from '../shared/ids';
import type { JType } from './collect';
import { type JavaOptions, attributeOf, hiddenOperation, isLauncher, operationOf } from './members';
import { type FieldRelation, type TypeUse, fieldRelations, typeUses } from './relations';
import type { Resolver } from './resolve';

/** Java nodes always carry their evidence. */
export type JavaNode = DiagramNode & { evidence: Evidence[] };

export const DEFAULT_PACKAGE = '(default package)';

export function nodeKindOf(t: JType): NodeKind {
  if (t.decl === 'class') return t.mods.isAbstract ? 'abstract' : 'class';
  return t.decl;
}

const STEREOTYPE: Partial<Record<NodeKind, string>> = {
  interface: 'interface',
  abstract: 'abstract',
  enum: 'enumeration',
  record: 'record',
};

function typeNode(t: JType, withMembers: boolean, opts: JavaOptions): JavaNode {
  const kind = nodeKindOf(t);
  const node: JavaNode = {
    id: nodeId(kind, t.qname),
    kind,
    name: t.name,
    ref: t.ref,
    evidence: [evidence(`java.${t.decl}`, t.ref, `${t.decl} ${t.name}${t.pkg ? ` in package ${t.pkg}` : ''}`)],
  };
  const st = STEREOTYPE[kind];
  if (st) node.stereotypes = [st];
  if (t.pkg) node.group = t.pkg;
  if (t.outer) node.parent = nodeId(nodeKindOf(t.outer), t.outer.qname);
  if (withMembers) {
    // Enum constants first, as declared; then fields; record components come first in their own order.
    node.attributes = t.fields.map(attributeOf);
    node.operations = t.methods
      .map((m) => ({ m, op: operationOf(m, t) }))
      .filter(({ m, op }) => !hiddenOperation(op, m, opts))
      .map(({ op }) => op);
  }
  return node;
}

function visibleTypes(types: readonly JType[], opts: JavaOptions): JType[] {
  return types.filter((t) => opts.showMain || !isLauncher(t));
}

const USE_RULE_TEXT: Record<TypeUse['rule'], string> = {
  extends: 'extends',
  implements: 'implements',
  field: 'field type',
  'field-type-argument': 'type argument of a field',
  parameter: 'parameter type',
  return: 'return type',
  throws: 'throws clause',
  'type-bound': 'type parameter bound',
  local: 'local variable type',
  new: 'object created with new',
  'static-access': 'static call or constant',
  cast: 'cast',
  instanceof: 'instanceof',
  pattern: 'type or record pattern',
  'class-literal': 'class literal',
  'method-reference': 'method reference',
  'type-argument': 'explicit type argument',
};

function useEvidence(u: TypeUse): Evidence {
  return evidence(`java.use.${u.rule}`, u.ref, `${USE_RULE_TEXT[u.rule]}: ${u.note}`);
}

/** Uses grouped by (from, to), in first-use order, without self uses. */
function usesByPair(uses: readonly TypeUse[]): Map<string, TypeUse[]> {
  const out = new Map<string, TypeUse[]>();
  for (const u of uses) {
    if (u.from === u.to) continue;
    const key = `${u.from.qname}\u0000${u.to.qname}`;
    const list = out.get(key) ?? [];
    list.push(u);
    out.set(key, list);
  }
  return out;
}

// ---------------------------------------------------------------- java.class

export function classDiagram(types: readonly JType[], res: Resolver, opts: JavaOptions): DiagramModel {
  const shown = visibleTypes(types, opts);
  const isShown = new Set(shown);
  const id = (t: JType) => nodeId(nodeKindOf(t), t.qname);
  const pool = new IdPool();
  const edges: DiagramEdge[] = [];
  const related = new Set<string>();
  const pairKey = (a: JType, b: JType) => (a.qname < b.qname ? `${a.qname}|${b.qname}` : `${b.qname}|${a.qname}`);
  const add = (
    kind: EdgeKind,
    from: JType,
    to: JType,
    e: Omit<DiagramEdge, 'id' | 'kind' | 'from' | 'to'> & {
      from?: Partial<DiagramEdge['from']>;
      to?: Partial<DiagramEdge['to']>;
      discriminator?: string;
    },
  ) => {
    const { discriminator, from: fromEnd, to: toEnd, ...rest } = e;
    edges.push({
      id: pool.take(edgeId(kind, id(from), id(to), discriminator)),
      kind,
      from: { ...fromEnd, node: id(from) },
      to: { ...toEnd, node: id(to) },
      ...rest,
    });
    if (kind !== 'nesting' && kind !== 'dependency') related.add(pairKey(from, to));
  };

  // 1. extends / implements.
  for (const t of shown) {
    const supers = [t.superclass, ...t.interfaces].filter((n) => !!n);
    const done = new Set<JType>(); // `implements I, I` is a compile error, but must not draw two arrows
    supers.forEach((n, i) => {
      const parent = res.resolveTypeNode(n!, t, [], true);
      if (!parent || parent === t || !isShown.has(parent) || done.has(parent)) return;
      done.add(parent);
      const viaImplements = i > 0 || !t.superclass;
      const kind: EdgeKind = viaImplements && t.decl !== 'interface' ? 'realization' : 'generalization';
      const ref = { file: t.file.path, line: n!.startPosition.row + 1 };
      add(kind, t, parent, {
        confidence: 1,
        evidence: [
          evidence(kind === 'realization' ? 'java.implements' : 'java.extends', ref, `${t.name} → ${parent.name}`),
        ],
      });
    });
  }

  // 2. Nesting: from the member type to its owner.
  for (const t of shown) {
    if (!t.outer || !isShown.has(t.outer)) continue;
    add('nesting', t, t.outer, {
      confidence: 1,
      evidence: [
        evidence('java.nested', t.ref, `${t.mods.isStatic ? 'static nested' : 'inner'} ${t.decl} of ${t.outer.name}`),
      ],
    });
  }

  // 3. Field relations, with reciprocal plain associations merged into one.
  const relations: FieldRelation[] = shown.flatMap((t) => fieldRelations(t, res)).filter((r) => isShown.has(r.target));
  const merged = new Set<FieldRelation>();
  const between = (a: JType, b: JType) => relations.filter((r) => r.owner === a && r.target === b);
  for (const r of relations) {
    if (merged.has(r)) continue;
    let partner: FieldRelation | undefined;
    if (r.kind === 'association' && r.owner !== r.target) {
      const mine = between(r.owner, r.target);
      const theirs = between(r.target, r.owner);
      if (mine.length === 1 && theirs.length === 1 && theirs[0]!.kind === 'association') partner = theirs[0];
    }
    if (partner) {
      merged.add(r).add(partner);
      add('association', r.owner, r.target, {
        from: { role: partner.field.name, multiplicity: partner.multiplicity, navigable: true },
        to: { role: r.field.name, multiplicity: r.multiplicity, navigable: true },
        discriminator: r.field.name,
        confidence: Math.min(r.confidence, partner.confidence) - 0.05,
        evidence: [
          ...r.evidence,
          ...partner.evidence,
          evidence(
            'java.field.reciprocal',
            r.field.ref,
            `${r.owner.name}.${r.field.name} and ${partner.owner.name}.${partner.field.name} point at each other`,
          ),
        ],
      });
      continue;
    }
    add(r.kind, r.owner, r.target, {
      to: { role: r.field.name, multiplicity: r.multiplicity, navigable: true },
      discriminator: r.field.name,
      confidence: r.confidence,
      evidence: r.evidence,
    });
  }

  // 4. Dependencies: a type used only in signatures, locals, `new` or static access.
  if (opts.showDependencies) {
    const uses = shown.flatMap((t) => typeUses(t, res)).filter((u) => isShown.has(u.to));
    const weak = uses.filter((u) => u.rule !== 'extends' && u.rule !== 'implements' && u.rule !== 'field');
    for (const list of usesByPair(weak).values()) {
      const { from, to } = list[0]!;
      if (related.has(pairKey(from, to))) continue;
      const creates = list.some((u) => u.rule === 'new');
      add('dependency', from, to, {
        label: creates ? 'create' : 'use',
        confidence: 1,
        evidence: list.map(useEvidence),
      });
    }
  }

  return {
    lang: 'java',
    kind: 'java.class',
    nodes: shown.map((t) => typeNode(t, true, opts)),
    edges,
    diagnostics: [],
  };
}

// ---------------------------------------------------------------- java.dependency

export function dependencyDiagram(types: readonly JType[], res: Resolver, opts: JavaOptions): DiagramModel {
  const shown = visibleTypes(types, opts);
  const isShown = new Set(shown);
  const id = (t: JType) => nodeId(nodeKindOf(t), t.qname);
  const pool = new IdPool();
  const uses = shown.flatMap((t) => typeUses(t, res)).filter((u) => isShown.has(u.to));
  const edges: DiagramEdge[] = [];
  for (const list of usesByPair(uses).values()) {
    const { from, to } = list[0]!;
    edges.push({
      id: pool.take(edgeId('dependency', id(from), id(to))),
      kind: 'dependency',
      from: { node: id(from) },
      to: { node: id(to), navigable: true },
      label: String(list.length),
      confidence: 1,
      evidence: list.map(useEvidence),
    });
  }
  return {
    lang: 'java',
    kind: 'java.dependency',
    nodes: shown.map((t) => typeNode(t, false, opts)),
    edges,
    diagnostics: [],
  };
}

// ---------------------------------------------------------------- java.package

export function packageDiagram(types: readonly JType[], res: Resolver, opts: JavaOptions): DiagramModel {
  const shown = visibleTypes(types, opts);
  const isShown = new Set(shown);
  const pkgOf = (t: JType) => t.pkg || DEFAULT_PACKAGE;
  const pkgId = (p: string) => nodeId('package', p);

  const nodes: JavaNode[] = [];
  const seen = new Set<string>();
  for (const t of shown) {
    const p = pkgOf(t);
    if (seen.has(p)) continue;
    seen.add(p);
    const members = shown.filter((x) => pkgOf(x) === p && !x.outer);
    nodes.push({
      id: pkgId(p),
      kind: 'package',
      name: p,
      ref: t.ref,
      evidence: [
        evidence(
          'java.package',
          t.ref,
          `${members.length} top-level type(s): ${members.map((x) => x.name).join(', ')}`,
        ),
      ],
    });
  }
  nodes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Package A depends on B once per pair of types (a in A, b in B) where a uses b.
  const uses = shown.flatMap((t) => typeUses(t, res)).filter((u) => isShown.has(u.to) && pkgOf(u.from) !== pkgOf(u.to));
  const byPkg = new Map<string, TypeUse[][]>();
  for (const list of usesByPair(uses).values()) {
    const key = `${pkgOf(list[0]!.from)}\u0000${pkgOf(list[0]!.to)}`;
    const group = byPkg.get(key) ?? [];
    group.push(list);
    byPkg.set(key, group);
  }
  const pool = new IdPool();
  const edges: DiagramEdge[] = [];
  for (const [key, pairs] of [...byPkg].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [from, to] = key.split('\u0000') as [string, string];
    edges.push({
      id: pool.take(edgeId('dependency', pkgId(from), pkgId(to))),
      kind: 'dependency',
      from: { node: pkgId(from) },
      to: { node: pkgId(to), navigable: true },
      label: String(pairs.length),
      confidence: 1,
      evidence: pairs.map((list) => {
        const u = list[0]!;
        return evidence(`java.use.${u.rule}`, u.ref, `${u.from.name} → ${u.to.name} (${list.length} use(s))`);
      }),
    });
  }
  return { lang: 'java', kind: 'java.package', nodes, edges, diagnostics: [] };
}
