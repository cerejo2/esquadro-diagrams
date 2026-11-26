// Text forms of members, shared by the renderer, the exporters and the bench.
import type { Member } from './types';

/** `+ name: Type` (attribute) in Visual Paradigm style. */
export function formatAttribute(m: Member): string {
  const vis = m.visibility ? `${m.visibility} ` : '';
  return m.type ? `${vis}${m.name}: ${m.type}` : `${vis}${m.name}`;
}

/** `+ name(p: Type, q: Type): Return`; constructors have no return type. */
export function formatOperation(m: Member): string {
  const vis = m.visibility ? `${m.visibility} ` : '';
  const params = (m.params ?? []).map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(', ');
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
