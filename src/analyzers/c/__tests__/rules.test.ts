// Unit tests of the §7.2 rules, one small inline program per rule.
import { describe, expect, it } from 'vitest';
import { cAnalyzer } from '..';
import { normalizePath, resolveInclude } from '../include';
import { startsWithTypeName } from '../resolve';
import { analyze, attrs, edge, edgeList, loud, names, node, ops } from './helpers';

// ------------------------------------------------------------------ c.struct

describe('c.struct: types', () => {
  it('typedef struct tag {...} Name gives one node named after the typedef', async () => {
    const m = await analyze({ 'p.h': 'typedef struct point { int x; int y; } Point;' });
    expect(names(m)).toEqual(['struct:Point']);
    expect(attrs(m, 'Point')).toEqual(['+ x: int', '+ y: int']);
    expect(node(m, 'Point').evidence?.[0]?.rule).toBe('c.struct');
  });

  it('a struct with only a tag keeps the tag; an anonymous struct with no typedef is left out', async () => {
    const m = await analyze({ 'a.c': 'struct cell { int v; };\nstatic struct { int n; } counter;' });
    expect(names(m)).toEqual(['struct:cell']);
    expect(attrs(m, 'cell')).toEqual(['- v: int']);
  });

  it('typedef in the .h and body in the .c is one opaque node with the .c fields', async () => {
    const m = await analyze({
      'pile.h': 'typedef struct _pile Pile;\nPile *pile_new(void);',
      'pile.c': '#include "pile.h"\nstruct _pile { int *items; int top; };\nPile *pile_new(void) { return 0; }',
    });
    expect(names(m)).toEqual(['struct:Pile']);
    expect(node(m, 'Pile').stereotypes).toEqual(['opaque']);
    expect(attrs(m, 'Pile')).toEqual(['- items: int*', '- top: int']);
    expect(node(m, 'Pile').evidence?.[0]?.rule).toBe('c.opaque');
  });

  it('a struct defined in the .h is not opaque and its fields are public', async () => {
    const m = await analyze({ 'v.h': 'struct _vec { double x, y; };\ntypedef struct _vec Vec;' });
    expect(node(m, 'Vec').stereotypes).toBeUndefined();
    expect(attrs(m, 'Vec')).toEqual(['+ x: double', '+ y: double']);
  });

  it('enums list their constants, with the value when written', async () => {
    const m = await analyze({ 'c.h': 'enum Color { RED, GREEN = 4, BLUE };\ntypedef enum { ON, OFF } Switch;' });
    expect(names(m)).toEqual(['c-enum:Color', 'c-enum:Switch']);
    expect(attrs(m, 'Color')).toEqual(['RED', 'GREEN = 4', 'BLUE']);
    expect(node(m, 'Switch').stereotypes).toEqual(['enumeration']);
  });

  it('unions are union nodes', async () => {
    const m = await analyze({ 'u.h': 'union Value { int i; float f; char raw[4]; };' });
    expect(names(m)).toEqual(['union:Value']);
    expect(attrs(m, 'Value')).toEqual(['+ i: int', '+ f: float', '+ raw: char[4]']);
  });

  it('a typedef of a pointer to function is a typedef node', async () => {
    const m = await analyze({ 'f.h': 'typedef int (*Compare)(const void *a, const void *b);\ntypedef int Number;' });
    expect(names(m)).toEqual(['typedef:Compare']);
  });

  it('type text: qualifiers kept, stars attached, arrays as a suffix, struct keyword kept', async () => {
    const m = await analyze({
      't.h': 'struct t { const char *name; unsigned long n; struct t **kids; int grid[3][4]; char *argv[]; };',
    });
    expect(attrs(m, 't')).toEqual([
      '+ name: const char*',
      '+ n: unsigned long',
      '+ kids: struct t**',
      '+ grid: int[3][4]',
      '+ argv: char*[]',
    ]);
  });

  it('fields inside #if blocks are all read', async () => {
    const m = await analyze({ 'd.h': 'struct d {\n  int a;\n#ifdef DEBUG\n  int trace;\n#endif\n};' });
    expect(attrs(m, 'd')).toEqual(['+ a: int', '+ trace: int']);
    expect(m.diagnostics.some((d) => d.level === 'info' && /#if\/#ifdef/.test(d.message))).toBe(true);
  });
});

describe('c.struct: field relations', () => {
  const src = `
typedef enum { SMALL, LARGE } Size;
typedef struct { int r, g, b; } Rgb;
union Num { int i; double d; };
typedef struct cell Cell;
struct cell {
  Rgb colour;          /* by value */
  Rgb palette[16];     /* array */
  Rgb shades[PALETTE]; /* array with a macro size */
  Cell *next;          /* pointer: 0..1, to itself */
  Cell **grid;         /* pointer to pointers: * */
  Cell *row;           /* indexed below: * */
  Size size;           /* enum value */
  union Num n;         /* union by value */
};
int cell_row_sum(Cell *c, int k) { return c->row[k].colour.r; }
`;

  it('maps each field to the §7.2 relation', async () => {
    const m = await analyze({ 'cell.h': src });
    expect(edgeList(m)).toEqual([
      'association Cell->Cell grid *',
      'association Cell->Cell next 0..1',
      'association Cell->Cell row *',
      'association Cell->Size size 1',
      'composition Cell->Num n 1',
      'composition Cell->Rgb colour 1',
      'composition Cell->Rgb palette 16',
      'composition Cell->Rgb shades PALETTE',
    ]);
  });

  it('a pointer counts as many only by a heuristic, with lower confidence and the line of the use', async () => {
    const m = await analyze({ 'cell.h': src });
    const row = m.edges.find((e) => e.to.role === 'row')!;
    expect(row.confidence).toBeLessThan(1);
    expect(row.evidence.map((e) => e.rule)).toEqual(['c.field.pointer-many', 'c.field.pointer-many.use']);
    expect(row.evidence[1]?.ref?.line).toBe(16);
    const next = m.edges.find((e) => e.to.role === 'next')!;
    expect(next.confidence).toBe(1);
    expect(next.evidence[0]).toMatchObject({ rule: 'c.field.pointer', ref: { file: 'cell.h', line: 10 } });
  });

  it('a pointer allocated for many elements is *', async () => {
    const m = await analyze({
      'b.c': `typedef struct { int v; } Slot;
typedef struct { Slot *slots; Slot *one; } Bag;
void bag_init(Bag *b, int n) { b->slots = malloc(n * sizeof *b->slots); b->one = malloc(sizeof *b->one); }`,
    });
    expect(edgeList(m)).toEqual(['association Bag->Slot one 0..1', 'association Bag->Slot slots *']);
  });

  it('pointers to types outside the project give no edge', async () => {
    const m = await analyze({ 'f.c': 'struct f { FILE *fp; struct stat *st; int *xs; };' });
    expect(m.edges).toEqual([]);
  });

  it('function pointer fields are operations with the fn-pointer flag', async () => {
    const m = await analyze({
      'o.h': `typedef void (*Handler)(int code);
struct ops { int (*compare)(const void *a, const void *b); Handler on_error; int count; };`,
    });
    expect(attrs(m, 'ops')).toEqual(['+ count: int']);
    expect(ops(m, 'ops')).toEqual(['+ compare(a: const void*, b: const void*): int', '+ on_error(code: int): void']);
    expect(node(m, 'ops').operations?.every((o) => o.flags?.includes('fn-pointer'))).toBe(true);
    expect(m.edges).toEqual([]);
  });
});

describe('c.struct: functions of the abstract data type', () => {
  const h = `typedef struct _tray Tray;
Tray *TrayCreate(int size);
void TrayDestroy(Tray **pq);
int TraySize(const Tray *q);
void TrayPush(Tray *q, int value);
int TrayCapacity(int size);
void drain(Tray *q);
void Trayd_helper(Tray *q);
`;
  const c = `#include "tray.h"
struct _tray { int *data; int size; };
static int tray_index(Tray *q, int i) { return i % q->size; }
Tray *TrayCreate(int n) { return 0; }
void TrayDestroy(Tray **p) {}
int TraySize(const Tray *q) { return q->size; }
void TrayPush(Tray *q, int v) { q->data[tray_index(q, 0)] = v; }
int TrayCapacity(int size) { return size; }
void drain(Tray *q) {}
void Trayd_helper(Tray *q) {}
int main(void) { return 0; }
`;

  it('first parameter T* (or returning T*) and a name that starts with the type name', async () => {
    const m = await analyze({ 'tray.h': h, 'tray.c': c });
    expect(ops(m, 'Tray')).toEqual([
      '+ TrayCreate(size: int): Tray*',
      '+ TrayDestroy(pq: Tray**): void',
      '+ TraySize(q: const Tray*): int',
      '+ TrayPush(q: Tray*, value: int): void',
      '- tray_index(q: Tray*, i: int): int',
    ]);
  });

  it('parameter names come from the header; static functions are private', async () => {
    const m = await analyze({ 'tray.h': h, 'tray.c': c });
    const idx = node(m, 'Tray').operations!.find((o) => o.name === 'tray_index')!;
    expect(idx.visibility).toBe('-');
    expect(idx.ref).toEqual({ file: 'tray.c', line: 3 });
    expect(node(m, 'Tray').operations!.find((o) => o.name === 'TrayDestroy')!.ref?.file).toBe('tray.h');
  });

  it('the name must start a new word after the type name', () => {
    expect(startsWithTypeName('TrayCreate', 'Tray')).toBe(true);
    expect(startsWithTypeName('tray_size', 'Tray')).toBe(true);
    expect(startsWithTypeName('Tray', 'Tray')).toBe(true);
    expect(startsWithTypeName('Tray2Array', 'Tray')).toBe(true);
    expect(startsWithTypeName('Trayd_helper', 'Tray')).toBe(false);
    expect(startsWithTypeName('hash_djb2', 'hashtable')).toBe(false);
    expect(startsWithTypeName('IntTrayNew', '_IntTray')).toBe(true);
  });

  it('unnamed prototype parameters take the definition names', async () => {
    const m = await analyze({
      'a.h': 'typedef struct acc Acc;\nvoid acc_add(Acc *, int);',
      'a.c': 'struct acc { int t; };\nvoid acc_add(Acc *a, int v) { a->t += v; }',
    });
    expect(ops(m, 'Acc')).toEqual(['+ acc_add(a: Acc*, v: int): void']);
  });

  it('a type that is only declared becomes an opaque node when functions belong to it', async () => {
    const m = await analyze({ 'h.h': 'typedef struct handle Handle;\nHandle *handle_open(const char *path);' });
    expect(names(m)).toEqual(['struct:Handle']);
    expect(node(m, 'Handle').stereotypes).toEqual(['opaque']);
    expect(ops(m, 'Handle')).toEqual(['+ handle_open(path: const char*): Handle*']);
  });

  it('trivial getters and setters are hidden unless showAccessors', async () => {
    const src = {
      'box.c': `typedef struct { int w; } Box;
int box_get_w(const Box *b) { return b->w; }
void box_set_w(Box *b, int w) { b->w = w; }
int box_area(const Box *b) { return b->w * b->w; }
int BoxGetDouble(const Box *b) { return 2 * b->w; }`,
    };
    expect(ops(await analyze(src), 'Box')).toEqual([
      '+ box_area(b: const Box*): int',
      '+ BoxGetDouble(b: const Box*): int',
    ]);
    const all = await analyze(src, 'c.struct', { showAccessors: true });
    expect(node(all, 'Box').operations!.map((o) => [o.name, o.flags ?? []])).toEqual([
      ['box_get_w', ['getter']],
      ['box_set_w', ['setter']],
      ['box_area', []],
      ['BoxGetDouble', []],
    ]);
  });

  it('types used only in parameters are dependencies, shown only with showDependencies', async () => {
    const src = {
      'g.h': `typedef struct { int x; } Pos;
typedef struct { Pos *at; } Ghost;
typedef struct { int id; } Map;
void ghost_move(Ghost *g, const Map *m, Pos to);`,
    };
    expect(edgeList(await analyze(src))).toEqual(['association Ghost->Pos at 0..1']);
    const all = await analyze(src, 'c.struct', { showDependencies: true });
    expect(edgeList(all)).toEqual(['association Ghost->Pos at 0..1', 'dependency Ghost->Map']);
  });
});

// --------------------------------------------------------------- c.callgraph

describe('c.callgraph', () => {
  const prog = {
    'm.c': `#include <stdio.h>
static int twice(int x) { return 2 * x; }
static int fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }
static int apply(int (*f)(int), int v) { return f(v); }
int main(void) {
  int (*op)(int) = twice;
  printf("%d %d\\n", twice(1), twice(2));
  printf("%d\\n", op(3));
  printf("%d\\n", apply(fact, 4));
  return fact(5);
}`,
  };

  it('one node per defined function, call edges labelled with the number of call sites, recursion as a loop', async () => {
    const m = await analyze(prog, 'c.callgraph');
    expect(names(m)).toEqual(['function:apply', 'function:fact', 'function:main', 'function:twice']);
    expect(edgeList(m)).toEqual(['call fact->fact', 'call main->apply', 'call main->fact', 'call main->twice [3]']);
    expect(node(m, 'fact').group).toBe('m.c');
  });

  it('a call through a pointer assigned directly has confidence 0.5; through a parameter it is a diagnostic', async () => {
    const m = await analyze(prog, 'c.callgraph');
    const e = edge(m, 'call', 'main', 'twice')!;
    expect(e.confidence).toBe(0.5);
    expect(e.evidence.map((x) => x.rule).sort()).toEqual(['c.call', 'c.call', 'c.call.fn-pointer']);
    expect(edge(m, 'call', 'apply', 'fact')).toBeUndefined();
    expect(m.diagnostics).toContainEqual({
      level: 'info',
      message: 'call through the parameter f in apply: the target is not known, so there is no edge',
      ref: { file: 'm.c', line: 4 },
    });
  });

  it('library calls are external nodes grouped by library, hidden by default', async () => {
    expect(names(await analyze(prog, 'c.callgraph')).some((n) => n.startsWith('external:'))).toBe(false);
    const m = await analyze(
      {
        'x.c': `#include <pthread.h>
void *work(void *a) { sem_wait(a); return malloc(4); }
int main(void) { pthread_t t; pthread_create(&t, 0, work, 0); printf("x"); semop(1, 0, 1); frobnicate(); }`,
      },
      'c.callgraph',
      { showExternal: true },
    );
    const groups = Object.fromEntries(m.nodes.filter((n) => n.kind === 'external').map((n) => [n.name, n.group]));
    expect(groups).toEqual({
      sem_wait: 'IPC POSIX',
      malloc: 'stdlib',
      pthread_create: 'pthread',
      printf: 'stdio',
      semop: 'IPC POSIX',
      frobnicate: 'other',
    });
    // A function passed as an argument is not a call.
    expect(edge(m, 'call', 'main', 'work')).toBeUndefined();
  });

  it('main is shown by default and hidden with showMain: false', async () => {
    const m = await analyze(prog, 'c.callgraph', { showMain: false });
    expect(names(m)).toEqual(['function:apply', 'function:fact', 'function:twice']);
    expect(edgeList(m)).toEqual(['call fact->fact']);
  });

  it('functions defined in several files are named after their file; calls prefer the same file', async () => {
    const m = await analyze(
      {
        'a.c': 'static void log_it(void) {}\nint main(void) { log_it(); helper(); return 0; }',
        'b.c': 'static void log_it(void) {}\nint main(void) { log_it(); return 0; }',
        'h.c': 'void helper(void) {}',
      },
      'c.callgraph',
    );
    expect(names(m)).toEqual([
      'function:helper',
      'function:log_it (a.c)',
      'function:log_it (b.c)',
      'function:main (a.c)',
      'function:main (b.c)',
    ]);
    expect(edgeList(m)).toEqual([
      'call main (a.c)->helper',
      'call main (a.c)->log_it (a.c)',
      'call main (b.c)->log_it (b.c)',
    ]);
  });

  it('a call to a name defined (non-static) in two other files is ambiguous: a warning, no edge', async () => {
    const m = await analyze(
      {
        'v1.c': 'int bump(void) { return 1; }',
        'v2.c': 'int bump(void) { return 2; }',
        'u.c': 'int main(void) { return bump(); }',
      },
      'c.callgraph',
    );
    expect(m.edges).toEqual([]);
    expect(loud(m).map((d) => d.message)).toEqual(['call to bump in main: defined in several files, not linked']);
  });

  it('a local that shadows a function name is not a call to that function', async () => {
    const m = await analyze(
      {
        's.c': 'struct op { int n; };\nvoid bell(void) {}\nvoid lift(void) { struct op bell; bell.n = 1; use(&bell); }',
      },
      'c.callgraph',
    );
    expect(m.edges).toEqual([]);
  });

  it('a global pointer initialised with a function links with confidence 0.5', async () => {
    const m = await analyze(
      { 'g.c': 'static void beep(void) {}\nstatic void (*sound)(void) = beep;\nint main(void) { sound(); return 0; }' },
      'c.callgraph',
    );
    expect(edge(m, 'call', 'main', 'beep')?.confidence).toBe(0.5);
  });
});

// ----------------------------------------------------------------- c.include

describe('c.include', () => {
  it('resolves quoted includes from the folder of the including file, one edge per pair', async () => {
    const m = await analyze(
      {
        'app/main.c': '#include "../lib/util.h"\n#include "local.h"\n#include "local.h"\n#include <stdio.h>',
        'app/local.h': '#pragma once',
        'lib/util.h': '#include "../app/local.h"',
        'lib/util.c': '#include "util.h"',
      },
      'c.include',
    );
    expect(names(m)).toEqual([
      'header-file:app/local.h',
      'header-file:lib/util.h',
      'source-file:app/main.c',
      'source-file:lib/util.c',
    ]);
    expect(edgeList(m)).toEqual([
      'include app/main.c->app/local.h',
      'include app/main.c->lib/util.h',
      'include lib/util.c->lib/util.h',
      'include lib/util.h->app/local.h',
    ]);
    const twice = edge(m, 'include', 'app/main.c', 'app/local.h')!;
    expect(twice.evidence.map((e) => e.ref?.line)).toEqual([2, 3]);
    expect(twice.evidence[0]?.rule).toBe('c.include.relative');
    expect(node(m, 'lib/util.h').group).toBe('lib');
  });

  it('system headers are externals shown only with showExternal', async () => {
    const m = await analyze({ 'a.c': '#include <stdio.h>\n#include "missing.h"' }, 'c.include', { showExternal: true });
    expect(names(m)).toEqual(['external:"missing.h"', 'external:<stdio.h>', 'source-file:a.c']);
    expect(m.diagnostics.map((d) => d.message)).toEqual([
      '#include "missing.h" in a.c is not a file of the project; shown as external',
    ]);
  });

  it('a project header and a system header with the same name are not confused', async () => {
    const m = await analyze({ 'sem.h': '', 'a.c': '#include <sem.h>\n#include "sem.h"' }, 'c.include');
    expect(edgeList(m)).toEqual(['include a.c->sem.h']);
    expect(edge(m, 'include', 'a.c', 'sem.h')?.evidence).toHaveLength(1);
  });

  it('include cycles give a warning', async () => {
    const m = await analyze({ 'a.h': '#include "b.h"', 'b.h': '#include "a.h"', 'c.h': '#include "c.h"' }, 'c.include');
    expect(loud(m).map((d) => [d.level, d.message])).toEqual([
      ['warn', 'include cycle: a.h → b.h → a.h'],
      ['warn', 'include cycle: c.h → c.h'],
    ]);
  });

  it('path resolution', () => {
    expect(normalizePath('a/./b/../c.h')).toBe('a/c.h');
    expect(normalizePath('../x.h')).toBe('../x.h');
    const files = new Set(['src/a.c', 'include/proj/b.h', 'b.h']);
    expect(resolveInclude('b.h', 'src/a.c', files)).toMatchObject({ path: 'b.h', rule: 'c.include.root' });
    expect(resolveInclude('proj/b.h', 'src/a.c', files)).toMatchObject({
      path: 'include/proj/b.h',
      rule: 'c.include.search',
      confidence: 0.6,
    });
    expect(resolveInclude('none.h', 'src/a.c', files)).toBeUndefined();
  });
});

// ----------------------------------------------------------------- robustness

describe('robustness', () => {
  it('a syntax error is a diagnostic with its line and the rest is still analysed', async () => {
    const m = await analyze({
      'ok.h': 'typedef struct { int n; } Counter;\nvoid counter_inc(Counter *c);',
      'bad.c': 'int main(void) {\n  int x = 1;\n  if ((x = 2) {\n    return 0;\n  }\n}',
    });
    expect(names(m)).toEqual(['struct:Counter']);
    expect(ops(m, 'Counter')).toEqual(['+ counter_inc(c: Counter*): void']);
    const errors = m.diagnostics.filter((d) => d.level === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((d) => d.ref?.file === 'bad.c' && d.ref.line === 3)).toBe(true);
  });

  it('declarations inside #if blocks are read, with one info per file', async () => {
    const m = await analyze({
      'p.h':
        '#ifndef P_H\n#define P_H\n#if USE_FLOAT\ntypedef struct { float v; } Val;\n#else\ntypedef struct { double v; } Num;\n#endif\n#endif',
    });
    expect(names(m)).toEqual(['struct:Num', 'struct:Val']);
    expect(m.diagnostics).toEqual([
      {
        level: 'info',
        message: '1 #if/#ifdef block(s) in p.h: every branch is analysed and macros are not expanded',
        ref: { file: 'p.h', line: 3, endLine: 7 },
      },
    ]);
  });

  it('never throws: unsupported kind, no C files, garbage input', async () => {
    const wrong = await cAnalyzer.analyze([{ path: 'a.c', content: '' }], 'java.class');
    expect(wrong.diagnostics[0]?.level).toBe('error');
    const none = await analyze({ 'notes.txt': 'hello' });
    expect(none.diagnostics.map((d) => d.message)).toEqual(['no C files in the input']);
    for (const kind of ['c.struct', 'c.callgraph', 'c.include'] as const) {
      const m = await analyze(
        { 'x.c': '}}}{{{ struct ; typedef ( int main( {', 'y.h': '#include\n#if\nstruct {' },
        kind,
      );
      expect(m.kind).toBe(kind);
      expect(m.diagnostics.some((d) => d.message.startsWith('internal error'))).toBe(false);
    }
  });

  it('the result does not depend on the order of the input files', async () => {
    const files = {
      'z.c': '#include "a.h"\nstruct z { A *a; };\nvoid z_go(struct z *p) { a_run(p->a); }',
      'a.h': 'typedef struct { int k; } A;\nvoid a_run(A *a);',
      'a.c': '#include "a.h"\nvoid a_run(A *a) { a->k++; }',
    };
    const reversed = Object.fromEntries(Object.entries(files).reverse());
    for (const kind of ['c.struct', 'c.callgraph', 'c.include'] as const)
      expect(await analyze(reversed, kind)).toEqual(await analyze(files, kind));
  });

  it('detect: .c is certain, .h a little less, the rest is not C', () => {
    expect(cAnalyzer.detect({ path: 'a.c', content: '' })).toBe(1);
    expect(cAnalyzer.detect({ path: 'a.h', content: '' })).toBe(0.9);
    expect(cAnalyzer.detect({ path: 'a.java', content: '' })).toBe(0);
  });
});
