// Human decision labels (PROMPT.md §5.4 and §7.3): questions instead of code.
import { describe, expect, it } from 'vitest';
import { flow, labels } from './helpers';

const question = async (cond: string, locale: 'pt' | 'en' = 'pt') =>
  labels(await flow(`if ${cond}; then :; fi\n`, { locale }), 'decision')[0];

describe('decision labels', () => {
  it.each([
    ['[[ -d $x ]]', 'x é diretório?', 'x is a directory?'],
    ['[ -d "$x" ]', 'x é diretório?', 'x is a directory?'],
    ['[[ -f $x ]]', 'x é ficheiro?', 'x is a file?'],
    ['[[ -e $x ]]', 'x existe?', 'x exists?'],
    ['[[ -z $x ]]', 'x vazio?', 'x empty?'],
    ['[[ -n $x ]]', 'x não vazio?', 'x not empty?'],
    ['[[ -r $x ]]', 'x pode ser lido?', 'x readable?'],
    ['[[ -x ${tool} ]]', 'tool é executável?', 'tool executable?'],
    ['[[ $# -lt 1 ]]', 'menos de 1 argumento?', 'fewer than 1 argument?'],
    ['[[ $# -lt 2 ]]', 'menos de 2 argumentos?', 'fewer than 2 arguments?'],
    ['[ $# -gt 0 ]', 'há argumentos?', 'any arguments?'],
    ['[[ $# -eq 0 ]]', 'sem argumentos?', 'no arguments?'],
    ['[[ $# -ge 3 ]]', 'pelo menos 3 argumentos?', 'at least 3 arguments?'],
    ['[[ $a -eq $b ]]', 'a igual a b?', 'a equals b?'],
    ['[[ $a -ne 0 ]]', 'a diferente de 0?', 'a differs from 0?'],
    ['[[ $a -gt 10 ]]', 'a maior que 10?', 'a greater than 10?'],
    ['[[ $a -lt 10 ]]', 'a menor que 10?', 'a less than 10?'],
    ['[[ $a -ge 1 ]]', 'a maior ou igual a 1?', 'a at least 1?'],
    ['[[ $a -le 1 ]]', 'a menor ou igual a 1?', 'a at most 1?'],
    ['[ "$mode" = "fast" ]', 'mode igual a "fast"?', 'mode equals "fast"?'],
    ['[[ $mode != fast ]]', 'mode diferente de fast?', 'mode differs from fast?'],
    ['[[ $v =~ ^[0-9]+$ ]]', 'v corresponde a ^[0-9]+$?', 'v matches ^[0-9]+$?'],
    ['[[ ${#items[@]} -eq 0 ]]', 'nº de items igual a 0?', 'number of items equals 0?'],
    ['[[ $? -ne 0 ]]', 'código de saída diferente de 0?', 'exit code differs from 0?'],
    ['command -v jq >/dev/null 2>&1', 'jq existe?', 'jq exists?'],
    ['test -f "$cfg"', 'cfg é ficheiro?', 'cfg is a file?'],
    ['(( n > 0 ))', 'n > 0?', 'n > 0?'],
    ['[[ $x ]]', 'x não vazio?', 'x not empty?'],
  ])('%s → %s / %s', async (cond, pt, en) => {
    expect(await question(cond)).toBe(pt);
    expect(await question(cond, 'en')).toBe(en);
  });

  it.each([
    ['[[ ! -d $x ]]', 'x não é diretório?'],
    ['! [[ -f $x ]]', 'x não é ficheiro?'],
    ['[[ ! -z $x ]]', 'x não vazio?'],
    ['! command -v git', 'git não existe?'],
    ['[[ ! $# -lt 1 ]]', 'pelo menos 1 argumento?'],
    ['[[ ! $mode == fast ]]', 'mode diferente de fast?'],
    ['[[ ! ( -f a || -d b ) ]]', 'a não é ficheiro e b não é diretório?'],
  ])('negation: %s → %s', async (cond, pt) => {
    expect(await question(cond)).toBe(pt);
  });

  it('joins tests with e/ou, inside [[ ]] and across commands', async () => {
    expect(await question('[[ -f a && -r a ]]')).toBe('a é ficheiro e a pode ser lido?');
    expect(await question('[ -z "$a" ] || [ -z "$b" ]')).toBe('a vazio ou b vazio?');
    expect(await question('[[ -d a || -d b ]]', 'en')).toBe('a is a directory or b is a directory?');
  });

  it('falls back to the original condition, shortened', async () => {
    expect(await question('grep -q needle haystack.txt')).toBe('grep -q needle haystack.txt?');
    const long = await question('some_tool --with-a-long-option --and-another-one --and-more');
    expect(long).toBe('some_tool --with-a-long-option --and-an…?');
  });

  it('labels case with the value it switches on', async () => {
    const m = await flow('case "$1" in a) :;; esac\n');
    expect(labels(m, 'decision')).toEqual(['$1?']);
  });
});
