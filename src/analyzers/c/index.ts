// Stub: replaced in Phase 1 (PROMPT.md §7.2).
import type { Analyzer } from '../types';
import type { DiagramKind } from '../../model/types';
import { extensionOf } from '../shared/detect';
import { diagnostic } from '../shared/evidence';
import { emptyModel, safeAnalyze } from '../shared/model';

const kinds: DiagramKind[] = ['c.struct', 'c.callgraph', 'c.include'];

export const cAnalyzer: Analyzer = {
  lang: 'c',
  kinds,
  // .h is also used by C++; the C analyzer still takes it, with a bit less certainty.
  detect: (file) => {
    const ext = extensionOf(file.path);
    return ext === 'c' ? 1 : ext === 'h' ? 0.9 : 0;
  },
  analyze: safeAnalyze('c', kinds, async (_files, kind) =>
    emptyModel('c', kind, [diagnostic('info', 'C analyzer not implemented yet')]),
  ),
};
