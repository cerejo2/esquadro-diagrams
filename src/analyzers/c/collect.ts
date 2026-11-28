// Walks the parsed C files once and records what the three diagrams need:
// struct/union/enum definitions, typedefs, functions (definitions and
// prototypes), their calls, includes and the preprocessor blocks.
import type { Node } from 'web-tree-sitter';
import type { Diagnostic, SourceRef } from '../../model/types';
import { diagnostic, refOf } from '../shared/evidence';
import {
  type DeclInfo,
  type Param,
  type Reparse,
  baseTypeText,
  descendants,
  isStatic,
  paramsOf,
  qualifiersOf,
  topLevelItems,
  typeString,
  unwrapDeclarator,
} from './ast';

export interface ParsedFile {
  path: string;
  root: Node;
  /** Parses a piece of this file again, to recover the items an ERROR node swallowed. */
  reparse?: Reparse;
}

export type Aggregate = 'struct' | 'union' | 'enum';

/** A reference to a type as written in a declaration. */
export interface TypeUse {
  /** `struct node` → key `struct:node`; a typedef name → `typedef:Name`; primitives have no key. */
  key?: string;
  /** Display text: `const struct node*`, `Item[N]`. */
  text: string;
  stars: number;
  arrays: string[];
}

export interface FieldInfo {
  name: string;
  use: TypeUse;
  /** Inline function pointer: `int (*cmp)(const void*, const void*)`. */
  fn?: { params: Param[]; returns: string };
  ref: SourceRef;
}

export interface EnumConst {
  name: string;
  value?: string;
  ref: SourceRef;
}

export interface Entity {
  key: string;
  kind: Aggregate;
  tag?: string;
  /** Where the body `{...}` is; undefined for a type that is only declared. */
  body?: { file: string; ref: SourceRef };
  fields: FieldInfo[];
  constants: EnumConst[];
  /** Plain typedef names (`typedef struct node Node` gives Node), in source order. */
  aliases: { name: string; file: string; ref: SourceRef }[];
  /** Files where the type is declared without a body (`typedef struct _Q Q;`, `struct q;`). */
  forwardIn: string[];
  /**
   * False while the type has only been mentioned in a field (`struct stat info;`):
   * a library type, which must not become a node of its own.
   */
  declared: boolean;
  firstRef: SourceRef;
}

export interface Typedef {
  name: string;
  file: string;
  ref: SourceRef;
  /** The aliased type (entity key or another typedef), with extra stars. */
  use: TypeUse;
  /** `typedef R (*Name)(P...)`, or `typedef R Name(P...)` (then `fnType`). */
  fnPointer?: { params: Param[]; returns: string };
  /** `typedef R Name(P...)`: a function type, so `Name *` is the pointer to function. */
  fnType?: boolean;
}

export interface CallSite {
  /** Callee name when the call is `name(...)` or `(*name)(...)`. */
  name?: string;
  /** Source text of the callee for indirect calls (`t->hash`, `ops[i]`). */
  text: string;
  ref: SourceRef;
}

export interface LocalVar {
  name: string;
  fnPointer: boolean;
  /** Function names assigned directly: `T x = f;`, `x = f;`, `x = &f;`. */
  assigned: { name: string; ref: SourceRef }[];
  /** True when something other than a plain name was assigned too. */
  otherAssign: boolean;
  param: boolean;
}

export interface FunctionInfo {
  name: string;
  file: string;
  ref: SourceRef;
  isStatic: boolean;
  defined: boolean;
  params: Param[];
  /** The first parameter's type and the result type, for the TAD rule. */
  firstParam?: TypeUse;
  result: TypeUse;
  returns: string;
  calls: CallSite[];
  locals: Map<string, LocalVar>;
  /** The body, kept for the getter/setter check. */
  body?: Node;
}

export interface IncludeInfo {
  file: string;
  target: string;
  system: boolean;
  /** `#include MACRO`: the target is a macro, which is not expanded. */
  computed?: boolean;
  ref: SourceRef;
}

export interface GlobalVar {
  name: string;
  file: string;
  assigned: { name: string; ref: SourceRef }[];
}

