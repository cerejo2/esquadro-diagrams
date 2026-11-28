# Architecture

Esquadro is a static web app. All analysis and layout run in the browser; there is no backend and no analytics.

## Pipeline

```
files (folder, zip, paste, GitHub)
  → detect language (extension, shebang)          src/analyzers/index.ts
  → analyzer → DiagramModel                       src/analyzers/<lang>/
  → layout candidates → score → best              src/layout/          (Phase 2)
  → SVG render (themes, notations)                src/render/          (Phase 2)
  → editor, exports                               src/app/, src/export/ (Phases 3–4)
```

Analysis and layout will run in a Web Worker so the UI never freezes.

## Contracts

`src/model/types.ts` is the model every stage shares (`DiagramModel`, nodes, edges, evidence, diagnostics). `src/analyzers/types.ts` is the analyzer interface: `detect(file)` returns 0..1 and `analyze(files, kind, opts)` never throws; problems become diagnostics (`safeAnalyze` in `src/analyzers/shared/model.ts` enforces this). Ids are stable across runs (`${kind}:${qualifiedName}`), because the editor stores positions by id. `src/model/kinds.ts` mirrors the string unions as runtime lists and fails to compile if they drift apart.

## Parsing: web-tree-sitter

Java, C and Bash are parsed with tree-sitter compiled to WebAssembly. SQL uses a hand-written DDL parser (T-SQL batches, `[names]`, `IDENTITY` and similar are handled poorly by generic SQL parsers).

Pinned versions, chosen in the Phase 0 spike:

| Package           | Version | Grammar ABI |
| ----------------- | ------- | ----------- |
| `web-tree-sitter` | 0.27.2  | runtime accepts ABI 13–15 |
| `tree-sitter-java` | 0.23.5 | 14 |
| `tree-sitter-c`    | 0.24.1 | 15 |
| `tree-sitter-bash` | 0.25.1 | 15 |

Why these: they are the latest releases, each grammar package ships its own prebuilt `.wasm`, and all three ABIs fall inside the runtime's supported range, so no grammar has to be rebuilt with the tree-sitter CLI. The old all-in-one `tree-sitter-wasms` package was rejected because it bundles 0.20-era grammars. Versions are pinned exactly because a grammar bump can change node names and break the analyzers silently; bump them together and rerun the spike test (`src/analyzers/shared/tree-sitter.test.ts`), which checks every grammar's ABI against the runtime.

The grammar packages declare the native `tree-sitter` binding as an optional peer, so npm does not build any native code.

### Loading in two environments

`src/analyzers/shared/tree-sitter.ts` caches one `Language` per grammar and hands out parsers. Where the `.wasm` bytes come from is plugged in once:

- `tree-sitter-browser.ts` imports each `.wasm` with Vite's `?url`. Each grammar becomes a hashed asset that is only fetched when a file of that language shows up (Java 415 kB, C 626 kB, Bash 1.36 MB before compression; 53, 75 and 186 kB gzipped).
- `tree-sitter-node.ts` reads the files from `node_modules`. Vitest loads it as a setup file; `scripts/bench.ts` imports it.

Keeping them apart stops `node:fs` from leaking into the browser bundle. (The files are named `-node`/`-browser` rather than `.node`/`.browser` because Node treats a `.node` specifier as a native addon.)

The production build silences one expected warning: Emscripten output in `web-tree-sitter` uses direct `eval`.

## Java analyzer

`src/analyzers/java/` turns tree-sitter output into the three Java diagrams in four passes:

- `collect.ts` walks every file once and records each type (class, interface, enum, record, nested types) with its fields, methods and supertypes. `ast.ts` holds the small helpers for reading type names, generic arguments and modifiers.
- `resolve.ts` maps a simple name to a project type by looking, in order, at type parameters, member types (own, enclosing and inherited), explicit imports, the same package and `import pkg.*`. Names that match several types become a warning instead of a guess, and JDK types never become nodes.
- `relations.ts` applies the field rules of PROMPT.md §7.1. Composition when the class creates the object (`new` or a copy it makes with `copy()`/`clone()`, in the declaration, a constructor or an initializer, or `add(new T(...))` anywhere); aggregation when it receives it (a constructor or setter parameter, or `add(p)`); association otherwise. Collections have multiplicity `0..*`. It also lists every type use (parameters, locals, `new`, static access, casts, patterns) for the dependency edges.
- `build.ts` builds `java.class`, `java.package` and `java.dependency`. Reciprocal plain associations merge into one edge, a class that only holds `main` is left out, and dependencies are hidden by default (`showDependencies`).

