// SQL analyzer (PROMPT.md §7.4): a hand-written DDL parser, not tree-sitter.
// parse.ts reads the files into tables, columns, keys and views; resolve.ts
// links the foreign keys; build.ts and chen.ts draw the four diagrams.
import type { Analyzer } from '../types';
import type { DiagramKind, DiagramModel } from '../../model/types';
import { extensionOf } from '../shared/detect';
import { diagnostic } from '../shared/evidence';
import { safeAnalyze } from '../shared/model';
import { buildTables } from './build';
import { buildChen } from './chen';
import { parseSql } from './parse';
import { resolveSchema } from './resolve';

const kinds: DiagramKind[] = ['sql.relational', 'sql.ssms', 'sql.chen', 'sql.crowsfoot'];

export const sqlAnalyzer: Analyzer = {
  lang: 'sql',
  kinds,
  detect: (file) => {
    const ext = extensionOf(file.path);
    return ext === 'sql' ? 1 : ext === 'ddl' ? 0.9 : 0;
  },
  analyze: safeAnalyze('sql', kinds, async (files, kind, opts) => {
    const sqlFiles = files.filter((f) => sqlAnalyzer.detect(f) > 0);
    const parsed = parseSql(sqlFiles.length ? sqlFiles : files);
    const schema = resolveSchema(parsed.tables, parsed.views);
    const diagnostics = [...parsed.diagnostics, ...schema.diagnostics];
    if (!schema.tables.length) diagnostics.push(diagnostic('warn', 'no CREATE TABLE found'));
    const model: DiagramModel = { lang: 'sql', kind, nodes: [], edges: [], diagnostics };
    if (kind === 'sql.chen') {
      const chen = buildChen(schema);
      model.nodes = chen.nodes;
      model.edges = chen.edges;
      diagnostics.push(...chen.diagnostics);
    } else {
      const built = buildTables(schema, kind, opts);
      model.nodes = built.nodes;
      model.edges = built.edges;
    }
    return model;
  }),
};

export { parseSql } from './parse';
export { tokenize } from './tokenize';
