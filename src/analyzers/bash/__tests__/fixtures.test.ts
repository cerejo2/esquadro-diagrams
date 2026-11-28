// One test per Bash fixture: the public ones must match their expected files
// exactly; the private ones (local only, skipped when the folder is absent)
// may differ only where the reference follows another convention than
// PROMPT.md §7.3, and every such difference is listed in the case's known.yaml.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { type FixtureCase, hasPrivateFixtures, loadFixtures, runFixture } from '../../../bench/fixtures';

const publicCases = await loadFixtures({ lang: 'bash', includePrivate: false });
const privateCases = hasPrivateFixtures('bash') ? await loadFixtures({ lang: 'bash', includePublic: false }) : [];

describe('public Bash fixtures', () => {
  it('there is at least one per diagram kind', () => {
    const kinds = new Set(publicCases.flatMap((c) => c.expected.map((e) => e.data.kind)));
    expect([...kinds].sort()).toEqual(['bash.callgraph', 'bash.dependency', 'bash.flowchart']);
  });

  it.each(publicCases.map((c) => [c.name, c] as const))(
    '%s matches its expected files',
    async (_name, fx: FixtureCase) => {
      expect(fx.problems).toEqual([]);
      expect(fx.expected.length).toBeGreaterThan(0);
      for (const r of await runFixture(fx)) {
        const s = r.score;
        expect({ file: r.expected.file, misses: s.misses }).toEqual({ file: r.expected.file, misses: [] });
        const f1 = {
          nodes: s.nodes?.f1 ?? 1,
          edges: s.edgesStrict?.f1 ?? 1,
          counts: s.counts?.accuracy ?? 1,
          calls: s.calls?.f1 ?? 1,
        };
        expect(f1).toEqual({ nodes: 1, edges: 1, counts: 1, calls: 1 });
        // edge-source-var exists to produce the §7.3 "path with a variable" warnings.
        const allowed = fx.name.endsWith('edge-source-var') ? ['info', 'warn'] : ['info'];
        expect(r.model.diagnostics.filter((d) => !allowed.includes(d.level))).toEqual([]);
        // Every node and edge says why it exists, and every edge points at a line.
        expect(r.model.nodes.filter((n) => !n.evidence?.length).map((n) => n.id)).toEqual([]);
        expect(r.model.edges.filter((e) => !e.evidence[0]?.ref?.line).map((e) => e.id)).toEqual([]);
      }
    },
  );
});

// ---------------------------------------------------------------- private fixtures

/**
 * What each reference does differently from the §7.3 rules, per expected file, as
 * the bench reports it. The lists live next to each private case, in
 * fixtures-private/bash/<case>/known.yaml, because they describe course material.
 */
interface Known {
  why: string;
  misses: Record<string, string[]>;
}
const KNOWN: Record<string, Known> = Object.fromEntries(
  privateCases
    .filter((c) => existsSync(join(c.dir, 'known.yaml')))
    .map((c) => [c.name, parse(readFileSync(join(c.dir, 'known.yaml'), 'utf8')) as Known]),
);

function unexplained(misses: readonly string[], known: readonly string[]): string[] {
  const pool = [...known];
  return misses.filter((m) => {
    const i = pool.indexOf(m);
    if (i < 0) return true;
    pool.splice(i, 1);
    return false;
  });
}

describe.skipIf(!privateCases.length)('private Bash fixtures (local only)', () => {
  it.each(privateCases.map((c) => [c.name, c] as const))(
    '%s differs from its reference only by convention',
    async (_name, fx: FixtureCase) => {
      expect(fx.problems).toEqual([]);
      const known = KNOWN[fx.name];
      const why = known?.why ?? 'no known deviations';
      for (const r of await runFixture(fx)) {
        const listed = known?.misses[r.expected.file] ?? [];
        expect({ file: r.expected.file, why, unexplained: unexplained(r.score.misses, listed) }).toEqual({
          file: r.expected.file,
          why,
          unexplained: [],
        });
        // The list is not stale: every listed deviation still happens.
        expect({ file: r.expected.file, stale: listed.filter((m) => !r.score.misses.includes(m)) }).toEqual({
          file: r.expected.file,
          stale: [],
        });
        expect(r.model.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
      }
    },
  );
});
