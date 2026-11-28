// bash.flowchart (PROMPT.md §7.3), with ISO 5807 shapes: terminators for the
// start, `exit` and `return`; processes (runs of plain commands merged into one
// block); decisions for if/elif, case, loops and `&&`/`||`; I/O for echo,
// printf, read and file redirections; subroutines for calls to project functions.
//
// The graph is built by threading "open ends" through the statements: each
// statement takes the ends that flow into it and returns the ends that flow
// out. `exit` returns none, so nothing is connected after it.
import type { Node } from 'web-tree-sitter';
import type { AnalyzeOptions } from '../types';
import type { Diagnostic, DiagramEdge, DiagramModel, DiagramNode, NodeKind, SourceRef } from '../../model/types';
import { diagnostic, evidence, refOf } from '../shared/evidence';
import { IdPool, edgeId } from '../shared/ids';
import { bodyStatements, commandArgs, commandName, commandsIn, literal, short, statements } from './ast';
import { type Locale, WORDS, conditionLabel, forLabel, isForever, loopLabel, operand } from './labels';
import { type BashFile, type BashFunction, type Project, ifParts } from './project';

interface End {
  from: string;
  label?: string;
}

interface Loop {
  decision: string;
  breaks: End[];
}

/** Text lines shown in a merged block (PROMPT.md §7.3: up to 3 lines). */
const MAX_LINES = 3;

const COMPOUND = new Set([
  'if_statement',
  'case_statement',
  'while_statement',
  'for_statement',
  'c_style_for_statement',
  'compound_statement',
  'subshell',
  'list',
  'pipeline',
]);

/** Redirect targets that are not files a person would draw. */
const NOT_FILES = /^(\/dev\/(null|stdout|stderr|tty|fd\/\d+)|-|\d+)$/;

class Flow {
  readonly nodes: DiagramNode[] = [];
  readonly edges: DiagramEdge[] = [];
  private readonly ids = new IdPool();
  private readonly edgeIds = new IdPool();
  private readonly drawn = new Set<string>();
  /** Merged process/io blocks still open for more lines. */
  private readonly blocks = new Map<string, { kind: NodeKind; lines: string[]; node: DiagramNode }>();
  /** Ends leaving each enclosing subshell through `exit`/`return`, innermost last. */
  private readonly subshells: End[][] = [];
  private readonly w: (typeof WORDS)[Locale];
  private readonly p: Project;
  private readonly file: BashFile;
  private readonly l: Locale;

  constructor(p: Project, file: BashFile, l: Locale) {
    this.p = p;
    this.file = file;
    this.l = l;
    this.w = WORDS[l];
  }

  add(
    kind: NodeKind,
    name: string,
    label: string | undefined,
    ref: SourceRef | undefined,
    rule: string,
    note?: string,
  ) {
    const base = ref ? `${kind}:${ref.file}:${ref.line}` : `${kind}:${name}`;
    const id = this.ids.take(base);
    const node: DiagramNode = { id, kind, name, evidence: [evidence(rule, ref, note)] };
    if (label && label !== name) node.label = label;
    if (ref) node.ref = ref;
    this.nodes.push(node);
    return node;
  }

  connect(ends: readonly End[], to: string, rule = 'bash.flow', ref?: SourceRef) {
    for (const e of ends) {
      // The same arrow twice (two `*)` items, a repeated pattern) is drawn once.
      const key = edgeId('flow', e.from, to, e.label);
      if (this.drawn.has(key)) continue;
      this.drawn.add(key);
      const id = this.edgeIds.take(key);
      const edge: DiagramEdge = {
        id,
        kind: 'flow',
        from: { node: e.from },
        to: { node: to },
        confidence: 1,
        evidence: [evidence(e.label ? 'bash.flow.branch' : rule, ref)],
      };
      if (e.label) edge.label = e.label;
      this.edges.push(edge);
    }
  }

  ref(n: Node): SourceRef {
    return refOf(n, this.file.path);
  }

