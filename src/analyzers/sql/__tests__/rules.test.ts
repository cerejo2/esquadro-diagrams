// The diagram rules of PROMPT.md §7.4, one small schema per rule.
import { describe, expect, it } from 'vitest';
import { analyze, attrs, edgeList, flagsOf, messages, node } from './helpers';
import { sqlAnalyzer } from '..';

const SHOP = `
CREATE TABLE cliente (id INT PRIMARY KEY, nome VARCHAR(50) NOT NULL, email VARCHAR(80) UNIQUE);
CREATE TABLE encomenda (
  num INT PRIMARY KEY,
  cliente INT NOT NULL,
  vendedor INT NULL,
  CONSTRAINT feita_por FOREIGN KEY (cliente) REFERENCES cliente(id),
  CONSTRAINT vendida_por FOREIGN KEY (vendedor) REFERENCES cliente(id)
);
CREATE TABLE fatura (num INT PRIMARY KEY, enc INT NOT NULL UNIQUE, CONSTRAINT fatura_de FOREIGN KEY (enc) REFERENCES encomenda(num));
`;

describe('detect', () => {
  it('claims .sql files', () => {
    expect(sqlAnalyzer.detect({ path: 'db/schema.sql', content: '' })).toBe(1);
    expect(sqlAnalyzer.detect({ path: 'a.SQL', content: '' })).toBe(1);
    expect(sqlAnalyzer.detect({ path: 'a.java', content: 'CREATE TABLE' })).toBe(0);
  });
});

describe('sql.relational', () => {
  it('one table node per table, columns in DDL order with key flags and no types', async () => {
    const m = await analyze(SHOP);
    expect(m.nodes.map((n) => `${n.kind}:${n.name}`)).toEqual(['table:cliente', 'table:encomenda', 'table:fatura']);
    expect(attrs(m, 'cliente')).toEqual(['id', 'nome', 'email']);
    expect(flagsOf(m, 'cliente', 'id')).toEqual(['pk', 'notnull']);
    expect(flagsOf(m, 'cliente', 'email')).toEqual(['unique']);
    expect(flagsOf(m, 'fatura', 'enc')).toEqual(['fk', 'unique', 'notnull']);
    expect(node(m, 'cliente').attributes?.every((a) => a.type === undefined)).toBe(true);
  });

  it('one foreign-key edge per FK column, from the FK cell to the PK cell', async () => {
    const m = await analyze(SHOP);
    expect(edgeList(m)).toEqual([
      'foreign-key encomenda.cliente->cliente.id',
      'foreign-key encomenda.vendedor->cliente.id',
      'foreign-key fatura.enc->encomenda.num',
    ]);
    expect(m.edges.every((e) => e.confidence === 1)).toBe(true);
  });

  it('splits a composite FK into one edge per column pair, labelled with the constraint', async () => {
    const m = await analyze(`
      CREATE TABLE voo (cod CHAR(6), dia DATE, PRIMARY KEY (cod, dia));
      CREATE TABLE lugar (cod CHAR(6), dia DATE, n INT, PRIMARY KEY (cod, dia, n),
        CONSTRAINT do_voo FOREIGN KEY (cod, dia) REFERENCES voo (cod, dia));
    `);
    expect(edgeList(m)).toEqual(['foreign-key lugar.cod->voo.cod', 'foreign-key lugar.dia->voo.dia']);
    expect(m.edges.map((e) => e.label)).toEqual(['do_voo', 'do_voo']);
    expect(new Set(m.edges.map((e) => e.id)).size).toBe(2);
  });

  it('REFERENCES without columns points at the referenced PK', async () => {
    const m = await analyze('CREATE TABLE a (k INT PRIMARY KEY); CREATE TABLE b (x INT REFERENCES a);');
    expect(edgeList(m)).toEqual(['foreign-key b.x->a.k']);
  });

  it('a self-reference is an edge from the table to itself', async () => {
    const m = await analyze('CREATE TABLE pessoa (id INT PRIMARY KEY, mae INT REFERENCES pessoa(id));');
    expect(edgeList(m)).toEqual(['foreign-key pessoa.mae->pessoa.id']);
  });

  it('names have no schema; the schema becomes the group', async () => {
    const m = await analyze('CREATE TABLE [rh].[pessoa] ([id] INT PRIMARY KEY);');
    expect(node(m, 'pessoa')).toMatchObject({ id: 'table:rh.pessoa', group: 'rh' });
  });

  it('carries evidence with the rule and file:line', async () => {
    const m = await analyze({
      'db/a.sql': 'CREATE TABLE a (k INT PRIMARY KEY);\nALTER TABLE b ADD CONSTRAINT f FOREIGN KEY (x) REFERENCES a;',
      'db/b.sql': '\nCREATE TABLE b (x INT);',
    });
    expect(node(m, 'b').evidence).toEqual([{ rule: 'sql.create-table', ref: { file: 'db/b.sql', line: 2 } }]);
    expect(m.edges[0]!.evidence).toEqual([
      { rule: 'sql.fk.alter', ref: { file: 'db/a.sql', line: 2 }, note: 'constraint f: x → a.k' },
    ]);
  });

  it('warns and draws nothing for an FK to a table that is not defined', async () => {
    const m = await analyze('CREATE TABLE b (x INT REFERENCES fora(id));');
    expect(m.edges).toEqual([]);
    expect(messages(m, 'warn')).toEqual(['foreign key b(x) references fora, which is not defined; not drawn']);
  });

  it('warns about FK columns that do not exist and column count mismatches', async () => {
    const m = await analyze(`
      CREATE TABLE a (k1 INT, k2 INT, PRIMARY KEY (k1, k2));
      CREATE TABLE b (x INT, FOREIGN KEY (x) REFERENCES a, FOREIGN KEY (nope) REFERENCES a(k1));
    `);
    expect(messages(m, 'warn')).toEqual([
      'foreign key b(x) has 1 columns but references 2',
      'foreign key column b.nope is not a column of b',
    ]);
  });

  it('views are nodes; their FROM/JOIN dependencies only appear with showDependencies', async () => {
    const sql = 'CREATE TABLE a (k INT PRIMARY KEY);\nCREATE VIEW va AS SELECT * FROM a JOIN a a2 ON a.k = a2.k;';
    const off = await analyze(sql);
    expect(off.nodes.map((n) => `${n.kind}:${n.name}`)).toEqual(['table:a', 'view:va']);
    expect(off.edges).toEqual([]);
    const on = await analyze(sql, 'sql.relational', { showDependencies: true });
    expect(edgeList(on)).toEqual(['dependency va->a']);
    expect(on.edges[0]).toMatchObject({ confidence: 0.6, evidence: [{ rule: 'sql.view.from' }] });
  });
});

