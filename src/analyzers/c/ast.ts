// Small helpers over tree-sitter-c nodes: declarators, type text and top-level walks.
import type { Node } from 'web-tree-sitter';

/** Preprocessor blocks whose children are ordinary top-level items. */
const PREPROC_BLOCKS = new Set(['preproc_if', 'preproc_ifdef', 'preproc_else', 'preproc_elif', 'preproc_elifdef']);

/** Node types that start a top-level item worth keeping. */
const ITEMS = new Set([
  'function_definition',
  'declaration',
  'type_definition',
  'struct_specifier',
  'union_specifier',
  'enum_specifier',
  'preproc_include',
  'preproc_def',
  'preproc_function_def',
  ...PREPROC_BLOCKS,
]);

/** Re-parses a piece of the file; the text is padded with newlines so rows stay the same. */
export type Reparse = (text: string) => Node | undefined;

/** At most this many re-parses per file, so a file full of garbage stays fast. */
const MAX_REPARSES = 50;

/**
 * The items of a translation unit, looking inside `#if`/`#ifdef` blocks (every
 * branch is analysed, §7.2), `extern "C" {}` and ERROR nodes, so a syntax error
 * high up does not hide the well-formed declarations under it. With `reparse`,
 * the text of an ERROR node is parsed again from the first line after the error
 * that starts at column 0, because tree-sitter's recovery can swallow whole
 * functions into the ERROR node.
 */
export function topLevelItems(root: Node, reparse?: Reparse): Node[] {
  const out: Node[] = [];
  let budget = MAX_REPARSES;
  const visit = (n: Node) => {
    for (const c of n.namedChildren) if (c) one(c);
  };
  const one = (c: Node) => {
    if (c.type === 'ERROR' && reparse && budget > 0 && recover(c)) return;
    if (PREPROC_BLOCKS.has(c.type) || c.type === 'ERROR' || c.type === 'linkage_specification') visit(c);
    else if (c.type === 'declaration_list') visit(c);
    else out.push(c);
  };
  const recover = (err: Node): boolean => {
    const lines = err.text.split('\n');
    const start = err.startPosition.row;
    const kids = err.namedChildren.filter((k): k is Node => !!k);
    for (let i = 1; i < lines.length; i++) {
      if (!/^[A-Za-z_]/.test(lines[i]!)) continue;
      const row = start + i;
      // A well-formed item the parser already recovered spans this line: keep it whole.
      if (kids.some((k) => ITEMS.has(k.type) && k.startPosition.row < row && k.endPosition.row >= row)) continue;
      budget--;
      const again = reparse!('\n'.repeat(row) + lines.slice(i).join('\n'));
      if (!again) return false;
      for (const k of kids) if (k.endPosition.row < row) one(k);
      visit(again);
      return true;
    }
    return false;
  };
  // When the error is high up, tree-sitter can make the whole file one ERROR root.
  if (root.type === 'ERROR') one(root);
  else visit(root);
  return out;
}

/** What a declarator says about the declared name. */
export interface DeclInfo {
  name: string;
  nameNode?: Node;
  /** Pointer stars on the declared object (or, for a function, on its result). */
  stars: number;
  /** Array sizes, outermost first: `int a[3][4]` gives ['3', '4']; `[]` gives ''. */
  arrays: string[];
  /** Present for functions and function pointers. */
  params?: Node;
  /** True for `(*name)(...)`: a pointer to a function, not a function. */
  fnPointer: boolean;
  /** `= value` of an init_declarator. */
  value?: Node;
  /** `int (*f(char c))(int)`: f returns a pointer to a function taking these parameters. */
  returnParams?: Node;
}

