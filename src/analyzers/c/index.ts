// C analyzer (PROMPT.md §7.2): struct, call-graph and include diagrams.
import type { Node, Tree } from 'web-tree-sitter';
import type { AnalyzeOptions, Analyzer } from '../types';
import type { Diagnostic, DiagramKind, DiagramModel, SourceFile } from '../../model/types';
import { extensionOf } from '../shared/detect';
import { diagnostic, refOf, syntaxDiagnostics } from '../shared/evidence';
import { byPath } from '../shared/ids';
import { emptyModel, safeAnalyze } from '../shared/model';
import { getParser } from '../shared/tree-sitter';
import { callGraph } from './callgraph';
import { type ParsedFile, collectProject } from './collect';
import { includeGraph } from './include';
import { structDiagram } from './struct';

const kinds: DiagramKind[] = ['c.struct', 'c.callgraph', 'c.include'];

// .h is also used by C++; the C analyzer still takes it, with a bit less certainty.
export function detectC(file: SourceFile): number {
  const ext = extensionOf(file.path);
  return ext === 'c' ? 1 : ext === 'h' ? 0.9 : 0;
}

/** `#ifndef X` + `#define X` at the top of a block: an include guard, not a real condition. */
function isGuard(n: Node): boolean {
  if (n.type !== 'preproc_ifdef' || !n.text.startsWith('#ifndef')) return false;
  const name = n.childForFieldName('name')?.text;
  // namedChildren[0] is the guard name itself.
  const first = n.namedChildren.slice(1).find((c) => c && c.type !== 'comment');
  return first?.type === 'preproc_def' && first.childForFieldName('name')?.text === name;
}

/** One info per file that has conditional blocks: every branch is analysed, macros are not expanded. */
function conditionalDiagnostics(root: Node, file: string): Diagnostic[] {
  const blocks = root.descendantsOfType(['preproc_if', 'preproc_ifdef']).filter((n): n is Node => !!n && !isGuard(n));
  if (!blocks.length) return [];
  return [
    diagnostic(
      'info',
      `${blocks.length} #if/#ifdef block(s) in ${file}: every branch is analysed and macros are not expanded`,
      refOf(blocks[0]!, file),
    ),
  ];
}

async function run(files: SourceFile[], kind: DiagramKind, opts: AnalyzeOptions): Promise<DiagramModel> {
  const sources = byPath(files).filter((f) => detectC(f) >= 0.5);
  if (!sources.length) return emptyModel('c', kind, [diagnostic('info', 'no C files in the input')]);

  const diagnostics: Diagnostic[] = [];
  const parser = await getParser('c');
  const trees: Tree[] = [];
  try {
    const parsed: ParsedFile[] = [];
    for (const f of sources) {
      const text = f.content.charCodeAt(0) === 0xfeff ? f.content.slice(1) : f.content;
      const tree = parser.parse(text);
      if (!tree) {
        diagnostics.push(diagnostic('error', `could not parse ${f.path}`, { file: f.path, line: 1 }));
        continue;
      }
      trees.push(tree);
      diagnostics.push(...syntaxDiagnostics(tree.rootNode, f.path));
      diagnostics.push(...conditionalDiagnostics(tree.rootNode, f.path));
      // Lets collect.ts re-parse what an ERROR node swallowed (ast.ts topLevelItems).
      const reparse = (piece: string) => {
        const again = parser.parse(piece);
        if (!again) return undefined;
        trees.push(again);
        return again.rootNode;
      };
      parsed.push({ path: f.path, root: tree.rootNode, reparse });
    }
    const project = collectProject(parsed);
    const model =
      kind === 'c.include'
        ? includeGraph(project, opts)
        : kind === 'c.callgraph'
          ? callGraph(project, opts)
          : structDiagram(project, opts);
    model.diagnostics = [...diagnostics, ...project.diagnostics, ...model.diagnostics];
    return model;
  } finally {
    for (const t of trees) t.delete();
    parser.delete();
  }
}

export const cAnalyzer: Analyzer = {
  lang: 'c',
  kinds,
  detect: detectC,
  analyze: safeAnalyze('c', kinds, run),
};
