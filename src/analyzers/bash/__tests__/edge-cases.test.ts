// Adversarial cases for the Bash analyzer: odd syntax, odd bytes, odd names, a
// large project, and the invariants every model must keep (unique ids, ids that
// do not change between runs, evidence with a line, no phantom nodes, no throw).
import { describe, expect, it } from 'vitest';
import type { DiagramKind, DiagramModel, SourceFile } from '../../../model/types';
import { bashAnalyzer, detectBash } from '..';
import { analyze, arrows, counts, edgeList, flow, labels, nodesOf, shown } from './helpers';

const KINDS: DiagramKind[] = ['bash.callgraph', 'bash.flowchart', 'bash.dependency'];

/** Every structural promise of the contract, checked on one model. */
function invariants(m: DiagramModel): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const n of m.nodes) {
    if (ids.has(n.id)) out.push(`duplicate node id ${n.id}`);
    ids.add(n.id);
    if (!n.evidence?.length) out.push(`node ${n.id} has no evidence`);
    if (m.kind !== 'bash.dependency' || n.kind === 'script')
      if (!n.evidence?.some((e) => e.ref?.line)) out.push(`node ${n.id} has no evidence line`);
    for (const t of [n.name, n.label ?? '']) if (/[\r﻿]/.test(t)) out.push(`node ${n.id} shows a CR or BOM`);
  }
  const edgeIds = new Set<string>();
  const arrowsSeen = new Set<string>();
  for (const e of m.edges) {
    if (edgeIds.has(e.id)) out.push(`duplicate edge id ${e.id}`);
    edgeIds.add(e.id);
    const key = `${e.kind}|${e.from.node}|${e.to.node}|${e.label ?? ''}`;
    if (arrowsSeen.has(key)) out.push(`duplicate edge ${key}`);
    arrowsSeen.add(key);
    if (!ids.has(e.from.node)) out.push(`edge ${e.id} starts at a missing node`);
    if (!ids.has(e.to.node)) out.push(`edge ${e.id} ends at a missing node`);
    if (!e.evidence.length || e.evidence.some((x) => !x.ref?.line)) out.push(`edge ${e.id} has evidence with no line`);
    if (e.label && /[\r﻿]/.test(e.label)) out.push(`edge ${e.id} label shows a CR`);
  }
  for (const d of m.diagnostics) if (/internal error/.test(d.message)) out.push(d.message);
  return out;
}

async function all(sources: Record<string, string>, opts = {}): Promise<DiagramModel[]> {
  return Promise.all(KINDS.map((k) => analyze(sources, k, opts)));
}

describe('heredocs', () => {
  const src = {
    'gen.sh': [
      'real() { :; }',
      'cat <<EOF > gen.conf',
      'fake() { real; }',
      'function other { rm -rf /; }',
      '$(real)',
      'EOF',
      "cat <<'RAW'",
      '$(real) `real`',
      'RAW',
      'cat <<-END',
      '\tfake2() { :; }',
      '\tEND',
      'echo after',
      '',
    ].join('\n'),
  };

  it('defines no function from heredoc text and calls only what an unquoted heredoc expands', async () => {
    const m = await analyze(src);
    expect(nodesOf(m, 'function').map((n) => n.name)).toEqual(['real']);
    expect(edgeList(m)).toEqual(['call gen.sh->real']);
  });

  it('keeps the commands inside a heredoc out of the dependencies', async () => {
    const m = await analyze(src, 'bash.dependency');
    expect(m.nodes.map((n) => n.name).sort()).toEqual(['cat', 'gen.conf', 'gen.sh']);
  });

  it('labels a heredoc written to a file as a write, and the code after it still runs', async () => {
    // The first heredoc expands $(real), so it is drawn as the subroutine for real.
    const m = await flow(src['gen.sh']);
    expect(labels(m, 'subroutine')).toHaveLength(1);
    expect(labels(m, 'io')).toEqual(['Mostrar texto (cat)\nMostrar texto (cat)\nMostrar after']);
    const w = await flow('cat <<EOF > "$out/app.conf"\nkey=1\nEOF\ncat <<EOF >> log\nx\nEOF\n');
    expect(labels(w, 'io')).toEqual(['Escrever texto (cat) em out/app.conf\nEscrever texto (cat) em log']);
  });

  it('follows an unquoted heredoc inside a function body', async () => {
    const m = await analyze({ 'a.sh': 'g() {\n  cat <<EOF\n$(h)\nEOF\n}\nh() { :; }\ng\n' });
    expect(edgeList(m)).toEqual(['call a.sh->g', 'call g->h']);
  });
});

