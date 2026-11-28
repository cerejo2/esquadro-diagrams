// c.callgraph (PROMPT.md §7.2): one node per function defined in the project,
// `call` edges labelled with the number of call sites, library functions as
// `external` nodes grouped by library (hidden by default).
import type { AnalyzeOptions } from '../types';
import type { Diagnostic, DiagramEdge, DiagramModel, DiagramNode, Evidence, SourceRef } from '../../model/types';
import { isHeader } from './ast';
import { diagnostic, evidence } from '../shared/evidence';
import { edgeId, nodeId } from '../shared/ids';
import type { FunctionInfo, Project } from './collect';
import { libraryOf } from './libraries';

interface Target {
  id: string;
  confidence: number;
  ev: Evidence;
}

export function callGraph(p: Project, opts: AnalyzeOptions): DiagramModel {
  const diagnostics: Diagnostic[] = [];
  // The same function defined twice in one file (`#if`/`#else` branches) is one node;
  // the calls of every branch leave from it.
  const allDefs = p.functions.filter((f) => f.defined);
  const primary = new Map<FunctionInfo, FunctionInfo>();
  const firstIn = new Map<string, FunctionInfo>();
  const defs: FunctionInfo[] = [];
  for (const f of allDefs) {
    const k = `${f.file}\0${f.name}`;
    const first = firstIn.get(k);
    if (first) {
      primary.set(f, first);
      diagnostics.push(
        diagnostic('info', `${f.name} is defined more than once in ${f.file} (#if branches?): one node`, f.ref),
      );
    } else {
      firstIn.set(k, f);
      defs.push(f);
    }
  }
  const byName = new Map<string, FunctionInfo[]>();
  for (const f of defs) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
  const declared = new Set(p.functions.filter((f) => !f.defined).map((f) => f.name));

  // ------------------------------------------------------------------- nodes
  const nodes: DiagramNode[] = [];
  const idOf = new Map<FunctionInfo, string>();
  const hideMain = opts.showMain === false;
  for (const [name, list] of byName) {
    if (list.length > 1)
      diagnostics.push(
        diagnostic(
          'info',
          `${name} is defined in ${list.length} files (${list.map((f) => f.file).join(', ')}); each one is a node named "${name} (file)"`,
          list[1]!.ref,
        ),
      );
  }
  for (const f of defs) {
    const name = byName.get(f.name)!.length > 1 ? `${f.name} (${f.file})` : f.name;
    const id = nodeId('function', name);
    idOf.set(f, id);
    if (hideMain && f.name === 'main') continue;
    nodes.push({
      id,
      kind: 'function',
      name,
      group: f.file,
      ref: f.ref,
      evidence: [
        evidence(
          f.name === 'main' ? 'c.function.main' : 'c.function',
          f.ref,
          `${f.isStatic ? 'static ' : ''}function defined in ${f.file}${f.name === 'main' ? ' (entry point)' : ''}`,
        ),
      ],
    });
  }

  /** The definition a call by name reaches from `caller`'s file. */
  const resolveDef = (name: string, caller: FunctionInfo): Target | undefined | 'ambiguous' => {
    const list = byName.get(name);
    if (!list) return undefined;
    const same = list.find((f) => f.file === caller.file);
    if (same) return { id: idOf.get(same)!, confidence: 1, ev: evidence('c.call', undefined) };
    const visible = list.filter((f) => !f.isStatic);
    if (visible.length === 1) return { id: idOf.get(visible[0]!)!, confidence: 1, ev: evidence('c.call', undefined) };
    if (visible.length > 1) return 'ambiguous';
    // `static inline` in a header: every file that includes it has its own copy.
    if (list.length === 1 && isHeader(list[0]!.file))
      return { id: idOf.get(list[0]!)!, confidence: 1, ev: evidence('c.call.static-header', undefined) };
    if (list.length === 1)
      return {
        id: idOf.get(list[0]!)!,
        confidence: 0.7,
        ev: evidence('c.call.static-elsewhere', undefined, `${name} is static in ${list[0]!.file}`),
      };
    return 'ambiguous';
  };

  // ------------------------------------------------------------------- edges
  const externals = new Map<string, DiagramNode>();
  const edges = new Map<string, DiagramEdge & { sites: number }>();
  const addEdge = (from: string, t: Target) => {
    const id = edgeId('call', from, t.id);
    const e = edges.get(id);
    if (e) {
      e.sites++;
      e.evidence.push(t.ev);
      e.confidence = Math.min(e.confidence, t.confidence);
    } else
      edges.set(id, {
        id,
        kind: 'call',
        from: { node: from },
        to: { node: t.id, navigable: true },
        confidence: t.confidence,
        evidence: [t.ev],
        sites: 1,
      });
  };
  const external = (name: string, library: string, rule: string, ref: SourceRef): string => {
    const id = nodeId('external', name);
    if (!externals.has(id))
      externals.set(id, {
        id,
        kind: 'external',
        name,
        group: library,
        evidence: [evidence(rule, ref, `called but not defined in the project (${library})`)],
      });
    return id;
  };

  for (const f of allDefs) {
    const from = idOf.get(primary.get(f) ?? f)!;
    for (const call of f.calls) {
      if (!call.name) {
        diagnostics.push(
          diagnostic(
            'info',
            `call through ${call.text} in ${f.name}: the target is not known, so there is no edge`,
            call.ref,
          ),
        );
        continue;
      }
      const local = f.locals.get(call.name);
      if (local) {
        // A call through a local variable or a parameter: a pointer to function.
        const targets = [...new Map(local.assigned.map((a) => [a.name, a])).values()].filter((a) => byName.has(a.name));
        if (!targets.length || local.param) {
          diagnostics.push(
            diagnostic(
              'info',
              `call through the ${local.param ? 'parameter' : 'variable'} ${call.name} in ${f.name}: the target is not known, so there is no edge`,
              call.ref,
            ),
          );
          continue;
        }
        for (const a of targets) {
          const t = resolveDef(a.name, f);
          if (!t || t === 'ambiguous') continue;
          addEdge(from, {
            id: t.id,
            confidence: 0.5,
            ev: evidence('c.call.fn-pointer', call.ref, `${call.name} is assigned ${a.name} (line ${a.ref.line})`),
          });
        }
        if (local.otherAssign)
          diagnostics.push(diagnostic('info', `${call.name} in ${f.name} may also point to other functions`, call.ref));
        continue;
      }
      const t = resolveDef(call.name, f);
      if (t === 'ambiguous') {
        diagnostics.push(
          diagnostic('warn', `call to ${call.name} in ${f.name}: defined in several files, not linked`, call.ref),
        );
        continue;
      }
      if (t) {
        addEdge(from, { ...t, ev: { ...t.ev, ref: call.ref } });
        continue;
      }
      const g = p.globals.get(call.name);
      if (g) {
        const targets = [...new Set(g.assigned.map((a) => a.name))].filter((n) => byName.has(n));
        if (!targets.length)
          diagnostics.push(
            diagnostic('info', `call through the global ${call.name} in ${f.name}: the target is not known`, call.ref),
          );
        for (const n of targets) {
          const r = resolveDef(n, f);
          if (!r || r === 'ambiguous') continue;
          addEdge(from, {
            id: r.id,
            confidence: 0.5,
            ev: evidence('c.call.fn-pointer', call.ref, `the global ${call.name} is initialised with ${n}`),
          });
        }
        continue;
      }
      if (!opts.showExternal) continue;
      const library = p.macros.has(call.name)
        ? 'macro'
        : declared.has(call.name)
          ? 'declared, not defined'
          : libraryOf(call.name);
      addEdge(from, {
        id: external(call.name, library, 'c.call.external', call.ref),
        confidence: 1,
        ev: evidence('c.call.external', call.ref),
      });
    }
  }

  let list = [...edges.values()];
  if (hideMain) {
    const mains = new Set(defs.filter((f) => f.name === 'main').map((f) => idOf.get(f)!));
    list = list.filter((e) => !mains.has(e.from.node) && !mains.has(e.to.node));
  }
  const outEdges: DiagramEdge[] = list.map(({ sites, ...e }) => (sites > 1 ? { ...e, label: String(sites) } : e));
  const usedExternals = new Set(outEdges.map((e) => e.to.node));
  nodes.push(...[...externals.values()].filter((n) => usedExternals.has(n.id)));
  return { lang: 'c', kind: 'c.callgraph', nodes, edges: outEdges, diagnostics };
}
