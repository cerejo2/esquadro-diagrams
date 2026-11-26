// First pass: turns parsed files into a list of declared types with their
// fields and methods. Bodies stay as tree-sitter nodes for the later passes,
// so the trees must stay alive until the model is built.
import type { Node } from 'web-tree-sitter';
import type { SourceRef } from '../../model/types';
import { refOf } from '../shared/evidence';
import { type Modifiers, TYPE_DECLS, dimsText, isComment, modifiersOf, scopedName, typeText } from './ast';

export type Visibility = '+' | '-' | '#' | '~';
export type DeclKind = 'class' | 'interface' | 'enum' | 'record';

export interface JFile {
  path: string;
  pkg: string;
  /** Simple name → qualified name, from `import a.b.C;`. */
  singleImports: Map<string, string>;
  /** `a.b` for every `import a.b.*;` (a package or a type). */
  onDemandImports: string[];
  root: Node;
}

export interface JParam {
  name: string;
  typeNode: Node | null;
  type: string;
}

export interface JField {
  name: string;
  typeNode: Node | null;
  type: string;
  visibility: Visibility;
  mods: Modifiers;
  value: Node | null;
  /** True for record components (private final, set by the canonical constructor). */
  component: boolean;
  /** True for enum constants (shown by name only). */
  enumConstant: boolean;
  node: Node;
  ref: SourceRef;
}

export interface JMethod {
  name: string;
  ctor: boolean;
  params: JParam[];
  returnNode: Node | null;
  returns?: string;
  visibility: Visibility;
  mods: Modifiers;
  abstract: boolean;
  typeParams: string[];
  body: Node | null;
  node: Node;
  ref: SourceRef;
}

export interface JType {
  /** `library.catalog.Item`, `boardgame.Board.Dice`; no package prefix in the default package. */
  qname: string;
  /** Display name: `Item`, `Board.Dice`. */
  name: string;
  simple: string;
  pkg: string;
  file: JFile;
  decl: DeclKind;
  mods: Modifiers;
  outer?: JType;
  nested: JType[];
  typeParams: string[];
  superclass: Node | null;
  interfaces: Node[];
  fields: JField[];
  methods: JMethod[];
  /** Instance and static initializer blocks. */
  initializers: Node[];
  node: Node;
  body: Node | null;
  ref: SourceRef;
  /** Declaration order across the project (files sorted by path). */
  order: number;
}

function typeParamsOf(decl: Node): string[] {
  const tp = decl.childForFieldName('type_parameters') ?? decl.namedChildren.find((c) => c.type === 'type_parameters');
  if (!tp) return [];
  return tp.namedChildren
    .filter((c) => c.type === 'type_parameter')
    .map((c) => c.namedChildren.find((x) => x.type === 'type_identifier' || x.type === 'identifier')?.text ?? '')
    .filter(Boolean);
}

export function paramsOf(formal: Node | null | undefined): JParam[] {
  if (!formal) return [];
  const out: JParam[] = [];
  for (const p of formal.namedChildren) {
    if (p.type === 'formal_parameter') {
      const typeNode = p.childForFieldName('type');
      const name = p.childForFieldName('name')?.text ?? '';
      const dims = p.childForFieldName('dimensions') ?? p.namedChildren.find((c) => c.type === 'dimensions');
      out.push({ name, typeNode, type: typeText(typeNode) + dimsText(dims) });
    } else if (p.type === 'spread_parameter') {
      const typeNode = p.namedChildren.find((c) => c.type !== 'modifiers' && c.type !== 'variable_declarator') ?? null;
      const decl = p.namedChildren.find((c) => c.type === 'variable_declarator');
      const name = decl?.childForFieldName('name')?.text ?? '';
      out.push({ name, typeNode, type: `${typeText(typeNode)}...` });
    }
  }
  return out;
}

function collectFile(path: string, root: Node): JFile {
  let pkg = '';
  const singleImports = new Map<string, string>();
  const onDemandImports: string[] = [];
  for (const c of root.namedChildren) {
    if (c.type === 'package_declaration') {
      const id = c.namedChildren.find((x) => x.type === 'scoped_identifier' || x.type === 'identifier');
      if (id) pkg = scopedName(id);
    } else if (c.type === 'import_declaration') {
      if (c.children.some((x) => x.type === 'static')) continue;
      const id = c.namedChildren.find((x) => x.type === 'scoped_identifier' || x.type === 'identifier');
      if (!id) continue;
      const name = scopedName(id);
      if (c.namedChildren.some((x) => x.type === 'asterisk')) onDemandImports.push(name);
      else singleImports.set(name.slice(name.lastIndexOf('.') + 1), name);
    }
  }
  return { path, pkg, singleImports, onDemandImports, root };
}

function declKind(node: Node): DeclKind {
  switch (node.type) {
    case 'interface_declaration':
      return 'interface';
    case 'enum_declaration':
      return 'enum';
    case 'record_declaration':
      return 'record';
    default:
      return 'class';
  }
}

function defaultVisibility(owner: DeclKind, isCtor: boolean): Visibility {
  if (owner === 'interface') return '+';
  if (owner === 'enum' && isCtor) return '-';
  return '~';
}

