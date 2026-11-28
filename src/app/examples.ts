// The public examples the preview page can draw. They are the repository's own
// fixtures (written for this project), loaded lazily as raw text and analysed in
// the browser, so what the page shows is the real engine output.
import type { DiagramKind, Lang, SourceFile } from '../model/types';

const raw = import.meta.glob<string>(
  [
    '../../fixtures/java/festival/input/**/*',
    '../../fixtures/java/library/input/**/*',
    '../../fixtures/java/board-game/input/**/*',
    '../../fixtures/java/workshop/input/**/*',
    '../../fixtures/c/hash-table/input/**/*',
    '../../fixtures/c/linked-list/input/**/*',
    '../../fixtures/c/ring-buffer/input/**/*',
    '../../fixtures/c/dice-stats/input/**/*',
    '../../fixtures/bash/installer/input/**/*',
    '../../fixtures/bash/backup-rotate/input/**/*',
    '../../fixtures/bash/lib-source/input/**/*',
    '../../fixtures/sql/shop-mysql/input/**/*',
    '../../fixtures/sql/clinic-postgres/input/**/*',
    '../../fixtures/sql/library-views/input/**/*',
    '../../fixtures/sql/todo-sqlite/input/**/*',
    '../../fixtures/sql/university-tsql/input/**/*',
  ],
  { query: '?raw', import: 'default' },
);

export interface Example {
  lang: Lang;
  name: string;
}

export const EXAMPLES: readonly Example[] = [
  { lang: 'java', name: 'festival' },
  { lang: 'java', name: 'library' },
  { lang: 'java', name: 'board-game' },
  { lang: 'java', name: 'workshop' },
  { lang: 'c', name: 'hash-table' },
  { lang: 'c', name: 'linked-list' },
  { lang: 'c', name: 'ring-buffer' },
  { lang: 'c', name: 'dice-stats' },
  { lang: 'bash', name: 'installer' },
  { lang: 'bash', name: 'backup-rotate' },
  { lang: 'bash', name: 'lib-source' },
  { lang: 'sql', name: 'shop-mysql' },
  { lang: 'sql', name: 'clinic-postgres' },
  { lang: 'sql', name: 'library-views' },
  { lang: 'sql', name: 'todo-sqlite' },
  { lang: 'sql', name: 'university-tsql' },
];

export const LANG_NAMES: Record<Lang, string> = { java: 'Java', c: 'C', bash: 'Bash', sql: 'SQL' };

export const KIND_NAMES: Record<DiagramKind, string> = {
  'java.class': 'Classes',
  'java.package': 'Pacotes',
  'java.dependency': 'Dependências',
  'c.struct': 'Estruturas',
  'c.callgraph': 'Chamadas',
  'c.include': 'Includes',
  'bash.callgraph': 'Chamadas',
  'bash.flowchart': 'Fluxograma',
  'bash.dependency': 'Dependências',
  'sql.relational': 'Relacional',
  'sql.ssms': 'SQL Server',
  'sql.chen': 'Chen',
  'sql.crowsfoot': 'Pé de galinha',
};

export async function loadExample(ex: Example): Promise<SourceFile[]> {
  const prefix = `../../fixtures/${ex.lang}/${ex.name}/input/`;
  const keys = Object.keys(raw)
    .filter((k) => k.startsWith(prefix))
    .sort();
  return Promise.all(keys.map(async (k) => ({ path: k.slice(prefix.length), content: await raw[k]!() })));
}
