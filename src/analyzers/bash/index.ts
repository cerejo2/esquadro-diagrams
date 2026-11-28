// Bash analyzer (PROMPT.md §7.3): call graph, flowchart and dependency diagrams.
import type { Tree } from 'web-tree-sitter';
import type { AnalyzeOptions, Analyzer } from '../types';
import type { Diagnostic, DiagramKind, DiagramModel, SourceFile } from '../../model/types';
import { extensionOf, shebangOf } from '../shared/detect';
import { diagnostic, syntaxDiagnostics } from '../shared/evidence';
import { byPath } from '../shared/ids';
import { emptyModel, safeAnalyze } from '../shared/model';
import { getParser } from '../shared/tree-sitter';
import { callGraph } from './callgraph';
import { dependencyDiagram } from './dependency';
import { flowchart } from './flowchart';
import { type BashFile, Project, makeFile } from './project';

const kinds: DiagramKind[] = ['bash.callgraph', 'bash.flowchart', 'bash.dependency'];
const shells = new Set(['bash', 'sh', 'zsh']);

/** 1 for `.sh`/`.bash` or a bash/sh/zsh shebang (the file may have no extension), 0 otherwise. */
export function detectBash(file: SourceFile): number {
  const ext = extensionOf(file.path);
  if (ext === 'sh' || ext === 'bash') return 1;
  return shells.has(shebangOf(file)) ? 1 : 0;
}

async function run(files: SourceFile[], kind: DiagramKind, opts: AnalyzeOptions): Promise<DiagramModel> {
  const all = byPath(files);
  // Pasted code has no name and often no shebang: when nothing looks like a script, analyze everything.
  const detected = all.filter((f) => detectBash(f) > 0);
  const sources = detected.length ? detected : all;
  if (!sources.length) return emptyModel('bash', kind, [diagnostic('info', 'no shell scripts in the input')]);

  const diagnostics: Diagnostic[] = [];
  const parser = await getParser('bash');
  const trees: Tree[] = [];
  try {
    const parsed: BashFile[] = [];
    for (const f of sources) {
      const text = f.content.charCodeAt(0) === 0xfeff ? f.content.slice(1) : f.content;
      const tree = parser.parse(text);
      if (!tree) {
        diagnostics.push(diagnostic('error', `could not parse ${f.path}`, { file: f.path, line: 1 }));
        continue;
      }
      trees.push(tree);
      diagnostics.push(...syntaxDiagnostics(tree.rootNode, f.path));
      parsed.push(makeFile(f.path, tree.rootNode));
    }
    const project = new Project(parsed);
    const model =
      kind === 'bash.flowchart'
        ? flowchart(project, opts)
        : kind === 'bash.dependency'
          ? dependencyDiagram(project, opts)
          : callGraph(project, opts);
    model.diagnostics = [...diagnostics, ...project.diagnostics, ...model.diagnostics];
    return model;
  } finally {
    for (const t of trees) t.delete();
    parser.delete();
  }
}

export const bashAnalyzer: Analyzer = {
  lang: 'bash',
  kinds,
  detect: detectBash,
  analyze: safeAnalyze('bash', kinds, run),
};
