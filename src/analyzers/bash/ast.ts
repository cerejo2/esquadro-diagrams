// Small helpers over tree-sitter-bash nodes: statement lists, command names,
// literal words and the walk that finds every command run by a piece of code.
import type { Node } from 'web-tree-sitter';

/** Statement-level node types that are not code to run. */
const SKIP = new Set(['comment', 'heredoc_body', 'heredoc_end', 'heredoc_start']);

/** Named, non-comment children: the statements of a block. */
export function statements(n: Node): Node[] {
  return n.namedChildren.filter((c) => !SKIP.has(c.type));
}

/** The statements a function body runs (`{ ... }`, `( ... )` or a single compound command). */
export function bodyStatements(fn: Node): Node[] {
  const body = fn.childForFieldName('body');
  if (!body) return [];
  if (body.type === 'compound_statement' || body.type === 'subshell') return statements(body);
  return [body];
}

/** The name of a function_definition (`f`, from `f() {}`, `function f {}` or `function f() {}`). */
export function functionName(fn: Node): string | undefined {
  return fn.childForFieldName('name')?.text;
}

function rawName(cmd: Node): string | undefined {
  const name = cmd.childForFieldName('name');
  if (!name) return undefined;
  const inner = name.namedChildren[0];
  if (!inner) return undefined;
  return literal(inner);
}

/**
 * `time [-p] cmd args` is the keyword `time` in front of a command; tree-sitter-bash
 * reads it as a command named `time`. The index of the real command among the
 * arguments, or -1 when there is none (bare `time`) or it is not that prefix.
 */
function timedIndex(cmd: Node, args: Node[]): number {
  // `coproc cmd args` is the same kind of prefix (the `coproc NAME { ... }` form is misparsed by the grammar).
  const prefix = rawName(cmd);
  if (prefix !== 'time' && prefix !== 'coproc') return -1;
  if (prefix === 'coproc' && args.some((a) => a.text === '{')) return -1;
  return args.findIndex((a) => {
    const t = literal(a);
    return t !== '-p' && t !== '--';
  });
}

/** The literal command name of a `command` node, or undefined when it is dynamic (`$cmd`, `"$@"`). */
export function commandName(cmd: Node): string | undefined {
  const raw = rawName(cmd);
  const args = cmd.childrenForFieldName('argument').filter((a) => a.isNamed);
  const i = timedIndex(cmd, args);
  return i < 0 ? raw : literal(args[i]!);
}

/** The arguments of a `command` node (no redirects, no assignments in front, no `time` prefix). */
export function commandArgs(cmd: Node): Node[] {
  const args = cmd.childrenForFieldName('argument').filter((a) => a.isNamed);
  const i = timedIndex(cmd, args);
  return i < 0 ? args : args.slice(i + 1);
}

/**
 * The text of a word, number or quoted string with no expansions in it, with the
 * quotes removed; undefined when the value depends on a variable or a substitution.
 */
export function literal(n: Node): string | undefined {
  switch (n.type) {
    case 'word':
    case 'number':
    case 'extglob_pattern':
      return n.text.replace(/\\(.)/g, '$1');
    case 'raw_string':
      return n.text.slice(1, -1);
    case 'string': {
      if (n.namedChildren.some((c) => c.type !== 'string_content')) return undefined;
      return n.text.slice(1, -1);
    }
    case 'concatenation': {
      let out = '';
      for (const c of n.namedChildren) {
        const part = literal(c);
        if (part === undefined) return undefined;
        out += part;
      }
      return out;
    }
    default:
      return undefined;
  }
}

/** Removes the outer quotes of a string or raw string, keeping `$var` as written. */
export function unquote(n: Node): string {
  if (n.type === 'raw_string' || n.type === 'string') return n.text.slice(1, -1);
  return n.text;
}

/**
 * Every `command` node a subtree runs, in source order, including the ones in
 * `$(...)`, `<(...)`, pipelines and lists, but not the bodies of functions
 * defined inside it (those run when the function is called).
 */
export function commandsIn(n: Node): Node[] {
  const out: Node[] = [];
  const visit = (x: Node) => {
    if (x.type === 'function_definition') return;
    if (x.type === 'command') out.push(x);
    for (const c of x.namedChildren) visit(c);
  };
  visit(n);
  return out;
}

/** Every function_definition in a file, nested ones included, in source order. */
export function functionsIn(root: Node): Node[] {
  return root.descendantsOfType('function_definition').filter((n): n is Node => !!n);
}

/** One line of a node's text, squeezed and cut to `max` characters with an ellipsis. */
export function short(text: string, max = 40): string {
  const one = text
    .replace(/\\\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** Shell builtins and keywords run as commands: never project functions, never external programs. */
// prettier-ignore
export const BUILTINS = new Set([
  '.', ':', '[', 'alias', 'bg', 'bind', 'break', 'builtin', 'caller', 'cd', 'command', 'compgen', 'complete',
  'compopt', 'continue', 'declare', 'dirs', 'disown', 'echo', 'enable', 'eval', 'exec', 'exit', 'export', 'false',
  'fc', 'fg', 'getopts', 'hash', 'help', 'history', 'jobs', 'kill', 'let', 'local', 'logout', 'mapfile', 'popd',
  'printf', 'pushd', 'pwd', 'read', 'readarray', 'readonly', 'return', 'set', 'shift', 'shopt', 'source', 'suspend',
  'test', 'times', 'trap', 'true', 'type', 'typeset', 'ulimit', 'umask', 'unalias', 'unset', 'wait',
  // keywords tree-sitter-bash reads as commands
  'time', 'coproc',
  // zsh builtins (zsh scripts are detected too)
  'autoload', 'bindkey', 'compdef', 'emulate', 'float', 'functions', 'integer', 'noglob', 'print', 'rehash',
  'setopt', 'unsetopt', 'vared', 'whence', 'zle', 'zmodload', 'zparseopts', 'zstyle',
]);
