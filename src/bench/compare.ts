// Scores a DiagramModel against an expected.yaml (PROMPT.md §6.4).
//
// - nodes: matched by (name, kind);
// - strict edges: by (kind, from, to);
// - relaxed edges: association, aggregation and composition count as one
//   family, and the family ignores direction (a reciprocal association may be
//   drawn either way);
// - plain associations ignore direction in the strict score too;
// - roles, multiplicities and SQL columns: accuracy over the relaxed matches;
// - members: attribute and operation strings, whitespace-insensitive, only for
//   nodes whose expected entry lists them;
// - counts: sum(min) / sum(max) over the kinds listed;
// - calls (bash.flowchart): longest common subsequence of the call sequence.
import { ASSOCIATION_FAMILY, langOfKind } from '../model/kinds';
import { formatAttribute, formatOperation, normalizeMember } from '../model/format';
import type { DiagramEdge, DiagramModel, DiagramNode, EdgeKind } from '../model/types';
import type { Expected, ExpectedEdge } from './expected';

export interface Score {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface Accuracy {
  correct: number;
  total: number;
  accuracy: number;
}

export interface CaseScore {
  nodes?: Score;
  edgesStrict?: Score;
  edgesRelaxed?: Score;
  roles?: Accuracy;
  multiplicities?: Accuracy;
  columns?: Accuracy;
  members?: Score;
  counts?: Accuracy;
  calls?: Score;
  /** Human-readable differences, for test failure messages and the bench's --verbose. */
  misses: string[];
}

export function score(tp: number, fp: number, fn: number): Score {
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1 };
}

export function accuracy(correct: number, total: number): Accuracy {
  return { correct, total, accuracy: total === 0 ? 1 : correct / total };
}

/** Sums tp/fp/fn (micro-average) across cases. */
export function sumScores(scores: readonly (Score | undefined)[]): Score | undefined {
  const present = scores.filter((s): s is Score => !!s);
  if (!present.length) return undefined;
  const t = present.reduce((a, s) => ({ tp: a.tp + s.tp, fp: a.fp + s.fp, fn: a.fn + s.fn }), { tp: 0, fp: 0, fn: 0 });
  return score(t.tp, t.fp, t.fn);
}

export function sumAccuracies(list: readonly (Accuracy | undefined)[]): Accuracy | undefined {
  const present = list.filter((s): s is Accuracy => !!s);
  if (!present.length) return undefined;
  return accuracy(
    present.reduce((a, s) => a + s.correct, 0),
    present.reduce((a, s) => a + s.total, 0),
  );
}

/** Multiset intersection of two key lists. */
function matchKeys(expected: string[], actual: string[]): { tp: number; missing: string[]; extra: string[] } {
  const pool = new Map<string, number>();
  for (const k of actual) pool.set(k, (pool.get(k) ?? 0) + 1);
  const missing: string[] = [];
  let tp = 0;
  for (const k of expected) {
    const n = pool.get(k) ?? 0;
    if (n > 0) {
      tp++;
      pool.set(k, n - 1);
    } else missing.push(k);
  }
  const extra = [...pool].flatMap(([k, n]) => Array<string>(n).fill(k));
  return { tp, missing, extra };
}

interface FlatEdge {
  kind: EdgeKind;
  from: string;
  to: string;
  role?: string;
  multiplicity?: string;
  fromRole?: string;
  fromMultiplicity?: string;
  fromColumn?: string;
  toColumn?: string;
}

function flattenModelEdge(e: DiagramEdge, nameOf: (id: string) => string): FlatEdge {
  return {
    kind: e.kind,
    from: nameOf(e.from.node),
    to: nameOf(e.to.node),
    role: e.to.role,
    multiplicity: e.to.multiplicity,
    fromRole: e.from.role,
    fromMultiplicity: e.from.multiplicity,
    fromColumn: e.from.column,
    toColumn: e.to.column,
  };
}

/** Same edge seen from the other end. */
function flip(e: FlatEdge): FlatEdge {
  return {
    kind: e.kind,
    from: e.to,
    to: e.from,
    role: e.fromRole,
    multiplicity: e.fromMultiplicity,
    fromRole: e.role,
    fromMultiplicity: e.multiplicity,
    fromColumn: e.toColumn,
    toColumn: e.fromColumn,
  };
}

const pair = (a: string, b: string) => (a <= b ? `${a}|${b}` : `${b}|${a}`);

function strictKey(e: FlatEdge): string {
  return e.kind === 'association' ? `association:${pair(e.from, e.to)}` : `${e.kind}:${e.from}->${e.to}`;
}

function relaxedKey(e: FlatEdge): string {
  return ASSOCIATION_FAMILY.has(e.kind) ? `assoc-family:${pair(e.from, e.to)}` : `${e.kind}:${e.from}->${e.to}`;
}

/** Longest common subsequence length. */
function lcs(a: readonly string[], b: readonly string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (const x of a) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = x === b[j - 1] ? prev + 1 : Math.max(row[j]!, row[j - 1]!);
      prev = tmp;
    }
  }
  return row[b.length]!;
}