export interface Project {
  files: string[];
  entities: Map<string, Entity>;
  typedefs: Map<string, Typedef>;
  /** Definitions and prototypes, in file then line order. */
  functions: FunctionInfo[];
  includes: IncludeInfo[];
  globals: Map<string, GlobalVar>;
  macros: Set<string>;
  diagnostics: Diagnostic[];
}

const keyOf = (kind: Aggregate, tag: string) => `${kind}:${tag}`;
const SPECIFIERS: Record<string, Aggregate> = {
  struct_specifier: 'struct',
  union_specifier: 'union',
  enum_specifier: 'enum',
};

export function collectProject(parsed: ParsedFile[]): Project {
  const p: Project = {
    files: parsed.map((f) => f.path),
    entities: new Map(),
    typedefs: new Map(),
    functions: [],
    includes: [],
    globals: new Map(),
    macros: new Set(),
    diagnostics: [],
  };
  for (const f of parsed) collectFile(p, f);
  return p;
}

function entityFor(p: Project, kind: Aggregate, tag: string | undefined, file: string, node: Node): Entity {
  const ref = refOf(node, file);
  const key = tag ? keyOf(kind, tag) : `${kind}:@${file}:${ref.line}:${node.startPosition.column}`;
  let e = p.entities.get(key);
  if (!e) {
    e = { key, kind, tag, fields: [], constants: [], aliases: [], forwardIn: [], declared: false, firstRef: ref };
    p.entities.set(key, e);
  }
  return e;
}

/**
 * Records a struct/union/enum specifier (with or without body) and returns its
 * entity key. `mention` is set for the type of a field, which names a type
 * without declaring it.
 */
function specifier(p: Project, spec: Node, file: string, mention = false): string {
  const kind = SPECIFIERS[spec.type]!;
  const tag = spec.childForFieldName('name')?.text;
  const body = spec.childForFieldName('body');
  const e = entityFor(p, kind, tag, file, spec);
  if (body || !mention) e.declared = true;
  if (!body) {
    if (!e.forwardIn.includes(file)) e.forwardIn.push(file);
    return e.key;
  }
  const ref = refOf(spec, file);
  if (e.body) {
    if (e.body.file !== file || e.body.ref.line !== ref.line)
      p.diagnostics.push(
        diagnostic('info', `${kind} ${tag} is defined again (first in ${e.body.file}); the first one is used`, ref),
      );
    return e.key;
  }
  e.body = { file, ref };
  if (kind === 'enum') {
    for (const c of body.namedChildren) {
      if (c?.type !== 'enumerator') continue;
      const name = c.childForFieldName('name')?.text ?? '';
      const value = c.childForFieldName('value')?.text;
      e.constants.push({ name, value: value?.replace(/\s+/g, ' '), ref: refOf(c, file) });
    }
  } else {
    for (const fd of fieldDecls(body)) {
      const typeNode = fd.childForFieldName('type');
      // Nested definitions (`struct inner {...} x;`) are types of their own.
      const nestedKey = typeNode && SPECIFIERS[typeNode.type] ? specifier(p, typeNode, file, true) : undefined;
      const quals = qualifiersOf(fd);
      const base = baseTypeText(typeNode);
      const declarators = fd.childrenForFieldName('declarator').filter((d): d is Node => !!d);
      // C11 anonymous member (`union { int i; float f; };`): its fields are fields of this type.
      if (!declarators.length && nestedKey && !typeNode?.childForFieldName('name')) {
        for (const f of p.entities.get(nestedKey)!.fields)
          if (!e.fields.some((x) => x.name === f.name)) e.fields.push(f);
        continue;
      }
      for (const dn of declarators) {
        const d = unwrapDeclarator(dn);
        if (!d.name) continue;
        // The same field in two #if branches: the first one is used.
        if (e.fields.some((x) => x.name === d.name)) continue;
        const fieldRef = refOf(fd, file);
        if (d.params && d.fnPointer) {
          e.fields.push({
            name: d.name,
            use: { text: typeString(quals, base, d.stars), stars: 0, arrays: [] },
            fn: { params: paramsOf(d.params), returns: typeString(quals, base, d.stars) },
            ref: fieldRef,
          });
          continue;
        }
        e.fields.push({ name: d.name, use: typeUseOf(typeNode, quals, d, nestedKey), ref: fieldRef });
      }
    }
  }
  return e.key;
}

