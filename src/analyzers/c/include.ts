// c.include (PROMPT.md §7.2): source and header files, an `include` edge per
// `#include "x.h"` resolved from the including file's folder, `<...>` headers
// as hidden externals and a warning for every include cycle.
import type { AnalyzeOptions } from '../types';
import type { Diagnostic, DiagramEdge, DiagramModel, DiagramNode, Evidence } from '../../model/types';
import { diagnostic, evidence } from '../shared/evidence';
import { edgeId, nodeId } from '../shared/ids';
import { isHeader } from './ast';
import type { Project } from './collect';

/** `a/b/../c.h` → `a/c.h`; leading `..` that climbs out of the project is kept. */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && out.length && out[out.length - 1] !== '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

export function includeGraph(p: Project, opts: AnalyzeOptions): DiagramModel {
  const diagnostics: Diagnostic[] = [];
  const files = new Set(p.files);
  const idOf = (path: string) => nodeId(isHeader(path) ? 'header-file' : 'source-file', path);
  const nodes: DiagramNode[] = p.files.map((path) => ({
    id: idOf(path),
    kind: isHeader(path) ? 'header-file' : 'source-file',
    name: path,
    group: dirOf(path) || undefined,
    ref: { file: path, line: 1 },
    evidence: [evidence('c.file', { file: path, line: 1 }, isHeader(path) ? 'header file' : 'source file')],
  }));
  for (const n of nodes) if (!n.group) delete n.group;

  const externals = new Map<string, DiagramNode>();
  const edges = new Map<string, DiagramEdge>();
  const graph = new Map<string, Set<string>>();
  const add = (from: string, to: string, confidence: number, ev: Evidence) => {
    const id = edgeId('include', from, to);
    const e = edges.get(id);
    if (e) {
      e.evidence.push(ev);
      return;
    }
    edges.set(id, {
      id,
      kind: 'include',
      from: { node: from },
      to: { node: to, navigable: true },
      confidence,
      evidence: [ev],
    });
  };

  for (const inc of p.includes) {
    const from = idOf(inc.file);
    const resolved = inc.system || inc.computed ? undefined : resolveInclude(inc.target, inc.file, files);
    if (resolved) {
      add(
        from,
        idOf(resolved.path),
        resolved.confidence,
        evidence(resolved.rule, inc.ref, `#include "${inc.target}" → ${resolved.path}`),
      );
      const set = graph.get(inc.file) ?? new Set<string>();
      set.add(resolved.path);
      graph.set(inc.file, set);
      continue;
    }
    if (inc.computed) {
      // `#include MACRO`: macros are not expanded, so the file is unknown.
      diagnostics.push(
        diagnostic('info', `#include ${inc.target} in ${inc.file} names a macro, which is not expanded`, inc.ref),
      );
      continue;
    }
    if (!inc.system)
      diagnostics.push(
        diagnostic(
          'info',
          `#include "${inc.target}" in ${inc.file} is not a file of the project; shown as external`,
          inc.ref,
        ),
      );
    if (!opts.showExternal) continue;
    const name = inc.system ? `<${inc.target}>` : `"${inc.target}"`;
    const id = nodeId('external', name);
    if (!externals.has(id))
      externals.set(id, {
        id,
        kind: 'external',
        name,
        group: inc.system ? 'system' : 'not found',
        evidence: [evidence(inc.system ? 'c.include.system' : 'c.include.unresolved', inc.ref)],
      });
    add(from, id, 1, evidence(inc.system ? 'c.include.system' : 'c.include.unresolved', inc.ref));
  }

  for (const cycle of cycles(graph)) {
    const first = p.includes.find((i) => i.file === cycle[0] && !i.system);
    diagnostics.push(diagnostic('warn', `include cycle: ${[...cycle, cycle[0]].join(' → ')}`, first?.ref));
  }

  return {
    lang: 'c',
    kind: 'c.include',
    nodes: [...nodes, ...externals.values()],
    edges: [...edges.values()],
    diagnostics,
  };
}

/**
 * Where `#include "target"` in `from` lands: next to the including file (what
 * every compiler does first), then from the project root (`-I.`), then any
 * single project file whose path ends with the target (a guess for `-I` flags).
 */
export function resolveInclude(
  target: string,
  from: string,
  files: ReadonlySet<string>,
): { path: string; confidence: number; rule: string } | undefined {
  const local = normalizePath(`${dirOf(from)}/${target}`);
  if (files.has(local)) return { path: local, confidence: 1, rule: 'c.include.relative' };
  const root = normalizePath(target);
  if (files.has(root)) return { path: root, confidence: 0.9, rule: 'c.include.root' };
  const tail = `/${root.replace(/^(\.\.\/)+/, '')}`;
  const matches = [...files].filter((f) => f.endsWith(tail) || f === tail.slice(1));
  if (matches.length === 1) return { path: matches[0]!, confidence: 0.6, rule: 'c.include.search' };
  return undefined;
}

/** Strongly connected components with more than one file, or a file that includes itself. */
function cycles(graph: Map<string, Set<string>>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  let i = 0;
  const visit = (v: string) => {
    index.set(v, i);
    low.set(v, i);
    i++;
    stack.push(v);
    onStack.add(v);
    for (const w of [...(graph.get(v) ?? [])].sort()) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || graph.get(v)?.has(v)) out.push(comp.reverse());
    }
  };
  for (const v of [...graph.keys()].sort()) if (!index.has(v)) visit(v);
  return out;
}
