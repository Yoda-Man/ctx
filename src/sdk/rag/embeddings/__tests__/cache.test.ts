/**
 * CachedEmbeddingProvider as ctx builds it: `new CachedEmbeddingProvider({ provider })`
 * around the HuggingFace or Ollama provider, with the default LRU cache.
 */
import { describe, it, expect, vi } from 'vitest';
import { CachedEmbeddingProvider, type EmbeddingCache } from '../cache.js';
import type { EmbeddingProvider, EmbeddingResult } from '../types.js';

/** A distinct, non-unit vector per text, so a wrong or re-normalised vector shows. */
const vectorFor = (text: string): number[] => [text.length, text.charCodeAt(0), 3];

function fakeProvider(maxBatchSize = 32) {
  const result = (text: string): EmbeddingResult => ({ embedding: vectorFor(text), tokenCount: 7, model: 'inner-model' });
  return {
    name: 'Fake',
    dimensions: 3,
    maxBatchSize,
    embed: vi.fn(async (text: string) => result(text)),
    embedBatch: vi.fn(async (texts: string[]) => texts.map(result)),
    isAvailable: vi.fn(async () => true),
  } satisfies EmbeddingProvider;
}

describe('CachedEmbeddingProvider', () => {
  it('takes its identity and limits from the wrapped provider', () => {
    const cached = new CachedEmbeddingProvider({ provider: fakeProvider(16) });
    expect(cached.name).toBe('CachedFake');
    expect(cached.dimensions).toBe(3);
    expect(cached.maxBatchSize).toBe(16);
  });

  it('embeds a text once, then serves the cached vector', async () => {
    const inner = fakeProvider();
    const cached = new CachedEmbeddingProvider({ provider: inner });

    const first = await cached.embed('hello');
    const second = await cached.embed('hello');

    expect(inner.embed).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ embedding: vectorFor('hello'), tokenCount: 7, model: 'inner-model' });
    expect(second.embedding).toEqual(vectorFor('hello'));
    expect(second.tokenCount).toBe(Math.ceil('hello'.length / 4));
    expect(second.model).toBe('cached:Fake');
  });

  it('keeps different texts apart', async () => {
    const inner = fakeProvider();
    const cached = new CachedEmbeddingProvider({ provider: inner });

    await cached.embed('alpha');
    const beta = await cached.embed('beta');
    const alpha = await cached.embed('alpha');

    expect(inner.embed).toHaveBeenCalledTimes(2);
    expect(alpha.embedding).toEqual(vectorFor('alpha'));
    expect(beta.embedding).toEqual(vectorFor('beta'));
  });

  it('does not re-normalise: the wrapped provider already did', async () => {
    const cached = new CachedEmbeddingProvider({ provider: fakeProvider() });
    expect((await cached.embed('abc')).embedding).toEqual([3, 97, 3]);
    expect((await cached.embed('abc')).embedding).toEqual([3, 97, 3]);
  });

  it('rejects empty text without calling the wrapped provider', async () => {
    const inner = fakeProvider();
    const cached = new CachedEmbeddingProvider({ provider: inner });

    await expect(cached.embed('   ')).rejects.toMatchObject({ code: 'EMPTY_INPUT' });
    await expect(cached.embedBatch(['ok', ''])).rejects.toMatchObject({ code: 'EMPTY_INPUT' });
    expect(inner.embed).not.toHaveBeenCalled();
    expect(inner.embedBatch).not.toHaveBeenCalled();
  });

  it('caches nothing when the wrapped provider fails, so the next call retries', async () => {
    const inner = fakeProvider();
    inner.embed.mockRejectedValueOnce(new Error('ollama down'));
    const cached = new CachedEmbeddingProvider({ provider: inner });

    await expect(cached.embed('x')).rejects.toThrow('ollama down');
    expect((await cached.embed('x')).embedding).toEqual(vectorFor('x'));
    expect(inner.embed).toHaveBeenCalledTimes(2);
  });

  it('delegates isAvailable', async () => {
    const inner = fakeProvider();
    inner.isAvailable.mockResolvedValueOnce(false);
    const cached = new CachedEmbeddingProvider({ provider: inner });

    expect(await cached.isAvailable()).toBe(false);
    expect(await cached.isAvailable()).toBe(true);
  });

  it('maxCacheSize bounds the default cache (least recently used goes first)', async () => {
    const inner = fakeProvider();
    const cached = new CachedEmbeddingProvider({ provider: inner, maxCacheSize: 1 });

    await cached.embed('a');
    await cached.embed('b'); // evicts a
    await cached.embed('a');

    expect(inner.embed.mock.calls.map(([t]) => t)).toEqual(['a', 'b', 'a']);
  });

  it('uses a supplied cache, one stable key per text', async () => {
    const store = new Map<string, number[]>();
    const cache: EmbeddingCache = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, embedding: number[]) => { store.set(key, embedding); }),
      clear: async () => store.clear(),
    };
    const cached = new CachedEmbeddingProvider({ provider: fakeProvider(), cache });

    await cached.embed('one');
    await cached.embed('two');
    await cached.embed('one');

    const getKeys = vi.mocked(cache.get).mock.calls.map(([k]) => k);
    expect(getKeys[0]).toBe(getKeys[2]);
    expect(getKeys[0]).not.toBe(getKeys[1]);
    expect(store.size).toBe(2);
  });

  it('each wrapped provider has its own cache, so models never share vectors', async () => {
    const large = fakeProvider();
    const small = fakeProvider();
    small.embed.mockResolvedValue({ embedding: [9, 9, 9], tokenCount: 1, model: 'small' });
    const cachedLarge = new CachedEmbeddingProvider({ provider: large });
    const cachedSmall = new CachedEmbeddingProvider({ provider: small });

    await cachedLarge.embed('same text');
    const fromSmall = await cachedSmall.embed('same text');

    expect(fromSmall.embedding).toEqual([9, 9, 9]);
    expect(small.embed).toHaveBeenCalledTimes(1);
  });
});