describe('function definitions', () => {
  it('finds functions defined inside if and inside other functions', async () => {
    const m = await analyze({
      'a.sh':
        'if [ -t 1 ]; then\n  say() { echo tty; }\nelse\n  say() { logger x; }\nfi\nouter() {\n  inner() { say; }\n  inner\n}\nouter\n',
    });
    expect(nodesOf(m, 'function').map((n) => n.name)).toEqual(['say', 'outer', 'inner']);
    expect(edgeList(m).sort()).toEqual(['call a.sh->outer', 'call inner->say', 'call outer->inner']);
    expect(m.diagnostics.map((d) => d.level)).toEqual(['info']);
  });

  it('accepts names with -, . and :: in calls, traps and the flowchart entry', async () => {
    const src = {
      'a.sh':
        'log::init() { :; }\nmy-clean() { log::init; }\nui.box() { :; }\ntrap my-clean EXIT\ntrap "log::init; ui.box" INT\nlog::init\n',
    };
    const m = await analyze(src);
    expect(edgeList(m).sort()).toEqual([
      'call a.sh->log::init',
      'call a.sh->log::init [trap]',
      'call a.sh->my-clean [trap]',
      'call a.sh->ui.box [trap]',
      'call my-clean->log::init',
    ]);
    const f = await analyze(src, 'bash.flowchart', { entry: 'my-clean' });
    expect(arrows(f)).toEqual(['Início: my-clean --> log::init', 'log::init --> Fim']);
    const g = await analyze(src, 'bash.flowchart', { entry: 'log::init' });
    expect(g.diagnostics).toEqual([]);
    expect(shown(g.nodes[0]!)).toBe('Início: log::init');
    const h = await analyze(src, 'bash.flowchart', { entry: 'a.sh:log::init' });
    expect(h.diagnostics).toEqual([]);
    expect(shown(h.nodes[0]!)).toBe('Início: log::init');
  });

  it('follows coproc cmd like time cmd', async () => {
    const m = await analyze({ 'a.sh': 'f() { :; }\ncoproc f\ntime f\n' });
    expect(edgeList(m)).toEqual(['call a.sh->f [2]']);
    const d = await analyze({ 'a.sh': 'f() { :; }\ncoproc NAME { f; }\n' }, 'bash.dependency');
    expect(nodesOf(d, 'external')).toEqual([]);
  });
});

describe('substitutions, pipelines and arrays', () => {
  it('counts calls inside $( ), backticks, nested substitutions and arithmetic', async () => {
    const m = await analyze({
      'a.sh': 'n() { echo 1; }\nx=$(n)\ny=`n`\nz="$(echo "$(n)")"\nw=$(( $(n) + 1 ))\n[[ $(n) == 1 ]]\n',
    });
    expect(edgeList(m)).toEqual(['call a.sh->n [5]']);
  });

  it('links every function of a long pipeline', async () => {
    const stages = Array.from({ length: 30 }, (_, i) => `s${i}`);
    const src = stages.map((s) => `${s}() { cat; }`).join('\n') + `\n${stages.join(' | ')}\n`;
    const m = await analyze({ 'p.sh': src });
    expect(m.edges.filter((e) => e.from.node === 'script:p.sh')).toHaveLength(30);
  });

  it('does not take array elements for commands', async () => {
    const m = await analyze(
      { 'a.sh': 'cmds=(rm mv shutdown)\ndeclare -A k=([rm]=1)\nfor c in "${cmds[@]}"; do echo "$c"; done\n' },
      'bash.dependency',
    );
    expect(nodesOf(m, 'external')).toEqual([]);
    expect(nodesOf(m, 'io')).toEqual([]);
  });
});

describe('case and loops', () => {
  it('gives one exit per item, with the patterns of a|b together', async () => {
    const m = await flow('case $1 in\n  a|b) echo ab ;;\n  c|d|e) echo cde ;;\nesac\n');
    expect(m.edges.filter((e) => e.from.node.startsWith('decision')).map((e) => e.label)).toEqual([
      'a | b',
      'c | d | e',
      'outro',
    ]);
  });

  it('draws no duplicate arrows for items after *) (they never run)', async () => {
    const m = await flow('case $x in\n  *) ;;\n  *) ;;\n  a) echo a ;;\nesac\n');
    expect(arrows(m)).toEqual(['Início --> x?', 'x? -[outro]-> Fim']);
  });

  it('sends break 2 out of both loops and continue to the innermost', async () => {
    const m = await flow('for i in 1 2; do\n  while true; do\n    [ "$i" ] && break 2\n    continue\n  done\ndone\n');
    expect(arrows(m)).toEqual([
      'Início --> mais i em 1 2?',
      'mais i em 1 2? -[sim]-> repetir?',
      'repetir? -[sim]-> i não vazio?',
      'i não vazio? -[não]-> repetir?',
      'mais i em 1 2? -[não]-> Fim',
      'i não vazio? -[sim]-> Fim',
    ]);
  });
});

