// npm run fixtures:check — validates every expected.yaml (public and private).
import { loadFixtures } from '../src/bench/fixtures';

const fixtures = await loadFixtures();
let bad = 0;
for (const fx of fixtures) {
  const where = `${fx.private ? 'fixtures-private' : 'fixtures'}/${fx.lang}/${fx.name}`;
  if (!fx.expected.length && !fx.problems.length) fx.problems.push('no expected*.yaml');
  if (!fx.files.length) fx.problems.push('input/ is empty');
  if (fx.problems.length) {
    bad++;
    for (const p of fx.problems) console.log(`✗ ${where}: ${p}`);
  } else {
    console.log(`✓ ${where} (${fx.expected.map((e) => e.data.kind).join(', ')}; ${fx.files.length} input files)`);
  }
}
console.log(`\n${fixtures.length} cases, ${bad} with problems.`);
process.exit(bad ? 1 : 0);
