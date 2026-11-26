// Environment-neutral tree-sitter loader.
//
// The analyzers only call `getParser(grammar)`. Where the WASM files come from
// is decided once per environment: `tree-sitter-browser.ts` (Vite asset URLs,
// fetched on demand) or `tree-sitter-node.ts` (files read from node_modules,
// used by Vitest and the bench script). Keeping the two apart means the
// browser bundle never pulls in `node:fs`.
import { Language, Parser } from 'web-tree-sitter';

export type Grammar = 'java' | 'c' | 'bash';

export interface WasmSource {
  /** Options for `Parser.init`, usually a `locateFile` for web-tree-sitter.wasm. */
  runtime: () => Promise<Parameters<typeof Parser.init>[0]>;
  /** The grammar's .wasm, as a URL/path that `Language.load` accepts or the raw bytes. */
  grammar: (grammar: Grammar) => Promise<string | URL | Uint8Array>;
}

let source: WasmSource | undefined;
let runtimeReady: Promise<void> | undefined;
const languages = new Map<Grammar, Promise<Language>>();

export function setWasmSource(next: WasmSource): void {
  source = next;
  runtimeReady = undefined;
  languages.clear();
}

function requireSource(): WasmSource {
  if (!source) {
    throw new Error(
      'tree-sitter WASM source not configured: import "analyzers/shared/tree-sitter-browser" or "-node" first',
    );
  }
  return source;
}

function initRuntime(): Promise<void> {
  const src = requireSource();
  runtimeReady ??= src.runtime().then((opts) => Parser.init(opts));
  return runtimeReady;
}

/** Loads (once) and returns the grammar. Concurrent callers share the same promise. */
export function getLanguage(grammar: Grammar): Promise<Language> {
  let pending = languages.get(grammar);
  if (!pending) {
    const src = requireSource();
    pending = initRuntime()
      .then(() => src.grammar(grammar))
      .then((input) => Language.load(input));
    // Do not cache failures: a later call may succeed (e.g. after a network blip).
    pending.catch(() => languages.delete(grammar));
    languages.set(grammar, pending);
  }
  return pending;
}

/**
 * A fresh parser for the grammar. Parsers are cheap; languages are not, so the
 * language is cached and the parser is not. Call `parser.delete()` when done.
 */
export async function getParser(grammar: Grammar): Promise<Parser> {
  const language = await getLanguage(grammar);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}
