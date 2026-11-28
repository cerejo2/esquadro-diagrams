// Deterministic text measurement.
//
// The layout must give the same result in Vitest, in the bench and in every
// browser, so it cannot ask the DOM how wide a string is. Instead it uses
// per-character advance widths (in em) close to Helvetica/Arial, IBM Plex Sans
// and the handwriting font. Real glyphs may differ by a few percent; node
// boxes keep at least 8 px of padding, so the text never touches a border.

export type FontClass = 'sans' | 'mono' | 'hand';

const NARROW = new Set("iljtfrI.,:;'!|()[]{} ");
const SEMI = new Set('sczxvykJ1-"*/\\`');
const WIDE = new Set('mwMW@%');
const CAPS_WIDE = new Set('ABCDGHKNOQRUVXY&');

function sansAdvance(ch: string): number {
  if (NARROW.has(ch)) return 0.28;
  if (WIDE.has(ch)) return 0.86;
  if (SEMI.has(ch)) return 0.5;
  if (ch >= '0' && ch <= '9') return 0.56;
  if (ch >= 'A' && ch <= 'Z') return CAPS_WIDE.has(ch) ? 0.72 : 0.64;
  if (ch === '«' || ch === '»') return 0.56;
  if (ch === '_') return 0.56;
  return 0.56;
}

export interface Font {
  size: number;
  weight?: number;
  family?: FontClass;
}

export function textWidth(text: string, font: Font): number {
  const family = font.family ?? 'sans';
  let em = 0;
  for (const ch of text) {
    if (family === 'mono') em += 0.6;
    else if (family === 'hand') em += sansAdvance(ch) * 0.92;
    else em += sansAdvance(ch);
  }
  const bold = (font.weight ?? 400) >= 600 ? 1.06 : 1;
  return Math.ceil(em * font.size * bold);
}

/** Splits text into at most `maxLines` lines no wider than `maxWidth`, on spaces. */
export function wrap(text: string, font: Font, maxWidth: number, maxLines = 2): string[] {
  const hard = text.split('\n');
  const lines: string[] = [];
  for (const para of hard) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && textWidth(next, font) > maxWidth) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(lines.slice(maxLines - 1).join(' '), font, maxWidth);
  return kept;
}

export function ellipsize(text: string, font: Font, maxWidth: number): string {
  if (textWidth(text, font) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}…`, font) > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