describe('sql.ssms', () => {
  it('one line per FK constraint: key at the PK end, infinity at the FK end', async () => {
    const m = await analyze(SHOP, 'sql.ssms');
    expect(edgeList(m)).toEqual([
      'foreign-key encomenda->cliente *:1',
      'foreign-key encomenda->cliente *:1',
      'foreign-key fatura->encomenda 1:1',
    ]);
    expect(m.edges.map((e) => e.evidence[1]!.rule)).toEqual([
      'sql.ssms.one-to-many',
      'sql.ssms.one-to-many',
      'sql.ssms.one-to-one',
    ]);
  });

  it('an FK that is the whole PK is 1:1; one that is part of the PK is 1:N; a composite FK is one line', async () => {
    const m = await analyze(
      `
      CREATE TABLE pessoa (id INT PRIMARY KEY);
      CREATE TABLE aluno (id INT PRIMARY KEY REFERENCES pessoa(id));
      CREATE TABLE nota (aluno INT REFERENCES aluno, uc INT, PRIMARY KEY (aluno, uc));
      CREATE TABLE revisao (aluno INT, uc INT, n INT, PRIMARY KEY (aluno, uc, n), FOREIGN KEY (aluno, uc) REFERENCES nota);
    `,
      'sql.ssms',
    );
    expect(edgeList(m)).toEqual([
      'foreign-key aluno->pessoa 1:1',
      'foreign-key nota->aluno *:1',
      'foreign-key revisao->nota *:1',
    ]);
  });
});

