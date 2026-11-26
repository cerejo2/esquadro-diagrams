import { describe, expect, it } from 'vitest';
import type { DiagramEdge, DiagramModel, DiagramNode } from '../model/types';
import { compareModel, score } from './compare';
import { parseExpected } from './expected';

const node = (name: string, kind: DiagramNode['kind'] = 'class', extra: Partial<DiagramNode> = {}): DiagramNode => ({
  id: `${kind}:${name}`,
  kind,
  name,
  ...extra,
});

const edge = (
  kind: DiagramEdge['kind'],
  from: string,
  to: string,
  toEnd: Partial<DiagramEdge['to']> = {},
): DiagramEdge => ({
  id: `${kind}:${from}->${to}`,
  kind,
  from: { node: `class:${from}` },
  to: { node: to.startsWith('interface') ? to : `class:${to}`, ...toEnd },
  confidence: 1,
  evidence: [{ rule: 'test' }],
});

const expectedYaml = `
kind: java.class
source: diagram
nodes:
  - name: EmployeeInterface
    kind: interface
    operations: ["+ work(): void"]
  - { name: Employee, kind: class }
  - name: EmployeeDecorator
    kind: abstract
    attributes: ["# employee: EmployeeInterface"]
edges:
  - { kind: realization, from: Employee, to: EmployeeInterface }
  - { kind: aggregation, from: EmployeeDecorator, to: EmployeeInterface, role: employee, multiplicity: "1" }
`;

function expected() {
  const v = parseExpected(expectedYaml);
  if (!v.ok) throw new Error(v.errors.join('\n'));
  return v.value;
}

const perfect: DiagramModel = {
  lang: 'java',
  kind: 'java.class',
  nodes: [
    node('EmployeeInterface', 'interface', {
      operations: [{ name: 'work', visibility: '+', params: [], returns: 'void' }],
    }),
    node('Employee'),
    node('EmployeeDecorator', 'abstract', {
      attributes: [{ name: 'employee', type: 'EmployeeInterface', visibility: '#' }],
    }),
  ],
  edges: [
    { ...edge('realization', 'Employee', 'x'), to: { node: 'interface:EmployeeInterface' } },
    {
      ...edge('aggregation', 'x', 'y'),
      from: { node: 'abstract:EmployeeDecorator' },
      to: { node: 'interface:EmployeeInterface', role: 'employee', multiplicity: '1' },
    },
  ],
  diagnostics: [],
};

describe('compareModel', () => {
  it('scores a perfect model at 100%', () => {
    const s = compareModel(perfect, expected());
    expect(s.nodes?.f1).toBe(1);
    expect(s.edgesStrict?.f1).toBe(1);
    expect(s.edgesRelaxed?.f1).toBe(1);
    expect(s.members?.f1).toBe(1);
    expect(s.roles?.accuracy).toBe(1);
    expect(s.multiplicities?.accuracy).toBe(1);
    expect(s.misses).toEqual([]);
  });

  it('counts composition-for-aggregation as a strict miss but a relaxed hit', () => {
    const model = structuredClone(perfect);
    model.edges[1]!.kind = 'composition';
    const s = compareModel(model, expected());
    expect(s.edgesStrict).toMatchObject({ tp: 1, fp: 1, fn: 1 });
    expect(s.edgesRelaxed?.f1).toBe(1);
    expect(s.roles?.accuracy).toBe(1);
  });

  it('matches a plain association in either direction', () => {
    const v = parseExpected(`
kind: java.class
source: original
nodes: [{ name: A, kind: class }, { name: B, kind: class }]
edges: [{ kind: association, from: A, to: B, role: b, multiplicity: "*" }]
`);
    if (!v.ok) throw new Error(v.errors.join());
    const model: DiagramModel = {
      lang: 'java',
      kind: 'java.class',
      nodes: [node('A'), node('B')],
      edges: [
        {
          ...edge('association', 'B', 'A'),
          from: { node: 'class:B', role: 'b', multiplicity: '*' },
          to: { node: 'class:A' },
        },
      ],
      diagnostics: [],
    };
    const s = compareModel(model, v.value);
    expect(s.edgesStrict?.f1).toBe(1);
    expect(s.roles?.accuracy).toBe(1);
    expect(s.multiplicities?.accuracy).toBe(1);
  });

  it('reports missing and extra nodes', () => {
    const model = structuredClone(perfect);
    model.nodes.pop();
    model.nodes.push(node('Ghost'));
    const s = compareModel(model, expected());
    expect(s.nodes).toMatchObject({ tp: 2, fp: 1, fn: 1 });
    expect(s.misses).toContain('missing node abstract:EmployeeDecorator');
    expect(s.misses).toContain('extra node class:Ghost');
  });

  it('ignores whitespace differences in members', () => {
    const model = structuredClone(perfect);
    const v = parseExpected(expectedYaml.replace('+ work(): void', '+work( ) :void'));
    if (!v.ok) throw new Error(v.errors.join());
    expect(compareModel(model, v.value).members?.f1).toBe(1);
  });

  it('compares SQL names case-insensitively and scores columns', () => {
    const v = parseExpected(`
kind: sql.relational
source: self-made
nodes: [{ name: EMPLOYEE, kind: table }, { name: DEPARTMENT, kind: table }]
edges: [{ kind: foreign-key, from: EMPLOYEE, to: DEPARTMENT, fromColumn: Dno, toColumn: Dnumber }]
`);
    if (!v.ok) throw new Error(v.errors.join());
    const model: DiagramModel = {
      lang: 'sql',
      kind: 'sql.relational',
      nodes: [node('employee', 'table'), node('Department', 'table')],
      edges: [
        {
          id: 'fk',
          kind: 'foreign-key',
          from: { node: 'table:employee', column: 'dno' },
          to: { node: 'table:Department', column: 'Dnumber' },
          confidence: 1,
          evidence: [{ rule: 'fk' }],
        },
      ],
      diagnostics: [],
    };
    const s = compareModel(model, v.value);
    expect(s.nodes?.f1).toBe(1);
    expect(s.edgesStrict?.f1).toBe(1);
    expect(s.columns?.accuracy).toBe(1);
  });

  it('scores counts and the flowchart call sequence', () => {
    const v = parseExpected(`
kind: bash.flowchart
source: diagram
counts: { nodes: { decision: 2, subroutine: 3 }, edges: { flow: 6 } }
calls: [parse_args, check, run]
`);
    if (!v.ok) throw new Error(v.errors.join());
    const sub = (name: string, line: number) => node(name, 'subroutine', { ref: { file: 'vp', line } });
    const model: DiagramModel = {
      lang: 'bash',
      kind: 'bash.flowchart',
      nodes: [node('d1', 'decision'), sub('run', 30), sub('parse_args', 3), sub('check', 10)],
      edges: [],
      diagnostics: [],
    };
    const s = compareModel(model, v.value);
    expect(s.calls?.f1).toBe(1);
    // decisions 1 of 2, subroutines 3 of 3, flows 0 of 6 → (1+3+0)/(2+3+6)
    expect(s.counts?.accuracy).toBeCloseTo(4 / 11);
  });

  it('gives an empty model zero recall', () => {
    const s = compareModel({ lang: 'java', kind: 'java.class', nodes: [], edges: [], diagnostics: [] }, expected());
    expect(s.nodes).toEqual(score(0, 0, 3));
    expect(s.nodes?.f1).toBe(0);
  });
});
