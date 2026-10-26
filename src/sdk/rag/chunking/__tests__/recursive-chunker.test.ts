/**
 * RecursiveChunker is what `ctx index` runs on every code and config segment
 * larger than its token budget (and on docs when no embedding provider is set).
 * Options mirror src/indexer/chunker/config.ts: tokens, ~4 chars per token.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { RecursiveChunker } from '../recursive-chunker.js';
import type { Chunk, Document } from '../types.js';

/** CHUNK_CONFIG.config: 1024 chars, 100 chars overlap. */
const CONFIG = { chunkSize: 256, chunkOverlap: 25, sizeUnit: 'tokens' } as const;
/** CHUNK_CONFIG.code: 2048 chars, 200 chars overlap. */
const CODE = { chunkSize: 512, chunkOverlap: 50, sizeUnit: 'tokens' } as const;

/** The Document shape chunker.ts builds for each segment. */
const doc = (content: string, id = 'doc-1'): Document => ({ id, content, metadata: {}, source: 'src/file.ts' });
const contents = (chunks: Chunk[]) => chunks.map((c) => c.content);

/** Each chunk's offsets must point at exactly its text in the segment. */
function expectExactSpans(text: string, chunks: Chunk[]) {
  for (const c of chunks) {
    expect(text.slice(c.metadata.startIndex, c.metadata.endIndex)).toBe(c.content);
  }
}

