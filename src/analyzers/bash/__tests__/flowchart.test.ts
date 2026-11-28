// bash.flowchart rules (PROMPT.md §7.3), on small original scripts.
import { describe, expect, it } from 'vitest';
import { analyze, arrows, counts, flow, labels, nodesOf, shown } from './helpers';

describe('terminators', () => {
  it('starts with Início and ends with Fim when the code runs off the end', async () => {
    const m = await flow('a=1\n');
    expect(arrows(m)).toEqual(['Início --> a=1', 'a=1 --> Fim']);
    expect(m.title).toBe('x.sh');
  });

  it('ends at exit and return without a separate end node', async () => {
    const m = await flow('cp a b\nexit 3\n');
    expect(arrows(m)).toEqual(['Início --> cp a b', 'cp a b --> Fim (exit 3)']);
    const r = await analyze({ 'x.sh': 'f() {\n  return 1\n}\n' }, 'bash.flowchart', { entry: 'f' });
    expect(arrows(r)).toEqual(['Início: f --> Retorna 1']);
  });

  it('draws nothing after exit (unreachable code)', async () => {
    const m = await flow('exit 0\necho never\n');
    expect(counts(m)).toEqual({ terminator: 2, flow: 1 });
  });

  it('uses English words with locale en', async () => {
    const m = await flow('if [[ -z $1 ]]; then exit 1; fi\n', { locale: 'en' });
    expect(arrows(m)).toEqual(['Start --> $1 empty?', '$1 empty? -[yes]-> End (exit 1)', '$1 empty? -[no]-> End']);
  });
});

describe('process and I/O blocks', () => {
  it('merges consecutive commands into one process block of up to 3 lines', async () => {
    const m = await flow('a=1\nb=2\nmkdir -p out\ncd out\ntouch x\n');
    const p = nodesOf(m, 'process');
    expect(p).toHaveLength(1);
    expect(shown(p[0]!)).toBe('a=1\nb=2\n… (+3)');
    expect(p[0]!.ref).toEqual({ file: 'x.sh', line: 1, endLine: 5 });
    expect(p[0]!.evidence).toHaveLength(5);
  });

  it('keeps up to 3 commands as they are', async () => {
    const m = await flow('a=1\nb=2\nc=3\n');
    expect(labels(m, 'process')).toEqual(['a=1\nb=2\nc=3']);
  });

  it('starts a new block after an I/O node, and merges I/O lines too', async () => {
    const m = await flow('x=1\necho "one"\necho "two"\ny=2\n');
    expect(arrows(m)).toEqual([
      'Início --> x=1',
      'x=1 --> Mostrar "one" / Mostrar "two"',
      'Mostrar "one" / Mostrar "two" --> y=2',
      'y=2 --> Fim',
    ]);
  });

  it('does not merge into a block that two paths reach', async () => {
    const m = await flow('if [[ -f a ]]; then x=1; fi\ny=2\nz=3\n');
    expect(labels(m, 'process')).toEqual(['x=1', 'y=2\nz=3']);
  });

  it('draws nothing for bare declarations and no-ops', async () => {
    const m = await flow('local a b\n:\ntrue\nexport C=1\n');
    expect(labels(m, 'process')).toEqual(['export C=1']);
  });

  it.each([
    ['echo "hi"', 'Mostrar "hi"'],
    ['echo -n hi', 'Mostrar hi'],
    ['printf "%s\\n" "$x"', 'Mostrar "%s\\n" "$x"'],
    ['read -r name age', 'Ler name, age'],
    ['echo "$line" >> log.txt', 'Escrever "$line" em log.txt'],
    ['sort data > "$out"', 'sort data > "$out"'],
    ['cat <<EOF\nhello\nEOF', 'Mostrar texto (cat)'],
  ])('%s is an I/O node: %s', async (code, label) => {
    const m = await flow(`${code}\n`);
    expect(labels(m, 'io')).toEqual([label]);
  });

  it('keeps stderr messages and /dev/null as plain output, not files', async () => {
    const m = await flow('echo oops >&2\nrm -f x 2>/dev/null\n');
    expect(labels(m, 'io')).toEqual(['Mostrar oops']);
    expect(labels(m, 'process')).toEqual(['rm -f x 2>/dev/null']);
  });
});