export function unwrapDeclarator(node: Node | null | undefined): DeclInfo {
  const out: DeclInfo = { name: '', stars: 0, arrays: [], fnPointer: false };
  let n: Node | null | undefined = node;
  let stars = 0;
  let sawFunction = false;
  let returnStars = 0;
  while (n) {
    switch (n.type) {
      case 'identifier':
      case 'field_identifier':
      case 'type_identifier':
      case 'primitive_type':
        out.name = n.text;
        out.nameNode = n;
        n = null;
        break;
      case 'pointer_declarator':
      case 'abstract_pointer_declarator':
        stars++;
        n = n.childForFieldName('declarator');
        break;
      case 'array_declarator':
      case 'abstract_array_declarator':
        out.arrays.unshift(n.childForFieldName('size')?.text ?? '');
        n = n.childForFieldName('declarator');
        break;
      case 'function_declarator':
      case 'abstract_function_declarator':
        // The innermost function declarator is the function itself; an outer one
        // describes what it returns (`int (*getop(char c))(int, int)`).
        if (sawFunction && stars > 0 && !out.returnParams) out.returnParams = out.params;
        sawFunction = true;
        out.params = n.childForFieldName('parameters') ?? undefined;
        returnStars = stars;
        stars = 0;
        n = n.childForFieldName('declarator');
        break;
      case 'parenthesized_declarator':
      case 'abstract_parenthesized_declarator':
        n = n.namedChildren.find((c) => c && c.type !== 'type_qualifier' && c.type !== 'ms_call_modifier') ?? null;
        break;
      case 'init_declarator':
        out.value = n.childForFieldName('value') ?? undefined;
        n = n.childForFieldName('declarator');
        break;
      case 'attributed_declarator':
        n = n.namedChildren.find((c) => c && c.type !== 'attribute_declaration') ?? null;
        break;
      default:
        n = null;
    }
  }
  if (sawFunction) {
    out.fnPointer = stars > 0;
    out.stars = returnStars;
  } else out.stars = stars;
  return out;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** `struct node`, `enum Kind`, `unsigned long`, `Tray`: the base type as written, without qualifiers. */
export function baseTypeText(type: Node | null | undefined): string {
  if (!type) return '';
  switch (type.type) {
    case 'struct_specifier':
    case 'union_specifier':
    case 'enum_specifier': {
      const kw = type.type.slice(0, type.type.indexOf('_'));
      const name = type.childForFieldName('name')?.text;
      // An anonymous nested type (`struct { int x; } pos;`) shows that it has a body.
      return name ? `${kw} ${name}` : type.childForFieldName('body') ? `${kw} {...}` : kw;
    }
    default:
      return squash(type.text);
  }
}

/** `const` / `volatile` written next to the type of a declaration (not inside its declarators). */
export function qualifiersOf(decl: Node): string[] {
  return decl.namedChildren.filter((c) => c?.type === 'type_qualifier').map((c) => c!.text);
}

/** Display form of a type: qualifiers, base, stars attached, arrays as a suffix (`const char*`, `Item[N]`). */
export function typeString(quals: string[], base: string, stars: number, arrays: string[] = []): string {
  const q = quals.length ? `${quals.join(' ')} ` : '';
  return `${q}${base}${'*'.repeat(stars)}${arrays.map((a) => `[${a}]`).join('')}`;
}

export interface Param {
  name: string;
  type?: string;
}

/** Parameters of a function or function pointer; `(void)` is an empty list. */
export function paramsOf(list: Node | undefined): Param[] {
  if (!list) return [];
  const out: Param[] = [];
  for (const p of list.namedChildren) {
    if (!p) continue;
    if (p.type === 'variadic_parameter') {
      out.push({ name: '...' });
      continue;
    }
    if (p.type !== 'parameter_declaration') continue;
    const typeNode = p.childForFieldName('type');
    const d = unwrapDeclarator(p.childForFieldName('declarator'));
    const base = baseTypeText(typeNode);
    if (!p.childForFieldName('declarator') && base === 'void' && list.namedChildren.length === 1) return [];
    const quals = qualifiersOf(p);
    const type = d.params
      ? `${typeString(quals, base, d.stars)}(*)(${paramsOf(d.params)
          .map((x) => x.type ?? x.name)
          .join(', ')})`
      : typeString(quals, base, d.stars, d.arrays);
    out.push({ name: d.name, type });
  }
  return out;
}

export function isStatic(decl: Node): boolean {
  return decl.namedChildren.some((c) => c?.type === 'storage_class_specifier' && c.text === 'static');
}

export function isTypedefLike(decl: Node): boolean {
  return decl.type === 'type_definition';
}

/** Every descendant of the given types, in source order. Iterative: deep `else if` chains do not overflow the stack. */
export function descendants(n: Node, types: ReadonlySet<string>): Node[] {
  const out: Node[] = [];
  const stack = n.namedChildren.filter((c): c is Node => !!c).reverse();
  while (stack.length) {
    const x = stack.pop()!;
    if (types.has(x.type)) out.push(x);
    const kids = x.namedChildren;
    for (let i = kids.length - 1; i >= 0; i--) if (kids[i]) stack.push(kids[i]!);
  }
  return out;
}

export const isHeader = (path: string) => /\.(h|hh|hpp|hxx)$/i.test(path);
