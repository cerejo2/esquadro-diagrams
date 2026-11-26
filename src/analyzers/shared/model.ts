import type { AnalyzeOptions, Analyzer } from '../types';
import type { Diagnostic, DiagramKind, DiagramModel, Lang, SourceFile } from '../../model/types';
import { diagnostic } from './evidence';

export function emptyModel(lang: Lang, kind: DiagramKind, diagnostics: Diagnostic[] = []): DiagramModel {
  return { lang, kind, nodes: [], edges: [], diagnostics };
}

/**
 * Wraps an analyze function so it honours the contract: it never throws, an
 * unsupported kind becomes a diagnostic, and so does any unexpected exception.
 */
export function safeAnalyze(
  lang: Lang,
  kinds: readonly DiagramKind[],
  run: (files: SourceFile[], kind: DiagramKind, opts: AnalyzeOptions) => Promise<DiagramModel>,
): Analyzer['analyze'] {
  return async (files, kind, opts = {}) => {
    if (!kinds.includes(kind)) {
      return emptyModel(lang, kind, [diagnostic('error', `${lang} analyzer does not produce ${kind}`)]);
    }
    try {
      return await run(files, kind, opts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return emptyModel(lang, kind, [diagnostic('error', `internal error in the ${lang} analyzer: ${message}`)]);
    }
  };
}
