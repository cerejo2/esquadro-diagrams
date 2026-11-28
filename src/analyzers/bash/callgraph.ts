// bash.callgraph (PROMPT.md §7.3): one `function` node per function, one
// `script` node per file for its top-level code, `call` edges (also inside
// $(...), pipelines, conditions, && and ||), `trap` edges and `source` edges.
import type { Node } from 'web-tree-sitter';
import type { AnalyzeOptions } from '../types';
import type { DiagramEdge, DiagramModel, DiagramNode, Evidence, SourceRef } from '../../model/types';
import { evidence, refOf } from '../shared/evidence';
import { edgeId, nodeId } from '../shared/ids';
import { BUILTINS, commandArgs, commandName, commandsIn, literal, unquote } from './ast';
import { externalGroup } from './externals';
import type { BashFile, Project } from './project';

/** At most this many evidence items per edge; the count stays exact. */
const MAX_EVIDENCE = 12;

interface Pending {
  from: string;
  to: string;
  trap: boolean;
  count: number;
  confidence: number;
  evidence: Evidence[];
}

export function scriptNode(p: Project, f: BashFile): DiagramNode {
  return {
    id: p.scriptId(f),
    kind: 'script',
    name: f.name,
    group: f.dir || undefined,
    ref: { file: f.path, line: 1 },
    evidence: [evidence('bash.script', { file: f.path, line: 1 }, 'top-level code of the file')],
  };
}

export function callGraph(p: Project, opts: AnalyzeOptions): DiagramModel {
  const nodes: DiagramNode[] = [];
  const externals = new Map<string, DiagramNode>();
  const calls = new Map<string, Pending>();

  const add = (from: string, to: string, trap: boolean, confidence: number, ev: Evidence) => {
    const key = `${from}|${to}|${trap ? 'trap' : ''}`;
    let e = calls.get(key);
    if (!e) {
      e = { from, to, trap, count: 0, confidence: 0, evidence: [] };
      calls.set(key, e);
    }
    e.count++;
    e.confidence = Math.max(e.confidence, confidence);
    if (e.evidence.length < MAX_EVIDENCE) e.evidence.push(ev);
  };

  /** Links `owner` to whatever `name` runs: a project function, another script or an external command. */
  const link = (
    owner: string,
    file: BashFile,
    name: string,
    ref: SourceRef,
    trap: boolean,
    base: number,
    cmd?: Node,
  ) => {
    // Bash looks functions up before builtins, so a project function may shadow one.
    const fn = p.resolve(name, file);
    if (fn) {
      const rule = trap ? 'bash.call.trap' : fn.rule;
      add(owner, fn.fn.id, trap, fn.confidence * base, evidence(rule, ref, fn.note));
      return;
    }
    if (BUILTINS.has(name)) return;
    const script = scriptRun(p, file, name, cmd);
    if (script) {
      add(owner, p.scriptId(script), trap, 0.9 * base, evidence('bash.call.script', ref, `runs ${script.path}`));
      return;
    }
    if (!opts.showExternal || !/^[\w][\w.+-]*$/.test(name)) return;
    const group = externalGroup(name);
    const id = nodeId('external', name);
    if (!externals.has(id))
      externals.set(id, {
        id,
        kind: 'external',
        name,
        group,
        evidence: [evidence('bash.external', ref, `${name} is not defined in the project nor a shell builtin`)],
      });
    add(owner, id, trap, (group === 'other' ? 0.8 : 1) * base, evidence('bash.call.external', ref));
  };

  const scan = (owner: string, file: BashFile, root: Node) => {
    for (const cmd of commandsIn(root)) {
      const name = commandName(cmd);
      if (!name) continue;
      const ref = refOf(cmd, file.path);
      if (name === 'trap') {
        for (const h of trapHandlers(cmd)) link(owner, file, h.name, ref, true, h.confidence);
        continue;
      }
      link(owner, file, name, ref, false, 1, cmd);
    }
  };

  for (const f of p.files) {
    nodes.push(scriptNode(p, f));
    scan(p.scriptId(f), f, f.root);
  }
  for (const fn of p.functions) {
    nodes.push({
      id: fn.id,
      kind: 'function',
      name: fn.name,
      group: fn.file.path,
      ref: fn.ref,
      evidence: [evidence('bash.function', fn.ref, `defined in ${fn.file.path}`)],
    });
    for (const def of fn.defs) {
      const body = def.childForFieldName('body');
      if (body) scan(fn.id, fn.file, body);
    }
  }
  nodes.push(...[...externals.values()].sort((a, b) => (a.name < b.name ? -1 : 1)));

  const edges: DiagramEdge[] = sourceEdges(p);
  for (const e of calls.values()) {
    const label = e.trap ? 'trap' : e.count > 1 ? String(e.count) : undefined;
    edges.push({
      id: edgeId('call', e.from, e.to, e.trap ? 'trap' : undefined),
      kind: 'call',
      from: { node: e.from },
      to: { node: e.to },
      ...(label ? { label } : {}),
      confidence: e.confidence,
      evidence: e.evidence,
    });
  }
  return { lang: 'bash', kind: 'bash.callgraph', nodes, edges, diagnostics: [] };
}

