// Turns file bytes into text the way the app will: honour a UTF-8 or UTF-16
// BOM (SQL Server Management Studio saves scripts as UTF-16 LE), otherwise
// assume UTF-8. Returns undefined for files that look binary.

function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

export function decodeText(bytes: Uint8Array): string | undefined {
  const [a, b, c] = bytes;
  if (a === 0xff && b === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (a === 0xfe && b === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (a === 0xef && b === 0xbb && c === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (looksBinary(bytes)) return undefined;
  return new TextDecoder('utf-8').decode(bytes);
}
