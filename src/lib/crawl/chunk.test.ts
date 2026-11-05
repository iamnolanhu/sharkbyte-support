import { describe, it, expect } from 'vitest';
import { chunkText, estimateTokens } from './chunk';

describe('chunkText', () => {
  it('estimates tokens as length / 4 rounded up', () => {
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('packs paragraphs to the target', () => {
    const paras = Array.from({ length: 10 }, (_, i) => String(i).repeat(400));
    const chunks = chunkText(paras.join('\n\n'), { targetTokens: 200, overlapTokens: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(800 + 40);
    const all = chunks.join('\n');
    for (const p of paras) expect(all).toContain(p);
  });

  it('overlaps consecutive chunks', () => {
    const paras = Array.from({ length: 6 }, (_, i) => String.fromCharCode(97 + i).repeat(400));
    const chunks = chunkText(paras.join('\n\n'), { targetTokens: 200, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    const tail = chunks[0].slice(-80);
    expect(chunks[1].startsWith(tail)).toBe(true);
  });

  it('splits one giant paragraph', () => {
    const giant = 'x'.repeat(20000);
    const chunks = chunkText(giant, { targetTokens: 200, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200 * 4 + 20 * 4);
  });

  it('splits a long paragraph on sentence ends', () => {
    const sentence = 'This is a sentence of moderate length. ';
    const chunks = chunkText(sentence.repeat(100).trim(), { targetTokens: 100, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.endsWith('.')).toBe(true);
  });

  it('of empty text is []', () => {
    expect(chunkText('', { targetTokens: 200, overlapTokens: 20 })).toEqual([]);
    expect(chunkText('  \n\n ', { targetTokens: 200, overlapTokens: 20 })).toEqual([]);
  });
});
