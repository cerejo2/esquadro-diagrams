// src/analyzers/types.ts
import type { DiagramKind, DiagramModel, Lang, SourceFile } from '../model/types';

export interface AnalyzeOptions {
  showAccessors?: boolean; // getters e setters (por defeito false)
  showDependencies?: boolean; // por defeito false
  showExternal?: boolean; // funções e comandos externos (por defeito false)
  showMain?: boolean; // main e classes que só o contêm (por defeito false)
  showObjectMethods?: boolean; // toString, equals, hashCode (por defeito false)
  entry?: string; // fluxograma: nome da função ou 'script'
  locale?: 'pt' | 'en';
}

export interface Analyzer {
  lang: Lang;
  kinds: DiagramKind[];
  detect(file: SourceFile): number; // 0..1
  analyze(files: SourceFile[], kind: DiagramKind, opts?: AnalyzeOptions): Promise<DiagramModel>; // nunca lança: erros vão para diagnostics
}
