// Language detection helpers shared by the four analyzers' `detect`.
import type { SourceFile } from '../../model/types';

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** The interpreter named by a `#!` line (`bash` for `#!/usr/bin/env bash`), or ''. */
export function shebangOf(file: SourceFile): string {
  const text = file.content.charCodeAt(0) === 0xfeff ? file.content.slice(1) : file.content;
  if (!text.startsWith('#!')) return '';
  const first = text.slice(2, text.search(/\r?\n|$/)).trim();
  const parts = first.split(/\s+/);
  const prog = parts[0] ?? '';
  const name = prog.slice(prog.lastIndexOf('/') + 1);
  return name === 'env' ? (parts.find((p, i) => i > 0 && !p.startsWith('-')) ?? '') : name;
}
