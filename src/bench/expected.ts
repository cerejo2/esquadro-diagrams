// The expected.yaml format (docs/fixtures.md) and its validator. Pure: no fs,
// so it can run in tests, in scripts and, later, in the browser.
import { parse } from 'yaml';
import type { AnalyzeOptions } from '../analyzers/types';
import { DIAGRAM_KINDS, EDGE_KINDS, NODE_KINDS } from '../model/kinds';
import type { DiagramKind, EdgeKind, NodeKind } from '../model/types';

export type ExpectedSource = 'diagram' | 'self-made' | 'original';

export interface ExpectedNode {
  name: string;
  kind: NodeKind;
  stereotypes?: string[];
  attributes?: string[];
  operations?: string[];
}

export interface ExpectedEdge {
  kind: EdgeKind;
  from: string;
  to: string;
  /** Role and multiplicity at the `to` end (the end the arrow points to). */
  role?: string;
  multiplicity?: string;
  /** Role and multiplicity at the `from` end, when the reference shows them. */
  fromRole?: string;
  fromMultiplicity?: string;
  /** SQL: FK cell and referenced PK cell. */
  fromColumn?: string;
  toColumn?: string;
  /** Chen: total participation on the `from` side. */
  total?: boolean;
  label?: string;
}

export interface ExpectedCounts {
  nodes?: Partial<Record<NodeKind, number>>;
  edges?: Partial<Record<EdgeKind, number>>;
}

export interface Expected {
  kind: DiagramKind;
  source: ExpectedSource;
  options?: AnalyzeOptions;
  nodes?: ExpectedNode[];
  edges?: ExpectedEdge[];
  counts?: ExpectedCounts;
  /** bash.flowchart: the sequence of calls to project functions, top to bottom. */
  calls?: string[];
  notes?: string;
}

export type Validation = { ok: true; value: Expected; warnings: string[] } | { ok: false; errors: string[] };

