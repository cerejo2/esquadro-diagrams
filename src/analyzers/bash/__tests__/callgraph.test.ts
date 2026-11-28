// bash.callgraph rules (PROMPT.md §7.3), on small original scripts.
import { describe, expect, it } from 'vitest';
import { bashAnalyzer } from '..';
import { analyze, edgeList, nodesOf } from './helpers';

describe('detection', () => {
  it.each([
    ['a.sh', 'echo hi', 1],
    ['a.bash', 'echo hi', 1],
    ['tool', '#!/bin/bash\necho hi', 1],
    ['tool', '#!/usr/bin/env bash\necho hi', 1],
    ['tool', '#!/bin/sh\necho hi', 1],
    ['tool', '#!/usr/bin/env zsh\necho hi', 1],
    ['tool', '#!/usr/bin/env python3\nprint(1)', 0],
    ['notes.txt', 'echo hi', 0],
    ['Main.java', 'class Main {}', 0],
  ])('%s with %j → %d', (path, content, score) => {
    expect(bashAnalyzer.detect({ path, content })).toBe(score);
  });
});

describe('function and script nodes', () => {
  it('accepts the three ways to define a function, and one script node per file', async () => {
    const m = await analyze({ 'a.sh': 'one() { :; }\nfunction two { :; }\nfunction three() { :; }\n' });
    expect(nodesOf(m, 'function').map((n) => n.name)).toEqual(['one', 'two', 'three']);
    expect(nodesOf(m, 'script').map((n) => n.name)).toEqual(['a.sh']);
  });

  it('names a script without extension after the file and groups functions by file', async () => {
    const m = await analyze({ 'bin/tool': '#!/bin/bash\nhelp() { :; }\nhelp\n' });
    const script = nodesOf(m, 'script')[0]!;
    expect(script.name).toBe('tool');
    expect(script.ref).toEqual({ file: 'bin/tool', line: 1 });
    expect(nodesOf(m, 'function')[0]!.group).toBe('bin/tool');
    expect(edgeList(m)).toEqual(['call tool->help']);
  });

  it('gives every node evidence with the rule and the line', async () => {
    const m = await analyze({ 'a.sh': '\n\nwork() {\n  :\n}\nwork\n' });
    const fn = nodesOf(m, 'function')[0]!;
    expect(fn.evidence).toEqual([
      { rule: 'bash.function', ref: { file: 'a.sh', line: 3, endLine: 5 }, note: 'defined in a.sh' },
    ]);
    expect(nodesOf(m, 'script')[0]!.evidence![0]!.rule).toBe('bash.script');
  });

  it('keeps functions with the same name in different files apart', async () => {
    const m = await analyze({ 'a.sh': 'go() { :; }\ngo\n', 'b.sh': 'go() { :; }\ngo\n' });
    const ids = nodesOf(m, 'function').map((n) => n.id);
    expect(new Set(ids).size).toBe(2);
    expect(edgeList(m)).toEqual(['call a.sh->go', 'call b.sh->go']);
    const a = m.edges.find((e) => e.from.node === 'script:a.sh')!;
    expect(a.to.node).toBe('function:a.sh#go');
  });

  it('reports a function defined twice in one file and analyzes both bodies', async () => {
    const m = await analyze({ 'a.sh': 'x() { :; }\ny() { :; }\nf() { x; }\nf() { y; }\n' });
    expect(nodesOf(m, 'function').map((n) => n.name)).toEqual(['x', 'y', 'f']);
    expect(edgeList(m)).toEqual(['call f->x', 'call f->y']);
    expect(m.diagnostics.map((d) => d.message)).toContain(
      'function f is defined again in a.sh; both bodies are analyzed',
    );
  });
});

