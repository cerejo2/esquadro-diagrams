// Stub: replaced in Phase 1 (PROMPT.md §7.3).
import type { Analyzer } from '../types';
import type { DiagramKind } from '../../model/types';
import { extensionOf, shebangOf } from '../shared/detect';
import { diagnostic } from '../shared/evidence';
import { emptyModel, safeAnalyze } from '../shared/model';

const kinds: DiagramKind[] = ['bash.callgraph', 'bash.flowchart', 'bash.dependency'];
const shells = new Set(['bash', 'sh', 'zsh']);

export const bashAnalyzer: Analyzer = {
  lang: 'bash',
  kinds,
  detect: (file) => {
    const ext = extensionOf(file.path);
    if (ext === 'sh' || ext === 'bash') return 1;
    return shells.has(shebangOf(file)) ? 1 : 0;
  },
  analyze: safeAnalyze('bash', kinds, async (_files, kind) =>
    emptyModel('bash', kind, [diagnostic('info', 'Bash analyzer not implemented yet')]),
  ),
};