describe('source with a variable', () => {
  it('guesses from the literal end with a warning, or reports it', async () => {
    const m = await analyze({
      'app.sh': 'source "$HERE/lib.sh"\n. "$(dirname "$0")/nowhere.sh"\nf\n',
      'lib.sh': 'f() { :; }\n',
    });
    const src = m.edges.find((e) => e.kind === 'source');
    expect(src?.confidence).toBe(0.6);
    expect(m.diagnostics.map((d) => d.level)).toEqual(['warn', 'warn']);
    expect(m.diagnostics[1]!.message).toContain('not followed');
  });
});

describe('bytes: CRLF, BOM, UTF-8', () => {
  const crlf =
    '﻿#!/bin/bash\r\n# ação\r\nolá() {\r\n  echo "çé"\r\n}\r\nif [ -f x ]; then\r\n  olá\r\nfi\r\ncat <<EOF\r\ntexto\r\nEOF\r\nexit 3\r\n';

  it('keeps names, lines and the exit right', async () => {
    const [cg, fc, dep] = await all({ 'a.sh': crlf });
    expect(nodesOf(cg!, 'function').map((n) => [n.name, n.ref?.line])).toEqual([['olá', 3]]);
    expect(edgeList(cg!)).toEqual(['call a.sh->olá']);
    expect(labels(fc!, 'terminator')).toEqual(['Início', 'Fim (exit 3)']);
    expect(nodesOf(fc!, 'decision').map((n) => [shown(n), n.ref?.line])).toEqual([['x é ficheiro?', 6]]);
    expect(dep!.nodes.map((n) => n.name)).toEqual(['a.sh', 'cat']);
    for (const m of [cg!, fc!, dep!]) expect(invariants(m)).toEqual([]);
  });

  it('detects scripts by extension or by shebang, also behind a BOM and with CRLF', () => {
    const d = (path: string, content: string) => detectBash({ path, content });
    expect(d('a.sh', '')).toBe(1);
    expect(d('a.bash', '')).toBe(1);
    expect(d('run', '#!/usr/bin/env bash\n')).toBe(1);
    expect(d('run', '#!/usr/bin/env -S bash -e\n')).toBe(1);
    expect(d('run', '#!/bin/sh\r\necho\r\n')).toBe(1);
    expect(d('run', '﻿#!/bin/zsh\n')).toBe(1);
    expect(d('run', '#!/usr/bin/env python3\n')).toBe(0);
    expect(d('README', 'hello\n')).toBe(0);
  });
});

describe('degenerate input', () => {
  it('answers an empty file list with a diagnostic, for every kind', async () => {
    for (const kind of KINDS) {
      const m = await bashAnalyzer.analyze([], kind);
      expect(m.nodes).toEqual([]);
      expect(m.diagnostics.map((d) => d.level)).toEqual(['info']);
    }
  });

  it('handles empty, comment-only and broken files without throwing', async () => {
    for (const content of ['', '\n\n', '# a\n# b\n', '﻿', 'if then fi ((((', '\u0000\u0001$(`"\'', 'f() {']) {
      for (const m of await all({ 'a.sh': content })) {
        expect(invariants(m)).toEqual([]);
        expect(m.diagnostics.filter((d) => /internal/.test(d.message))).toEqual([]);
      }
    }
    expect(counts(await flow('# only comments\n'))).toEqual({ terminator: 2, flow: 1 });
  });

  it('survives very deep nesting and very long && chains', async () => {
    const deep = 'if a; then\n'.repeat(300) + 'x\n' + 'fi\n'.repeat(300);
    const chain = Array.from({ length: 2000 }, (_, i) => `c${i}`).join(' && ') + '\n';
    for (const src of [deep, chain]) for (const m of await all({ 'a.sh': src })) expect(invariants(m)).toEqual([]);
  });
});

