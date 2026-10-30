/**
 * The brute-force InMemoryVectorStore is what every ctx search scans. These
 * tests build it exactly as src/search/store.ts does (cosine, Float32
 * storage) and pin exact neighbours and scores.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryVectorStore } from '../memory-store.js';
import { VectorStoreError } from '../errors.js';
import type { ChunkMetadata } from '../types.js';

/** The store src/search/store.ts builds. */
const ctxStore = (dimensions = 3) =>
  new InMemoryVectorStore({ dimensions, distanceMetric: 'cosine' });

const chunk = (id: string, embedding: number[], metadata: ChunkMetadata = {}) => ({ id, content: `content of ${id}`, embedding, metadata });

const ids = (results: { id: string }[]) => results.map((r) => r.id);

/** Query [1,0,0] scores these at exactly 1, 1/√2, 0.6, 0 and -1. */
async function handBuilt() {
  const store = ctxStore();
  await store.insert([
    chunk('orthogonal', [0, 0, 5]),
    chunk('opposite', [-1, 0, 0]),
    chunk('near', [3, 4, 0]),
    chunk('same', [2, 0, 0]),
    chunk('diagonal', [1, 1, 0]),
  ]);
  return store;
}

describe('InMemoryVectorStore brute force (ctx default)', () => {
  it('ranks by cosine similarity with exact scores, independent of magnitude', async () => {
    const results = await (await handBuilt()).search([1, 0, 0]);
    expect(ids(results)).toEqual(['same', 'diagonal', 'near', 'orthogonal', 'opposite']);
    const scores = results.map((r) => r.score);
    expect(scores[0]).toBeCloseTo(1, 12);
    expect(scores[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(scores[2]).toBeCloseTo(0.6, 7);
    expect(scores[3]).toBe(0);
    expect(scores[4]).toBeCloseTo(-1, 12);
    expect(results[0]!.chunk).toEqual({ id: 'same', content: 'content of same', metadata: {} });
    expect(results[0]!.embedding).toBeUndefined();
  });

  it('topK cuts the ranked list, defaults to 10, and a k beyond the size returns everything', async () => {
    const store = await handBuilt();
    expect(ids(await store.search([1, 0, 0], { topK: 2 }))).toEqual(['same', 'diagonal']);
    expect(await store.search([1, 0, 0], { topK: 100 })).toHaveLength(5);

    const many = ctxStore();
    await many.insert(Array.from({ length: 12 }, (_, i) => chunk(`c${i}`, [1, i, 0])));
    const top = await many.search([1, 0, 0]);
    expect(ids(top)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']);
  });

  it('minScore keeps scores at or above it; ctx default 0 keeps orthogonal and drops opposite', async () => {
    const store = await handBuilt();
    expect(ids(await store.search([1, 0, 0], { minScore: 0 }))).toEqual(['same', 'diagonal', 'near', 'orthogonal']);
    expect(ids(await store.search([1, 0, 0], { minScore: 0.65 }))).toEqual(['same', 'diagonal']);
    expect(await store.search([1, 0, 0], { minScore: 1.01 })).toEqual([]);
  });

  it('equal scores keep insertion order, so repeated searches are deterministic', async () => {
    const store = ctxStore();
    await store.insert([chunk('first', [0, 1, 0]), chunk('second', [0, 2, 0]), chunk('best', [1, 0, 0])]);
    expect(ids(await store.search([1, 1, 0]))).toEqual(['first', 'second', 'best']);
    expect(ids(await store.search([0, 1, 0]))).toEqual(['first', 'second', 'best']);
  });

  it('an empty store returns no results and counts zero', async () => {
    const store = ctxStore();
    expect(await store.insert([])).toEqual([]);
    expect(await store.count()).toBe(0);
    expect(await store.search([1, 0, 0], { topK: 5 })).toEqual([]);
  });

  it('insert returns the ids in order and count reflects them', async () => {
    const store = ctxStore();
    expect(await store.insert([chunk('a', [1, 0, 0]), chunk('b', [0, 1, 0])])).toEqual(['a', 'b']);
    expect(await store.count()).toBe(2);
  });

  it('re-inserting an id replaces its vector and content instead of adding a duplicate', async () => {
    const store = ctxStore();
    await store.insert([chunk('a', [1, 0, 0]), chunk('b', [0, 1, 0])]);
    await store.insert([{ id: 'a', content: 'new', embedding: [0, 0, 1], metadata: { v: 2 } }]);
    expect(await store.count()).toBe(2);
    const [top] = await store.search([0, 0, 1], { topK: 1 });
    expect(top).toMatchObject({ id: 'a', score: 1, chunk: { content: 'new', metadata: { v: 2 } } });

    // Duplicates inside one batch: the last one wins.
    expect(await store.insert([chunk('c', [1, 0, 0]), chunk('c', [0, 1, 0])])).toEqual(['c', 'c']);
    expect(await store.count()).toBe(3);
    const results = await store.search([0, 1, 0]);
    expect(results.filter((r) => r.id === 'c')).toEqual([expect.objectContaining({ id: 'c', score: 1 })]);
  });

  it('zero vectors score 0, never NaN, on either side', async () => {
    const store = ctxStore();
    await store.insert([chunk('zero', [0, 0, 0]), chunk('x', [1, 0, 0]), chunk('negx', [-1, 0, 0])]);
    const fromX = await store.search([1, 0, 0]);
    expect(fromX.map((r) => [r.id, r.score])).toEqual([['x', 1], ['zero', 0], ['negx', -1]]);
    const fromZero = await store.search([0, 0, 0], { minScore: 0 });
    expect(fromZero.map((r) => [r.id, r.score])).toEqual([['zero', 0], ['x', 0], ['negx', 0]]);
  });

  it('stores its own Float32 copy, so later changes to the caller array do not move the chunk', async () => {
    const store = ctxStore();
    const embedding = [0.1, 0.2, 0.3];
    await store.insert([chunk('a', embedding), chunk('b', [0.3, 0.2, 0.1])]);
    embedding[0] = -100;
    const [top] = await store.search([0.1, 0.2, 0.3], { topK: 1 });
    expect(top!.id).toBe('a');
    expect(top!.score).toBeCloseTo(1, 6);
  });
});

describe('InMemoryVectorStore filters ctx sends', () => {
  async function projectStore() {
    const store = ctxStore();
    await store.insert([
      chunk('p1-ts', [1, 0, 0], { projectId: 'p1', fileType: 'code', language: 'typescript' }),
      chunk('p1-py', [0.9, 0.1, 0], { projectId: 'p1', fileType: 'code', language: 'python' }),
      chunk('p2-md', [0.8, 0.2, 0], { projectId: 'p2', fileType: 'docs', language: 'markdown' }),
      chunk('p3-ts', [0.7, 0.3, 0], { projectId: 'p3', fileType: 'code', language: 'typescript' }),
      chunk('no-lang', [0.95, 0.05, 0], { projectId: 'p1', fileType: 'code' }),
    ]);
    return store;
  }

  it('filters by equality before ranking and topK, returning metadata', async () => {
    const store = await projectStore();
    const results = await store.search([1, 0, 0], { topK: 1, filter: { language: 'python' } });
    expect(ids(results)).toEqual(['p1-py']);
    expect(results[0]!.chunk.metadata).toEqual({ projectId: 'p1', fileType: 'code', language: 'python' });
    expect(ids(await store.search([1, 0, 0], { filter: { fileType: 'docs' } }))).toEqual(['p2-md']);
  });

  it('combines keys with AND and drops chunks missing the key', async () => {
    const store = await projectStore();
    expect(ids(await store.search([1, 0, 0], { filter: { fileType: 'code', language: 'typescript' } }))).toEqual(['p1-ts', 'p3-ts']);
    expect(ids(await store.search([1, 0, 0], { filter: { projectId: 'p1' } }))).toEqual(['p1-ts', 'no-lang', 'p1-py']);
    expect(await store.search([1, 0, 0], { filter: { language: 'rust' } })).toEqual([]);
  });

  it('$in matches any listed project, as SearchService sends for several projects', async () => {
    const store = await projectStore();
    expect(ids(await store.search([1, 0, 0], { filter: { projectId: { $in: ['p2', 'p3'] } } }))).toEqual(['p2-md', 'p3-ts']);
    expect(await store.search([1, 0, 0], { filter: { projectId: { $in: [] } } })).toEqual([]);
  });

  it('applies minScore after the filter', async () => {
    const store = await projectStore();
    const results = await store.search([1, 0, 0], { filter: { language: 'typescript' }, minScore: 0.95 });
    expect(ids(results)).toEqual(['p1-ts']);
  });
});

describe('InMemoryVectorStore input validation', () => {
  it('rejects an embedding of the wrong size and inserts nothing from that batch', async () => {
    const store = ctxStore();
    const error = await store.insert([chunk('ok', [1, 0, 0]), chunk('bad', [1, 0])]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VectorStoreError);
    expect(error).toMatchObject({
      code: 'DIMENSION_MISMATCH',
      storeName: 'InMemoryVectorStore',
      message: 'Dimension mismatch: store expects 3 dimensions, got 2',
    });
    expect(await store.count()).toBe(0);
  });

  it('rejects a query of the wrong size or an empty query', async () => {
    const store = await handBuilt();
    await expect(store.search([1, 0, 0, 0])).rejects.toMatchObject({ code: 'DIMENSION_MISMATCH' });
    await expect(store.search([])).rejects.toMatchObject({ code: 'INVALID_QUERY', message: 'Invalid query: query vector is empty' });
  });
});