Attributes follow Visual Paradigm: `- name: Type = initial {readOnly}`. Final fields and record components are `{readOnly}`; only static fields with a plain literal show `= initial`.

These house conventions were chosen against the course references, which disagree with each other: `0..*` for collections and `{readOnly}` follow the references, and a stored copy counts as a composition.

Every node and edge carries evidence (the rule and `file:line`), so the UI can explain why an arrow exists. Ancestor lookups are iterative and cached, because a recursive walk overflowed the stack on a 3000-class inheritance chain.

Private cases may differ from their course references only where the drawing follows another convention than §7.1. The accepted differences sit next to each private case in `known.yaml`, outside the repository.

## C analyzer

`src/analyzers/c/` reads every file once (`collect.ts`) and builds three diagrams:

- `c.struct`: structs, unions and enums as boxes. A function belongs to an abstract data type when its first parameter is `T*` or it returns `T*` and its name starts with the type name; static functions are private. `resolve.ts` follows typedef chains so `Tray *`, `NodePtr` and `struct node *` reach the same type.
- `c.callgraph`: one node per defined function, `call` edges labelled with the number of call sites, library functions as hidden externals grouped by library. Calls through a field, a parameter or an expression get no edge and an info diagnostic. A name defined in two files becomes `f (file.c)`, and an ambiguous call gives a warning instead of a guess.
- `c.include`: one edge per `#include "x.h"`, resolved from the including file's folder first, and a warning for every include cycle.

Every `#if` branch is analysed and macros are not expanded; an info diagnostic says so.

## Bash analyzer

`src/analyzers/bash/` builds a call graph (functions, one `script` node per file for its top-level code, `source` and `trap` edges), a dependency diagram (external commands and the files a script reads or writes) and a flowchart with ISO 5807 shapes. The flowchart merges runs of plain commands into one process block of at most three lines, turns `if`, `case`, loops and `&&`/`||` into decisions, and writes decisions as questions (`labels.ts`) in Portuguese or English. A call to a project function is a subroutine, never expanded inline.

## SQL analyzer

`src/analyzers/sql/` does not use tree-sitter: generic SQL grammars handle T-SQL batches, `[names]` and `IDENTITY` poorly. A hand-written tokenizer and a tolerant recursive-descent parser read `CREATE TABLE`, `ALTER TABLE ... ADD` and `CREATE VIEW` in T-SQL, MySQL, PostgreSQL and SQLite, and skip everything else up to the next `;` or `GO`. `resolve.ts` links each foreign key to its table and columns. `build.ts` draws the relational, SSMS and crow's foot diagrams; `chen.ts` undoes the ER-to-relational mapping taught in FBD (weak entities from a PK that contains an FK, M:N relationships from tables whose PK is two FKs).

## Shared rules

Syntax errors are found with an iterative walk (`syntaxDiagnostics`), because a stack overflow that unwinds through web-tree-sitter's WASM frames leaves the parser unusable for the next file.

## Tooling

- **TypeScript 7** (the native compiler), `strict` plus `noUncheckedIndexedAccess`. One `tsconfig.json` covers `src/` and `scripts/`, so `npx tsc --noEmit` checks everything.
- **oxlint** instead of ESLint. typescript-eslint does not support TypeScript 7 yet, and oxlint covers the React, hooks, import, Vitest and TypeScript rules we need while running in milliseconds. `npm run lint` fails on warnings.
- **Prettier** for formatting, **Vitest** for tests (Node environment), **tsx** for scripts.

## Fixtures and the bench

See `docs/fixtures.md`. `src/bench/compare.ts` scores a model against an `expected.yaml`; `src/bench/fixtures.ts` loads cases from `fixtures/` (public, original) and `fixtures-private/` (course material, local only, skipped in CI); `scripts/bench.ts` prints the tables and writes `public/bench.json` with aggregate numbers only.

## Hosting

GitHub Pages at `https://cerejo2.github.io/esquadro-diagrams/`, deployed by `.github/workflows/deploy.yml` on every push to `main`; `ci.yml` runs lint, format check, typecheck, tests and build. Vite's `base` is `/esquadro-diagrams/` in production builds and in `vite preview` (so the preview serves the build exactly as Pages does) and `/` in the dev server. The app will use hash routes so Pages never has to rewrite URLs.

Input files are decoded by BOM (`src/io/decode.ts`): UTF-8, UTF-8 with BOM, and UTF-16 LE/BE, because SQL Server Management Studio saves scripts as UTF-16. Files with NUL bytes and no BOM are treated as binary and skipped.