/** One `source` edge per pair of scripts, with every `source`/`.` line as evidence. */
export function sourceEdges(p: Project): DiagramEdge[] {
  const byPair = new Map<string, DiagramEdge>();
  for (const s of p.sources) {
    const from = p.scriptId(s.from);
    const to = p.scriptId(s.to);
    const id = edgeId('source', from, to);
    const prev = byPair.get(id);
    if (prev) {
      prev.confidence = Math.max(prev.confidence, s.confidence);
      prev.evidence.push(evidence(s.rule, s.ref, s.note));
      continue;
    }
    byPair.set(id, {
      id,
      kind: 'source',
      from: { node: from },
      to: { node: to },
      confidence: s.confidence,
      evidence: [evidence(s.rule, s.ref, s.note)],
    });
  }
  return [...byPair.values()];
}

/** A project script run by path (`./x.sh`) or through an interpreter (`bash x.sh`). */
export function scriptRun(p: Project, file: BashFile, name: string, cmd?: Node): BashFile | undefined {
  if (name.includes('/')) return p.scriptAt(name, file);
  if (cmd && (name === 'bash' || name === 'sh' || name === 'zsh')) {
    const first = commandArgs(cmd)[0];
    const path = first && literal(first);
    if (path && !path.startsWith('-')) return p.scriptAt(path, file);
  }
  return undefined;
}

/**
 * The commands a `trap` runs: `trap cleanup EXIT` names one directly; a quoted
 * handler (`trap 'rm -f $tmp; die' INT`) is split on `;`, `&&`, `||` and `|`,
 * which is a guess, so its confidence is lower. `trap - SIG` and `trap '' SIG` run nothing.
 */
export function trapHandlers(cmd: Node): { name: string; confidence: number }[] {
  const args = commandArgs(cmd);
  // `trap -- handler SIG` (the form `trap -p` prints): `--` only ends the options.
  const handler = args[0] && literal(args[0]) === '--' ? args[1] : args[0];
  if (!handler) return [];
  const lit = literal(handler);
  const text = lit ?? unquote(handler);
  if (!text.trim() || (lit !== undefined && lit.startsWith('-'))) return [];
  // Function names may hold `-`, `.` and `:` (`my-cleanup`, `log::flush`).
  const direct = handler.type === 'word' && /^[\w][\w.:-]*$/.test(text);
  const out: { name: string; confidence: number }[] = [];
  for (const segment of text.split(/[;&|\n()]+/)) {
    const words = segment.trim().split(/\s+/);
    const first = words.find((w) => !/^\w+=/.test(w));
    if (first && /^[A-Za-z_][\w.:-]*$/.test(first)) out.push({ name: first, confidence: direct ? 1 : 0.9 });
  }
  return out;
}