describe('sql.crowsfoot', () => {
  it('entities with typed columns; parent 1 or 0..1 by NOT NULL, child 0..1 or 0..* by UNIQUE', async () => {
    const m = await analyze(SHOP, 'sql.crowsfoot');
    expect(m.nodes.map((n) => n.kind)).toEqual(['entity', 'entity', 'entity']);
    expect(attrs(m, 'encomenda')).toEqual(['num: INT', 'cliente: INT', 'vendedor: INT']);
    expect(flagsOf(m, 'encomenda', 'cliente')).toEqual(['fk', 'notnull']);
    expect(edgeList(m)).toEqual([
      'foreign-key encomenda->cliente 0..*:1',
      'foreign-key encomenda->cliente 0..*:0..1',
      'foreign-key fatura->encomenda 0..1:1',
    ]);
  });
});

describe('sql.chen', () => {
  it('a table with a PK and no FKs is an entity; attributes are the non-FK columns, PK flagged', async () => {
    const m = await analyze(SHOP, 'sql.chen');
    expect(node(m, 'encomenda').kind).toBe('entity');
    expect(attrs(m, 'encomenda')).toEqual(['num']);
    expect(node(m, 'encomenda').attributes![0]!.flags).toEqual(['pk']);
  });

  it('an FK outside the PK is a 1:N relationship named after the constraint; NOT NULL makes it total', async () => {
    const m = await analyze(SHOP, 'sql.chen');
    expect(m.nodes.filter((n) => n.kind === 'relationship').map((n) => n.name)).toEqual([
      'feita_por',
      'vendida_por',
      'fatura_de',
    ]);
    expect(edgeList(m)).toEqual([
      'participation encomenda->feita_por :N total',
      'participation cliente->feita_por :1',
      'participation encomenda->vendida_por :N',
      'participation cliente->vendida_por :1',
      'participation fatura->fatura_de :1 total',
      'participation encomenda->fatura_de :1',
    ]);
  });

  it('an unnamed FK gives a diamond with an empty name, for the user to fill in', async () => {
    const m = await analyze(
      'CREATE TABLE a (k INT PRIMARY KEY); CREATE TABLE b (k INT PRIMARY KEY, a INT REFERENCES a);',
      'sql.chen',
    );
    const rel = m.nodes.find((n) => n.kind === 'relationship')!;
    expect(rel.name).toBe('');
    expect(rel.id).toBe('relationship:b.a');
  });

  it('a PK made only of FKs to two tables is an M:N diamond named after the table, with the rest as attributes', async () => {
    const m = await analyze(
      `
      CREATE TABLE ator (id INT PRIMARY KEY);
      CREATE TABLE filme (id INT PRIMARY KEY, titulo TEXT);
      CREATE TABLE ENTRA (filme INT REFERENCES filme, ator INT REFERENCES ator, papel TEXT, PRIMARY KEY (ator, filme));
    `,
      'sql.chen',
    );
    expect(node(m, 'entra').kind).toBe('relationship');
    expect(attrs(m, 'entra')).toEqual(['papel']);
    // M for the FK of the first PK column (ator), N for the other.
    expect(edgeList(m)).toEqual(['participation ator->entra :M', 'participation filme->entra :N']);
    expect(m.edges.every((e) => e.confidence < 1)).toBe(true);
  });

  it('a recursive M:N (two FKs to the same table) has two lines to that entity', async () => {
    const m = await analyze(
      'CREATE TABLE p (id INT PRIMARY KEY); CREATE TABLE amigo (a INT REFERENCES p, b INT REFERENCES p, PRIMARY KEY (a, b));',
      'sql.chen',
    );
    expect(edgeList(m)).toEqual(['participation p->amigo :M', 'participation p->amigo :N']);
    expect(new Set(m.edges.map((e) => e.id)).size).toBe(2);
  });

  it('a PK made of an FK plus own columns is a weak entity with an identifying relationship', async () => {
    const m = await analyze(
      `
      CREATE TABLE edificio (cod CHAR(2) PRIMARY KEY, nome TEXT);
      CREATE TABLE sala (edificio CHAR(2), numero INT, lugares INT,
        PRIMARY KEY (edificio, numero), CONSTRAINT fica_em FOREIGN KEY (edificio) REFERENCES edificio);
    `,
      'sql.chen',
    );
    expect(node(m, 'sala').kind).toBe('weak-entity');
    expect(attrs(m, 'sala')).toEqual(['numero', 'lugares']);
    expect(node(m, 'sala').attributes![0]!.flags).toEqual(['partial-key']);
    expect(node(m, 'fica_em').kind).toBe('identifying-relationship');
    expect(edgeList(m)).toEqual(['participation sala->fica_em :N total', 'participation edificio->fica_em :1']);
  });

  it('a PK that is also the FK to another PK, with no more columns, is a specialisation (isa)', async () => {
    const m = await analyze(
      `
      CREATE TABLE veiculo (matricula CHAR(8) PRIMARY KEY, marca TEXT);
      CREATE TABLE mota (matricula CHAR(8) PRIMARY KEY REFERENCES veiculo, cilindrada INT);
      CREATE TABLE carro (matricula CHAR(8) PRIMARY KEY, portas INT, FOREIGN KEY (matricula) REFERENCES veiculo(matricula));
    `,
      'sql.chen',
    );
    expect(node(m, 'mota').kind).toBe('entity');
    expect(attrs(m, 'mota')).toEqual(['cilindrada']);
    expect(edgeList(m)).toEqual(['isa mota->veiculo', 'isa carro->veiculo']);
    expect(m.edges[0]).toMatchObject({ confidence: 0.7, evidence: [{ rule: 'chen.isa' }] });
  });

  it('a UNIQUE FK outside the PK is 1:1', async () => {
    const m = await analyze(
      'CREATE TABLE p (id INT PRIMARY KEY); CREATE TABLE cc (num INT PRIMARY KEY, dono INT NULL, CONSTRAINT de UNIQUE (dono), CONSTRAINT pertence FOREIGN KEY (dono) REFERENCES p);',
      'sql.chen',
    );
    expect(edgeList(m)).toEqual(['participation cc->pertence :1', 'participation p->pertence :1']);
  });

  it('a table without a PK is an entity, with an info', async () => {
    const m = await analyze('CREATE TABLE registo (quando DATE, texto TEXT);', 'sql.chen');
    expect(node(m, 'registo').kind).toBe('entity');
    expect(messages(m, 'info')).toEqual(['table registo has no primary key; drawn as an entity']);
  });

  it('views are left out of the ER diagram', async () => {
    const m = await analyze('CREATE TABLE a (k INT PRIMARY KEY); CREATE VIEW v AS SELECT * FROM a;', 'sql.chen');
    expect(m.nodes.map((n) => n.name)).toEqual(['a']);
  });
});

