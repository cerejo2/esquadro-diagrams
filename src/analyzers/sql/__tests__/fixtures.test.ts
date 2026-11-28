// One test per SQL fixture: the public ones must match their expected*.yaml
// exactly; the private ones (local only, skipped when the folder is absent)
// may differ only where the reference follows another convention than
// PROMPT.md §7.4, and every such difference is listed in the case's known.yaml.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compareModel } from '../../../bench/compare';
import { type FixtureCase, hasPrivateFixtures, loadFixtures, runFixture } from '../../../bench/fixtures';
import { sqlAnalyzer } from '..';

const publicCases = await loadFixtures({ lang: 'sql', includePrivate: false });
const privateCases = hasPrivateFixtures('sql') ? await loadFixtures({ lang: 'sql', includePublic: false }) : [];

const perfect = { f1: 1 };

describe('public SQL fixtures', () => {
  it('there is at least one per diagram kind', () => {
    const kinds = new Set(publicCases.flatMap((c) => c.expected.map((e) => e.data.kind)));
    expect([...kinds].sort()).toEqual(['sql.chen', 'sql.crowsfoot', 'sql.relational', 'sql.ssms']);
  });

  it.each(publicCases.map((c) => [c.name, c] as const))(
    '%s matches its expected files',
    async (_name, fx: FixtureCase) => {
      expect(fx.problems).toEqual([]);
      expect(fx.expected.length).toBeGreaterThan(0);
      for (const r of await runFixture(fx)) {
        const s = r.score;
        expect({ file: r.expected.file, misses: s.misses }).toEqual({ file: r.expected.file, misses: [] });
        // A counts-only file (edge-schemas) has no node or edge lists to score.
        const listed = !!(r.expected.data.nodes || r.expected.data.edges);
        expect(listed ? s.nodes : perfect).toMatchObject(perfect);
        expect(listed ? s.edgesStrict : perfect).toMatchObject(perfect);
        expect(s.counts?.accuracy ?? 1).toBe(1);
        expect(s.members?.f1 ?? 1).toBe(1);
        expect(s.multiplicities?.accuracy ?? 1).toBe(1);
        expect(s.columns?.accuracy ?? 1).toBe(1);
        // Public cases are clean DDL: anything above info is a parser bug.
        expect(r.model.diagnostics.filter((d) => d.level !== 'info')).toEqual([]);
        // Every node and edge says why it exists, with a file and a line.
        const unsourced = [
          ...r.model.nodes.filter((n) => !(n.evidence?.[0]?.ref?.line && n.evidence[0].ref.file)).map((n) => n.id),
          ...r.model.edges.filter((e) => !(e.evidence[0]?.ref?.line && e.evidence[0].ref.file)).map((e) => e.id),
        ];
        expect(unsourced).toEqual([]);
      }
    },
  );
});

// ---------------------------------------------------------------- private fixtures

/**
 * What a reference does differently from the §7.4 rules, as the bench reports it.
 * These lists live next to each private case, in fixtures-private/sql/<case>/known.yaml,
 * because they describe course material.
 */
interface Known {
  why: string;
  misses: string[];
}
const KNOWN: Record<string, Known> = Object.fromEntries(
  privateCases
    .filter((c) => existsSync(join(c.dir, 'known.yaml')))
    .map((c) => [c.name, parse(readFileSync(join(c.dir, 'known.yaml'), 'utf8')) as Known]),
);

function unexplained(misses: string[], known: readonly string[]): string[] {
  const pool = [...known];
  return misses.filter((m) => {
    const i = pool.indexOf(m);
    if (i < 0) return true;
    pool.splice(i, 1);
    return false;
  });
}

describe.skipIf(!privateCases.length)('private SQL fixtures (local only)', () => {
  it.each(privateCases.map((c) => [c.name, c] as const))(
    '%s differs from its reference only by convention',
    async (_name, fx: FixtureCase) => {
      expect(fx.problems).toEqual([]);
      for (const e of fx.expected) {
        const model = await sqlAnalyzer.analyze(fx.files, e.data.kind, e.data.options);
        const s = compareModel(model, e.data);
        const why = KNOWN[fx.name]?.why ?? 'no known deviations';
        expect({ why, unexplained: unexplained(s.misses, KNOWN[fx.name]?.misses ?? []) }).toEqual({
          why,
          unexplained: [],
        });
        expect(model.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
      }
    },
  );

  it('every listed deviation still happens (the list is not stale)', async () => {
    for (const [name, { misses }] of Object.entries(KNOWN)) {
      const fx = privateCases.find((c) => c.name === name);
      if (!fx) continue;
      const e = fx.expected[0]!;
      const s = compareModel(await sqlAnalyzer.analyze(fx.files, e.data.kind, e.data.options), e.data);
      expect({ name, stale: misses.filter((m) => !s.misses.includes(m)) }).toEqual({ name, stale: [] });
    }
  });

  it('every private case parses without warnings', async () => {
    for (const fx of privateCases) {
      const m = await sqlAnalyzer.analyze(fx.files, 'sql.relational');
      expect({ name: fx.name, loud: m.diagnostics.filter((d) => d.level !== 'info') }).toEqual({
        name: fx.name,
        loud: [],
      });
    }
  });
});
