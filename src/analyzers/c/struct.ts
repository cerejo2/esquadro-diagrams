// c.struct (PROMPT.md §7.2): structs, unions and enums as UML-like boxes, the
// functions of each abstract data type as its operations, and the fields that
// hold other project types as composition or association edges.
import type { Node } from 'web-tree-sitter';
import type { AnalyzeOptions } from '../types';
import type {
  DiagramEdge,
  DiagramModel,
  DiagramNode,
  Evidence,
  Member,
  MemberFlag,
  SourceRef,
} from '../../model/types';
import { evidence, refOf } from '../shared/evidence';
import { IdPool, edgeId, nodeId } from '../shared/ids';
import { descendants, isHeader } from './ast';
import type { Entity, FunctionInfo, Project } from './collect';
import { namesOf, resolveUse, startsWithTypeName } from './resolve';

const NODE_KIND = { struct: 'struct', union: 'union', enum: 'c-enum' } as const;

/** Display name of an entity: its first plain typedef, else its tag. */
export function entityName(e: Entity): string | undefined {
  return e.aliases[0]?.name ?? e.tag;
}

interface Op {
  fn: FunctionInfo;
  owner: Entity;
  member: Member;
  rule: string;
}

export function structDiagram(p: Project, opts: AnalyzeOptions): DiagramModel {
  const ids = new IdPool();
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const idOf = new Map<string, string>(); // entity key or typedef:Name → node id

  // ------------------------------------------------------------- operations first
  // (a type that is only declared becomes a node when it has operations)
  const ops = operations(p, opts);
  const opsOf = new Map<string, Op[]>();
  for (const o of ops) {
    const list = opsOf.get(o.owner.key) ?? [];
    list.push(o);
    opsOf.set(o.owner.key, list);
  }

  // ------------------------------------------------------------------- nodes
  for (const e of p.entities.values()) {
    const name = entityName(e);
    if (!name) continue; // anonymous with no typedef: nothing to call it
    // A type only named in a field or parameter (`struct stat`, `struct tm`) belongs to a library.
    if (!e.body && (!e.declared || !opsOf.has(e.key))) continue;
    const bodyInHeader = e.body ? isHeader(e.body.file) : false;
    const opaque = (!e.body || !bodyInHeader) && e.forwardIn.some(isHeader);
    const ref = e.body?.ref ?? e.aliases[0]?.ref ?? e.firstRef;
    const node: DiagramNode = {
      id: ids.take(nodeId(NODE_KIND[e.kind], name)),
      kind: NODE_KIND[e.kind],
      name,
      group: ref.file,
      ref,
      evidence: [entityEvidence(e, name, opaque)],
    };
    const stereotypes = [...(e.kind === 'enum' ? ['enumeration'] : []), ...(opaque ? ['opaque'] : [])];
    if (stereotypes.length) node.stereotypes = stereotypes;
    if (e.kind === 'enum') {
      node.attributes = e.constants.map((c) => {
        const m: Member = { name: c.name, ref: c.ref };
        if (c.value !== undefined) m.initial = c.value;
        return m;
      });
    } else {
      const visibility = bodyInHeader ? '+' : '-';
      const attributes: Member[] = [];
      const fnFields: Member[] = [];
      for (const f of e.fields) {
        const r = resolveUse(p, f.use);
        // `Cmp c;` with `typedef int (*Cmp)(...)`, or `Fn *f;` with the function type `typedef int Fn(...)`.
        const fnStars = r.fnTypedef?.fnType ? 1 : 0;
        const fn = f.fn ?? (r.fnTypedef && r.stars === fnStars && !r.arrays.length ? r.fnTypedef.fnPointer : undefined);
        if (fn) {
          fnFields.push({
            name: f.name,
            visibility,
            params: fn.params.map((x) => (x.type ? { name: x.name, type: x.type } : { name: x.name })),
            returns: fn.returns,
            flags: ['fn-pointer'],
            ref: f.ref,
          });
        } else attributes.push({ name: f.name, type: f.use.text, visibility, ref: f.ref });
      }
      node.attributes = attributes;
      if (fnFields.length) node.operations = fnFields;
    }
    // Public operations first (header order), then the private ones.
    const own = opsOf
      .get(e.key)
      ?.sort((a, b) => Number(a.member.visibility === '-') - Number(b.member.visibility === '-'));
    if (own) node.operations = [...(node.operations ?? []), ...own.map((o) => o.member)];
    for (const o of own ?? [])
      node.evidence!.push(evidence(o.rule, o.member.ref, `${o.fn.name} is an operation of ${name}`));
    idOf.set(e.key, node.id);
    nodes.push(node);
  }

  for (const td of p.typedefs.values()) {
    if (!td.fnPointer) continue;
    const node: DiagramNode = {
      id: ids.take(nodeId('typedef', td.name)),
      kind: 'typedef',
      name: td.name,
      group: td.file,
      ref: td.ref,
      evidence: [evidence('c.typedef.fn-pointer', td.ref, `typedef of a pointer to function: ${td.name}`)],
    };
    idOf.set(`typedef:${td.name}`, node.id);
    nodes.push(node);
  }

  // ------------------------------------------------------------------- edges
  const many = arrayLikeFields(p);
  const linked = new Set<string>();
  for (const e of p.entities.values()) {
    const from = idOf.get(e.key);
    if (!from || e.kind === 'enum') continue;
    for (const f of e.fields) {
      if (f.fn) continue;
      const r = resolveUse(p, f.use);
      if (!r.entity) continue;
      const to = idOf.get(r.entity.key);
      if (!to) continue;
      const toEnum = r.entity.kind === 'enum';
      let kind: DiagramEdge['kind'];
      let multiplicity: string;
      let rule: string;
      let confidence = 1;
      let note: string;
      const size = r.arrays.length === 1 ? r.arrays[0] || '*' : '*';
      if (r.stars === 0 && !r.arrays.length) {
        kind = toEnum ? 'association' : 'composition';
        multiplicity = '1';
        rule = toEnum ? 'c.field.enum' : 'c.field.value';
        note = toEnum ? `${f.name} holds an enum value` : `${f.name} holds a ${entityName(r.entity)} by value`;
      } else if (r.stars === 0) {
        kind = toEnum ? 'association' : 'composition';
        multiplicity = size;
        rule = 'c.field.array';
        note = `${f.name} is an array of ${entityName(r.entity)}`;
      } else if (r.stars >= 2) {
        kind = 'association';
        multiplicity = '*';
        rule = 'c.field.pointer-to-pointer';
        note = `${f.name} is a pointer to pointers`;
      } else if (r.arrays.length) {
        kind = 'association';
        multiplicity = size;
        rule = 'c.field.pointer-array';
        note = `${f.name} is an array of pointers`;
      } else {
        kind = 'association';
        const hit = many.get(f.name);
        if (hit) {
          multiplicity = '*';
          rule = 'c.field.pointer-many';
          confidence = 0.8;
          note = `${f.name} is ${hit.how} (${hit.ref.file}:${hit.ref.line}), so it points to many`;
        } else {
          multiplicity = '0..1';
          rule = 'c.field.pointer';
          note = `${f.name} is a pointer`;
        }
      }
      const ev: Evidence[] = [evidence(rule, f.ref, note)];
      if (rule === 'c.field.pointer-many') ev.push(evidence('c.field.pointer-many.use', many.get(f.name)!.ref));
      edges.push({
        id: edgeId(kind, from, to, f.name),
        kind,
        from: { node: from },
        to: { node: to, role: f.name, multiplicity, navigable: true },
        confidence,
        evidence: ev,
      });
      linked.add(`${from}|${to}`).add(`${to}|${from}`);
    }
  }

  if (opts.showDependencies) {
    const deps = new Map<string, DiagramEdge>();
    for (const o of ops) {
      const from = idOf.get(o.owner.key)!;
      const uses = [...o.fn.params.map((_, i) => i), -1];
      for (const i of uses) {
        const use = i < 0 ? o.fn.result : paramUse(o.fn, i);
        const r = resolveUse(p, use);
        const key = r.entity?.key ?? (r.fnTypedef ? `typedef:${r.fnTypedef.name}` : undefined);
        const to = key ? idOf.get(key) : undefined;
        if (!to || to === from || linked.has(`${from}|${to}`)) continue;
        const id = edgeId('dependency', from, to);
        const ev = evidence('c.dependency', o.fn.ref, `${o.fn.name} uses it in its ${i < 0 ? 'result' : 'parameters'}`);
        const existing = deps.get(id);
        if (existing) existing.evidence.push(ev);
        else
          deps.set(id, {
            id,
            kind: 'dependency',
            from: { node: from },
            to: { node: to },
            confidence: 1,
            evidence: [ev],
          });
      }
    }
    edges.push(...deps.values());
  }

  return { lang: 'c', kind: 'c.struct', nodes, edges, diagnostics: [] };
}

