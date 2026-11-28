// The intermediate model every SQL diagram is built from (PROMPT.md §7.4):
// tables, columns, primary keys, foreign keys, UNIQUE sets and NOT NULL.
import type { SourceRef } from '../../model/types';

export interface Column {
  name: string;
  /** Type as written, simplified for display: `DECIMAL(10,2)`, `INT UNSIGNED`. Undefined when the DDL has none. */
  type?: string;
  notNull: boolean;
  identity: boolean;
  ref: SourceRef;
}

/** How a foreign key was declared, for the evidence. */
export type FkOrigin = 'column' | 'table' | 'alter';

export interface ForeignKey {
  /** Constraint name, when the DDL gives one. */
  name?: string;
  columns: string[];
  /** Referenced table as written (last part of the qualified name). */
  refTable: string;
  /** Schema of the referenced table, when the DDL qualifies it. */
  refSchema?: string;
  /** Referenced columns; empty means "the referenced table's primary key". */
  refColumns: string[];
  origin: FkOrigin;
  ref: SourceRef;
}

export interface Table {
  name: string;
  schema?: string;
  columns: Column[];
  pk: string[];
  pkRef?: SourceRef;
  uniques: string[][];
  fks: ForeignKey[];
  ref: SourceRef;
}

export interface ViewDep {
  name: string;
  schema?: string;
  ref: SourceRef;
}

export interface View {
  name: string;
  schema?: string;
  deps: ViewDep[];
  ref: SourceRef;
}

/** Case-insensitive key for tables, views and columns. */
export const keyOf = (name: string) => name.toLowerCase();

interface Named {
  name: string;
  schema?: string;
}

/**
 * Two declarations name the same object when the names match and the schemas
 * match, or when either has no schema (`T` and `dbo.T` are the same table;
 * `vendas.T` and `rh.T` are not).
 */
export const sameObject = (a: Named, b: Named) =>
  keyOf(a.name) === keyOf(b.name) && (!a.schema || !b.schema || keyOf(a.schema) === keyOf(b.schema));

/**
 * The object a reference (`REFERENCES s.T`, `FROM T`, `ALTER TABLE T`) points at.
 * An exact schema match wins; an unqualified reference that matches several
 * objects prefers the referrer's schema, then one declared without a schema,
 * then the first one declared.
 */
export function findNamed<T extends Named>(items: readonly T[], ref: Named, context?: string): T | undefined {
  const cands = items.filter((t) => sameObject(t, ref));
  if (cands.length <= 1) return cands[0];
  const inSchema = (s: string | undefined) =>
    s ? cands.find((t) => t.schema && keyOf(t.schema) === keyOf(s)) : undefined;
  return inSchema(ref.schema) ?? inSchema(context) ?? cands.find((t) => !t.schema) ?? cands[0];
}

export function findColumn(t: Table, name: string): Column | undefined {
  const k = keyOf(name);
  return t.columns.find((c) => keyOf(c.name) === k);
}

export const sameSet = (a: readonly string[], b: readonly string[]) => {
  if (a.length === 0 || a.length !== b.length) return false;
  const s = new Set(b.map(keyOf));
  return a.every((x) => s.has(keyOf(x)));
};

export const subsetOf = (a: readonly string[], b: readonly string[]) => {
  const s = new Set(b.map(keyOf));
  return a.length > 0 && a.every((x) => s.has(keyOf(x)));
};