export function compareModel(model: DiagramModel, expected: Expected): CaseScore {
  const misses: string[] = [];
  const out: CaseScore = { misses };
  // SQL identifiers are case-insensitive; elsewhere names must match exactly.
  const fold = langOfKind(expected.kind) === 'sql' ? (s: string) => s.toLowerCase() : (s: string) => s;
  const byId = new Map<string, DiagramNode>(model.nodes.map((n) => [n.id, n]));
  const nameOf = (id: string) => fold(byId.get(id)?.name ?? id);

  if (expected.nodes) {
    const exp = expected.nodes.map((n) => `${n.kind}:${fold(n.name)}`);
    const act = model.nodes.map((n) => `${n.kind}:${fold(n.name)}`);
    const m = matchKeys(exp, act);
    out.nodes = score(m.tp, m.extra.length, m.missing.length);
    for (const k of m.missing) misses.push(`missing node ${k}`);
    for (const k of m.extra) misses.push(`extra node ${k}`);

    // Members, for nodes found by name whose expected entry lists them.
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let any = false;
    for (const en of expected.nodes) {
      const node = model.nodes.find((n) => fold(n.name) === fold(en.name));
      if (!node) continue;
      const groups: [string[] | undefined, string[]][] = [
        [en.attributes, (node.attributes ?? []).map(formatAttribute)],
        [en.operations, (node.operations ?? []).map(formatOperation)],
      ];
      for (const [want, got] of groups) {
        if (!want) continue;
        any = true;
        const mm = matchKeys(want.map(normalizeMember), got.map(normalizeMember));
        tp += mm.tp;
        fp += mm.extra.length;
        fn += mm.missing.length;
        for (const k of mm.missing) misses.push(`${en.name}: missing member "${k}"`);
        for (const k of mm.extra) misses.push(`${en.name}: extra member "${k}"`);
      }
    }
    if (any) out.members = score(tp, fp, fn);
  }

  if (expected.edges) {
    const exp: FlatEdge[] = expected.edges.map((e: ExpectedEdge) => ({ ...e, from: fold(e.from), to: fold(e.to) }));
    const act = model.edges.map((e) => flattenModelEdge(e, nameOf));

    const strict = matchKeys(exp.map(strictKey), act.map(strictKey));
    out.edgesStrict = score(strict.tp, strict.extra.length, strict.missing.length);
    for (const k of strict.missing) misses.push(`missing edge ${k}`);
    for (const k of strict.extra) misses.push(`extra edge ${k}`);

    const relaxed = matchKeys(exp.map(relaxedKey), act.map(relaxedKey));
    out.edgesRelaxed = score(relaxed.tp, relaxed.extra.length, relaxed.missing.length);

    // Pair each expected edge with an unused actual edge of the same relaxed
    // key, preferring the one whose details agree, then score the details.
    const used = new Set<number>();
    const roles = { c: 0, t: 0 };
    const mults = { c: 0, t: 0 };
    const cols = { c: 0, t: 0 };
    for (const e of exp) {
      const key = relaxedKey(e);
      let best: { i: number; edge: FlatEdge; agree: number } | undefined;
      act.forEach((a, i) => {
        if (used.has(i) || relaxedKey(a) !== key) return;
        const oriented = a.from === e.from && a.to === e.to ? a : flip(a);
        const agree =
          Number(oriented.role === e.role) +
          Number(oriented.multiplicity === e.multiplicity) +
          Number(oriented.toColumn === e.toColumn);
        if (!best || agree > best.agree) best = { i, edge: oriented, agree };
      });
      if (!best) continue;
      used.add(best.i);
      const got = best.edge;
      const check = (
        want: string | undefined,
        have: string | undefined,
        acc: { c: number; t: number },
        what: string,
      ) => {
        if (want === undefined) return;
        acc.t++;
        if (fold(want) === fold(have ?? '')) acc.c++;
        else misses.push(`${e.kind} ${e.from}->${e.to}: ${what} "${want}" but got "${have ?? ''}"`);
      };
      check(e.role, got.role, roles, 'role');
      check(e.fromRole, got.fromRole, roles, 'from role');
      check(e.multiplicity, got.multiplicity, mults, 'multiplicity');
      check(e.fromMultiplicity, got.fromMultiplicity, mults, 'from multiplicity');
      check(e.fromColumn, got.fromColumn, cols, 'from column');
      check(e.toColumn, got.toColumn, cols, 'to column');
    }
    if (roles.t) out.roles = accuracy(roles.c, roles.t);
    if (mults.t) out.multiplicities = accuracy(mults.c, mults.t);
    if (cols.t) out.columns = accuracy(cols.c, cols.t);
  }

  if (expected.counts) {
    let min = 0;
    let max = 0;
    const tally = <K extends string>(
      want: Partial<Record<K, number>> | undefined,
      items: { kind: K }[],
      what: string,
    ) => {
      if (!want) return;
      for (const [kind, n] of Object.entries(want) as [K, number][]) {
        const got = items.filter((x) => x.kind === kind).length;
        min += Math.min(n, got);
        max += Math.max(n, got);
        if (n !== got) misses.push(`count of ${what} ${kind}: expected ${n}, got ${got}`);
      }
    };
    tally(expected.counts.nodes, model.nodes, 'nodes');
    tally(expected.counts.edges, model.edges, 'edges');
    out.counts = accuracy(min, max);
  }

  if (expected.calls) {
    const got = model.nodes
      .filter((n) => n.kind === 'subroutine')
      .sort((a, b) => (a.ref?.line ?? 0) - (b.ref?.line ?? 0) || (a.id < b.id ? -1 : 1))
      .map((n) => n.name);
    const common = lcs(expected.calls, got);
    out.calls = score(common, got.length - common, expected.calls.length - common);
    if (common < expected.calls.length)
      misses.push(`calls: expected [${expected.calls.join(', ')}], got [${got.join(', ')}]`);
  }

  return out;
}