describe('call edges', () => {
  const lib = 'a() { :; }\nb() { :; }\nc() { :; }\n';

  it.each([
    ['a plain command', 'main() { a; }', ['call main->a']],
    ['$(...)', 'main() { x=$(a); }', ['call main->a']],
    ['nested $(...) inside a string', 'main() { echo "$(b "$(a)")"; }', ['call main->b', 'call main->a']],
    ['<(...)', 'main() { while read -r l; do :; done < <(a); }', ['call main->a']],
    ['a pipeline', 'main() { a | grep x | b; }', ['call main->a', 'call main->b']],
    ['an if condition', 'main() { if a; then b; fi; }', ['call main->a', 'call main->b']],
    ['&& and ||', 'main() { a && b || c; }', ['call main->a', 'call main->b', 'call main->c']],
    ['a group after ||', 'main() { [[ -n $1 ]] || { a; exit 1; }; }', ['call main->a']],
    ['local x=$(...)', 'main() { local v=$(c); }', ['call main->c']],
    ['a while body fed by a pipeline', 'main() { ls | while read -r f; do b "$f"; done; }', ['call main->b']],
    ['a case branch', 'main() { case $1 in x) a ;; *) c ;; esac; }', ['call main->a', 'call main->c']],
  ])('finds calls in %s', async (_what, code, want) => {
    const m = await analyze({ 'a.sh': `${lib}${code}\n` });
    expect(edgeList(m).filter((e) => e.startsWith('call main'))).toEqual(want);
  });

  it('counts repeated calls in the label and keeps one edge per pair', async () => {
    const m = await analyze({ 'a.sh': 'log() { :; }\nrun() {\n  log a\n  log b\n  log c\n}\n' });
    expect(edgeList(m)).toEqual(['call run->log [3]']);
    const e = m.edges[0]!;
    expect(e.evidence.map((x) => x.ref?.line)).toEqual([3, 4, 5]);
    expect(e.confidence).toBe(1);
  });

  it('draws recursion as a loop', async () => {
    const m = await analyze({ 'a.sh': 'walk() { walk "$1/x"; }\n' });
    expect(edgeList(m)).toEqual(['call walk->walk']);
  });

  it('ignores builtins, dynamic command names and a function name passed as an argument', async () => {
    const m = await analyze({ 'a.sh': 'job() { :; }\nrun() { "$@"; $cmd; echo job; printf "%s" job; }\nrun job\n' });
    expect(edgeList(m)).toEqual(['call a.sh->run']);
  });

  it('does not attribute calls inside a nested function to the outer one', async () => {
    const m = await analyze({ 'a.sh': 'x() { :; }\nouter() {\n  inner() { x; }\n  inner\n}\n' });
    expect(edgeList(m)).toEqual(['call outer->inner', 'call inner->x']);
  });
});

describe('trap', () => {
  it('links a trap handler with label trap, apart from plain calls to it', async () => {
    const m = await analyze({ 'a.sh': 'bye() { :; }\nmain() {\n  trap bye EXIT\n  bye\n}\n' });
    expect(edgeList(m)).toEqual(['call main->bye [trap]', 'call main->bye']);
    expect(m.edges[0]!.evidence[0]).toEqual({ rule: 'bash.call.trap', ref: { file: 'a.sh', line: 3 } });
    expect(m.edges[0]!.confidence).toBe(1);
  });

  it('reads the commands of a quoted handler with lower confidence', async () => {
    const m = await analyze({ 'a.sh': "stop() { :; }\nsave() { :; }\ntrap 'save; stop 1' INT TERM\n" });
    expect(edgeList(m)).toEqual(['call a.sh->save [trap]', 'call a.sh->stop [trap]']);
    expect(m.edges.every((e) => e.confidence === 0.9)).toBe(true);
  });

  it('ignores trap resets and empty handlers', async () => {
    const m = await analyze({ 'a.sh': "x() { :; }\ntrap - EXIT\ntrap '' INT\ntrap -p\n" });
    expect(m.edges).toEqual([]);
  });
});

