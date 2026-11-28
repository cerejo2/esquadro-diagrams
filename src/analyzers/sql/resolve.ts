// Links every foreign key to the table it references and pairs its columns
// with the referenced ones (the referenced table's PK when the DDL names none).
import type { Diagnostic } from '../../model/types';
import { diagnostic } from '../shared/evidence';
import { type ForeignKey, type Table, type View, findColumn, findNamed, keyOf, sameSet } from './schema';

export interface ResolvedFk {
  fk: ForeignKey;
  from: Table;
  to: Table;
  /** [FK column, referenced column] in declaration order, with the tables' own spelling. */
  pairs: [string, string | undefined][];
  /** Every FK column is NOT NULL (or part of the PK, which implies it). */
  notNull: boolean;
  /** The FK columns are the PK or a UNIQUE set of their table: at most one row per referenced row. */
  unique: boolean;
}

export interface ResolvedSchema {
  tables: Table[];
  views: View[];
  fks: ResolvedFk[];
  /** FKs of each table. */
  fksOf: Map<Table, ResolvedFk[]>;
  diagnostics: Diagnostic[];
}

export const isPkColumn = (t: Table, col: string) => t.pk.some((p) => keyOf(p) === keyOf(col));

export function isUniqueSet(t: Table, cols: readonly string[]): boolean {
  return sameSet(cols, t.pk) || t.uniques.some((u) => sameSet(u, cols));
}

export function resolveSchema(tables: Table[], views: View[]): ResolvedSchema {
  const diagnostics: Diagnostic[] = [];
  // Canonical spelling for PK and UNIQUE columns.
  for (const t of tables) {
    const canon = (cols: string[]) => cols.map((c) => findColumn(t, c)?.name ?? c);
    for (const c of t.pk)
      if (!findColumn(t, c))
        diagnostics.push(
          diagnostic('warn', `primary key column ${t.name}.${c} is not a column of ${t.name}`, t.pkRef ?? t.ref),
        );
    t.pk = canon(t.pk);
    t.uniques = t.uniques.map(canon);
  }

  const fks: ResolvedFk[] = [];
  const fksOf = new Map<Table, ResolvedFk[]>();
  for (const from of tables) {
    const list: ResolvedFk[] = [];
    for (const fk of from.fks) {
      const to = findNamed(tables, { name: fk.refTable, schema: fk.refSchema }, from.schema);
      const where = `${from.name}(${fk.columns.join(', ')})`;
      if (!to) {
        diagnostics.push(
          diagnostic('warn', `foreign key ${where} references ${fk.refTable}, which is not defined; not drawn`, fk.ref),
        );
        continue;
      }
      const cols = fk.columns.map((c) => {
        const col = findColumn(from, c);
        if (!col)
          diagnostics.push(
            diagnostic('warn', `foreign key column ${from.name}.${c} is not a column of ${from.name}`, fk.ref),
          );
        return col?.name ?? c;
      });
      let refCols: (string | undefined)[] = fk.refColumns.map((c) => {
        const col = findColumn(to, c);
        if (!col)
          diagnostics.push(
            diagnostic(
              'warn',
              `foreign key ${where} references ${to.name}.${c}, which is not a column of ${to.name}`,
              fk.ref,
            ),
          );
        return col?.name ?? c;
      });
      if (!refCols.length) {
        if (!to.pk.length)
          diagnostics.push(
            diagnostic('warn', `foreign key ${where} references ${to.name}, which has no primary key`, fk.ref),
          );
        refCols = to.pk.length ? [...to.pk] : cols.map(() => undefined);
      }
      if (refCols.length !== cols.length)
        diagnostics.push(
          diagnostic(
            'warn',
            `foreign key ${where} has ${cols.length} columns but references ${refCols.length}`,
            fk.ref,
          ),
        );
      const pairs: [string, string | undefined][] = cols.map((c, i) => [c, refCols[i]]);
      // The same FK declared twice (inline REFERENCES and a FOREIGN KEY, or CREATE and ALTER) is drawn once.
      const sig = (p: readonly [string, string | undefined][]) =>
        p.map(([a, b]) => `${keyOf(a)}>${keyOf(b ?? '')}`).join(',');
      const twin = list.find((r) => r.to === to && sig(r.pairs) === sig(pairs));
      if (twin) {
        if (!twin.fk.name && fk.name) twin.fk.name = fk.name;
        diagnostics.push(
          diagnostic('info', `foreign key ${where} → ${to.name} is declared more than once; drawn once`, fk.ref),
        );
        continue;
      }
      const notNull = cols.every((c) => findColumn(from, c)?.notNull || isPkColumn(from, c));
      const r: ResolvedFk = { fk: { ...fk, columns: cols }, from, to, pairs, notNull, unique: isUniqueSet(from, cols) };
      list.push(r);
      fks.push(r);
    }
    fksOf.set(from, list);
  }
  return { tables, views, fks, fksOf, diagnostics };
}

/** Columns (lower case) that belong to at least one of its resolved FKs. */
export function fkColumns(fks: readonly ResolvedFk[]): Set<string> {
  return new Set(fks.flatMap((f) => f.fk.columns.map(keyOf)));
}
