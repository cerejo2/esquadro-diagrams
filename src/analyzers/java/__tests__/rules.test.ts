// Unit tests for the §7.1 rules, one small program per rule.
import { describe, expect, it } from 'vitest';
import { javaAnalyzer } from '..';
import { analyze, attrs, edge, edgeList, node, ops } from './helpers';

describe('types and nodes', () => {
  it('maps class, abstract, interface, enum and record to node kinds with stereotypes', async () => {
    const m = await analyze({
      'A.java': `abstract class A {}
        class B {}
        interface I {}
        enum E { X, Y }
        record R(int a) {}
        @interface Ann {}`,
    });
    expect(m.nodes.map((n) => `${n.kind}:${n.name}`)).toEqual([
      'abstract:A',
      'class:B',
      'interface:I',
      'enum:E',
      'record:R',
    ]);
    expect(node(m, 'I').stereotypes).toEqual(['interface']);
    expect(node(m, 'E').stereotypes).toEqual(['enumeration']);
    expect(node(m, 'A').stereotypes).toEqual(['abstract']);
  });

  it('ids are `${kind}:${qualifiedName}` and do not depend on file order', async () => {
    const a = { 'p/A.java': 'package p; class A { B b; }', 'p/B.java': 'package p; class B {}' };
    const m1 = await analyze(a);
    const m2 = await analyze({ 'p/B.java': a['p/B.java'], 'p/A.java': a['p/A.java'] });
    expect(m1.nodes.map((n) => n.id)).toEqual(['class:p.A', 'class:p.B']);
    expect(m2).toEqual(m1);
  });

  it('a member type is its own node named Outer.Inner, with parent and a nesting edge to the owner', async () => {
    const m = await analyze({ 'O.java': 'class Outer { static class Inner {} class Deep { class Er {} } }' });
    expect(m.nodes.map((n) => n.name)).toEqual(['Outer', 'Outer.Inner', 'Outer.Deep', 'Outer.Deep.Er']);
    expect(node(m, 'Outer.Inner').parent).toBe('class:Outer');
    expect(edgeList(m)).toEqual([
      'nesting Outer.Inner->Outer',
      'nesting Outer.Deep->Outer',
      'nesting Outer.Deep.Er->Outer.Deep',
    ]);
  });

  it('groups nodes by package', async () => {
    const m = await analyze({ 'a/b/C.java': 'package a.b; public class C {}' });
    expect(node(m, 'C').group).toBe('a.b');
    expect(node(m, 'C').ref).toEqual({ file: 'a/b/C.java', line: 1 });
  });

  it('leaves out a launcher class that only holds main', async () => {
    const src = { 'Main.java': 'public class Main { public static void main(String[] args) { new A(); } } class A {}' };
    expect((await analyze(src)).nodes.map((n) => n.name)).toEqual(['A']);
    expect((await analyze(src, 'java.class', { showMain: true })).nodes.map((n) => n.name)).toEqual(['Main', 'A']);
  });
});

