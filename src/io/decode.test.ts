import { describe, expect, it } from 'vitest';
import { decodeText } from './decode';

const utf16le = (s: string) => {
  const out = new Uint8Array(2 + s.length * 2);
  out.set([0xff, 0xfe]);
  for (let i = 0; i < s.length; i++) out[2 + 2 * i] = s.charCodeAt(i);
  return out;
};

describe('decodeText', () => {
  it('reads plain UTF-8 with accents', () => {
    expect(decodeText(new TextEncoder().encode('ação'))).toBe('ação');
  });

  it('strips a UTF-8 BOM', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
  });

  it('decodes UTF-16 LE with BOM (SSMS scripts)', () => {
    expect(decodeText(utf16le('CREATE TABLE "Order Details"'))).toBe('CREATE TABLE "Order Details"');
  });

  it('decodes UTF-16 BE with BOM', () => {
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x47, 0x00, 0x4f]))).toBe('GO');
  });

  it('flags binaries', () => {
    expect(decodeText(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 0, 1]))).toBeUndefined();
  });
});
