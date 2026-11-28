// bash.dependency (PROMPT.md §7.3): each script linked to the external
// commands it runs (`uses`, labelled with the count), to the files it reads or
// writes (redirections and the literal arguments of cp, mv and rm, drawn as
// `io` nodes) and to the scripts it sources or runs.
import type { AnalyzeOptions } from '../types';
import type { DiagramEdge, DiagramModel, DiagramNode, Evidence } from '../../model/types';
import { evidence, refOf } from '../shared/evidence';
import { edgeId, nodeId } from '../shared/ids';
import { BUILTINS, commandArgs, commandName, literal, unquote } from './ast';
import { scriptNode, scriptRun, sourceEdges, trapHandlers } from './callgraph';
import { externalGroup } from './externals';
import type { Locale } from './labels';
import type { Project } from './project';

const MAX_EVIDENCE = 12;
const NOT_FILES = /^(\/dev\/(null|stdout|stderr|tty|fd\/\d+)|-|&?\d+)$/;

type Access = 'reads' | 'writes' | 'removes';
const VERBS: Record<Locale, Record<Access, string>> = {
  pt: { reads: 'lê', writes: 'escreve', removes: 'apaga' },
  en: { reads: 'reads', writes: 'writes', removes: 'removes' },
};

interface Use {
  from: string;
  to: string;
  count: number;
  access: Set<Access>;
  confidence: number;
  evidence: Evidence[];
}

export function dependencyDiagram(p: Project, opts: AnalyzeOptions): DiagramModel {
  const l: Locale = opts.locale ?? 'pt';
  const nodes: DiagramNode[] = p.files.map((f) => scriptNode(p, f));
  const extra = new Map<string, DiagramNode>();
  const uses = new Map<string, Use>();

  const record = (from: string, to: string, confidence: number, ev: Evidence, access?: Access) => {
    const key = `${from}|${to}`;
    let u = uses.get(key);
    if (!u) {
      u = { from, to, count: 0, access: new Set(), confidence: 0, evidence: [] };
      uses.set(key, u);
    }
    u.count++;
    if (access) u.access.add(access);
    u.confidence = Math.max(u.confidence, confidence);
    if (u.evidence.length < MAX_EVIDENCE) u.evidence.push(ev);
  };
  const external = (name: string, ev: Evidence) => {
    const id = nodeId('external', name);
    if (!extra.has(id)) extra.set(id, { id, kind: 'external', name, group: externalGroup(name), evidence: [ev] });
    return id;
  };
  const fileNode = (name: string, ev: Evidence) => {
    const id = nodeId('io', name);
    if (!extra.has(id)) extra.set(id, { id, kind: 'io', name, group: 'files', evidence: [ev] });
    return id;
  };

  for (const f of p.files) {
    const me = p.scriptId(f);
    for (const cmd of f.root.descendantsOfType('command')) {
      if (!cmd) continue;
      const name = commandName(cmd);
      if (!name) continue;
      const ref = refOf(cmd, f.path);
      const names = name === 'trap' ? trapHandlers(cmd).map((h) => h.name) : [name];
      for (const n of names) {
        if (p.resolve(n, f) || BUILTINS.has(n)) continue;
        const script = scriptRun(p, f, n, n === name ? cmd : undefined);
        if (script) {
          record(me, p.scriptId(script), 0.9, evidence('bash.dep.script', ref, `runs ${script.path}`));
          continue;
        }
        if (!/^[\w][\w.+-]*$/.test(n)) continue;
        const ev = evidence('bash.dep.command', ref, `${n} is not defined in the project nor a shell builtin`);
        record(me, external(n, ev), externalGroup(n) === 'other' ? 0.8 : 1, ev);
      }
      // cp/mv read every literal source and write the last argument; rm removes its arguments.
      if (name === 'cp' || name === 'mv' || name === 'rm') {
        const paths = commandArgs(cmd)
          .map((a) => literal(a))
          .filter((a): a is string => a !== undefined && !a.startsWith('-'));
        paths.forEach((path, i) => {
          const access: Access = name === 'rm' ? 'removes' : i === paths.length - 1 ? 'writes' : 'reads';
          const ev = evidence(`bash.dep.${name}`, ref, `${name} ${access} ${path}`);
          record(me, fileNode(path, ev), 1, ev, access);
        });
      }
    }
    for (const r of f.root.descendantsOfType('file_redirect')) {
      if (!r) continue;
      const dest = r.childForFieldName('destination');
      if (!dest || dest.type === 'process_substitution') continue;
      const op = r.children.find((c) => !c.isNamed)?.type ?? '';
      if (op === '>&' || op === '<&' || op === '>&-' || op === '<&-') continue;
      const lit = literal(dest);
      const name = lit ?? unquote(dest);
      if (NOT_FILES.test(name)) continue;
      const access: Access = op.startsWith('<') ? 'reads' : 'writes';
      const ref = refOf(r, f.path);
      const ev = evidence(
        lit !== undefined ? 'bash.dep.redirect' : 'bash.dep.redirect.variable',
        ref,
        lit !== undefined ? undefined : `the file name depends on ${name}`,
      );
      record(me, fileNode(name, ev), lit !== undefined ? 1 : 0.7, ev, access);
    }
  }

  nodes.push(...[...extra.values()].sort((a, b) => a.kind.localeCompare(b.kind) || (a.name < b.name ? -1 : 1)));
  const edges: DiagramEdge[] = sourceEdges(p);
  for (const u of uses.values()) {
    const verbs = [...u.access].map((a) => VERBS[l][a]).join(', ');
    const label = verbs || String(u.count);
    edges.push({
      id: edgeId('uses', u.from, u.to),
      kind: 'uses',
      from: { node: u.from },
      to: { node: u.to },
      label,
      confidence: u.confidence,
      evidence: u.evidence,
    });
  }
  return { lang: 'bash', kind: 'bash.dependency', nodes, edges, diagnostics: [] };
}
