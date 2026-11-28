// Text forms of members, shared by the renderer, the exporters and the bench.
import type { Member } from './types';

/** `+ name: Type = initial {readOnly}` (attribute) in Visual Paradigm style; final fields are {readOnly}. */
export function formatAttribute(m: Member): string {
  const vis = m.visibility ? `${m.visibility} ` : '';
  const type = m.type ? `: ${m.type}` : '';
  const initial = m.initial !== undefined ? ` = ${m.initial}` : '';
  const readOnly = m.flags?.includes('final') ? ' {readOnly}' : '';
  return `${vis}${m.name}${type}${initial}${readOnly}`;
}

/** `+ name(p: Type, q: Type): Return`; constructors have no return type. */
export function formatOperation(m: Member): string {
  const vis = m.visibility ? `${m.visibility} ` : '';
  const params = (m.params ?? []).map((p) => (p.type ? (p.name ? `${p.name}: ${p.type}` : p.type) : p.name)).join(', ');
  const isCtor = m.flags?.includes('ctor');
  const ret = !isCtor && m.returns ? `: ${m.returns}` : '';
  return `${vis}${m.name}(${params})${ret}`;
}

/** Whitespace-insensitive form used to compare member strings. */
export function normalizeMember(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),:<>[\]])\s*/g, '$1')
    .replace(/,/g, ', ')
    .replace(/:/g, ': ')
    .replace(/^([+\-#~])\s*/, '$1 ')
    .trim();
}
