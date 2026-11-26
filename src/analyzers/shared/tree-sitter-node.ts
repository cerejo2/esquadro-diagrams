// Node side of the loader (Vitest setup file and scripts/bench.ts).
// Importing this module is enough: it registers itself as the WASM source.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { type Grammar, setWasmSource } from './tree-sitter';

const require = createRequire(import.meta.url);

const grammarFiles: Record<Grammar, string> = {
  java: 'tree-sitter-java/tree-sitter-java.wasm',
  c: 'tree-sitter-c/tree-sitter-c.wasm',
  bash: 'tree-sitter-bash/tree-sitter-bash.wasm',
};

export function resolveGrammarWasm(grammar: Grammar): string {
  return require.resolve(grammarFiles[grammar]);
}

setWasmSource({
  // In Node, web-tree-sitter finds its own .wasm next to its JS file.
  runtime: async () => undefined,
  grammar: async (grammar) => new Uint8Array(await readFile(resolveGrammarWasm(grammar))),
});
