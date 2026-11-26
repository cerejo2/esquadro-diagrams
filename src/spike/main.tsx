// Phase 0 spike: proves the three grammars load and parse in the browser.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../analyzers/shared/tree-sitter-browser';
import { type Grammar, getParser } from '../analyzers/shared/tree-sitter';
import { outline } from './outline';
import { samples } from './samples';
import '../styles/base.css';

type Result = { grammar: Grammar; ms: number; ok: boolean; tree: string };

function Spike() {
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Result[] = [];
      for (const grammar of ['java', 'c', 'bash'] as const) {
        const t0 = performance.now();
        const parser = await getParser(grammar);
        const tree = parser.parse(samples[grammar]);
        const ms = Math.round(performance.now() - t0);
        out.push({ grammar, ms, ok: !!tree && !tree.rootNode.hasError, tree: tree ? outline(tree.rootNode, 5) : '' });
        tree?.delete();
        parser.delete();
      }
      if (!cancelled) setResults(out);
    })().catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page">
      <h1>tree-sitter spike</h1>
      <p>Each grammar is fetched on demand, parsed in the browser and printed as an outline.</p>
      {error && <p role="alert">Error: {error}</p>}
      {results.length === 0 && !error && <p>Loading grammars…</p>}
      {results.map((r) => (
        <section key={r.grammar} data-testid={`spike-${r.grammar}`} data-ok={r.ok}>
          <h2>
            {r.grammar} · {r.ok ? 'ok' : 'parse error'} · {r.ms} ms
          </h2>
          <div className="cols">
            <pre>{samples[r.grammar]}</pre>
            <pre>{r.tree}</pre>
          </div>
        </section>
      ))}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Spike />
  </StrictMode>,
);
