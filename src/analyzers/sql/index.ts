// Stub: replaced in Phase 1 (PROMPT.md §7.4). SQL uses a hand-written DDL parser, not tree-sitter.
import type { Analyzer } from '../types';
import type { DiagramKind } from '../../model/types';
import { extensionOf } from '../shared/detect';
import { diagnostic } from '../shared/evidence';
import { emptyModel, safeAnalyze } from '../shared/model';

const kinds: DiagramKind[] = ['sql.relational', 'sql.ssms', 'sql.chen', 'sql.crowsfoot'];

export const sqlAnalyzer: Analyzer = {
  lang: 'sql',
  kinds,
  detect: (file) => (extensionOf(file.path) === 'sql' ? 1 : 0),
  analyze: safeAnalyze('sql', kinds, async (_files, kind) =>
    emptyModel('sql', kind, [diagnostic('info', 'SQL analyzer not implemented yet')]),
  ),
};
