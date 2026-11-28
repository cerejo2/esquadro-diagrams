// Adversarial edge cases for the C analyzer. The fixtures under fixtures/c/edge-*/
// are scored by fixtures.test.ts; this file checks what an expected.yaml cannot
// say: ids, evidence, determinism, robustness and speed.
import { describe, expect, it } from 'vitest';
import { type FixtureCase, loadFixtures } from '../../../bench/fixtures';
import type { DiagramKind, DiagramModel, SourceFile } from '../../../model/types';
import { cAnalyzer } from '..';
import { analyze, attrs, edge, edgeList, loud, names, node, ops } from './helpers';

const KINDS: DiagramKind[] = ['c.struct', 'c.callgraph', 'c.include'];
const ALL_ON = { showAccessors: true, showDependencies: true, showExternal: true, showMain: true };
const publicCases: FixtureCase[] = await loadFixtures({ lang: 'c', includePrivate: false });

const run = (files: SourceFile[], kind: DiagramKind, opts = {}) => cAnalyzer.analyze(files, kind, opts);
const internal = (m: DiagramModel) => m.diagnostics.filter((d) => /internal error/.test(d.message));

/** Structural checks every model must pass, whatever the input. */
function wellFormed(m: DiagramModel, files: readonly SourceFile[]): string[] {
  const problems: string[] = [];
  const lines = new Map(files.map((f) => [f.path, f.content.split('\n').length]));
  const checkRef = (what: string, ref: { file: string; line: number } | undefined) => {
    if (!ref) return problems.push(`${what}: no ref`);
    const max = lines.get(ref.file);
    if (max === undefined) problems.push(`${what}: ref to unknown file ${ref.file}`);
    if (!Number.isInteger(ref.line) || ref.line < 1 || (max !== undefined && ref.line > max))
      problems.push(`${what}: bad line ${ref.line} in ${ref.file}`);
  };
  const ids = new Set<string>();
  for (const n of m.nodes) {
    if (ids.has(n.id)) problems.push(`duplicate node id ${n.id}`);
    ids.add(n.id);
    if (n.kind !== 'external') checkRef(`node ${n.id}`, n.ref);
    const ev = n.evidence ?? [];
    if (!ev.length) problems.push(`node ${n.id}: no evidence`);
    ev.forEach((e, i) => checkRef(`node ${n.id} evidence ${i} (${e.rule})`, e.ref));
  }
  const edgeIds = new Set<string>();
  const shapes = new Set<string>();
  for (const e of m.edges) {
    if (edgeIds.has(e.id)) problems.push(`duplicate edge id ${e.id}`);
    edgeIds.add(e.id);
    if (!ids.has(e.from.node) || !ids.has(e.to.node)) problems.push(`edge ${e.id}: end is not a node`);
    const shape = `${e.kind} ${e.from.node} ${e.to.node} ${e.to.role ?? ''}`;
    if (shapes.has(shape)) problems.push(`duplicate edge ${shape}`);
    shapes.add(shape);
    if (!(e.confidence > 0 && e.confidence <= 1)) problems.push(`edge ${e.id}: confidence ${e.confidence}`);
    if (!e.evidence.length) problems.push(`edge ${e.id}: no evidence`);
    e.evidence.forEach((ev, i) => checkRef(`edge ${e.id} evidence ${i} (${ev.rule})`, ev.ref));
    if (!e.evidence.every((ev) => ev.rule.startsWith('c.'))) problems.push(`edge ${e.id}: rule outside c.*`);
  }
  for (const d of m.diagnostics) if (d.ref) checkRef(`diagnostic "${d.message}"`, d.ref);
  return problems;
}

const files = (sources: Record<string, string>): SourceFile[] =>
  Object.entries(sources).map(([path, content]) => ({ path, content }));

// ------------------------------------------------------------------ every model

describe('every public C fixture, every kind, with and without options', () => {
  it.each(publicCases.map((c) => [c.name, c] as const))('%s is well formed', async (_name, fx) => {
    for (const kind of KINDS)
      for (const opts of [{}, ALL_ON]) {
        const m = await run(fx.files, kind, opts);
        expect({ kind, opts, problems: wellFormed(m, fx.files), internal: internal(m) }).toEqual({
          kind,
          opts,
          problems: [],
          internal: [],
        });
      }
  });

  it.each(publicCases.map((c) => [c.name, c] as const))(
    '%s gives the same model on every run and file order',
    async (_n, fx) => {
      for (const kind of KINDS) {
        const a = JSON.stringify(await run(fx.files, kind, ALL_ON));
        const b = JSON.stringify(await run(fx.files, kind, ALL_ON));
        const c = JSON.stringify(await run([...fx.files].reverse(), kind, ALL_ON));
        expect(b).toBe(a);
        expect(c).toBe(a);
      }
    },
  );
});

