// Adversarial edge cases for the Java analyzer. The fixtures under
// fixtures/java/edge-*/ are scored by fixtures.test.ts; this file checks what an
// expected.yaml cannot say: ids, evidence, determinism, robustness and speed.
import { describe, expect, it } from 'vitest';
import { type FixtureCase, loadFixtures } from '../../../bench/fixtures';
import type { DiagramKind, DiagramModel, SourceFile } from '../../../model/types';
import { javaAnalyzer } from '..';
import { analyze, attrs, edge, edgeList, node, ops } from './helpers';

const KINDS: DiagramKind[] = ['java.class', 'java.package', 'java.dependency'];
const ALL_ON = { showAccessors: true, showDependencies: true, showMain: true, showObjectMethods: true };
const publicCases: FixtureCase[] = await loadFixtures({ lang: 'java', includePrivate: false });

const run = (files: SourceFile[], kind: DiagramKind = 'java.class', opts = {}) =>
  javaAnalyzer.analyze(files, kind, opts);

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
    checkRef(`node ${n.id}`, n.ref);
    const ev = (n as { evidence?: { ref?: { file: string; line: number } }[] }).evidence ?? [];
    if (!ev.length) problems.push(`node ${n.id}: no evidence`);
    ev.forEach((e, i) => checkRef(`node ${n.id} evidence ${i}`, e.ref));
    if (n.parent && !m.nodes.some((x) => x.id === n.parent)) problems.push(`node ${n.id}: unknown parent`);
  }
  const edgeIds = new Set<string>();
  const shapes = new Set<string>();
  for (const e of m.edges) {
    if (edgeIds.has(e.id)) problems.push(`duplicate edge id ${e.id}`);
    edgeIds.add(e.id);
    if (!ids.has(e.from.node) || !ids.has(e.to.node)) problems.push(`edge ${e.id}: end is not a node`);
    const shape = `${e.kind} ${e.from.node} ${e.to.node} ${e.to.role ?? ''} ${e.from.role ?? ''}`;
    if (shapes.has(shape)) problems.push(`duplicate edge ${shape}`);
    shapes.add(shape);
    if (!(e.confidence > 0 && e.confidence <= 1)) problems.push(`edge ${e.id}: confidence ${e.confidence}`);
    if (!e.evidence.length) problems.push(`edge ${e.id}: no evidence`);
    e.evidence.forEach((ev, i) => checkRef(`edge ${e.id} evidence ${i} (${ev.rule})`, ev.ref));
  }
  for (const d of m.diagnostics) {
    if (/internal error/.test(d.message)) problems.push(`exception: ${d.message}`);
    if (d.ref) checkRef(`diagnostic "${d.message}"`, d.ref);
  }
  return problems;
}

// ---------------------------------------------------------------- generated project

/** 300 files in 10 packages: an inheritance chain, collections, star imports and nested types. */
function bigProject(n = 300): SourceFile[] {
  const files: SourceFile[] = [];
  for (let i = 0; i < n; i++) {
    const pkg = `gerado.p${i % 10}`;
    const prev = i > 0 ? `gerado.p${(i - 1) % 10}.C${i - 1}` : undefined;
    const other = `C${(i * 7 + 3) % n}`;
    const otherPkg = `gerado.p${((i * 7 + 3) % n) % 10}`;
    files.push({
      path: `gerado/p${i % 10}/C${i}.java`,
      content: [
        `package ${pkg};`,
        'import java.util.*;',
        `import ${otherPkg}.*;`,
        `public class C${i}${prev ? ` extends ${prev}` : ''} implements Comparable<C${i}> {`,
        `  private final List<${other}> itens = new ArrayList<>();`,
        `  private Map<String, List<${other}>> indice = new HashMap<>();`,
        `  private Interna interna = new Interna();`,
        `  public C${i}() { }`,
        `  public void add(${other} x) { itens.add(x); }`,
        `  public int compareTo(C${i} o) { return 0; }`,
        `  public ${other} primeiro() { return itens.isEmpty() ? null : itens.get(0); }`,
        `  static class Interna { int v; Runnable r = () -> System.out.println("C${i}"); }`,
        '}',
      ].join('\n'),
    });
  }
  return files;
}