describe('members', () => {
  it('writes attributes and operations in UML form with visibility', async () => {
    const m = await analyze({
      'A.java': `import java.util.*;
        public class A {
          private int a; protected String b; public java.util.List<String> c; long d;
          static final int K = 1;
          public A(int a) { this.a = a; }
          private void f(int x, String... rest) {}
          protected Map<String, List<Integer>> g(int[] xs) { return null; }
          int h() { return 0; }
        }`,
    });
    expect(attrs(m, 'A')).toEqual(['- a: int', '# b: String', '+ c: List<String>', '~ d: long', '~ K: int']);
    expect(ops(m, 'A')).toEqual([
      '+ A(a: int)',
      '- f(x: int, rest: String...): void',
      '# g(xs: int[]): Map<String, List<Integer>>',
      '~ h(): int',
    ]);
    const a = node(m, 'A');
    expect(a.operations![0]!.flags).toEqual(['ctor']);
    expect(a.attributes![4]!.flags).toEqual(['static', 'final']);
  });

  it('marks static and abstract operations, and interface methods are public', async () => {
    const m = await analyze({
      'A.java': `abstract class A { abstract void run(); static A make() { return null; } }
        interface I { void go(); default int n() { return 1; } int LIMIT = 3; }`,
    });
    expect(node(m, 'A').operations!.map((o) => o.flags)).toEqual([['abstract'], ['static']]);
    expect(ops(m, 'I')).toEqual(['+ go(): void', '+ n(): int']);
    expect(node(m, 'I').operations![0]!.flags).toEqual(['abstract']);
    expect(attrs(m, 'I')).toEqual(['+ LIMIT: int']);
  });

  it('hides trivial getters and setters, main, toString, equals and hashCode by default', async () => {
    const src = {
      'P.java': `class P {
        private String name; private int n;
        public String getName() { return name; }
        public boolean isEmpty() { return this.n == 0; }
        public int getN() { return this.n; }
        public void setName(String name) { this.name = name; }
        public void setN(int v) { n = v; check(); }
        void check() {}
        public static void main(String[] args) {}
        public String toString() { return name; }
        public boolean equals(Object o) { return false; }
        public int hashCode() { return 1; }
      }`,
    };
    const m = await analyze(src);
    expect(ops(m, 'P')).toEqual(['+ isEmpty(): boolean', '+ setN(v: int): void', '~ check(): void']);
    const all = await analyze(src, 'java.class', { showAccessors: true, showMain: true, showObjectMethods: true });
    expect(ops(all, 'P')).toHaveLength(10);
    const flags = node(all, 'P').operations!.map((o) => o.flags ?? []);
    expect(flags[0]).toContain('getter');
    expect(flags[2]).toContain('getter');
    expect(flags[3]).toContain('setter');
    expect(flags[4]).not.toContain('setter');
    expect(flags[6]).toEqual(['static', 'main']);
  });

  it('lists enum constants by name and record components as private attributes', async () => {
    const m = await analyze({
      'E.java': `enum E { A(1), B(2); private final int v; E(int v) { this.v = v; } int v() { return v; } }
        record R(String name, int age) { R { if (age < 0) throw new IllegalArgumentException(); } String hi() { return name; } }`,
    });
    expect(attrs(m, 'E')).toEqual(['A', 'B', '- v: int']);
    expect(ops(m, 'E')).toEqual(['- E(v: int)', '~ v(): int']);
    expect(attrs(m, 'R')).toEqual(['- name: String', '- age: int']);
    expect(ops(m, 'R')).toEqual(['~ R(name: String, age: int)', '~ hi(): String']);
  });
});

