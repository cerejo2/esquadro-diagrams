// One test per C fixture: the public ones must match their expected.yaml
// exactly; the private ones (local only, skipped when the folder is absent)
// may differ only where the reference follows another convention than
// PROMPT.md §7.2, and every such difference is listed in the case's known.yaml.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compareModel } from '../../../bench/compare';
import { type FixtureCase, hasPrivateFixtures, loadFixtures, runFixture } from '../../../bench/fixtures';
import type { Diagnostic } from '../../../model/types';
import { cAnalyzer } from '..';

const publicCases = await loadFixtures({ lang: 'c', includePrivate: false });
const privateCases = hasPrivateFixtures('c') ? await loadFixtures({ lang: 'c', includePublic: false }) : [];

const perfect = { f1: 1 };

/** Public edge cases whose input is meant to produce warnings or errors. */
const EXPECTED_DIAGNOSTICS: Record<string, RegExp> = {
  'edge-includes': /^include cycle: /,
  'edge-syntax': /^(syntax error|missing .+) near /,
};

/** Syntax errors are reported, with a line, and the analysis carries on. */
const isSyntax = (d: Diagnostic) => /^(syntax error|missing .+) near /.test(d.message) && !!d.ref?.line;

describe('public C fixtures', () => {
  it('there is at least one per diagram kind', () => {
    const kinds = new Set(publicCases.flatMap((c) => c.expected.map((e) => e.data.kind)));
    expect([...kinds].sort()).toEqual(['c.callgraph', 'c.include', 'c.struct']);
  });

  it.each(publicCases.map((c) => [c.name, c] as const))(
    '%s matches its expected files',
    async (_name, fx: FixtureCase) => {
      expect(fx.problems).toEqual([]);
      expect(fx.expected.length).toBeGreaterThan(0);
      for (const r of await runFixture(fx)) {
        const s = r.score;
        expect({ file: r.expected.file, misses: s.misses }).toEqual({ file: r.expected.file, misses: [] });
        expect(s.nodes).toMatchObject(perfect);
        expect(s.edgesStrict).toMatchObject(perfect);
        expect(s.members?.f1 ?? 1).toBe(1);
        expect(s.roles?.accuracy ?? 1).toBe(1);
        expect(s.multiplicities?.accuracy ?? 1).toBe(1);
        // Public fixtures compile cleanly (nothing above info), except the edge cases listed
        // in EXPECTED_DIAGNOSTICS, which must report what they are about, with a line.
        const loud = r.model.diagnostics.filter((d) => d.level !== 'info');
        const allowed = EXPECTED_DIAGNOSTICS[fx.name];
        expect({ file: r.expected.file, loud: loud.length > 0 }).toEqual({ file: r.expected.file, loud: !!allowed });
        expect(loud.filter((d) => !allowed?.test(d.message) || !d.ref?.line)).toEqual([]);
        // Every node and edge says why it exists.
        expect(r.model.nodes.filter((n) => !n.evidence?.length).map((n) => n.id)).toEqual([]);
        const bare = r.model.edges.filter(
          (e) => !e.evidence.length || !e.evidence.every((ev) => ev.rule.startsWith('c.')),
        );
        expect(bare.map((e) => e.id)).toEqual([]);
      }
    },
  );

  it('edge labels match the call counts written in the expected files', async () => {
    for (const fx of publicCases) {
      for (const r of await runFixture(fx)) {
        if (r.expected.data.kind !== 'c.callgraph') continue;
        const name = (id: string) => r.model.nodes.find((n) => n.id === id)?.name;
        for (const e of r.expected.data.edges ?? []) {
          const got = r.model.edges.find((x) => name(x.from.node) === e.from && name(x.to.node) === e.to);
          expect({ fx: fx.name, edge: `${e.from}->${e.to}`, label: got?.label }).toEqual({
            fx: fx.name,
            edge: `${e.from}->${e.to}`,
            label: e.label,
          });
        }
      }
    }
  });
});

// ---------------------------------------------------------------- private fixtures

/**
 * What a reference does differently from the §7.2 rules, as the bench reports it.
 * These lists live next to each private case, in fixtures-private/c/<case>/known.yaml,
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

describe.skipIf(!privateCases.length)('private C fixtures (local only)', () => {
  it.each(privateCases.map((c) => [c.name, c] as const))(
    '%s differs from its reference only by convention',
    async (_name, fx: FixtureCase) => {
      expect(fx.problems).toEqual([]);
      for (const e of fx.expected) {
        const model = await cAnalyzer.analyze(fx.files, e.data.kind, e.data.options);
        const s = compareModel(model, e.data);
        const why = KNOWN[fx.name]?.why ?? 'no known deviations';
        expect({ file: e.file, why, unexplained: unexplained(s.misses, KNOWN[fx.name]?.misses ?? []) }).toEqual({
          file: e.file,
          why,
          unexplained: [],
        });
        // Only syntax errors in the input itself may be reported as errors.
        expect(model.diagnostics.filter((d) => d.level === 'error' && !isSyntax(d))).toEqual([]);
      }
    },
  );

  it('every listed deviation still happens (the list is not stale)', async () => {
    for (const [name, { misses }] of Object.entries(KNOWN)) {
      const fx = privateCases.find((c) => c.name === name);
      if (!fx) continue;
      const all: string[] = [];
      for (const e of fx.expected)
        all.push(...compareModel(await cAnalyzer.analyze(fx.files, e.data.kind, e.data.options), e.data).misses);
      expect({ name, stale: misses.filter((m) => !all.includes(m)) }).toEqual({ name, stale: [] });
    }
  });
});
