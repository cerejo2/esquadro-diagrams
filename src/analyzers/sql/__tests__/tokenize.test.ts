import { describe, expect, it } from 'vitest';
import { tokenize } from '../tokenize';

const kinds = (src: string) => tokenize(src).map((t) => `${t.kind}:${t.text}`);

describe('SQL tokenizer', () => {
  it('skips -- and /* */ comments and MySQL # comments, but keeps #temp names', () => {
    expect(kinds('a -- x\n/* y\n z */ b # c\n#tmp')).toEqual(['word:a', 'word:b', 'word:#tmp']);
  });

  it('reads strings with doubled quotes and prefixes', () => {
    expect(kinds("'it''s' N'olá' E'a\\'b' X'0F'")).toEqual([
      "string:'it''s'",
      "string:N'olá'",
      "string:E'a\\'b'",
      "string:X'0F'",
    ]);
  });

  it('reads PostgreSQL dollar quotes as one string, with ; and words inside', () => {
    const t = tokenize('AS $$ SELECT 1; $$; x $fn$ a $$ b $fn$ $1');
    expect(t.map((x) => x.kind)).toEqual(['word', 'string', 'term', 'word', 'string', 'word']);
    expect(t[4]!.text).toBe('$fn$ a $$ b $fn$');
    expect(t[5]!.text).toBe('$1');
  });

  it('unquotes [ ], " " and ` ` identifiers, with spaces and doubled closers', () => {
    expect(kinds('[Order Details] "a""b" `c``d` [x]]y]')).toEqual([
      'qident:Order Details',
      'qident:a"b',
      'qident:c`d',
      'qident:x]y',
    ]);
  });

  it('keeps an empty [] as punctuation (PostgreSQL arrays)', () => {
    expect(kinds('integer[]')).toEqual(['word:integer', 'punct:[', 'punct:]']);
  });

  it('turns GO alone on its line into a batch separator, in any case and with a count', () => {
    const t = tokenize('SELECT 1\nGO\nselect go\n  go 3\nGO -- end');
    expect(t.map((x) => x.kind)).toEqual(['word', 'number', 'go', 'word', 'word', 'go', 'go']);
  });

  it('honours MySQL DELIMITER: the new delimiter ends statements and ; becomes plain', () => {
    const t = tokenize('DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; END //\nDELIMITER ;\nSELECT 2;');
    const terms = t.filter((x) => x.kind === 'term').length;
    expect(t.some((x) => x.kind === 'punct' && x.text === ';')).toBe(true);
    expect(terms).toBe(4); // before DELIMITER //, the //, before DELIMITER ;, the final ;
  });

  it('counts lines across comments and multi-line strings', () => {
    const t = tokenize("/* a\nb */ x\n'p\nq' y");
    expect(t.map((x) => [x.text, x.line])).toEqual([
      ['x', 2],
      ["'p\nq'", 3],
      ['y', 4],
    ]);
  });

  it('marks the first token of each line', () => {
    expect(tokenize('a b\n c').map((x) => x.lineStart)).toEqual([true, false, true]);
  });

  it('ignores a UTF-8 BOM and reads Unicode identifiers', () => {
    expect(kinds('﻿CREATE TABLE situação')).toEqual(['word:CREATE', 'word:TABLE', 'word:situação']);
  });
});