describe('relations', () => {
  it('extends gives generalization; implements gives realization; interface extends gives generalization', async () => {
    const m = await analyze({
      'A.java':
        'interface I {} interface J extends I {} class B {} class C extends B implements I, J {} enum E implements I { X }',
    });
    expect(edgeList(m)).toEqual([
      'generalization J->I',
      'generalization C->B',
      'realization C->I',
      'realization C->J',
      'realization E->I',
    ]);
    const g = edge(m, 'generalization', 'C', 'B')!;
    expect(g.confidence).toBe(1);
    expect(g.evidence[0]).toMatchObject({ rule: 'java.extends', ref: { file: 'A.java', line: 1 } });
  });

  it('composition when the class creates the object (declaration, constructor or add(new))', async () => {
    const m = await analyze({
      'A.java': `import java.util.*;
        class P {} class Q {} class S {}
        class A {
          private P p = new P();
          private Q q;
          private List<S> ss = new ArrayList<>();
          A() { q = new Q(); }
          void more() { ss.add(new S()); }
        }`,
    });
    expect(edgeList(m)).toEqual(['composition A->P p 1', 'composition A->Q q 1', 'composition A->S ss *']);
    const c = edge(m, 'composition', 'A', 'Q')!;
    expect(c.confidence).toBeLessThan(1);
    expect(c.evidence.map((e) => e.rule)).toEqual(['java.field', 'java.field.creates']);
    expect(c.evidence[1]!.ref).toEqual({ file: 'A.java', line: 7 });
  });

  it('aggregation when the value comes from a constructor or setter parameter, or add(p)', async () => {
    const m = await analyze({
      'A.java': `import java.util.*;
        class P {} class Q {} class S {} class T {}
        class A {
          private P p; private Q q; private List<S> ss = new ArrayList<>(); private Map<String, T> ts = new HashMap<>();
          A(P p) { this.p = p; }
          void setQ(Q q) { this.q = q; }
          void add(S s) { ss.add(s); }
          void put(String k, T t) { ts.put(k, t); }
        }`,
    });
    expect(edgeList(m)).toEqual([
      'aggregation A->P p 1',
      'aggregation A->Q q 1',
      'aggregation A->S ss *',
      'aggregation A->T ts *',
    ]);
  });

  it('receiving it from outside wins over creating it', async () => {
    const m = await analyze({ 'A.java': 'class P {} class A { P p = new P(); A(P p) { this.p = p; } }' });
    expect(edgeList(m)).toEqual(['aggregation A->P p 1']);
  });

  it('association otherwise: a non-setter method parameter, a constant, a local, another class writing it', async () => {
    const m = await analyze({
      'A.java': `enum St { ON } class P {} class Q {}
        class A { St s = St.ON; P p; Q q;
          void use(P x) { this.p = x; }
          void local() { Q y = new Q(); q = y; }
          void shadow(P p) { P other = p; } }
        class W { void w(A a, P p) { a.p = p; } }`,
    });
    expect(edgeList(m).filter((e) => e.startsWith('assoc'))).toEqual([
      'association A->St s 1',
      'association A->P p 1',
      'association A->Q q 1',
    ]);
  });

  it('a new in an ordinary method does not make a held field a composition', async () => {
    const m = await analyze({ 'A.java': 'class P {} class A { P p; void reset() { p = new P(); } }' });
    expect(edgeList(m)).toEqual(['association A->P p 1']);
  });

  it('creating a subtype of the field type is a composition', async () => {
    const m = await analyze({
      'A.java': 'interface V {} class Car implements V {} class A { V v; A() { v = new Car(); } }',
    });
    expect(edgeList(m)).toContain('composition A->V v 1');
  });

  it('multiplicity: 1, 0..1 for Optional or a null assignment, * for arrays and collections', async () => {
    const m = await analyze({
      'A.java': `import java.util.*; import java.util.concurrent.CopyOnWriteArrayList;
        class T {}
        class A {
          T one; T maybe; Optional<T> opt; T[] arr; T old[]; Set<T> set; Queue<T> q; Deque<T> dq; Collection<T> col;
          Map<String, T> map; CopyOnWriteArrayList<T> cow; List<? extends T> wild;
          void clear() { maybe = null; }
        }`,
    });
    expect(edgeList(m)).toEqual([
      'association A->T one 1',
      'association A->T maybe 0..1',
      'association A->T opt 0..1',
      'association A->T arr *',
      'association A->T old *',
      'association A->T set *',
      'association A->T q *',
      'association A->T dq *',
      'association A->T col *',
      'association A->T map *',
      'association A->T cow *',
      'association A->T wild *',
    ]);
    // A collection type outside the §7.1 list is read by its name, with lower confidence.
    const cow = m.edges.find((e) => e.to.role === 'cow')!;
    const set = m.edges.find((e) => e.to.role === 'set')!;
    expect(cow.confidence).toBeLessThan(set.confidence);
    expect(cow.evidence.map((e) => e.rule)).toContain('java.multiplicity.container');
  });

  it('fills an array with new in the constructor: composition with *', async () => {
    const m = await analyze({
      'A.java':
        'class B {} class A { B[] bs; A(int n) { bs = new B[n]; for (int i = 0; i < n; i++) bs[i] = new B(); } }',
    });
    expect(edgeList(m)).toEqual(['composition A->B bs *']);
  });

  it('an empty array from the constructor and a setter parameter: aggregation', async () => {
    const m = await analyze({
      'A.java': 'class B {} class A { B[] bs; A() { bs = new B[0]; } void setBs(B[] bs) { this.bs = bs; } }',
    });
    expect(edgeList(m)).toEqual(['aggregation A->B bs *']);
  });

  it('merges reciprocal plain associations into one, navigable both ways', async () => {
    const m = await analyze({ 'A.java': 'class A { B b; void drop() { b = null; } } class B { A a; }' });
    expect(m.edges).toHaveLength(1);
    const e = m.edges[0]!;
    expect(e).toMatchObject({
      kind: 'association',
      from: { node: 'class:A', role: 'a', multiplicity: '1', navigable: true },
      to: { node: 'class:B', role: 'b', multiplicity: '0..1', navigable: true },
    });
    expect(e.evidence.map((x) => x.rule)).toContain('java.field.reciprocal');
  });

  it('does not merge when one side is an aggregation', async () => {
    const m = await analyze({ 'A.java': 'class A { B b; A(B b) { this.b = b; } } class B { A a; }' });
    expect(edgeList(m)).toEqual(['aggregation A->B b 1', 'association B->A a 1']);
  });

  it('two fields of the same type give two edges with distinct ids', async () => {
    const m = await analyze({ 'A.java': 'class C {} class A { C x; C y; }' });
    expect(m.edges.map((e) => e.id)).toEqual(['association:class:A->class:C#x', 'association:class:A->class:C#y']);
  });

  it('only project types make edges; type parameters and JDK types do not', async () => {
    const m = await analyze({
      'A.java': 'import java.util.*; class Box<T> { T item; List<T> all; String s; Thread t; }',
    });
    expect(m.edges).toEqual([]);
  });

  it('the element of a generic project type is the type itself, not its argument', async () => {
    const m = await analyze({
      'A.java': 'import java.util.*; class Slot<T> {} class Act {} class S { List<Slot<Act>> slots; Slot<Act> one; }',
    });
    expect(edgeList(m)).toEqual(['association S->Slot slots *', 'association S->Slot one 1']);
  });
});