describe('source', () => {
  it('links source and . between scripts, resolved from the file folder', async () => {
    const m = await analyze({
      'app/main.sh': 'source lib/util.sh\n. ./lib/more.sh\nhelp\n',
      'app/lib/util.sh': 'help() { :; }\n',
      'app/lib/more.sh': ':\n',
    });
    expect(edgeList(m).filter((e) => e.startsWith('source'))).toEqual([
      'source main.sh->util.sh',
      'source main.sh->more.sh',
    ]);
    expect(edgeList(m)).toContain('call main.sh->help');
    expect(m.edges.find((e) => e.kind === 'call')!.evidence[0]!.rule).toBe('bash.call.sourced');
    expect(m.diagnostics.filter((d) => d.level !== 'info')).toEqual([]);
  });

  it('merges two source lines of the same file into one edge', async () => {
    const m = await analyze({ 'a.sh': 'source b.sh\nsource ./b.sh\n', 'b.sh': ':\n' });
    expect(edgeList(m)).toEqual(['source a.sh->b.sh']);
    expect(m.edges[0]!.evidence).toHaveLength(2);
  });

  it('warns about a path with a variable and guesses from its literal end with low confidence', async () => {
    const m = await analyze({ 'a.sh': 'source "$HERE/b.sh"\n', 'b.sh': ':\n' });
    expect(edgeList(m)).toEqual(['source a.sh->b.sh']);
    expect(m.edges[0]!.confidence).toBeLessThan(1);
    expect(m.edges[0]!.evidence[0]!.rule).toBe('bash.source.dynamic');
    expect(m.diagnostics).toContainEqual({
      level: 'warn',
      message: 'source path $HERE/b.sh depends on a variable; guessed b.sh',
      ref: { file: 'a.sh', line: 1 },
    });
  });

  it('warns and links nothing when a variable path matches no file', async () => {
    const m = await analyze({ 'a.sh': 'source "$CONF"\n' });
    expect(m.edges).toEqual([]);
    expect(m.diagnostics.map((d) => [d.level, d.message])).toEqual([
      ['warn', 'source path $CONF depends on a variable; not followed'],
    ]);
  });

  it('notes a literal path outside the project as info', async () => {
    const m = await analyze({ 'a.sh': '. /etc/os-release\n' });
    expect(m.diagnostics.map((d) => [d.level, d.message])).toEqual([
      ['info', 'sourced file /etc/os-release is not in the project'],
    ]);
  });

  it('resolves a call to a function of the script that sources the library', async () => {
    const m = await analyze({ 'main.sh': 'source lib.sh\nhook() { :; }\n', 'lib.sh': 'run() { hook; }\n' });
    const e = m.edges.find((x) => x.kind === 'call')!;
    expect(edgeList(m)).toContain('call run->hook');
    expect(e.confidence).toBe(0.9);
    expect(e.evidence[0]!.rule).toBe('bash.call.caller');
  });

  it('links a call to a function of an unrelated file with low confidence', async () => {
    const m = await analyze({ 'a.sh': 'helper() { :; }\n', 'b.sh': 'helper\n' });
    expect(edgeList(m)).toEqual(['call b.sh->helper']);
    expect(m.edges[0]!.confidence).toBe(0.6);
    expect(m.edges[0]!.evidence[0]!.rule).toBe('bash.call.global');
  });
});

describe('other scripts and external commands', () => {
  it('links a script run by path or through bash to its script node', async () => {
    const m = await analyze({
      'run.sh': './step.sh\nbash tools/other.sh x\n',
      'step.sh': ':\n',
      'tools/other.sh': ':\n',
    });
    expect(edgeList(m)).toEqual(['call run.sh->step.sh', 'call run.sh->other.sh']);
    expect(m.edges.every((e) => e.confidence === 0.9)).toBe(true);
  });

  it('hides external commands by default', async () => {
    const m = await analyze({ 'a.sh': 'pack() { tar -czf x.tgz . && sha256sum x.tgz | cut -d" " -f1; }\n' });
    expect(nodesOf(m, 'external')).toEqual([]);
    expect(m.edges).toEqual([]);
  });

  it('shows them with showExternal, grouped by family, one node per command', async () => {
    const m = await analyze(
      { 'a.sh': 'pack() { tar -czf x.tgz . && sha256sum x.tgz | cut -d" " -f1; tar -tf x.tgz; frobnicate; }\n' },
      'bash.callgraph',
      { showExternal: true },
    );
    expect(nodesOf(m, 'external').map((n) => `${n.name}:${n.group}`)).toEqual([
      'cut:text',
      'frobnicate:other',
      'sha256sum:hashing',
      'tar:archive',
    ]);
    expect(edgeList(m)).toEqual([
      'call pack->tar [2]',
      'call pack->sha256sum',
      'call pack->cut',
      'call pack->frobnicate',
    ]);
    // A command the analyzer does not know could be a function from elsewhere: lower confidence.
    expect(m.edges.find((e) => e.to.node === 'external:frobnicate')!.confidence).toBe(0.8);
  });
});
