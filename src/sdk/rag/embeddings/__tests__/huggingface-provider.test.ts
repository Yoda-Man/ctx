/**
 * HuggingFaceEmbeddingProvider as ctx builds it: the configured model, normalize: true,
 * onProgress forwarded. transformers.js is faked; no model is ever loaded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hf = vi.hoisted(() => ({ pipeline: vi.fn() }));
vi.mock('@huggingface/transformers', () => ({ env: {}, pipeline: hf.pipeline }));
// The real lock would create files under ~/.ctx/models; just run the load.
vi.mock('../../transformers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../transformers.js')>();
  return {
    ...actual,
    loadTransformers: vi.fn(actual.loadTransformers),
    withModelDownloadLock: vi.fn((_model: string, load: () => Promise<unknown>) => load()),
  };
});

import { HuggingFaceEmbeddingProvider } from '../huggingface-provider.js';
import { EmbeddingError } from '../errors.js';
import { loadTransformers, withModelDownloadLock } from '../../transformers.js';

/** Fake pooled feature-extraction output: a [texts, dims] tensor, as for a single string too. */
const output = (rows: number[][]) => ({ data: Float32Array.from(rows.flat()), tolist: () => rows });
/** Each text maps to a distinct, non-unit vector. */
const raw = (text: string): number[] => [3 * text.length, 4 * text.length];

const pipe = vi.fn(async (input: string | string[]) =>
  output(Array.isArray(input) ? input.map(raw) : [raw(input)]));

beforeEach(() => {
  vi.clearAllMocks();
  hf.pipeline.mockResolvedValue(pipe);
});

const MODEL = 'Xenova/bge-large-en-v1.5';
/** What provider.ts passes. */
const ctxProvider = (onProgress = vi.fn()) => new HuggingFaceEmbeddingProvider({ model: MODEL, normalize: true, onProgress });

describe('HuggingFaceEmbeddingProvider', () => {
  it('defaults to bge-large: 1024 dimensions, batches of 32', () => {
    const provider = new HuggingFaceEmbeddingProvider();
    expect(provider.dimensions).toBe(1024);
    expect(provider.maxBatchSize).toBe(32);
    expect(new HuggingFaceEmbeddingProvider({ dimensions: 384, batchSize: 8 })).toMatchObject({ dimensions: 384, maxBatchSize: 8 });
  });

  it('loads the q8 feature-extraction model under the download lock and mean-pools without normalising', async () => {
    const onProgress = vi.fn();
    const result = await ctxProvider(onProgress).embed('hello');

    expect(withModelDownloadLock).toHaveBeenCalledWith(MODEL, expect.any(Function));
    expect(hf.pipeline).toHaveBeenCalledWith('feature-extraction', MODEL, { dtype: 'q8', progress_callback: onProgress });
    expect(pipe).toHaveBeenCalledWith('hello', { pooling: 'mean', normalize: false });
    expect(result.model).toBe(MODEL);
    expect(result.tokenCount).toBe(2); // ceil(5 / 4)
    // [15, 20] L2-normalised by the base class
    expect(result.embedding[0]).toBeCloseTo(0.6, 6);
    expect(result.embedding[1]).toBeCloseTo(0.8, 6);
  });

  it('forwards model download progress to the caller', async () => {
    const onProgress = vi.fn();
    await ctxProvider(onProgress).embed('x');

    const { progress_callback } = hf.pipeline.mock.calls[0]![2] as { progress_callback: (p: unknown) => void };
    progress_callback({ status: 'downloading', progress: 42 });
    expect(onProgress).toHaveBeenCalledWith({ status: 'downloading', progress: 42 });
  });

  it('returns the raw pooled vector when normalize is false', async () => {
    const provider = new HuggingFaceEmbeddingProvider({ normalize: false });
    expect((await provider.embed('ab')).embedding).toEqual([6, 8]);
  });

  it('rejects empty text before loading the model', async () => {
    await expect(ctxProvider().embed('  ')).rejects.toMatchObject({ code: 'EMPTY_INPUT' });
    expect(hf.pipeline).not.toHaveBeenCalled();
  });

  it('loads the model once for concurrent calls and reuses it afterwards', async () => {
    let finishLoad!: () => void;
    hf.pipeline.mockImplementationOnce(() => new Promise((resolve) => { finishLoad = () => resolve(pipe); }));
    const provider = ctxProvider();

    const pending = Promise.all([provider.embed('a'), provider.embed('bb'), provider.embedBatch(['c', 'dd'])]);
    await vi.waitFor(() => expect(hf.pipeline).toHaveBeenCalledTimes(1));
    finishLoad();
    const [a, bb, batch] = await pending;
    await provider.embed('later');

    expect(hf.pipeline).toHaveBeenCalledTimes(1);
    expect(a.embedding).toHaveLength(2);
    expect(bb.tokenCount).toBe(1);
    expect(batch).toHaveLength(2);
  });

  it('wraps a failed model load as PROVIDER_UNAVAILABLE and retries on the next call', async () => {
    const cause = new Error('fetch failed');
    hf.pipeline.mockRejectedValueOnce(cause);
    const provider = ctxProvider();

    const error = await provider.embed('a').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect(error).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      model: MODEL,
      cause,
      message: 'Provider unavailable: Failed to load model with @huggingface/transformers.',
    });

    expect((await provider.embed('a')).embedding).toHaveLength(2);
    expect(hf.pipeline).toHaveBeenCalledTimes(2);
  });

  it('wraps an inference failure as INVALID_RESPONSE', async () => {
    const cause = new Error('onnx runtime error');
    pipe.mockRejectedValueOnce(cause);

    await expect(ctxProvider().embed('a')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      cause,
      message: 'Invalid response from provider: Failed to generate embedding',
    });
  });

  it('isAvailable reports whether transformers.js loads', async () => {
    const provider = ctxProvider();
    expect(await provider.isAvailable()).toBe(true);

    vi.mocked(loadTransformers).mockRejectedValueOnce(new Error('Cannot find package'));
    expect(await provider.isAvailable()).toBe(false);
  });
});

