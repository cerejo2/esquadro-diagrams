import { describe, expect, it } from 'vitest';
import { parseExpected } from './expected';

/** Error list of an invalid file ('' when it was valid), so assertions stay unconditional. */
const errorsOf = (text: string) => {
  const v = parseExpected(text);
  return v.ok ? '' : v.errors.join('\n');
};

describe('expected.yaml validator', () => {
  it('accepts the example from the spec', () => {
    const v = parseExpected(`
kind: java.class
source: diagram
nodes:
  - name: EmployeeInterface
    kind: interface
    operations: ["+ start(date: LocalDate): void", "+ terminate(date: LocalDate): void", "+ work(): void"]
  - name: Employee
    kind: class
  - name: EmployeeDecorator
    kind: abstract
    attributes: ["# employee: EmployeeInterface"]
edges:
  - { kind: realization, from: Employee, to: EmployeeInterface }
  - { kind: aggregation, from: EmployeeDecorator, to: EmployeeInterface, role: employee, multiplicity: "1" }
notes: "o diagrama não mostra getters"
`);
    expect(v.ok).toBe(true);
  });

  it('accepts the counts-only format', () => {
    const v = parseExpected(
      'kind: sql.relational\nsource: self-made\ncounts: { nodes: { table: 13 }, edges: { foreign-key: 13 } }\n',
    );
    expect(v.ok).toBe(true);
  });

  it('rejects unknown kinds, unlisted edge ends and unquoted multiplicities', () => {
    const errors = errorsOf(`
kind: java.klass
source: diagram
nodes: [{ name: A, kind: klass }]
edges: [{ kind: association, from: A, to: B, multiplicity: 1 }]
`);
    expect(errors).toMatch(/kind must be one of/);
    expect(errors).toMatch(/nodes\[0\]\.kind "klass"/);
    expect(errors).toMatch(/edges\[0\]\.to "B" is not a listed node/);
    expect(errors).toMatch(/multiplicity must be a string/);
  });

  it('rejects duplicate node names, unknown keys and empty files', () => {
    const errors = errorsOf(
      'kind: c.struct\nsource: original\nnodes: [{name: N, kind: struct}, {name: N, kind: struct}]\ncolour: red\n',
    );
    expect(errors).toMatch(/duplicate node name "N"/);
    expect(errors).toMatch(/unknown key "colour"/);
    expect(parseExpected('kind: c.struct\nsource: original\n').ok).toBe(false);
    expect(parseExpected('').ok).toBe(false);
    expect(parseExpected('kind: [').ok).toBe(false);
  });
});
