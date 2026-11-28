// Human labels for the flowchart (PROMPT.md §5.4 and §7.3): questions instead
// of code in the decisions ("SRC é diretório?" for `[[ -d $SRC ]]`), words for
// the branches and the terminators, in Portuguese or English.
import type { Node } from 'web-tree-sitter';
import { commandArgs, commandName, short, statements } from './ast';

export type Locale = 'pt' | 'en';

export const WORDS = {
  pt: { yes: 'sim', no: 'não', start: 'Início', end: 'Fim', other: 'outro', and: 'e', or: 'ou' },
  en: { yes: 'yes', no: 'no', start: 'Start', end: 'End', other: 'other', and: 'and', or: 'or' },
} as const;

/** File tests: [positive, negative] phrase for each operator, `%` is the operand. */
const UNARY: Record<Locale, Record<string, [string, string]>> = {
  pt: {
    '-d': ['% é diretório', '% não é diretório'],
    '-f': ['% é ficheiro', '% não é ficheiro'],
    '-e': ['% existe', '% não existe'],
    '-a': ['% existe', '% não existe'],
    '-z': ['% vazio', '% não vazio'],
    '-n': ['% não vazio', '% vazio'],
    '-r': ['% pode ser lido', '% não pode ser lido'],
    '-w': ['% pode ser escrito', '% não pode ser escrito'],
    '-x': ['% é executável', '% não é executável'],
    '-s': ['% tem conteúdo', '% sem conteúdo'],
    '-L': ['% é link', '% não é link'],
    '-h': ['% é link', '% não é link'],
    '-t': ['% é terminal', '% não é terminal'],
    '-v': ['% definida', '% não definida'],
  },
  en: {
    '-d': ['% is a directory', '% is not a directory'],
    '-f': ['% is a file', '% is not a file'],
    '-e': ['% exists', '% does not exist'],
    '-a': ['% exists', '% does not exist'],
    '-z': ['% empty', '% not empty'],
    '-n': ['% not empty', '% empty'],
    '-r': ['% readable', '% not readable'],
    '-w': ['% writable', '% not writable'],
    '-x': ['% executable', '% not executable'],
    '-s': ['% has content', '% has no content'],
    '-L': ['% is a link', '% is not a link'],
    '-h': ['% is a link', '% is not a link'],
    '-t': ['% is a terminal', '% is not a terminal'],
    '-v': ['% set', '% not set'],
  },
};

/** Comparisons; `%a` and `%b` are the operands. */
const BINARY: Record<Locale, Record<string, string>> = {
  pt: {
    '-eq': '%a igual a %b',
    '-ne': '%a diferente de %b',
    '-gt': '%a maior que %b',
    '-lt': '%a menor que %b',
    '-ge': '%a maior ou igual a %b',
    '-le': '%a menor ou igual a %b',
    '=': '%a igual a %b',
    '==': '%a igual a %b',
    '!=': '%a diferente de %b',
    '=~': '%a corresponde a %b',
    '-nt': '%a mais recente que %b',
    '-ot': '%a mais antigo que %b',
  },
  en: {
    '-eq': '%a equals %b',
    '-ne': '%a differs from %b',
    '-gt': '%a greater than %b',
    '-lt': '%a less than %b',
    '-ge': '%a at least %b',
    '-le': '%a at most %b',
    '=': '%a equals %b',
    '==': '%a equals %b',
    '!=': '%a differs from %b',
    '=~': '%a matches %b',
    '-nt': '%a newer than %b',
    '-ot': '%a older than %b',
  },
};

// prettier-ignore
const NEGATE: Record<string, string> = {
  '-eq': '-ne', '-ne': '-eq', '-gt': '-le', '-le': '-gt', '-lt': '-ge', '-ge': '-lt',
  '=': '!=', '==': '!=', '!=': '=',
};

/** `$# <op> N` read as a number of arguments. */
function argCount(op: string, n: number, l: Locale): string | undefined {
  const pl = (k: number, pt: [string, string], en: [string, string]) =>
    l === 'pt' ? (k === 1 ? pt[0] : pt[1]) : k === 1 ? en[0] : en[1];
  const args = pl(n, ['argumento', 'argumentos'], ['argument', 'arguments']);
  if (l === 'pt') {
    if (op === '-lt') return `menos de ${n} ${args}`;
    if (op === '-gt') return n === 0 ? 'há argumentos' : `mais de ${n} ${args}`;
    if (op === '-eq') return n === 0 ? 'sem argumentos' : `${n} ${args}`;
    if (op === '-ne') return n === 0 ? 'há argumentos' : `número de argumentos diferente de ${n}`;
    if (op === '-ge') return `pelo menos ${n} ${args}`;
    if (op === '-le') return n === 0 ? 'sem argumentos' : `no máximo ${n} ${args}`;
  } else {
    if (op === '-lt') return `fewer than ${n} ${args}`;
    if (op === '-gt') return n === 0 ? 'any arguments' : `more than ${n} ${args}`;
    if (op === '-eq') return n === 0 ? 'no arguments' : `exactly ${n} ${args}`;
    if (op === '-ne') return n === 0 ? 'any arguments' : `not exactly ${n} ${args}`;
    if (op === '-ge') return `at least ${n} ${args}`;
    if (op === '-le') return n === 0 ? 'no arguments' : `at most ${n} ${args}`;
  }
  return undefined;
}