// ------------------------------------------------------------- empty and odd input

describe('empty and odd input never throws', () => {
  const odd: [string, SourceFile[]][] = [
    ['no files', []],
    ['an empty file', files({ 'a.c': '' })],
    ['only whitespace', files({ 'a.c': '  \n\t\r\n  ' })],
    ['only comments', files({ 'a.c': '/* nothing here */\n// nor here\n', 'a.h': '// header comment only\n' })],
    ['no C file', files({ 'README.md': '# hi', 'run.sh': 'echo hi' })],
    ['binary-looking garbage', files({ 'a.c': '\u0000\u0001\u0002}{)(;;##@@�\u0000int' })],
    ['an unclosed comment', files({ 'a.c': 'int f(void) { return 1; }\n/* never closed\nint g(void) {}' })],
    ['an unclosed string', files({ 'a.c': 'const char *s = "never closed;\nint g(void) { return 0; }' })],
    ['only a directive', files({ 'a.h': '#pragma once' })],
    ['a stray #endif', files({ 'a.c': '#endif\nint f(void) { return 0; }' })],
  ];
  it.each(odd)('%s', async (_name, input) => {
    for (const kind of KINDS)
      for (const opts of [{}, ALL_ON]) {
        const m = await run(input, kind, opts);
        expect(m.kind).toBe(kind);
        expect(internal(m)).toEqual([]);
        expect(wellFormed(m, input)).toEqual([]);
      }
  });

  it('no C file gives one info diagnostic and nothing else', async () => {
    const m = await run(files({ 'notes.txt': 'int x;' }), 'c.struct');
    expect(m.nodes).toEqual([]);
    expect(m.diagnostics.map((d) => d.level)).toEqual(['info']);
  });

  it('an unsupported kind is an error diagnostic, not an exception', async () => {
    const m = await run(files({ 'a.c': 'int x;' }), 'java.class');
    expect(m.diagnostics.map((d) => d.level)).toEqual(['error']);
  });

  it('only comments: no nodes besides the file itself, no diagnostics', async () => {
    const src = { 'a.c': '/* só um comentário, com acentos */\n// e outro\n' };
    for (const kind of ['c.struct', 'c.callgraph'] as DiagramKind[]) {
      const m = await analyze(src, kind);
      expect(m.nodes).toEqual([]);
      expect(m.diagnostics).toEqual([]);
    }
    expect(names(await analyze(src, 'c.include'))).toEqual(['source-file:a.c']);
  });
});

// ------------------------------------------------------------- text encodings

describe('BOM, CRLF and UTF-8', () => {
  const lf = [
    '// Módulo — ç ã õ é',
    '#include "util.h"',
    '#ifdef DEBUG',
    'int trace(void);',
    '#endif',
    'struct item { int a; struct item *next; };',
    'int item_len(struct item *p) { return trace() + p->a; }',
    'int main(void) { return item_len(0); }',
    '',
  ].join('\n');
  const header = 'int trace(void);\n';

  it('a file with BOM and CRLF gives exactly the model of the LF file', async () => {
    for (const kind of KINDS) {
      const a = await analyze({ 'a.c': lf, 'util.h': header }, kind, ALL_ON);
      const b = await analyze({ 'a.c': `﻿${lf.replace(/\n/g, '\r\n')}`, 'util.h': `﻿${header}` }, kind, ALL_ON);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      expect(JSON.stringify(b)).not.toContain('\\r');
    }
  });

  it('accented identifiers and file names keep their text', async () => {
    const m = await analyze(
      { 'conversão.c': 'static int dobro_ação(int x) { return x + x; }\nint main(void) { return dobro_ação(1); }' },
      'c.callgraph',
    );
    expect(edgeList(m)).toEqual(['call main->dobro_ação']);
    expect(node(m, 'dobro_ação').group).toBe('conversão.c');
    expect(loud(m)).toEqual([]);
  });
});

// ---------------------------------------------------------------- the rules, at the edges