describe('contract', () => {
  it('never throws: garbage, empty input and binary-looking text become diagnostics', async () => {
    for (const content of [
      '',
      ')))(((',
      "CREATE TABLE ( ' unterminated",
      'CREATE TABLE t (a int REFERENCES',
      '\u0000\u0001',
    ]) {
      for (const kind of sqlAnalyzer.kinds) {
        const m = await sqlAnalyzer.analyze([{ path: 'x.sql', content }], kind);
        expect(m.kind).toBe(kind);
        expect(Array.isArray(m.diagnostics)).toBe(true);
      }
    }
  });

  it('warns when there is no CREATE TABLE at all', async () => {
    const m = await analyze('SELECT 1;');
    expect(messages(m, 'warn')).toEqual(['no CREATE TABLE found']);
  });

  it('rejects kinds of other languages with an error diagnostic', async () => {
    const m = await sqlAnalyzer.analyze([], 'java.class');
    expect(messages(m, 'error')).toEqual(['sql analyzer does not produce java.class']);
  });

  it('is deterministic: same ids whatever the file order', async () => {
    const files = [
      { path: 'b.sql', content: 'CREATE TABLE b (id INT PRIMARY KEY, a INT REFERENCES a);' },
      { path: 'a.sql', content: 'CREATE TABLE a (id INT PRIMARY KEY);' },
    ];
    for (const kind of sqlAnalyzer.kinds) {
      const one = await sqlAnalyzer.analyze(files, kind);
      const two = await sqlAnalyzer.analyze([...files].reverse(), kind);
      expect(two).toEqual(one);
      expect(new Set(one.nodes.map((n) => n.id)).size).toBe(one.nodes.length);
      expect(new Set(one.edges.map((e) => e.id)).size).toBe(one.edges.length);
    }
  });

  it('only reads .sql files when the input mixes languages', async () => {
    const m = await sqlAnalyzer.analyze(
      [
        { path: 'Main.java', content: 'class Main { String s = "CREATE TABLE x (a int)"; }' },
        { path: 'db.sql', content: 'CREATE TABLE y (a int);' },
      ],
      'sql.relational',
    );
    expect(m.nodes.map((n) => n.name)).toEqual(['y']);
  });
});