function entityEvidence(e: Entity, name: string, opaque: boolean): Evidence {
  const kw = e.kind;
  const how = e.aliases.length ? `typedef ${kw}${e.tag ? ` ${e.tag}` : ''} ${name}` : `${kw} ${e.tag ?? name}`;
  if (opaque)
    return evidence(
      'c.opaque',
      e.body?.ref ?? e.aliases[0]?.ref ?? e.firstRef,
      `${how}: declared in ${e.forwardIn.filter(isHeader).join(', ')}, ${e.body ? `defined in ${e.body.file}` : 'never defined'}`,
    );
  return evidence(`c.${kw}`, e.body?.ref ?? e.firstRef, e.body ? `${how} defined in ${e.body.file}` : how);
}

/** Type use of the i-th parameter, re-derived from its display text (only the first is kept in FunctionInfo). */
function paramUse(fn: FunctionInfo, i: number) {
  if (i === 0) return fn.firstParam;
  const t = fn.params[i]?.type;
  if (!t) return undefined;
  const m = /^(?:(?:const|volatile)\s+)*(struct|union|enum)?\s*([A-Za-z_]\w*)\s*(\**)/.exec(t);
  if (!m) return undefined;
  const key = m[1] ? `${m[1]}:${m[2]}` : `typedef:${m[2]}`;
  return { key, text: t, stars: m[3]!.length, arrays: [] };
}

