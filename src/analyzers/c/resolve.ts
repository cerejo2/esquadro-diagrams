// Follows typedef chains so that `Tray *`, `NodePtr` and `struct node *` all
// lead to the same entity with the right number of stars.
import type { Entity, Project, Typedef, TypeUse } from './collect';

export interface Resolved {
  entity?: Entity;
  /** The use names a function-pointer typedef (`HashFn`). */
  fnTypedef?: Typedef;
  stars: number;
  arrays: string[];
}

export function resolveUse(p: Project, use: TypeUse | undefined): Resolved {
  if (!use) return { stars: 0, arrays: [] };
  let stars = use.stars;
  const arrays = [...use.arrays];
  let key = use.key;
  for (let depth = 0; key && depth < 16; depth++) {
    if (!key.startsWith('typedef:')) return { entity: p.entities.get(key), stars, arrays };
    const td = p.typedefs.get(key.slice('typedef:'.length));
    if (!td) return { stars, arrays };
    if (td.fnPointer) return { fnTypedef: td, stars, arrays };
    stars += td.use.stars;
    arrays.push(...td.use.arrays);
    key = td.use.key;
  }
  return { stars, arrays };
}

/** Every name a C programmer uses for the entity: the typedefs and the tag. */
export function namesOf(e: Entity): string[] {
  const out = e.aliases.map((a) => a.name);
  if (e.tag) out.push(e.tag);
  return out;
}

/**
 * `TrayCreate`, `tray_size` and `Tray` start with the type name `Tray`; `hash_djb2`
 * does not start with `hashtable`, and `Items_count` does not start with `Item`
 * (the next letter must begin a new word). Leading underscores of tags are ignored.
 */
export function startsWithTypeName(fn: string, type: string): boolean {
  const t = type.replace(/^_+/, '');
  if (!t || fn.length < t.length) return false;
  if (fn.slice(0, t.length).toLowerCase() !== t.toLowerCase()) return false;
  const next = fn.charAt(t.length);
  return next === '' || next === '_' || /[0-9A-Z]/.test(next);
}
