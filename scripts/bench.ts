// npm run bench [-- --lang java] [--verbose] [--no-write]
//
// Runs every fixture, prints a table per case and per language, and writes
// public/bench.json with aggregate numbers only (no case names, no code), so
// the private fixtures' results can be published without exposing them.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import '../src/analyzers/shared/tree-sitter-node';
import { type Accuracy, type Score, sumAccuracies, sumScores } from '../src/bench/compare';
import { type ExpectedResult, loadFixtures, projectRoot, runFixture } from '../src/bench/fixtures';
import { LANGS } from '../src/model/kinds';
import type { Lang } from '../src/model/types';

const { values } = parseArgs({
  options: {
    lang: { type: 'string' },
    verbose: { type: 'boolean', default: false },
    'no-write': { type: 'boolean', default: false },
  },
});

const lang = values.lang as Lang | undefined;
if (lang && !LANGS.includes(lang)) {
  console.error(`unknown --lang ${lang}; use one of ${LANGS.join(', ')}`);
  process.exit(2);
}

const pct = (x: number | undefined) => (x === undefined ? '   -  ' : `${(x * 100).toFixed(1).padStart(5)}%`);
const f1 = (s: Score | undefined) => pct(s?.f1);
const acc = (a: Accuracy | undefined) => pct(a?.accuracy);

interface Aggregate {
  cases: number;
  publicCases: number;
  privateCases: number;
  nodes?: Score;
  edgesStrict?: Score;
  edgesRelaxed?: Score;
  members?: Score;
  calls?: Score;
  roles?: Accuracy;
  multiplicities?: Accuracy;
  columns?: Accuracy;
  counts?: Accuracy;
}

function aggregate(results: ExpectedResult[]): Aggregate {
  const s = results.map((r) => r.score);
  return {
    cases: results.length,
    publicCases: results.filter((r) => !r.fixture.private).length,
    privateCases: results.filter((r) => r.fixture.private).length,
    nodes: sumScores(s.map((x) => x.nodes)),
    edgesStrict: sumScores(s.map((x) => x.edgesStrict)),
    edgesRelaxed: sumScores(s.map((x) => x.edgesRelaxed)),
    members: sumScores(s.map((x) => x.members)),
    calls: sumScores(s.map((x) => x.calls)),
    roles: sumAccuracies(s.map((x) => x.roles)),
    multiplicities: sumAccuracies(s.map((x) => x.multiplicities)),
    columns: sumAccuracies(s.map((x) => x.columns)),
    counts: sumAccuracies(s.map((x) => x.counts)),
  };
}

const header = 'case'.padEnd(34) + 'kind'.padEnd(17) + ' nodes  strict relaxed members  roles   mult   counts  calls';
const row = (label: string, kind: string, a: Omit<Aggregate, 'cases' | 'publicCases' | 'privateCases'>) =>
  label.padEnd(34) +
  kind.padEnd(17) +
  [
    f1(a.nodes),
    f1(a.edgesStrict),
    f1(a.edgesRelaxed),
    f1(a.members),
    acc(a.roles),
    acc(a.multiplicities),
    acc(a.counts),
    f1(a.calls),
  ].join(' ');

const fixtures = await loadFixtures({ lang });
const results: ExpectedResult[] = [];
for (const fx of fixtures) {
  for (const p of fx.problems) console.warn(`! ${fx.lang}/${fx.name}: ${p}`);
  results.push(...(await runFixture(fx)));
}

if (!results.length) {
  console.log('No fixtures with expected.yaml found.');
} else {
  console.log('\nF1 for nodes, edges, members and calls; accuracy for roles, multiplicities and counts.\n');
  console.log(header);
  for (const r of results) {
    const label = `${r.fixture.private ? '(p) ' : ''}${r.fixture.lang}/${r.fixture.name}`;
    console.log(row(label, r.expected.data.kind, r.score));
    if (values.verbose) for (const m of r.score.misses.slice(0, 15)) console.log(`      · ${m}`);
  }
  console.log('\nBy language');
  console.log(header);
  for (const l of LANGS) {
    const mine = results.filter((r) => r.fixture.lang === l);
    if (mine.length) console.log(row(`${l} (${mine.length})`, '', aggregate(mine)));
  }
}

if (!values['no-write']) {
  const out = join(projectRoot(), 'public', 'bench.json');
  type BenchFile = { generatedAt: string; languages: Partial<Record<Lang, Aggregate>> };
  const previous: BenchFile = existsSync(out)
    ? (JSON.parse(await readFile(out, 'utf8')) as BenchFile)
    : { generatedAt: '', languages: {} };
  for (const l of LANGS) {
    if (lang && lang !== l) continue;
    const mine = results.filter((r) => r.fixture.lang === l);
    if (mine.length) previous.languages[l] = aggregate(mine);
    else delete previous.languages[l];
  }
  previous.generatedAt = new Date().toISOString();
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(previous, null, 2) + '\n');
  console.log(`\nWrote ${out} (aggregate numbers only).`);
}
