// Node-only: finds and loads fixtures from fixtures/ (public) and
// fixtures-private/ (local, never published; absent in CI).
//
// Layout: <root>/<lang>/<case>/input/**  plus expected.yaml or expected.<name>.yaml
// (one file per diagram kind) and optional reference.* images.
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { analyzerForKind } from '../analyzers';
import { LANGS } from '../model/kinds';
import type { DiagramModel, Lang, SourceFile } from '../model/types';
import { type CaseScore, compareModel } from './compare';
import { type Expected, parseExpected } from './expected';

export const PUBLIC_ROOT = 'fixtures';
export const PRIVATE_ROOT = 'fixtures-private';

/** Folders and files that never count as input, as in the app (PROMPT.md §4.1). */
const IGNORED_DIRS = new Set(['node_modules', '.git', 'build', 'dist', 'target', 'out', '.idea', '.vscode']);
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface ExpectedFile {
  /** e.g. `expected.yaml` or `expected.chen.yaml` */
  file: string;
  data: Expected;
}

export interface FixtureCase {
  lang: Lang;
  name: string;
  dir: string;
  private: boolean;
  files: SourceFile[];
  expected: ExpectedFile[];
  references: string[];
  /** Problems found while loading (invalid YAML, unreadable files). */
  problems: string[];
}

export function projectRoot(): string {
  return process.cwd();
}

export function hasPrivateFixtures(lang?: Lang, root = projectRoot()): boolean {
  return existsSync(lang ? join(root, PRIVATE_ROOT, lang) : join(root, PRIVATE_ROOT));
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

async function readInputs(inputDir: string, problems: string[]): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  const walk = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) await walk(full);
        continue;
      }
      if (!e.isFile()) continue;
      const size = (await stat(full)).size;
      if (size > MAX_FILE_BYTES) {
        problems.push(`skipped ${e.name}: larger than 5 MB`);
        continue;
      }
      const buf = await readFile(full);
      if (looksBinary(buf)) continue;
      out.push({ path: relative(inputDir, full).split(sep).join('/'), content: buf.toString('utf8') });
    }
  };
  if (existsSync(inputDir)) await walk(inputDir);
  else problems.push('no input/ folder');
  return out;
}

export async function loadFixture(dir: string, lang: Lang, isPrivate: boolean): Promise<FixtureCase> {
  const problems: string[] = [];
  const entries = (await readdir(dir)).sort();
  const expected: ExpectedFile[] = [];
  for (const file of entries.filter((f) => /^expected(\.[\w-]+)?\.ya?ml$/.test(f))) {
    const v = parseExpected(await readFile(join(dir, file), 'utf8'));
    if (v.ok) expected.push({ file, data: v.value });
    else problems.push(...v.errors.map((e) => `${file}: ${e}`));
  }
  return {
    lang,
    name: dir.slice(dir.lastIndexOf(sep) + 1),
    dir,
    private: isPrivate,
    files: await readInputs(join(dir, 'input'), problems),
    expected,
    references: entries.filter((f) => f.startsWith('reference')),
    problems,
  };
}

export interface LoadOptions {
  lang?: Lang;
  includePublic?: boolean;
  includePrivate?: boolean;
  root?: string;
}

/** All fixture cases, public first, sorted by name. Folders starting with `_` are skipped. */
export async function loadFixtures(opts: LoadOptions = {}): Promise<FixtureCase[]> {
  const root = resolve(opts.root ?? projectRoot());
  const roots: [string, boolean][] = [];
  if (opts.includePublic !== false) roots.push([PUBLIC_ROOT, false]);
  if (opts.includePrivate !== false) roots.push([PRIVATE_ROOT, true]);
  const out: FixtureCase[] = [];
  for (const [base, isPrivate] of roots) {
    for (const lang of LANGS) {
      if (opts.lang && opts.lang !== lang) continue;
      const langDir = join(root, base, lang);
      if (!existsSync(langDir)) continue;
      const cases = (await readdir(langDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
        .map((d) => d.name)
        .sort();
      for (const name of cases) out.push(await loadFixture(join(langDir, name), lang, isPrivate));
    }
  }
  return out;
}

export interface ExpectedResult {
  fixture: FixtureCase;
  expected: ExpectedFile;
  model: DiagramModel;
  score: CaseScore;
}

/** Runs the analyzer for every expected file of a case and scores the result. */
export async function runFixture(fixture: FixtureCase): Promise<ExpectedResult[]> {
  const out: ExpectedResult[] = [];
  for (const expected of fixture.expected) {
    const analyzer = analyzerForKind(expected.data.kind);
    const model = await analyzer.analyze(fixture.files, expected.data.kind, expected.data.options);
    out.push({ fixture, expected, model, score: compareModel(model, expected.data) });
  }
  return out;
}
