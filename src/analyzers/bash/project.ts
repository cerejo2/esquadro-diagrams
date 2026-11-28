// The parsed project: files, the functions each one defines, which file
// sources which, and how a command name resolves to a project function.
import type { Node } from 'web-tree-sitter';
import type { Diagnostic, SourceRef } from '../../model/types';
import { diagnostic, refOf } from '../shared/evidence';
import { nodeId } from '../shared/ids';
import {
  bodyStatements,
  commandArgs,
  commandName,
  functionName,
  functionsIn,
  literal,
  statements,
  unquote,
} from './ast';

export interface BashFile {
  path: string;
  /** File name without folders: the script node's name (`backup.sh`, `setup`). */
  name: string;
  dir: string;
  root: Node;
}

export interface BashFunction {
  name: string;
  file: BashFile;
  /** Every definition of this name in the file (a redefinition adds to the first). */
  defs: Node[];
  id: string;
  ref: SourceRef;
}

export interface SourceLink {
  from: BashFile;
  to: BashFile;
  ref: SourceRef;
  rule: string;
  confidence: number;
  note?: string;
}

export interface Resolved {
  fn: BashFunction;
  rule: string;
  confidence: number;
  note?: string;
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const dirName = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** Joins and normalizes a relative path (`a/./b/../c` → `a/c`); undefined if it climbs out of the project. */
function joinPath(dir: string, rel: string): string | undefined {
  const parts = (dir ? `${dir}/${rel}` : rel).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (!out.length) return undefined;
      out.pop();
    } else out.push(p);
  }
  return out.join('/');
}

export class Project {
  readonly functions: BashFunction[] = [];
  readonly byName = new Map<string, BashFunction[]>();
  readonly sources: SourceLink[] = [];
  readonly diagnostics: Diagnostic[] = [];
  private readonly byPath = new Map<string, BashFile>();
  private readonly byDef = new Map<number, BashFunction>();
  private readonly noreturn = new Set<BashFunction>();
  // Filled lazily by resolve, which only runs once every source link is known.
  private readonly sourcedCache = new Map<BashFile, Set<BashFile>>();
  private readonly sourcersCache = new Map<BashFile, Set<BashFile>>();
  private readonly allFiles: Set<BashFile>;
  private links?: { down: Map<BashFile, BashFile[]>; up: Map<BashFile, BashFile[]> };

  readonly files: BashFile[];

  constructor(files: BashFile[]) {
    this.files = files;
    this.allFiles = new Set(files);
    for (const f of files) this.byPath.set(f.path, f);
    for (const f of files) this.collectFunctions(f);
    for (const f of files) this.collectSources(f);
    this.findNoReturn();
  }

  scriptId(f: BashFile): string {
    return nodeId('script', f.path);
  }

  file(path: string): BashFile | undefined {
    return this.byPath.get(path);
  }

  /** The function whose body contains `n`, or undefined for top-level code. */
  ownerOf(n: Node): BashFunction | undefined {
    for (let p = n.parent; p; p = p.parent) if (p.type === 'function_definition') return this.byDef.get(p.id);
    return undefined;
  }

  functionOf(def: Node): BashFunction | undefined {
    return this.byDef.get(def.id);
  }

  /** True when the function always ends the script (`exit` on every path, or a call to one that does). */
  neverReturns(fn: BashFunction): boolean {
    return this.noreturn.has(fn);
  }

  /**
   * Resolves a command name used in `from` to a project function. Bash functions
   * are global, so the search goes from the most to the least likely definition:
   * the same file and the files it sources; the files that source it (a library
   * calling back into its caller); then any file of the project.
   */
  resolve(name: string, from: BashFile): Resolved | undefined {
    const all = this.byName.get(name);
    if (!all?.length) return undefined;
    const same = all.find((f) => f.file === from);
    if (same) return { fn: same, rule: 'bash.call', confidence: 1 };
    const tiers: [Set<BashFile>, string, number, string][] = [
      [this.sourcedBy(from), 'bash.call.sourced', 1, 'defined in a sourced file'],
      [this.sourcersOf(from), 'bash.call.caller', 0.9, 'defined in a script that sources this file'],
      [this.allFiles, 'bash.call.global', 0.6, 'defined in another file that this one does not source'],
    ];
    for (const [scope, rule, confidence, note] of tiers) {
      const hits = all.filter((f) => scope.has(f.file));
      if (!hits.length) continue;
      if (hits.length === 1) return { fn: hits[0]!, rule, confidence, note: `${note} (${hits[0]!.file.path})` };
      return {
        fn: hits[0]!,
        rule,
        confidence: confidence / 2,
        note: `${name} is defined in ${hits.map((h) => h.file.path).join(', ')}; the first one is used`,
      };
    }
    return undefined;
  }