describe('subroutines', () => {
  it('draws a call to a project function as a subroutine without expanding it', async () => {
    const m = await flow('setup() { a=1; b=2; }\nsetup "$@"\nres=$(setup)\n');
    expect(arrows(m)).toEqual(['Início --> setup', 'setup --> res=$(setup)', 'res=$(setup) --> Fim']);
    expect(nodesOf(m, 'subroutine').map((n) => n.name)).toEqual(['setup', 'setup']);
    expect(nodesOf(m, 'process')).toEqual([]);
  });

  it('ends the path after a function that always exits', async () => {
    const m = await flow('die() {\n  echo "$1" >&2\n  exit 1\n}\n[[ -r cfg ]] || die "no cfg"\necho ok\n');
    expect(arrows(m)).toEqual([
      'Início --> cfg pode ser lido?',
      'cfg pode ser lido? -[não]-> die',
      'cfg pode ser lido? -[sim]-> Mostrar ok',
      'Mostrar ok --> Fim',
    ]);
    const die = nodesOf(m, 'subroutine')[0]!;
    expect(die.evidence!.map((e) => e.rule)).toEqual(['bash.flow.call', 'bash.flow.noreturn']);
  });

  it('treats a function that exits only on one branch as returning', async () => {
    const m = await flow('check() { if [[ -z $1 ]]; then exit 1; fi; }\ncheck "$x"\necho ok\n');
    expect(arrows(m)).toContain('check --> Mostrar ok');
  });
});

describe('decisions', () => {
  it('chains elif on the no exit and joins every branch into the next node', async () => {
    const m = await flow(
      'if [[ -d $p ]]; then\n  echo dir\nelif [[ -f $p ]]; then\n  echo file\nelse\n  echo other\nfi\ndone=1\n',
    );
    expect(arrows(m)).toEqual([
      'Início --> p é diretório?',
      'p é diretório? -[sim]-> Mostrar dir',
      'p é diretório? -[não]-> p é ficheiro?',
      'p é ficheiro? -[sim]-> Mostrar file',
      'p é ficheiro? -[não]-> Mostrar other',
      'Mostrar dir --> done=1',
      'Mostrar file --> done=1',
      'Mostrar other --> done=1',
      'done=1 --> Fim',
    ]);
    expect(m.edges.find((e) => e.label === 'sim')!.evidence[0]!.rule).toBe('bash.flow.branch');
  });

  it('gives case one exit per pattern, with outro for * or for no match', async () => {
    const m = await flow('case $cmd in\n  start|up) a=1 ;;\n  stop) b=2 ;;\n  *) c=3 ;;\nesac\n');
    expect(arrows(m).filter((a) => a.startsWith('cmd?'))).toEqual([
      'cmd? -[start | up]-> a=1',
      'cmd? -[stop]-> b=2',
      'cmd? -[outro]-> c=3',
    ]);
    const n = await flow('case $1 in\n  -h) h=1 ;;\nesac\n');
    expect(arrows(n).filter((a) => a.startsWith('$1?'))).toEqual(['$1? -[-h]-> h=1', '$1? -[outro]-> Fim']);
  });

  it('draws while as a loop decision with an edge back from the body', async () => {
    const m = await flow('while [[ $n -gt 0 ]]; do\n  n=$((n - 1))\ndone\n');
    expect(arrows(m)).toEqual([
      'Início --> n maior que 0?',
      'n maior que 0? -[sim]-> n=$((n - 1))',
      'n=$((n - 1)) --> n maior que 0?',
      'n maior que 0? -[não]-> Fim',
    ]);
    const back = m.edges[2]!;
    expect(back.evidence[0]!.rule).toBe('bash.flow.loop');
  });

  it('enters an until loop on não and leaves on sim', async () => {
    const m = await flow('until [[ -e ready ]]; do\n  sleep 1\ndone\n');
    expect(arrows(m)).toEqual([
      'Início --> ready existe?',
      'ready existe? -[não]-> sleep 1',
      'sleep 1 --> ready existe?',
      'ready existe? -[sim]-> Fim',
    ]);
  });

  it('labels for, read and getopts loops in words', async () => {
    const m = await flow(
      'for f in *.txt; do wc -l "$f"; done\nwhile read -r l; do echo "$l"; done < in.txt\nwhile getopts "ab" o; do :; done\n',
    );
    expect(labels(m, 'decision')).toEqual(['mais f em *.txt?', 'há mais linhas?', 'há mais opções?']);
  });

  it('has no exit for while true except break, and continue goes back to the decision', async () => {
    const m = await flow(
      'while true; do\n  read -r x\n  if [[ -z $x ]]; then break; fi\n  if [[ $x == "#"* ]]; then continue; fi\n  echo "$x"\ndone\necho bye\n',
    );
    expect(arrows(m)).toEqual([
      'Início --> repetir?',
      'repetir? -[sim]-> Ler x',
      'Ler x --> x vazio?',
      'x vazio? -[não]-> x igual a "#"*?',
      'x igual a "#"*? -[sim]-> repetir?',
      'x igual a "#"*? -[não]-> Mostrar "$x"',
      'Mostrar "$x" --> repetir?',
      'x vazio? -[sim]-> Mostrar bye',
      'Mostrar bye --> Fim',
    ]);
  });

  it('reads && and || as a decision on the left side', async () => {
    const m = await flow('[[ -d out ]] || mkdir out\n[[ -n $v ]] && echo "$v"\n');
    expect(arrows(m)).toEqual([
      'Início --> out é diretório?',
      'out é diretório? -[não]-> mkdir out',
      'mkdir out --> v não vazio?',
      'out é diretório? -[sim]-> v não vazio?',
      'v não vazio? -[sim]-> Mostrar "$v"',
      'Mostrar "$v" --> Fim',
      'v não vazio? -[não]-> Fim',
    ]);
  });

  it('draws the commands before a loop at the end of a pipeline, then the loop', async () => {
    const m = await flow('ls -1 | sort | while read -r f; do echo "$f"; done\n');
    expect(arrows(m).slice(0, 2)).toEqual(['Início --> ls -1 | sort', 'ls -1 | sort --> há mais linhas?']);
  });

  it('counts a C-style for as one loop decision', async () => {
    const m = await flow('for ((i = 0; i < 3; i++)); do echo $i; done\n');
    expect(labels(m, 'decision')).toEqual(['i < 3?']);
    expect(counts(m)).toEqual({ terminator: 2, decision: 1, io: 1, flow: 4 });
  });
});