describe('phantom nodes', () => {
  it('never turns builtins, keywords or test syntax into externals', async () => {
    const src = [
      'local_x() { local a=1; declare -i b; readonly c=2; export d; typeset e; }',
      'read -r x; printf "%s" "$x"; echo; test -f a; [ -d b ]; [[ -e c ]]; (( i++ ))',
      'set -euo pipefail; shopt -s nullglob; trap - EXIT; eval "x"; exec 3>&-',
      'mapfile -t arr < /dev/null; getopts "a" opt; shift; wait; true; false; :',
      'source /dev/null; . /dev/null; let n=1; unset n; cd /; pushd . >/dev/null; popd',
      '',
    ].join('\n');
    const m = await analyze({ 'a.sh': src }, 'bash.dependency');
    expect(nodesOf(m, 'external').map((n) => n.name)).toEqual([]);
    const cg = await analyze({ 'a.sh': src }, 'bash.callgraph', { showExternal: true });
    expect(nodesOf(cg, 'external').map((n) => n.name)).toEqual([]);
  });

  it('hides external commands in the call graph by default', async () => {
    const m = await analyze({ 'a.sh': 'grep x y | sort | uniq\nfind . -name z\n' });
    expect(m.nodes.map((n) => n.kind)).toEqual(['script']);
  });
});

describe('stability', () => {
  const project = {
    'b/lib.sh': 'helper() { grep x; }\nshared() { :; }\n',
    'a/app.sh':
      'source ../b/lib.sh\nshared() { helper; }\nrun_all() { shared | helper; echo hi > out.txt; }\ntrap run_all EXIT\nrun_all\n',
    'c.sh': 'shared\nfor i in 1 2; do case $i in 1) helper ;; *) break ;; esac; done\n',
  };

  it('gives the same ids on every run and for any file order', async () => {
    const entries = Object.entries(project);
    const reversed = Object.fromEntries([...entries].reverse());
    for (const kind of KINDS) {
      const opts = { showExternal: true, entry: kind === 'bash.flowchart' ? 'c.sh' : undefined };
      const a = await analyze(project, kind, opts);
      const b = await analyze(project, kind, opts);
      const c = await analyze(reversed, kind, opts);
      const ids = (m: DiagramModel) => [m.nodes.map((n) => n.id), m.edges.map((e) => e.id)];
      expect(ids(b)).toEqual(ids(a));
      expect(ids(c)).toEqual(ids(a));
      expect(JSON.stringify(c)).toBe(JSON.stringify(a));
      expect(invariants(a)).toEqual([]);
    }
  });
});

describe('a 300-file project', () => {
  /** Each file sources the one before it: the deepest chain of source links. */
  function generate(n: number): SourceFile[] {
    const files: SourceFile[] = [];
    for (let i = 0; i < n; i++) {
      const prev = i ? `source ./lib${i - 1}.sh\n` : '';
      const fns = Array.from(
        { length: 5 },
        (_, j) =>
          `f${i}_${j}() {\n  if [[ -f in${j} ]]; then f${Math.max(0, i - 1)}_${j} | grep -v x; fi\n` +
          `  for a in 1 2 3; do echo "$a" >> out${i}.txt; done\n  [[ -n $STOP ]] && die${i}\n}\n`,
      ).join('');
      files.push({
        path: `lib${i}.sh`,
        content: `#!/bin/bash\n${prev}die${i}() { echo "fatal" >&2; exit 1; }\n${fns}f${i}_0 "$@"\n`,
      });
    }
    return files;
  }

  it('analyzes every kind in well under the budget, with sound models', async () => {
    const files = generate(300);
    const times: Record<string, number> = {};
    const models: Record<string, DiagramModel> = {};
    for (const kind of KINDS) {
      const t = performance.now();
      models[kind] = await bashAnalyzer.analyze(files, kind, {
        entry: kind === 'bash.flowchart' ? 'lib299.sh' : undefined,
      });
      times[kind] = Math.round(performance.now() - t);
    }
    for (const m of Object.values(models)) {
      expect(invariants(m)).toEqual([]);
      expect(m.diagnostics.filter((d) => d.level !== 'info')).toEqual([]);
    }
    const cg = models['bash.callgraph']!;
    expect(nodesOf(cg, 'script')).toHaveLength(300);
    expect(nodesOf(cg, 'function')).toHaveLength(300 * 6);
    expect(cg.edges.filter((e) => e.kind === 'source')).toHaveLength(299);
    // Loose bound so a slow CI machine passes; locally the three kinds take about 1.4 s together.
    expect({ total: Object.values(times).reduce((a, b) => a + b, 0) < 6000, times }).toEqual({
      total: true,
      times,
    });
  }, 60000);
});
