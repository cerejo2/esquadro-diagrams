// Java analyzer (PROMPT.md §7.1): class, package and type-dependency diagrams.
import type { Tree } from 'web-tree-sitter';
import type { AnalyzeOptions, Analyzer } from '../types';
import type { Diagnostic, DiagramKind, DiagramModel, SourceFile } from '../../model/types';
import { extensionOf } from '../shared/detect';
import { diagnostic, syntaxDiagnostics } from '../shared/evidence';
import { byPath } from '../shared/ids';
import { emptyModel, safeAnalyze } from '../shared/model';
import { getParser } from '../shared/tree-sitter';
import { classDiagram, dependencyDiagram, packageDiagram } from './build';
import { collectTypes } from './collect';
import type { JavaOptions } from './members';
import { Resolver } from './resolve';

const kinds: DiagramKind[] = ['java.class', 'java.package', 'java.dependency'];

/** 1 for `.java`; a guess from the text otherwise (pasted code has no name). */
export function detectJava(file: SourceFile): number {
  const ext = extensionOf(file.path);
  if (ext === 'java') return 1;
  if (ext) return 0;
  const text = file.content;
  const decl = /\b(public|private|protected|abstract|final)?\s*(class|interface|enum|record)\s+[A-Z]\w*/.test(text);
  if (!decl) return 0;
  const javaish =
    /^\s*(package|import)\s+[\w.]+(\.\*)?\s*;/m.test(text) || /\bpublic\s+static\s+void\s+main\s*\(/.test(text);
  return javaish ? 0.8 : 0.4;
}

async function run(files: SourceFile[], kind: DiagramKind, opts: AnalyzeOptions): Promise<DiagramModel> {
  const javaOpts: JavaOptions = opts;
  const sources = byPath(files).filter((f) => detectJava(f) >= 0.5);
  const diagnostics: Diagnostic[] = [];
  if (!sources.length) {
    return emptyModel('java', kind, [diagnostic('info', 'no Java files in the input')]);
  }

  const parser = await getParser('java');
  const trees: Tree[] = [];
  try {
    const parsed = [];
    for (const f of sources) {
      const text = f.content.charCodeAt(0) === 0xfeff ? f.content.slice(1) : f.content;
      const tree = parser.parse(text);
      if (!tree) {
        diagnostics.push(diagnostic('error', `could not parse ${f.path}`, { file: f.path, line: 1 }));
        continue;
      }
      trees.push(tree);
      diagnostics.push(...syntaxDiagnostics(tree.rootNode, f.path));
      parsed.push({ path: f.path, root: tree.rootNode });
    }

    const { types } = collectTypes(parsed);
    const seen = new Map<string, string>();
    for (const t of types) {
      const first = seen.get(t.qname);
      if (first)
        diagnostics.push(
          diagnostic('warn', `type ${t.qname} is declared twice (also in ${first}); the first one is used`, t.ref),
        );
      else seen.set(t.qname, t.file.path);
    }
    const unique = types.filter((t, i) => types.findIndex((x) => x.qname === t.qname) === i);
    if (!unique.length) diagnostics.push(diagnostic('info', 'no classes, interfaces, enums or records found'));

    const res = new Resolver(unique);
    const model =
      kind === 'java.package'
        ? packageDiagram(unique, res, javaOpts)
        : kind === 'java.dependency'
          ? dependencyDiagram(unique, res, javaOpts)
          : classDiagram(unique, res, javaOpts);
    model.diagnostics = [...diagnostics, ...res.diagnostics];
    return model;
  } finally {
    for (const t of trees) t.delete();
    parser.delete();
  }
}

export const javaAnalyzer: Analyzer = {
  lang: 'java',
  kinds,
  detect: detectJava,
  analyze: safeAnalyze('java', kinds, run),
};
