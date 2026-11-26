// Name resolution (PROMPT.md §7.1): only project types become nodes. A simple
// name is looked up among type parameters, member types (own, enclosing and
// inherited), explicit imports, the file's package and `*` imports, in that
// order. Ambiguous names produce one diagnostic and resolve to nothing.
import type { Node } from 'web-tree-sitter';
import type { Diagnostic } from '../../model/types';
import { diagnostic, refOf } from '../shared/evidence';
import { scopedName } from './ast';
import type { JType } from './collect';

export class Resolver {
  readonly byQname = new Map<string, JType>();
  readonly diagnostics: Diagnostic[] = [];
  private readonly reported = new Set<string>();
  private readonly supers = new Map<JType, JType[]>();
  private readonly ancestorCache = new Map<JType, JType[]>();

  readonly types: readonly JType[];

  constructor(types: readonly JType[]) {
    this.types = types;
    for (const t of types) if (!this.byQname.has(t.qname)) this.byQname.set(t.qname, t);
  }

  /** Direct project supertypes (superclass first, then interfaces). */
  supertypes(t: JType): JType[] {
    let s = this.supers.get(t);
    if (s) return s;
    s = [];
    this.supers.set(t, s); // guards against cycles while resolving
    const nodes = [t.superclass, ...t.interfaces].filter((n): n is Node => !!n);
    for (const n of nodes) {
      const r = this.resolveTypeNode(n, t, [], true);
      if (r && r !== t) s.push(r);
    }
    return s;
  }

  /** True if `sub` is `sup` or inherits from it inside the project. Iterative: chains can be long. */
  isSubtype(sub: JType, sup: JType): boolean {
    return this.ancestors(sub).some((t) => t === sup);
  }

  /** `t` and its project supertypes, depth first (superclass before interfaces), each once. */
  ancestors(t: JType): JType[] {
    const cached = this.ancestorCache.get(t);
    if (cached) return cached;
    const out: JType[] = [];
    const seen = new Set<JType>();
    const stack = [t];
    while (stack.length) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      out.push(x);
      const s = this.supertypes(x);
      for (let i = s.length - 1; i >= 0; i--) stack.push(s[i]!);
    }
    this.ancestorCache.set(t, out);
    return out;
  }

  private memberType(scope: JType, name: string): JType | undefined {
    for (const s of this.ancestors(scope)) {
      const own = s.nested.find((n) => n.simple === name);
      if (own) return own;
    }
    return undefined;
  }

  /**
   * Resolves a simple name used inside `ctx`. `typeParams` are extra type
   * variables in scope (a generic method's). `forHeader` skips the context's
   * own member types, for `extends`/`implements` clauses.
   */
  resolveSimple(
    name: string,
    ctx: JType,
    typeParams: readonly string[] = [],
    ref?: Node,
    forHeader = false,
  ): JType | undefined {
    if (typeParams.includes(name)) return undefined;
    for (let s: JType | undefined = ctx; s; s = s.outer) {
      if (s.typeParams.includes(name)) return undefined;
      if (s.simple === name) return s;
      if (!(forHeader && s === ctx)) {
        const m = this.memberType(s, name);
        if (m) return m;
      }
    }
    const file = ctx.file;
    const imported = file.singleImports.get(name);
    if (imported) return this.byQname.get(imported);
    const local = this.byQname.get(file.pkg ? `${file.pkg}.${name}` : name);
    if (local) return local;
    const candidates = new Set<JType>();
    for (const p of file.onDemandImports) {
      const hit = this.byQname.get(`${p}.${name}`);
      if (hit) candidates.add(hit);
    }
    if (candidates.size === 1) return [...candidates][0];
    if (candidates.size > 1) {
      const key = `${file.path}:${name}`;
      if (!this.reported.has(key)) {
        this.reported.add(key);
        const list = [...candidates].map((c) => c.qname).join(', ');
        this.diagnostics.push(
          diagnostic('warn', `ambiguous type ${name} (${list}); not linked`, ref ? refOf(ref, file.path) : ctx.ref),
        );
      }
    }
    return undefined;
  }

  /** Resolves a dotted name: `Outer.Inner`, `a.b.Type` or `a.b.Outer.Inner`. */
  resolveDotted(
    text: string,
    ctx: JType,
    typeParams: readonly string[] = [],
    ref?: Node,
    forHeader = false,
  ): JType | undefined {
    const parts = text.split('.');
    if (parts.length === 1) return this.resolveSimple(text, ctx, typeParams, ref, forHeader);
    const head = /^\p{Lu}/u.test(parts[0]!)
      ? this.resolveSimple(parts[0]!, ctx, typeParams, ref, forHeader)
      : undefined;
    if (head) {
      let cur: JType | undefined = head;
      for (const p of parts.slice(1)) cur = cur?.nested.find((n) => n.simple === p);
      if (cur) return cur;
    }
    return this.byQname.get(text);
  }

  /**
   * The project type a type node names, ignoring type arguments and array
   * dimensions (`List<Item>` → List, which is usually not a project type).
   */
  resolveTypeNode(node: Node, ctx: JType, typeParams: readonly string[] = [], forHeader = false): JType | undefined {
    switch (node.type) {
      case 'type_identifier':
        return this.resolveSimple(node.text, ctx, typeParams, node, forHeader);
      case 'scoped_type_identifier':
        return this.resolveDotted(scopedName(node), ctx, typeParams, node, forHeader);
      case 'generic_type': {
        const base = node.namedChildren.find((c) => c.type !== 'type_arguments');
        return base ? this.resolveTypeNode(base, ctx, typeParams, forHeader) : undefined;
      }
      case 'annotated_type': {
        const inner = node.namedChildren.filter((c) => c.type !== 'annotation' && c.type !== 'marker_annotation');
        const last = inner[inner.length - 1];
        return last ? this.resolveTypeNode(last, ctx, typeParams, forHeader) : undefined;
      }
      default:
        return undefined;
    }
  }
}
