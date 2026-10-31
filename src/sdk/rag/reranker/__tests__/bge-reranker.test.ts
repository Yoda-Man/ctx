/**
 * BGEReranker as ctx's RerankerService builds it: bge-reranker-base, device 'auto'.
 * transformers.js is faked; no model is ever loaded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hf = vi.hoisted(() => ({ loadTokenizer: vi.fn(), loadModel: vi.fn() }));
vi.mock('@huggingface/transformers', () => ({
  env: {},
  AutoTokenizer: { from_pretrained: hf.loadTokenizer },
  AutoModelForSequenceClassification: { from_pretrained: hf.loadModel },
}));
// The real lock would create files under ~/.ctx/models; just run the load.
vi.mock('../../transformers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../transformers.js')>()),
  withModelDownloadLock: vi.fn((_model: string, load: () => Promise<unknown>) => load()),
}));

import { BGEReranker } from '../bge-reranker.js';
import { RerankerError } from '../errors.js';
import { withModelDownloadLock } from '../../transformers.js';
import type { RetrievalResult } from '../../retrieval/types.js';

const MODEL = 'Xenova/bge-reranker-base';
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** The cross-encoder logit for each document, keyed by its content. */
let logits: Record<string, number>;
/** Encodes query/document pairs; the fake keeps the documents so the model can score them. */
const tokenize = vi.fn((_queries: string[], options: { text_pair: string[] }) => ({ documents: options.text_pair }));
/** One logit per pair, in input order, as the real model's [n, 1] output. */
const classify = vi.fn(async (encoded: { documents: string[] }) =>
  ({ logits: { data: Float32Array.from(encoded.documents, (d) => logits[d] ?? 0) } }));

beforeEach(() => {
  vi.clearAllMocks();
  logits = {};
  hf.loadTokenizer.mockResolvedValue(tokenize);
  hf.loadModel.mockResolvedValue(classify);
});

const doc = (id: string, score: number): RetrievalResult =>
  ({ id, chunk: { id, content: `content of ${id}`, metadata: {} }, score });
/** What RerankerService passes. */
const ctxReranker = () => new BGEReranker({ modelName: MODEL, device: 'auto' });

describe('BGEReranker', () => {
  it('loads the tokenizer and the q8 model under the download lock, with no device for auto', async () => {
    const reranker = ctxReranker();
    expect(reranker.isLoaded()).toBe(false);

    await reranker.warmup();

    expect(reranker.isLoaded()).toBe(true);
    expect(withModelDownloadLock).toHaveBeenCalledWith(MODEL, expect.any(Function));
    expect(hf.loadTokenizer).toHaveBeenCalledWith(MODEL);
    expect(hf.loadModel).toHaveBeenCalledWith(MODEL, { dtype: 'q8' });
  });

  it('encodes every query-document pair in one batch, truncated to 512 tokens', async () => {
    // The text-classification pipeline dropped text_pair, so the model never saw the documents.
    await ctxReranker().rerank('reset password', [doc('a', 0.9), doc('b', 0.8)]);

    expect(tokenize.mock.calls).toEqual([[
      ['reset password', 'reset password'],
      { text_pair: ['content of a', 'content of b'], padding: true, truncation: true, max_length: 512 },
    ]]);
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it('orders by cross-encoder score and reports sigmoid scores, raw logits and ranks', async () => {
    logits = { 'content of a': -2, 'content of b': 3, 'content of c': 0.5 };

    const results = await ctxReranker().rerank('q', [doc('a', 0.9), doc('b', 0.5), doc('c', 0.7)]);

    expect(results.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(results.map((r) => r.newRank)).toEqual([1, 2, 3]);
    expect(results.map((r) => r.originalRank)).toEqual([2, 3, 1]);
    expect(results[0]!.score).toBeCloseTo(sigmoid(3), 6);
    expect(results[2]!.score).toBeCloseTo(sigmoid(-2), 6);
    expect(results[0]!.scores).toEqual({ originalScore: 0.5, rerankerScore: results[0]!.score, relevanceScore: 3 });
    expect(results[0]!.chunk.content).toBe('content of b');
  });

  it('keeps sigmoid scores as they are: no min-max rescaling to 0..1', async () => {
    logits = { 'content of a': 1, 'content of b': 2 };

    const results = await ctxReranker().rerank('q', [doc('a', 1), doc('b', 1)]);

    expect(results.map((r) => r.score)).toEqual([sigmoid(2), sigmoid(1)]);
  });

  it('topK keeps only the best K after reordering', async () => {
    logits = { 'content of a': 0, 'content of b': 5, 'content of c': 4, 'content of d': -1 };

    const results = await ctxReranker().rerank('q', [doc('a', 1), doc('b', 1), doc('c', 1), doc('d', 1)], { topK: 2 });

    expect(results.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('equal scores keep the incoming search order', async () => {
    const results = await ctxReranker().rerank('q', [doc('x', 1), doc('y', 1), doc('z', 1)]);

    expect(results.map((r) => r.id)).toEqual(['x', 'y', 'z']);
    expect(results.every((r) => r.score === 0.5)).toBe(true);
  });

  it('returns [] for no results without loading the model', async () => {
    const reranker = ctxReranker();
    expect(await reranker.rerank('q', [])).toEqual([]);
    expect(hf.loadModel).not.toHaveBeenCalled();
    expect(reranker.isLoaded()).toBe(false);
  });

  it('rejects an empty query as INVALID_INPUT', async () => {
    await expect(ctxReranker().rerank('', [doc('a', 1)])).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(hf.loadModel).not.toHaveBeenCalled();
  });

  it('loads the model once for concurrent warmup and rerank calls', async () => {
    let finishLoad!: () => void;
    hf.loadModel.mockImplementationOnce(() => new Promise((resolve) => { finishLoad = () => resolve(classify); }));
    const reranker = ctxReranker();

    const pending = Promise.all([reranker.warmup(), reranker.rerank('q', [doc('a', 1)]), reranker.rerank('q', [doc('b', 1)])]);
    await vi.waitFor(() => expect(hf.loadModel).toHaveBeenCalledTimes(1));
    finishLoad();
    await pending;
    await reranker.rerank('q', [doc('c', 1)]);

    expect(hf.loadModel).toHaveBeenCalledTimes(1);
    expect(hf.loadTokenizer).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledTimes(3);
  });

  it('wraps a failed model load as MODEL_LOAD_FAILED and can retry later', async () => {
    const cause = new Error('fetch failed');
    hf.loadModel.mockRejectedValueOnce(cause);
    const reranker = ctxReranker();

    const error = await reranker.warmup().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RerankerError);
    expect(error).toMatchObject({
      code: 'MODEL_LOAD_FAILED',
      cause,
      message: `Failed to load model: Failed to load model '${MODEL}': fetch failed`,
    });
    expect(reranker.isLoaded()).toBe(false);

    await reranker.warmup();
    expect(reranker.isLoaded()).toBe(true);
  });

  it('wraps a scoring failure as RERANKING_FAILED', async () => {
    const cause = new Error('onnx runtime error');
    classify.mockRejectedValueOnce(cause);

    await expect(ctxReranker().rerank('q', [doc('a', 1)])).rejects.toMatchObject({
      code: 'RERANKING_FAILED',
      cause,
      message: 'Reranking failed: Cross-encoder scoring failed: onnx runtime error',
    });
  });
});
