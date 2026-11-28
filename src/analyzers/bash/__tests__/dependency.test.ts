// bash.dependency rules (PROMPT.md §7.3) and the analyzer's robustness contract.
import { describe, expect, it } from 'vitest';
import { bashAnalyzer } from '..';
import { analyze, edgeList, nodesOf } from './helpers';

describe('bash.dependency', () => {
  it('links each script to the external commands it uses, with the count', async () => {
    const m = await analyze(
      { 'a.sh': 'f() { grep -c x "$1"; }\ngrep y z | sort\nf q\necho done\n' },
      'bash.dependency',
    );
    expect(edgeList(m)).toEqual(['uses a.sh->grep [2]', 'uses a.sh->sort [1]']);
    expect(nodesOf(m, 'external').map((n) => `${n.name}:${n.group}`)).toEqual(['grep:text', 'sort:text']);
    expect(m.edges[0]!.evidence.map((e) => e.ref?.line)).toEqual([1, 2]);
  });

  it('shows external commands even without showExternal: they are the point of this diagram', async () => {
    const m = await analyze({ 'a.sh': 'date\n' }, 'bash.dependency', { showExternal: false });
    expect(edgeList(m)).toEqual(['uses a.sh->date [1]']);
  });

  it('adds the files read and written by redirections as io nodes', async () => {
    const m = await analyze(
      {
        'a.sh':
          'sort < in.txt > out.txt\necho x >> log.txt 2>/dev/null\necho y >&2\nwhile read -r l; do :; done < "$list"\n',
      },
      'bash.dependency',
    );
    expect(edgeList(m).filter((e) => !e.includes('sort'))).toEqual([
      'uses a.sh->in.txt [lê]',
      'uses a.sh->out.txt [escreve]',
      'uses a.sh->log.txt [escreve]',
      'uses a.sh->$list [lê]',
    ]);
    expect(nodesOf(m, 'io').map((n) => n.name)).toEqual(['$list', 'in.txt', 'log.txt', 'out.txt']);
    // A file name taken from a variable is a guess.
    expect(m.edges.find((e) => e.to.node === 'io:$list')!.confidence).toBe(0.7);
  });

  it('reads the literal arguments of cp, mv and rm, and skips the ones with variables', async () => {
    const m = await analyze(
      { 'a.sh': 'cp -r src/a.conf backup/a.conf\nmv old.log archive/\nrm -f tmp.lock "$x"\n' },
      'bash.dependency',
      { locale: 'en' },
    );
    expect(edgeList(m).filter((e) => !/->(cp|mv|rm) /.test(e))).toEqual([
      'uses a.sh->src/a.conf [reads]',
      'uses a.sh->backup/a.conf [writes]',
      'uses a.sh->old.log [reads]',
      'uses a.sh->archive/ [writes]',
      'uses a.sh->tmp.lock [removes]',
    ]);
  });

  it('keeps source edges and links scripts run by path', async () => {
    const m = await analyze({ 'a.sh': 'source b.sh\n./c.sh\n', 'b.sh': ':\n', 'c.sh': ':\n' }, 'bash.dependency');
    expect(edgeList(m)).toEqual(['source a.sh->b.sh', 'uses a.sh->c.sh [1]']);
  });

  it('does not count project functions or builtins as external', async () => {
    const m = await analyze({ 'a.sh': 'tidy() { :; }\ntidy\ncd /tmp\nprintf x\nlocal y\n' }, 'bash.dependency');
    expect(m.edges).toEqual([]);
  });
});

describe('robustness', () => {
  it('never throws and reports syntax errors with a line, analyzing the rest', async () => {
    const m = await analyze({ 'a.sh': 'ok() { :; }\nif [[ -f x ]; then\nok\n' });
    expect(m.diagnostics.some((d) => d.level === 'error' && d.ref?.line)).toBe(true);
    expect(nodesOf(m, 'function').map((n) => n.name)).toEqual(['ok']);
  });

  it.each(['bash.callgraph', 'bash.flowchart', 'bash.dependency'] as const)('%s survives garbage', async (kind) => {
    const m = await analyze({ 'a.sh': '}}} ((( $( `\n\0\u0001 fi done esac' }, kind);
    expect(m.kind).toBe(kind);
    expect(Array.isArray(m.diagnostics)).toBe(true);
  });

  it('turns an unsupported kind into a diagnostic', async () => {
    const m = await bashAnalyzer.analyze([{ path: 'a.sh', content: ':' }], 'java.class');
    expect(m.diagnostics.map((d) => d.level)).toEqual(['error']);
  });

  it('says so when there are no files', async () => {
    const m = await bashAnalyzer.analyze([], 'bash.callgraph');
    expect(m.diagnostics).toEqual([{ level: 'info', message: 'no shell scripts in the input' }]);
  });

  it('analyzes pasted code without a name or shebang', async () => {
    const m = await bashAnalyzer.analyze([{ path: 'snippet', content: 'f() { :; }\nf\n' }], 'bash.callgraph');
    expect(edgeList(m)).toEqual(['call snippet->f']);
  });

  it('skips non-shell files when some files are scripts', async () => {
    const m = await analyze({ 'a.sh': ':\n', 'README.md': '# hello\n' });
    expect(nodesOf(m, 'script').map((n) => n.name)).toEqual(['a.sh']);
  });

  it('strips a BOM and accepts CRLF line endings', async () => {
    const m = await analyze({ 'a.sh': '﻿g() {\r\n  :\r\n}\r\ng\r\n' });
    expect(edgeList(m)).toEqual(['call a.sh->g']);
    expect(m.diagnostics.filter((d) => d.level !== 'info')).toEqual([]);
  });

  it('gives the same model for the same input in any file order', async () => {
    const files = { 'b.sh': 'source a.sh\nx\n', 'a.sh': 'x() { y; }\ny() { :; }\n' };
    const one = await analyze(files);
    const two = await analyze(Object.fromEntries(Object.entries(files).reverse()));
    expect(one).toEqual(two);
  });
});
