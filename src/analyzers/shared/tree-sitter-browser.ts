// Browser side of the loader (app, worker and spike page).
// `?url` turns each .wasm into a hashed asset; nothing is downloaded until a
// grammar is actually requested, so a SQL-only project never fetches Java.
import runtimeUrl from 'web-tree-sitter/web-tree-sitter.wasm?url';
import bashUrl from 'tree-sitter-bash/tree-sitter-bash.wasm?url';
import cUrl from 'tree-sitter-c/tree-sitter-c.wasm?url';
import javaUrl from 'tree-sitter-java/tree-sitter-java.wasm?url';
import { type Grammar, setWasmSource } from './tree-sitter';

const grammarUrls: Record<Grammar, string> = { java: javaUrl, c: cUrl, bash: bashUrl };

setWasmSource({
  runtime: async () => ({
    locateFile: (name: string) => (name.endsWith('.wasm') ? runtimeUrl : name),
  }),
  grammar: async (grammar) => grammarUrls[grammar],
});
