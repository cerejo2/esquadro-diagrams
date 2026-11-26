// Relations between project types (PROMPT.md §7.1):
// - field relations: association, aggregation or composition, with role and multiplicity;
// - type uses: every other place a type is named (parameters, returns, locals,
//   `new`, static calls...), which become dependencies.
import type { Node } from 'web-tree-sitter';
import type { Evidence, SourceRef } from '../../model/types';
import { evidence, refOf } from '../shared/evidence';
import { isComment, isTypeDecl, scopedName, snippet, typeArgs, unparen, walk } from './ast';
import type { JField, JMethod, JType } from './collect';
import type { Resolver } from './resolve';

// ---------------------------------------------------------------- field targets

/** Container types named in §7.1. Other names ending the same way are accepted with lower confidence. */
const LISTED_COLLECTIONS = new Set(['List', 'Set', 'Collection', 'Queue', 'Deque']);
const COLLECTION_LIKE = /(List|Set|Collection|Queue|Deque|Vector|Stack|Iterable)$/;
const MAP_LIKE = /Map$/;

export type Cardinality = 'one' | 'optional' | 'many';

export interface FieldTarget {
  target: JType;
  cardinality: Cardinality;
  /** The container's simple name (`List`, `Map`, `Optional`, `[]`), if any. */
  container?: string;
  /** False when the container is not in the §7.1 list (CopyOnWriteArrayList...). */
  listed: boolean;
}

function baseName(generic: Node): string {
  const base = generic.namedChildren.find((c) => c.type !== 'type_arguments');
  if (!base) return '';
  const name = base.type === 'scoped_type_identifier' ? scopedName(base) : base.text;
  return name.slice(name.lastIndexOf('.') + 1);
}

function stripWildcard(n: Node): Node | undefined {
  if (n.type !== 'wildcard') return n;
  if (n.children.some((c) => c.type === 'super')) return undefined;
  return n.namedChildren.find((c) => c.type !== 'annotation' && c.type !== 'marker_annotation');
}

/**
 * The project type a field holds: directly, in an array, or as the element of
 * a collection, the value of a map or the content of an Optional.
 */