  seq(stmts: readonly Node[], ends: End[], loops: Loop[]): End[] {
    let cur = ends;
    for (const s of stmts) {
      if (!cur.length) break; // after exit/return/break: unreachable
      cur = this.stmt(s, cur, loops);
    }
    return cur;
  }

  stmt(s: Node, ends: End[], loops: Loop[]): End[] {
    switch (s.type) {
      case 'function_definition':
      case 'comment':
        return ends;
      case 'if_statement':
        return this.ifStmt(s, ends, loops);
      case 'case_statement':
        return this.caseStmt(s, ends, loops);
      case 'while_statement':
        return this.whileStmt(s, ends, loops);
      case 'for_statement':
        return this.forStmt(s, ends, loops);
      case 'c_style_for_statement':
        return this.cForStmt(s, ends, loops);
      case 'compound_statement':
        if (s.children[0]?.type === '((') return this.simple(s, ends, loops);
        return this.seq(statements(s), ends, loops);
      case 'subshell': {
        // `exit` and `return` inside `( ... )` end only the subshell: they flow on after it.
        this.subshells.push([]);
        const out = this.seq(statements(s), ends, loops);
        return [...out, ...this.subshells.pop()!];
      }
      case 'redirected_statement': {
        const body = s.childForFieldName('body');
        if (body && COMPOUND.has(body.type) && !(body.type === 'compound_statement' && body.children[0]?.type === '(('))
          return this.stmt(body, ends, loops);
        return this.simple(s, ends, loops);
      }
      case 'list':
        return this.listStmt(s, ends, loops);
      case 'pipeline':
        return this.pipeline(s, ends, loops);
      default:
        return this.simple(s, ends, loops);
    }
  }

  // ------------------------------------------------------------ decisions

  private decision(label: string, at: Node, rule: string, ends: End[]): string {
    const ref = this.ref(at);
    const d = this.add('decision', label, label, ref, rule, short(at.text, 60));
    this.connect(ends, d.id, 'bash.flow', ref);
    return d.id;
  }

  private ifStmt(s: Node, ends: End[], loops: Loop[]): End[] {
    const parts = ifParts(s);
    const d = this.decision(conditionLabel(parts.cond, this.l), parts.cond.at(-1) ?? s, 'bash.flow.if', ends);
    const out = this.seq(parts.thenBody, [{ from: d, label: this.w.yes }], loops);
    let no: End = { from: d, label: this.w.no };
    for (const e of parts.elifs) {
      const d2 = this.decision(conditionLabel(e.cond, this.l), e.cond.at(-1) ?? e.node, 'bash.flow.elif', [no]);
      out.push(...this.seq(e.body, [{ from: d2, label: this.w.yes }], loops));
      no = { from: d2, label: this.w.no };
    }
    if (parts.elseBody) out.push(...this.seq(parts.elseBody, [no], loops));
    else out.push(no);
    return out;
  }

  private caseStmt(s: Node, ends: End[], loops: Loop[]): End[] {
    const value = s.childForFieldName('value');
    const label = `${value ? operand(value, this.l) : '?'}?`;
    const d = this.decision(label, s, 'bash.flow.case', ends);
    const out: End[] = [];
    let catchAll = false;
    for (const item of s.namedChildren.filter((c) => c.type === 'case_item')) {
      if (catchAll) break; // items after `*)` never run
      const values = item.childrenForFieldName('value');
      const ids = new Set(values.map((v) => v.id));
      const pattern = values.map((v) => v.text).join(' | ');
      if (values.some((v) => v.text === '*')) catchAll = true;
      const body = statements(item).filter((c) => !ids.has(c.id));
      const branch = pattern === '*' ? this.w.other : short(pattern, 24);
      out.push(...this.seq(body, [{ from: d, label: branch }], loops));
    }
    if (!catchAll) out.push({ from: d, label: this.w.other });
    return out;
  }