  /** The files `f` sources, directly or through others (cached: resolve asks on every call). */
  sourcedBy(f: BashFile): Set<BashFile> {
    const hit = this.sourcedCache.get(f);
    if (hit) return hit;
    this.links ??= this.indexLinks();
    const out = closure(f, this.links.down);
    this.sourcedCache.set(f, out);
    return out;
  }

  /** The files that source `f`, directly or through others (cached like sourcedBy). */
  sourcersOf(f: BashFile): Set<BashFile> {
    const hit = this.sourcersCache.get(f);
    if (hit) return hit;
    this.links ??= this.indexLinks();
    const out = closure(f, this.links.up);
    this.sourcersCache.set(f, out);
    return out;
  }

  /** Source links by file, both ways, built once all of them are known. */
  private indexLinks() {
    const down = new Map<BashFile, BashFile[]>();
    const up = new Map<BashFile, BashFile[]>();
    for (const s of this.sources) {
      down.set(s.from, [...(down.get(s.from) ?? []), s.to]);
      up.set(s.to, [...(up.get(s.to) ?? []), s.from]);
    }
    return { down, up };
  }

  /** A project script run by path (`./other.sh`, `bash other.sh`), resolved from the caller's folder. */
  scriptAt(rel: string, from: BashFile): BashFile | undefined {
    const p = joinPath(from.dir, rel);
    return p === undefined ? undefined : this.byPath.get(p);
  }

  private collectFunctions(file: BashFile): void {
    const seen = new Map<string, BashFunction>();
    for (const def of functionsIn(file.root)) {
      const name = functionName(def);
      if (!name) continue;
      const ref = refOf(def, file.path);
      const prev = seen.get(name);
      if (prev) {
        prev.defs.push(def);
        this.byDef.set(def.id, prev);
        this.diagnostics.push(
          diagnostic('info', `function ${name} is defined again in ${file.path}; both bodies are analyzed`, ref),
        );
        continue;
      }
      const fn: BashFunction = { name, file, defs: [def], id: nodeId('function', `${file.path}#${name}`), ref };
      seen.set(name, fn);
      this.byDef.set(def.id, fn);
      this.functions.push(fn);
      const list = this.byName.get(name) ?? [];
      list.push(fn);
      this.byName.set(name, list);
    }
  }

