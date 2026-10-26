/**
 * SemanticChunker is what `ctx index` runs on docs segments over 1024 tokens:
 * the pipeline always passes its embedding provider, and chunker.ts builds the
 * chunker with threshold 0.5, min 100 and max = the docs chunk size (1024).
 * The provider here is a local bag-of-words hash, so similarity is real and stable.
 */
import { describe, it, expect, vi } from 'vitest';
import { SemanticChunker } from '../semantic-chunker.js';
import { ChunkerError } from '../errors.js';
import type { Chunk, Document } from '../types.js';
import type { EmbeddingProvider } from '../../embeddings/types.js';

const DIMS = 256;

/** Unit vector of hashed word counts: shared words mean high cosine similarity. */
function embedWords(text: string): number[] {
  const v = Array.from({ length: DIMS }, () => 0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let h = 2166136261;
    for (const ch of word) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
    v[h % DIMS]! += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

function fakeProvider(): EmbeddingProvider & { embedBatch: ReturnType<typeof vi.fn> } {
  const result = (t: string) => ({ embedding: embedWords(t), tokenCount: Math.ceil(t.length / 4), model: 'fake-bow' });
  return {
    name: 'fake-bow',
    dimensions: DIMS,
    maxBatchSize: 10_000,
    embed: vi.fn(async (t: string) => result(t)),
    embedBatch: vi.fn(async (ts: string[]) => ts.map(result)),
    isAvailable: async () => true,
  };
}

/** Exactly as src/indexer/chunker/chunker.ts constructs and calls it for docs. */
const ctxChunker = (embeddingProvider: EmbeddingProvider) =>
  new SemanticChunker({ embeddingProvider, similarityThreshold: 0.5, minChunkSize: 100, maxChunkSize: 1024 });
const DOCS = { chunkSize: 1024, chunkOverlap: 100, sizeUnit: 'tokens' } as const;

const doc = (content: string): Document => ({ id: 'doc-1', content, metadata: {}, source: 'README.md' });
const n = (i: number) => String(i).padStart(3, '0');
/** 65 chars = 17 tokens. */
const cat = (i: number) => `Cats purr softly and cats nap and cats groom whiskers daily n${n(i)}.`;
/** 72 chars = 18 tokens. */
const rocket = (i: number) => `Rockets burn fuel then rockets climb then rockets reach orbit fast n${n(i)}.`;
const range = (k: number, f: (i: number) => string, from = 0) => Array.from({ length: k }, (_, i) => f(from + i));
const tokens = (s: string) => Math.ceil(s.length / 4);
const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
const contents = (chunks: Chunk[]) => chunks.map((c) => c.content);

describe('fake embedding provider', () => {
  it('scores same-topic sentences above the 0.5 threshold and cross-topic ones below it', () => {
    expect(tokens(cat(0))).toBe(17);
    expect(tokens(rocket(0))).toBe(18);
    expect(cosine(embedWords(cat(1)), embedWords(cat(2)))).toBeGreaterThan(0.8);
    expect(cosine(embedWords(rocket(1)), embedWords(rocket(2)))).toBeGreaterThan(0.8);
    expect(cosine(embedWords(cat(1)), embedWords(rocket(1)))).toBeLessThan(0.2);
  });
});

describe('SemanticChunker (ctx options)', () => {
  it('splits a docs segment where the topic changes, embedding all sentences in one batch', async () => {
    const cats = range(30, cat);
    const rockets = range(30, rocket);
    const text = [...cats, ...rockets].join(' ');
    expect(tokens(text)).toBeGreaterThan(1024); // only segments this big reach the chunker in ctx
    const provider = fakeProvider();

    const chunks = await ctxChunker(provider).chunk(doc(text), DOCS);

    expect(contents(chunks)).toEqual([cats.join(' '), rockets.join(' ')]);
    expect(chunks.map((c) => [c.metadata.startIndex, c.metadata.endIndex])).toEqual([
      [0, cats.join(' ').length],
      [text.indexOf(rocket(0)), text.length],
    ]);
    expect(provider.embedBatch).toHaveBeenCalledTimes(1);
    expect(provider.embedBatch).toHaveBeenCalledWith([...cats, ...rockets]);
    expect(new Set(chunks.map((c) => c.id)).size).toBe(2);
    expect(chunks.every((c) => c.documentId === 'doc-1')).toBe(true);
  });

  it('splits one long topic at maxChunkSize without repeating sentences (overlap is not applied)', async () => {
    const cats = range(150, cat);

    const chunks = await ctxChunker(fakeProvider()).chunk(doc(cats.join(' ')), DOCS);

    // 60 x 17 = 1020 tokens; a 61st sentence would pass 1024.
    expect(contents(chunks)).toEqual([
      cats.slice(0, 60).join(' '),
      cats.slice(60, 120).join(' '),
      cats.slice(120).join(' '),
    ]);
  });

  it('does not split on a topic change until the chunk has minChunkSize tokens', async () => {
    // Every neighbour pair changes topic; 17+18+17+18+17+18 = 105 is the first total >= 100.
    const sentences = range(24, (i) => (i % 2 === 0 ? cat(i) : rocket(i)));

    const chunks = await ctxChunker(fakeProvider()).chunk(doc(sentences.join(' ')), DOCS);

    expect(contents(chunks)).toEqual([0, 6, 12, 18].map((s) => sentences.slice(s, s + 6).join(' ')));
  });

  it('merges a trailing group under minChunkSize into the chunk before it', async () => {
    const sentences = [...range(20, cat), ...range(3, rocket)]; // rockets: 54 tokens
    const text = sentences.join(' ');

    const chunks = await ctxChunker(fakeProvider()).chunk(doc(text), DOCS);

    expect(contents(chunks)).toEqual([text]);
    expect(chunks[0]!.metadata).toEqual({ startIndex: 0, endIndex: text.length });
  });

  it('returns a single sentence as one chunk without calling the provider', async () => {
    const provider = fakeProvider();
    const text = 'A single sentence with no boundary in it.';

    const chunks = await ctxChunker(provider).chunk(doc(text), DOCS);

    expect(chunks).toEqual([{
      id: expect.stringMatching(/^[0-9a-f]{16}$/),
      content: text,
      metadata: { startIndex: 0, endIndex: text.length },
      documentId: 'doc-1',
    }]);
    expect(provider.embedBatch).not.toHaveBeenCalled();
  });

  it('handles CRLF and unicode: chunks are the original text, line breaks kept', async () => {
    const chats = range(10, (i) => `Les chats ronronnent près du café, naïve sieste n${n(i)}!`);
    const fusees = range(10, (i) => `東京 ロケット décollent vers l’orbite très vite n${n(i)}?`);
    const text = [...chats, ...fusees].join('\r\n');

    const chunks = await ctxChunker(fakeProvider()).chunk(doc(text), DOCS);

    expect(contents(chunks)).toEqual([chats.join('\r\n'), fusees.join('\r\n')]);
    expect(chunks.map((c) => [c.metadata.startIndex, c.metadata.endIndex])).toEqual([
      [0, chats.join('\r\n').length],
      [chats.join('\r\n').length + 2, text.length],
    ]);
    expect(chunks.map((c) => text.indexOf(c.content))).toEqual([0, chats.join('\r\n').length + 2]);
  });

  it('never makes a chunk over the maximum, even merging a small last group', async () => {
    // 1020 tokens of cats, then 90 of rockets (under the 100 minimum): merging gave 1110.
    const text = [...range(60, cat), ...range(5, rocket)].join(' ');

    const chunks = await ctxChunker(fakeProvider()).chunk(doc(text), DOCS);

    expect(chunks.map((c) => tokens(c.content) <= 1024)).toEqual(chunks.map(() => true));
    expect(contents(chunks).join(' ')).toBe(text);
  });

  it('splits text with no full stops at line breaks, keeping every chunk under the maximum', async () => {
    // A 300-row table was one 1745-token chunk.
    const rows = range(300, (i) => `| row ${i} | value ${i} |`);
    const text = rows.join('\n');

    const chunks = await ctxChunker(fakeProvider()).chunk(doc(text), DOCS);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => tokens(c.content) <= 1024)).toBe(true);
    expect(contents(chunks).join('\n')).toBe(text);
  });

  it('keeps line breaks, so each chunk can be found in the file', async () => {
    const text = `${range(10, cat).join('\n')}\n\n${range(10, rocket).join('\n')}`;

    const chunks = await ctxChunker(fakeProvider()).chunk(doc(text), DOCS);

    expect(contents(chunks)).toEqual([range(10, cat).join('\n'), range(10, rocket).join('\n')]);
  });

  it('cuts one huge line by length without splitting an emoji', async () => {
    const text = 'a😀'.repeat(3000); // one 9000-char "sentence", no spaces or breaks

    const chunks = await ctxChunker(fakeProvider()).chunk(doc(text), DOCS);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.isWellFormed() && tokens(c.content) <= 1024)).toBe(true);
    expect(contents(chunks).join('')).toBe(text);
  });

  it('wraps a provider failure in a ChunkerError that keeps the cause', async () => {
    const provider = fakeProvider();
    const down = new Error('connect ECONNREFUSED 127.0.0.1:11434');
    provider.embedBatch.mockRejectedValueOnce(down);

    const error = await ctxChunker(provider).chunk(doc(`${cat(1)} ${rocket(1)}`), DOCS).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ChunkerError);
    expect(error).toMatchObject({ code: 'CHUNKER_ERROR', chunkerName: 'SemanticChunker', message: 'Failed to generate sentence embeddings' });
    expect((error as ChunkerError).cause).toBe(down);
  });
});
