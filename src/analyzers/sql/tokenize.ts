// Hand-written SQL tokenizer (PROMPT.md §7.4). It only has to be good enough
// for DDL in four dialects: T-SQL first, then MySQL, PostgreSQL and SQLite.
//
// - comments: `-- ...`, `/* ... */`, and MySQL `# ...` (a `#` not followed by
//   a word character, so T-SQL temp tables such as `#tmp` stay words);
// - strings: '...' with '' escapes, N'...', X'...', B'...', E'...' (backslash
//   escapes) and PostgreSQL dollar quotes ($$...$$, $tag$...$tag$);
// - quoted identifiers: [x], "x", `x` (doubled closing character escapes it);
// - `GO` alone on its line (optionally with a count) separates T-SQL batches;
// - MySQL `DELIMITER //` changes the statement terminator until the next
//   `DELIMITER ;`, and `;` inside is then plain punctuation.

export type TokKind = 'word' | 'qident' | 'string' | 'number' | 'punct' | 'go' | 'term';

export interface Token {
  kind: TokKind;
  /** Words and punctuation as written; quoted identifiers without their quotes; strings with them. */
  text: string;
  /** Upper-case text for words (keyword checks); '' otherwise. */
  upper: string;
  line: number;
  /** First token on its line (used to find statement starts when `;` is missing). */
  lineStart: boolean;
}