  private loop(
    label: string,
    at: Node,
    rule: string,
    body: readonly Node[],
    ends: End[],
    loops: Loop[],
    opts: { until?: boolean; forever?: boolean } = {},
  ): End[] {
    const d = this.decision(label, at, rule, ends);
    const loop: Loop = { decision: d, breaks: [] };
    const enter = opts.until ? this.w.no : this.w.yes;
    const leave = opts.until ? this.w.yes : this.w.no;
    const back = this.seq(body, [{ from: d, label: enter }], [...loops, loop]);
    this.connect(back, d, 'bash.flow.loop', this.ref(at));
    return [...(opts.forever ? [] : [{ from: d, label: leave }]), ...loop.breaks];
  }

  private whileStmt(s: Node, ends: End[], loops: Loop[]): End[] {
    const cond = s.childrenForFieldName('condition').filter((c) => c.isNamed);
    const until = s.children[0]?.type === 'until';
    const forever = isForever(cond, until);
    const label = forever
      ? this.l === 'pt'
        ? 'repetir?'
        : 'repeat?'
      : ((until ? undefined : loopLabel(cond, this.l)) ?? conditionLabel(cond, this.l));
    const body = s.childForFieldName('body');
    return this.loop(label, cond.at(-1) ?? s, 'bash.flow.while', body ? statements(body) : [], ends, loops, {
      until,
      forever,
    });
  }

  private forStmt(s: Node, ends: End[], loops: Loop[]): End[] {
    const variable = s.childForFieldName('variable')?.text ?? '?';
    const values = s.childrenForFieldName('value').filter((c) => c.isNamed);
    const label = forLabel(variable, values.map((v) => v.text).join(' ') || '$@', this.l);
    const body = s.childForFieldName('body');
    return this.loop(label, s, 'bash.flow.for', body ? statements(body) : [], ends, loops);
  }

  private cForStmt(s: Node, ends: End[], loops: Loop[]): End[] {
    const cond = s.childForFieldName('condition');
    const label = cond ? `${short(cond.text, 40)}?` : this.l === 'pt' ? 'repetir?' : 'repeat?';
    const body = s.childForFieldName('body');
    return this.loop(label, s, 'bash.flow.for', body ? statements(body) : [], ends, loops, { forever: !cond });
  }

  /** `a && b` runs b when a succeeds; `a || b` when it fails. Both read as a decision on a. */
  private listStmt(s: Node, ends: End[], loops: Loop[]): End[] {
    const [a, b] = s.namedChildren;
    const op = s.children.find((c) => !c.isNamed && (c.type === '&&' || c.type === '||'))?.type;
    if (!a || !b || !op) return this.simple(s, ends, loops);
    const d = this.decision(conditionLabel([a], this.l), a, 'bash.flow.list', ends);
    const run = op === '&&' ? this.w.yes : this.w.no;
    const skip = op === '&&' ? this.w.no : this.w.yes;
    return [...this.stmt(b, [{ from: d, label: run }], loops), { from: d, label: skip }];
  }

  /** A pipeline ending in a loop (`ls | while read f; do ...; done`): the commands, then the loop. */
  private pipeline(s: Node, ends: End[], loops: Loop[]): End[] {
    const parts = s.namedChildren;
    const k = parts.findIndex((c) => COMPOUND.has(c.type) && c.type !== 'pipeline');
    if (k < 0) return this.simple(s, ends, loops);
    let cur = ends;
    if (k > 0)
      cur = this.simple(
        s,
        cur,
        loops,
        parts
          .slice(0, k)
          .map((c) => c.text)
          .join(' | '),
      );
    for (const c of parts.slice(k)) if (cur.length) cur = this.stmt(c, cur, loops);
    return cur;
  }

  // ------------------------------------------------------------ simple statements