describe('macros that look like functions', () => {
  const src = {
    'm.c': [
      '#define SQUARE(x) ((x) * (x))',
      '#define DECLARE(name) int name(void)',
      'DECLARE(hidden);',
      'int shown(void) { return SQUARE(2); }',
      'int main(void) { return shown() + hidden(); }',
    ].join('\n'),
  };

  it('are not expanded: a call to a macro is an external call in the "macro" group', async () => {
    const m = await analyze(src, 'c.callgraph', { showExternal: true });
    expect(node(m, 'SQUARE')).toMatchObject({ kind: 'external', group: 'macro' });
    expect(edge(m, 'call', 'shown', 'SQUARE')).toBeDefined();
    // DECLARE(hidden) is not expanded, so hidden is not a project function.
    expect(node(m, 'hidden').kind).toBe('external');
  });

  it('are hidden by default', async () => {
    const m = await analyze(src, 'c.callgraph');
    expect(names(m)).toEqual(['function:main', 'function:shown']);
  });
});

describe('#ifdef with different definitions in each branch', () => {
  it('a function defined in both branches of one file is one node with the calls of both', async () => {
    const m = await analyze(
      {
        'a.c': [
          '#ifdef FAST',
          'static int pick(void) { return quick(); }',
          '#else',
          'static int pick(void) { return careful(); }',
          '#endif',
          'int quick(void) { return 1; }',
          'int careful(void) { return 2; }',
          'int main(void) { return pick() + pick(); }',
        ].join('\n'),
      },
      'c.callgraph',
    );
    expect(m.nodes.filter((n) => n.name.startsWith('pick')).map((n) => n.id)).toEqual(['function:pick']);
    expect(edgeList(m)).toEqual(['call main->pick [2]', 'call pick->careful', 'call pick->quick']);
    expect(wellFormed(m, files({ 'a.c': 'x\n'.repeat(9) }))).toEqual([]);
  });

  it('a typedef defined in both branches keeps the first one, with one node', async () => {
    const m = await analyze({
      'a.h': '#ifdef WIDE\ntypedef struct { long v; } Sample;\n#else\ntypedef struct { short v; } Sample;\n#endif\n',
    });
    expect(names(m)).toEqual(['struct:Sample']);
    expect(attrs(m, 'Sample')).toEqual(['+ v: long']);
  });

  it('a function in two different files is still two nodes', async () => {
    const m = await analyze(
      { 'a.c': 'int f(void) { return 1; }', 'b.c': 'int f(void) { return 2; }\nint main(void) { return f(); }' },
      'c.callgraph',
    );
    expect(names(m)).toEqual(['function:f (a.c)', 'function:f (b.c)', 'function:main']);
    expect(edgeList(m)).toEqual(['call main->f (b.c)']);
  });
});

describe('typedefs of pointers to functions', () => {
  const src = {
    'f.h': [
      'typedef int (*Compare)(const void *a, const void *b);',
      'typedef void Visit(int value);',
      'typedef Compare CompareAlias;',
      'struct sorter { Compare cmp; CompareAlias again; Visit *visit; Visit **visits; int (*hooks[4])(int); };',
    ].join('\n'),
  };

  it('are typedef nodes, and fields that hold one are fn-pointer operations', async () => {
    const m = await analyze(src);
    expect(names(m)).toEqual(['struct:sorter', 'typedef:Compare', 'typedef:Visit']);
    const s = node(m, 'sorter');
    expect(s.operations?.map((o) => [o.name, o.flags])).toEqual([
      ['cmp', ['fn-pointer']],
      ['again', ['fn-pointer']],
      ['visit', ['fn-pointer']],
      ['hooks', ['fn-pointer']],
    ]);
    expect(ops(m, 'sorter')[2]).toBe('+ visit(value: int): void');
    // A pointer to pointers to functions is data, not an operation.
    expect(attrs(m, 'sorter')).toEqual(['+ visits: Visit**']);
  });

  it('a function returning a pointer to function is parsed without inventing nodes', async () => {
    const m = await analyze(
      {
        'a.c': [
          'static int plus(int a, int b) { return a + b; }',
          'int (*choose(char c))(int, int) { return plus; }',
          'int main(void) { return choose(43)(1, 2); }',
        ].join('\n'),
      },
      'c.callgraph',
    );
    expect(names(m)).toEqual(['function:choose', 'function:main', 'function:plus']);
    expect(edgeList(m)).toEqual(['call main->choose']);
    expect(loud(m)).toEqual([]);
  });
});