const isDigit = (c: number) => c >= 48 && c <= 57;
const isAsciiWordStart = (c: number) =>
  (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 64 || c === 35; // A-Z a-z _ @ #
const isAsciiWordPart = (c: number) => isAsciiWordStart(c) || isDigit(c) || c === 36; // and $
const LETTER = /\p{L}/u;
const isWordStart = (c: number) => isAsciiWordStart(c) || (c > 127 && LETTER.test(String.fromCharCode(c)));
// Combining marks too, so decomposed (NFD) accents (a + U+0303) stay inside the word.
const isWordPart = (c: number) => isAsciiWordPart(c) || (c > 127 && /[\p{L}\p{N}\p{M}]/u.test(String.fromCharCode(c)));

/**
 * End of a block comment that starts at `i`. T-SQL and PostgreSQL nest them
 * (`/* a /* b *\/ c *\/`); MySQL and SQLite do not, so when the nesting never
 * balances the comment ends at the first `*\/`, as those dialects read it. The
 * search for the balanced end is capped, so unbalanced comments stay linear.
 */
function blockCommentEnd(src: string, i: number): number {
  const first = src.indexOf('*/', i + 2);
  if (first < 0) return src.length;
  let depth = 0;
  const limit = Math.min(src.length - 1, first + 65536);
  for (let k = i; k < limit; k++) {
    const a = src.charCodeAt(k);
    const b = src.charCodeAt(k + 1);
    if (a === 47 && b === 42) {
      depth++;
      k++;
    } else if (a === 42 && b === 47) {
      k++;
      if (--depth === 0) return k + 1;
    }
  }
  return first + 2;
}

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const n = src.length;
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let lastLine = 0; // line of the last emitted token
  let delimiter = ';';

  const push = (kind: TokKind, text: string, atLine: number) => {
    out.push({
      kind,
      text,
      upper: kind === 'word' ? text.toUpperCase() : '',
      line: atLine,
      lineStart: atLine !== lastLine,
    });
    lastLine = atLine;
  };
  /** Advances over [from, to) counting newlines. */
  const countLines = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (src.charCodeAt(k) === 10) line++;
  };
  /** Scans a quoted run closed by `close`, where a doubled `close` is an escape. Returns the index after it. */
  const scanQuoted = (start: number, close: number, backslash = false): number => {
    let k = start;
    while (k < n) {
      const c = src.charCodeAt(k);
      if (backslash && c === 92) {
        k += 2;
        continue;
      }
      if (c === close) {
        if (src.charCodeAt(k + 1) === close) {
          k += 2;
          continue;
        }
        return k + 1;
      }
      k++;
    }
    return n;
  };

  while (i < n) {
    const c = src.charCodeAt(i);

    // whitespace
    if (c === 10) {
      line++;
      i++;
      continue;
    }
    if (c === 32 || c === 9 || c === 13 || c === 12 || c === 11 || c === 0xa0 || c === 0xfeff) {
      i++;
      continue;
    }

    // custom MySQL delimiter
    if (delimiter !== ';' && src.startsWith(delimiter, i)) {
      push('term', delimiter, line);
      i += delimiter.length;
      continue;
    }

    // comments
    if (c === 45 && src.charCodeAt(i + 1) === 45) {
      while (i < n && src.charCodeAt(i) !== 10) i++;
      continue;
    }
    if (c === 47 && src.charCodeAt(i + 1) === 42) {
      const stop = blockCommentEnd(src, i);
      countLines(i, stop);
      i = stop;
      continue;
    }
    if (c === 35 && !isAsciiWordPart(src.charCodeAt(i + 1))) {
      while (i < n && src.charCodeAt(i) !== 10) i++;
      continue;
    }

    const startLine = line;

    // strings, with an optional one-letter prefix (N'..', E'..', X'..', B'..')
    const lower = c | 32;
    const prefixed = (lower === 110 || lower === 101 || lower === 120 || lower === 98) && src.charCodeAt(i + 1) === 39;
    if (c === 39 || prefixed) {
      const quote = prefixed ? i + 1 : i;
      const end = scanQuoted(quote + 1, 39, prefixed && lower === 101);
      countLines(i, end);
      push('string', src.slice(i, end), startLine);
      i = end;
      continue;
    }

    // dollar-quoted strings and $1 parameters
    if (c === 36) {
      const m = /^\$([A-Za-z_]\w*)?\$/.exec(src.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const close = src.indexOf(tag, i + tag.length);
        const end = close < 0 ? n : close + tag.length;
        countLines(i, end);
        push('string', src.slice(i, end), startLine);
        i = end;
        continue;
      }
      let k = i + 1;
      while (k < n && isAsciiWordPart(src.charCodeAt(k))) k++;
      push('word', src.slice(i, k), startLine);
      i = k;
      continue;
    }

    // quoted identifiers
    if (c === 34 || c === 96 || (c === 91 && src.charCodeAt(i + 1) !== 93)) {
      const close = c === 91 ? 93 : c;
      const end = scanQuoted(i + 1, close);
      const raw = src.slice(i + 1, Math.max(i + 1, end - 1));
      const doubled = String.fromCharCode(close, close);
      countLines(i, end);
      push('qident', raw.split(doubled).join(String.fromCharCode(close)), startLine);
      i = end;
      continue;
    }

    // numbers
    if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)))) {
      let k = i;
      if (c === 48 && (src.charCodeAt(i + 1) | 32) === 120) {
        k += 2;
        while (k < n && /[0-9a-fA-F]/.test(src[k]!)) k++;
      } else {
        while (k < n && (isDigit(src.charCodeAt(k)) || src.charCodeAt(k) === 46)) k++;
        if ((src.charCodeAt(k) | 32) === 101 && /[-+\d]/.test(src[k + 1] ?? '')) {
          k += 2;
          while (k < n && isDigit(src.charCodeAt(k))) k++;
        }
      }
      push('number', src.slice(i, k), startLine);
      i = k;
      continue;
    }

    // words (keywords and bare identifiers), plus GO and DELIMITER
    if (isWordStart(c)) {
      let k = i + 1;
      while (k < n && isWordPart(src.charCodeAt(k))) k++;
      const text = src.slice(i, k);
      const upper = text.toUpperCase();
      const first = startLine !== lastLine;
      if (upper === 'GO' && first) {
        // GO must be alone on its line, optionally followed by a count or a comment.
        const rest = /^[ \t]*(\d+)?[ \t]*(;|--[^\n]*)?[ \t]*(\r?\n|$)/.exec(src.slice(k, k + 200));
        if (rest) {
          push('go', text, startLine);
          i = k + rest[0].length - (rest[3] ? rest[3].length : 0);
          continue;
        }
      }
      if (upper === 'DELIMITER' && first) {
        let e = k;
        while (e < n && src.charCodeAt(e) !== 10) e++;
        const d = src.slice(k, e).trim();
        if (d) {
          push('term', delimiter, startLine);
          delimiter = d;
          i = e;
          continue;
        }
      }
      push('word', text, startLine);
      i = k;
      continue;
    }

    // punctuation
    if (c === 59) push(delimiter === ';' ? 'term' : 'punct', ';', startLine);
    else push('punct', src[i]!, startLine);
    i++;
  }
  return out;
}