  private simple(s: Node, ends: End[], loops: Loop[], text = s.text): End[] {
    const ref = this.ref(s);
    const cmd = mainCommand(s);
    const name = cmd && commandName(cmd);

    if ((name === 'exit' || name === 'return') && this.subshells.length) {
      this.subshells.at(-1)!.push(...ends);
      return [];
    }
    if (name === 'exit' || name === 'return') {
      const arg = cmd && commandArgs(cmd)[0]?.text;
      const word = name === 'exit' ? this.w.end : this.l === 'pt' ? 'Retorna' : 'Return';
      const label = name === 'exit' ? `${word} (exit${arg ? ` ${arg}` : ''})` : `${word}${arg ? ` ${arg}` : ''}`;
      const t = this.add('terminator', `${name}${arg ? ` ${arg}` : ''}`, label, ref, `bash.flow.${name}`);
      this.connect(ends, t.id, 'bash.flow', ref);
      return [];
    }
    if ((name === 'break' || name === 'continue') && loops.length) {
      // `break 2` / `continue 2` act on the second enclosing loop (the outermost when N is larger).
      const arg = cmd && commandArgs(cmd)[0];
      const n = arg ? Number(literal(arg)) : 1;
      const depth = Number.isInteger(n) && n > 1 ? Math.min(n, loops.length) : 1;
      const loop = loops[loops.length - depth]!;
      if (name === 'break') loop.breaks.push(...ends);
      else this.connect(ends, loop.decision, 'bash.flow.continue', ref);
      return [];
    }
    // Declarations without a value (`local x y`) and no-ops draw nothing.
    if (s.type === 'declaration_command' && !s.namedChildren.some((c) => c.type === 'variable_assignment')) return ends;
    if (name === ':' || name === 'true') {
      if (!s.namedChildren.some((c) => c.type.endsWith('redirect'))) return ends;
    }

    const call = this.projectCall(s, cmd, name);
    if (call) {
      const label = cmd && name === call.name ? call.name : `${short(text, 28)}`;
      const sub = this.add(
        'subroutine',
        call.name,
        label,
        ref,
        'bash.flow.call',
        `calls ${call.name} (${call.file.path})`,
      );
      this.connect(ends, sub.id, 'bash.flow', ref);
      if (this.p.neverReturns(call)) {
        sub.evidence!.push(evidence('bash.flow.noreturn', call.ref, `${call.name} always ends the script`));
        // The path ends here, so draw where it ends: `Erro (exit 2)` after a `die`-style call.
        const code = exitCodeOf(call);
        const word = code && code !== '0' ? (this.l === 'pt' ? 'Erro' : 'Error') : this.w.end;
        const endLabel = `${word}${code ? ` (exit ${code})` : ''}`;
        const t = this.add('terminator', `exit ${code ?? ''}`.trim(), endLabel, ref, 'bash.flow.noreturn');
        this.connect([{ from: sub.id }], t.id, 'bash.flow', ref);
        return [];
      }
      return [{ from: sub.id }];
    }

    const io = this.ioLine(s, cmd, name, text);
    const kind: NodeKind = io ? 'io' : 'process';
    const line = io ?? short(text, 36);
    const open = ends.length === 1 && !ends[0]!.label ? this.blocks.get(ends[0]!.from) : undefined;
    if (open && open.kind === kind) {
      open.lines.push(line);
      open.node.label = blockLabel(open.lines);
      open.node.evidence!.push(evidence(`bash.flow.${kind}`, ref, 'merged with the commands before it'));
      if (open.node.ref) open.node.ref = { ...open.node.ref, endLine: ref.endLine ?? ref.line };
      return ends;
    }
    const n = this.add(kind, line, line, ref, `bash.flow.${kind}`);
    this.blocks.set(n.id, { kind, lines: [line], node: n });
    this.connect(ends, n.id, 'bash.flow', ref);
    return [{ from: n.id }];
  }