describe('nested and anonymous structs', () => {
  it('a tagged nested struct is a node; an anonymous one is not, and its type says it has a body', async () => {
    const m = await analyze({
      'a.h': [
        'struct outer {',
        '  struct inner { int b; } named;',
        '  struct { int a; } plain;',
        '  union { int i; float f; };',
        '  struct { int x, y; };',
        '};',
      ].join('\n'),
    });
    expect(names(m)).toEqual(['struct:inner', 'struct:outer']);
    expect(attrs(m, 'outer')).toEqual([
      '+ named: struct inner',
      '+ plain: struct {...}',
      '+ i: int',
      '+ f: float',
      '+ x: int',
      '+ y: int',
    ]);
    expect(edgeList(m)).toEqual(['composition outer->inner named 1']);
  });
});

describe('arrays of pointers', () => {
  it('take the array size; pointers to pointers and indexed pointers are many', async () => {
    const m = await analyze({
      'a.h': 'typedef struct leaf { int v; } Leaf;\nstruct tree { Leaf *kids[4]; Leaf **all; Leaf *one; Leaf *many; };',
      'a.c': '#include "a.h"\nint tree_sum(struct tree *t, int i) { return t->many[i].v; }',
    });
    expect(edgeList(m)).toEqual([
      'association tree->Leaf all *',
      'association tree->Leaf kids 4',
      'association tree->Leaf many *',
      'association tree->Leaf one 0..1',
    ]);
    expect(edge(m, 'association', 'tree', 'Leaf')).toBeDefined();
    expect(m.edges.find((e) => e.to.role === 'many')?.confidence).toBe(0.8);
  });
});

describe('K&R declarations', () => {
  it('give typed parameters for the TAD rule', async () => {
    const m = await analyze({
      'k.h': 'typedef struct tally Tally;',
      'k.c':
        '#include "k.h"\nstruct tally { int n; };\nint tally_add(t, by)\n  Tally *t;\n  int by;\n{ return t->n += by; }',
    });
    expect(ops(m, 'Tally')).toEqual(['+ tally_add(t: Tally*, by: int): int']);
  });
});

describe('files with only prototypes', () => {
  it('a prototype in a .c with no definition anywhere does not break the diagram', async () => {
    const m = await analyze({
      'a.c': 'struct box { int a; };\nint box_size(struct box *b);\nint main(void) { return 0; }',
    });
    expect(internal(m)).toEqual([]);
    expect(ops(m, 'box')).toEqual(['+ box_size(b: struct box*): int']);
  });

  it('a header with only prototypes has no functions in the call graph', async () => {
    const m = await analyze({ 'a.h': 'int f(int);\nvoid g(void);' }, 'c.callgraph', ALL_ON);
    expect(m.nodes).toEqual([]);
    expect(m.diagnostics).toEqual([]);
  });

  it('a prototyped but undefined function is external, "declared, not defined"', async () => {
    const m = await analyze({ 'a.c': 'int helper(int);\nint main(void) { return helper(1); }' }, 'c.callgraph', {
      showExternal: true,
    });
    expect(node(m, 'helper')).toMatchObject({ kind: 'external', group: 'declared, not defined' });
  });
});

describe('includes that do not exist and cycles', () => {
  it('a missing include is an info diagnostic and a hidden external', async () => {
    const src = { 'a.c': '#include "gone.h"\n#include <stdio.h>\nint x;' };
    const hidden = await analyze(src, 'c.include');
    expect(names(hidden)).toEqual(['source-file:a.c']);
    expect(hidden.diagnostics.map((d) => [d.level, d.ref?.line])).toEqual([['info', 1]]);
    const shown = await analyze(src, 'c.include', { showExternal: true });
    expect(names(shown)).toEqual(['external:"gone.h"', 'external:<stdio.h>', 'source-file:a.c']);
  });

  it('an include through a macro is not taken for a file', async () => {
    const m = await analyze({ 'a.c': '#include CONFIG_H\nint x;', CONFIG_H: '' }, 'c.include', { showExternal: true });
    expect(names(m)).toEqual(['source-file:a.c']);
    expect(m.diagnostics.map((d) => d.message)).toEqual([
      '#include CONFIG_H in a.c names a macro, which is not expanded',
    ]);
  });

  it('every cycle is one warn with a line, and a file that includes itself counts', async () => {
    const m = await analyze(
      { 'a.h': '#include "b.h"\n', 'b.h': '#include "c.h"\n', 'c.h': '#include "a.h"\n', 'd.h': '#include "d.h"\n' },
      'c.include',
    );
    expect(loud(m).map((d) => [d.level, d.message, d.ref?.line])).toEqual([
      ['warn', 'include cycle: a.h → b.h → c.h → a.h', 1],
      ['warn', 'include cycle: d.h → d.h', 1],
    ]);
    expect(m.edges).toHaveLength(4);
  });

  it('the same include twice is one edge with two pieces of evidence', async () => {
    const m = await analyze({ 'a.c': '#include "a.h"\n#include "a.h"\n', 'a.h': '' }, 'c.include');
    expect(m.edges).toHaveLength(1);
    expect(m.edges[0]!.evidence.map((e) => e.ref?.line)).toEqual([1, 2]);
  });
});