describe('dependencies', () => {
  const src = {
    'A.java': `class P {} class R {} class L {} class N {} class K { static int f() { return 1; } static int C = 1; } class F {}
      class A {
        F f;
        R run(P p) { L l = null; new N(); int x = K.f() + K.C; return null; }
        void again(F g) {}
      }`,
  };

  it('are hidden by default', async () => {
    expect(edgeList(await analyze(src))).toEqual(['association A->F f 1']);
  });

  it('come from parameters, returns, locals, new and static access, and never duplicate another relation', async () => {
    const m = await analyze(src, 'java.class', { showDependencies: true });
    expect(edgeList(m)).toEqual([
      'association A->F f 1',
      'dependency A->P',
      'dependency A->R',
      'dependency A->L',
      'dependency A->N',
      'dependency A->K',
    ]);
    const rules = (to: string) => edge(m, 'dependency', 'A', to)!.evidence.map((e) => e.rule);
    expect(rules('P')).toEqual(['java.use.parameter']);
    expect(rules('R')).toEqual(['java.use.return']);
    expect(rules('L')).toEqual(['java.use.local']);
    expect(rules('N')).toEqual(['java.use.new']);
    expect(rules('K')).toEqual(['java.use.static-access', 'java.use.static-access']);
    expect(edge(m, 'dependency', 'A', 'N')!.label).toBe('create');
    expect(edge(m, 'dependency', 'A', 'P')!.label).toBe('use');
  });

  it('a variable named like a type is not a static access', async () => {
    const m = await analyze(
      { 'A.java': 'class K { void f() {} } class A { void g(Object Kx) { K K = null; K.f(); } }' },
      'java.class',
      { showDependencies: true },
    );
    expect(edge(m, 'dependency', 'A', 'K')!.evidence.map((e) => e.rule)).toEqual(['java.use.local']);
  });

  it('a subclass using its parent in a signature gets no extra dependency', async () => {
    const m = await analyze(
      { 'A.java': 'class B {} class C extends B { B copy(B other) { return other; } }' },
      'java.class',
      { showDependencies: true },
    );
    expect(edgeList(m)).toEqual(['generalization C->B']);
  });

  it('nesting does not block a dependency between inner and outer class', async () => {
    const m = await analyze(
      { 'M.java': 'class M { private M(B b) {} static class B { M build() { return new M(this); } } }' },
      'java.class',
      { showDependencies: true },
    );
    expect(edgeList(m)).toEqual(['nesting M.B->M', 'dependency M->M.B', 'dependency M.B->M']);
    expect(edge(m, 'dependency', 'M.B', 'M')!.label).toBe('create');
  });
});

