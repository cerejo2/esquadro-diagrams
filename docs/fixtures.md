# Fixtures

Fixtures are the ground truth the analyzers are measured against.

```
fixtures/<lang>/<case>/              public, original examples written for this repository
  input/**                           the code, as a user would drop it
  expected.yaml                      hand-written expected diagram
  expected.<name>.yaml               more diagrams of the same input (one kind per file)

fixtures-private/<lang>/<case>/      local only, never committed (course material)
  input/**
  reference.png | reference*.svg     the diagram the expected file was transcribed from
  expected*.yaml
```

`<lang>` is `java`, `c`, `bash` or `sql`. Folders whose name starts with `_` (for example `fixtures-private/_estilo/`) are not cases and are skipped. Inside `input/`, the loader skips `node_modules`, `.git`, `build`, `dist`, `target`, binary files and files over 5 MB, as the app does.

Private fixtures are absent in CI, so tests that use them must skip when the folder does not exist (`hasPrivateFixtures(lang)` in `src/bench/fixtures.ts`).

## expected.yaml

```yaml
kind: java.class # one DiagramKind
source: diagram # diagram = transcribed from an image; self-made = written by reading the code; original = public example
options: # optional AnalyzeOptions for this run (defaults otherwise)
  showAccessors: false
nodes:
  - name: EmployeeInterface
    kind: interface # a NodeKind
    stereotypes: [interface] # optional
    operations: ['+ start(date: LocalDate): void', '+ work(): void']
  - name: EmployeeDecorator
    kind: abstract
    attributes: ['# employee: EmployeeInterface']
edges:
  - { kind: realization, from: Employee, to: EmployeeInterface }
  - { kind: aggregation, from: EmployeeDecorator, to: EmployeeInterface, role: employee, multiplicity: '1' }
notes: 'the diagram does not show getters'
```

Fields:

| Field                                                                           | Meaning                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`                                                                          | Required. The diagram this file describes.                                                                                                                                    |
| `source`                                                                        | Required. `diagram`, `self-made` or `original`.                                                                                                                               |
| `options`                                                                       | Optional. `showAccessors`, `showDependencies`, `showExternal`, `showMain`, `showObjectMethods`, `entry`, `locale`.                                                                                             |
| `nodes[]`                                                                       | `name` and `kind` required. `attributes` and `operations` are member strings in UML form; leave the key out when the reference does not show that compartment.                |
| `edges[]`                                                                       | `kind`, `from`, `to` required; both ends must be listed in `nodes`. Generalization and realization go from child to parent; aggregation and composition from whole to part.   |
| `role`, `multiplicity`                                                          | At the `to` end. `fromRole` and `fromMultiplicity` for the other end. Quote multiplicities (`"1"`), or YAML reads them as numbers.                                             |
| `fromColumn`, `toColumn`                                                        | SQL: the FK cell and the referenced PK cell.                                                                                                                                  |
| `total`                                                                         | Chen: total participation on the `from` side.                                                                                                                                 |
| `counts`                                                                        | Instead of (or with) `nodes`/`edges`: `{ nodes: { <NodeKind>: n }, edges: { <EdgeKind>: n } }`. Used for `bash.flowchart` and robustness cases such as Northwind.              |
| `calls`                                                                         | `bash.flowchart` only: the function calls (`subroutine` nodes) from top to bottom.                                                                                            |
| `notes`                                                                         | Free text: what the reference leaves out, doubts about the transcription.                                                                                                     |

A file needs `nodes`/`edges` or `counts`/`calls`. Describe what the reference shows, not what you think it should show; record omissions in `notes`.

### Member strings

`<visibility> name: Type` for attributes and `<visibility> name(p: Type, q: Type): Return` for operations, with `+ - # ~`. Constructors have no return type (`+ Employee(name: String)`). Whitespace does not matter when comparing.

## Validator

```
npm run fixtures:check
```

Checks every `expected*.yaml` under `fixtures/` and `fixtures-private/`: known kinds, required fields, edge ends that exist, unquoted multiplicities, duplicate names, unknown keys, empty `input/`. The rules live in `src/bench/expected.ts` (`validateExpected`, `parseExpected`).

## Scoring

`src/bench/compare.ts` compares a `DiagramModel` with an expected file:

- **Nodes**: by `(name, kind)`. SQL names are case-insensitive.
- **Strict edges**: by `(kind, from, to)`. A plain `association` ignores direction.
- **Relaxed edges**: association, aggregation and composition are one family, without direction.
- **Roles, multiplicities, columns**: accuracy over the relaxed matches.
- **Members**: attribute and operation strings, only where the expected node lists them.
- **Counts**: `sum(min) / sum(max)` over the listed kinds.
- **Calls**: longest common subsequence of the call sequence.

Precision, recall and F1 are micro-averaged per language. `npm run bench` (optionally `-- --lang java --verbose`) prints one row per case and one per language, and writes `public/bench.json` with aggregate numbers only.

## Using fixtures in tests

```ts
import { hasPrivateFixtures, loadFixtures, runFixture } from '../../../bench/fixtures';

const cases = await loadFixtures({ lang: 'java' });
for (const fx of cases) {
  it.skipIf(fx.private && !hasPrivateFixtures('java'))(fx.name, async () => {
    for (const r of await runFixture(fx)) expect(r.score.nodes?.f1, r.score.misses.join('\n')).toBe(1);
  });
}
```

`score.misses` lists every difference in plain words, which makes failures readable.