function fieldsOf(decl: Node, owner: DeclKind, file: string): JField[] {
  const mods = modifiersOf(decl);
  const typeNode = decl.childForFieldName('type');
  const out: JField[] = [];
  const isConst = owner === 'interface';
  for (const d of decl.childrenForFieldName('declarator')) {
    const name = d.childForFieldName('name')?.text ?? '';
    const dims = d.childForFieldName('dimensions') ?? d.namedChildren.find((c) => c.type === 'dimensions');
    out.push({
      name,
      typeNode,
      type: typeText(typeNode) + dimsText(dims),
      visibility: mods.visibility ?? defaultVisibility(owner, false),
      mods: isConst ? { ...mods, isStatic: true, isFinal: true } : mods,
      value: d.childForFieldName('value'),
      component: false,
      enumConstant: false,
      node: decl,
      ref: refOf(decl, file),
    });
  }
  return out;
}

function methodOf(node: Node, owner: DeclKind, file: string, recordParams: JParam[]): JMethod {
  const mods = modifiersOf(node);
  const ctor = node.type === 'constructor_declaration' || node.type === 'compact_constructor_declaration';
  const params =
    node.type === 'compact_constructor_declaration' ? recordParams : paramsOf(node.childForFieldName('parameters'));
  const returnNode = ctor ? null : node.childForFieldName('type');
  const dims = node.childForFieldName('dimensions');
  const body = node.childForFieldName('body');
  const abstract =
    mods.isAbstract || (owner === 'interface' && !body && !mods.isStatic && !mods.isDefault && mods.visibility !== '-');
  return {
    name: node.childForFieldName('name')?.text ?? '',
    ctor,
    params,
    returnNode,
    returns: ctor ? undefined : typeText(returnNode) + dimsText(dims),
    visibility: mods.visibility ?? defaultVisibility(owner, ctor),
    mods,
    abstract,
    typeParams: typeParamsOf(node),
    body,
    node,
    ref: refOf(node, file),
  };
}

/** Collects every named type (top level and member types) of the files, in a stable order. */
export function collectTypes(parsed: { path: string; root: Node }[]): { files: JFile[]; types: JType[] } {
  const files: JFile[] = [];
  const types: JType[] = [];

  const visitDecl = (node: Node, file: JFile, outer?: JType) => {
    const simple = node.childForFieldName('name')?.text;
    if (!simple) return;
    const decl = declKind(node);
    const qname = outer ? `${outer.qname}.${simple}` : file.pkg ? `${file.pkg}.${simple}` : simple;
    const mods = modifiersOf(node);
    const superclassNode = node.childForFieldName('superclass');
    const superclass = superclassNode?.namedChildren.find((c) => !isComment(c)) ?? null;
    const ifaceHolder =
      node.childForFieldName('interfaces') ?? node.namedChildren.find((c) => c.type === 'extends_interfaces') ?? null;
    const interfaces = ifaceHolder
      ? (
          ifaceHolder.namedChildren.find((c) => c.type === 'type_list')?.namedChildren ?? ifaceHolder.namedChildren
        ).filter((c) => !isComment(c))
      : [];
    const body = node.childForFieldName('body');
    const t: JType = {
      qname,
      name: outer ? `${outer.name}.${simple}` : simple,
      simple,
      pkg: file.pkg,
      file,
      decl,
      mods:
        decl === 'interface' || decl === 'enum' || decl === 'record'
          ? { ...mods, isStatic: !!outer || mods.isStatic }
          : mods,
      outer,
      nested: [],
      typeParams: typeParamsOf(node),
      superclass,
      interfaces,
      fields: [],
      methods: [],
      initializers: [],
      node,
      body,
      ref: refOf(node, file.path),
      order: types.length,
    };
    types.push(t);
    outer?.nested.push(t);

    // Record components behave as private final fields set by the canonical constructor.
    let recordParams: JParam[] = [];
    if (decl === 'record') {
      recordParams = paramsOf(node.childForFieldName('parameters'));
      const formal = node.childForFieldName('parameters');
      for (const p of recordParams) {
        const pnode = formal?.namedChildren.find((c) => c.childForFieldName('name')?.text === p.name) ?? node;
        t.fields.push({
          name: p.name,
          typeNode: p.typeNode,
          type: p.type,
          visibility: '-',
          mods: {
            isStatic: false,
            isAbstract: false,
            isFinal: true,
            isDefault: false,
            override: false,
            visibility: '-',
          },
          value: null,
          component: true,
          enumConstant: false,
          node: pnode,
          ref: refOf(pnode, file.path),
        });
      }
    }

    if (!body) return;
    const members: Node[] = [];
    for (const c of body.namedChildren) {
      if (c.type === 'enum_body_declarations') members.push(...c.namedChildren);
      else members.push(c);
    }
    for (const m of members) {
      switch (m.type) {
        case 'enum_constant': {
          const name = m.childForFieldName('name')?.text ?? '';
          t.fields.push({
            name,
            typeNode: null,
            type: '',
            visibility: '+',
            mods: {
              isStatic: true,
              isAbstract: false,
              isFinal: true,
              isDefault: false,
              override: false,
              visibility: '+',
            },
            value: m,
            component: false,
            enumConstant: true,
            node: m,
            ref: refOf(m, file.path),
          });
          break;
        }
        case 'field_declaration':
        case 'constant_declaration':
          t.fields.push(...fieldsOf(m, decl, file.path));
          break;
        case 'method_declaration':
        case 'constructor_declaration':
        case 'compact_constructor_declaration':
          t.methods.push(methodOf(m, decl, file.path, recordParams));
          break;
        case 'static_initializer':
        case 'block':
          t.initializers.push(m);
          break;
        default:
          if (TYPE_DECLS.has(m.type)) visitDecl(m, file, t);
      }
    }
  };

  for (const p of parsed) {
    const file = collectFile(p.path, p.root);
    files.push(file);
    for (const c of p.root.namedChildren) if (TYPE_DECLS.has(c.type)) visitDecl(c, file);
  }
  return { files, types };
}