describe('HuggingFaceEmbeddingProvider.embedBatch', () => {
  it('runs one inference for the batch and keeps input order', async () => {
    const results = await ctxProvider().embedBatch(['a', 'bbbbb', 'cc']);

    expect(pipe).toHaveBeenCalledTimes(1);
    expect(pipe).toHaveBeenCalledWith(['a', 'bbbbb', 'cc'], { pooling: 'mean', normalize: false });
    expect(results.map((r) => r.tokenCount)).toEqual([1, 2, 1]);
    for (const r of results) {
      expect(r.embedding[0]).toBeCloseTo(0.6, 6);
      expect(r.embedding[1]).toBeCloseTo(0.8, 6);
    }
  });

  it('splits more than 32 texts into batches of 32', async () => {
    const texts = Array.from({ length: 33 }, (_, i) => `t${i}`);
    const results = await ctxProvider().embedBatch(texts);

    expect(pipe.mock.calls.map(([input]) => (input as string[]).length)).toEqual([32, 1]);
    expect(results).toHaveLength(33);
  });

  it('falls back to one text at a time when batch inference fails', async () => {
    pipe.mockRejectedValueOnce(new Error('batch too large'));
    const provider = new HuggingFaceEmbeddingProvider({ normalize: false });

    const results = await provider.embedBatch(['a', 'bb']);

    expect(pipe.mock.calls.map(([input]) => input)).toEqual([['a', 'bb'], 'a', 'bb']);
    expect(results.map((r) => r.embedding)).toEqual([[3, 4], [6, 8]]);
  });

  it('falls back to one text at a time when the batch output is missing a row', async () => {
    pipe.mockResolvedValueOnce(output([raw('a')])); // one row for two texts
    const provider = new HuggingFaceEmbeddingProvider({ normalize: false });

    const results = await provider.embedBatch(['a', 'bb']);

    expect(pipe).toHaveBeenCalledTimes(3);
    expect(results.map((r) => r.embedding)).toEqual([[3, 4], [6, 8]]);
  });

  it('surfaces INVALID_RESPONSE when the per-text fallback fails too', async () => {
    const cause = new Error('broken model');
    pipe.mockRejectedValueOnce(cause).mockRejectedValueOnce(cause); // the batch, then the first text

    await expect(ctxProvider().embedBatch(['a', 'b'])).rejects.toMatchObject({ code: 'INVALID_RESPONSE', cause });
    expect(pipe).toHaveBeenCalledTimes(2);
  });
});
