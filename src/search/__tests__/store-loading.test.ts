/**
 * Loading a project's chunks into the search stores, against real SQLite:
 * several pages, every chunk exactly once.
 */

import { describe, it, expect, vi, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'ctx-store-loading-'));
vi.mock('../../config/paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../config/paths.js')>()),
  DB_PATH: join(dir, 'context.db'), // what the connection opens
  getDbPath: () => join(dir, 'context.db'),
}));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const { runMigrations, getDatabase, closeDb } = await import('../../database/index.js');
const { VectorStoreManager } = await import('../store.js');
const { BM25StoreManager } = await import('../bm25-store.js');

describe('loading stores page by page', () => {
  it('loads every chunk once across pages of 1,000', async () => {
    // Pages used OFFSET, which re-read every earlier row: 16 s for 23,000 chunks.
    runMigrations();
    const db = getDatabase();
    const projectId = db.upsertProject({ name: 'big', path: dir });
    const count = 2500;
    db.insertChunks(projectId, Array.from({ length: count }, (_, i) => ({
      id: `chunk-${String(i).padStart(4, '0')}`,
      content: `chunk number ${i}`,
      embedding: new Float32Array([1, i, 0, 0]),
      filePath: `src/f${i}.ts`,
      fileType: 'code' as const,
      contentType: 'code' as const,
      language: 'typescript' as const,
      startLine: 1,
      endLine: 1,
      metadata: {},
    })));

    const store = await new VectorStoreManager().getStore({ projectId, dimensions: 4 });
    const bm25 = await new BM25StoreManager().getRetriever({ projectId });

    expect(await store.count()).toBe(count);
    expect(bm25.documentCount).toBe(count);
    closeDb();
  });
});