/** Field declarations of a body, looking inside `#if` blocks. */
function fieldDecls(body: Node): Node[] {
  const out: Node[] = [];
  for (const c of body.namedChildren) {
    if (!c) continue;
    if (c.type === 'field_declaration') out.push(c);
    else if (c.type.startsWith('preproc_')) out.push(...fieldDecls(c));
  }
  return out;
}

function typeUseOf(typeNode: Node | null, quals: string[], d: DeclInfo, specKey?: string): TypeUse {
  const base = baseTypeText(typeNode);
  let key = specKey;
  if (!key && typeNode) {
    const kind = SPECIFIERS[typeNode.type];
    const tag = typeNode.childForFieldName('name')?.text;
    if (kind && tag) key = keyOf(kind, tag);
    else if (typeNode.type === 'type_identifier') key = `typedef:${typeNode.text}`;
  }
  return { key, text: typeString(quals, base, d.stars, d.arrays), stars: d.stars, arrays: d.arrays };
}

function collectFile(p: Project, f: ParsedFile): void {
  const file = f.path;
  const items = topLevelItems(f.root, f.reparse);
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    switch (item.type) {
      case 'preproc_include': {
        const path = item.childForFieldName('path');
        if (!path) break;
        const system = path.type === 'system_lib_string';
        const target = path.text.replace(/^["<]|[">]$/g, '');
        const inc: IncludeInfo = { file, target, system, ref: refOf(item, file) };
        if (!system && path.type !== 'string_literal') inc.computed = true;
        p.includes.push(inc);
        break;
      }
      case 'expression_statement':
        i = implicitIntFunction(p, items, i, file);
        break;
      case 'preproc_function_def':
      case 'preproc_def': {
        const name = item.childForFieldName('name')?.text;
        if (name && item.type === 'preproc_function_def') p.macros.add(name);
        break;
      }
      case 'struct_specifier':
      case 'union_specifier':
      case 'enum_specifier':
        specifier(p, item, file);
        break;
      case 'type_definition':
        typeDefinition(p, item, file);
        break;
      case 'declaration':
        declaration(p, item, file);
        break;
      case 'function_definition':
        functionDefinition(p, item, file);
        break;
    }
  }
}

function typeDefinition(p: Project, td: Node, file: string): void {
  const typeNode = td.childForFieldName('type');
  const specKey = typeNode && SPECIFIERS[typeNode.type] ? specifier(p, typeNode, file) : undefined;
  const quals = qualifiersOf(td);
  for (const dn of td.childrenForFieldName('declarator')) {
    if (!dn) continue;
    const d = unwrapDeclarator(dn);
    if (!d.name) continue;
    const ref = refOf(td, file);
    if (p.typedefs.has(d.name)) continue;
    const t: Typedef = { name: d.name, file, ref, use: typeUseOf(typeNode, quals, d, specKey) };
    if (d.params) {
      const returns = typeString(quals, baseTypeText(typeNode), d.stars);
      t.fnPointer = { params: paramsOf(d.params), returns };
    }
    if (d.params && !d.fnPointer && d.stars === 0) t.fnType = true;
    p.typedefs.set(d.name, t);
    // A plain alias of a struct/union/enum names that entity.
    if (specKey && !d.params && d.stars === 0 && !d.arrays.length) {
      p.entities.get(specKey)!.aliases.push({ name: d.name, file, ref });
    }
  }
}

function declaration(p: Project, decl: Node, file: string): void {
  const typeNode = decl.childForFieldName('type');
  const specKey =
    typeNode && SPECIFIERS[typeNode.type] && typeNode.childForFieldName('body')
      ? specifier(p, typeNode, file)
      : undefined;
  if (typeNode && SPECIFIERS[typeNode.type] && !specKey && !decl.childrenForFieldName('declarator').length)
    specifier(p, typeNode, file); // `struct q;`
  const quals = qualifiersOf(decl);
  for (const dn of decl.childrenForFieldName('declarator')) {
    if (!dn) continue;
    const d = unwrapDeclarator(dn);
    if (!d.name) continue;
    if (d.params && !d.fnPointer) {
      p.functions.push(functionInfo(decl, d, typeNode, quals, file, false, undefined));
      continue;
    }
    // A global variable: remember direct function-name initialisers (`fp = f`).
    const g: GlobalVar = p.globals.get(d.name) ?? { name: d.name, file, assigned: [] };
    const target = d.value ? directFunctionName(d.value) : undefined;
    if (target) g.assigned.push({ name: target, ref: refOf(dn, file) });
    p.globals.set(d.name, g);
  }
}

