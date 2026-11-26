// src/model/types.ts
export type Lang = 'java' | 'c' | 'bash' | 'sql';

export type DiagramKind =
  | 'java.class'
  | 'java.package'
  | 'java.dependency'
  | 'c.struct'
  | 'c.callgraph'
  | 'c.include'
  | 'bash.callgraph'
  | 'bash.flowchart'
  | 'bash.dependency'
  | 'sql.relational'
  | 'sql.ssms'
  | 'sql.chen'
  | 'sql.crowsfoot';

export interface SourceRef {
  file: string;
  line: number;
  endLine?: number;
}

export type MemberFlag =
  | 'static'
  | 'abstract'
  | 'final'
  | 'ctor'
  | 'getter'
  | 'setter'
  | 'override'
  | 'main'
  | 'fn-pointer'
  | 'pk'
  | 'fk'
  | 'unique'
  | 'notnull'
  | 'identity'
  | 'partial-key';

export interface Member {
  name: string;
  type?: string; // já simplificado para mostrar: List<Employee>
  visibility?: '+' | '-' | '#' | '~';
  params?: { name: string; type?: string }[]; // só operações
  returns?: string;
  initial?: string; // valor inicial de um atributo estático, já em texto: '1', '"pt"'
  flags?: MemberFlag[];
  ref?: SourceRef;
}

export type NodeKind =
  | 'class'
  | 'interface'
  | 'abstract'
  | 'enum'
  | 'record'
  | 'package' // Java
  | 'struct'
  | 'union'
  | 'typedef'
  | 'c-enum'
  | 'source-file'
  | 'header-file' // C
  | 'function'
  | 'script'
  | 'external' // C e Bash
  | 'table'
  | 'view'
  | 'entity'
  | 'weak-entity'
  | 'relationship'
  | 'identifying-relationship' // SQL
  | 'terminator'
  | 'process'
  | 'decision'
  | 'io'
  | 'subroutine'
  | 'connector'; // fluxograma

export interface DiagramNode {
  id: string; // estável entre execuções: `${kind}:${nomeQualificado}`
  kind: NodeKind;
  name: string;
  label?: string; // texto a mostrar quando difere de name (fluxograma, Chen)
  stereotypes?: string[]; // sem «»: 'interface', 'abstract', 'enumeration', 'opaque'
  attributes?: Member[]; // campos, colunas, atributos Chen (desenhados como elipses)
  operations?: Member[]; // métodos, funções do TAD
  group?: string; // pacote, ficheiro ou esquema, para agrupar no layout
  parent?: string; // nó aninhado (classe interna)
  ref?: SourceRef;
  evidence?: Evidence[]; // porque o nó existe (declaração, ficheiro:linha)
}

export type EdgeKind =
  | 'generalization'
  | 'realization'
  | 'association'
  | 'aggregation'
  | 'composition'
  | 'dependency'
  | 'nesting'
  | 'include'
  | 'call'
  | 'source'
  | 'uses'
  | 'foreign-key'
  | 'participation'
  | 'isa'
  | 'flow';

export interface EdgeEnd {
  node: string;
  column?: string; // SQL: célula de origem ou destino
  role?: string;
  multiplicity?: string; // '1', '0..1', '*', '1..*', 'N', 'M'
  navigable?: boolean;
  total?: boolean; // Chen: participação total (linha dupla)
}

export interface Evidence {
  rule: string;
  ref?: SourceRef;
  note?: string;
}

export interface DiagramEdge {
  id: string;
  kind: EdgeKind;
  from: EdgeEnd; // generalização e realização: from = filho, to = pai
  to: EdgeEnd;
  label?: string; // 'sim'/'não' no fluxograma, nº de chamadas, 'trap'
  confidence: number; // 0..1; abaixo de 1 quando a regra é heurística
  evidence: Evidence[];
}

export interface Diagnostic {
  level: 'info' | 'warn' | 'error';
  message: string;
  ref?: SourceRef;
}

export interface DiagramModel {
  lang: Lang;
  kind: DiagramKind;
  title?: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  diagnostics: Diagnostic[];
}

export interface SourceFile {
  path: string;
  content: string;
}