describe('entry', () => {
  const script = 'helper() {\n  if [[ -z $1 ]]; then return 1; fi\n  echo "$1"\n}\nhelper "$@"\n';

  it('is the top-level code by default and with entry script', async () => {
    for (const entry of [undefined, 'script']) {
      const m = await flow(script, { entry });
      expect(arrows(m)).toEqual(['Início --> helper', 'helper --> Fim']);
    }
  });

  it('can be a function', async () => {
    const m = await flow(script, { entry: 'helper' });
    expect(arrows(m)).toEqual([
      'Início: helper --> $1 vazio?',
      '$1 vazio? -[sim]-> Retorna 1',
      '$1 vazio? -[não]-> Mostrar "$1"',
      'Mostrar "$1" --> Fim',
    ]);
    expect(m.title).toBe('helper');
  });

  it('can name a file, and picks a script that is not sourced by default', async () => {
    const files = { 'a.sh': 'x=1\n', 'b.sh': 'source a.sh\ny=2\n', 'c.sh': 'z=3\n' };
    const byDefault = await analyze(files, 'bash.flowchart');
    expect(byDefault.title).toBe('b.sh');
    expect(byDefault.diagnostics.map((d) => d.level)).toEqual(['info']);
    const nested = await analyze({ 'checks/a.sh': 'x=1\n', 'z.sh': 'y=2\n' }, 'bash.flowchart');
    expect(nested.title).toBe('z.sh');
    const named = await analyze(files, 'bash.flowchart', { entry: 'c.sh' });
    expect(labels(named, 'process')).toEqual(['z=3']);
  });

  it('accepts file:function when two files define the same function', async () => {
    const files = { 'a.sh': 'go() { x=1; }\n', 'b.sh': 'go() { y=2; }\n' };
    const ambiguous = await analyze(files, 'bash.flowchart', { entry: 'go' });
    expect(ambiguous.diagnostics.map((d) => d.level)).toEqual(['warn']);
    const exact = await analyze(files, 'bash.flowchart', { entry: 'b.sh:go' });
    expect(labels(exact, 'process')).toEqual(['y=2']);
    expect(exact.diagnostics).toEqual([]);
  });

  it('reports an unknown entry as an error and returns an empty diagram', async () => {
    const m = await flow(script, { entry: 'nope' });
    expect(m.nodes).toEqual([]);
    expect(m.diagnostics.map((d) => [d.level, d.message])).toEqual([
      ['error', 'entry nope is neither a function nor a script of the project'],
    ]);
  });
});

describe('ids and evidence', () => {
  it('gives every node a unique, stable id and evidence with file:line', async () => {
    const code = 'if [[ -f a ]]; then echo a; fi; if [[ -f b ]]; then echo b; fi\n';
    const a = await flow(code);
    const b = await flow(code);
    expect(a.nodes.map((n) => n.id)).toEqual(b.nodes.map((n) => n.id));
    expect(new Set(a.nodes.map((n) => n.id)).size).toBe(a.nodes.length);
    expect(new Set(a.edges.map((e) => e.id)).size).toBe(a.edges.length);
    expect(a.nodes.filter((n) => n.evidence?.[0]?.ref?.file !== 'x.sh').map((n) => n.id)).toEqual([]);
    expect(a.edges.filter((e) => !e.evidence[0]?.rule.startsWith('bash.flow')).map((e) => e.id)).toEqual([]);
  });
});
