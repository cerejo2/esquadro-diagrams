// Stable ids. The same input must always produce the same ids, because the
// editor stores node positions by id and the bench compares runs.
import type { EdgeKind, NodeKind } from '../../model/types';

/** `${kind}:${qualifiedName}`, as required by the contract. */
export function nodeId(kind: NodeKind, qualifiedName: string): string {
  return `${kind}:${qualifiedName}`;
}

/** `${kind}:${from}->${to}`, plus a discriminator (role, column) when two edges share the ends. */
export function edgeId(kind: EdgeKind, from: string, to: string, discriminator?: string): string {
  const base = `${kind}:${from}->${to}`;
  return discriminator ? `${base}#${discriminator}` : base;
}

/**
 * Hands out ids that are unique within one model: the first use of a base id is
 * returned as is, later uses get `~2`, `~3`... Deterministic as long as items
 * are visited in a deterministic order (sort files by path first).
 */
export class IdPool {
  private readonly seen = new Map<string, number>();

  take(base: string): string {
    const n = (this.seen.get(base) ?? 0) + 1;
    this.seen.set(base, n);
    return n === 1 ? base : `${base}~${n}`;
  }
}

/** Sorts files by path so that analysis order, and therefore ids, never depend on input order. */
export function byPath<T extends { path: string }>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