describe('name resolution', () => {
  it('resolves through the package, explicit imports and * imports', async () => {
    const m = await analyze({
      'a/X.java': 'package a; public class X {}',
      'b/Y.java': 'package b; public class Y {}',
      'c/Z.java': 'package c; public class Z {}',
      'c/W.java': 'package c; import a.X; import b.*; public class W { X x; Y y; Z z; }',
    });
    expect(edgeList(m)).toEqual(['association W->X x 1', 'association W->Y y 1', 'association W->Z z 1']);
  });

  it('a fully qualified name resolves too, and an unknown type makes no edge', async () => {
    const m = await analyze({
      'a/X.java': 'package a; public class X {}',
      'c/W.java': 'package c; public class W { a.X x; Missing m; }',
    });
    expect(edgeList(m)).toEqual(['association W->X x 1']);
    expect(attrs(m, 'W')).toEqual(['~ x: X', '~ m: Missing']);
  });

  it('an ambiguous name is reported and not linked', async () => {
    const m = await analyze({
      'a/T.java': 'package a; public class T {}',
      'b/T.java': 'package b; public class T {}',
      'c/W.java': 'package c; import a.*; import b.*; public class W { T t; }',
    });
    expect(m.edges).toEqual([]);
    expect(m.diagnostics).toEqual([
      expect.objectContaining({
        level: 'warn',
        message: expect.stringContaining('ambiguous type T'),
        ref: { file: 'c/W.java', line: 1 },
      }),
    ]);
  });

  it('member types resolve from the owner, from subclasses and by Outer.Inner', async () => {
    const m = await analyze({
      'A.java': 'class O { static class In {} In a; } class S extends O { In b; } class U { O.In c; }',
    });
    expect(edgeList(m).filter((e) => e.startsWith('association'))).toEqual([
      'association O->O.In a 1',
      'association S->O.In b 1',
      'association U->O.In c 1',
    ]);
  });
});

describe('java.package and java.dependency', () => {
  const src = {
    'a/A1.java': 'package a; import b.B1; public class A1 { B1 b; }',
    'a/A2.java': 'package a; import b.*; public class A2 { void f(B1 x, B2 y) {} }',
    'b/B1.java': 'package b; public class B1 {}',
    'b/B2.java': 'package b; public class B2 { B1 one; }',
    'D.java': 'public class D { a.A1 a; }',
  };

  it('java.package: one node per package, dependencies counted by type pairs', async () => {
    const m = await analyze(src, 'java.package');
    expect(m.nodes.map((n) => `${n.kind}:${n.name}`)).toEqual(['package:(default package)', 'package:a', 'package:b']);
    expect(m.edges.map((e) => `${e.from.node}->${e.to.node} ${e.label}`)).toEqual([
      'package:(default package)->package:a 1',
      'package:a->package:b 3',
    ]);
    expect(m.edges[1]!.evidence).toHaveLength(3);
    expect(m.edges[1]!.evidence[0]).toMatchObject({ rule: 'java.use.field', ref: { file: 'a/A1.java', line: 1 } });
  });

  it('java.dependency: every type use, counted, with no members', async () => {
    const m = await analyze(src, 'java.dependency');
    expect(m.nodes.every((n) => !n.attributes && !n.operations)).toBe(true);
    // Files are read in path order, so the default-package D.java comes first.
    expect(edgeList(m)).toEqual([
      'dependency D->A1',
      'dependency A1->B1',
      'dependency A2->B1',
      'dependency A2->B2',
      'dependency B2->B1',
    ]);
    expect(m.edges.map((e) => e.label)).toEqual(['1', '1', '1', '1', '1']);
  });
});