describe('code that tree-sitter marks as ERROR', () => {
  it('a broken first function does not hide the ones after it, even when the whole file is ERROR', async () => {
    const src = { 'a.c': 'int f( { return 1 }\n@@@ $$$\nint g(void) { return 2; }\nint h(void) { return g(); }' };
    const m = await analyze(src, 'c.callgraph');
    expect(names(m)).toEqual(['function:g', 'function:h']);
    expect(edgeList(m)).toEqual(['call h->g']);
    expect(loud(m).every((d) => d.level === 'error' && d.ref?.line === 1)).toBe(true);
  });

  it('a file of pure garbage reports a bounded number of errors and no internal error', async () => {
    const garbage = Array.from({ length: 400 }, (_, i) => `}{ ) ( @@ ${i} ;; #if\n`).join('');
    const t = performance.now();
    const m = await analyze({ 'a.c': garbage }, 'c.callgraph');
    expect(performance.now() - t).toBeLessThan(5000);
    expect(internal(m)).toEqual([]);
    expect(m.diagnostics.filter((d) => d.level === 'error').length).toBeLessThanOrEqual(20);
  });
});

describe('no phantom nodes from the C library', () => {
  it('library structs named in fields and parameters are not nodes, even with a function named after them', async () => {
    const m = await analyze({
      'a.h': [
        '#include <sys/stat.h>',
        '#include <time.h>',
        'struct entry { struct stat info; struct tm *when; FILE *out; };',
        'void stat_show(struct stat *s);',
        'int tm_hour(struct tm *t);',
      ].join('\n'),
    });
    expect(names(m)).toEqual(['struct:entry']);
    expect(m.edges).toEqual([]);
  });

  it('a type the project declares itself, with operations, is still a node', async () => {
    const m = await analyze({ 'a.c': 'struct hidden;\nint hidden_len(struct hidden *h) { return 0; }' });
    expect(names(m)).toEqual(['struct:hidden']);
  });
});

describe('call resolution details', () => {
  it('a static inline function in a header is linked with full confidence from every file', async () => {
    const m = await analyze(
      {
        'u.h': 'static inline int sq(int x) { return x * x; }',
        'a.c': '#include "u.h"\nint a(void) { return sq(2); }',
        'b.c': '#include "u.h"\nint b(void) { return sq(3); }',
      },
      'c.callgraph',
    );
    expect(m.edges.map((e) => e.confidence)).toEqual([1, 1]);
  });

  it('a static function of another .c file is linked with confidence 0.7', async () => {
    const m = await analyze(
      { 'a.c': 'static int hid(void) { return 1; }', 'b.c': 'int b(void) { return hid(); }' },
      'c.callgraph',
    );
    expect(m.edges.map((e) => [e.confidence, e.evidence[0]!.rule])).toEqual([[0.7, 'c.call.static-elsewhere']]);
  });

  it('a direct call and a call through a pointer to the same function are one edge with the lower confidence', async () => {
    const m = await analyze(
      { 'a.c': 'int f(void) { return 1; }\nint main(void) { int (*p)(void) = f; p(); f(); return 0; }' },
      'c.callgraph',
    );
    expect(edgeList(m)).toEqual(['call main->f [2]']);
    expect(m.edges[0]!.confidence).toBe(0.5);
  });

  it('external nodes carry the line of their first call', async () => {
    const m = await analyze(
      { 'a.c': '#include <stdio.h>\n\nint main(void) { puts("a"); puts("b"); return 0; }' },
      'c.callgraph',
      {
        showExternal: true,
      },
    );
    expect(node(m, 'puts')).toMatchObject({ kind: 'external', group: 'stdio' });
    expect(node(m, 'puts').evidence?.[0]?.ref).toEqual({ file: 'a.c', line: 3 });
  });
});

// ---------------------------------------------------------------- deep and large input