/**
 * How an operand reads in a question: `"$dir"` → `dir`, `${#list[@]}` → `nº de list`,
 * `$SRC/notes` → `SRC/notes`. Literal strings keep their quotes.
 */
export function operand(n: Node, l: Locale): string {
  const text = n.text;
  if (n.type === 'string' && n.namedChildren.length === 1 && n.namedChildren[0]!.type !== 'string_content')
    return operand(n.namedChildren[0]!, l);
  if (n.type === 'string' && n.namedChildren.every((c) => c.type === 'string_content')) return text;
  if (text === '$#') return l === 'pt' ? 'nº de argumentos' : 'number of arguments';
  if (text === '$?') return l === 'pt' ? 'código de saída' : 'exit code';
  const count = /^\$\{#(\w+)(\[[@*]\])?\}$/.exec(text);
  if (count) {
    if (count[2]) return l === 'pt' ? `nº de ${count[1]}` : `number of ${count[1]}`;
    return l === 'pt' ? `tamanho de ${count[1]}` : `length of ${count[1]}`;
  }
  if (/^\$\{?\d\}?$/.test(text)) return text.replace(/[{}]/g, '');
  return text
    .replace(/^"(.*)"$/s, '$1')
    .replace(/\$\{(\w+)\}/g, '$1')
    .replace(/\$\{([^}]+)\}/g, '$1')
    .replace(/\$(\w+)/g, '$1');
}

/** The phrase for a test expression inside `[[ ]]`, `[ ]` or `test`, or undefined when no rule fits. */
function testExpr(e: Node, neg: boolean, l: Locale): string | undefined {
  switch (e.type) {
    case 'parenthesized_expression': {
      const inner = e.namedChildren[0];
      return inner ? testExpr(inner, neg, l) : undefined;
    }
    case 'unary_expression': {
      const first = e.children[0];
      const arg = e.namedChildren[e.namedChildren.length - 1];
      if (!first || !arg) return undefined;
      if (first.type === '!') return testExpr(arg, !neg, l);
      const op = e.childForFieldName('operator')?.text ?? first.text;
      const phrase = UNARY[l][op];
      if (!phrase) return undefined;
      return phrase[neg ? 1 : 0].replace('%', operand(arg, l));
    }
    case 'binary_expression': {
      let left = e.childForFieldName('left');
      const right = e.childForFieldName('right');
      const opNode = e.childForFieldName('operator');
      if (!left || !right || !opNode) return undefined;
      const op = opNode.text;
      // tree-sitter-bash binds `!` to the left operand: `! $# -lt 1` is `(! $#) -lt 1`.
      if (op !== '&&' && op !== '||' && left.type === 'unary_expression' && left.children[0]?.type === '!') {
        const inner = left.namedChildren.at(-1);
        if (!inner) return undefined;
        left = inner;
        neg = !neg;
      }
      if (op === '&&' || op === '||') {
        // De Morgan for a negated group: !(a && b) = !a || !b.
        const joined = (op === '&&') !== neg ? WORDS[l].and : WORDS[l].or;
        const a = testExpr(left, neg, l);
        const b = testExpr(right, neg, l);
        return a && b ? `${a} ${joined} ${b}` : undefined;
      }
      const eff = neg ? NEGATE[op] : op;
      if (!eff) return undefined;
      if (left.text === '$#' && /^\d+$/.test(right.text)) {
        const phrase = argCount(eff, Number(right.text), l);
        if (phrase) return phrase;
      }
      const tpl = BINARY[l][eff];
      if (!tpl) return undefined;
      return tpl.replace('%a', operand(left, l)).replace('%b', operand(right, l));
    }
    case 'word':
    case 'string':
    case 'simple_expansion':
    case 'expansion':
    case 'concatenation':
      // `[[ $x ]]` tests that the value is not empty.
      return UNARY[l]['-n']![neg ? 1 : 0].replace('%', operand(e, l));
    default:
      return undefined;
  }
}