const SOURCES: readonly string[] = ['diagram', 'self-made', 'original'];
const TOP_KEYS = new Set(['kind', 'source', 'options', 'nodes', 'edges', 'counts', 'calls', 'notes']);
const NODE_KEYS = new Set(['name', 'kind', 'stereotypes', 'attributes', 'operations']);
// prettier-ignore
const EDGE_KEYS = new Set([
  'kind', 'from', 'to', 'role', 'multiplicity', 'fromRole', 'fromMultiplicity',
  'fromColumn', 'toColumn', 'total', 'label',
]);
const OPTION_KEYS = new Set([
  'showAccessors',
  'showDependencies',
  'showExternal',
  'showMain',
  'showObjectMethods',
  'entry',
  'locale',
]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/** Validates already-parsed YAML/JSON. */
export function validateExpected(data: unknown): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(data)) return { ok: false, errors: ['top level must be a mapping'] };

  for (const k of Object.keys(data)) if (!TOP_KEYS.has(k)) errors.push(`unknown key "${k}"`);
  if (!(DIAGRAM_KINDS as readonly unknown[]).includes(data.kind))
    errors.push(`kind must be one of ${DIAGRAM_KINDS.join(', ')}`);
  if (!SOURCES.includes(data.source as string)) errors.push(`source must be one of ${SOURCES.join(', ')}`);
  if (data.notes !== undefined && typeof data.notes !== 'string') errors.push('notes must be a string');

  if (data.options !== undefined) {
    if (!isObj(data.options)) errors.push('options must be a mapping');
    else for (const k of Object.keys(data.options)) if (!OPTION_KEYS.has(k)) errors.push(`options: unknown key "${k}"`);
  }

  const names = new Set<string>();
  if (data.nodes !== undefined) {
    if (!Array.isArray(data.nodes)) errors.push('nodes must be a list');
    else
      data.nodes.forEach((n, i) => {
        const at = `nodes[${i}]`;
        if (!isObj(n)) return errors.push(`${at} must be a mapping`);
        for (const k of Object.keys(n)) if (!NODE_KEYS.has(k)) errors.push(`${at}: unknown key "${k}"`);
        if (typeof n.name !== 'string' || !n.name) errors.push(`${at}.name is required`);
        else if (names.has(n.name)) errors.push(`${at}: duplicate node name "${n.name}"`);
        else names.add(n.name);
        if (!(NODE_KINDS as readonly unknown[]).includes(n.kind))
          errors.push(`${at}.kind "${String(n.kind)}" is not a NodeKind`);
        for (const k of ['stereotypes', 'attributes', 'operations'] as const)
          if (n[k] !== undefined && !isStrList(n[k])) errors.push(`${at}.${k} must be a list of strings`);
      });
  }

  if (data.edges !== undefined) {
    if (!Array.isArray(data.edges)) errors.push('edges must be a list');
    else
      data.edges.forEach((e, i) => {
        const at = `edges[${i}]`;
        if (!isObj(e)) return errors.push(`${at} must be a mapping`);
        for (const k of Object.keys(e)) if (!EDGE_KEYS.has(k)) errors.push(`${at}: unknown key "${k}"`);
        if (!(EDGE_KINDS as readonly unknown[]).includes(e.kind))
          errors.push(`${at}.kind "${String(e.kind)}" is not an EdgeKind`);
        for (const end of ['from', 'to'] as const) {
          const v = e[end];
          if (typeof v !== 'string' || !v) errors.push(`${at}.${end} is required`);
          else if (data.nodes !== undefined && !names.has(v)) errors.push(`${at}.${end} "${v}" is not a listed node`);
        }
        for (const k of [
          'role',
          'multiplicity',
          'fromRole',
          'fromMultiplicity',
          'fromColumn',
          'toColumn',
          'label',
        ] as const)
          if (e[k] !== undefined && typeof e[k] !== 'string')
            errors.push(`${at}.${k} must be a string (quote numbers: "1")`);
        if (e.total !== undefined && typeof e.total !== 'boolean') errors.push(`${at}.total must be true or false`);
      });
  }

  if (data.counts !== undefined) {
    if (!isObj(data.counts)) errors.push('counts must be a mapping');
    else {
      for (const k of Object.keys(data.counts))
        if (k !== 'nodes' && k !== 'edges') errors.push(`counts: unknown key "${k}"`);
      const check = (group: unknown, allowed: readonly string[], label: string) => {
        if (group === undefined) return;
        if (!isObj(group)) return errors.push(`counts.${label} must be a mapping`);
        for (const [k, v] of Object.entries(group)) {
          if (!allowed.includes(k))
            errors.push(`counts.${label}: "${k}" is not a ${label === 'nodes' ? 'NodeKind' : 'EdgeKind'}`);
          if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
            errors.push(`counts.${label}.${k} must be a whole number`);
        }
      };
      check(data.counts.nodes, NODE_KINDS, 'nodes');
      check(data.counts.edges, EDGE_KINDS, 'edges');
    }
  }

  if (data.calls !== undefined && !isStrList(data.calls)) errors.push('calls must be a list of strings');

  const hasGraph = data.nodes !== undefined || data.edges !== undefined;
  const hasCounts = data.counts !== undefined || data.calls !== undefined;
  if (!hasGraph && !hasCounts) errors.push('needs nodes/edges, or counts/calls');
  if (data.calls !== undefined && data.kind !== 'bash.flowchart')
    warnings.push('calls is only scored for bash.flowchart');
  if (hasGraph && data.nodes === undefined) warnings.push('edges without nodes: node scores are skipped');

  return errors.length ? { ok: false, errors } : { ok: true, value: data as unknown as Expected, warnings };
}

/** Parses and validates the text of an expected.yaml. */
export function parseExpected(text: string): Validation {
  let data: unknown;
  try {
    data = parse(text);
  } catch (err) {
    return { ok: false, errors: [`invalid YAML: ${err instanceof Error ? err.message : String(err)}`] };
  }
  return validateExpected(data);
}
