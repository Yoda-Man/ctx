/**
 * Vector search in SQL (sqlite-vec) against a real in-memory database: it
 * must rank exactly as the in-memory scan it replaces.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';

import { InMemoryVectorStore } from '../../sdk/rag/index.js';
import { createSearchTestDb, type SearchTestChunk } from '../../test-utils/search-db.js';
import { SqliteVectorStore, hasSqlVectorSearch } from '../sqlite-vector-store.js';

const DIMS = 16;
let seed = 1;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const vector = () => Array.from({ length: DIMS }, () => rand() - 0.5);

function chunks(n: number): SearchTestChunk[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    content: `chunk ${i}`,
    file_path: `src/f${i}.ts`,
    file_type: i % 3 === 0 ? 'docs' : 'code',
    language: i % 2 === 0 ? 'typescript' : 'python',
    start_line: i + 1,
    end_line: i + 5,
    metadata: i === 4 ? '{"symbolName":"answer"}' : null,
    embedding: new Float32Array(vector()),
  }));
}

describe('SqliteVectorStore', () => {
  it('ranks exactly as the in-memory scan', async () => {
    const data = chunks(200);
    const sql = new SqliteVectorStore(createSearchTestDb(data), 'test-project', DIMS);
    const memory = new InMemoryVectorStore({ dimensions: DIMS, distanceMetric: 'cosine' });
    await memory.insert(data.map((c) => ({ id: c.id, content: c.content, metadata: {}, embedding: Array.from(c.embedding as Float32Array) })));

    for (let q = 0; q < 5; q++) {
      const query = vector();
      const [fromSql, fromMemory] = await Promise.all([sql.search(query, { topK: 10 }), memory.search(query, { topK: 10 })]);
      expect(fromSql.map((r) => r.id)).toEqual(fromMemory.map((r) => r.id));
      fromSql.forEach((r, i) => expect(r.score).toBeCloseTo(fromMemory[i]!.score, 5));
    }
  });

  it('returns chunk metadata like the in-memory store', async () => {
    const data = chunks(10);
    const store = new SqliteVectorStore(createSearchTestDb(data), 'test-project', DIMS);

    const [best] = await store.search(Array.from(data[4]!.embedding as Float32Array), { topK: 1 });

    expect(best!.id).toBe('c4');
    expect(best!.score).toBeCloseTo(1, 5);
    expect(best!.chunk.metadata).toEqual({
      projectId: 'test-project',
      filePath: 'src/f4.ts',
      fileType: 'code',
      language: 'typescript',
      startLine: 5,
      endLine: 9,
      symbolName: 'answer',
    });
  });

  it('filters before the topK cut, and applies minScore, includeMetadata and includeVectors', async () => {
    const data = chunks(30);
    const store = new SqliteVectorStore(createSearchTestDb(data), 'test-project', DIMS);
    const query = vector();

    const docs = await store.search(query, { topK: 3, filter: { fileType: 'docs' } });
    expect(docs).toHaveLength(3);
    expect(docs.every((r) => r.chunk.metadata.fileType === 'docs')).toBe(true);

    const python = await store.search(query, { topK: 50, filter: { language: 'python', projectId: { $in: ['test-project', 'other'] } } });
    expect(python).toHaveLength(15);

    const all = await store.search(query, { topK: 30 });
    const minScore = all[5]!.score;
    expect((await store.search(query, { topK: 30, minScore })).length).toBe(6);

    const [bare] = await store.search(query, { topK: 1, includeMetadata: false, includeVectors: true });
    expect(bare!.chunk.metadata).toEqual({});
    expect(bare!.embedding).toHaveLength(DIMS);

    await expect(store.search(query, { filter: { symbolName: 'x' } })).rejects.toThrow('cannot filter on "symbolName"');
  });

  it('searches only its project, counts it, and explains a dimension mismatch', async () => {
    const db = createSearchTestDb(chunks(5));
    expect(await new SqliteVectorStore(db, 'test-project', DIMS).count()).toBe(5);
    expect(await new SqliteVectorStore(db, 'nobody', DIMS).search(vector())).toEqual([]);

    await expect(new SqliteVectorStore(db, 'test-project', 8).search(vector().slice(0, 8))).rejects.toThrow(
      /dimension mismatch.*ctx index <path> --force/s
    );
    await expect(new SqliteVectorStore(db, 'test-project', DIMS).search(vector().slice(0, 8))).rejects.toThrow('8 dimensions');
  });

  it('is read-only', async () => {
    const store = new SqliteVectorStore(createSearchTestDb([]), 'test-project', DIMS);
    await expect(store.insert([])).rejects.toThrow('read-only');
    await expect(store.clear()).rejects.toThrow('read-only');
  });
});

describe('hasSqlVectorSearch', () => {
  it('is true once sqlite-vec is loaded, false without it', () => {
    expect(hasSqlVectorSearch(createSearchTestDb([]))).toBe(true);
    expect(hasSqlVectorSearch(new Database(':memory:'))).toBe(false);
  });
});
