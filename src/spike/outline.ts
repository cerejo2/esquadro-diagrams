import type { Node } from 'web-tree-sitter';

/** Indented outline of the named nodes, with 1-based line numbers, for eyeballing a parse. */
export function outline(root: Node, maxDepth = 6): string {
  const lines: string[] = [];
  const walk = (node: Node, depth: number) => {
    if (depth > maxDepth) return;
    const leaf = node.namedChildCount === 0 ? ` "${node.text.slice(0, 40)}"` : '';
    lines.push(`${'  '.repeat(depth)}${node.type} [${node.startPosition.row + 1}]${leaf}`);
    for (const child of node.namedChildren) {
      if (child) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return lines.join('\n');
}