/** `test -f x` and `[ -f x ]` written as a plain command: read the arguments as an expression. */
function testArgs(args: string[], neg: boolean, l: Locale): string | undefined {
  if (args[0] === '!') return testArgs(args.slice(1), !neg, l);
  const plain = (s: string) => s.replace(/^"(.*)"$/s, '$1').replace(/\$\{?(\w+)\}?/g, '$1');
  if (args.length === 2) {
    const phrase = UNARY[l][args[0]!];
    return phrase?.[neg ? 1 : 0].replace('%', plain(args[1]!));
  }
  if (args.length === 3) {
    const op = neg ? NEGATE[args[1]!] : args[1]!;
    const tpl = op && BINARY[l][op];
    return tpl ? tpl.replace('%a', plain(args[0]!)).replace('%b', plain(args[2]!)) : undefined;
  }
  return undefined;
}

/** The question for one condition node, without the question mark; undefined when no rule fits. */
function describe(n: Node, neg: boolean, l: Locale): string | undefined {
  switch (n.type) {
    case 'test_command': {
      const inner = n.namedChildren[0];
      return inner ? testExpr(inner, neg, l) : undefined;
    }
    case 'negated_command': {
      const inner = n.namedChildren[0];
      return inner ? describe(inner, !neg, l) : undefined;
    }
    case 'redirected_statement': {
      const body = n.childForFieldName('body');
      return body ? describe(body, neg, l) : undefined;
    }
    case 'compound_statement': {
      if (n.children[0]?.type === '((') {
        const inner = n.namedChildren[0];
        if (!inner) return undefined;
        return neg ? `${l === 'pt' ? 'não' : 'not'} ${short(inner.text)}` : short(inner.text);
      }
      const last = statements(n).at(-1);
      return last ? describe(last, neg, l) : undefined;
    }
    case 'list': {
      const [a, b] = n.namedChildren;
      const op = n.children.find((c) => !c.isNamed && (c.type === '&&' || c.type === '||'))?.type;
      if (!a || !b || !op) return undefined;
      const pa = describe(a, neg, l);
      const pb = describe(b, neg, l);
      const joined = (op === '&&') !== neg ? WORDS[l].and : WORDS[l].or;
      return pa && pb ? `${pa} ${joined} ${pb}` : undefined;
    }
    case 'command': {
      const name = commandName(n);
      const args = commandArgs(n).map((a) => a.text);
      if (name === 'test' || name === '[') return testArgs(name === '[' ? args.slice(0, -1) : args, neg, l);
      if (name === 'command' && args[0] === '-v' && args[1]) {
        const what = args[1].replace(/^["']|["']$/g, '');
        if (l === 'pt') return neg ? `${what} não existe` : `${what} existe`;
        return neg ? `${what} does not exist` : `${what} exists`;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/** The label of a decision for an `if`/`elif`/`while`/`until` condition. */
export function conditionLabel(cond: readonly Node[], l: Locale, negate = false): string {
  const last = cond.at(-1);
  if (!last) return '?';
  const p = describe(last, negate, l);
  if (p) return `${short(p, 60)}?`;
  const raw = short(cond.map((c) => c.text).join('; '), 40);
  return negate ? `${l === 'pt' ? 'não' : 'not'} ${raw}?` : `${raw}?`;
}

/** Loop questions for conditions with a well-known meaning (`read`, `getopts`). */
export function loopLabel(cond: readonly Node[], l: Locale): string | undefined {
  const last = cond.at(-1);
  const cmd = last?.type === 'redirected_statement' ? last.childForFieldName('body') : last;
  if (!cmd || cmd.type !== 'command') return undefined;
  const name = commandName(cmd);
  if (name === 'read' || name === 'mapfile') return l === 'pt' ? 'há mais linhas?' : 'more lines?';
  if (name === 'getopts') return l === 'pt' ? 'há mais opções?' : 'more options?';
  return undefined;
}

/** True for `while true`, `while :` and `until false`: loops with no exit of their own. */
export function isForever(cond: readonly Node[], until: boolean): boolean {
  const last = cond.at(-1);
  if (cond.length !== 1 || !last || last.type !== 'command') return false;
  const name = commandName(last);
  return until ? name === 'false' : name === 'true' || name === ':';
}

/** `for x in a b c` → "mais x em a b c?". */
export function forLabel(variable: string, values: string, l: Locale): string {
  const list = short(values.replace(/"/g, ''), 24) || '$@';
  return l === 'pt' ? `mais ${variable} em ${list}?` : `more ${variable} in ${list}?`;
}