describe('RecursiveChunker (ctx options)', () => {
  it('text within the limit comes back as one chunk spanning the whole segment', async () => {
    const text = 'export const answer = 42;\n';
    const chunks = await new RecursiveChunker().chunk(doc(text), CODE);
    expect(chunks).toEqual([{
      id: expect.stringMatching(/^[0-9a-f]{16}$/),
      content: text,
      metadata: { startIndex: 0, endIndex: text.length },
      documentId: 'doc-1',
    }]);
  });

  it('splits on paragraphs and carries the last 100 chars into the next chunk', async () => {
    // Eight paragraphs, 300 chars each with their "\n\n".
    const paras = Array.from({ length: 8 }, (_, i) => `p${i}`.padEnd(298, 'abcdefghij'));
    const text = paras.join('\n\n');
    expect(text.length).toBe(2398);

    const chunks = await new RecursiveChunker().chunk(doc(text), CONFIG);

    expect(contents(chunks)).toEqual([text.slice(0, 900), text.slice(800, 1800), text.slice(1700)]);
    expect(chunks.map((c) => [c.metadata.startIndex, c.metadata.endIndex])).toEqual([[0, 900], [800, 1800], [1700, 2398]]);
    expect(chunks[1]!.content.startsWith(chunks[0]!.content.slice(-100))).toBe(true);
    expect(chunks.every((c) => c.content.length <= 1024)).toBe(true);
  });

  it('drops the overlap when overlap plus the next piece would pass the limit', async () => {
    const first = `${'a'.repeat(500)}\n\n`;
    const second = 'b'.repeat(1000); // 100 chars of overlap would make 1100 > 1024
    const text = first + second;

    const chunks = await new RecursiveChunker().chunk(doc(text), CONFIG);

    expect(contents(chunks)).toEqual([first, second]);
    expect(chunks.map((c) => c.metadata.startIndex)).toEqual([0, 502]);
  });

  it('falls back to lines for an oversized paragraph and never splits a CRLF pair', async () => {
    // One paragraph of 40 CRLF lines, 50 chars each: 2000 chars, so overlap is exactly 2 lines.
    const lines = Array.from({ length: 40 }, (_, i) => `const v${String(i).padStart(2, '0')} = read();`.padEnd(48, ' ') + '\r\n');
    const text = lines.join('');

    const chunks = await new RecursiveChunker().chunk(doc(text), CONFIG);

    expect(contents(chunks)).toEqual([
      lines.slice(0, 20).join(''),
      lines.slice(18, 38).join(''),
      lines.slice(36).join(''),
    ]);
    expectExactSpans(text, chunks);
    for (const c of chunks) {
      expect(c.content.startsWith('\n')).toBe(false);
      expect(c.content.endsWith('\r\n')).toBe(true);
    }
  });

  it('falls back to sentences on one long line, keeping each chunk under the limit', async () => {
    const sentences = Array.from({ length: 60 }, (_, i) => `Step ${String(i).padStart(2, '0')} checks the input once. `);
    const text = sentences.join('').trimEnd();

    const chunks = await new RecursiveChunker().chunk(doc(text), CONFIG);

    // 31-char sentences: 33 of them fill 1023 of the 1024 chars.
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.content).toBe(sentences.slice(0, 33).join(''));
    expectExactSpans(text, chunks);
    for (const [i, c] of chunks.entries()) {
      expect(c.content.length).toBeLessThanOrEqual(1024);
      if (i < chunks.length - 1) expect(c.content.endsWith('. ')).toBe(true);
      if (i > 0) expect(c.content.startsWith(chunks[i - 1]!.content.slice(-100))).toBe(true);
    }
    expect(chunks[0]!.metadata.startIndex).toBe(0);
    expect(chunks.at(-1)!.metadata.endIndex).toBe(text.length);
  });

  it('falls back to words for a long line with no sentence breaks (code limits)', async () => {
    const text = Array.from({ length: 500 }, (_, i) => `tok${i}`).join(' ');
    expect(text.length).toBeGreaterThan(2048);

    const chunks = await new RecursiveChunker().chunk(doc(text), CODE);

    expect(chunks.length).toBe(2);
    expectExactSpans(text, chunks);
    expect(chunks[0]!.content.length).toBeLessThanOrEqual(2048);
    expect(chunks[0]!.content.endsWith(' ')).toBe(true);
    expect(chunks[1]!.content.startsWith(chunks[0]!.content.slice(-200))).toBe(true);
    expect(chunks[1]!.metadata.endIndex).toBe(text.length);
  });

  it('keeps a single token longer than the limit whole, so no content is dropped', async () => {
    // A minified or base64 run with no separators cannot be split further.
    const blob = 'Q'.repeat(3000);
    const text = `head words ${blob} tail words`;

    const chunks = await new RecursiveChunker().chunk(doc(text), CONFIG);

    expect(contents(chunks)).toEqual(['head words ', `${blob} `, `${'Q'.repeat(99)} tail words`]);
    expect(chunks.map((c) => c.metadata.startIndex)).toEqual([0, 11, 2912]);
    expectExactSpans(text, chunks);
  });

  it('drops chunks that are only whitespace and numbers the rest consecutively', async () => {
    const text = `start\n${' '.repeat(3000)}\nend`;

    const chunks = await new RecursiveChunker().chunk(doc(text), CONFIG);

    expect(contents(chunks)).toEqual([`start\n${' '.repeat(1018)}`, `${' '.repeat(234)}\nend`]);
    expectExactSpans(text, chunks);
    const idFor = (i: number) => createHash('sha256').update('doc-1').update(`:chunk:${i}`).digest('hex').slice(0, 16);
    expect(chunks.map((c) => c.id)).toEqual([idFor(0), idFor(1)]);
  });

  it('keeps accented and CJK text intact and covers the segment without gaps', async () => {
    const text = Array.from({ length: 200 }, (_, i) => `東京${i} café naïve`).join(' ');

    const chunks = await new RecursiveChunker().chunk(doc(text), CONFIG);

    expect(chunks.length).toBe(4);
    expectExactSpans(text, chunks);
    expect(chunks[0]!.metadata.startIndex).toBe(0);
    expect(chunks.at(-1)!.metadata.endIndex).toBe(text.length);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.metadata.startIndex).toBeLessThanOrEqual(chunks[i - 1]!.metadata.endIndex!);
    }
    expect(chunks.every((c) => c.content.length <= 1024)).toBe(true);
  });

  it('never starts an overlap on half an emoji', async () => {
    const text = Array.from({ length: 600 }, () => 'aaaa😀').join(' ');

    const chunks = await new RecursiveChunker().chunk(doc(text), CONFIG);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.content.isWellFormed())).toEqual(chunks.map(() => true));
  });

  it('chunk ids are deterministic per document and differ between documents', async () => {
    const text = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
    const chunker = new RecursiveChunker();

    const first = await chunker.chunk(doc(text, 'a'), CONFIG);
    const again = await chunker.chunk(doc(text, 'a'), CONFIG);
    const other = await chunker.chunk(doc(text, 'b'), CONFIG);

    expect(first.length).toBeGreaterThan(1);
    expect(again.map((c) => c.id)).toEqual(first.map((c) => c.id));
    expect(new Set(first.map((c) => c.id)).size).toBe(first.length);
    expect(other.map((c) => c.id).some((id) => first.some((c) => c.id === id))).toBe(false);
    expect(first.every((c) => c.documentId === 'a')).toBe(true);
  });
});