  /** `source x` and `. x` with a literal path become links; a path with a variable is guessed or reported. */
  private collectSources(file: BashFile): void {
    for (const cmd of file.root.descendantsOfType('command')) {
      if (!cmd) continue;
      const name = commandName(cmd);
      if (name !== 'source' && name !== '.') continue;
      const arg = commandArgs(cmd)[0];
      const ref = refOf(cmd, file.path);
      if (!arg) continue;
      const lit = literal(arg);
      if (lit !== undefined) {
        const exact = this.findSourced(lit, file);
        if (exact) {
          this.sources.push({ from: file, to: exact, ref, rule: 'bash.source', confidence: 1 });
          continue;
        }
        const guess = this.byBaseName(baseName(lit), file);
        if (guess) {
          this.sources.push({
            from: file,
            to: guess,
            ref,
            rule: 'bash.source.basename',
            confidence: 0.7,
            note: `${lit} is not at that path in the project; matched by file name`,
          });
        } else {
          this.diagnostics.push(diagnostic('info', `sourced file ${lit} is not in the project`, ref));
        }
        continue;
      }
      // A path built from a variable or a substitution: guess from its literal tail.
      const text = unquote(arg);
      const tail = /[^$})"'`]*$/.exec(text)?.[0].replace(/^\/+/, '') ?? '';
      const guess = tail ? (this.findSourced(tail, file) ?? this.byBaseName(baseName(tail), file)) : undefined;
      if (guess) {
        this.sources.push({
          from: file,
          to: guess,
          ref,
          rule: 'bash.source.dynamic',
          confidence: 0.6,
          note: `path ${text} depends on a variable; ${guess.path} matches its literal end`,
        });
        this.diagnostics.push(
          diagnostic('warn', `source path ${text} depends on a variable; guessed ${guess.path}`, ref),
        );
      } else {
        this.diagnostics.push(diagnostic('warn', `source path ${text} depends on a variable; not followed`, ref));
      }
    }
  }

  private findSourced(p: string, from: BashFile): BashFile | undefined {
    if (p.startsWith('/')) return undefined;
    const local = joinPath(from.dir, p);
    if (local !== undefined && this.byPath.has(local)) return this.byPath.get(local);
    const rooted = joinPath('', p);
    return rooted !== undefined ? this.byPath.get(rooted) : undefined;
  }

  private byBaseName(name: string, from: BashFile): BashFile | undefined {
    if (!name) return undefined;
    const hits = this.files.filter((f) => f.name === name && f !== from);
    return hits.length === 1 ? hits[0] : undefined;
  }

  // ------------------------------------------------------------ functions that never return

  private findNoReturn(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const fn of this.functions) {
        if (this.noreturn.has(fn)) continue;
        // `f() ( ...; exit 1 )`: the body runs in a subshell, so its exit only ends that subshell.
        const exits = (d: Node) =>
          d.childForFieldName('body')?.type !== 'subshell' && this.alwaysExits(bodyStatements(d), fn.file);
        if (fn.defs.some(exits)) {
          this.noreturn.add(fn);
          changed = true;
        }
      }
    }
  }

  /** True when running these statements always ends the script. */
  alwaysExits(stmts: readonly Node[], file: BashFile): boolean {
    return stmts.some((s) => this.statementExits(s, file));
  }

  private statementExits(s: Node, file: BashFile): boolean {
    switch (s.type) {
      case 'redirected_statement': {
        const body = s.childForFieldName('body');
        return !!body && this.statementExits(body, file);
      }
      case 'compound_statement':
        return this.alwaysExits(statements(s), file);
      case 'command': {
        const name = commandName(s);
        if (!name) return false;
        if (name === 'exit') return true;
        if (name === 'exec') return commandArgs(s).length > 0;
        const fn = this.resolve(name, file);
        return !!fn && fn.confidence === 1 && this.noreturn.has(fn.fn);
      }
      case 'if_statement': {
        const parts = ifParts(s);
        if (!parts.elseBody) return false;
        return (
          this.alwaysExits(parts.thenBody, file) &&
          parts.elifs.every((e) => this.alwaysExits(e.body, file)) &&
          this.alwaysExits(parts.elseBody, file)
        );
      }
      default:
        return false;
    }
  }
}

/** Every file reachable from `f` along `next`, without `f` itself. */
function closure(f: BashFile, next: Map<BashFile, BashFile[]>): Set<BashFile> {
  const out = new Set<BashFile>();
  const todo = [f];
  while (todo.length)
    for (const to of next.get(todo.pop()!) ?? [])
      if (to !== f && !out.has(to)) {
        out.add(to);
        todo.push(to);
      }
  return out;
}

export interface IfParts {
  cond: Node[];
  thenBody: Node[];
  elifs: { node: Node; cond: Node[]; body: Node[] }[];
  elseBody?: Node[];
}

/** Splits `if c; then a; elif d; then b; else e; fi` into its conditions and bodies. */
export function ifParts(n: Node): IfParts {
  const { cond, body } = condAndBody(n);
  const out: IfParts = { cond, thenBody: body, elifs: [] };
  for (const c of n.namedChildren) {
    if (c.type === 'elif_clause') out.elifs.push({ node: c, ...condAndBody(c) });
    else if (c.type === 'else_clause') out.elseBody = statements(c);
  }
  return out;
}

/** The statements before `then` (the condition) and after it, up to elif/else/fi. */
function condAndBody(n: Node): { cond: Node[]; body: Node[] } {
  const cond: Node[] = [];
  const body: Node[] = [];
  let afterThen = false;
  for (const c of n.children) {
    if (!c.isNamed) {
      if (c.type === 'then') afterThen = true;
      continue;
    }
    if (c.type === 'comment' || c.type === 'elif_clause' || c.type === 'else_clause') continue;
    (afterThen ? body : cond).push(c);
  }
  return { cond, body };
}

export function makeFile(path: string, root: Node): BashFile {
  return { path, name: baseName(path), dir: dirName(path), root };
}