function shuffled<T>(list: readonly T[], seed = 7): T[] {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------- tests

describe('empty and trivial input', () => {
  it('no files at all', async () => {
    const m = await run([]);
    expect(m.nodes).toEqual([]);
    expect(m.edges).toEqual([]);
    expect(m.diagnostics.map((d) => d.level)).toEqual(['info']);
  });

  it('only non-Java files', async () => {
    const m = await run([{ path: 'README.md', content: '# class Fantasma {}' }]);
    expect(m.nodes).toEqual([]);
    expect(m.diagnostics[0]?.level).toBe('info');
  });

  it.each([
    ['empty file', ''],
    ['only comments', '// class A {}\n/* interface B {} */\n/** record C(int x) {} */\n'],
    ['only a package and imports', 'package a.b;\nimport java.util.*;\n'],
    ['only whitespace and a BOM', '﻿ \r\n\t\r\n'],
  ])('%s gives no nodes and one info diagnostic', async (_name, content) => {
    for (const kind of KINDS) {
      const m = await run([{ path: 'X.java', content }], kind);
      expect(m.nodes).toEqual([]);
      expect(m.edges).toEqual([]);
      expect(m.diagnostics.map((d) => d.level)).toEqual(['info']);
    }
  });
});

describe('encodings and line ends', () => {
  const lf = [
    'package acentos;',
    'public class Órgão {',
    '  private String descrição;',
    '  private Ação ação = new Ação();',
    '  public String getÁrea() {',
    '    return descrição;',
    '  }',
    '  public void setÁrea(String a) {',
    '    this.descrição = a;',
    '  }',
    '  void f() { Éxito.correr(); }',
    '}',
    'class Ação {}',
    'class Éxito { static void correr() {} }',
    '',
  ].join('\n');

  it('accented names, getters and static calls', async () => {
    const m = await analyze({ 'acentos/Órgão.java': lf }, 'java.class', { showDependencies: true });
    expect(m.nodes.map((n) => n.id)).toEqual(['class:acentos.Órgão', 'class:acentos.Ação', 'class:acentos.Éxito']);
    expect(attrs(m, 'Órgão')).toEqual(['- descrição: String', '- ação: Ação']);
    // getÁrea and setÁrea are trivial accessors even though the first letter after get/set is not ASCII.
    expect(ops(m, 'Órgão')).toEqual(['~ f(): void']);
    expect(edgeList(m)).toEqual(['composition Órgão->Ação ação 1', 'dependency Órgão->Éxito']);
  });

  it('a BOM and CRLF give the same model as plain LF', async () => {
    const plain = await analyze({ 'acentos/Órgão.java': lf }, 'java.class', ALL_ON);
    const crlf = await analyze({ 'acentos/Órgão.java': `﻿${lf.replace(/\n/g, '\r\n')}` }, 'java.class', ALL_ON);
    expect(crlf).toEqual(plain);
    expect(JSON.stringify(crlf)).not.toMatch(/\\r/);
  });

  it('line numbers count CRLF lines', async () => {
    const m = await analyze({ 'acentos/Órgão.java': `﻿${lf.replace(/\n/g, '\r\n')}` });
    expect(node(m, 'Éxito').ref).toEqual({ file: 'acentos/Órgão.java', line: 14 });
    expect(edge(m, 'composition', 'Órgão', 'Ação')?.evidence[0]?.ref?.line).toBe(4);
  });
});

describe('comments and strings', () => {
  it('code in comments, strings and text blocks is not code', async () => {
    const m = await analyze(
      {
        'X.java': [
          '/* class Fantasma { Y y = new Y(); } */',
          '// class Outro extends X {}',
          'class X {',
          '  String s = "new Y(); class Z {}";',
          '  String t = """',
          '    class W { Y y; }',
          '    """;',
          '  /* Y y; */',
          '  void f() { /* new Y(); */ String u = "Y.estatico()"; }',
          '}',
          'class Y {}',
        ].join('\n'),
      },
      'java.class',
      ALL_ON,
    );
    expect(m.nodes.map((n) => n.name)).toEqual(['X', 'Y']);
    expect(m.edges).toEqual([]);
    expect(m.diagnostics).toEqual([]);
  });

  it('comments between tokens of a type do not change the type or hide the relation', async () => {
    const m = await analyze({
      'A.java': [
        'import java.util.*;',
        'class Base {}',
        'interface I {}',
        'class A extends /* pai */ Base implements /* contrato */ I {',
        '  List<B /* elementos */> bs;',
        '  Map<String, /* valor */ B> porNome;',
        '  List<? super /* limite */ B> sumidouro;',
        '}',
        'class B {}',
      ].join('\n'),
    });
    expect(attrs(m, 'A')).toEqual(['~ bs: List<B>', '~ porNome: Map<String, B>', '~ sumidouro: List<? super B>']);
    expect(edgeList(m)).toEqual([
      'generalization A->Base',
      'realization A->I',
      'association A->B bs 0..*',
      'association A->B porNome 0..*',
    ]);
  });
});

describe('imports and names', () => {
  it('resolves the same simple name to the right package', async () => {
    const fx = publicCases.find((c) => c.name === 'edge-imports')!;
    const m = await run(fx.files, 'java.class');
    const target = (from: string, role: string) =>
      m.edges.find((e) => e.from.node === `class:${from}` && e.to.role === role)?.to.node;
    expect(target('loja.c.MesmoPacote', 'item')).toBe('class:loja.c.Item');
    expect(target('loja.c.MesmoPacote', 'outro')).toBe('class:loja.b.Outro');
    expect(target('loja.d.Explicito', 'item')).toBe('class:loja.b.Item');
    expect(target('loja.e.Ambiguo', 'itens')).toBeUndefined();
    expect(target('loja.e.Ambiguo', 'outro')).toBe('class:loja.b.Outro');
    expect(target('loja.f.Qualificado', 'item')).toBe('class:loja.a.Item');
    expect(target('loja.f.Qualificado', 'janela')).toBeUndefined();
    const warn = m.diagnostics.filter((d) => d.level === 'warn');
    expect(warn).toEqual([
      {
        level: 'warn',
        message: 'ambiguous type Item (loja.a.Item, loja.b.Item); not linked',
        ref: { file: 'loja/e/Ambiguo.java', line: 9 },
      },
    ]);
  });

  it('JDK names never link to project types that share the simple name', async () => {
    const m = await analyze(
      {
        'modelo/Entry.java': 'package modelo; public class Entry {}',
        'modelo/Node.java': 'package modelo; public class Node {}',
        'modelo/List.java': 'package modelo; public class List {}',
        'modelo/Optional.java': 'package modelo; public class Optional {}',
        'app/Uso.java': [
          'package app;',
          'import java.util.*;',
          'import java.util.List;',
          'import org.w3c.dom.Node;',
          'public class Uso {',
          '  private Map.Entry<String, Integer> par;',
          '  private java.util.Map.Entry<String, Integer> par2;',
          '  private Node dom;',
          '  private List<String> nomes;',
          '  private Optional<String> talvez;',
          '  void f() { Optional.empty(); List.of(); String.valueOf(1); }',
          '}',
        ].join('\n'),
      },
      'java.class',
      { showDependencies: true },
    );
    expect(m.nodes.map((n) => n.name).sort()).toEqual(['Entry', 'List', 'Node', 'Optional', 'Uso']);
    expect(m.edges).toEqual([]);
  });

  it('every node is a type declared in the input', async () => {
    for (const fx of publicCases) {
      const declared = new Set(
        fx.files.flatMap((f) =>
          [...f.content.matchAll(/\b(?:class|interface|enum|record)\s+([\p{L}_$][\p{L}\d_$]*)/gu)].map((x) => x[1]!),
        ),
      );
      const m = await run(fx.files, 'java.class', ALL_ON);
      for (const n of m.nodes) expect(declared, `${fx.name}: ${n.name}`).toContain(n.name.split('.').pop());
    }
  });
});

describe('types and members', () => {
  it('a class listed twice in implements gives one arrow', async () => {
    const m = await analyze({ 'A.java': 'interface I {}\ninterface J extends I, I {}\nclass A implements I, I {}' });
    expect(edgeList(m)).toEqual(['generalization J->I', 'realization A->I']);
  });

  it('anonymous classes: their code is the enclosing class, their own fields hide the outer ones', async () => {
    const m = await analyze({
      'A.java': [
        'class A {',
        '  private B b = new B();',
        '  private B c = new B();',
        '  Runnable r = new Runnable() { public void run() { b = null; } };',
        '  void f() {',
        '    new Thread(new Runnable() { private B c; public void run() { c = null; this.c = null; } });',
        '  }',
        '}',
        'class B {}',
      ].join('\n'),
    });
    expect(edgeList(m)).toEqual(['composition A->B b 0..1', 'composition A->B c 1']);
  });

  it('an anonymous class creating the object later does not make a composition', async () => {
    const m = await analyze({
      'A.java':
        'class A {\n  private B b;\n  A() { Runnable r = new Runnable() { public void run() { b = new B(); } }; }\n}\nclass B {}',
    });
    expect(edgeList(m)).toEqual(['association A->B b 1']);
  });

  it('local classes are not nodes but their uses count for the enclosing type', async () => {
    const m = await analyze(
      {
        'A.java': [
          'class A {',
          '  void f() {',
          '    class Local extends Base { C c; D g(E e) { return null; } }',
          '    record Par(F f) {}',
          '  }',
          '}',
          'class Base {} class C {} class D {} class E {} class F {}',
        ].join('\n'),
      },
      'java.class',
      { showDependencies: true },
    );
    expect(m.nodes.map((n) => n.name)).toEqual(['A', 'Base', 'C', 'D', 'E', 'F']);
    expect(edgeList(m)).toEqual([
      'dependency A->Base',
      'dependency A->C',
      'dependency A->D',
      'dependency A->E',
      'dependency A->F',
    ]);
  });

  it('switch and instanceof patterns are uses', async () => {
    const m = await analyze(
      {
        'S.java': [
          'sealed interface Forma permits Circulo, Quadrado {}',
          'record Circulo(double r) implements Forma {}',
          'record Quadrado(Ponto canto, double l) implements Forma {}',
          'record Ponto(int x, int y) {}',
          'class S {',
          '  static String f(Object o) {',
          '    if (o instanceof Circulo c) return "c";',
          '    return switch (o) {',
          '      case Quadrado(Ponto(int x, int y), double l) -> "q";',
          '      default -> "?";',
          '    };',
          '  }',
          '}',
        ].join('\n'),
      },
      'java.class',
      { showDependencies: true },
    );
    expect(edgeList(m).filter((e) => e.startsWith('dependency'))).toEqual([
      'dependency S->Circulo',
      'dependency S->Quadrado',
      'dependency S->Ponto',
    ]);
  });

  it('records: compact and explicit constructors, generic components', async () => {
    const m = await analyze({
      'Par.java': [
        'import java.util.*;',
        'public record Par<A>(A a, Item item, List<Item> itens) {',
        '  public Par { Objects.requireNonNull(item); itens = List.copyOf(itens); }',
        '  public Par(Item item) { this(null, item, List.of()); }',
        '  public static <T> Par<T> de(T t) { return new Par<>(t, new Item(), List.of()); }',
        '}',
        'class Item {}',
      ].join('\n'),
    });
    expect(attrs(m, 'Par')).toEqual(['- a: A {readOnly}', '- item: Item {readOnly}', '- itens: List<Item> {readOnly}']);
    expect(ops(m, 'Par')).toEqual([
      '+ Par(a: A, item: Item, itens: List<Item>)',
      '+ Par(item: Item)',
      '+ de(t: T): Par<T>',
    ]);
    expect(edgeList(m)).toEqual(['aggregation Par->Item item 1', 'aggregation Par->Item itens 0..*']);
  });

  it('a parameterised outer type still names the inner class', async () => {
    const m = await analyze({
      'A.java': 'class A<T> { class In {} static class Est<E> {} }\nclass U { A<String>.In i; A.Est<Integer> e; }',
    });
    expect(attrs(m, 'U')).toEqual(['~ i: A<String>.In', '~ e: A.Est<Integer>']);
    expect(edgeList(m)).toContain('association U->A.In i 1');
    expect(edgeList(m)).toContain('association U->A.Est e 1');
  });
});

describe('syntax errors and hostile input', () => {
  it('an unterminated string loses that class but nothing else, and says where', async () => {
    const m = await analyze({
      'A.java': 'class A { B b = new B(); }\nclass B {}',
      'E.java': 'class E {\n  void f() { String s = "sem fim; }\n}',
    });
    expect(m.nodes.map((n) => n.name)).toEqual(['A', 'B']);
    expect(edgeList(m)).toEqual(['composition A->B b 1']);
    const errors = m.diagnostics.filter((d) => d.level === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((d) => d.ref?.file === 'E.java' && d.ref.line >= 1)).toBe(true);
  });

  it.each([
    ['cyclic inheritance', 'class A extends B {}\nclass B extends A { A a = new B(); }'],
    ['self inheritance', 'class A extends A { A a = new A(); }\ninterface I extends I {}'],
    ['inheritance from its own member', 'class A extends A.In { static class In {} In x = new In(); }'],
    ['deep generics', `class A { ${'java.util.List<'.repeat(200)}A${'>'.repeat(200)} x; }`],
    ['deep expression', `class A { int x = ${'('.repeat(2000)}1${')'.repeat(2000)}; }`],
    ['garbage', '\u0000\u0001}{)(class<>;;@@interface record enum ::->'],
    ['keywords only', 'class interface enum record extends implements permits'],
    ['a very long line', `class A { ${Array.from({ length: 3000 }, (_, i) => `int f${i};`).join(' ')} }`],
    ['annotations only', '@interface Marca { String valor() default ""; }\n@Marca class A {}'],
  ])('%s does not throw', async (_name, content) => {
    for (const kind of KINDS) {
      const files = [{ path: 'A.java', content }];
      const m = await run(files, kind, ALL_ON);
      expect(wellFormed(m, files)).toEqual([]);
    }
  });

  it('a 3000-class inheritance chain does not overflow', async () => {
    const n = 3000;
    const lines = Array.from({ length: n }, (_, i) => `class C${i}${i ? ` extends C${i - 1}` : ''} {}`);
    lines.push(`class Z { C0 c = new C${n - 1}(); }`);
    const files = [{ path: 'C.java', content: lines.join('\n') }];
    const m = await run(files);
    expect(wellFormed(m, files)).toEqual([]);
    expect(edgeList(m)).toContain('composition Z->C0 c 1');
  });

  it('every prefix of every public fixture file analyzes without an exception', async () => {
    for (const fx of publicCases) {
      for (const f of fx.files) {
        const step = Math.max(7, Math.floor(f.content.length / 40));
        for (let cut = 0; cut <= f.content.length; cut += step) {
          const files = fx.files.map((x) => (x === f ? { ...x, content: x.content.slice(0, cut) } : x));
          const m = await run(files, 'java.class', ALL_ON);
          expect(wellFormed(m, files), `${fx.name}/${f.path} cut at ${cut}`).toEqual([]);
        }
      }
    }
  });
});

describe('ids, evidence and duplicates', () => {
  const inputs: [string, SourceFile[]][] = [
    ...publicCases.map((c) => [c.name, c.files] as [string, SourceFile[]]),
    ['generated-60', bigProject(60)],
  ];

  it.each(inputs)('%s: every model is well formed, in every kind', async (_name, files) => {
    for (const kind of KINDS) {
      for (const opts of [{}, ALL_ON]) expect(wellFormed(await run(files, kind, opts), files)).toEqual([]);
    }
  });

  it.each(inputs)('%s: the same input in another order gives the same model', async (_name, files) => {
    for (const kind of KINDS) {
      const a = await run(files, kind, ALL_ON);
      const b = await run(shuffled(files), kind, ALL_ON);
      const c = await run(shuffled(files, 99), kind, ALL_ON);
      expect(b).toEqual(a);
      expect(c).toEqual(a);
    }
  });

  it('ids follow the contract', async () => {
    const m = await analyze({ 'p/A.java': 'package p; public class A { static class B {} B b1; B b2; }' });
    expect(m.nodes.map((n) => n.id)).toEqual(['class:p.A', 'class:p.A.B']);
    expect(m.edges.map((e) => e.id)).toEqual([
      'nesting:class:p.A.B->class:p.A',
      'association:class:p.A->class:p.A.B#b1',
      'association:class:p.A->class:p.A.B#b2',
    ]);
  });
});

describe('a generated project with 300 files', () => {
  const files = bigProject(300);

  it.each(KINDS)('%s takes well under the budget', async (kind) => {
    await run(files.slice(0, 5), kind); // warm-up: grammar load
    const t0 = performance.now();
    const m = await run(files, kind, ALL_ON);
    const ms = performance.now() - t0;
    console.info(`[java ${kind}] 300 files: ${ms.toFixed(0)} ms, ${m.nodes.length} nodes, ${m.edges.length} edges`);
    expect(m.diagnostics.filter((d) => d.level !== 'info')).toEqual([]);
    expect(m.nodes.length).toBe(kind === 'java.package' ? 10 : 600);
    expect(ms).toBeLessThan(5000);
    expect(wellFormed(m, files)).toEqual([]);
  });

  it('finds the relations it was built with', async () => {
    const m = await run(files);
    const name = (i: number) => `C${i}`;
    expect(edge(m, 'generalization', name(10), name(9))).toBeDefined();
    expect(edge(m, 'nesting', `${name(10)}.Interna`, name(10))).toBeDefined();
    expect(edge(m, 'composition', name(10), `${name(10)}.Interna`)).toBeDefined();
    // itens gets add(x) from a parameter: aggregation; indice is a Map value list: association.
    const target = name((10 * 7 + 3) % 300);
    const toTarget = m.edges.filter((e) => e.from.node === 'class:gerado.p0.C10' && e.to.node.endsWith(`.${target}`));
    expect(toTarget.map((e) => `${e.kind} ${e.to.role} ${e.to.multiplicity}`)).toEqual([
      'aggregation itens 0..*',
      'association indice 0..*',
    ]);
  });
});
