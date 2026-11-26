// Members in UML form (PROMPT.md §7.1) and what a person leaves out (§5.3).
import type { Node } from 'web-tree-sitter';
import type { AnalyzeOptions } from '../types';
import type { Member, MemberFlag } from '../../model/types';
import { unparen } from './ast';
import type { JField, JMethod, JType } from './collect';

/** The options this analyzer reads. */
export type JavaOptions = Pick<AnalyzeOptions, 'showAccessors' | 'showDependencies' | 'showMain' | 'showObjectMethods'>;

/** The field a `return f;` / `return this.f;` or `f = …` / `this.f = …` names, if it is one of `t`'s. */
function fieldRef(expr: Node | null, t: JType): JField | undefined {
  const e = unparen(expr);
  if (!e) return undefined;
  let name: string | undefined;
  if (e.type === 'identifier') name = e.text;
  else if (e.type === 'field_access' && e.childForFieldName('object')?.type === 'this')
    name = e.childForFieldName('field')?.text;
  return name ? t.fields.find((f) => f.name === name && !f.enumConstant) : undefined;
}

function onlyStatement(body: Node | null): Node | undefined {
  if (!body) return undefined;
  const stmts = body.namedChildren.filter((c) => c.type !== 'line_comment' && c.type !== 'block_comment');
  return stmts.length === 1 ? stmts[0] : undefined;
}

/** `getX()`/`isX()` whose body only returns one of the class's fields. */
export function isGetter(m: JMethod, t: JType): boolean {
  if (m.ctor || m.params.length || !/^(get|is)[\p{Lu}0-9_]/u.test(m.name)) return false;
  const s = onlyStatement(m.body);
  if (s?.type !== 'return_statement') return false;
  return !!fieldRef(s.namedChildren[0] ?? null, t);
}

/** `setX(p)` whose body only stores `p` in one of the class's fields. */
export function isSetter(m: JMethod, t: JType): boolean {
  if (m.ctor || m.params.length !== 1 || !/^set[\p{Lu}0-9_]/u.test(m.name)) return false;
  const s = onlyStatement(m.body);
  if (s?.type !== 'expression_statement') return false;
  const a = s.namedChildren[0];
  if (a?.type !== 'assignment_expression' || a.childForFieldName('operator')?.text !== '=') return false;
  const right = unparen(a.childForFieldName('right'));
  return !!fieldRef(a.childForFieldName('left'), t) && right?.type === 'identifier' && right.text === m.params[0]!.name;
}

export function isMain(m: JMethod): boolean {
  return (
    !m.ctor &&
    m.name === 'main' &&
    m.mods.isStatic &&
    m.returns === 'void' &&
    m.params.length === 1 &&
    /^String(\[\]|\.\.\.)$/.test(m.params[0]!.type)
  );
}

export function isObjectMethod(m: JMethod): boolean {
  if (m.ctor) return false;
  if (m.name === 'toString' || m.name === 'hashCode') return m.params.length === 0;
  return m.name === 'equals' && m.params.length === 1 && m.params[0]!.type === 'Object';
}

export function attributeOf(f: JField): Member {
  if (f.enumConstant) return { name: f.name, ref: f.ref };
  const flags: MemberFlag[] = [];
  if (f.mods.isStatic) flags.push('static');
  if (f.mods.isFinal) flags.push('final');
  const m: Member = { name: f.name, type: f.type, visibility: f.visibility, ref: f.ref };
  if (flags.length) m.flags = flags;
  return m;
}

export function operationOf(m: JMethod, t: JType): Member {
  const flags: MemberFlag[] = [];
  if (m.ctor) flags.push('ctor');
  if (m.mods.isStatic) flags.push('static');
  if (m.abstract) flags.push('abstract');
  if (m.mods.isFinal) flags.push('final');
  if (m.mods.override) flags.push('override');
  if (isGetter(m, t)) flags.push('getter');
  if (isSetter(m, t)) flags.push('setter');
  if (isMain(m)) flags.push('main');
  const out: Member = {
    name: m.ctor ? t.simple : m.name,
    visibility: m.visibility,
    params: m.params.map((p) => ({ name: p.name, type: p.type })),
    ref: m.ref,
  };
  if (!m.ctor && m.returns) out.returns = m.returns;
  if (flags.length) out.flags = flags;
  return out;
}

/** True when the operation is hidden by default and its filter is off. */
export function hiddenOperation(op: Member, m: JMethod, opts: JavaOptions): boolean {
  const f = op.flags ?? [];
  if (!opts.showAccessors && (f.includes('getter') || f.includes('setter'))) return true;
  if (!opts.showMain && f.includes('main')) return true;
  if (!opts.showObjectMethods && isObjectMethod(m)) return true;
  return false;
}

/**
 * A launcher: a top-level class whose only job is `main` (no instance state,
 * only static methods, no supertypes, no member types). Diagrams in the
 * reference material leave these out.
 */
export function isLauncher(t: JType): boolean {
  if (t.decl !== 'class' || t.outer || t.mods.isAbstract || t.nested.length) return false;
  if (t.superclass || t.interfaces.length) return false;
  if (t.fields.some((f) => !f.mods.isStatic)) return false;
  if (!t.methods.some(isMain)) return false;
  return t.methods.every((m) => (m.ctor ? m.visibility === '-' : m.mods.isStatic));
}