// --------------------------------------------------------------- the TAD rule

/** One entry per function name: prototypes and the definition merged. */
interface Merged {
  name: string;
  def?: FunctionInfo;
  /** Prototype in a header, whose parameter names win. */
  proto?: FunctionInfo;
  /** First declaration seen, for a function only prototyped in a .c file. */
  first: FunctionInfo;
  isStatic: boolean;
}

function mergeFunctions(p: Project): Merged[] {
  const byName = new Map<string, Merged>();
  for (const f of p.functions) {
    const m = byName.get(f.name) ?? { name: f.name, first: f, isStatic: false };
    if (f.isStatic) m.isStatic = true;
    if (f.defined) m.def ??= f;
    else if (isHeader(f.file)) m.proto ??= f;
    byName.set(f.name, m);
  }
  return [...byName.values()];
}

function operations(p: Project, opts: AnalyzeOptions): Op[] {
  const out: Op[] = [];
  for (const m of mergeFunctions(p)) {
    if (m.name === 'main') continue;
    // A prototype in a .c with no definition anywhere has neither: fall back to it.
    const fn = m.proto ?? m.def ?? m.first;
    const candidates: [Entity | undefined, string][] = [
      [pointedEntity(p, fn.firstParam), 'c.operation.first-param'],
      [pointedEntity(p, fn.result), 'c.operation.returns'],
    ];
    let owner: Entity | undefined;
    let rule = '';
    for (const [e, r] of candidates) {
      if (e && namesOf(e).some((n) => startsWithTypeName(m.name, n))) {
        owner = e;
        rule = r;
        break;
      }
    }
    if (!owner) continue;
    const params = fn.params.map((x, i) => {
      // The header's names win; an unnamed prototype parameter takes the definition's name.
      const name = x.name || m.def?.params[i]?.name || '';
      return x.type ? { name, type: x.type } : { name };
    });
    const flags: MemberFlag[] = [];
    const accessor = m.def ? accessorKind(m.def, owner) : undefined;
    if (accessor) flags.push(accessor);
    if (accessor && !opts.showAccessors) continue;
    const member: Member = {
      name: m.name,
      visibility: m.isStatic ? '-' : '+',
      params,
      returns: fn.returns,
      ref: fn.ref,
    };
    if (flags.length) member.flags = flags;
    out.push({ fn, owner, member, rule });
  }
  return out;
}