export function fieldTarget(
  typeNode: Node | null,
  extraDims: boolean,
  ctx: JType,
  res: Resolver,
  depth = 0,
): FieldTarget | undefined {
  if (!typeNode || depth > 4) return undefined;
  const many = (t: FieldTarget | undefined, container: string, listed: boolean): FieldTarget | undefined =>
    t ? { target: t.target, cardinality: 'many', container, listed: listed && t.listed } : undefined;

  if (extraDims) return many(fieldTarget(typeNode, false, ctx, res, depth + 1), '[]', true);
  switch (typeNode.type) {
    case 'array_type':
      return many(fieldTarget(typeNode.childForFieldName('element'), false, ctx, res, depth + 1), '[]', true);
    case 'annotated_type': {
      const inner = typeNode.namedChildren.filter((c) => c.type !== 'annotation' && c.type !== 'marker_annotation');
      return fieldTarget(inner[inner.length - 1] ?? null, false, ctx, res, depth + 1);
    }
    case 'generic_type': {
      const own = res.resolveTypeNode(typeNode, ctx);
      if (own) return { target: own, cardinality: 'one', listed: true };
      const name = baseName(typeNode);
      const args = typeArgs(typeNode.namedChildren.find((c) => c.type === 'type_arguments'))
        .map(stripWildcard)
        .filter((a): a is Node => !!a);
      if (name === 'Optional') {
        const t = fieldTarget(args[0] ?? null, false, ctx, res, depth + 1);
        return t && t.cardinality === 'one' ? { ...t, cardinality: 'optional', container: name } : t;
      }
      if (MAP_LIKE.test(name))
        return many(fieldTarget(args[args.length - 1] ?? null, false, ctx, res, depth + 1), name, name === 'Map');
      if (COLLECTION_LIKE.test(name) && args.length === 1)
        return many(fieldTarget(args[0]!, false, ctx, res, depth + 1), name, LISTED_COLLECTIONS.has(name));
      return undefined;
    }
    case 'type_identifier':
    case 'scoped_type_identifier': {
      const t = res.resolveTypeNode(typeNode, ctx);
      return t ? { target: t, cardinality: 'one', listed: true } : undefined;
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------- code units

/** A piece of a type's own code: a field initializer, a method or constructor, or an initializer block. */
interface CodeUnit {
  kind: 'field-init' | 'ctor' | 'method' | 'init';
  method?: JMethod;
  node: Node;
  params: Set<string>;
  locals: Set<string>;
  typeParams: string[];
}

/** Names declared inside a body (locals, loop variables, lambda and catch parameters, patterns). */
function declaredNames(body: Node | null): Set<string> {
  const out = new Set<string>();
  if (!body) return out;
  walk(
    body,
    (n) => {
      switch (n.type) {
        case 'local_variable_declaration':
          for (const d of n.childrenForFieldName('declarator')) {
            const name = d.childForFieldName('name')?.text;
            if (name) out.add(name);
          }
          break;
        case 'enhanced_for_statement':
        case 'catch_formal_parameter':
        case 'resource':
        case 'instanceof_expression':
        case 'formal_parameter': {
          const name = n.childForFieldName('name')?.text;
          if (name) out.add(name);
          break;
        }
        case 'lambda_expression': {
          const p = n.childForFieldName('parameters');
          if (p?.type === 'identifier') out.add(p.text);
          else if (p) for (const id of p.descendantsOfType('identifier')) if (id) out.add(id.text);
          break;
        }
      }
    },
    isTypeDecl,
  );
  return out;
}

function codeUnits(t: JType): CodeUnit[] {
  const out: CodeUnit[] = [];
  for (const f of t.fields) {
    if (f.value && !f.enumConstant)
      out.push({ kind: 'field-init', node: f.value, params: new Set(), locals: new Set(), typeParams: [] });
  }
  for (const n of t.initializers)
    out.push({ kind: 'init', node: n, params: new Set(), locals: declaredNames(n), typeParams: [] });
  for (const m of t.methods) {
    if (!m.body) continue;
    out.push({
      kind: m.ctor ? 'ctor' : 'method',
      method: m,
      node: m.body,
      params: new Set(m.params.map((p) => p.name)),
      locals: declaredNames(m.body),
      typeParams: m.typeParams,
    });
  }
  return out;
}

// ---------------------------------------------------------------- field relations

export type FieldRelationKind = 'association' | 'aggregation' | 'composition';

export interface FieldRelation {
  owner: JType;
  field: JField;
  target: JType;
  kind: FieldRelationKind;
  multiplicity: string;
  confidence: number;
  evidence: Evidence[];
}

const ELEMENT_METHODS = new Set([
  'add',
  'addFirst',
  'addLast',
  'addElement',
  'offer',
  'offerFirst',
  'offerLast',
  'push',
  'put',
  'putIfAbsent',
  'set',
  'insertElementAt',
  'addIfAbsent',
]);

const isSetterName = (name: string) => /^set[\p{Lu}0-9_]/u.test(name);

interface Write {
  field: JField;
  /** `f = v` (direct) or `f.add(v)` / `f[i] = v` / `f.put(k, v)` (element). */
  element: boolean;
  value: Node;
  unit: CodeUnit;
  at: Node;
}

/** The own field an expression names: `f` (not shadowed) or `this.f`. */
function ownField(expr: Node | null, t: JType, unit: CodeUnit): JField | undefined {
  const e = unparen(expr);
  if (!e) return undefined;
  let name: string | undefined;
  if (e.type === 'identifier') {
    if (unit.params.has(e.text) || unit.locals.has(e.text)) return undefined;
    name = e.text;
  } else if (e.type === 'field_access' && e.childForFieldName('object')?.type === 'this') {
    name = e.childForFieldName('field')?.text;
  }
  return name ? t.fields.find((f) => f.name === name && !f.enumConstant) : undefined;
}

const isAnonymousBody = (n: Node): boolean =>
  n.type === 'class_body' && n.parent?.type === 'object_creation_expression';

/** Names of the fields an anonymous class body declares (they hide the enclosing type's fields). */
function anonymousFields(body: Node): Set<string> {
  const out = new Set<string>();
  for (const d of body.namedChildren)
    if (d.type === 'field_declaration')
      for (const v of d.childrenForFieldName('declarator')) out.add(v.childForFieldName('name')?.text ?? '');
  return out;
}

/**
 * Every write to one of `t`'s fields inside `t`'s own code. Named nested types are
 * separate nodes and are skipped. Anonymous classes are not nodes, so their code
 * counts for `t`, but there `this` is the anonymous object and only a bare field
 * name (not hidden by the anonymous class's own fields) reaches `t`'s fields.
 */
function fieldWrites(t: JType, units: CodeUnit[]): Write[] {
  const out: Write[] = [];
  const scan = (root: Node, unit: CodeUnit, record: boolean, anon?: Set<string>) => {
    const own = (expr: Node | null) => {
      const e = unparen(expr);
      if (anon && (e?.type !== 'identifier' || anon.has(e.text))) return undefined;
      return ownField(expr, t, unit);
    };
    const bodies: Node[] = [];
    walk(
      root,
      (n) => {
        if (!record) return;
        if (n.type === 'assignment_expression' && n.childForFieldName('operator')?.text === '=') {
          const left = unparen(n.childForFieldName('left'));
          const value = n.childForFieldName('right');
          if (!left || !value) return;
          if (left.type === 'array_access') {
            const f = own(left.childForFieldName('array'));
            if (f) out.push({ field: f, element: true, value, unit, at: n });
          } else {
            const f = own(left);
            if (f) out.push({ field: f, element: false, value, unit, at: n });
          }
        } else if (n.type === 'method_invocation') {
          const name = n.childForFieldName('name')?.text ?? '';
          if (!ELEMENT_METHODS.has(name) && name !== 'addAll' && name !== 'putAll') return;
          const f = own(n.childForFieldName('object'));
          const args = n.childForFieldName('arguments')?.namedChildren ?? [];
          const value = args[args.length - 1];
          if (f && value) out.push({ field: f, element: true, value, unit, at: n });
        }
      },
      (n) => {
        if (isTypeDecl(n)) return true;
        if (isAnonymousBody(n)) bodies.push(n);
        return isAnonymousBody(n);
      },
    );
    // Code in an anonymous class runs later, like a method: it never makes a direct write a composition.
    const later: CodeUnit = { ...unit, kind: 'method', method: undefined };
    for (const b of bodies) scan(b, later, true, new Set([...(anon ?? []), ...anonymousFields(b)]));
  };
  for (const unit of units) {
    if (unit.kind === 'field-init') {
      const f = t.fields.find((x) => x.value === unit.node);
      if (f) out.push({ field: f, element: false, value: unit.node, unit, at: f.node });
    }
    scan(unit.node, unit, unit.kind !== 'field-init');
  }
  return out;
}

type ValueClass = 'create' | 'param' | 'null' | 'other';

function classify(w: Write, target: JType, res: Resolver, ctx: JType): ValueClass {
  const v = unparen(w.value);
  if (!v) return 'other';
  if (v.type === 'null_literal') return 'null';
  if (v.type === 'object_creation_expression') {
    const typeNode = v.childForFieldName('type');
    const created = typeNode ? res.resolveTypeNode(typeNode, ctx, w.unit.typeParams) : undefined;
    // Directly holding the object: in the declaration, a constructor or an initializer block.
    // Element adds (`add(new T(...))`) count wherever they are.
    const allowed = w.element || w.unit.kind !== 'method';
    return created && allowed && res.isSubtype(created, target) ? 'create' : 'other';
  }
  if (v.type === 'identifier' && w.unit.params.has(v.text) && !w.unit.locals.has(v.text)) {
    // `this.f = p` counts in a constructor or a setter; `add(p)`, `f[i] = p` and `put(k, p)` in any method.
    const m = w.unit.method;
    if (w.element || w.unit.kind === 'ctor' || (m && isSetterName(m.name))) return 'param';
  }
  return 'other';
}

const RULE_TEXT: Record<FieldRelationKind, string> = {
  composition: 'the class creates the object itself and never receives it from outside',
  aggregation: 'the value comes from a parameter of a constructor or setter, or is added from a parameter',
  association: 'a field of a project type that the class neither creates nor receives from a constructor or setter',
};

/** Field relations of one type, in field order. */
export function fieldRelations(t: JType, res: Resolver): FieldRelation[] {
  const out: FieldRelation[] = [];
  const units = codeUnits(t);
  const writes = fieldWrites(t, units);
  const file = t.file.path;
  for (const f of t.fields) {
    if (f.enumConstant) continue;
    const extraDims = /\[\]$/.test(f.type) && f.typeNode?.type !== 'array_type' && !f.type.endsWith('...');
    const ft = fieldTarget(f.typeNode, extraDims, t, res);
    if (!ft) continue;
    const mine = writes.filter((w) => w.field === f);
    const ev: Evidence[] = [evidence('java.field', f.ref, `${f.name}: ${f.type}`)];
    let created: Write | undefined;
    let param: Write | undefined;
    let nulled: Write | undefined;
    for (const w of mine) {
      const c = classify(w, ft.target, res, t);
      if (c === 'create') created ??= w;
      else if (c === 'param') param ??= w;
      else if (c === 'null' && !w.element) nulled ??= w;
    }
    // Record components are set by the canonical constructor from its parameters.
    const fromComponent = f.component;
    let kind: FieldRelationKind;
    if (param || fromComponent) {
      kind = 'aggregation';
      ev.push(
        param
          ? evidence('java.field.from-parameter', refOf(param.at, file), snippet(param.at))
          : evidence('java.field.record-component', f.ref, 'set by the canonical constructor'),
      );
    } else if (created) {
      kind = 'composition';
      ev.push(evidence('java.field.creates', refOf(created.at, file), snippet(created.at)));
    } else kind = 'association';

    let multiplicity: string;
    if (ft.cardinality === 'many') {
      multiplicity = '*';
      ev.push(evidence('java.multiplicity.many', f.ref, `${ft.container} of ${ft.target.name}`));
    } else if (ft.cardinality === 'optional') {
      multiplicity = '0..1';
      ev.push(evidence('java.multiplicity.optional', f.ref, 'Optional'));
    } else if (nulled) {
      multiplicity = '0..1';
      ev.push(evidence('java.multiplicity.null', refOf(nulled.at, file), snippet(nulled.at)));
    } else multiplicity = '1';

    ev[0] = { ...ev[0]!, note: `${ev[0]!.note}; ${RULE_TEXT[kind]}` };
    let confidence = kind === 'association' ? 0.9 : 0.8;
    if (!ft.listed) {
      confidence -= 0.1;
      ev.push(evidence('java.multiplicity.container', f.ref, `${ft.container} read as a collection by its name`));
    }
    out.push({ owner: t, field: f, target: ft.target, kind, multiplicity, confidence, evidence: ev });
  }
  return out;
}

// ---------------------------------------------------------------- type uses

export type UseRule =
  | 'extends'
  | 'implements'
  | 'field'
  | 'field-type-argument'
  | 'parameter'
  | 'return'
  | 'throws'
  | 'type-bound'
  | 'local'
  | 'new'
  | 'static-access'
  | 'cast'
  | 'instanceof'
  | 'pattern'
  | 'class-literal'
  | 'method-reference'
  | 'type-argument';

export interface TypeUse {
  from: JType;
  to: JType;
  rule: UseRule;
  ref: SourceRef;
  note: string;
}

/** Every type identifier inside a type node (`Map<String, List<Item>>` → Map, String, List, Item). */
function typeNamesIn(node: Node | null | undefined): Node[] {
  if (!node) return [];
  const out: Node[] = [];
  walk(
    node,
    (n) => {
      if (n.type === 'type_identifier' && n.parent?.type !== 'scoped_type_identifier') out.push(n);
      else if (n.type === 'scoped_type_identifier' && n.parent?.type !== 'scoped_type_identifier') out.push(n);
    },
    (n) => n.type === 'annotation' || n.type === 'marker_annotation',
  );
  return out;
}

/** Variable names visible in `t`'s code: its fields, inherited fields and enclosing types' fields. */
function fieldNames(t: JType, res: Resolver): Set<string> {
  const out = new Set<string>();
  for (let s: JType | undefined = t; s; s = s.outer)
    for (const x of res.ancestors(s)) for (const f of x.fields) out.add(f.name);
  return out;
}

/** All the places `t`'s own code names a project type, in source order. */
export function typeUses(t: JType, res: Resolver): TypeUse[] {
  const out: TypeUse[] = [];
  const file = t.file.path;
  const push = (rule: UseRule, nameNode: Node, typeParams: readonly string[], at: Node = nameNode) => {
    const to =
      nameNode.type === 'identifier'
        ? res.resolveSimple(nameNode.text, t, typeParams, nameNode)
        : res.resolveTypeNode(nameNode, t, typeParams);
    if (to) out.push({ from: t, to, rule, ref: refOf(at, file), note: snippet(at) });
  };
  const pushType = (rule: UseRule, typeNode: Node | null | undefined, typeParams: readonly string[], at?: Node) => {
    for (const n of typeNamesIn(typeNode)) push(rule, n, typeParams, at ?? n);
  };

  if (t.superclass) pushType('extends', t.superclass, []);
  for (const i of t.interfaces) pushType(t.decl === 'interface' ? 'extends' : 'implements', i, []);
  const typeParamDecl = t.node.childForFieldName('type_parameters');
  pushType('type-bound', typeParamDecl, []);

  for (const f of t.fields) {
    if (f.enumConstant || !f.typeNode) continue;
    // The base of the field's type is the field relation; names inside type arguments are uses too.
    const names = typeNamesIn(f.typeNode);
    names.forEach((n, i) => push(i === 0 ? 'field' : 'field-type-argument', n, [], f.node));
  }

  const vars = fieldNames(t, res);
  const units = codeUnits(t);
  for (const m of t.methods) {
    for (const p of m.params) pushType('parameter', p.typeNode, m.typeParams, m.node);
    if (m.returnNode) pushType('return', m.returnNode, m.typeParams, m.node);
    const throwsNode = m.node.namedChildren.find((c) => c.type === 'throws');
    pushType('throws', throwsNode, m.typeParams, m.node);
    pushType('type-bound', m.node.childForFieldName('type_parameters'), m.typeParams, m.node);
  }
  for (const u of units) {
    const scope = (name: string) => vars.has(name) || u.params.has(name) || u.locals.has(name);
    walk(
      u.node,
      (n) => {
        switch (n.type) {
          case 'local_variable_declaration':
            pushType('local', n.childForFieldName('type'), u.typeParams, n);
            break;
          case 'enhanced_for_statement':
          case 'catch_formal_parameter':
          case 'resource':
            pushType(
              'local',
              n.childForFieldName('type') ?? n.namedChildren.find((c) => c.type === 'catch_type'),
              u.typeParams,
              n,
            );
            break;
          case 'object_creation_expression':
          case 'array_creation_expression':
            pushType('new', n.childForFieldName('type'), u.typeParams, n);
            break;
          case 'cast_expression':
            pushType('cast', n.childForFieldName('type'), u.typeParams, n);
            break;
          case 'instanceof_expression':
            pushType('instanceof', n.childForFieldName('right'), u.typeParams, n);
            break;
          // `case Circle c ->` and `case Point(int x, int y) ->` (switch and instanceof patterns).
          case 'type_pattern':
            pushType(
              'pattern',
              n.namedChildren.find((c) => !isComment(c)),
              u.typeParams,
              n,
            );
            break;
          case 'record_pattern': {
            const head = n.namedChildren[0];
            if (head?.type === 'identifier') push('pattern', head, u.typeParams, n);
            else pushType('pattern', head, u.typeParams, n);
            break;
          }
          case 'record_pattern_component': {
            const head = n.namedChildren[0];
            if (head && head.type !== 'record_pattern') pushType('pattern', head, u.typeParams, n);
            break;
          }
          // Local classes and typed lambda parameters: their declarations name types too.
          case 'formal_parameter':
          case 'spread_parameter':
            pushType(
              'parameter',
              n.childForFieldName('type') ??
                n.namedChildren.find((c) => c.type !== 'modifiers' && c.type !== 'variable_declarator'),
              u.typeParams,
              n,
            );
            break;
          case 'field_declaration':
            pushType('local', n.childForFieldName('type'), u.typeParams, n);
            break;
          case 'method_declaration':
            pushType('return', n.childForFieldName('type'), u.typeParams, n);
            break;
          case 'superclass':
          case 'super_interfaces':
          case 'extends_interfaces':
            pushType('local', n, u.typeParams, n);
            break;
          case 'class_literal':
            pushType('class-literal', n.namedChildren[0], u.typeParams, n);
            break;
          case 'type_arguments':
            if (n.parent?.type === 'method_invocation') pushType('type-argument', n, u.typeParams, n.parent);
            break;
          case 'method_reference': {
            const head = n.namedChildren[0];
            if (head && (head.type === 'identifier' || head.type === 'type_identifier') && !scope(head.text))
              push('method-reference', head, u.typeParams, n);
            else if (head && /type/.test(head.type)) pushType('method-reference', head, u.typeParams, n);
            break;
          }
          case 'method_invocation':
          case 'field_access': {
            // `Type.method()` or `Type.CONSTANT`, where Type is not a variable in scope.
            const obj = n.childForFieldName('object');
            if (obj?.type === 'identifier' && /^\p{Lu}/u.test(obj.text) && !scope(obj.text))
              push('static-access', obj, u.typeParams, n);
            break;
          }
        }
      },
      // A code unit never holds a member type, only local and anonymous classes, whose code counts for `t`.
    );
  }
  return out;
}