function functionDefinition(p: Project, fn: Node, file: string): void {
  const typeNode = fn.childForFieldName('type');
  if (typeNode && SPECIFIERS[typeNode.type] && typeNode.childForFieldName('body')) specifier(p, typeNode, file);
  const d = unwrapDeclarator(fn.childForFieldName('declarator'));
  if (!d.name) return;
  // K&R: `int add(a, b) int a; int b; { ... }` declares the parameter types between ) and {.
  const knr = fn.namedChildren.filter((c): c is Node => c?.type === 'declaration');
  const body = fn.childForFieldName('body') ?? undefined;
  p.functions.push(functionInfo(fn, d, typeNode, qualifiersOf(fn), file, true, body, knr));
}

/**
 * A K&R definition with an implicit `int` result (`main() { ... }`, `f(a) int a; { ... }`):
 * tree-sitter reads it as a call statement followed by a block. Returns the index of
 * the last item it used.
 */
function implicitIntFunction(p: Project, items: Node[], i: number, file: string): number {
  const stmt = items[i]!;
  const call = stmt.namedChildren[0];
  const name = call?.type === 'call_expression' ? call.childForFieldName('function') : undefined;
  const args = call?.childForFieldName('arguments');
  if (name?.type !== 'identifier' || !args || !args.namedChildren.every((a) => a?.type === 'identifier')) return i;
  let j = i + 1;
  const knr: Node[] = [];
  while (items[j]?.type === 'declaration') knr.push(items[j++]!);
  const body = items[j];
  if (body?.type !== 'compound_statement') return i;
  const d: DeclInfo = { name: name.text, nameNode: name, stars: 0, arrays: [], params: args, fnPointer: false };
  const info = functionInfo(stmt, d, null, [], file, true, body, knr);
  info.returns = 'int';
  info.result = { text: 'int', stars: 0, arrays: [] };
  info.ref = { file, line: stmt.startPosition.row + 1, endLine: body.endPosition.row + 1 };
  p.functions.push(info);
  return j;
}

/** Parameters written K&R style: names in the list, types in the declarations after it (`int` when missing). */
function knrParams(list: Node, decls: Node[]): { params: Param[]; first?: TypeUse } {
  const params: Param[] = [];
  let first: TypeUse | undefined;
  for (const id of list.namedChildren) {
    if (id?.type !== 'identifier') continue;
    let use: TypeUse = { text: 'int', stars: 0, arrays: [] };
    for (const decl of decls)
      for (const dn of decl.childrenForFieldName('declarator')) {
        const u = unwrapDeclarator(dn);
        if (u.name === id.text && !u.params) use = typeUseOf(decl.childForFieldName('type'), qualifiersOf(decl), u);
      }
    params.push({ name: id.text, type: use.text });
    first ??= use;
  }
  return { params, first };
}

function functionInfo(
  decl: Node,
  d: DeclInfo,
  typeNode: Node | null,
  quals: string[],
  file: string,
  defined: boolean,
  body: Node | undefined,
  knr: Node[] = [],
): FunctionInfo {
  let params = paramsOf(d.params);
  let returns = typeString(quals, baseTypeText(typeNode), d.stars);
  // `int (*getop(char c))(int, int)` returns `int(*)(int, int)`.
  if (d.returnParams)
    returns = `${typeString(quals, baseTypeText(typeNode), Math.max(0, d.stars - 1))}(*)(${paramsOf(d.returnParams)
      .map((x) => x.type ?? x.name)
      .join(', ')})`;
  const first = d.params?.namedChildren.find((c) => c?.type === 'parameter_declaration');
  let firstParam: TypeUse | undefined;
  if (first && params.length) {
    const fd = unwrapDeclarator(first.childForFieldName('declarator'));
    if (!fd.params) firstParam = typeUseOf(first.childForFieldName('type'), qualifiersOf(first), fd);
  }
  if (!params.length && d.params?.namedChildren.some((c) => c?.type === 'identifier')) {
    const k = knrParams(d.params, knr);
    params = k.params;
    firstParam = k.first;
  }
  const info: FunctionInfo = {
    name: d.name,
    file,
    ref: refOf(decl, file),
    isStatic: isStatic(decl),
    defined,
    params,
    firstParam,
    result: typeUseOf(typeNode, quals, { ...d, arrays: [] }),
    returns,
    calls: [],
    locals: new Map(),
    body,
  };
  if (body) scanBody(info, d, body, file);
  return info;
}