  /** The project function a statement calls: its own command, or one inside `$(...)`. */
  private projectCall(s: Node, cmd: Node | undefined, name: string | undefined): BashFunction | undefined {
    if (cmd && name) {
      const r = this.p.resolve(name, this.file);
      if (r) return r.fn;
    }
    for (const c of commandsIn(s)) {
      const n = commandName(c);
      if (!n) continue;
      const r = this.p.resolve(n, this.file);
      if (r) return r.fn;
    }
    return undefined;
  }

  /** The I/O text for echo/printf/read and for commands that write or read a file; undefined otherwise. */
  private ioLine(s: Node, cmd: Node | undefined, name: string | undefined, text: string): string | undefined {
    const pt = this.l === 'pt';
    const redirects = s.type === 'redirected_statement' ? s.childrenForFieldName('redirect') : [];
    // `cat <<EOF > out` nests the file redirect inside the heredoc one.
    const files = redirects
      .flatMap((r) => (r.type === 'heredoc_redirect' ? r.namedChildren : [r]))
      .filter((r) => r.type === 'file_redirect')
      .map((r) => ({ op: r.children.find((c) => !c.isNamed)?.type ?? '', dest: r.childForFieldName('destination') }))
      .filter((r) => r.dest && !r.op.endsWith('&') && !NOT_FILES.test(literal(r.dest) ?? r.dest.text));
    const out = files.find((r) => r.op.startsWith('>') || r.op.startsWith('&>'));
    const target = out?.dest ? operand(out.dest, this.l) : undefined;
    const args = cmd
      ? commandArgs(cmd)
          .map((a) => a.text)
          .filter((a, i) => !(i === 0 && name === 'echo' && /^-[neE]+$/.test(a)))
      : [];
    if (name === 'echo' || name === 'printf') {
      const what = short(args.join(' '), 30) || '""';
      if (target) return pt ? `Escrever ${what} em ${target}` : `Write ${what} to ${target}`;
      return pt ? `Mostrar ${what}` : `Show ${what}`;
    }
    if (name === 'read' || name === 'mapfile' || name === 'readarray') {
      const vars = args.filter((a) => !a.startsWith('-')).join(', ');
      return pt ? `Ler ${vars || 'linha'}` : `Read ${vars || 'line'}`;
    }
    if (
      s.type === 'redirected_statement' &&
      s.childrenForFieldName('redirect').some((r) => r.type === 'heredoc_redirect')
    ) {
      const what = name ?? 'heredoc';
      if (target) return pt ? `Escrever texto (${what}) em ${target}` : `Write text (${what}) to ${target}`;
      return pt ? `Mostrar texto (${what})` : `Show text (${what})`;
    }
    if (files.length) return short(text, 36);
    return undefined;
  }
}

/** The command a simple statement runs (through redirections, `!` and `local x=$(...)`). */
function mainCommand(s: Node): Node | undefined {
  if (s.type === 'command') return s;
  if (s.type === 'redirected_statement' || s.type === 'negated_command') {
    const body = s.childForFieldName('body') ?? s.namedChildren[0];
    return body ? mainCommand(body) : undefined;
  }
  return undefined;
}

/** The exit status a never-returning function ends with, when all its `exit N` agree. */
function exitCodeOf(fn: BashFunction): string | undefined {
  const codes = new Set<string>();
  for (const def of fn.defs) {
    for (const cmd of def.descendantsOfType('command')) {
      if (!cmd || commandName(cmd) !== 'exit') continue;
      const arg = commandArgs(cmd)[0];
      codes.add(arg ? (literal(arg) ?? arg.text) : '');
    }
  }
  const [only] = codes;
  return codes.size === 1 && only ? only : undefined;
}

function blockLabel(lines: readonly string[]): string {
  if (lines.length <= MAX_LINES) return lines.join('\n');
  return [...lines.slice(0, MAX_LINES - 1), `… (+${lines.length - MAX_LINES + 1})`].join('\n');
}

interface Entry {
  file: BashFile;
  stmts: Node[];
  title: string;
  ref: SourceRef;
  fn?: BashFunction;
}