describe('deep and large input', () => {
  it('a very long else-if chain and a very long expression do not overflow the stack', async () => {
    const chain = Array.from({ length: 3000 }, (_, i) => `if (x == ${i}) return f${i % 3}();`).join(' else ');
    const expr = Array.from({ length: 3000 }, () => 'x').join(' + ');
    const src = `int f0(void){return 0;}\nint f1(void){return 1;}\nint f2(void){return 2;}\nint g(int x) { ${chain} return 0; }\nint h(int x) { return ${expr}; }`;
    for (const kind of KINDS) expect(internal(await analyze({ 'a.c': src }, kind))).toEqual([]);
    const m = await analyze({ 'a.c': src }, 'c.callgraph');
    expect(edgeList(m)).toEqual(['call g->f0 [1000]', 'call g->f1 [1000]', 'call g->f2 [1000]']);
  });

  it('a syntax error at the end of a very deep chain is still reported, with its line', async () => {
    const chain = Array.from({ length: 8000 }, (_, i) => `if (x == ${i}) return f0();`).join(' else ');
    const src = `int f0(void) { return 0; }\nint g(int x) { ${chain} else return @@ ; }\nint h(void) { return f0(); }`;
    for (const kind of KINDS) {
      const m = await analyze({ 'a.c': src }, kind);
      expect(internal(m)).toEqual([]);
      expect(m.diagnostics.filter((d) => d.level === 'error').map((d) => [d.message, d.ref?.line])).toEqual([
        ['syntax error near "@@"', 2],
      ]);
    }
    expect(edgeList(await analyze({ 'a.c': src }, 'c.callgraph'))).toContain('call h->f0');
  });

  /** 100 modules of a header, a source and a test file each: 300 files, built in memory. */
  function project(n: number): SourceFile[] {
    const out: SourceFile[] = [];
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      out.push({
        path: `mod${i}/unit${i}.h`,
        content: [
          `#ifndef UNIT${i}_H`,
          `#define UNIT${i}_H`,
          `#include "../mod${next}/unit${next}.h"`,
          `typedef struct unit${i} {`,
          `  int id;`,
          `  struct unit${next} *peer;`,
          `  int values[8];`,
          `} Unit${i};`,
          `Unit${i} *unit${i}_create(int id);`,
          `int unit${i}_sum(const Unit${i} *u);`,
          `#endif`,
        ].join('\n'),
      });
      out.push({
        path: `mod${i}/unit${i}.c`,
        content: [
          `#include <stdlib.h>`,
          `#include "unit${i}.h"`,
          `static int clamp${i}(int v) { return v < 0 ? 0 : v; }`,
          `Unit${i} *unit${i}_create(int id) {`,
          `  Unit${i} *u = malloc(sizeof *u);`,
          `  u->id = clamp${i}(id);`,
          `  u->peer = 0;`,
          `  return u;`,
          `}`,
          `int unit${i}_sum(const Unit${i} *u) {`,
          `  int s = 0;`,
          `  for (int k = 0; k < 8; k++) s += u->values[k];`,
          `  return s + unit${next}_sum(0);`,
          `}`,
        ].join('\n'),
      });
      out.push({
        path: `tests/test${i}.c`,
        content: `#include "../mod${i}/unit${i}.h"\nint test${i}(void) { return unit${i}_sum(unit${i}_create(${i})); }`,
      });
    }
    return out;
  }

  it('300 files are analysed quickly, for every kind', async () => {
    const input = project(100);
    expect(input).toHaveLength(300);
    const times: Record<string, number> = {};
    const models: Record<string, DiagramModel> = {};
    for (const kind of KINDS) {
      const t = performance.now();
      models[kind] = await run(input, kind);
      times[kind] = Math.round(performance.now() - t);
    }
    console.info(`300 C files: ${JSON.stringify(times)} ms`);
    for (const kind of KINDS) {
      expect(internal(models[kind]!)).toEqual([]);
      expect(wellFormed(models[kind]!, input)).toEqual([]);
    }
    const { 'c.struct': struct, 'c.callgraph': calls, 'c.include': includes } = models;
    expect([struct!.nodes.length, struct!.edges.length]).toEqual([100, 100]);
    expect(calls!.nodes).toHaveLength(400);
    expect(includes!.nodes).toHaveLength(300);
    // The headers include one another in a ring: one cycle through all 100.
    expect(loud(includes!).map((d) => d.level)).toEqual(['warn']);
    for (const ms of Object.values(times)) expect(ms).toBeLessThan(10_000);
  });
});