const CALLS = new Set(['call_expression']);
const LOCAL_DECLS = new Set(['declaration']);
const ASSIGNS = new Set(['assignment_expression']);

/** `f`, `&f`, `(f)` → 'f'; anything else → undefined. */
export function directFunctionName(v: Node): string | undefined {
  let n: Node | null = v;
  while (n && (n.type === 'parenthesized_expression' || (n.type === 'pointer_expression' && n.text.startsWith('&'))))
    n = n.type === 'parenthesized_expression' ? (n.namedChildren[0] ?? null) : n.childForFieldName('argument');
  if (n?.type === 'cast_expression') return directFunctionName(n.childForFieldName('value')!);
  return n?.type === 'identifier' ? n.text : undefined;
}

/** `name`, `(*name)`, `(name)` as a callee → 'name'. */
function calleeName(fnNode: Node): string | undefined {
  let n: Node | null = fnNode;
  while (n && (n.type === 'parenthesized_expression' || (n.type === 'pointer_expression' && n.text.startsWith('*'))))
    n = n.type === 'parenthesized_expression' ? (n.namedChildren[0] ?? null) : n.childForFieldName('argument');
  return n?.type === 'identifier' ? n.text : undefined;
}

function scanBody(info: FunctionInfo, d: DeclInfo, body: Node, file: string): void {
  // Parameters are locals too: a call through one is a call through a pointer.
  for (const prm of d.params?.namedChildren ?? []) {
    if (prm?.type === 'identifier') {
      // K&R parameter name.
      info.locals.set(prm.text, { name: prm.text, fnPointer: false, assigned: [], otherAssign: true, param: true });
      continue;
    }
    if (prm?.type !== 'parameter_declaration') continue;
    const pd = unwrapDeclarator(prm.childForFieldName('declarator'));
    if (pd.name)
      info.locals.set(pd.name, {
        name: pd.name,
        fnPointer: !!pd.params,
        assigned: [],
        otherAssign: true,
        param: true,
      });
  }
  for (const decl of descendants(body, LOCAL_DECLS)) {
    for (const dn of decl.childrenForFieldName('declarator')) {
      if (!dn) continue;
      const ld = unwrapDeclarator(dn);
      // `int helper(int);` inside a body is a prototype, not a variable.
      if (!ld.name || (ld.params && !ld.fnPointer)) continue;
      const v: LocalVar = info.locals.get(ld.name) ?? {
        name: ld.name,
        fnPointer: !!ld.params && ld.fnPointer,
        assigned: [],
        otherAssign: false,
        param: false,
      };
      if (ld.value) {
        const target = directFunctionName(ld.value);
        if (target) v.assigned.push({ name: target, ref: refOf(dn, file) });
        else v.otherAssign = true;
      }
      info.locals.set(ld.name, v);
    }
  }
  for (const a of descendants(body, ASSIGNS)) {
    const left = a.childForFieldName('left');
    const right = a.childForFieldName('right');
    if (left?.type !== 'identifier' || !right) continue;
    const v = info.locals.get(left.text);
    if (!v) continue;
    const target = a.children.find((c) => c && !c.isNamed)?.text === '=' ? directFunctionName(right) : undefined;
    if (target) v.assigned.push({ name: target, ref: refOf(a, file) });
    else v.otherAssign = true;
  }
  for (const c of descendants(body, CALLS)) {
    const fnNode = c.childForFieldName('function');
    if (!fnNode) continue;
    info.calls.push({ name: calleeName(fnNode), text: fnNode.text.replace(/\s+/g, ' '), ref: refOf(fnNode, file) });
  }
}
