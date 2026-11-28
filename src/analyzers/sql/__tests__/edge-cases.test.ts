// Adversarial edge cases for the SQL analyzer. The fixtures under
// fixtures/sql/edge-*/ are scored by fixtures.test.ts; this file checks what an
// expected.yaml cannot say: ids, evidence, determinism, robustness and speed.
import { describe, expect, it } from 'vitest';
import { type FixtureCase, loadFixtures } from '../../../bench/fixtures';
import type { DiagramKind, DiagramModel, SourceFile } from '../../../model/types';
import { sqlAnalyzer } from '..';
import { parseSql } from '../parse';
import { analyze, attrs, edgeList, messages, node } from './helpers';

const KINDS: DiagramKind[] = ['sql.relational', 'sql.ssms', 'sql.chen', 'sql.crowsfoot'];
const publicCases: FixtureCase[] = await loadFixtures({ lang: 'sql', includePrivate: false });
const allFiles = publicCases.flatMap((c) => c.files);

const run = (files: SourceFile[], kind: DiagramKind = 'sql.relational', opts = {}) =>
  sqlAnalyzer.analyze(files, kind, opts);

/** Structural checks every model must pass, whatever the input. */
function wellFormed(m: DiagramModel, files: readonly SourceFile[]): string[] {
  const problems: string[] = [];
  const lines = new Map(files.map((f) => [f.path, f.content.split('\n').length]));
  const checkRef = (what: string, ref: { file: string; line: number; endLine?: number } | undefined) => {
    if (!ref) return problems.push(`${what}: no ref`);
    const max = lines.get(ref.file);
    if (max === undefined) problems.push(`${what}: ref to unknown file ${ref.file}`);
    if (!Number.isInteger(ref.line) || ref.line < 1 || (max !== undefined && ref.line > max))
      problems.push(`${what}: bad line ${ref.line} in ${ref.file}`);
    if (ref.endLine !== undefined && !(ref.endLine > ref.line)) problems.push(`${what}: bad endLine ${ref.endLine}`);
  };
  const ids = new Set<string>();
  for (const n of m.nodes) {
    if (ids.has(n.id)) problems.push(`duplicate node id ${n.id}`);
    ids.add(n.id);
    if (!n.id.startsWith(`${n.kind}:`)) problems.push(`node ${n.id}: id does not start with its kind`);
    checkRef(`node ${n.id}`, n.ref);
    const ev = n.evidence ?? [];
    if (!ev.length) problems.push(`node ${n.id}: no evidence`);
    ev.forEach((e, i) => checkRef(`node ${n.id} evidence ${i}`, e.ref));
    for (const a of n.attributes ?? []) checkRef(`attribute ${n.id}.${a.name}`, a.ref);
  }
  const edgeIds = new Set<string>();
  const shapes = new Set<string>();
  for (const e of m.edges) {
    if (edgeIds.has(e.id)) problems.push(`duplicate edge id ${e.id}`);
    edgeIds.add(e.id);
    if (!ids.has(e.from.node) || !ids.has(e.to.node)) problems.push(`edge ${e.id}: end is not a node`);
    // Two edges may share their ends (two FKs to one table), but not their ends, cells, multiplicities and source.
    const end = (x: typeof e.from) => `${x.node}.${x.column ?? ''}:${x.multiplicity ?? ''}`;
    const shape = `${e.kind} ${end(e.from)} ${end(e.to)} ${e.evidence[0]?.note ?? ''}`;
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

// ---------------------------------------------------------------- every public fixture

describe('every public fixture, every diagram', () => {
  it.each(publicCases.map((c) => [c.name, c] as const))('%s is well formed', async (_name, fx) => {
    for (const kind of KINDS)
      for (const opts of [{}, { showDependencies: true }]) {
        const m = await run(fx.files, kind, opts);
        expect({ kind, opts, problems: wellFormed(m, fx.files) }).toEqual({ kind, opts, problems: [] });
      }
  });

  it('gives the same model twice and for any file order', async () => {
    const reversed = [...allFiles].reverse();
    const rotated = [...allFiles.slice(7), ...allFiles.slice(0, 7)];
    for (const kind of KINDS) {
      const a = JSON.stringify(await run(allFiles, kind, { showDependencies: true }));
      expect(JSON.stringify(await run(allFiles, kind, { showDependencies: true }))).toBe(a);
      expect(JSON.stringify(await run(reversed, kind, { showDependencies: true }))).toBe(a);
      expect(JSON.stringify(await run(rotated, kind, { showDependencies: true }))).toBe(a);
    }
  });

  it('node ids follow `${kind}:${qualified name}` and do not depend on the rest of the schema', async () => {
    const alone = await analyze('CREATE TABLE vendas.cliente (id INT PRIMARY KEY);');
    expect(alone.nodes.map((n) => n.id)).toEqual(['table:vendas.cliente']);
    const crowded = await analyze({
      'a.sql': 'CREATE TABLE outra (id INT PRIMARY KEY);',
      'b.sql': 'CREATE TABLE vendas.cliente (id INT PRIMARY KEY, o INT REFERENCES outra);',
    });
    expect(crowded.nodes.map((n) => n.id)).toContain('table:vendas.cliente');
  });

  it('never makes nodes for objects the files do not create (system tables, functions)', async () => {
    const sql = `
      CREATE TABLE t (
        id INT PRIMARY KEY,
        criado DATETIME DEFAULT GETDATE(),
        u UNIQUEIDENTIFIER DEFAULT NEWID(),
        o INT REFERENCES sys.objects (object_id)
      );
      CREATE VIEW v AS SELECT t.id, s.name FROM t JOIN sys.tables s ON s.object_id = t.o
        CROSS JOIN INFORMATION_SCHEMA.COLUMNS c CROSS APPLY dbo.fn_split(s.name, ',') f;`;
    for (const kind of KINDS) {
      const m = await analyze(sql, kind, { showDependencies: true });
      expect(m.nodes.map((n) => n.name).filter((n) => n !== '')).toEqual(
        kind === 'sql.chen' || kind === 'sql.crowsfoot' ? ['t'] : ['t', 'v'],
      );
    }
    expect(messages(await analyze(sql), 'warn')).toEqual([
      'foreign key t(o) references objects, which is not defined; not drawn',
    ]);
  });
});

// ---------------------------------------------------------------- inputs with nothing to draw

describe('inputs with nothing to draw', () => {
  const cases: [string, SourceFile[]][] = [
    ['no files', []],
    ['an empty file', [{ path: 'vazio.sql', content: '' }]],
    ['only whitespace and a BOM', [{ path: 'b.sql', content: '﻿ \r\n\t\r\n' }]],
    ['only comments', [{ path: 'c.sql', content: '-- nada\r\n/* nada\n /* mesmo */ nada */\n# nada\n' }]],
    [
      'only INSERTs',
      [
        {
          path: 'dados.sql',
          content: "INSERT INTO t VALUES (1, 'CREATE TABLE z (x INT);');\nINSERT INTO t VALUES (2, ')')\nGO\n",
        },
      ],
    ],
  ];
  it.each(cases)('%s gives an empty model and one warning', async (_name, files) => {
    for (const kind of KINDS) {
      const m = await run(files, kind);
      expect(m.nodes).toEqual([]);
      expect(m.edges).toEqual([]);
      expect(m.diagnostics.filter((d) => d.level !== 'info').map((d) => d.message)).toEqual(['no CREATE TABLE found']);
      expect(wellFormed(m, files)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------- encodings and line ends

describe('encodings and line ends', () => {
  it('reports lines correctly after a BOM and with CRLF', async () => {
    const fx = publicCases.find((c) => c.name === 'edge-bom-crlf')!;
    expect(fx.files[0]!.content.startsWith('﻿') || fx.files[0]!.content.includes('\r\n')).toBe(true);
    const m = await run(fx.files);
    expect(node(m, 'Prateleira').ref).toMatchObject({ line: 7, endLine: 11 });
    expect(m.edges[0]!.evidence[0]!.ref?.line).toBe(9);
    expect(node(m, 'Armazém').attributes?.map((a) => a.ref?.line)).toEqual([3, 4]);
  });

  it('keeps decomposed (NFD) accents inside a name', async () => {
    const m = await analyze('CREATE TABLE Armázem (Código INT PRIMARY KEY, Descrição TEXT);');
    expect(m.nodes.map((n) => n.name)).toEqual(['Armázem']);
    expect(attrs(m, 'Armázem')).toEqual(['Código', 'Descrição']);
  });

  it('reads accents, CJK and quoted emoji in names', async () => {
    const m = await analyze('CREATE TABLE 学生 (编号 INT PRIMARY KEY, "nome 🙂" TEXT, ñandú INT);');
    expect(attrs(m, '学生')).toEqual(['编号', 'nome 🙂', 'ñandú']);
  });
});

// ---------------------------------------------------------------- bugs found by this review

describe('regressions', () => {
  it('keeps tables with the same name in different schemas apart', async () => {
    const fx = publicCases.find((c) => c.name === 'edge-schemas')!;
    const m = await run(fx.files);
    expect(m.nodes.map((n) => n.id)).toEqual([
      'table:vendas.cliente',
      'table:rh.cliente',
      'table:vendas.fatura',
      'table:rh.ferias',
    ]);
    expect(m.edges.map((e) => `${e.from.node} -> ${e.to.node}`)).toEqual([
      'table:vendas.fatura -> table:vendas.cliente',
      'table:rh.ferias -> table:rh.cliente',
    ]);
    expect(messages(m, 'warn')).toEqual([]);
  });

  it('still treats `T` and `dbo.T` as one table', async () => {
    const m = await analyze(`
      CREATE TABLE dbo.a (id INT PRIMARY KEY);
      CREATE TABLE b (id INT PRIMARY KEY, a_id INT REFERENCES a (id));
      ALTER TABLE dbo.b ADD x INT;
      CREATE TABLE a (id INT PRIMARY KEY, nome TEXT);`);
    expect(m.nodes.map((n) => n.name)).toEqual(['a', 'b']);
    expect(attrs(m, 'b')).toEqual(['id', 'a_id', 'x']);
    expect(messages(m, 'warn')).toEqual(['table a is created more than once; the last definition wins']);
  });

  it('draws a foreign key declared twice only once', async () => {
    const sql = `
      CREATE TABLE a (id INT PRIMARY KEY);
      CREATE TABLE b (
        id INT PRIMARY KEY,
        a_id INT REFERENCES a (id),
        FOREIGN KEY (a_id) REFERENCES a
      );
      ALTER TABLE b ADD CONSTRAINT fk_b_a FOREIGN KEY (a_id) REFERENCES a (id);`;
    for (const kind of KINDS) {
      const m = await analyze(sql, kind);
      expect(m.edges.length).toBe(kind === 'sql.chen' ? 2 : 1);
      expect(wellFormed(m, [{ path: 'schema.sql', content: sql }])).toEqual([]);
    }
    const chen = await analyze(sql, 'sql.chen');
    expect(chen.nodes.find((n) => n.kind === 'relationship')?.name).toBe('fk_b_a');
    expect(messages(chen, 'info').filter((m) => /more than once/.test(m))).toHaveLength(2);
  });

  it('reads nested block comments inside a column definition', async () => {
    const m = await analyze(
      'CREATE TABLE n (id INT PRIMARY KEY, /* fora /* dentro */ ainda fora */ v INT NOT NULL);',
      'sql.crowsfoot',
    );
    expect(attrs(m, 'n')).toEqual(['id: INT', 'v: INT']);
  });

  it('ends an unbalanced nested comment at the first */ (MySQL and SQLite do not nest)', async () => {
    const m = await analyze('/* a /* b */ CREATE TABLE t (id INT PRIMARY KEY);');
    expect(m.nodes.map((n) => n.name)).toEqual(['t']);
  });

  it('reads every column of a T-SQL ALTER TABLE ... ADD a, b, c', async () => {
    const m = await analyze(`
      CREATE TABLE t (id INT PRIMARY KEY);
      ALTER TABLE t ADD a INT NOT NULL, b INT, c INT REFERENCES t (id), CONSTRAINT u UNIQUE (b);
      ALTER TABLE t ADD d INT, DROP COLUMN zz, e INT;`);
    expect(attrs(m, 't')).toEqual(['id', 'a', 'b', 'c', 'd']);
    expect(edgeList(m)).toEqual(['foreign-key t.c->t.id']);
    expect(node(m, 't').attributes?.find((a) => a.name === 'b')?.flags).toContain('unique');
  });

  it('warns when a foreign key names a column the referenced table does not have', async () => {
    const m = await analyze('CREATE TABLE a (id INT PRIMARY KEY); CREATE TABLE b (x INT REFERENCES a (nao_existe));');
    expect(messages(m, 'warn')).toEqual(['foreign key b(x) references a.nao_existe, which is not a column of a']);
  });

  it('reads a MySQL column called key whose type has arguments, next to real KEY and INDEX lines', async () => {
    const m = await analyze(
      "CREATE TABLE cfg (id INT PRIMARY KEY, key VARCHAR(40) NOT NULL, index INT, KEY idx_k (key), INDEX (index), KEY idx_u USING BTREE (id), value ENUM('a','b'));",
    );
    expect(attrs(m, 'cfg')).toEqual(['id', 'key', 'index', 'value']);
  });

  it('makes no node from a keyword where a name is missing', async () => {
    const m = await analyze(
      'CREATE VIEW AS SELECT * FROM t;\nCREATE TABLE TABLE (id INT);\nCREATE TABLE ok (id INT);',
      'sql.relational',
      {
        showDependencies: true,
      },
    );
    expect(m.nodes.map((n) => n.name)).toEqual(['ok']);
    expect(messages(m, 'warn')).toEqual([
      'CREATE VIEW without a view name; skipped',
      'CREATE TABLE without a table name; skipped',
    ]);
  });
});

// ---------------------------------------------------------------- robustness

/** Deterministic pseudo-random numbers (mulberry32), so a failure can be replayed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  'CREATE', 'TABLE', 'VIEW', 'ALTER', 'ADD', 'CONSTRAINT', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE',
  'NOT', 'NULL', 'CHECK', 'DEFAULT', 'IDENTITY', 'AS', 'SELECT', 'FROM', 'JOIN', 'ON', 'IF', 'BEGIN', 'END',
  'ELSE', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'GO\n', 'DELIMITER //\n', 'DELIMITER ;\n', '//', 'WITH', 'INSERT',
  'INTO', 'VALUES', 'a', 'b', 't', 'dbo.t', '[x y]', '"q"', '`w`', 'INT', 'VARCHAR(10)', 'DECIMAL(5,2)', '(', ')',
  '(', ')', ',', ',', ';', ';', '.', "'s'", "'", '"', '[', '/*', '*/', '--', '\n', '\r\n', '$$', '$f$', '#tmp',
  'N\'x\'', '0x1F', '1e5', '﻿', 'ç', 'á',
]; // prettier-ignore

describe('robustness', () => {
  it('never throws on random DDL-like token soup', async () => {
    const next = rng(20261128);
    for (let i = 0; i < 300; i++) {
      const len = 5 + Math.floor(next() * 80);
      let src = '';
      for (let k = 0; k < len; k++) src += PIECES[Math.floor(next() * PIECES.length)] + (next() < 0.8 ? ' ' : '');
      const files = [{ path: `fuzz${i}.sql`, content: src }];
      expect(() => parseSql(files)).not.toThrow();
      for (const kind of KINDS) {
        const m = await run(files, kind, { showDependencies: true });
        expect({ src, problems: wellFormed(m, files) }).toEqual({ src, problems: [] });
      }
    }
  });

  it('never throws on any truncation of the public fixtures', async () => {
    for (const f of allFiles) {
      for (let cut = 0; cut < f.content.length; cut += 5) {
        const files = [{ path: f.path, content: f.content.slice(0, cut) }];
        expect(() => parseSql(files), `${f.path} cut at ${cut}`).not.toThrow();
        const m = await run(files, 'sql.chen');
        expect({ at: `${f.path}:${cut}`, problems: wellFormed(m, files) }).toEqual({
          at: `${f.path}:${cut}`,
          problems: [],
        });
      }
    }
  });

  it('survives deep nesting and very long lines', async () => {
    const deep = `CREATE TABLE d (id INT PRIMARY KEY CHECK (${'('.repeat(5000)}id > 0${')'.repeat(5000)}), v INT);`;
    expect(attrs(await analyze(deep), 'd')).toEqual(['id', 'v']);
    const wide = `CREATE TABLE w (${Array.from({ length: 3000 }, (_, i) => `c${i} INT`).join(', ')});`;
    expect(node(await analyze(wide), 'w').attributes).toHaveLength(3000);
    const open = `CREATE TABLE o (id INT CHECK ${'('.repeat(20000)}`;
    expect(node(await analyze(open), 'o').attributes?.map((a) => a.name)).toEqual(['id']);
  });
});

// ---------------------------------------------------------------- a big generated project

/**
 * 300 files, each with a table that points at an earlier one, a composite-key
 * link table every third file, a view every fifth, T-SQL noise and GO batches.
 * Built in memory, never written to disk.
 */
function bigProject(n = 300): SourceFile[] {
  const files: SourceFile[] = [];
  for (let i = 0; i < n; i++) {
    const parent = i > 0 ? `t${Math.floor((i * 7) % i)}` : undefined;
    const lines = [
      'SET NOCOUNT ON',
      'GO',
      `IF OBJECT_ID('dbo.t${i}', 'U') IS NOT NULL DROP TABLE dbo.t${i}`,
      'GO',
      `CREATE TABLE dbo.t${i} (`,
      `  id INT IDENTITY(1,1) NOT NULL,`,
      `  nome NVARCHAR(100) NOT NULL /* comment */,`,
      `  valor DECIMAL(10, 2) CHECK ((valor >= 0) AND (valor < 1000000)),`,
      parent ? `  pai INT NULL REFERENCES dbo.${parent} (id),` : `  pai INT NULL,`,
      `  CONSTRAINT pk_t${i} PRIMARY KEY CLUSTERED (id)`,
      ')',
      'GO',
    ];
    if (i % 3 === 2)
      lines.push(
        `CREATE TABLE dbo.l${i} (a INT NOT NULL, b INT NOT NULL, qtd INT, CONSTRAINT pk_l${i} PRIMARY KEY (a, b))`,
        'GO',
        `ALTER TABLE dbo.l${i} WITH CHECK ADD CONSTRAINT fk_l${i}_a FOREIGN KEY (a) REFERENCES dbo.t${i} (id),`,
        `  CONSTRAINT fk_l${i}_b FOREIGN KEY (b) REFERENCES dbo.t${i - 1} (id)`,
        'GO',
      );
    if (i % 5 === 4)
      lines.push(
        `CREATE VIEW dbo.v${i} AS SELECT x.id, y.nome FROM dbo.t${i} x JOIN dbo.t${i - 1} y ON y.id = x.pai`,
        'GO',
        `CREATE PROCEDURE dbo.p${i} @id INT AS BEGIN SELECT * FROM dbo.t${i} WHERE id = @id; END`,
        'GO',
      );
    for (let k = 0; k < 20; k++) lines.push(`INSERT INTO dbo.t${i} (nome, valor) VALUES (N'linha ${k}', ${k}.5)`);
    files.push({ path: `gerado/${String(i).padStart(3, '0')}.sql`, content: lines.join('\r\n') });
  }
  return files;
}

describe('a generated project with 300 files', () => {
  const files = bigProject();
  const links = Math.floor((300 + 0) / 3);
  const views = Math.floor(300 / 5);

  it('is analysed quickly and completely, for every diagram', async () => {
    const times: Record<string, number> = {};
    const models: Partial<Record<DiagramKind, DiagramModel>> = {};
    for (const kind of KINDS) {
      const t0 = performance.now();
      const m = await run(files, kind, { showDependencies: true });
      times[kind] = Math.round(performance.now() - t0);
      models[kind] = m;
      expect(wellFormed(m, files)).toEqual([]);
      expect(m.diagnostics.filter((d) => d.level !== 'info')).toEqual([]);
    }
    const rel = models['sql.relational']!;
    expect(rel.nodes.filter((n) => n.kind === 'table')).toHaveLength(300 + links);
    expect(rel.nodes.filter((n) => n.kind === 'view')).toHaveLength(views);
    expect(rel.edges.filter((e) => e.kind === 'foreign-key')).toHaveLength(299 + 2 * links);
    expect(rel.edges.filter((e) => e.kind === 'dependency')).toHaveLength(2 * views);
    expect(models['sql.chen']!.nodes.filter((n) => n.kind === 'relationship')).toHaveLength(299 + links);
    console.info(`300 SQL files: ${JSON.stringify(times)} ms`);
    // Generous for slow CI machines; locally it is a few hundred milliseconds in all.
    expect(Object.values(times).reduce((a, b) => a + b, 0)).toBeLessThan(8000);
  });

  it('gives the same ids whatever the order the files arrive in', async () => {
    const shuffled = [...files];
    const next = rng(7);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    for (const kind of KINDS) {
      const a = await run(files, kind);
      const b = await run(shuffled, kind);
      expect(b.nodes.map((n) => n.id)).toEqual(a.nodes.map((n) => n.id));
      expect(b.edges.map((e) => e.id)).toEqual(a.edges.map((e) => e.id));
    }
  });
});