describe('robustness', () => {
  it('never throws on broken code: syntax errors become diagnostics and the rest still works', async () => {
    const m = await analyze({ 'A.java': 'class A { B b; void f( { } class B {}' });
    expect(m.diagnostics.some((d) => d.level === 'error' && d.ref?.file === 'A.java')).toBe(true);
    expect(m.nodes.map((n) => n.name)).toContain('A');
  });

  it('empty input and non-Java files give an info diagnostic', async () => {
    const m = await analyze({ 'x.sql': 'select 1;' });
    expect(m.nodes).toEqual([]);
    expect(m.diagnostics).toEqual([expect.objectContaining({ level: 'info' })]);
    expect((await javaAnalyzer.analyze([], 'java.class')).nodes).toEqual([]);
  });

  it('an unsupported kind is a diagnostic, not an exception', async () => {
    const m = await javaAnalyzer.analyze([{ path: 'A.java', content: 'class A {}' }], 'c.struct');
    expect(m.diagnostics[0]).toMatchObject({ level: 'error' });
  });

  it('reports a type declared twice', async () => {
    const m = await analyze({ 'A.java': 'class A {}', 'B.java': 'class A {}' });
    expect(m.nodes).toHaveLength(1);
    expect(m.diagnostics[0]).toMatchObject({ level: 'warn', message: expect.stringContaining('declared twice') });
  });

  it('every edge has evidence with a rule and a file:line, and confidence in 0..1', async () => {
    const m = await analyze(
      {
        'A.java': `import java.util.*; interface I {} class B implements I { List<C> cs = new ArrayList<>(); void add(C c) { cs.add(c); } }
          class C { B b; static class N {} void f(I i) {} }`,
      },
      'java.class',
      { showDependencies: true },
    );
    expect(m.edges.length).toBeGreaterThan(3);
    for (const e of m.edges) {
      expect(e.evidence.length).toBeGreaterThan(0);
      for (const ev of e.evidence) {
        expect(ev.rule).toMatch(/^java\./);
        expect(ev.ref).toMatchObject({ file: 'A.java', line: expect.any(Number) });
      }
      expect(e.confidence).toBeGreaterThan(0);
      expect(e.confidence).toBeLessThanOrEqual(1);
    }
    for (const n of m.nodes) expect(n.ref?.file).toBe('A.java');
  });

  it('a BOM at the start of the file is ignored', async () => {
    const m = await analyze({ 'A.java': '﻿class A {}' });
    expect(m.diagnostics).toEqual([]);
  });
});

describe('detect', () => {
  it('claims .java files and guesses pasted code', () => {
    expect(javaAnalyzer.detect({ path: 'A.java', content: '' })).toBe(1);
    expect(javaAnalyzer.detect({ path: 'a.c', content: 'class A {}' })).toBe(0);
    expect(
      javaAnalyzer.detect({ path: 'paste', content: 'import java.util.List;\npublic class A {}' }),
    ).toBeGreaterThanOrEqual(0.5);
    expect(javaAnalyzer.detect({ path: 'paste', content: 'echo hello' })).toBe(0);
  });
});
