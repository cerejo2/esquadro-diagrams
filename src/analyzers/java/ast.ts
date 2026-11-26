// Small helpers over tree-sitter-java nodes: modifiers, type text and walks.
import type { Node } from 'web-tree-sitter';

export const TYPE_DECLS = new Set([
  'class_declaration',
  'interface_declaration',
  'enum_declaration',
  'record_declaration',
]);

export interface Modifiers {
  visibility?: '+' | '-' | '#';
  isStatic: boolean;
  isAbstract: boolean;
  isFinal: boolean;
  isDefault: boolean;
  override: boolean;
}

/** Reads the `modifiers` child of a declaration (keywords and annotations). */
export function modifiersOf(decl: Node): Modifiers {
  const out: Modifiers = { isStatic: false, isAbstract: false, isFinal: false, isDefault: false, override: false };
  const mods = decl.namedChildren.find((c) => c.type === 'modifiers');
  if (!mods) return out;
  for (const c of mods.children) {
    switch (c.type) {
      case 'public':
        out.visibility = '+';
        break;
      case 'private':
        out.visibility = '-';
        break;
      case 'protected':
        out.visibility = '#';
        break;
      case 'static':
        out.isStatic = true;
        break;
      case 'abstract':
        out.isAbstract = true;
        break;
      case 'final':
        out.isFinal = true;
        break;
      case 'default':
        out.isDefault = true;
        break;
      case 'marker_annotation':
      case 'annotation': {
        const name = c.childForFieldName('name')?.text ?? '';
        if (name === 'Override' || name.endsWith('.Override')) out.override = true;
        break;
      }
    }
  }
  return out;
}

/** Drops leading package segments: `java.util.List` → `List`, but `Map.Entry` stays. */
export function simplifyQualified(text: string): string {
  const parts = text.split('.').map((p) => p.trim());
  let i = 0;
  while (i < parts.length - 1 && /^[\p{Ll}_$]/u.test(parts[i]!)) i++;
  return parts.slice(i).join('.');
}

/** Display form of a type node, without packages or annotations: `Map<String, List<Item>>`, `int[]`. */
export function typeText(node: Node | null | undefined): string {
  if (!node) return '';
  switch (node.type) {
    case 'type_identifier':
      return node.text;
    case 'scoped_type_identifier':
      return simplifyQualified(
        node.namedChildren
          .filter(
            (c) => c.type === 'type_identifier' || c.type === 'scoped_type_identifier' || c.type === 'generic_type',
          )
          .map((c) => (c.type === 'type_identifier' ? c.text : c.type === 'generic_type' ? typeText(c) : scopedName(c)))
          .join('.'),
      );
    case 'generic_type': {
      const base = node.namedChildren.find((c) => c.type !== 'type_arguments');
      const args = node.namedChildren.find((c) => c.type === 'type_arguments');
      return `${typeText(base)}<${typeArgs(args)
        .map((a) => typeText(a))
        .join(', ')}>`;
    }
    case 'array_type': {
      const dims = node.childForFieldName('dimensions');
      return typeText(node.childForFieldName('element')) + dimsText(dims);
    }
    case 'wildcard': {
      const bound = node.namedChildren.find(
        (c) => c.type !== 'annotation' && c.type !== 'marker_annotation' && c.type !== 'super' && !isComment(c),
      );
      if (!bound) return '?';
      const kw = node.children.some((c) => c.type === 'super') ? 'super' : 'extends';
      return `? ${kw} ${typeText(bound)}`;
    }
    case 'annotated_type': {
      const inner = node.namedChildren.filter((c) => c.type !== 'annotation' && c.type !== 'marker_annotation');
      return typeText(inner[inner.length - 1]);
    }
    default:
      return node.text.replace(/\s+/g, ' ').trim();
  }
}

/** `a.b.C` for a scoped_type_identifier, without spaces or annotations. */
export function scopedName(node: Node): string {
  if (node.type === 'type_identifier' || node.type === 'identifier') return node.text;
  // `Outer<String>.Inner`: the outer part names its base type.
  if (node.type === 'generic_type') {
    const base = node.namedChildren.find((c) => c.type !== 'type_arguments');
    return base ? scopedName(base) : '';
  }
  return node.namedChildren
    .filter(
      (c) =>
        c.type === 'type_identifier' ||
        c.type === 'scoped_type_identifier' ||
        c.type === 'identifier' ||
        c.type === 'scoped_identifier' ||
        c.type === 'generic_type',
    )
    .map((c) => scopedName(c))
    .join('.');
}

/** Named type arguments of a `type_arguments` node (empty for the diamond `<>`). */
export function typeArgs(args: Node | null | undefined): Node[] {
  if (!args) return [];
  return args.namedChildren.filter((c) => c.type !== 'annotation' && c.type !== 'marker_annotation' && !isComment(c));
}

/** Comments are tree-sitter extras: they can sit between any two tokens, including inside types. */
export const isComment = (n: Node): boolean => n.type === 'line_comment' || n.type === 'block_comment';

/** `[]` per dimension of a `dimensions` node. */
export function dimsText(dims: Node | null | undefined): string {
  if (!dims) return '';
  return '[]'.repeat(dims.children.filter((c) => c.type === '[').length);
}

/** Pre-order walk that does not enter the subtrees `skip` rejects. */
export function walk(node: Node, visit: (n: Node) => void, skip?: (n: Node) => boolean): void {
  const stack: Node[] = [node];
  while (stack.length) {
    const n = stack.pop()!;
    if (n !== node && skip?.(n)) continue;
    visit(n);
    const kids = n.namedChildren;
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
}

/** True for a type declaration nested inside `owner` (it belongs to its own node). */
export const isTypeDecl = (n: Node): boolean => TYPE_DECLS.has(n.type) || n.type === 'annotation_type_declaration';

/** First line of a node's text, trimmed to a readable length, for evidence notes. */
export function snippet(node: Node, max = 80): string {
  const line = node.text.split(/\r?\n/)[0]!.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Strips parentheses: `((x))` → `x`. */
export function unparen(node: Node | null | undefined): Node | null {
  let n = node ?? null;
  while (n && n.type === 'parenthesized_expression') n = n.namedChildren[0] ?? null;
  return n;
}
