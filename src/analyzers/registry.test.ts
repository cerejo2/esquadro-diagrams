import { describe, expect, it } from 'vitest';
import { DIAGRAM_KINDS } from '../model/kinds';
import { analyzerForKind, analyzers, detectLang, groupByLang } from '.';
import { shebangOf } from './shared/detect';
import { IdPool, byPath, edgeId, nodeId } from './shared/ids';
import { refAtOffset } from './shared/evidence';

describe('analyzer registry', () => {
  it('covers each of the 13 diagram kinds exactly once', () => {
    const all = analyzers.flatMap((a) => a.kinds);
    expect([...all].sort()).toEqual([...DIAGRAM_KINDS].sort());
  });

  it.each(DIAGRAM_KINDS)('%s returns a model and never throws', async (kind) => {
    const a = analyzerForKind(kind);
    const model = await a.analyze([{ path: 'x', content: '' }], kind);
    expect(model.kind).toBe(kind);
    expect(model.lang).toBe(a.lang);
    expect(Array.isArray(model.diagnostics)).toBe(true);
  });

  it('turns a kind from another language into a diagnostic', async () => {
    const model = await analyzers[0]!.analyze([], 'sql.chen');
    expect(model.diagnostics[0]?.level).toBe('error');
  });
});

describe('language detection', () => {
  it.each([
    ['src/App.java', 'class A {}', 'java'],
    ['queue.c', '', 'c'],
    ['queue.h', '', 'c'],
    ['run.sh', '', 'bash'],
    ['vp', '#!/bin/bash\necho hi\n', 'bash'],
    ['install', '﻿#!/usr/bin/env -S bash -e\r\n', 'bash'],
    ['schema.SQL', '', 'sql'],
    ['README.md', '# hi', undefined],
    ['tool', '#!/usr/bin/env python3\n', undefined],
  ])('%s → %s', (path, content, lang) => {
    expect(detectLang({ path, content })).toBe(lang);
  });

  it('reads env shebangs', () => {
    expect(shebangOf({ path: 'x', content: '#!/usr/bin/env zsh\n' })).toBe('zsh');
    expect(shebangOf({ path: 'x', content: 'echo' })).toBe('');
  });

  it('groups files by language and drops the rest', () => {
    const g = groupByLang([
      { path: 'a.java', content: '' },
      { path: 'b.sql', content: '' },
      { path: 'c.txt', content: '' },
    ]);
    expect([...g.keys()].sort()).toEqual(['java', 'sql']);
  });
});

describe('shared helpers', () => {
  it('builds ids in the contract format', () => {
    expect(nodeId('class', 'garden.Greenhouse')).toBe('class:garden.Greenhouse');
    expect(edgeId('association', 'class:A', 'class:B', 'items')).toBe('association:class:A->class:B#items');
  });

  it('deduplicates ids deterministically', () => {
    const pool = new IdPool();
    expect([pool.take('a'), pool.take('a'), pool.take('b'), pool.take('a')]).toEqual(['a', 'a~2', 'b', 'a~3']);
  });

  it('sorts files by path', () => {
    expect(byPath([{ path: 'b' }, { path: 'a/z' }, { path: 'a' }]).map((f) => f.path)).toEqual(['a', 'a/z', 'b']);
  });

  it('computes 1-based lines from offsets', () => {
    expect(refAtOffset('a\nb\nc', 4, 'f.sql')).toEqual({ file: 'f.sql', line: 3 });
  });
});
