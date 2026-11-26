// Evidence and source references. Every inferred node and edge carries at
// least one Evidence so the UI can say why it exists and link to the line.
import type { Node } from 'web-tree-sitter';
import type { Diagnostic, Evidence, SourceRef } from '../../model/types';

/** 1-based reference for a tree-sitter node (tree-sitter rows are 0-based). */
export function refOf(node: Pick<Node, 'startPosition' | 'endPosition'>, file: string): SourceRef {
  const line = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  return endLine > line ? { file, line, endLine } : { file, line };
}

/** 1-based reference from a character offset, for the hand-written SQL tokenizer. */
export function refAtOffset(content: string, offset: number, file: string): SourceRef {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
  return { file, line };
}

export function evidence(rule: string, ref?: SourceRef, note?: string): Evidence {
  const e: Evidence = { rule };
  if (ref) e.ref = ref;
  if (note) e.note = note;
  return e;
}

export function diagnostic(level: Diagnostic['level'], message: string, ref?: SourceRef): Diagnostic {
  return ref ? { level, message, ref } : { level, message };
}

/** Collects tree-sitter ERROR / MISSING nodes as diagnostics; analysis carries on regardless. */
export function syntaxDiagnostics(root: Node, file: string, limit = 20): Diagnostic[] {
  if (!root.hasError) return [];
  const out: Diagnostic[] = [];
  const visit = (n: Node) => {
    if (out.length >= limit) return;
    if (n.isError || n.isMissing) {
      const what = n.isMissing ? `missing ${n.type}` : 'syntax error';
      out.push(diagnostic('error', `${what} near "${n.text.slice(0, 30)}"`, refOf(n, file)));
      return;
    }
    if (!n.hasError) return;
    for (const c of n.children) if (c) visit(c);
  };
  visit(root);
  return out;
}
