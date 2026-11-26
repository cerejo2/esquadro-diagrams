// One test per Java fixture: the public ones must match their expected.yaml
// exactly; the private ones (local only, skipped when the folder is absent)
// may differ only where the reference drawing follows another convention than
// PROMPT.md §7.1, and every such difference is listed in the case's known.yaml.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compareModel } from '../../../bench/compare';
import { type FixtureCase, hasPrivateFixtures, loadFixtures, runFixture } from '../../../bench/fixtures';
import { javaAnalyzer } from '..';

const publicCases = await loadFixtures({ lang: 'java', includePrivate: false });
const privateCases = hasPrivateFixtures('java') ? await loadFixtures({ lang: 'java', includePublic: false }) : [];

const perfect = { f1: 1 };

/**
 * Public edge cases whose input is meant to produce warnings or errors. Each listed
 * case must produce at least one matching diagnostic and nothing else above info.
 */
const EXPECTED_DIAGNOSTICS: Record<string, RegExp> = {
  'edge-imports': /^ambiguous type Item \(loja\.a\.Item, loja\.b\.Item\); not linked$/,
  'edge-syntax': /^missing [)}] near ""$/,
};

describe('public Java fixtures', () => {
  it('there is at least one', () => expect(publicCases.length).toBeGreaterThan(0));

  it.each(publicCases.map((c) => [c.name, c] as const))('%s matches expected.yaml', async (_name, fx: FixtureCase) => {
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
      const loud = r.model.diagnostics.filter((d) => d.level !== 'info');
      const allowed = EXPECTED_DIAGNOSTICS[fx.name];
      // A listed case must warn, and only as listed; every other case must stay silent.
      expect(loud.length > 0).toBe(!!allowed);
      expect(loud.filter((d) => !allowed?.test(d.message) || !d.ref?.line)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------- private fixtures

/** Differences every PDS reference shares with §7.1, accepted in all private cases. */
const CONVENTIONS: [RegExp, string][] = [
  [/^extra edge dependency:/, 'the references draw only some of the dependencies the code has'],
];

/**
 * Member strings that differ only by notation: initial values the analyzer does not
 * print (`= 0` on an instance field), `{final}` where we write `{readOnly}`, and raw
 * generic types (`List`).
 */
const strip = (s: string) =>
  s
    .replace(/\s*=\s*[^:,()]+$/, '')
    .replace(/\s*\{\w+\}\s*$/, '')
    .replace(/<[^()]*?>/g, '')
    .replace(/<[^()]*?>/g, '');

function unexplained(misses: string[], known: readonly string[]): string[] {
  let rest = misses.filter((m) => !CONVENTIONS.some(([re]) => re.test(m)));
  // Pair "missing member X" with "extra member Y" of the same node when they differ only by notation.
  const memberRe = /^(.+): (missing|extra) member "(.*)"$/;
  const missing = rest.filter((m) => memberRe.exec(m)?.[2] === 'missing');
  const used = new Set<string>();
  for (const m of missing) {
    const [, owner, , text] = memberRe.exec(m)!;
    const partner = rest.find((x) => {
      const p = memberRe.exec(x);
      return p && !used.has(x) && p[1] === owner && p[2] === 'extra' && strip(p[3]!) === strip(text!);
    });
    if (partner) used.add(m).add(partner);
  }
  rest = rest.filter((m) => !used.has(m));
  const pool = [...known];
  return rest.filter((m) => {
    const i = pool.indexOf(m);
    if (i < 0) return true;
    pool.splice(i, 1);
    return false;
  });
}

/**
 * What each reference does differently from the §7.1 rules, as the bench reports it.
 * These are not analyzer bugs. The lists live next to each private case, in
 * fixtures-private/java/<case>/known.yaml, because they describe course material.
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

/** The references show what the default filters hide, so the private cases run with every filter on. */
const ALL_ON = { showAccessors: true, showDependencies: true, showObjectMethods: true };

describe.skipIf(!privateCases.length)('private Java fixtures (local only)', () => {
  it.each(privateCases.map((c) => [c.name, c] as const))(
    '%s differs from its reference only by convention',
    async (_name, fx: FixtureCase) => {
      expect(fx.problems).toEqual([]);
      for (const e of fx.expected) {
        const model = await javaAnalyzer.analyze(fx.files, e.data.kind, { ...ALL_ON, ...e.data.options });
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
      const s = compareModel(await javaAnalyzer.analyze(fx.files, e.data.kind, ALL_ON), e.data);
      expect({ name, stale: misses.filter((m) => !s.misses.includes(m)) }).toEqual({ name, stale: [] });
    }
  });
});
