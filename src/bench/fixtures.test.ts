import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFixtures, runFixture } from './fixtures';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'esquadro-fx-'));
  const pub = join(root, 'fixtures', 'sql', 'tiny');
  await mkdir(join(pub, 'input', 'nested', 'node_modules'), { recursive: true });
  await writeFile(join(pub, 'input', 'schema.sql'), 'CREATE TABLE T (id INT PRIMARY KEY);\n');
  await writeFile(join(pub, 'input', 'nested', 'more.sql'), '-- more\n');
  await writeFile(join(pub, 'input', 'nested', 'node_modules', 'skip.sql'), '-- ignored\n');
  await writeFile(join(pub, 'input', 'blob.bin'), Buffer.from([0, 1, 2, 0]));
  await writeFile(
    join(pub, 'expected.yaml'),
    'kind: sql.relational\nsource: original\nnodes: [{ name: T, kind: table }]\n',
  );
  await writeFile(
    join(pub, 'expected.chen.yaml'),
    'kind: sql.chen\nsource: original\ncounts: { nodes: { entity: 1 } }\n',
  );
  await writeFile(join(pub, 'reference.png'), '');
  const priv = join(root, 'fixtures-private', 'sql', 'broken');
  await mkdir(join(priv, 'input'), { recursive: true });
  await writeFile(join(priv, 'input', 'a.sql'), '');
  await writeFile(join(priv, 'expected.yaml'), 'kind: nope\n');
  await mkdir(join(root, 'fixtures-private', '_estilo'), { recursive: true });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('fixture loading', () => {
  it('reads inputs recursively, skipping ignored folders and binaries', async () => {
    const [tiny] = await loadFixtures({ root, includePrivate: false });
    expect(tiny?.name).toBe('tiny');
    expect(tiny?.files.map((f) => f.path)).toEqual(['nested/more.sql', 'schema.sql']);
    expect(tiny?.expected.map((e) => e.data.kind)).toEqual(['sql.chen', 'sql.relational']);
    expect(tiny?.references).toEqual(['reference.png']);
    expect(tiny?.problems).toEqual([]);
  });

  it('reports invalid expected files of private cases instead of throwing', async () => {
    const cases = await loadFixtures({ root, includePublic: false });
    expect(cases.map((c) => c.name)).toEqual(['broken']);
    expect(cases[0]?.private).toBe(true);
    expect(cases[0]?.problems.join()).toMatch(/kind must be one of/);
  });

  it('runs the analyzer for each expected file and scores it', async () => {
    const [tiny] = await loadFixtures({ root, includePrivate: false });
    const results = await runFixture(tiny!);
    expect(results).toHaveLength(2);
    // The SQL stub returns an empty model, so recall is 0 until Phase 1.
    expect(results.every((r) => r.model.lang === 'sql')).toBe(true);
    expect(results.find((r) => r.expected.data.kind === 'sql.relational')?.score.nodes?.fn).toBe(1);
  });
});