/** Top-level statements that run when the file runs (function definitions do not). */
function topLevel(f: BashFile): Node[] {
  return statements(f.root).filter((s) => s.type !== 'function_definition');
}

/** Finds the flowchart's entry: `script` (default), a file name, a function name or `file:function`. */
function pickEntry(p: Project, entry: string | undefined, diags: Diagnostic[]): Entry | undefined {
  const asScript = (f: BashFile): Entry => ({
    file: f,
    stmts: topLevel(f),
    title: f.name,
    ref: { file: f.path, line: 1 },
  });
  const asFunction = (fn: BashFunction): Entry => ({
    file: fn.file,
    stmts: bodyStatements(fn.defs[0]!),
    title: fn.name,
    ref: fn.ref,
    fn,
  });
  if (!entry || entry === 'script') {
    const runnable = p.files.filter((f) => topLevel(f).length);
    // Scripts nobody sources, the ones nearest the project root first (tests/ and tools/ go last).
    const depth = (f: BashFile) => f.path.split('/').length;
    const mains = runnable.filter((f) => !p.sources.some((s) => s.to === f)).sort((a, b) => depth(a) - depth(b));
    const pick = mains[0] ?? runnable[0] ?? p.files[0];
    if (!pick) return undefined;
    if (mains.length > 1)
      diags.push(
        diagnostic(
          'info',
          `flowchart of ${pick.path}; the project has ${mains.length} scripts, pick another with entry (file name)`,
        ),
      );
    return asScript(pick);
  }
  const file = p.files.find((f) => f.path === entry || f.name === entry);
  if (file) return asScript(file);
  // A function name may itself hold `::` (`log::init`), so the whole entry is tried as a name first,
  // and `file:function` splits at the first colon.
  const colon = p.byName.has(entry) ? -1 : entry.indexOf(':');
  const [where, fname] = colon > 0 ? [entry.slice(0, colon), entry.slice(colon + 1)] : [undefined, entry];
  const fns = (p.byName.get(fname) ?? []).filter((f) => !where || f.file.path === where || f.file.name === where);
  if (!fns.length) {
    diags.push(diagnostic('error', `entry ${entry} is neither a function nor a script of the project`));
    return undefined;
  }
  if (fns.length > 1)
    diags.push(
      diagnostic(
        'warn',
        `function ${fname} is defined in ${fns.map((f) => f.file.path).join(', ')}; using ${fns[0]!.file.path} (write entry as file:function)`,
        fns[0]!.ref,
      ),
    );
  return asFunction(fns[0]!);
}

export function flowchart(p: Project, opts: AnalyzeOptions): DiagramModel {
  const diagnostics: Diagnostic[] = [];
  const l: Locale = opts.locale ?? 'pt';
  const entry = pickEntry(p, opts.entry, diagnostics);
  if (!entry) return { lang: 'bash', kind: 'bash.flowchart', nodes: [], edges: [], diagnostics };
  const flow = new Flow(p, entry.file, l);
  const w = WORDS[l];
  const startLabel = entry.fn ? `${w.start}: ${entry.fn.name}` : w.start;
  const start = flow.add('terminator', 'start', startLabel, entry.ref, 'bash.flow.start', entry.title);
  start.id = 'terminator:start';
  const ends = flow.seq(entry.stmts, [{ from: start.id }], []);
  if (ends.length) {
    const last = entry.stmts.at(-1);
    const ref = last ? refOf(last, entry.file.path) : entry.ref;
    const end = flow.add(
      'terminator',
      'end',
      w.end,
      { file: ref.file, line: ref.endLine ?? ref.line },
      'bash.flow.end',
    );
    end.id = 'terminator:end';
    flow.connect(ends, end.id, 'bash.flow', end.ref);
  }
  return {
    lang: 'bash',
    kind: 'bash.flowchart',
    title: entry.title,
    nodes: flow.nodes,
    edges: flow.edges,
    diagnostics,
  };
}
