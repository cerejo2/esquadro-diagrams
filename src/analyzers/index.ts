// Registry of the four analyzers. The app, the worker and the bench only talk to this module.
import type { Analyzer } from './types';
import type { DiagramKind, Lang, SourceFile } from '../model/types';
import { bashAnalyzer } from './bash';
import { cAnalyzer } from './c';
import { javaAnalyzer } from './java';
import { sqlAnalyzer } from './sql';

export const analyzers: readonly Analyzer[] = [javaAnalyzer, cAnalyzer, bashAnalyzer, sqlAnalyzer];

export function analyzerFor(lang: Lang): Analyzer {
  const found = analyzers.find((a) => a.lang === lang);
  if (!found) throw new Error(`no analyzer for ${lang}`);
  return found;
}

export function analyzerForKind(kind: DiagramKind): Analyzer {
  const found = analyzers.find((a) => a.kinds.includes(kind));
  if (!found) throw new Error(`no analyzer produces ${kind}`);
  return found;
}

/** The most likely language of a file, or undefined if no analyzer claims it. */
export function detectLang(file: SourceFile, threshold = 0.5): Lang | undefined {
  let best: { lang: Lang; score: number } | undefined;
  for (const a of analyzers) {
    const score = a.detect(file);
    if (score >= threshold && (!best || score > best.score)) best = { lang: a.lang, score };
  }
  return best?.lang;
}

/** Files grouped by detected language; files no analyzer claims are left out. */
export function groupByLang(files: readonly SourceFile[]): Map<Lang, SourceFile[]> {
  const out = new Map<Lang, SourceFile[]>();
  for (const f of files) {
    const lang = detectLang(f);
    if (!lang) continue;
    const list = out.get(lang) ?? [];
    list.push(f);
    out.set(lang, list);
  }
  return out;
}

export type { Analyzer, AnalyzeOptions } from './types';