describe('CachedEmbeddingProvider keys', () => {
  it('never serves one text the vector of another', async () => {
    // These two shared a 32-bit djb2 key, so the second got the first's vector.
    const a = 'function f4402() { return 4402; }';
    const b = 'function f10519() { return 10519; }';
    const inner = fakeProvider();
    const cached = new CachedEmbeddingProvider({ provider: inner });

    await cached.embed(a);
    const result = await cached.embed(b);

    expect(result.embedding).toEqual(vectorFor(b));
    expect(inner.embed).toHaveBeenCalledTimes(2);
  });
});

describe('CachedEmbeddingProvider.embedBatch', () => {
  it('embeds a text repeated within one batch once, and fills every position', async () => {
    const inner = fakeProvider();
    const cached = new CachedEmbeddingProvider({ provider: inner });

    const results = await cached.embedBatch(['licence header', 'body', 'licence header']);

    expect(inner.embedBatch).toHaveBeenCalledTimes(1);
    expect(inner.embedBatch).toHaveBeenCalledWith(['licence header', 'body']);
    expect(results.map((r) => r.embedding)).toEqual([vectorFor('licence header'), vectorFor('body'), vectorFor('licence header')]);
  });

  it('sends only the misses to the wrapped provider and returns results in input order', async () => {
    const inner = fakeProvider();
    const cached = new CachedEmbeddingProvider({ provider: inner });
    await cached.embed('b');

    const results = await cached.embedBatch(['a', 'b', 'cc']);

    expect(inner.embedBatch).toHaveBeenCalledTimes(1);
    expect(inner.embedBatch).toHaveBeenCalledWith(['a', 'cc']);
    expect(results.map((r) => r.embedding)).toEqual([vectorFor('a'), vectorFor('b'), vectorFor('cc')]);
    expect(results.map((r) => r.model)).toEqual(['inner-model', 'cached:Fake', 'inner-model']);
  });

  it('skips the wrapped provider when every text is cached', async () => {
    const inner = fakeProvider();
    const cached = new CachedEmbeddingProvider({ provider: inner });
    await cached.embedBatch(['a', 'b']);

    const again = await cached.embedBatch(['b', 'a']);

    expect(inner.embedBatch).toHaveBeenCalledTimes(1);
    expect(again.map((r) => r.embedding)).toEqual([vectorFor('b'), vectorFor('a')]);
  });

  it('vectors from a batch serve later single embeds', async () => {
    const inner = fakeProvider();
    const cached = new CachedEmbeddingProvider({ provider: inner });
    await cached.embedBatch(['x', 'yy']);

    expect((await cached.embed('yy')).embedding).toEqual(vectorFor('yy'));
    expect(inner.embed).not.toHaveBeenCalled();
  });

  it('splits large batches at the wrapped provider\'s maxBatchSize', async () => {
    const inner = fakeProvider(2);
    const cached = new CachedEmbeddingProvider({ provider: inner });

    const results = await cached.embedBatch(['t0', 't1', 't2', 't3', 't4']);

    expect(inner.embedBatch.mock.calls).toEqual([[['t0', 't1']], [['t2', 't3']], [['t4']]]);
    expect(results).toHaveLength(5);
  });

  it('returns [] for an empty batch', async () => {
    const inner = fakeProvider();
    const cached = new CachedEmbeddingProvider({ provider: inner });
    expect(await cached.embedBatch([])).toEqual([]);
    expect(inner.embedBatch).not.toHaveBeenCalled();
  });
});
