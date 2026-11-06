/**
 * Keyword search over SQLite FTS5 (chunks_fts, migration 008), against a
 * real migrated database in the test home folder.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { runMigrations, getDb } from '../../database/index.js';
import { BM25StoreManager, getBM25StoreManager, resetBM25StoreManager } from '../bm25-store.js';

let db: ReturnType<typeof getDb>;

/** A project with chunks; ids are unique so test files sharing the DB never clash. */
function seed(chunks: Array<{ content: string; fileType?: string; language?: string; metadata?: string }>) {
  const projectId = randomUUID();
  db.prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)').run(projectId, `p-${projectId}`, `/p/${projectId}`);
  const insert = db.prepare(
    `INSERT INTO chunks (id, project_id, content, embedding, file_path, file_type, language, start_line, end_line, metadata)
     VALUES (?, ?, ?, x'00', ?, ?, ?, 1, 2, ?)`
  );
  const ids = chunks.map((c, i) => {
    const id = `${projectId}-${i}`;
    insert.run(id, projectId, c.content, `src/f${i}.ts`, c.fileType ?? 'code', c.language ?? 'typescript', c.metadata ?? null);
    return id;
  });
  return { projectId, ids };
}

const search = async (projectId: string, query: string, options = {}) =>
  new BM25StoreManager().getRetriever({ projectId }).then((r) => r.retrieve(query, options));

beforeAll(() => {
  runMigrations();
  db = getDb();
});

describe('FTS5 keyword search', () => {
  it('ranks chunks by BM25, best first, scaled so the best is 1', async () => {
    const { projectId, ids } = seed([
      { content: 'refresh the session token, then refresh again' },
      { content: 'session handling in general' },
      { content: 'unrelated text about colours' },
    ]);

    const results = await search(projectId, 'refresh session');

    expect(results.map((r) => r.id)).toEqual([ids[0], ids[1]]);
    expect(results[0]!.score).toBe(1);
    expect(results[1]!.score).toBeGreaterThan(0);
    expect(results[1]!.score).toBeLessThan(1);
    expect(results[0]!.chunk.metadata).toMatchObject({ projectId, filePath: 'src/f0.ts', startLine: 1, endLine: 2 });
  });

  it('matches a camelCase identifier whole and by its words', async () => {
    const { projectId, ids } = seed([{ content: 'export function getUserById(id) {}' }, { content: 'nothing here' }]);

    expect((await search(projectId, 'getUserById')).map((r) => r.id)).toEqual([ids[0]]);
    expect((await search(projectId, 'get user by id')).map((r) => r.id)).toEqual([ids[0]]);
  });

  it('searches only the given project', async () => {
    const a = seed([{ content: 'shared keyword alpha' }]);
    const b = seed([{ content: 'shared keyword beta' }]);

    expect((await search(a.projectId, 'shared keyword')).map((r) => r.id)).toEqual(a.ids);
    expect((await search(b.projectId, 'shared keyword')).map((r) => r.id)).toEqual(b.ids);
  });

  it('filters by file type and language before the topK cut', async () => {
    const { projectId, ids } = seed([
      { content: 'deploy deploy deploy pipeline', fileType: 'code' },
      { content: 'deploy deploy pipeline', fileType: 'code' },
      { content: 'deploy notes', fileType: 'docs', language: 'markdown' },
    ]);

    expect((await search(projectId, 'deploy', { topK: 1, filter: { fileType: 'docs' } })).map((r) => r.id)).toEqual([ids[2]]);
    expect((await search(projectId, 'deploy', { topK: 5, filter: { language: 'markdown' } })).map((r) => r.id)).toEqual([ids[2]]);
    await expect(search(projectId, 'deploy', { filter: { symbolName: 'x' } })).rejects.toThrow('cannot filter on "symbolName"');
  });

  it('stays in sync with chunks: deletes and the re-index swap', async () => {
    const { projectId, ids } = seed([{ content: 'obsolete marker' }]);
    expect(await search(projectId, 'obsolete')).toHaveLength(1);

    db.prepare('DELETE FROM chunks WHERE id = ?').run(ids[0]);
    expect(await search(projectId, 'obsolete')).toEqual([]);

    // atomicSwapChunks: DELETE then INSERT ... SELECT
    db.prepare(
      `INSERT INTO chunks (id, project_id, content, embedding, file_path) VALUES (?, ?, 'renewed marker', x'00', 'src/n.ts')`
    ).run(`${projectId}-new`, projectId);
    expect((await search(projectId, 'renewed')).map((r) => r.id)).toEqual([`${projectId}-new`]);

    db.prepare("UPDATE chunks SET content = 'edited marker' WHERE id = ?").run(`${projectId}-new`);
    expect(await search(projectId, 'renewed')).toEqual([]);
    expect(await search(projectId, 'edited')).toHaveLength(1);
  });

  it('returns nothing for a query with no searchable words', async () => {
    const { projectId } = seed([{ content: 'a b c' }]);
    expect(await search(projectId, '? ! a')).toEqual([]);
  });

  it('keeps a result with corrupted metadata, and warns', async () => {
    const { projectId, ids } = seed([{ content: 'broken metadata chunk', metadata: '{not json' }]);
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const retriever = await new BM25StoreManager().getRetriever({ projectId }, undefined, logger);
    expect((await retriever.retrieve('broken')).map((r) => r.id)).toEqual(ids);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('corrupted metadata'));
  });

  it('counts the project\'s chunks', async () => {
    const { projectId } = seed([{ content: 'one' }, { content: 'two' }]);
    expect((await new BM25StoreManager().getRetriever({ projectId })).documentCount).toBe(2);
  });
});

describe('BM25StoreManager', () => {
  it('caches one retriever per project until invalidated', async () => {
    const manager = new BM25StoreManager();
    const first = await manager.getRetriever({ projectId: 'a' });

    expect(await manager.getRetriever({ projectId: 'a' })).toBe(first);
    expect(await manager.getRetriever({ projectId: 'b' })).not.toBe(first);
    expect(manager.hasRetriever('a')).toBe(true);
    expect(manager.cacheSize).toBe(2);

    manager.invalidate('a');
    expect(manager.hasRetriever('a')).toBe(false);
    manager.clearAll();
    expect(manager.cacheSize).toBe(0);
  });

  it('is a singleton until reset', () => {
    const manager = getBM25StoreManager();
    expect(getBM25StoreManager()).toBe(manager);
    resetBM25StoreManager();
    expect(getBM25StoreManager()).not.toBe(manager);
  });
});
