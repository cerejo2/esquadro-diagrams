// Stub: replaced in Phase 1 (PROMPT.md §7.1).
import type { Analyzer } from '../types';
import type { DiagramKind } from '../../model/types';
import { extensionOf } from '../shared/detect';
import { diagnostic } from '../shared/evidence';
import { emptyModel, safeAnalyze } from '../shared/model';

const kinds: DiagramKind[] = ['java.class', 'java.package', 'java.dependency'];

export const javaAnalyzer: Analyzer = {
  lang: 'java',
  kinds,
  detect: (file) => (extensionOf(file.path) === 'java' ? 1 : 0),
  analyze: safeAnalyze('java', kinds, async (_files, kind) =>
    emptyModel('java', kind, [diagnostic('info', 'Java analyzer not implemented yet')]),
  ),
};