function pointedEntity(p: Project, use: FunctionInfo['firstParam']): Entity | undefined {
  const r = resolveUse(p, use);
  return r.entity && r.stars >= 1 ? r.entity : undefined;
}

/**
 * A trivial getter is `T_getX(T *t) { return t->x; }`, a trivial setter
 * `T_setX(T *t, V v) { t->x = v; }`: the name says get/is/set after the type
 * name and the body does nothing else.
 */
function accessorKind(fn: FunctionInfo, owner: Entity): 'getter' | 'setter' | undefined {
  if (!fn.body) return undefined;
  const typeName = namesOf(owner).find((n) => startsWithTypeName(fn.name, n));
  if (!typeName) return undefined;
  const rest = fn.name.slice(typeName.replace(/^_+/, '').length).replace(/^_/, '');
  const self = fn.params[0]?.name;
  const stmts = fn.body.namedChildren.filter((c): c is Node => !!c && c.type !== 'comment');
  if (!self || stmts.length !== 1) return undefined;
  const st = stmts[0]!;
  const isField = (n: Node | null | undefined) =>
    n?.type === 'field_expression' && n.childForFieldName('argument')?.text === self;
  if (/^(get|is)([A-Z_]|$)/i.test(rest) && fn.params.length === 1 && st.type === 'return_statement') {
    return isField(st.namedChildren[0]) ? 'getter' : undefined;
  }
  if (/^set([A-Z_]|$)/i.test(rest) && fn.params.length === 2 && st.type === 'expression_statement') {
    const a = st.namedChildren[0];
    return a?.type === 'assignment_expression' &&
      isField(a.childForFieldName('left')) &&
      a.childForFieldName('right')?.text === fn.params[1]?.name
      ? 'setter'
      : undefined;
  }
  return undefined;
}

// ------------------------------------------------ pointer fields used as arrays

const ALLOC_MANY = /^(calloc|realloc)$|^malloc$/;
const ARRAY_USES: ReadonlySet<string> = new Set(['subscript_expression', 'assignment_expression']);

/**
 * Field names that the code indexes (`q->data[i]`) or allocates for many
 * elements (`q->data = malloc(n * sizeof *q->data)`, `calloc(n, ...)`). Only the
 * field name is matched, not the struct it belongs to, hence a heuristic.
 */
function arrayLikeFields(p: Project): Map<string, { how: string; ref: SourceRef }> {
  const out = new Map<string, { how: string; ref: SourceRef }>();
  for (const fn of p.functions) {
    if (!fn.body) continue;
    // Iterative walk, in source order: a deep `else if` chain must not overflow the stack.
    for (const c of descendants(fn.body, ARRAY_USES)) {
      if (c.type === 'subscript_expression') {
        const arg = c.childForFieldName('argument');
        const field = arg?.type === 'field_expression' ? arg.childForFieldName('field')?.text : undefined;
        if (field && !out.has(field)) out.set(field, { how: 'indexed', ref: refOf(c, fn.file) });
      } else {
        const left = c.childForFieldName('left');
        const field = left?.type === 'field_expression' ? left.childForFieldName('field')?.text : undefined;
        const right = c.childForFieldName('right');
        if (field && right && !out.has(field) && allocatesMany(right))
          out.set(field, { how: 'allocated for many elements', ref: refOf(c, fn.file) });
      }
    }
  }
  return out;
}

function allocatesMany(expr: Node): boolean {
  let n: Node | null = expr;
  while (n?.type === 'cast_expression' || n?.type === 'parenthesized_expression')
    n = n.type === 'cast_expression' ? n.childForFieldName('value') : (n.namedChildren[0] ?? null);
  if (n?.type !== 'call_expression') return false;
  const name = n.childForFieldName('function')?.text ?? '';
  if (!ALLOC_MANY.test(name)) return false;
  const args = n.childForFieldName('arguments')?.namedChildren.filter((a): a is Node => !!a) ?? [];
  if (name === 'calloc') return args[0]?.text !== '1';
  const size = name === 'realloc' ? args[1] : args[0];
  // n * sizeof(T), sizeof(T) * n
  return size?.type === 'binary_expression' && size.text.includes('*') && size.text.includes('sizeof');
}
